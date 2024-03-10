import Timer from "./timer.mjs";

class TimerManager {
  constructor() {
    this.timers = {};
  }

  createTimer(room, participantId) {
    if (!this.timers[participantId]) {
      this.timers[participantId] = new Timer(room, [participantId]);
    }
  }

  getTimer(participantId) {
    return this.timers[participantId];
  }

  deleteTimer(participantId) {
    delete this.timers[participantId];
  }

  syncTimers(room, targetParticipantId, participantId) {
    this.unsyncTimers(room, participantId);

    let targetTimer = this.timers[targetParticipantId];
    targetTimer.addOwner(participantId);

    if (targetTimer) {
      this.timers[participantId] = targetTimer;
    }
  }

  unsyncTimers(room, participantId) {
    Object.values(this.timers).forEach((timer) => {
      timer.removeOwner(participantId);
    });

    this.deleteTimer(participantId);
    this.createTimer(room, participantId);
  }
}

export default TimerManager;
