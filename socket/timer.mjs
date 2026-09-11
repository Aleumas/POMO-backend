import EventEmitter from "events";

class Timer extends EventEmitter {
  constructor(room, owners) {
    super();
    this.owners = owners;
    this.room = room;
    this.machineStates = new Map();
  }

  broadcastMachineState(io, userId, machineState) {
    this.machineStates.set(userId, machineState);
    
    this.owners.forEach((owner) => {
      if (owner !== userId) {
        io.to(this.room).emit(`machineStateUpdate:${owner}`, {
          userId,
          state: machineState
        });
      }
    });
  }

  async handleSessionCompletion(io, userId, sessionType, duration) {
    io.to(this.room).emit(`sessionCompletion:${userId}`);
  }

  getMachineState(userId) {
    return this.machineStates.get(userId);
  }

  getAllMachineStates() {
    const states = {};
    this.machineStates.forEach((state, userId) => {
      states[userId] = state;
    });
    return states;
  }

  addOwner(owner) {
    if (this.owners.includes(owner)) {
      return;
    }
    this.owners.push(owner);
  }

  removeOwner(owner) {
    this.owners = this.owners.filter((o) => o !== owner);
    this.machineStates.delete(owner);
  }

  // Legacy methods for backward compatibility
  start(io, time, transition, nextTransitions) {
    console.log("Timer.start() called - using machine state broadcasting instead");
  }

  pause(io) {
    console.log("Timer.pause() called - using machine state broadcasting instead");
  }

  stop(io, transitions) {
    console.log("Timer.stop() called - using machine state broadcasting instead");
  }

  update(io, time) {
    console.log("Timer.update() called - using machine state broadcasting instead");
  }
}

export default Timer;
