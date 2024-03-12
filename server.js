import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import TimerManager from "./socket/timer_manager.mjs";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const timerManager = new TimerManager();
const participants = {};
const nextMode = (mode) => {
  return mode == "work" ? "break" : "work";
};

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    // Clean up timer when participant disconnects
    if (participants[socket.id]) {
      timerManager.deleteTimer(participants[socket.id].uid);
    }
  });

  socket.on("disconnecting", () => {
    var rooms = socket.rooms;
    rooms.forEach((room) => {
      if (participants[socket.id]) {
        socket.in(room).emit("removeParticipant", participants[socket.id].uid);
        socket
          .in(room)
          .emit(
            "showToast",
            `${participants[socket.id].displayName} left room`,
          );
      }
    });
  });

  socket.on("startTimer", (participantId, preset, currentSessionMode) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.start(io, preset, nextMode(currentSessionMode));
    }
  });

  socket.on("pauseTimer", (currentSessionMode, participantId) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.stop(io, currentSessionMode);
    }
  });

  socket.on("resumeTimer", (participantId) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.start(io, timer.time);
    }
  });

  socket.on("stopTimer", (currentSessionMode, participantId) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.stop(io, nextMode(currentSessionMode));
    }
  });

  socket.on("updateTimer", (time, participantId) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      console.log("time: ", time);
      timer.update(io, time);
    }
  });

  socket.on(
    "syncRequest",
    (targetSocketId, participantId, participantDisplayName) => {
      if (io.sockets.sockets.has(targetSocketId)) {
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        targetSocket.emit(
          "syncRequest",
          socket.id,
          participantId,
          participantDisplayName,
        );
      }
    },
  );

  socket.on(
    "syncAcceptance",
    (room, targetParticipantId, targetSocketId, participantId) => {
      timerManager.syncTimers(room, targetParticipantId, participantId);
      socket.emit("syncStatusUpdate", true);

      if (io.sockets.sockets.has(targetSocketId)) {
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        targetSocket.emit("syncStatusUpdate", true);
      }
    },
  );

  socket.on("unsync", (room, targetParticipantId, targetSocketId) => {
    timerManager.unsyncTimers(room, targetParticipantId);
    socket.emit("showToast", "unsync was successful");
    socket.emit("syncStatusUpdate", false);

    if (io.sockets.sockets.has(targetSocketId)) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      targetSocket.emit("syncStatusUpdate", false);
    }
  });

  socket.on("joinRoom", async (room, displayName, id) => {
    const existingParticipants = (await io.in(room).fetchSockets())
      .map((socket) => {
        if (!participants[socket.id].uid) {
          return;
        }
        return {
          participant: participants[socket.id].uid,
          socketId: participants[socket.id].socketId,
        };
      })
      .filter((participant) => participant !== null);
    socket.join(room);

    socket.emit("addExistingParticipants", existingParticipants);

    timerManager.createTimer(room, id);
    if (!participants[socket.id]) {
      socket.in(room).emit("showToast", `${displayName} joined room`);
      socket.in(room).emit("addParticipant", id, socket.id);

      participants[socket.id] = {
        uid: id,
        displayName: displayName,
        socketId: socket.id,
      };
    }
  });
});

httpServer.listen(3000);
