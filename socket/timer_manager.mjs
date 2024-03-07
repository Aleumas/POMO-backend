import Timer from "./timer.mjs";

class TimerManager {
  constructor() {
    this.timers = {};
  }

  createTimer(participantId) {
    if (!this.timers[participantId]) {
      this.timers[participantId] = new Timer(participantId);
    }
  }

  getTimer(participantId) {
    return this.timers[participantId];
  }

  deleteTimer(participantId) {
    delete this.timers[participantId];
  }

  syncTimers(targetParticipantId, participantId) {
    targetTimer = this.timers[targetParticipantId];
    if (targetTimer) {
      this.timers[participantId] = targetTimer;
    }
  }
}

export default TimerManager;
