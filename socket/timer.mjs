import EventEmitter from "events";

class Timer extends EventEmitter {
  constructor(room, owners) {
    super();
    this.owners = owners;
    this.room = room;
    this.timerId = null;
  }

  start(io, time) {
    if (!this.timerId) {
      this.timerId = setInterval(() => {
        this.owners.forEach((owner) => {
          io.to(this.room).emit(`modeUpdate:${owner}`, "work");
          io.to(this.room).emit(`timeUpdate:${owner}`, time);
          if (time === 0) {
            this.stop();
            io.to(this.room).emit(`modeUpdate:${owner}`, "idle");
          }
        });
        time -= 1;
      }, 1000);
    }
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
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
