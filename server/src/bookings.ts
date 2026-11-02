// Real class bookings. Everstreet does not keep seats itself: a class business connects to
// OpenSeat (the booking service), publishes sessions through OpenSeat's studio API, and books
// customers through OpenSeat's public API. OpenSeat owns capacity, the waitlist and promotion;
// the customer's booking reference is theirs and is never shown in public pages or logs.

import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export interface ClassInfo {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  capacity: number;
  seats_left: number;
  waitlisted: number;
}

export interface BookingInfo {
  ref: string;
  class_id: string;
  status: "confirmed" | "waitlisted" | "cancelled";
  position: number | null;
  promoted_at: string | null;
  promoted_by: string | null;
  promoted_generation: number | null;
}

/** OpenSeat's HTTP API, reached through any fetch-like function (in-process or over the network). */
export function openSeatProvider(request: (path: string, init?: RequestInit) => Promise<Response>) {
  async function call<T>(path: string, init: RequestInit = {}, key?: string): Promise<T> {
    let res: Response;
    try {
      res = await request(path, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
      });
    } catch {
      throw new HttpError(409, "The booking service is not reachable right now");
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      const status = res.status === 404 ? 404 : res.status === 400 ? 400 : 409;
      throw new HttpError(status, body.error ?? "The booking service refused the request");
    }
    return body;
  }
  return {
    name: "OpenSeat",
    createStudio: (name: string) =>
      call<{ studio_id: string; api_key: string }>("/studios", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    publishClass: (
      key: string,
      fields: {
        title: string;
        starts_at: string;
        ends_at: string;
        location: string;
        capacity: number;
      },
    ) => call<ClassInfo>("/studio/classes", { method: "POST", body: JSON.stringify(fields) }, key),
    classInfo: (id: string) => call<ClassInfo>(`/classes/${encodeURIComponent(id)}`),
    roster: (key: string, id: string) =>
      call<{
        class: ClassInfo;
        attendees: {
          attendee: string;
          status: string;
          booked_at: string;
          promoted_by: string | null;
          promoted_generation: number | null;
        }[];
      }>(`/studio/classes/${encodeURIComponent(id)}/roster`, {}, key),
    book: (id: string, name: string) =>
      call<BookingInfo>(`/classes/${encodeURIComponent(id)}/bookings`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    booking: (ref: string) => call<BookingInfo>(`/bookings/${encodeURIComponent(ref)}`),
    cancel: (ref: string) =>
      call<BookingInfo>(`/bookings/${encodeURIComponent(ref)}/cancel`, { method: "POST" }),
    calendar: async (ref: string) => {
      const res = await request(`/bookings/${encodeURIComponent(ref)}/calendar.ics`);
      if (!res.ok)
        throw new HttpError(409, "There is no calendar entry for a seat you do not hold");
      return res.text();
    },
  };
}

export type BookingProvider = ReturnType<typeof openSeatProvider>;

interface SessionRow {
  id: string;
  business_id: string;
  provider_ref: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  created_at: string;
}

const now = () => new Date().toISOString();

export class Bookings {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly provider: BookingProvider,
  ) {}

  /** The founder opens a dated session of their confirmed class for real bookings. */
  async openSession(
    viewer: Person,
    businessId: string,
    fields: { starts_at?: string; duration_minutes?: number; capacity?: number },
  ) {
    const desk = this.store.business(viewer, businessId);
    const b = desk.business;
    if (b.family !== "class")
      throw new HttpError(409, "Bookings are available for classes and workshops first");
    if (!b.published_at) throw new HttpError(409, "Publish your page before opening bookings");
    if (desk.missing.length > 0)
      throw new HttpError(409, `Finish the details first: ${desk.missing.join("; ")}`);
    const start = Date.parse(String(fields.starts_at ?? ""));
    if (!Number.isFinite(start)) throw new HttpError(400, "Pick a date and time");
    if (start < Date.now()) throw new HttpError(400, "Pick a time in the future");
    const minutes = Number(fields.duration_minutes ?? 90);
    const capacity = Number(fields.capacity ?? desk.offer.capacity ?? 0);
    if (!Number.isInteger(capacity) || capacity < 1) throw new HttpError(400, "How many places?");
    const key = await this.studioKey(businessId, b.name);
    const cls = await this.provider.publishClass(key, {
      title: desk.offer.title,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + minutes * 60_000).toISOString(),
      location: desk.offer.where_text,
      capacity,
    });
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO sessions_offered (id, business_id, provider_ref, starts_at, ends_at, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, businessId, cls.id, cls.starts_at, cls.ends_at, cls.capacity, now());
    this.db
      .prepare(
        "UPDATE businesses SET stage = 'launch', updated_at = ? WHERE id = ? AND stage IN ('shape','test')",
      )
      .run(now(), businessId);
    return this.ownerSessions(viewer, businessId);
  }

  private async studioKey(businessId: string, name: string) {
    const row = this.db
      .prepare("SELECT secret FROM integrations WHERE business_id = ? AND provider = 'openseat'")
      .get(businessId) as { secret: string } | undefined;
    if (row) return row.secret;
    const studio = await this.provider.createStudio(name);
    this.db
      .prepare(
        "INSERT INTO integrations (business_id, provider, account_id, secret, created_at) VALUES (?, 'openseat', ?, ?, ?)",
      )
      .run(businessId, studio.studio_id, studio.api_key, now());
    return studio.api_key;
  }

  private sessionRows(businessId: string, upcomingOnly: boolean) {
    return this.db
      .prepare(
        `SELECT * FROM sessions_offered WHERE business_id = ? ${upcomingOnly ? "AND ends_at > ?" : "AND ? IS NOT NULL"} ORDER BY starts_at`,
      )
      .all(businessId, now()) as unknown as SessionRow[];
  }

  /** Upcoming sessions with live availability. If OpenSeat cannot answer, say so; never show 0. */
  async publicSessions(businessId: string) {
    return Promise.all(
      this.sessionRows(businessId, true).map(async (s) => {
        try {
          const info = await this.provider.classInfo(s.provider_ref);
          return {
            id: s.id,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            capacity: info.capacity,
            seats_left: info.seats_left,
            waitlisted: info.waitlisted,
            available: true,
            checked_at: now(),
          };
        } catch {
          return {
            id: s.id,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            capacity: s.capacity,
            seats_left: null,
            waitlisted: null,
            available: false,
            checked_at: now(),
          };
        }
      }),
    );
  }

  async ownerSessions(viewer: Person, businessId: string) {
    this.store.business(viewer, businessId);
    const key = (
      this.db.prepare("SELECT secret FROM integrations WHERE business_id = ?").get(businessId) as
        | { secret: string }
        | undefined
    )?.secret;
    return Promise.all(
      this.sessionRows(businessId, false).map(async (s) => {
        try {
          const roster = key ? await this.provider.roster(key, s.provider_ref) : null;
          return {
            id: s.id,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            class: roster?.class ?? null,
            attendees: roster?.attendees ?? [],
            available: Boolean(roster),
          };
        } catch {
          return {
            id: s.id,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            class: null,
            attendees: [],
            available: false,
          };
        }
      }),
    );
  }

  async book(person: Person, sessionId: string, source: string) {
    const s = this.db
      .prepare("SELECT * FROM sessions_offered WHERE id = ?")
      .get(sessionId) as unknown as SessionRow | undefined;
    if (!s) throw new HttpError(404, "No such session");
    const owner = this.db
      .prepare("SELECT owner_id, name FROM businesses WHERE id = ? AND published_at IS NOT NULL")
      .get(s.business_id) as { owner_id: string; name: string } | undefined;
    if (!owner) throw new HttpError(404, "This page is not published");
    if (owner.owner_id === person.id) throw new HttpError(409, "This is your own class");
    if (Date.parse(s.ends_at) < Date.now())
      throw new HttpError(409, "This session has already happened");
    const existing = this.db
      .prepare("SELECT id FROM bookings WHERE person_id = ? AND session_id = ?")
      .get(person.id, sessionId) as { id: string } | undefined;
    if (existing) {
      const mine = await this.myBooking(person, existing.id);
      if (mine.status !== "cancelled")
        throw new HttpError(409, "You already have a place on this session");
    }
    const result = await this.provider.book(s.provider_ref, person.display_name);
    const id = randomUUID();
    const t = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO bookings (id, person_id, business_id, session_id, ref, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, person.id, s.business_id, sessionId, result.ref, cleanSource(source), t);
      const when = new Date(s.starts_at).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      this.db
        .prepare(
          "INSERT OR IGNORE INTO tasks (id, business_id, title, detail, source, ref, sort, created_at) VALUES (?, ?, ?, ?, 'booking', ?, -1, ?)",
        )
        .run(
          randomUUID(),
          s.business_id,
          result.status === "confirmed"
            ? `New booking: ${firstName(person)} for ${when}`
            : `${firstName(person)} joined the waitlist for ${when}`,
          result.status === "confirmed"
            ? "Say hello and tell them what to bring."
            : "Let them know they will be moved up automatically if a place opens.",
          id,
          t,
        );
      this.db
        .prepare("INSERT INTO events (type, subject, actor, payload, at) VALUES (?, ?, ?, ?, ?)")
        .run(
          result.status === "confirmed" ? "booking_confirmed" : "waitlist_joined",
          s.business_id,
          person.id,
          JSON.stringify({ session: sessionId }),
          t,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.myBooking(person, id);
  }

  private row(person: Person, bookingId: string) {
    const row = this.db
      .prepare("SELECT * FROM bookings WHERE id = ? AND person_id = ?")
      .get(bookingId, person.id) as
      | {
          id: string;
          ref: string;
          business_id: string;
          session_id: string;
          source: string;
          created_at: string;
        }
      | undefined;
    if (!row) throw new HttpError(404, "No such booking");
    return row;
  }

  async myBooking(person: Person, bookingId: string) {
    const row = this.row(person, bookingId);
    const s = this.db
      .prepare("SELECT * FROM sessions_offered WHERE id = ?")
      .get(row.session_id) as unknown as SessionRow;
    const b = this.db
      .prepare("SELECT name, slug FROM businesses WHERE id = ?")
      .get(row.business_id) as { name: string; slug: string };
    const offer = this.store.offerOf(row.business_id);
    let live: BookingInfo | null = null;
    try {
      live = await this.provider.booking(row.ref);
    } catch {
      live = null;
    }
    return {
      id: row.id,
      business: b,
      title: offer.title,
      where: offer.where_text,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      reference: row.ref,
      status: live?.status ?? "unknown",
      position: live?.position ?? null,
      promoted_by: live?.promoted_by ?? null,
      promoted_generation: live?.promoted_generation ?? null,
      booked_at: row.created_at,
    };
  }

  async myBookings(person: Person) {
    const rows = this.db
      .prepare("SELECT id FROM bookings WHERE person_id = ? ORDER BY created_at DESC")
      .all(person.id) as { id: string }[];
    return Promise.all(rows.map((r) => this.myBooking(person, r.id)));
  }

  async cancel(person: Person, bookingId: string) {
    const row = this.row(person, bookingId);
    await this.provider.cancel(row.ref);
    return this.myBooking(person, bookingId);
  }

  async calendar(person: Person, bookingId: string) {
    return this.provider.calendar(this.row(person, bookingId).ref);
  }
}

export function firstName(p: Person) {
  return p.display_name.split(" ")[0] ?? "Someone";
}

export function cleanSource(source: string) {
  return ["link", "discovery", "need", "follow"].includes(source) ? source : "unknown";
}
