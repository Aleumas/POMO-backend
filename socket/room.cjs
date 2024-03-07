const createRoom = (socket) => {
  const room = Math.random().toString(36).substring(7);
  socket.join(room);
  return room;
};

module.exports = {
  createRoom,
};
