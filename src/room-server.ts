import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import { parseIntent, type RoomParticipant, type ServerMessage, type Timer } from "./protocol";
import { DEFAULT_TIMER, applyIntent, completeIfDue } from "./timer";

export const LEAVE_GRACE_MS = 15_000;

interface ParticipantRow {
  [key: string]: string | number | null;
  uid: string;
  display_name: string;
  avatar: string;
  connection_id: string | null;
  left_at: number | null;
  timer: string;
}

type ConnState = { uid: string };

const toParticipant = (row: ParticipantRow): RoomParticipant => ({
  uid: row.uid,
  displayName: row.display_name,
  avatar: row.avatar,
  timer: JSON.parse(row.timer) as Timer,
});

export class RoomServer extends Server<Env> {
  static options = { hibernate: true };

  onStart() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS participants (
        uid TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        avatar TEXT NOT NULL,
        connection_id TEXT,
        left_at INTEGER,
        timer TEXT NOT NULL
      )`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS focus_session_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        room_id TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      )`);
  }

  async onConnect(connection: Connection<ConnState>, ctx: ConnectionContext) {
    const uid = ctx.request.headers.get("x-user-id");
    if (!uid) {
      connection.close(4401, "unauthorized");
      return;
    }
    const params = new URL(ctx.request.url).searchParams;
    const displayName =
      (params.get("displayName") ?? "").trim().slice(0, 50) || "user";
    const avatar = (params.get("avatar") ?? "").slice(0, 500);

    const existing = this.getRow(uid);
    if (existing) {
      this.ctx.storage.sql.exec(
        `UPDATE participants SET display_name = ?, avatar = ?, connection_id = ?, left_at = NULL WHERE uid = ?`,
        displayName,
        avatar,
        connection.id,
        uid,
      );
    } else {
      this.ctx.storage.sql.exec(
        `INSERT INTO participants (uid, display_name, avatar, connection_id, left_at, timer) VALUES (?, ?, ?, ?, NULL, ?)`,
        uid,
        displayName,
        avatar,
        connection.id,
        JSON.stringify(DEFAULT_TIMER),
      );
    }
    connection.setState({ uid });

    const now = Date.now();
    this.sendTo(connection, {
      type: "snapshot",
      serverTime: now,
      you: uid,
      participants: this.listParticipants(),
    });
    this.broadcastMessage(
      { type: "participantJoined", serverTime: now, participant: toParticipant(this.getRow(uid)!) },
      [connection.id],
    );

    if (existing?.connection_id && existing.connection_id !== connection.id) {
      this.getConnection(existing.connection_id)?.close(4000, "replaced by a newer connection");
    }
    await this.scheduleAlarm();
  }

  async onMessage(connection: Connection<ConnState>, message: WSMessage) {
    const uid = connection.state?.uid;
    if (!uid) return;

    let raw: unknown = null;
    try {
      raw = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      raw = null;
    }
    const intent = parseIntent(raw);
    if (!intent) {
      this.sendTo(connection, { type: "error", serverTime: Date.now(), message: "invalid message" });
      return;
    }

    const row = this.getRow(uid);
    if (!row) return;
    const timer = JSON.parse(row.timer) as Timer;
    const now = Date.now();
    const next = applyIntent(timer, intent, now);
    if (next === timer) return;

    this.ctx.storage.sql.exec(`UPDATE participants SET timer = ? WHERE uid = ?`, JSON.stringify(next), uid);
    this.broadcastMessage({ type: "timerUpdated", serverTime: now, uid, timer: next });
    await this.scheduleAlarm();
  }

  async onClose(connection: Connection<ConnState>) {
    const uid = connection.state?.uid;
    if (!uid) return;
    const result = this.ctx.storage.sql.exec(
      `UPDATE participants SET left_at = ?, connection_id = NULL WHERE uid = ? AND connection_id = ?`,
      Date.now(),
      uid,
      connection.id,
    );
    if (result.rowsWritten > 0) {
      await this.scheduleAlarm();
    }
  }

  async onAlarm() {
    const now = Date.now();

    for (const row of this.allRows()) {
      const timer = JSON.parse(row.timer) as Timer;
      const done = completeIfDue(timer, now);
      if (!done) continue;
      this.ctx.storage.sql.exec(`UPDATE participants SET timer = ? WHERE uid = ?`, JSON.stringify(done.timer), row.uid);
      if (done.completed.phase === "work") {
        this.ctx.storage.sql.exec(
          `INSERT INTO focus_session_outbox (uid, room_id, duration_seconds, completed_at) VALUES (?, ?, ?, ?)`,
          row.uid,
          this.name,
          Math.round(done.completed.durationMs / 1000),
          now,
        );
      }
      this.broadcastMessage({ type: "timerUpdated", serverTime: now, uid: row.uid, timer: done.timer });
      this.broadcastMessage({
        type: "sessionCompleted",
        serverTime: now,
        uid: row.uid,
        phase: done.completed.phase,
        durationMs: done.completed.durationMs,
      });
    }

    const gone = this.ctx.storage.sql
      .exec<{ uid: string }>(
        `DELETE FROM participants WHERE left_at IS NOT NULL AND left_at <= ? RETURNING uid`,
        now - LEAVE_GRACE_MS,
      )
      .toArray();
    for (const { uid } of gone) {
      this.broadcastMessage({ type: "participantLeft", serverTime: now, uid });
    }

    await this.scheduleAlarm();
  }

  protected getRow(uid: string): ParticipantRow | undefined {
    return this.ctx.storage.sql
      .exec<ParticipantRow>(`SELECT * FROM participants WHERE uid = ?`, uid)
      .toArray()[0];
  }

  protected allRows(): ParticipantRow[] {
    return this.ctx.storage.sql
      .exec<ParticipantRow>(`SELECT * FROM participants ORDER BY rowid`)
      .toArray();
  }

  protected listParticipants(): RoomParticipant[] {
    return this.allRows().map(toParticipant);
  }

  protected sendTo(connection: Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }

  protected broadcastMessage(message: ServerMessage, without?: string[]) {
    this.broadcast(JSON.stringify(message), without);
  }

  protected nextAlarmAt(now: number): number | null {
    let next: number | null = null;
    const consider = (t: number | null) => {
      if (t !== null && (next === null || t < next)) next = t;
    };
    for (const row of this.allRows()) {
      const timer = JSON.parse(row.timer) as Timer;
      if (timer.status === "running") consider(timer.endsAt);
      if (row.left_at !== null) consider(row.left_at + LEAVE_GRACE_MS);
    }
    return next;
  }

  protected async scheduleAlarm() {
    const next = this.nextAlarmAt(Date.now());
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }
}
