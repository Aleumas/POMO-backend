export type Phase = "work" | "break";
export type Status = "idle" | "running" | "paused";

export interface Timer {
  phase: Phase;
  status: Status;
  workDurationMs: number;
  breakDurationMs: number;
  durationMs: number;
  remainingMs: number;
  endsAt: number | null;
}

export interface RoomParticipant {
  uid: string;
  displayName: string;
  avatar: string;
  timer: Timer;
}

export type Intent =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "skip" }
  | { type: "setPreset"; phase: Phase; durationMs: number };

export type ServerMessage =
  | {
      type: "snapshot";
      serverTime: number;
      you: string;
      participants: RoomParticipant[];
    }
  | { type: "participantJoined"; serverTime: number; participant: RoomParticipant }
  | { type: "participantLeft"; serverTime: number; uid: string }
  | { type: "timerUpdated"; serverTime: number; uid: string; timer: Timer }
  | {
      type: "sessionCompleted";
      serverTime: number;
      uid: string;
      phase: Phase;
      durationMs: number;
    }
  | { type: "error"; serverTime: number; message: string };

export const MIN_PRESET_MS = 60_000;
export const MAX_PRESET_MS = 4 * 60 * 60_000;

const BARE_INTENTS = new Set(["start", "pause", "resume", "stop", "skip"]);
const PHASES = new Set<string>(["work", "break"]);

export function parseIntent(raw: unknown): Intent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { type } = raw as { type?: unknown };
  if (typeof type !== "string") return null;

  if (BARE_INTENTS.has(type)) {
    return { type } as Intent;
  }

  if (type === "setPreset") {
    const { phase, durationMs } = raw as {
      phase?: unknown;
      durationMs?: unknown;
    };
    if (typeof phase !== "string" || !PHASES.has(phase)) return null;
    if (
      typeof durationMs !== "number" ||
      !Number.isInteger(durationMs) ||
      durationMs < MIN_PRESET_MS ||
      durationMs > MAX_PRESET_MS
    ) {
      return null;
    }
    return { type, phase: phase as Phase, durationMs };
  }

  return null;
}
