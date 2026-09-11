import { describe, expect, it } from "vitest";
import { DEFAULT_TIMER, applyIntent, completeIfDue } from "../src/timer";

const T0 = 1_000_000;

describe("applyIntent", () => {
  it("start sets endsAt from remainingMs", () => {
    const next = applyIntent(DEFAULT_TIMER, { type: "start" }, T0);
    expect(next.status).toBe("running");
    expect(next.endsAt).toBe(T0 + 25 * 60_000);
  });

  it("pause freezes remainingMs and clears endsAt", () => {
    const running = applyIntent(DEFAULT_TIMER, { type: "start" }, T0);
    const paused = applyIntent(running, { type: "pause" }, T0 + 60_000);
    expect(paused.status).toBe("paused");
    expect(paused.remainingMs).toBe(24 * 60_000);
    expect(paused.endsAt).toBeNull();
  });

  it("resume continues from the frozen remainingMs", () => {
    const running = applyIntent(DEFAULT_TIMER, { type: "start" }, T0);
    const paused = applyIntent(running, { type: "pause" }, T0 + 60_000);
    const resumed = applyIntent(paused, { type: "resume" }, T0 + 90_000);
    expect(resumed.status).toBe("running");
    expect(resumed.endsAt).toBe(T0 + 90_000 + 24 * 60_000);
  });

  it("stop resets to the phase duration", () => {
    const running = applyIntent(DEFAULT_TIMER, { type: "start" }, T0);
    const stopped = applyIntent(running, { type: "stop" }, T0 + 5_000);
    expect(stopped).toMatchObject({
      status: "idle",
      remainingMs: 25 * 60_000,
      endsAt: null,
    });
  });

  it("setPreset while idle updates the matching phase and current duration", () => {
    const next = applyIntent(
      DEFAULT_TIMER,
      { type: "setPreset", phase: "work", durationMs: 45 * 60_000 },
      T0,
    );
    expect(next.workDurationMs).toBe(45 * 60_000);
    expect(next.durationMs).toBe(45 * 60_000);
    expect(next.remainingMs).toBe(45 * 60_000);

    const other = applyIntent(
      DEFAULT_TIMER,
      { type: "setPreset", phase: "break", durationMs: 10 * 60_000 },
      T0,
    );
    expect(other.breakDurationMs).toBe(10 * 60_000);
    expect(other.durationMs).toBe(25 * 60_000);
  });

  it("returns the same reference for invalid transitions", () => {
    expect(applyIntent(DEFAULT_TIMER, { type: "pause" }, T0)).toBe(DEFAULT_TIMER);
    expect(applyIntent(DEFAULT_TIMER, { type: "resume" }, T0)).toBe(DEFAULT_TIMER);
    expect(applyIntent(DEFAULT_TIMER, { type: "stop" }, T0)).toBe(DEFAULT_TIMER);
    const running = applyIntent(DEFAULT_TIMER, { type: "start" }, T0);
    expect(applyIntent(running, { type: "start" }, T0)).toBe(running);
    expect(
      applyIntent(
        running,
        { type: "setPreset", phase: "work", durationMs: 60_000 },
        T0,
      ),
    ).toBe(running);
  });
});

describe("completeIfDue", () => {
  it("returns null when idle or not yet due", () => {
    expect(completeIfDue(DEFAULT_TIMER, T0)).toBeNull();
    const running = applyIntent(DEFAULT_TIMER, { type: "start" }, T0);
    expect(completeIfDue(running, T0 + 1)).toBeNull();
  });

  it("flips work → break idle and reports the completed phase", () => {
    const running = applyIntent(DEFAULT_TIMER, { type: "start" }, T0);
    const result = completeIfDue(running, T0 + 25 * 60_000);
    expect(result?.completed).toEqual({ phase: "work", durationMs: 25 * 60_000 });
    expect(result?.timer).toMatchObject({
      phase: "break",
      status: "idle",
      durationMs: 5 * 60_000,
      remainingMs: 5 * 60_000,
      endsAt: null,
    });
  });

  it("flips break → work idle", () => {
    const onBreak = { ...DEFAULT_TIMER, phase: "break" as const, durationMs: 300_000, remainingMs: 300_000 };
    const running = applyIntent(onBreak, { type: "start" }, T0);
    const result = completeIfDue(running, T0 + 300_000);
    expect(result?.completed.phase).toBe("break");
    expect(result?.timer).toMatchObject({ phase: "work", status: "idle", durationMs: 25 * 60_000 });
  });
});
