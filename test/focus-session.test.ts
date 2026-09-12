import { env } from "cloudflare:workers";
import { env as testEnv } from "cloudflare:test";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { flushOutbox, insertFocusSession } from "../src/focus-session";

const row = { id: 1, uid: "u1", room_id: "r1", duration_seconds: 1500, completed_at: 1_700_000_000_000, attempts: 0 };

beforeAll(async () => {
  await testEnv.DB.exec(
    "CREATE TABLE IF NOT EXISTS focus_session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, room_id TEXT NOT NULL, duration_seconds INTEGER NOT NULL, completed_at TEXT NOT NULL)",
  );
});

async function clearFocusSession() {
  await testEnv.DB.exec("DELETE FROM focus_session");
}

describe("insertFocusSession", () => {
  beforeEach(clearFocusSession);

  it("writes a row to D1", async () => {
    expect(await insertFocusSession(row, testEnv)).toBe(true);
    const { results } = await testEnv.DB.prepare(
      "SELECT user_id, room_id, duration_seconds, completed_at FROM focus_session WHERE user_id = ?",
    )
      .bind("u1")
      .all();
    expect(results).toEqual([
      {
        user_id: "u1",
        room_id: "r1",
        duration_seconds: 1500,
        completed_at: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
  });

  it("returns false when D1 fails", async () => {
    await testEnv.DB.exec("DROP TABLE focus_session");
    try {
      expect(await insertFocusSession(row, testEnv)).toBe(false);
    } finally {
      await testEnv.DB.exec(
        "CREATE TABLE IF NOT EXISTS focus_session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, room_id TEXT NOT NULL, duration_seconds INTEGER NOT NULL, completed_at TEXT NOT NULL)",
      );
    }
  });
});

describe("flushOutbox", () => {
  beforeEach(clearFocusSession);

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
      const result = await flushOutbox(state.storage.sql, testEnv);
      expect(result).toEqual({ sent: 1, remaining: 0 });
      expect(count(state.storage.sql)).toBe(0);
    });
    const { results } = await testEnv.DB.prepare("SELECT user_id FROM focus_session WHERE user_id = ?")
      .bind("u1")
      .all();
    expect(results.length).toBe(1);
  });

  it("keeps rows and bumps attempts on failure", async () => {
    // Force insertFocusSession to fail by dropping the D1 target table.
    await testEnv.DB.exec("DROP TABLE focus_session");
    try {
      await runInDurableObject(env.RoomServer.getByName("flush-fail"), async (_i, state) => {
        seed(state.storage.sql);
        const result = await flushOutbox(state.storage.sql, testEnv);
        expect(result).toEqual({ sent: 0, remaining: 1 });
        const attempts = state.storage.sql
          .exec<{ attempts: number }>(`SELECT attempts FROM focus_session_outbox`)
          .one().attempts;
        expect(attempts).toBe(1);
      });
    } finally {
      await testEnv.DB.exec(
        "CREATE TABLE IF NOT EXISTS focus_session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, room_id TEXT NOT NULL, duration_seconds INTEGER NOT NULL, completed_at TEXT NOT NULL)",
      );
    }
  });

  it("drops rows that exhausted their attempts", async () => {
    await testEnv.DB.exec("DROP TABLE focus_session");
    try {
      await runInDurableObject(env.RoomServer.getByName("flush-drop"), async (_i, state) => {
        seed(state.storage.sql, 19);
        await flushOutbox(state.storage.sql, testEnv);
        expect(count(state.storage.sql)).toBe(0);
      });
    } finally {
      await testEnv.DB.exec(
        "CREATE TABLE IF NOT EXISTS focus_session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, room_id TEXT NOT NULL, duration_seconds INTEGER NOT NULL, completed_at TEXT NOT NULL)",
      );
    }
  });
});
