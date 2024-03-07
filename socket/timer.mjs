import EventEmitter from "events";

class Timer extends EventEmitter {
  constructor(owner) {
    super();
    this.owner = owner;
    this.timerId = null;
  }

  start(socket, time) {
    if (!this.timerId) {
      this.timerId = setInterval(() => {
        socket.emit("updateTimer", time);
        if (time === 0) {
          this.stop();
        }
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
}

export default Timer;
