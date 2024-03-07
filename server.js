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

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    // Clean up timer when participant disconnects
    timerManager.deleteTimer(socket.id);
  });

  socket.on("startTimer", (participantId, preset) => {
    console.log("start event recieved");
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.start(socket, preset);
    }
  });

  socket.on("stopTimer", (participantId) => {
    const timer = timerManager.getTimer(participantId);
    if (timer) {
      timer.stop();
    }
  });

  socket.on("joinRoom", (roomCode, participantId) => {
    socket.join(roomCode);
    timerManager.createTimer(participantId);
  });
});

httpServer.listen(3000);
