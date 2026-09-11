import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "../src/protocol";
import { installSupabaseStub, type SupabaseStub } from "./helpers";

export async function connect(room: string, uid: string, displayName = uid) {
  const res = await exports.default.fetch(
    `http://example.com/parties/room-server/${room}?_pk=${uid}-${crypto.randomUUID()}&token=tok-${uid}&displayName=${displayName}&avatar=`,
    { headers: { Upgrade: "websocket", Origin: "http://localhost:3001" } },
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const messages: ServerMessage[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data as string) as ServerMessage);
  });
  ws.accept();
  return { ws, messages, send: (obj: unknown) => ws.send(JSON.stringify(obj)) };
}

export const waitForType = (messages: ServerMessage[], type: ServerMessage["type"], count = 1) =>
  vi.waitFor(() => {
    expect(messages.filter((m) => m.type === type).length).toBeGreaterThanOrEqual(count);
  });

export const lastOfType = <T extends ServerMessage["type"]>(messages: ServerMessage[], type: T) =>
  [...messages].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }>;

// The DO processes a client close asynchronously; wait until it has marked the row.
export const waitForLeftAt = (room: string, uid: string) =>
  vi.waitFor(async () => {
    await runInDurableObject(env.RoomServer.getByName(room), (_instance, state) => {
      const row = state.storage.sql
        .exec<{ left_at: number | null }>(`SELECT left_at FROM participants WHERE uid = ?`, uid)
        .toArray()[0];
      expect(row?.left_at).not.toBeNull();
    });
  });

describe("RoomServer presence", () => {
  let stub: SupabaseStub;
  beforeEach(() => {
    stub = installSupabaseStub();
  });
  afterEach(() => {
    stub.restore();
    vi.useRealTimers();
  });

  it("sends a snapshot on connect with yourself in it", async () => {
    const a = await connect("room-a", "alice", "Alice");
    await waitForType(a.messages, "snapshot");
    const snap = lastOfType(a.messages, "snapshot");
    expect(snap.you).toBe("alice");
    expect(snap.participants.map((p) => p.uid)).toEqual(["alice"]);
    expect(snap.participants[0].displayName).toBe("Alice");
    expect(snap.participants[0].timer.status).toBe("idle");
    expect(typeof snap.serverTime).toBe("number");
  });

  it("tells existing members when someone joins and includes them in later snapshots", async () => {
    const a = await connect("room-b", "alice");
    await waitForType(a.messages, "snapshot");
    const b = await connect("room-b", "bob", "Bob");
    await waitForType(b.messages, "snapshot");
    await waitForType(a.messages, "participantJoined");
    expect(lastOfType(a.messages, "participantJoined").participant.displayName).toBe("Bob");
    expect(lastOfType(b.messages, "snapshot").participants.map((p) => p.uid).sort()).toEqual(["alice", "bob"]);
  });

  it("removes a participant only after the leave grace expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = await connect("room-c", "alice");
    const b = await connect("room-c", "bob");
    await waitForType(a.messages, "participantJoined");

    b.ws.close(1000, "bye");
    await waitForLeftAt("room-c", "bob");
    const stubRoom = env.RoomServer.getByName("room-c");

    vi.setSystemTime(Date.now() + 5_000);
    expect(await runDurableObjectAlarm(stubRoom)).toBe(true);
    expect(a.messages.some((m) => m.type === "participantLeft")).toBe(false);

    vi.setSystemTime(Date.now() + 15_000);
    expect(await runDurableObjectAlarm(stubRoom)).toBe(true);
    await waitForType(a.messages, "participantLeft");
    expect(lastOfType(a.messages, "participantLeft").uid).toBe("bob");
  });

  it("keeps a participant who reconnects within the grace period", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = await connect("room-d", "alice");
    const b1 = await connect("room-d", "bob");
    await waitForType(a.messages, "participantJoined");
    b1.ws.close(1000, "tab closed");
    await waitForLeftAt("room-d", "bob");

    vi.setSystemTime(Date.now() + 2_000);
    const b2 = await connect("room-d", "bob");
    await waitForType(b2.messages, "snapshot");

    vi.setSystemTime(Date.now() + 30_000);
    await runDurableObjectAlarm(env.RoomServer.getByName("room-d"));
    expect(a.messages.some((m) => m.type === "participantLeft")).toBe(false);
  });

  it("closes the previous connection when the same uid reconnects while still open", async () => {
    const a = await connect("room-e", "alice");
    await waitForType(a.messages, "snapshot");

    let closeCode: number | undefined;
    a.ws.addEventListener("close", (e) => {
      closeCode = e.code;
    });

    const b = await connect("room-e", "alice");
    await waitForType(b.messages, "snapshot");

    await vi.waitFor(() => {
      expect(closeCode).toBe(4000);
    });
  });
});

describe("RoomServer timers", () => {
  let stub: SupabaseStub;
  beforeEach(() => {
    stub = installSupabaseStub();
  });
  afterEach(() => {
    stub.restore();
    vi.useRealTimers();
  });

  it("broadcasts timerUpdated to everyone (including the sender) on start", async () => {
    const a = await connect("room-t1", "alice");
    const b = await connect("room-t1", "bob");
    await waitForType(a.messages, "participantJoined");

    a.send({ type: "start" });
    await waitForType(a.messages, "timerUpdated");
    await waitForType(b.messages, "timerUpdated");
    const update = lastOfType(b.messages, "timerUpdated");
    expect(update.uid).toBe("alice");
    expect(update.timer.status).toBe("running");
    expect(update.timer.endsAt).toBeGreaterThan(update.serverTime);
  });

  it("answers invalid messages with an error and no broadcast", async () => {
    const a = await connect("room-t2", "alice");
    await waitForType(a.messages, "snapshot");
    a.send({ type: "teleport" });
    await waitForType(a.messages, "error");
    expect(a.messages.some((m) => m.type === "timerUpdated")).toBe(false);
  });

  it("completes a due work timer, flips to break, and queues a focus session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = await connect("room-t3", "alice");
    const b = await connect("room-t3", "bob");
    await waitForType(a.messages, "participantJoined");

    a.send({ type: "setPreset", phase: "work", durationMs: 60_000 });
    await waitForType(a.messages, "timerUpdated");
    a.send({ type: "start" });
    await waitForType(a.messages, "timerUpdated", 2);

    const room = env.RoomServer.getByName("room-t3");
    vi.setSystemTime(Date.now() + 61_000);
    expect(await runDurableObjectAlarm(room)).toBe(true);

    await waitForType(b.messages, "sessionCompleted");
    const done = lastOfType(b.messages, "sessionCompleted");
    expect(done).toMatchObject({ uid: "alice", phase: "work", durationMs: 60_000 });
    const after = lastOfType(b.messages, "timerUpdated");
    expect(after.timer).toMatchObject({ phase: "break", status: "idle", remainingMs: 5 * 60_000 });

    await runInDurableObject(room, (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ uid: string; room_id: string; duration_seconds: number }>(
          `SELECT uid, room_id, duration_seconds FROM focus_session_outbox`,
        )
        .toArray();
      expect(rows).toEqual([{ uid: "alice", room_id: "room-t3", duration_seconds: 60 }]);
    });
  });

  it("does not queue a focus session for a completed break", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = await connect("room-t4", "alice");
    await waitForType(a.messages, "snapshot");
    const room = env.RoomServer.getByName("room-t4");

    a.send({ type: "setPreset", phase: "work", durationMs: 60_000 });
    a.send({ type: "start" });
    await waitForType(a.messages, "timerUpdated", 2);
    vi.setSystemTime(Date.now() + 61_000);
    await runDurableObjectAlarm(room);
    await waitForType(a.messages, "sessionCompleted");

    a.send({ type: "setPreset", phase: "break", durationMs: 60_000 });
    a.send({ type: "start" });
    await waitForType(a.messages, "timerUpdated", 5);
    vi.setSystemTime(Date.now() + 61_000);
    await runDurableObjectAlarm(room);
    await waitForType(a.messages, "sessionCompleted", 2);

    await runInDurableObject(room, (_instance, state) => {
      const count = state.storage.sql
        .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM focus_session_outbox`)
        .one().n;
      expect(count).toBe(1);
    });
  });
});
