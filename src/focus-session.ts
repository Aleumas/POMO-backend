export interface OutboxRow {
  [key: string]: string | number | null;
  id: number;
  uid: string;
  room_id: string;
  duration_seconds: number;
  completed_at: number;
  attempts: number;
}

// Structural interface, not `Pick<Env, ...>`: Wrangler's generated `Env` types `vars` as
// string literals, so `Pick<Env, ...>` rejects plain `{ SUPABASE_URL: string, ... }` test
// objects and breaks `npm run typecheck`. This interface is structurally satisfied by `Env`.
export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

export const MAX_ATTEMPTS = 20;
export const OUTBOX_RETRY_MS = 30_000;

export async function insertFocusSession(row: OutboxRow, env: SupabaseEnv): Promise<boolean> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/focus_session`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: row.uid,
        room_id: row.room_id,
        duration_seconds: row.duration_seconds,
        completed_at: new Date(row.completed_at).toISOString(),
      }),
    });
    if (!res.ok) {
      console.error("focus_session insert failed", res.status, await res.text());
    }
    return res.ok;
  } catch (error) {
    console.error("focus_session insert threw", error);
    return false;
  }
}

export async function flushOutbox(
  sql: SqlStorage,
  env: SupabaseEnv,
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
