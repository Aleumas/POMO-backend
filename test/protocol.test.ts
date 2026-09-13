import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/protocol";

describe("parseIntent", () => {
  it("accepts the five bare intents", () => {
    for (const type of ["start", "pause", "resume", "stop", "skip"] as const) {
      expect(parseIntent({ type })).toEqual({ type });
    }
  });

  it("accepts a valid setPreset", () => {
    expect(
      parseIntent({ type: "setPreset", phase: "break", durationMs: 300_000 }),
    ).toEqual({ type: "setPreset", phase: "break", durationMs: 300_000 });
  });

  it("rejects out-of-range or non-integer presets", () => {
    expect(
      parseIntent({ type: "setPreset", phase: "work", durationMs: 59_999 }),
    ).toBeNull();
    expect(
      parseIntent({ type: "setPreset", phase: "work", durationMs: 14_400_001 }),
    ).toBeNull();
    expect(
      parseIntent({ type: "setPreset", phase: "work", durationMs: 60_000.5 }),
    ).toBeNull();
  });

  it("rejects unknown phases, unknown types and non-objects", () => {
    expect(
      parseIntent({ type: "setPreset", phase: "lunch", durationMs: 60_000 }),
    ).toBeNull();
    expect(parseIntent({ type: "explode" })).toBeNull();
    expect(parseIntent(null)).toBeNull();
    expect(parseIntent("start")).toBeNull();
  });
});
