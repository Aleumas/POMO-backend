import type { Intent, Phase, Timer } from "./protocol";

export const DEFAULT_TIMER: Timer = {
  phase: "work",
  status: "idle",
  workDurationMs: 25 * 60_000,
  breakDurationMs: 5 * 60_000,
  durationMs: 25 * 60_000,
  remainingMs: 25 * 60_000,
  endsAt: null,
};

const phaseDuration = (timer: Timer, phase: Phase) =>
  phase === "work" ? timer.workDurationMs : timer.breakDurationMs;

export function applyIntent(timer: Timer, intent: Intent, now: number): Timer {
  switch (intent.type) {
    case "start":
      if (timer.status !== "idle") return timer;
      return { ...timer, status: "running", endsAt: now + timer.remainingMs };

    case "pause":
      if (timer.status !== "running" || timer.endsAt === null) return timer;
      return {
        ...timer,
        status: "paused",
        remainingMs: Math.max(0, timer.endsAt - now),
        endsAt: null,
      };

    case "resume":
      if (timer.status !== "paused") return timer;
      return { ...timer, status: "running", endsAt: now + timer.remainingMs };

    case "stop":
      if (timer.status === "idle") return timer;
      return {
        ...timer,
        status: "idle",
        remainingMs: timer.durationMs,
        endsAt: null,
      };

    // Skip is break-only: jump straight to work, idle, at its full duration
    // (same shape a natural break completion leaves behind).
    case "skip": {
      if (timer.status === "idle" || timer.phase !== "break") return timer;
      const nextDuration = phaseDuration(timer, "work");
      return {
        ...timer,
        phase: "work",
        status: "idle",
        durationMs: nextDuration,
        remainingMs: nextDuration,
        endsAt: null,
      };
    }

    case "setPreset": {
      if (timer.status !== "idle") return timer;
      const next: Timer =
        intent.phase === "work"
          ? { ...timer, workDurationMs: intent.durationMs }
          : { ...timer, breakDurationMs: intent.durationMs };
      if (intent.phase === timer.phase) {
        next.durationMs = intent.durationMs;
        next.remainingMs = intent.durationMs;
      }
      return next;
    }
  }
}

export function completeIfDue(
  timer: Timer,
  now: number,
): { timer: Timer; completed: { phase: Phase; durationMs: number } } | null {
  if (timer.status !== "running" || timer.endsAt === null || timer.endsAt > now) {
    return null;
  }
  const nextPhase: Phase = timer.phase === "work" ? "break" : "work";
  const nextDuration = phaseDuration(timer, nextPhase);
  return {
    completed: { phase: timer.phase, durationMs: timer.durationMs },
    timer: {
      ...timer,
      phase: nextPhase,
      status: "idle",
      durationMs: nextDuration,
      remainingMs: nextDuration,
      endsAt: null,
    },
  };
}
