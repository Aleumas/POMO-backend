import EventEmitter from "events";

class Timer extends EventEmitter {
  constructor(room, owners) {
    super();
    this.owners = owners;
    this.room = room;
    this.timerId = null;
    this.time = 0;
  }

  start(io, time, nextMode) {
    this.time = time;
    if (!this.timerId) {
      this.timerId = setInterval(() => {
        this.time -= 1;
        this.owners.forEach((owner) => {
          io.to(this.room).emit(`timerModeUpdate:${owner}`, "running");
          io.to(this.room).emit(`timeUpdate:${owner}`, this.time);
          if (this.time === 0) {
            this.stop(io, nextMode);
          }
        });
      }, 1000);
    }
  }

  pause(io) {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      this.owners.forEach((owner) => {
        io.to(this.room).emit(`timerModeUpdate:${owner}`, "paused");
      });
    }
  }

  stop(io, nextMode) {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      this.owners.forEach((owner) => {
        io.to(this.room).emit(`timerModeUpdate:${owner}`, "idle");
        io.to(this.room).emit(`sessionModeUpdate:${owner}`, nextMode);
      });
    }
  }

  update(io, time) {
    this.owners.forEach((owner) => {
      io.to(this.room).emit(`timeUpdate:${owner}`, time);
    });
  }

  addOwner(owner) {
    if (this.owners.includes(owner)) {
      return;
    }
    this.owners.push(owner);
  }

  removeOwner(owner) {
    this.owners = this.owners.filter((o) => o !== owner);
  }
}

export default Timer;
