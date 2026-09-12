export interface OutboxRow {
  [key: string]: string | number | null;
  id: number;
  uid: string;
  room_id: string;
  duration_seconds: number;
  completed_at: number;
  attempts: number;
}

export interface FocusDbEnv {
  DB: D1Database;
}

export const MAX_ATTEMPTS = 20;
export const OUTBOX_RETRY_MS = 30_000;

export async function insertFocusSession(row: OutboxRow, env: FocusDbEnv): Promise<boolean> {
  try {
    await env.DB.prepare(
      `INSERT INTO focus_session (id, user_id, room_id, duration_seconds, completed_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        row.uid,
        row.room_id,
        row.duration_seconds,
        new Date(row.completed_at).toISOString(),
      )
      .run();
    return true;
  } catch (error) {
    console.error("focus_session insert threw", error);
    return false;
  }
}

export async function flushOutbox(
  sql: SqlStorage,
  env: FocusDbEnv,
): Promise<{ sent: number; remaining: number }> {
  const rows = sql.exec<OutboxRow>(`SELECT * FROM focus_session_outbox ORDER BY id`).toArray();
  let sent = 0;
  for (const row of rows) {
    const ok = await insertFocusSession(row, env);
    if (ok) {
      sql.exec(`DELETE FROM focus_session_outbox WHERE id = ?`, row.id);
      sent += 1;
    } else if (row.attempts + 1 >= MAX_ATTEMPTS) {
      console.error("dropping focus_session outbox row after max attempts", row.id);
      sql.exec(`DELETE FROM focus_session_outbox WHERE id = ?`, row.id);
    } else {
      sql.exec(`UPDATE focus_session_outbox SET attempts = attempts + 1 WHERE id = ?`, row.id);
    }
  }
  const remaining = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM focus_session_outbox`).one().n;
  return { sent, remaining };
}
