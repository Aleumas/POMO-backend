const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  socket.on("start", (time) => {
    time + 1;
    const timer = setInterval(() => {
      time -= 1;
      socket.emit("update-timer", time);
      if (time === 0) {
        clearInterval(timer);
      }
    }, 1000);
  });
});

httpServer.listen(3000);
