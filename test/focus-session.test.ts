import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushOutbox, insertFocusSession } from "../src/focus-session";
import { installSupabaseStub, type SupabaseStub } from "./helpers";

const supaEnv = { SUPABASE_URL: "https://supabase.test", SUPABASE_SECRET_KEY: "sk_test" };
const row = { id: 1, uid: "u1", room_id: "r1", duration_seconds: 1500, completed_at: 1_700_000_000_000, attempts: 0 };

describe("insertFocusSession", () => {
  let stub: SupabaseStub;
  beforeEach(() => {
    stub = installSupabaseStub();
  });
  afterEach(() => stub.restore());

  it("posts the row with the secret key on the apikey header", async () => {
    expect(await insertFocusSession(row, supaEnv)).toBe(true);
    expect(stub.focusSessions).toEqual([
      {
        user_id: "u1",
        room_id: "r1",
        duration_seconds: 1500,
        completed_at: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)!;
    const headers = new Headers((call[1] as RequestInit).headers);
    expect(headers.get("apikey")).toBe("sk_test");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("returns false when Supabase fails", async () => {
    stub.failInserts = true;
    expect(await insertFocusSession(row, supaEnv)).toBe(false);
  });
});

describe("flushOutbox", () => {
  let stub: SupabaseStub;
  beforeEach(() => {
    stub = installSupabaseStub();
  });
  afterEach(() => stub.restore());

  const seed = (sql: SqlStorage, attempts = 0) => {
    sql.exec(`CREATE TABLE IF NOT EXISTS focus_session_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, room_id TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL, completed_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)`);
    sql.exec(
      `INSERT INTO focus_session_outbox (uid, room_id, duration_seconds, completed_at, attempts) VALUES ('u1','r1',1500,1700000000000,?)`,
      attempts,
    );
  };
  const count = (sql: SqlStorage) =>
    sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM focus_session_outbox`).one().n;

  it("deletes rows after a successful insert", async () => {
    await runInDurableObject(env.RoomServer.getByName("flush-ok"), async (_i, state) => {
      seed(state.storage.sql);
      const result = await flushOutbox(state.storage.sql, supaEnv);
      expect(result).toEqual({ sent: 1, remaining: 0 });
      expect(count(state.storage.sql)).toBe(0);
    });
    expect(stub.focusSessions).toHaveLength(1);
  });

  it("keeps rows and bumps attempts on failure", async () => {
    stub.failInserts = true;
    await runInDurableObject(env.RoomServer.getByName("flush-fail"), async (_i, state) => {
      seed(state.storage.sql);
      const result = await flushOutbox(state.storage.sql, supaEnv);
      expect(result).toEqual({ sent: 0, remaining: 1 });
      const attempts = state.storage.sql.exec<{ attempts: number }>(`SELECT attempts FROM focus_session_outbox`).one().attempts;
      expect(attempts).toBe(1);
    });
  });

  it("drops rows that exhausted their attempts", async () => {
    stub.failInserts = true;
    await runInDurableObject(env.RoomServer.getByName("flush-drop"), async (_i, state) => {
      seed(state.storage.sql, 19);
      await flushOutbox(state.storage.sql, supaEnv);
      expect(count(state.storage.sql)).toBe(0);
    });
  });
});
