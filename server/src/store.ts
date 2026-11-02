// Platform records: people and sessions, launch projects, businesses with their profile, idea
// page and offer, inquiries and the founder's tasks. Every public read goes through a
// published projection; drafts never leave the owner's workspace.

import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import {
  customerAction,
  type Direction,
  directions,
  draftOffer,
  type ExploreAnswers,
  firstWeekPlan,
  type InterviewAnswers,
  missingFacts,
} from "./drafting.ts";

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const json = <T>(text: string): T => JSON.parse(text) as T;

export interface Person {
  id: string;
  display_name: string;
  headline: string;
  bio: string;
  created_at: string;
}

export interface Business {
  id: string;
  slug: string;
  owner_id: string;
  name: string;
  tagline: string;
  about: string;
  family: string;
  stage: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Offer {
  id: string;
  business_id: string;
  version: number;
  title: string;
  outcome: string;
  audience: string;
  not_for: string;
  deliverable: string;
  includes: string;
  price_cents: number | null;
  price_unit: string;
  first_free: number;
  delivery: string;
  when_text: string;
  where_text: string;
  capacity: number | null;
  confirmed: number;
  edited: string;
  published_at: string | null;
  updated_at: string;
}

export interface Idea {
  business_id: string;
  problem: string;
  why_me: string;
  ask: string;
  evidence: string;
  published_at: string | null;
}

const OFFER_FIELDS = [
  "title",
  "outcome",
  "audience",
  "not_for",
  "deliverable",
  "includes",
  "price_cents",
  "price_unit",
  "first_free",
  "when_text",
  "where_text",
  "capacity",
  "confirmed",
] as const;

const STOPWORDS = new Set(
  "a about an and are around as at be below but by can do for from get have help i in into is it its me my need of on or our so some that the their them this to under want we with you your".split(
    " ",
  ),
);

/** Lower-cased words without common filler, with simple plurals folded ("receipts" → "receipt"). */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w))
    .map((w) =>
      w.length > 4 && w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w,
    )
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "business"
  );
}

export class Store {
  constructor(readonly db: Db) {}

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

  private event(type: string, subject: string, actor: string | null, payload: object = {}) {
    this.db
      .prepare("INSERT INTO events (type, subject, actor, payload, at) VALUES (?, ?, ?, ?, ?)")
      .run(type, subject, actor, JSON.stringify(payload), now());
  }

  // ---------- people and sessions ----------

  createPerson(displayName: string): { person: Person; token: string } {
    const name = displayName.trim();
    if (!name) throw new HttpError(400, "Tell us your name");
    const person: Person = {
      id: randomUUID(),
      display_name: name.slice(0, 80),
      headline: "",
      bio: "",
      created_at: now(),
    };
    const token = randomBytes(24).toString("base64url");
    this.tx(() => {
      this.db
        .prepare(
          "INSERT INTO people (id, display_name, headline, bio, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(person.id, person.display_name, "", "", person.created_at);
      this.db
        .prepare("INSERT INTO sessions (token, person_id, created_at) VALUES (?, ?, ?)")
        .run(token, person.id, now());
      this.event("person_joined", person.id, person.id);
    });
    return { person, token };
  }

  /** Local preview only: start a session as an existing fictional person. */
  sessionFor(personId: string): string {
    this.person(personId);
    const token = randomBytes(24).toString("base64url");
    this.db
      .prepare("INSERT INTO sessions (token, person_id, created_at) VALUES (?, ?, ?)")
      .run(token, personId, now());
    return token;
  }

  personForToken(token: string | undefined): Person | null {
    if (!token) return null;
    return (
      (this.db
        .prepare("SELECT p.* FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = ?")
        .get(token) as unknown as Person | undefined) ?? null
    );
  }

  endSession(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  person(id: string): Person {
    const p = this.db.prepare("SELECT * FROM people WHERE id = ?").get(id) as unknown as
      | Person
      | undefined;
    if (!p) throw new HttpError(404, "No such person");
    return p;
  }

  people(): Person[] {
    return this.db.prepare("SELECT * FROM people ORDER BY created_at").all() as unknown as Person[];
  }

  updatePerson(id: string, fields: Partial<Pick<Person, "display_name" | "headline" | "bio">>) {
    const p = this.person(id);
    const next = {
      display_name: (fields.display_name ?? p.display_name).trim().slice(0, 80) || p.display_name,
      headline: (fields.headline ?? p.headline).trim().slice(0, 140),
      bio: (fields.bio ?? p.bio).trim().slice(0, 2000),
    };
    this.db
      .prepare("UPDATE people SET display_name = ?, headline = ?, bio = ? WHERE id = ?")
      .run(next.display_name, next.headline, next.bio, id);
    return this.person(id);
  }

  private freeSlug(text: string, exceptId?: string) {
    const base = slugify(text);
    let slug = base;
    for (
      let i = 2;
      this.db
        .prepare("SELECT 1 FROM businesses WHERE slug = ? AND id IS NOT ?")
        .get(slug, exceptId ?? null);
      i++
    ) {
      slug = `${base}-${i}`;
    }
    return slug;
  }

  // ---------- launch projects ----------

  startProject(owner: Person, route: "idea" | "find" | "started", name?: string) {
    const businessId = randomUUID();
    const projectId = randomUUID();
    const slug = this.freeSlug(
      name || `${owner.display_name}-${route === "find" ? "idea" : "business"}`,
    );
    const t = now();
    this.tx(() => {
      this.db
        .prepare(
          "INSERT INTO businesses (id, slug, owner_id, name, family, stage, created_at, updated_at) VALUES (?, ?, ?, ?, 'undecided', 'shape', ?, ?)",
        )
        .run(businessId, slug, owner.id, name?.trim() || "Untitled business", t, t);
      this.db
        .prepare(
          "INSERT INTO projects (id, business_id, route, step, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(projectId, businessId, route, route === "find" ? "explore" : "interview", t);
      this.db
        .prepare("INSERT INTO offers (id, business_id, version, updated_at) VALUES (?, ?, 1, ?)")
        .run(randomUUID(), businessId, t);
      this.db
        .prepare("INSERT INTO ideas (business_id, updated_at) VALUES (?, ?)")
        .run(businessId, t);
      this.event("project_started", businessId, owner.id, { route });
    });
    return this.project(owner, projectId);
  }

  private projectRow(projectId: string) {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as unknown as
      | {
          id: string;
          business_id: string;
          route: string;
          step: string;
          explore: string;
          directions: string;
          answers: string;
          updated_at: string;
        }
      | undefined;
    if (!row) throw new HttpError(404, "No such launch project");
    return row;
  }

  /** The whole studio state for the owner. Nobody else may read a project. */
  project(viewer: Person, projectId: string) {
    const row = this.projectRow(projectId);
    const business = this.ownedBusiness(viewer, row.business_id);
    const offer = this.offerOf(business.id);
    return {
      id: row.id,
      route: row.route,
      step: row.step,
      explore: json<ExploreAnswers>(row.explore),
      directions: json<Direction[]>(row.directions),
      answers: json<InterviewAnswers>(row.answers),
      business,
      offer,
      idea: this.ideaOf(business.id),
      owner: viewer,
      missing: missingFacts(offer),
      action: customerAction(offer, business.family),
      plan: firstWeekPlan(offer),
      updated_at: row.updated_at,
    };
  }

  projects(owner: Person) {
    return (
      this.db
        .prepare(
          "SELECT p.id, p.step, p.updated_at, b.id AS business_id, b.name, b.slug, b.stage, b.published_at FROM projects p JOIN businesses b ON b.id = p.business_id WHERE b.owner_id = ? ORDER BY p.updated_at DESC",
        )
        .all(owner.id) as unknown as {
        id: string;
        step: string;
        business_id: string;
        name: string;
        slug: string;
        stage: string;
        published_at: string | null;
      }[]
    ).map((p) => ({ ...p, inquiries: this.inquiryCount(p.business_id) }));
  }

  explore(viewer: Person, projectId: string, answers: ExploreAnswers) {
    const row = this.projectRow(projectId);
    this.ownedBusiness(viewer, row.business_id);
    const found = directions(answers);
    this.db
      .prepare("UPDATE projects SET explore = ?, directions = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(answers), JSON.stringify(found), now(), projectId);
    return this.project(viewer, projectId);
  }

  chooseDirection(viewer: Person, projectId: string, index: number) {
    const row = this.projectRow(projectId);
    const business = this.ownedBusiness(viewer, row.business_id);
    const chosen = json<Direction[]>(row.directions)[index];
    if (!chosen) throw new HttpError(400, "Pick one of the three directions");
    const answers: InterviewAnswers = {
      ...json<InterviewAnswers>(row.answers),
      audience: chosen.customer,
      outcome: chosen.offer,
    };
    this.tx(() => {
      this.db
        .prepare("UPDATE projects SET step = 'interview', answers = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(answers), now(), projectId);
      this.db
        .prepare("UPDATE businesses SET family = ?, updated_at = ? WHERE id = ?")
        .run(chosen.family, now(), business.id);
      this.db
        .prepare("UPDATE ideas SET problem = ?, ask = ?, updated_at = ? WHERE business_id = ?")
        .run(chosen.problem, chosen.ask, now(), business.id);
      this.applyDraft(business.id, answers);
    });
    return this.project(viewer, projectId);
  }

  /** Saves interview answers and redrafts every offer field the founder has not edited by hand. */
  answer(viewer: Person, projectId: string, patch: InterviewAnswers & { step?: string }) {
    const row = this.projectRow(projectId);
    const business = this.ownedBusiness(viewer, row.business_id);
    const { step, ...fields } = patch;
    const answers = { ...json<InterviewAnswers>(row.answers), ...fields };
    this.tx(() => {
      this.db
        .prepare("UPDATE projects SET answers = ?, step = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(answers), step ?? row.step, now(), projectId);
      if (fields.evidence !== undefined) {
        this.db
          .prepare("UPDATE ideas SET evidence = ?, updated_at = ? WHERE business_id = ?")
          .run(fields.evidence, now(), business.id);
      }
      this.applyDraft(business.id, answers);
    });
    return this.project(viewer, projectId);
  }

  setStep(viewer: Person, projectId: string, step: string) {
    const row = this.projectRow(projectId);
    this.ownedBusiness(viewer, row.business_id);
    this.db
      .prepare("UPDATE projects SET step = ?, updated_at = ? WHERE id = ?")
      .run(step, now(), projectId);
    return this.project(viewer, projectId);
  }

  private applyDraft(businessId: string, answers: InterviewAnswers) {
    const offer = this.offerOf(businessId);
    const edited = new Set(json<string[]>(offer.edited));
    const draft = draftOffer(answers) as Record<string, unknown>;
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(draft)) {
      if (edited.has(k)) continue;
      sets.push(`${k} = ?`);
      values.push(v as string | number | null);
    }
    if (!sets.length) return;
    this.db
      .prepare(`UPDATE offers SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...values, now(), offer.id);
  }

  // ---------- businesses, offers, idea pages ----------

  private ownedBusiness(viewer: Person, businessId: string): Business {
    const b = this.db.prepare("SELECT * FROM businesses WHERE id = ?").get(businessId) as unknown as
      | Business
      | undefined;
    // Same answer for "missing" and "not yours", so ids reveal nothing.
    if (!b || b.owner_id !== viewer.id) throw new HttpError(404, "No such business");
    return b;
  }

  business(viewer: Person, businessId: string) {
    const b = this.ownedBusiness(viewer, businessId);
    const offer = this.offerOf(b.id);
    const project = this.db.prepare("SELECT id FROM projects WHERE business_id = ?").get(b.id) as
      | { id: string }
      | undefined;
    return {
      business: b,
      offer,
      idea: this.ideaOf(b.id),
      project_id: project?.id ?? null,
      missing: missingFacts(offer),
      action: customerAction(offer, b.family),
      tasks: this.tasks(b.id),
      inquiries: this.inquiriesFor(b.id),
    };
  }

  updateBusiness(
    viewer: Person,
    businessId: string,
    fields: Partial<Pick<Business, "name" | "tagline" | "about" | "family">>,
  ) {
    const b = this.ownedBusiness(viewer, businessId);
    const family = fields.family ?? b.family;
    if (!["class", "service", "product", "software", "undecided"].includes(family))
      throw new HttpError(400, "Unknown kind of business");
    // The address follows the name until the page has ever been published; after that,
    // links people already have must keep working.
    const everPublished = this.db
      .prepare("SELECT 1 FROM events WHERE type = 'business_published' AND subject = ?")
      .get(b.id);
    if (fields.name && fields.name.trim() !== b.name && !everPublished) {
      this.db
        .prepare("UPDATE businesses SET slug = ? WHERE id = ?")
        .run(this.freeSlug(fields.name, b.id), b.id);
    }
    this.db
      .prepare(
        "UPDATE businesses SET name = ?, tagline = ?, about = ?, family = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        (fields.name ?? b.name).trim().slice(0, 80) || b.name,
        (fields.tagline ?? b.tagline).trim().slice(0, 160),
        (fields.about ?? b.about).trim().slice(0, 4000),
        family,
        now(),
        b.id,
      );
    return this.business(viewer, businessId);
  }

  offerOf(businessId: string): Offer {
    return this.db
      .prepare("SELECT * FROM offers WHERE business_id = ? ORDER BY version DESC LIMIT 1")
      .get(businessId) as unknown as Offer;
  }

  ideaOf(businessId: string): Idea {
    return this.db
      .prepare("SELECT * FROM ideas WHERE business_id = ?")
      .get(businessId) as unknown as Idea;
  }

  /** A hand edit to the offer; the field stops following the interview from then on. */
  editOffer(viewer: Person, businessId: string, fields: Partial<Record<string, unknown>>) {
    const b = this.ownedBusiness(viewer, businessId);
    const offer = this.offerOf(b.id);
    const edited = new Set(json<string[]>(offer.edited));
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const key of OFFER_FIELDS) {
      if (!(key in fields)) continue;
      let v = fields[key];
      if (key === "price_cents" || key === "capacity")
        v = v === null || v === "" ? null : Math.max(0, Math.round(Number(v)));
      else if (key === "first_free" || key === "confirmed") v = v ? 1 : 0;
      else v = String(v ?? "").slice(0, 2000);
      if (typeof v === "number" && !Number.isFinite(v))
        throw new HttpError(400, `${key} must be a number`);
      sets.push(`${key} = ?`);
      values.push(v as string | number | null);
      edited.add(key);
    }
    if (sets.length) {
      this.db
        .prepare(`UPDATE offers SET ${sets.join(", ")}, edited = ?, updated_at = ? WHERE id = ?`)
        .run(...values, JSON.stringify([...edited]), now(), offer.id);
      if (offer.published_at) this.refreshPlan(b.id);
    }
    return this.business(viewer, businessId);
  }

  editIdea(
    viewer: Person,
    businessId: string,
    fields: Partial<Pick<Idea, "problem" | "why_me" | "ask" | "evidence">>,
  ) {
    const b = this.ownedBusiness(viewer, businessId);
    const i = this.ideaOf(b.id);
    this.db
      .prepare(
        "UPDATE ideas SET problem = ?, why_me = ?, ask = ?, evidence = ?, updated_at = ? WHERE business_id = ?",
      )
      .run(
        (fields.problem ?? i.problem).slice(0, 2000),
        (fields.why_me ?? i.why_me).slice(0, 2000),
        (fields.ask ?? i.ask).slice(0, 500),
        (fields.evidence ?? i.evidence).slice(0, 2000),
        now(),
        b.id,
      );
    return this.business(viewer, businessId);
  }

  /**
   * Publishes the business page, its idea and its offer. "Publish idea" and "Open for bookings"
   * are different things; Phase 1 only publishes, and the visitor action stays interest or an
   * inquiry until real bookings exist.
   */
  publish(viewer: Person, businessId: string) {
    const b = this.ownedBusiness(viewer, businessId);
    const offer = this.offerOf(b.id);
    if (!b.name || b.name === "Untitled business")
      throw new HttpError(400, "Give your business a name first");
    if (!offer.title) throw new HttpError(400, "Your offer needs a title before it can be seen");
    const t = now();
    this.tx(() => {
      this.db
        .prepare(
          "UPDATE businesses SET published_at = COALESCE(published_at, ?), stage = CASE WHEN stage = 'shape' THEN 'test' ELSE stage END, updated_at = ? WHERE id = ?",
        )
        .run(t, t, b.id);
      this.db
        .prepare("UPDATE offers SET published_at = COALESCE(published_at, ?) WHERE id = ?")
        .run(t, offer.id);
      this.db
        .prepare("UPDATE ideas SET published_at = COALESCE(published_at, ?) WHERE business_id = ?")
        .run(t, b.id);
      this.db
        .prepare("UPDATE projects SET step = 'launched', updated_at = ? WHERE business_id = ?")
        .run(t, b.id);
      this.refreshPlan(b.id);
      this.event("business_published", b.id, viewer.id);
    });
    return this.business(viewer, businessId);
  }

  unpublish(viewer: Person, businessId: string) {
    const b = this.ownedBusiness(viewer, businessId);
    this.tx(() => {
      this.db
        .prepare("UPDATE businesses SET published_at = NULL, updated_at = ? WHERE id = ?")
        .run(now(), b.id);
      this.db.prepare("UPDATE offers SET published_at = NULL WHERE business_id = ?").run(b.id);
      this.db.prepare("UPDATE ideas SET published_at = NULL WHERE business_id = ?").run(b.id);
      this.event("business_unpublished", b.id, viewer.id);
    });
    return this.business(viewer, businessId);
  }

  // ---------- tasks ----------

  private refreshPlan(businessId: string) {
    const offer = this.offerOf(businessId);
    const plan = firstWeekPlan(offer);
    const missing = new Set(missingFacts(offer));
    plan.forEach((step, i) => {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO tasks (id, business_id, title, detail, source, ref, sort, created_at) VALUES (?, ?, ?, ?, 'plan', ?, ?, ?)",
        )
        .run(randomUUID(), businessId, step.title, step.detail, step.title, i, now());
    });
    // A missing-fact task the founder has since filled in is done.
    const open = this.db
      .prepare(
        "SELECT id, title FROM tasks WHERE business_id = ? AND source = 'plan' AND done_at IS NULL",
      )
      .all(businessId) as { id: string; title: string }[];
    for (const t of open) {
      const isFact = /^(Say|Describe|Set a price|Pick a date|Confirm)/.test(t.title);
      if (isFact && !missing.has(t.title)) {
        this.db.prepare("UPDATE tasks SET done_at = ? WHERE id = ?").run(now(), t.id);
      }
    }
  }

  tasks(businessId: string) {
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE business_id = ? ORDER BY done_at IS NOT NULL, sort, created_at",
      )
      .all(businessId) as unknown as {
      id: string;
      title: string;
      detail: string;
      source: string;
      ref: string | null;
      done_at: string | null;
    }[];
  }

  setTaskDone(viewer: Person, taskId: string, done: boolean) {
    const t = this.db.prepare("SELECT business_id FROM tasks WHERE id = ?").get(taskId) as
      | { business_id: string }
      | undefined;
    if (!t) throw new HttpError(404, "No such task");
    this.ownedBusiness(viewer, t.business_id);
    this.db.prepare("UPDATE tasks SET done_at = ? WHERE id = ?").run(done ? now() : null, taskId);
    return this.tasks(t.business_id);
  }

  // ---------- public pages ----------

  publicBusiness(slug: string) {
    const b = this.db
      .prepare("SELECT * FROM businesses WHERE slug = ? AND published_at IS NOT NULL")
      .get(slug) as unknown as Business | undefined;
    if (!b) throw new HttpError(404, "This page is not published");
    const owner = this.person(b.owner_id);
    const offer = this.offerOf(b.id);
    const idea = this.ideaOf(b.id);
    return {
      slug: b.slug,
      name: b.name,
      tagline: b.tagline,
      about: b.about,
      family: b.family,
      stage: b.stage,
      published_at: b.published_at,
      founder: {
        id: owner.id,
        display_name: owner.display_name,
        headline: owner.headline,
        bio: owner.bio,
      },
      idea: idea.published_at
        ? { problem: idea.problem, why_me: idea.why_me, ask: idea.ask, evidence: idea.evidence }
        : null,
      offer: offer.published_at
        ? {
            title: offer.title,
            outcome: offer.outcome,
            audience: offer.audience,
            not_for: offer.not_for,
            deliverable: offer.deliverable,
            includes: offer.includes,
            price_cents: offer.price_cents,
            price_unit: offer.price_unit,
            first_free: offer.first_free,
            when_text: offer.when_text,
            where_text: offer.where_text,
            capacity: offer.capacity,
            confirmed: offer.confirmed,
          }
        : null,
      unknown: missingFacts(offer),
      action: customerAction(offer, b.family),
      interested: this.inquiryCount(b.id),
    };
  }

  isOwnerOf(viewer: Person, businessId: string) {
    const b = this.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(businessId) as
      | { owner_id: string }
      | undefined;
    return b?.owner_id === viewer.id;
  }

  /** A reply by someone the caller has already authorized (a helper checked on chain). */
  replyAsHelper(helper: Person, inquiryId: string, businessId: string, text: string) {
    const i = this.db.prepare("SELECT business_id FROM inquiries WHERE id = ?").get(inquiryId) as
      | { business_id: string }
      | undefined;
    if (i?.business_id !== businessId) throw new HttpError(404, "No such message");
    if (!text.trim()) throw new HttpError(400, "Write a reply");
    this.tx(() => {
      this.db
        .prepare("UPDATE inquiries SET reply = ?, replied_at = ? WHERE id = ?")
        .run(`${text.trim().slice(0, 2000)}\n— ${helper.display_name}`, now(), inquiryId);
      this.db
        .prepare(
          "UPDATE tasks SET done_at = COALESCE(done_at, ?) WHERE source = 'inquiry' AND ref = ?",
        )
        .run(now(), inquiryId);
      this.event("inquiry_replied", businessId, helper.id, { by: "helper" });
    });
  }

  isOwner(viewer: Person, slug: string) {
    const b = this.db.prepare("SELECT owner_id FROM businesses WHERE slug = ?").get(slug) as
      | { owner_id: string }
      | undefined;
    return b?.owner_id === viewer.id;
  }

  discover(query = "") {
    const rows = this.db
      .prepare(
        "SELECT slug FROM businesses WHERE published_at IS NOT NULL ORDER BY published_at DESC",
      )
      .all() as { slug: string }[];
    const words = [...new Set(terms(query))];
    return rows
      .map((r) => this.publicBusiness(r.slug))
      .map((b) => {
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
        return { ...b, matched };
      })
      .filter((b) => words.length === 0 || b.matched.length > 0)
      .sort((a, b) => b.matched.length - a.matched.length);
  }

  // ---------- inquiries ----------

  inquire(
    visitor: Person,
    slug: string,
    kind: "interest" | "question",
    message: string,
    shareContact: boolean,
    source = "unknown",
  ) {
    const b = this.db
      .prepare("SELECT * FROM businesses WHERE slug = ? AND published_at IS NOT NULL")
      .get(slug) as unknown as Business | undefined;
    if (!b) throw new HttpError(404, "This page is not published");
    if (b.owner_id === visitor.id) throw new HttpError(409, "This is your own business");
    const text = message.trim();
    if (kind === "question" && !text) throw new HttpError(400, "Write your question");
    const id = randomUUID();
    // Without consent the founder sees a first name only, in tasks as in messages.
    const shown = shareContact
      ? visitor.display_name
      : (visitor.display_name.split(" ")[0] ?? "Someone");
    this.tx(() => {
      this.db
        .prepare(
          "INSERT INTO inquiries (id, business_id, from_id, kind, message, share_contact, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          b.id,
          visitor.id,
          kind,
          text.slice(0, 2000),
          shareContact ? 1 : 0,
          ["link", "discovery", "need", "follow"].includes(source) ? source : "unknown",
          now(),
        );
      this.db
        .prepare(
          "INSERT OR IGNORE INTO tasks (id, business_id, title, detail, source, ref, sort, created_at) VALUES (?, ?, ?, ?, 'inquiry', ?, -1, ?)",
        )
        .run(
          randomUUID(),
          b.id,
          kind === "interest"
            ? `Reply to ${shown}: they are interested`
            : `Answer ${shown}'s question`,
          text ? `"${text.slice(0, 140)}"` : "They asked to hear when it opens.",
          id,
          now(),
        );
      this.event("inquiry_received", b.id, visitor.id, { kind });
    });
    return { id, business: b.name };
  }

  private inquiryCount(businessId: string) {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM inquiries WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
  }

  inquiriesFor(businessId: string) {
    return (
      this.db
        .prepare(
          "SELECT i.*, p.display_name AS from_name FROM inquiries i JOIN people p ON p.id = i.from_id WHERE i.business_id = ? ORDER BY i.created_at DESC",
        )
        .all(businessId) as unknown as {
        id: string;
        kind: string;
        message: string;
        share_contact: number;
        reply: string | null;
        from_name: string;
        created_at: string;
        replied_at: string | null;
      }[]
    ).map((i) => ({ ...i, from_name: i.from_name }));
  }

  /** What a person sent, and what their businesses received. */
  inbox(viewer: Person) {
    const received = this.db
      .prepare(
        "SELECT i.*, p.display_name AS from_name, b.name AS business_name, b.id AS business_id FROM inquiries i JOIN businesses b ON b.id = i.business_id JOIN people p ON p.id = i.from_id WHERE b.owner_id = ? ORDER BY i.created_at DESC",
      )
      .all(viewer.id);
    const sent = this.db
      .prepare(
        "SELECT i.id, i.kind, i.message, i.reply, i.created_at, i.replied_at, b.name AS business_name, b.slug FROM inquiries i JOIN businesses b ON b.id = i.business_id WHERE i.from_id = ? ORDER BY i.created_at DESC",
      )
      .all(viewer.id);
    return { received, sent };
  }

  reply(viewer: Person, inquiryId: string, text: string) {
    const i = this.db.prepare("SELECT business_id FROM inquiries WHERE id = ?").get(inquiryId) as
      | { business_id: string }
      | undefined;
    if (!i) throw new HttpError(404, "No such message");
    this.ownedBusiness(viewer, i.business_id);
    if (!text.trim()) throw new HttpError(400, "Write a reply");
    this.tx(() => {
      this.db
        .prepare("UPDATE inquiries SET reply = ?, replied_at = ? WHERE id = ?")
        .run(text.trim().slice(0, 2000), now(), inquiryId);
      this.db
        .prepare(
          "UPDATE tasks SET done_at = COALESCE(done_at, ?) WHERE source = 'inquiry' AND ref = ?",
        )
        .run(now(), inquiryId);
      this.event("inquiry_replied", i.business_id, viewer.id);
    });
    return this.inbox(viewer);
  }
}
