// Being seen and finding things: search with explicit constraints, a board of needs people chose
// to publish, short updates from businesses, following, Explore, founder profiles and reports.
// Private searches are never shown to founders; only needs someone deliberately published are.

import { randomUUID } from "node:crypto";
import { cleanSource, firstName } from "./bookings.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store, terms } from "./store.ts";

export interface Constraints {
  family?: "class" | "service" | "product" | "software";
  max_price_cents?: number;
  online?: boolean;
  confirmed_only?: boolean;
}

const FAMILY_WORDS: Record<NonNullable<Constraints["family"]>, string[]> = {
  class: ["class", "workshop", "lesson", "course", "session", "learn", "teach", "beginner"],
  service: ["fix", "repair", "help", "service", "clean", "design", "photograph", "bookkeeping"],
  product: ["buy", "kit", "candle", "gift", "handmade", "made"],
  software: ["app", "tool", "api", "software", "plugin", "automate"],
};

/** Reads plain words into editable constraints. Everything it guesses is shown and removable. */
export function interpret(query: string): { words: string[]; constraints: Constraints } {
  const q = query.toLowerCase();
  const constraints: Constraints = {};
  const price =
    q.match(
      /(?:under|below|less than|max(?:imum)?|up to|no more than)\s*\$?\s*(\d+(?:\.\d{1,2})?)/,
    ) ?? q.match(/\$(\d+(?:\.\d{1,2})?)\s*(?:or less|max|tops)/);
  if (price?.[1]) constraints.max_price_cents = Math.round(Number(price[1]) * 100);
  if (/\b(online|remote|virtual)\b/.test(q)) constraints.online = true;
  const words = terms(
    query
      .replace(/(?:under|below|less than|up to)\s*\$?\s*\d+(?:\.\d+)?/gi, "")
      .replace(/\$\d+/g, ""),
  );
  for (const [family, list] of Object.entries(FAMILY_WORDS) as [
    NonNullable<Constraints["family"]>,
    string[],
  ][]) {
    if (words.some((w) => list.includes(w))) {
      constraints.family = family;
      break;
    }
  }
  return { words: words.filter((w) => !["online", "remote", "virtual"].includes(w)), constraints };
}

type PublicPage = ReturnType<Store["publicBusiness"]>;

function check(b: PublicPage, c: Constraints) {
  const unknown: string[] = [];
  const failed: string[] = [];
  const met: string[] = [];
  if (c.family) (b.family === c.family ? met : failed).push("family");
  if (c.max_price_cents !== undefined) {
    const price = b.offer?.first_free ? 0 : (b.offer?.price_cents ?? null);
    if (price === null) unknown.push("max_price_cents");
    else (price <= c.max_price_cents ? met : failed).push("max_price_cents");
  }
  if (c.online) {
    const where = (b.offer?.where_text ?? "").toLowerCase();
    if (!where) unknown.push("online");
    else (/(online|remote|virtual|anywhere)/.test(where) ? met : failed).push("online");
  }
  if (c.confirmed_only) (b.offer?.confirmed ? met : failed).push("confirmed_only");
  return { unknown, failed, met };
}

const DAY = 24 * 60 * 60 * 1000;

export class Community {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {}

  private published(): PublicPage[] {
    const rows = this.db
      .prepare(
        "SELECT slug FROM businesses WHERE published_at IS NOT NULL ORDER BY published_at DESC",
      )
      .all() as { slug: string }[];
    return rows.map((r) => this.store.publicBusiness(r.slug));
  }

  private isNew(b: PublicPage) {
    return Date.now() - Date.parse(b.published_at ?? "") < 7 * DAY;
  }

  /**
   * Hard constraints filter first; words rank what is left. Offers that might fit but leave a
   * constraint unknown go to "ask to confirm". When nothing fits, say which constraint did it.
   */
  search(query: string, constraints: Constraints) {
    const words = [...new Set(interpret(query).words)];
    const all = this.published().map((b) => {
      const text = new Set(
        terms(
          [
            b.name,
            b.tagline,
            b.about,
            b.offer?.title,
            b.offer?.outcome,
            b.offer?.audience,
            b.offer?.deliverable,
            b.offer?.includes,
            b.founder.headline,
          ].join(" "),
        ),
      );
      const matched = words.filter((w) => text.has(w));
      return { b, matched, check: check(b, constraints) };
    });
    const relevant = all.filter((r) => words.length === 0 || r.matched.length > 0);
    const decorate = (r: (typeof all)[number]) => ({
      ...r.b,
      matched: r.matched,
      met: r.check.met,
      unknown_constraints: r.check.unknown,
      new_here: this.isNew(r.b),
    });
    const matches = relevant
      .filter((r) => r.check.failed.length === 0 && r.check.unknown.length === 0)
      .sort((a, b) => b.matched.length - a.matched.length)
      .map(decorate);
    const askToConfirm = relevant
      .filter((r) => r.check.failed.length === 0 && r.check.unknown.length > 0)
      .map(decorate);
    const blockedBy: Record<string, number> = {};
    for (const r of relevant)
      for (const f of r.check.failed) blockedBy[f] = (blockedBy[f] ?? 0) + 1;
    return {
      words,
      constraints,
      matches,
      ask_to_confirm: askToConfirm,
      blocked_by: blockedBy,
      relevant_without_constraints: relevant.length,
    };
  }

  // ---------- needs ----------

  postNeed(
    person: Person,
    input: { text?: string; constraints?: Constraints; allow_replies?: boolean; days?: number },
  ) {
    const text = String(input.text ?? "").trim();
    if (text.length < 8) throw new HttpError(400, "Describe what you need in a sentence");
    const days = [7, 14, 30].includes(Number(input.days)) ? Number(input.days) : 14;
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO needs (id, person_id, text, constraints, allow_replies, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
      )
      .run(
        id,
        person.id,
        text.slice(0, 600),
        JSON.stringify(input.constraints ?? {}),
        input.allow_replies === false ? 0 : 1,
        new Date(Date.now() + days * DAY).toISOString(),
        new Date().toISOString(),
      );
    return this.myNeeds(person);
  }

  /** Published needs, without who posted them. */
  openNeeds() {
    return (
      this.db
        .prepare(
          "SELECT * FROM needs WHERE status = 'open' AND expires_at > ? ORDER BY created_at DESC",
        )
        .all(new Date().toISOString()) as {
        id: string;
        text: string;
        constraints: string;
        allow_replies: number;
        expires_at: string;
        created_at: string;
      }[]
    ).map((n) => ({
      id: n.id,
      text: n.text,
      constraints: JSON.parse(n.constraints) as Constraints,
      allow_replies: n.allow_replies === 1,
      expires_at: n.expires_at,
      created_at: n.created_at,
      responses: (
        this.db.prepare("SELECT COUNT(*) AS n FROM need_responses WHERE need_id = ?").get(n.id) as {
          n: number;
        }
      ).n,
    }));
  }

  myNeeds(person: Person) {
    const rows = this.db
      .prepare("SELECT * FROM needs WHERE person_id = ? ORDER BY created_at DESC")
      .all(person.id) as {
      id: string;
      text: string;
      constraints: string;
      allow_replies: number;
      status: string;
      expires_at: string;
      created_at: string;
    }[];
    return rows.map((n) => ({
      ...n,
      constraints: JSON.parse(n.constraints) as Constraints,
      expired: n.expires_at < new Date().toISOString(),
      responses: this.db
        .prepare(
          "SELECT r.id, r.message, r.reply, r.created_at, r.replied_at, b.name AS business_name, b.slug FROM need_responses r JOIN businesses b ON b.id = r.business_id WHERE r.need_id = ? ORDER BY r.created_at",
        )
        .all(n.id),
    }));
  }

  closeNeed(person: Person, needId: string) {
    const r = this.db
      .prepare("UPDATE needs SET status = 'closed' WHERE id = ? AND person_id = ?")
      .run(needId, person.id);
    if (r.changes === 0) throw new HttpError(404, "No such need");
    return this.myNeeds(person);
  }

  respond(founder: Person, needId: string, businessId: string, message: string) {
    const b = this.store.business(founder, businessId).business;
    if (!b.published_at) throw new HttpError(409, "Publish your page before answering needs");
    const need = this.db
      .prepare("SELECT person_id, allow_replies, status, expires_at FROM needs WHERE id = ?")
      .get(needId) as
      | { person_id: string; allow_replies: number; status: string; expires_at: string }
      | undefined;
    if (need?.status !== "open" || need.expires_at < new Date().toISOString())
      throw new HttpError(404, "This need is no longer open");
    if (!need.allow_replies)
      throw new HttpError(409, "The person who posted this asked not to receive replies");
    if (need.person_id === founder.id) throw new HttpError(409, "This is your own request");
    if (!message.trim()) throw new HttpError(400, "Write a short reply");
    try {
      this.db
        .prepare(
          "INSERT INTO need_responses (id, need_id, business_id, message, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          needId,
          businessId,
          message.trim().slice(0, 1200),
          new Date().toISOString(),
        );
    } catch {
      throw new HttpError(409, "You already replied to this need");
    }
    return { ok: true };
  }

  replyToResponse(person: Person, responseId: string, text: string) {
    const r = this.db
      .prepare(
        "SELECT r.id FROM need_responses r JOIN needs n ON n.id = r.need_id WHERE r.id = ? AND n.person_id = ?",
      )
      .get(responseId, person.id);
    if (!r) throw new HttpError(404, "No such reply");
    if (!text.trim()) throw new HttpError(400, "Write a reply");
    this.db
      .prepare("UPDATE need_responses SET reply = ?, replied_at = ? WHERE id = ?")
      .run(text.trim().slice(0, 1200), new Date().toISOString(), responseId);
    return this.myNeeds(person);
  }

  /** Open needs that share words with this business, for its desk. */
  needsForBusiness(founder: Person, businessId: string) {
    const page = this.store.business(founder, businessId);
    const text = new Set(
      terms(
        [
          page.business.name,
          page.business.tagline,
          page.offer.title,
          page.offer.outcome,
          page.offer.audience,
          page.offer.deliverable,
        ].join(" "),
      ),
    );
    const answered = new Set(
      (
        this.db
          .prepare("SELECT need_id FROM need_responses WHERE business_id = ?")
          .all(businessId) as { need_id: string }[]
      ).map((r) => r.need_id),
    );
    return this.openNeeds()
      .filter((n) => n.allow_replies)
      .map((n) => ({
        ...n,
        matched: terms(n.text).filter((w) => text.has(w)),
        answered: answered.has(n.id),
      }))
      .filter((n) => n.matched.length > 0 || n.constraints.family === page.business.family)
      .slice(0, 5);
  }

  /** Founder responses to needs, as the founder sees them (with the requester's reply). */
  sentResponses(founder: Person) {
    return this.db
      .prepare(
        "SELECT r.id, r.message, r.reply, r.created_at, r.replied_at, n.text AS need_text, b.name AS business_name FROM need_responses r JOIN needs n ON n.id = r.need_id JOIN businesses b ON b.id = r.business_id WHERE b.owner_id = ? ORDER BY r.created_at DESC",
      )
      .all(founder.id);
  }

  // ---------- updates and following ----------

  postUpdate(founder: Person, businessId: string, body: string) {
    const b = this.store.business(founder, businessId).business;
    if (!b.published_at) throw new HttpError(409, "Publish your page before posting updates");
    const text = body.trim();
    if (!text) throw new HttpError(400, "Write your update");
    this.db
      .prepare("INSERT INTO updates (id, business_id, body, created_at) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), businessId, text.slice(0, 1000), new Date().toISOString());
    return this.updatesFor(businessId);
  }

  updatesFor(businessId: string) {
    return this.db
      .prepare(
        "SELECT id, body, created_at FROM updates WHERE business_id = ? ORDER BY created_at DESC LIMIT 20",
      )
      .all(businessId) as {
      id: string;
      body: string;
      created_at: string;
    }[];
  }

  businessIdForSlug(slug: string) {
    const r = this.db
      .prepare("SELECT id, owner_id FROM businesses WHERE slug = ? AND published_at IS NOT NULL")
      .get(slug) as { id: string; owner_id: string } | undefined;
    if (!r) throw new HttpError(404, "This page is not published");
    return r;
  }

  follow(person: Person, slug: string, on: boolean) {
    const b = this.businessIdForSlug(slug);
    if (on)
      this.db
        .prepare(
          "INSERT OR IGNORE INTO follows (person_id, business_id, created_at) VALUES (?, ?, ?)",
        )
        .run(person.id, b.id, new Date().toISOString());
    else
      this.db
        .prepare("DELETE FROM follows WHERE person_id = ? AND business_id = ?")
        .run(person.id, b.id);
    return { following: on, followers: this.followers(b.id) };
  }

  isFollowing(person: Person | null, businessId: string) {
    if (!person) return false;
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM follows WHERE person_id = ? AND business_id = ?")
        .get(person.id, businessId),
    );
  }

  followers(businessId: string) {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM follows WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
  }

  /** Updates from businesses this person follows, newest first. */
  feed(person: Person) {
    return this.db
      .prepare(
        "SELECT u.id, u.body, u.created_at, b.name AS business_name, b.slug FROM updates u JOIN follows f ON f.business_id = u.business_id JOIN businesses b ON b.id = u.business_id WHERE f.person_id = ? AND b.published_at IS NOT NULL ORDER BY u.created_at DESC LIMIT 50",
      )
      .all(person.id);
  }

  following(person: Person) {
    return this.db
      .prepare(
        "SELECT b.name, b.slug FROM follows f JOIN businesses b ON b.id = f.business_id WHERE f.person_id = ? AND b.published_at IS NOT NULL ORDER BY f.created_at DESC",
      )
      .all(person.id);
  }

  // ---------- explore and profiles ----------

  explore() {
    const pages = this.published().map((b) => ({ ...b, new_here: this.isNew(b) }));
    return {
      starting: pages.filter((b) => b.action.kind === "interest"),
      open: pages.filter((b) => b.action.kind === "question"),
      needs: this.openNeeds(),
    };
  }

  profile(personId: string) {
    const p = this.db
      .prepare("SELECT id, display_name, headline, bio, created_at FROM people WHERE id = ?")
      .get(personId) as
      | { id: string; display_name: string; headline: string; bio: string; created_at: string }
      | undefined;
    if (!p) throw new HttpError(404, "No such person");
    const slugs = this.db
      .prepare(
        "SELECT slug FROM businesses WHERE owner_id = ? AND published_at IS NOT NULL ORDER BY published_at",
      )
      .all(personId) as {
      slug: string;
    }[];
    if (slugs.length === 0) throw new HttpError(404, "This person has not published anything yet");
    const businesses = slugs.map((s) => this.store.publicBusiness(s.slug));
    const updates = this.db
      .prepare(
        "SELECT u.id, u.body, u.created_at, b.name AS business_name, b.slug FROM updates u JOIN businesses b ON b.id = u.business_id WHERE b.owner_id = ? AND b.published_at IS NOT NULL ORDER BY u.created_at DESC LIMIT 10",
      )
      .all(personId);
    return {
      id: p.id,
      display_name: p.display_name,
      headline: p.headline,
      bio: p.bio,
      member_since: p.created_at,
      businesses,
      updates,
    };
  }

  // ---------- attribution and reports ----------

  /** How people reached this business: their own link, discovery here, a need, or unknown. */
  sources(founder: Person, businessId: string) {
    this.store.business(founder, businessId);
    const tally = (sql: string) =>
      Object.fromEntries(
        (this.db.prepare(sql).all(businessId) as { source: string; n: number }[]).map((r) => [
          r.source,
          r.n,
        ]),
      );
    return {
      responses: tally(
        "SELECT source, COUNT(*) AS n FROM inquiries WHERE business_id = ? GROUP BY source",
      ),
      bookings: tally(
        "SELECT source, COUNT(*) AS n FROM bookings WHERE business_id = ? GROUP BY source",
      ),
      followers: this.followers(businessId),
    };
  }

  report(person: Person, kind: string, subject: string, reason: string) {
    if (!["business", "need"].includes(kind)) throw new HttpError(400, "Unknown report");
    if (!reason.trim()) throw new HttpError(400, "Tell us what is wrong");
    this.db
      .prepare(
        "INSERT INTO reports (id, kind, subject, person_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        kind,
        subject,
        person.id,
        reason.trim().slice(0, 1000),
        new Date().toISOString(),
      );
    return { ok: true };
  }
}

export { cleanSource, firstName };
