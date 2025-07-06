import Timer from "./timer.mjs";

class TimerManager {
  constructor() {
    this.timers = {};
    this.roomParticipants = {};
  }

  createTimer(room, participantId) {
    if (!this.timers[participantId]) {
      // Initialize room participants if not exists
      if (!this.roomParticipants[room]) {
        this.roomParticipants[room] = [];
      }
      
      // Add participant to room if not already there
      if (!this.roomParticipants[room].includes(participantId)) {
        this.roomParticipants[room].push(participantId);
      }
      
      // Create timer with all room participants
      this.timers[participantId] = new Timer(room, [...this.roomParticipants[room]]);
      
      // Update all existing timers in the room with the new participant
      this.roomParticipants[room].forEach(existingParticipant => {
        if (existingParticipant !== participantId && this.timers[existingParticipant]) {
          this.timers[existingParticipant].addOwner(participantId);
        }
      });
    }
  }

  getTimer(participantId) {
    return this.timers[participantId];
  }

  hasTimer(participantId) {
    return this.timers[participantId] != undefined;
  }

  deleteTimer(participantId) {
    // Find the room this participant was in
    let participantRoom = null;
    for (const [room, participants] of Object.entries(this.roomParticipants)) {
      if (participants.includes(participantId)) {
        participantRoom = room;
        break;
      }
    }
    
    // Remove participant from room tracking
    if (participantRoom && this.roomParticipants[participantRoom]) {
      this.roomParticipants[participantRoom] = this.roomParticipants[participantRoom].filter(p => p !== participantId);
      
      // Update all remaining timers in the room to remove this participant
      this.roomParticipants[participantRoom].forEach(remainingParticipant => {
        if (this.timers[remainingParticipant]) {
          this.timers[remainingParticipant].removeOwner(participantId);
        }
      });
      
      // Clean up empty room
      if (this.roomParticipants[participantRoom].length === 0) {
        delete this.roomParticipants[participantRoom];
      }
    }
    
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

  getTimerStats() {
    return {
      totalTimers: Object.keys(this.timers).length,
      rooms: Object.keys(this.roomParticipants).map(room => ({
        room,
        participants: this.roomParticipants[room]
      }))
    };
  }

  shutdown() {
    this.timers = {};
    this.roomParticipants = {};
  }
}

export default TimerManager;
