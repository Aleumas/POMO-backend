// Purpose: Generate a random room code for the user to join.
export const generateRoomCode = () => {
  return Math.random().toString(36).substring(7);
};
