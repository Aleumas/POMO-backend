const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { createRoom } = require("./socket/room.cjs");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  socket.on("create-room", () => {
    const room = createRoom(socket);
    let timer = null;
    socket.emit("room-created", room);

    socket.on("start-timer", (preset) => {
      let time = preset + 1;
      timer = setInterval(() => {
        time -= 1;
        socket.emit("update-timer", time);
        if (time === 0) {
          clearInterval(timer);
        }
      }, 1000);
      io.to(room).emit("start", preset);
    });

    socket.on("end-timer", () => {
      clearInterval(timer);
    });
  });
});

httpServer.listen(3000);
