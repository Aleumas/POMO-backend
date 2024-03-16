import EventEmitter from "events";

class Timer extends EventEmitter {
  constructor(room, owners) {
    super();
    this.owners = owners;
    this.room = room;
    this.timerId = null;
    this.time = 0;
  }

  start(io, time, transition, nextTransitions) {
    this.time = time;
    if (!this.timerId) {
      this.owners.forEach((owner) =>
        io.to(this.room).emit(`machineTransition:${owner}`, transition),
      );

      this.timerId = setInterval(() => {
        this.time -= 1;

        this.owners.forEach((owner) => {
          io.to(this.room).emit(`timerModeUpdate:${owner}`, "running");
          io.to(this.room).emit(`timeUpdate:${owner}`, this.time);

          if (this.time === 0) {
            this.stop(io, nextTransitions);
            io.to(this.room).emit(`sessionCompletion:${owner}`);
          }
        });
      }, 1000);
    }
  }

  pause(io) {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.owners.forEach((owner) => {
        io.to(this.room).emit(`machineTransition:${owner}`, "PAUSE");
      });
    }
  }

  stop(io, transitions) {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      this.owners.forEach((owner) => {
        transitions.forEach((transition) => {
          io.to(this.room).emit(`machineTransition:${owner}`, transition);
        });
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
