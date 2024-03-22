import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import TimerManager from "./socket/timer_manager.mjs";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import { supabase } from "./supabase/supabase.mjs";

const app = express();
const httpServer = createServer(app);
const allowedOrigins = ["http://localhost:3001"];
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
const rooms = new Map();

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    rooms.forEach((room) => {
      if (
        room.has(socket.id) &&
        timerManager.hasTimer(room.get(socket.id).uid)
      ) {
        const timer = timerManager.getTimer(room.get(socket.id).uid);
        timer.stop(io, ["STOP"]);
        timerManager.deleteTimer(room.get(socket.id).uid);
      }
      room.delete(socket.id);
    });
  });

  socket.on("disconnecting", () => {
    var socketRooms = socket.rooms;
    socketRooms.forEach(async (room) => {
      if (rooms.has(room) && rooms.get(room).has(socket.id)) {
        socket
          .in(room)
          .emit("removeParticipant", rooms.get(room).get(socket.id).uid);
        socket
          .in(room)
          .emit(
            "showToast",
            `${rooms.get(room).get(socket.id).displayName ?? "user"} left room`,
          );
      }
    });
  });

  socket.on("syncRequest", (room, targetSocketId) => {
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (!rooms.has(room)) {
      return;
    }

    if (targetSocket) {
      targetSocket.emit("showSyncRequest", rooms.get(room).get(socket.id));
    }
  });

  socket.on("acceptSyncRequest", (room, sourceSocketId) => {
    const sourceSocket = io.sockets.sockets.get(sourceSocketId);
    if (
      !rooms.has(room) ||
      !rooms.get(room).has(socket.id) ||
      !rooms.get(room).has(sourceSocketId) ||
      !sourceSocket
    ) {
      return;
    }

    const targetId = rooms.get(room).get(socket.id).uid;
    const sourceId = rooms.get(room).get(sourceSocketId).uid;

    socket.emit("syncMachines");
    socket.on("syncMachines", (snapshot) => {
      const syncedParticipants = timerManager.getTimer(sourceId)?.owners;
      if (syncedParticipants) {
        syncedParticipants.forEach((participant) => {
          io.to(room).emit(`syncStatusUpdate:${participant}`, false);
        });
      }

      io.to(room).emit(`setMachineSnapshot:${sourceId}`, snapshot);
      io.to(room).emit(`setMachineSnapshot:${targetId}`, snapshot);
      sourceSocket.emit(`syncStatusUpdate:${targetId}`, true);
      socket.emit(`syncStatusUpdate:${sourceId}`, true);

      timerManager.syncTimers(room, targetId, sourceId);

      sourceSocket.emit(
        "showToast",
        `${rooms.get(room)?.get(socket.id).displayName ?? "user"} accepted request to sync.`,
        "success",
      );
    });
  });

  socket.on("declineSyncRequest", (room, sourceSocketId) => {
    const sourceSocket = io.sockets.sockets.get(sourceSocketId);
    if (sourceSocket) {
      sourceSocket.emit(
        "showToast",
        `${rooms.get(room)?.get(socket.id).displayName ?? "user"} declined request to sync.`,
        "error",
      );
    }
  });

  socket.on("unsync", (room, otherSocketId) => {
    const otherSocket = io.sockets.sockets.get(otherSocketId);
    if (
      !rooms.has(room) ||
      !rooms.get(room).has(socket.id) ||
      !rooms.get(room).has(otherSocketId) ||
      !otherSocket
    ) {
      return;
    }

    const sourceId = rooms.get(room).get(socket.id).uid;
    const otherId = rooms.get(room).get(otherSocketId).uid;

    timerManager.unsyncTimers(room, sourceId);

    io.to(room).emit(`syncStatusUpdate:${otherId}`, false);
    io.to(room).emit(`syncStatusUpdate:${sourceId}`, false);
    io.to(room).emit(`machineTransition:${sourceId}`, "STOP");
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
    socket.join(room);

    timerManager.createTimer(room, id);
    if (rooms.has(room) && !rooms.get(room)?.get(socket.id)) {
      rooms.get(room)?.set(socket.id, {
        uid: id,
        displayName: displayName ?? "user",
        socketId: socket.id,
        avatar: avatar,
      });

      const existingParticipants = [...rooms.get(room).values()];

      io.to(room).emit("addExistingParticipants", existingParticipants);

      socket.in(room).emit("showToast", `${displayName} joined room`);

      await supabase.from("session").insert({
        id: room,
        user_id: id,
      });
    }
  });
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

app.post("/room", (req, res) => {
  const roomId = uuidv4();
  rooms.set(roomId, new Map());
  res.status(201).json(roomId);
});

app.get("/rooms/:id", (req, res) => {
  const { id } = req.params;
  if (rooms.has(id)) {
    res.status(200).send("Room exists");
  } else {
    res.status(404).send("Room not found");
  }
});

httpServer.listen(3000);
