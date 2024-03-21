import EventEmitter from "events";
import { supabase } from "../supabase/supabase.mjs";

class Timer extends EventEmitter {
  constructor(room, owners) {
    super();
    this.owners = owners;
    this.room = room;
    this.timerId = null;
    this.time = 0;
  }

  async start(io, time, transition, nextTransitions) {
    this.time = time;
    if (!this.timerId) {
      this.owners.forEach(async (owner) => {
        io.to(this.room).emit(`machineTransition:${owner}`, transition);
      });

      this.timerId = setInterval(() => {
        this.time -= 1;

        this.owners.forEach(async (owner) => {
          io.to(this.room).emit(`timeUpdate:${owner}`, this.time);

          if (this.time === 0) {
            this.stop(io, nextTransitions);
            io.to(this.room).emit(`sessionCompletion:${owner}`);
            if (nextTransitions.length > 0) {
              if (nextTransitions[0] === "BREAK") {
                await supabase.rpc("increment_total_work_sessions", {
                  uid: this.room,
                  user_sub: owner,
                });
                await supabase.rpc("increment_total_work_minutes", {
                  uid: this.room,
                  user_sub: owner,
                  amount: time / 60,
                });
              } else {
                await supabase.rpc("increment_total_break_sessions", {
                  uid: this.room,
                  user_sub: owner,
                });
                await supabase.rpc("increment_total_break_minutes", {
                  uid: this.room,
                  user_sub: owner,
                  amount: time / 60,
                });
              }
            }
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
        io.to(this.room).emit(`machineTransition:${owner}`, "PAUSE");
      });
    }
  }

  stop(io, transitions) {
    clearInterval(this.timerId);
    this.timerId = null;
    this.owners.forEach((owner) => {
      transitions.forEach((transition) => {
        io.to(this.room).emit(`machineTransition:${owner}`, transition);
      });
    });
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
