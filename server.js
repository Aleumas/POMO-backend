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
