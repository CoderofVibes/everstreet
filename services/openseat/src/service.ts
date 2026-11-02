// OpenSeat: finite-capacity classes with a waitlist, cancellation and automatic promotion.
//
// Customer rights (a booking reference and what it entitles) are stored here and never depend
// on who operates the business. Operator actions arrive as signed commands and pass the
// authority check against the business contract before anything changes. Every state change
// writes an outbox event in the same transaction.

import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Authority } from "./authority.ts";
import {
  ACTION_CAPABILITY,
  type OperatorAction,
  type SignedCommand,
  signatureValid,
} from "./command.ts";

export type BookingStatus = "confirmed" | "waitlisted" | "cancelled";

export interface ClassRow {
  id: string;
  studio: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  capacity: number;
}

export interface Booking {
  ref: string;
  class_id: string;
  status: BookingStatus;
  /** 1-based place in the waitlist while waitlisted. */
  position: number | null;
  booked_at: string;
  promoted_at: string | null;
  promoted_by: string | null;
  promoted_generation: number | null;
  cancelled_at: string | null;
  origin: "seeded" | "live";
}

export interface CommandOutcome {
  op_id: string;
  accepted: boolean;
  replayed: boolean;
  reason: string;
  result?: unknown;
  authority: { mode: string; owner?: string; generation?: number };
}

export interface Job {
  id: number;
  kind: "promote_waitlist";
  class_id: string;
  cause: string;
  status: "queued" | "blocked" | "done";
  attempts: number;
  last_error: string | null;
  done_by: string | null;
  done_generation: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY, studio TEXT NOT NULL, title TEXT NOT NULL, starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL, location TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity >= 0)
) STRICT;
CREATE TABLE IF NOT EXISTS bookings (
  ref TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), attendee TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed','waitlisted','cancelled')),
  seq INTEGER NOT NULL, booked_at TEXT NOT NULL, promoted_at TEXT, promoted_by TEXT,
  promoted_generation INTEGER, cancelled_at TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('seeded','live'))
) STRICT;
CREATE INDEX IF NOT EXISTS bookings_by_class ON bookings(class_id, status, seq);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, class_id TEXT NOT NULL, cause TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('queued','blocked','done')), attempts INTEGER NOT NULL,
  last_error TEXT, done_by TEXT, done_generation INTEGER, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS commands (
  op_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, action TEXT NOT NULL, generation INTEGER NOT NULL,
  accepted INTEGER NOT NULL, reason TEXT NOT NULL, result TEXT, at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL,
  at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
) STRICT;
`;

export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

function newRef(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `OS-${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export interface OpenSeatOptions {
  dbPath: string;
  authority: Authority;
  now?: () => Date;
}

export class OpenSeat {
  readonly db: DatabaseSync;
  readonly authority: Authority;
  private readonly now: () => Date;

  constructor(options: OpenSeatOptions) {
    this.db = new DatabaseSync(options.dbPath);
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
    );
    this.db.exec(SCHEMA);
    // Classes gained an owning studio after the first deployment; older files get the column.
    const cols = this.db.prepare("PRAGMA table_info(classes)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "studio_id"))
      this.db.exec("ALTER TABLE classes ADD COLUMN studio_id TEXT");
    this.authority = options.authority;
    this.now = options.now ?? (() => new Date());
  }

  private iso() {
    return this.now().toISOString();
  }

  /** Runs `fn` in one write transaction (BEGIN IMMEDIATE takes the write lock up front). */
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private emit(type: string, subject: string, payload: Record<string, unknown>) {
    this.db
      .prepare("INSERT INTO outbox (type, subject, payload, at) VALUES (?, ?, ?, ?)")
      .run(type, subject, JSON.stringify(payload), this.iso());
  }

  // ---------- catalog ----------

  addClass(c: ClassRow, studioId: string | null = null) {
    this.tx(() => {
      this.db
        .prepare(
          "INSERT INTO classes (id, studio, title, starts_at, ends_at, location, capacity, studio_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(c.id, c.studio, c.title, c.starts_at, c.ends_at, c.location, c.capacity, studioId);
      this.emit("class_published", c.id, { capacity: c.capacity, studio_id: studioId });
    });
  }

  // ---------- studios (OpenSeat's own customers) ----------

  /** A studio signs up and receives its API key once; only a hash is stored. */
  createStudio(name: string): { studio_id: string; api_key: string } {
    if (!name.trim()) throw new ServiceError(400, "Studio name is required");
    const studioId = `st_${randomBytes(6).toString("hex")}`;
    const apiKey = `osk_${randomBytes(24).toString("base64url")}`;
    this.db
      .prepare("INSERT INTO studios (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(studioId, name.trim().slice(0, 120), hashKey(apiKey), this.iso());
    this.emit("studio_created", studioId, {});
    return { studio_id: studioId, api_key: apiKey };
  }

  studioForKey(apiKey: string | undefined): { id: string; name: string } {
    const row = apiKey
      ? (this.db.prepare("SELECT id, name FROM studios WHERE key_hash = ?").get(hashKey(apiKey)) as
          | { id: string; name: string }
          | undefined)
      : undefined;
    if (!row) throw new ServiceError(403, "A valid studio API key is required");
    return row;
  }

  /** A studio publishes one session of a class. */
  publishClass(
    studio: { id: string; name: string },
    fields: {
      title: string;
      starts_at: string;
      ends_at: string;
      location: string;
      capacity: number;
    },
  ) {
    const capacity = Number(fields.capacity);
    if (!fields.title?.trim()) throw new ServiceError(400, "Title is required");
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500)
      throw new ServiceError(400, "Capacity is a whole number from 1 to 500");
    const start = Date.parse(fields.starts_at);
    const end = Date.parse(fields.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw new ServiceError(400, "Give a start and an end time, end after start");
    const id = `cls_${randomBytes(6).toString("hex")}`;
    this.addClass(
      {
        id,
        studio: studio.name,
        title: fields.title.trim().slice(0, 160),
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(end).toISOString(),
        location: (fields.location ?? "").trim().slice(0, 200),
        capacity,
      },
      studio.id,
    );
    return this.getClass(id);
  }

  /** Who is booked into one of the studio's own classes; never another studio's. */
  roster(studio: { id: string }, classId: string) {
    const c = this.db.prepare("SELECT studio_id FROM classes WHERE id = ?").get(classId) as
      | { studio_id: string | null }
      | undefined;
    if (!c || c.studio_id !== studio.id) throw new ServiceError(404, "No such class");
    return {
      class: this.getClass(classId),
      attendees: this.db
        .prepare(
          "SELECT attendee, status, booked_at, promoted_at, promoted_by, promoted_generation, cancelled_at FROM bookings WHERE class_id = ? ORDER BY status = 'cancelled', status = 'waitlisted', seq",
        )
        .all(classId),
    };
  }

  getClass(id: string): ClassRow & { confirmed: number; waitlisted: number; seats_left: number } {
    const c = this.db.prepare("SELECT * FROM classes WHERE id = ?").get(id) as ClassRow | undefined;
    if (!c) throw new ServiceError(404, "No such class");
    const counts = this.counts(id);
    return { ...c, ...counts, seats_left: Math.max(0, c.capacity - counts.confirmed) };
  }

  private counts(classId: string) {
    const row = this.db
      .prepare(
        "SELECT SUM(status = 'confirmed') AS confirmed, SUM(status = 'waitlisted') AS waitlisted FROM bookings WHERE class_id = ?",
      )
      .get(classId) as { confirmed: number | null; waitlisted: number | null };
    return { confirmed: row.confirmed ?? 0, waitlisted: row.waitlisted ?? 0 };
  }

  // ---------- customer actions (a customer's own rights; no operator involved) ----------

  /**
   * Books a seat, or a waitlist place when the class is full or others are already waiting.
   * The capacity check and the insert share one write transaction, so two attendees racing
   * for the last seat get one seat and one truthful waitlist place.
   */
  book(classId: string, attendee: string, origin: "seeded" | "live" = "live"): Booking {
    if (!attendee.trim()) throw new ServiceError(400, "Name is required");
    const ref = this.tx(() => {
      const c = this.getClass(classId);
      const status: BookingStatus =
        c.confirmed < c.capacity && c.waitlisted === 0 ? "confirmed" : "waitlisted";
      const seq = (
        this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM bookings").get() as {
          n: number;
        }
      ).n;
      const ref = newRef();
      this.db
        .prepare(
          "INSERT INTO bookings (ref, class_id, attendee, status, seq, booked_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(ref, classId, attendee.trim(), status, seq, this.iso(), origin);
      this.emit(status === "confirmed" ? "booking_confirmed" : "waitlist_joined", ref, {
        class_id: classId,
      });
      return ref;
    });
    return this.booking(ref);
  }

  booking(ref: string): Booking {
    const row = this.db.prepare("SELECT * FROM bookings WHERE ref = ?").get(ref) as
      | (Omit<Booking, "position"> & { seq: number; attendee: string })
      | undefined;
    if (!row) throw new ServiceError(404, "No booking with that reference");
    let position: number | null = null;
    if (row.status === "waitlisted") {
      position = (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM bookings WHERE class_id = ? AND status = 'waitlisted' AND seq <= ?",
          )
          .get(row.class_id, row.seq) as { n: number }
      ).n;
    }
    return {
      ref: row.ref,
      class_id: row.class_id,
      status: row.status,
      position,
      booked_at: row.booked_at,
      promoted_at: row.promoted_at,
      promoted_by: row.promoted_by,
      promoted_generation: row.promoted_generation,
      cancelled_at: row.cancelled_at,
      origin: row.origin,
    };
  }

  /**
   * The customer gives up their seat or place. Freeing a confirmed seat queues one promotion
   * job keyed by the cancellation, so a redelivered cancel never queues a second one.
   */
  cancel(ref: string): Booking {
    this.tx(() => {
      const b = this.booking(ref);
      if (b.status === "cancelled") return;
      this.db
        .prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE ref = ?")
        .run(this.iso(), ref);
      this.emit("attendee_cancelled", ref, { class_id: b.class_id, was: b.status });
      if (b.status === "confirmed") {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO jobs (kind, class_id, cause, status, attempts, created_at) VALUES ('promote_waitlist', ?, ?, 'queued', 0, ?)",
          )
          .run(b.class_id, `cancel:${ref}`, this.iso());
      }
    });
    return this.booking(ref);
  }

  /** An iCalendar file for a confirmed seat; nothing for anything else. */
  calendar(ref: string): string {
    const b = this.booking(ref);
    if (b.status !== "confirmed") throw new ServiceError(409, `This booking is ${b.status}`);
    const c = this.getClass(b.class_id);
    const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OpenSeat//Booking//EN",
      "BEGIN:VEVENT",
      `UID:${b.ref}@openseat`,
      `DTSTAMP:${stamp(this.iso())}`,
      `DTSTART:${stamp(c.starts_at)}`,
      `DTEND:${stamp(c.ends_at)}`,
      `SUMMARY:${c.title} (${c.studio})`,
      `LOCATION:${c.location}`,
      `DESCRIPTION:Booking reference ${b.ref}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
  }

  // ---------- operator actions ----------

  jobs(): Job[] {
    return this.db.prepare("SELECT * FROM jobs ORDER BY id").all() as unknown as Job[];
  }

  pendingJobs(): Job[] {
    return this.db
      .prepare("SELECT * FROM jobs WHERE status != 'done' ORDER BY id")
      .all() as unknown as Job[];
  }

  markJob(id: number, status: "blocked" | "queued", error: string) {
    this.db
      .prepare("UPDATE jobs SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?")
      .run(status, error, id);
  }

  notifications(ref?: string) {
    const sql = ref
      ? "SELECT * FROM notifications WHERE ref = ? ORDER BY id"
      : "SELECT * FROM notifications ORDER BY id";
    return (ref ? this.db.prepare(sql).all(ref) : this.db.prepare(sql).all()) as unknown as {
      ref: string;
      kind: string;
    }[];
  }

  commandLog() {
    return this.db.prepare("SELECT * FROM commands ORDER BY at, op_id").all();
  }

  outbox() {
    return this.db.prepare("SELECT * FROM outbox ORDER BY id").all();
  }

  setting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  /**
   * Verifies and runs one signed operator command. Refusals are recorded with their reason;
   * a replayed op_id returns the first outcome and runs nothing.
   */
  async execute(signed: SignedCommand): Promise<CommandOutcome> {
    const { command } = signed;
    const base = {
      op_id: command.op_id,
      replayed: false,
      authority: { mode: this.authority.mode },
    };
    const previous = this.db.prepare("SELECT * FROM commands WHERE op_id = ?").get(command.op_id) as
      | { accepted: number; reason: string; result: string | null }
      | undefined;
    if (previous) {
      return {
        ...base,
        replayed: true,
        accepted: previous.accepted === 1,
        reason: previous.reason,
        result: previous.result ? JSON.parse(previous.result) : undefined,
      };
    }

    const refuse = (reason: string, authority = base.authority): CommandOutcome => {
      this.record(command, false, reason);
      return { ...base, authority, accepted: false, reason };
    };

    const capability = ACTION_CAPABILITY[command.action as OperatorAction];
    if (!capability) return refuse(`unknown action ${command.action}`);
    if (command.business !== this.authority.business)
      return refuse(`command is for ${command.business}, not ${this.authority.business}`);
    if (!signatureValid(signed)) return refuse("signature does not verify");
    if (!(Date.parse(command.expires_at) > this.now().getTime()))
      return refuse("command has expired");
    if (!(await this.authority.keyBelongs(command.account_id, command.public_key)))
      return refuse(`key is not an access key of ${command.account_id} for this business`);
    const check = await this.authority.operatorCheck(command.account_id, capability);
    const authority = {
      mode: this.authority.mode,
      owner: check.owner,
      generation: check.generation,
    };
    if (!check.authorized) return refuse(`not authorized: ${check.reason}`, authority);
    if (command.generation !== check.generation)
      return refuse(
        `signed for generation ${command.generation}; control is at generation ${check.generation}`,
        authority,
      );

    try {
      const result = this.tx(() => {
        const out = this.run(command.action as OperatorAction, command.args, {
          accountId: command.account_id,
          generation: check.generation,
        });
        this.record(command, true, `authorized as ${check.reason}`, out);
        return out;
      });
      return {
        ...base,
        authority,
        accepted: true,
        reason: `authorized as ${check.reason}`,
        result,
      };
    } catch (error) {
      if (error instanceof ServiceError) return refuse(error.message, authority);
      throw error;
    }
  }

  private record(
    command: SignedCommand["command"],
    accepted: boolean,
    reason: string,
    result?: unknown,
  ) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO commands (op_id, account_id, action, generation, accepted, reason, result, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        command.op_id,
        command.account_id,
        command.action,
        command.generation,
        accepted ? 1 : 0,
        reason,
        result === undefined ? null : JSON.stringify(result),
        this.iso(),
      );
  }

  private run(
    action: OperatorAction,
    args: Record<string, unknown>,
    by: { accountId: string; generation: number },
  ): unknown {
    switch (action) {
      case "promote_waitlist":
        return this.promote(Number(args.job_id), by);
      case "set_capacity": {
        const classId = String(args.class_id);
        const capacity = Number(args.capacity);
        if (!Number.isInteger(capacity) || capacity < 0)
          throw new ServiceError(400, "capacity is a whole number");
        this.getClass(classId);
        this.db.prepare("UPDATE classes SET capacity = ? WHERE id = ?").run(capacity, classId);
        this.emit("capacity_changed", classId, { capacity, by: by.accountId });
        return { class_id: classId, capacity };
      }
      case "publish_release": {
        const version = String(args.version);
        this.db
          .prepare(
            "INSERT INTO settings (key, value) VALUES ('release', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .run(version);
        this.emit("release_published", version, { by: by.accountId, generation: by.generation });
        return { release: version };
      }
    }
  }

  /** Gives the freed seat to the first person waiting, exactly once per job. */
  private promote(jobId: number, by: { accountId: string; generation: number }) {
    const job = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
    if (!job) throw new ServiceError(404, "No such job");
    if (job.status === "done") return { job_id: jobId, promoted: null, note: "already done" };
    const c = this.getClass(job.class_id);
    let promoted: string | null = null;
    if (c.confirmed < c.capacity) {
      const next = this.db
        .prepare(
          "SELECT ref FROM bookings WHERE class_id = ? AND status = 'waitlisted' ORDER BY seq LIMIT 1",
        )
        .get(job.class_id) as { ref: string } | undefined;
      if (next) {
        promoted = next.ref;
        this.db
          .prepare(
            "UPDATE bookings SET status = 'confirmed', promoted_at = ?, promoted_by = ?, promoted_generation = ? WHERE ref = ?",
          )
          .run(this.iso(), by.accountId, by.generation, next.ref);
        this.db
          .prepare(
            "INSERT OR IGNORE INTO notifications (ref, kind, dedupe_key, at) VALUES (?, 'seat_confirmed', ?, ?)",
          )
          .run(next.ref, `promoted:${next.ref}`, this.iso());
        this.emit("attendee_promoted", next.ref, {
          class_id: job.class_id,
          by: by.accountId,
          generation: by.generation,
          cause: job.cause,
        });
      }
    }
    this.db
      .prepare(
        "UPDATE jobs SET status = 'done', attempts = attempts + 1, last_error = NULL, done_by = ?, done_generation = ? WHERE id = ?",
      )
      .run(by.accountId, by.generation, jobId);
    return { job_id: jobId, promoted };
  }

  close() {
    this.db.close();
  }
}

function hashKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}
