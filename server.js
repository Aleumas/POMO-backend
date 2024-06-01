import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import TimerManager from "./socket/timer_manager.mjs";
import cors from "cors";
import { supabase } from "./supabase/supabase.mjs";

import { createClient } from "redis";

const app = express();
const redis = createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: "redis-18353.c276.us-east-1-2.ec2.redns.redis-cloud.com",
    port: 18353,
  },
});
const httpServer = createServer(app);
const allowedOrigins = ["https://tomatera.netlify.app"];
const roomTTL = 60 * 60 * 12; // half a one day

await redis.connect();

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      const msg =
        "The CORS policy for this site does not allow access from the specified Origin.";
      return callback(new Error(msg), false);
    },
  }),
);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const timerManager = new TimerManager();

io.on("connection", (socket) => {
  socket.on("disconnecting", () => {
    var socketRooms = socket.rooms;
    socketRooms.forEach(async (room) => {
      const participantDetails = JSON.parse(await redis.hGet(room, socket.id));

      if (participantDetails) {
        socket.in(room).emit("removeParticipant", participantDetails.uid);
        socket
          .in(room)
          .emit(
            "showToast",
            `${participantDetails.displayName ?? "user"} left room`,
          );

        if (timerManager.hasTimer(participantDetails.uid)) {
          const timer = timerManager.getTimer(participantDetails.uid);
          timer.stop(io, ["STOP"]);
          timerManager.deleteTimer(participantDetails.uid);
        }
      }

      await redis.hDel(room, socket.id);
    });
  });

  socket.on("syncRequest", async (room, targetSocketId) => {
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    const sourceParticipantDetails = JSON.parse(
      await redis.hGet(room, socket.id),
    );

    if (sourceParticipantDetails && targetSocket) {
      targetSocket.emit("showSyncRequest", sourceParticipantDetails);
    }
  });

  socket.on("acceptSyncRequest", async (room, sourceSocketId) => {
    const sourceSocket = io.sockets.sockets.get(sourceSocketId);

    const targetParticipantDetails = await redis.hGet(room, socket.id);
    const sourceParticipantDetails = await redis.hGet(room, sourceSocketId);

    if (
      sourceParticipantDetails == null ||
      targetParticipantDetails == null ||
      !sourceSocket
    ) {
      return;
    }

    const targetParticipantId = JSON.parse(targetParticipantDetails).uid;
    const sourceParticipantId = JSON.parse(sourceParticipantDetails).uid;

    socket.emit("syncMachines");
    socket.on("syncMachines", (snapshot) => {
      const syncedParticipants =
        timerManager.getTimer(sourceParticipantId)?.owners;
      if (syncedParticipants) {
        syncedParticipants.forEach((participant) => {
          io.to(room).emit(`syncStatusUpdate:${participant}`, false);
        });
      }

      io.to(room).emit(`setMachineSnapshot:${targetParticipantId}`, snapshot);
      io.to(room).emit(`setMachineSnapshot:${sourceParticipantId}`, snapshot);
      sourceSocket.emit(`syncStatusUpdate:${targetParticipantId}`, true);
      socket.emit(`syncStatusUpdate:${sourceParticipantId}`, true);

      timerManager.syncTimers(room, targetParticipantId, sourceParticipantId);

      sourceSocket.emit(
        "showToast",
        `${targetParticipantDetails.displayName ?? "user"} accepted request to sync.`,
        "success",
      );
    });
  });

  socket.on("declineSyncRequest", async (room, sourceSocketId) => {
    const sourceSocket = io.sockets.sockets.get(sourceSocketId);
    const sourceParticipantDetails = JSON.parse(
      await redis.hGet(room, sourceSocketId),
    );

    if (sourceSocket && sourceParticipantDetails != null) {
      sourceSocket.emit(
        "showToast",
        `${sourceParticipantDetails.displayName ?? "user"} declined request to sync.`,
        "error",
      );
    }
  });

  socket.on("unsync", async (room, otherSocketId) => {
    const sourceParticipantDetails = await redis.hGet(room, socket.id);
    const otherParticipantDetails = await redis.hGet(room, otherSocketId);

    if (sourceParticipantDetails == null || otherParticipantDetails == null) {
      return;
    }

    const sourceParticipantId = JSON.parse(sourceParticipantDetails).uid;
    const otherParticipantId = JSON.parse(otherParticipantDetails).uid;

    timerManager.unsyncTimers(room, sourceParticipantId);

    io.to(room).emit(`syncStatusUpdate:${otherParticipantId}`, false);
    io.to(room).emit(`syncStatusUpdate:${sourceParticipantId}`, false);
    io.to(room).emit(`machineTransition:${sourceParticipantId}`, "STOP");
  });

  socket.on(
    "startTimer",
    (participantId, preset, transition, nextTransition) => {
      const timer = timerManager.getTimer(participantId);
      if (timer) {
        timer.start(io, preset, transition, nextTransition);
      }
    },
  );

  socket.on("pauseTimer", (participantId) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.pause(io);
    }
  });

  socket.on("resumeTimer", (participantId, transition, nextTransitions) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.start(io, timer.time, transition, nextTransitions);
    }
  });

  socket.on("stopTimer", (participantId, transitions) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.stop(io, transitions);
    }
  });

  socket.on("updateTimer", (time, participantId) => {
    if (time === 0) {
      return;
    }

    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.update(io, time);
    }
  });

  socket.on("joinRoom", async (room, displayName, avatar, id) => {
    console.log("mark 1");
    socket.join(room);

    const participantDetails = JSON.stringify({
      uid: id,
      displayName: displayName ?? "user",
      socketId: socket.id,
      avatar: avatar,
    });

    console.log("mark 2");
    await redis.hSet(room, socket.id, participantDetails);
    await redis.expire(room, roomTTL);

    timerManager.createTimer(room, id);

    const existingParticipants = await redis.hVals(room);

    io.to(room).emit("addExistingParticipants", existingParticipants);

    socket.in(room).emit("showToast", `${displayName} joined room`);

    await supabase.from("session").insert({
      id: room,
      user_id: id,
    });
  });
});

socket.on("connect_error", (err) => {
  console.log(`connect_error due to ${err.message}`);
});

app.get("/:user_sub/total_sessions", async (req, res) => {
  const { user_sub } = req.params;
  const { data, error } = await supabase.rpc("get_total_sessions", {
    user_sub: user_sub,
  });

  if (!error) {
    res.status(200).send(data);
  } else {
    res.status(422).send({});
  }
});

httpServer.listen(process.env.PORT || 3000);
