// Job 005c (M5): expert help connected to a real business task. Design: docs/design/EXPERT_HELP.md.
//
// - An expert profile is opt-in and self-reported (no ratings, badges, verification or AI scores).
// - The directory matches only on stated fields and says why each profile matched.
// - A help request is private to its two participants. Its snapshot is EXACTLY what the expert
//   receives; nothing else from the business or project attaches.
// - State machine (who may act): requested -> accepted (expert) | declined (expert) |
//   withdrawn (requester); accepted -> delivered (expert) | withdrawn (requester);
//   delivered -> completed (requester) | accepted (requester: "needs more"). Messages in
//   requested/accepted/delivered by either participant. Terminal: declined, withdrawn, completed.
// - Accepting grants NO operator, studio, customer, source, wallet or treasury access.
// - A business-linked request pauses when that business changes hands: no transitions or
//   messages, only reading and withdrawing; the new owner never inherits it.
// - Every write is idempotent by (actor, key); every event is appended, never changed.

import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const SKILLS = [
  "ai_workflows",
  "saas_api",
  "design",
  "evaluations",
  "near_integration",
  "operations",
] as const;
export type Skill = (typeof SKILLS)[number];
export const SKILL_LABEL: Record<Skill, string> = {
  ai_workflows: "AI workflows",
  saas_api: "SaaS and API implementation",
  design: "Product and interface design",
  evaluations: "AI evaluations and testing",
  near_integration: "NEAR integration",
  operations: "Operations",
};
const PRICING = ["fixed", "hourly", "quote", "unknown"] as const;
const CAPACITY = ["open", "limited", "full"] as const;
const LIMITS = {
  headline: 120,
  offer: 1200,
  availability: 200,
  pricing_note: 200,
  title: 120,
  text: 2000,
  body: 2000,
  key: 80,
  links: 5,
};

const bad = (m: string, s: 400 | 409 = 400): never => {
  throw new HttpError(s, m);
};
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
function text(v: unknown, max: number, what: string, multiline = true): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return bad(`${what} must be text`);
  let s = v.replace(CONTROL, "");
  if (!multiline) s = s.replace(/[\r\n\t]+/g, " ");
  s = s.trim();
  if (s.length > max) bad(`${what} is too long (at most ${max} characters)`);
  return s;
}
const now = () => new Date().toISOString();

export type RequestState =
  | "requested"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "delivered"
  | "completed";
type EventKind = "message" | "accept" | "decline" | "withdraw" | "deliver" | "complete" | "reopen";
const NEXT: Record<
  Exclude<EventKind, "message">,
  { from: RequestState[]; to: RequestState; by: "expert" | "requester" }
> = {
  accept: { from: ["requested"], to: "accepted", by: "expert" },
  decline: { from: ["requested"], to: "declined", by: "expert" },
  withdraw: { from: ["requested", "accepted"], to: "withdrawn", by: "requester" },
  deliver: { from: ["accepted"], to: "delivered", by: "expert" },
  complete: { from: ["delivered"], to: "completed", by: "requester" },
  reopen: { from: ["delivered"], to: "accepted", by: "requester" },
};
const OPEN: RequestState[] = ["requested", "accepted", "delivered"];

interface ProfileRow {
  person_id: string;
  state: "draft" | "published" | "unpublished";
  headline: string;
  offer: string;
  skills: string;
  availability: string;
  capacity: string;
  pricing_basis: string;
  pricing_note: string;
  links: string;
  version: number;
  updated_at: string;
  published_at: string | null;
}
interface RequestRow {
  id: string;
  requester_id: string;
  expert_id: string;
  business_id: string | null;
  project_id: string | null;
  owner_generation: number | null;
  state: RequestState;
  snapshot: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export const EXPERT_SCHEMA = `
CREATE TABLE IF NOT EXISTS expert_profiles (
  person_id TEXT PRIMARY KEY REFERENCES people(id),
  state TEXT NOT NULL CHECK (state IN ('draft','published','unpublished')),
  headline TEXT NOT NULL, offer TEXT NOT NULL, skills TEXT NOT NULL, availability TEXT NOT NULL,
  capacity TEXT NOT NULL CHECK (capacity IN ('open','limited','full')),
  pricing_basis TEXT NOT NULL CHECK (pricing_basis IN ('fixed','hourly','quote','unknown')),
  pricing_note TEXT NOT NULL, links TEXT NOT NULL, version INTEGER NOT NULL,
  updated_at TEXT NOT NULL, published_at TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS help_requests (
  id TEXT PRIMARY KEY, requester_id TEXT NOT NULL REFERENCES people(id),
  expert_id TEXT NOT NULL REFERENCES people(id),
  business_id TEXT REFERENCES businesses(id), project_id TEXT REFERENCES product_projects(id),
  owner_generation INTEGER,
  state TEXT NOT NULL CHECK (state IN ('requested','accepted','declined','withdrawn','delivered','completed')),
  snapshot TEXT NOT NULL, idempotency_key TEXT NOT NULL, version INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (requester_id, idempotency_key)
) STRICT;
CREATE INDEX IF NOT EXISTS help_requests_expert ON help_requests(expert_id, updated_at);
CREATE INDEX IF NOT EXISTS help_requests_requester ON help_requests(requester_id, updated_at);
CREATE TABLE IF NOT EXISTS help_request_events (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES help_requests(id),
  seq INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES people(id),
  kind TEXT NOT NULL CHECK (kind IN ('requested','message','accept','decline','withdraw','deliver','complete','reopen')),
  body TEXT NOT NULL, idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (request_id, seq), UNIQUE (request_id, actor_id, idempotency_key)
) STRICT;
CREATE TRIGGER IF NOT EXISTS help_request_events_no_update BEFORE UPDATE ON help_request_events
BEGIN SELECT RAISE(ABORT, 'help request events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS help_request_events_no_delete BEFORE DELETE ON help_request_events
BEGIN SELECT RAISE(ABORT, 'help request events are append-only'); END;
`;

export class ExpertHelp {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
  ) {
    db.exec(EXPERT_SCHEMA);
  }

  private name(id: string) {
    return (
      (
        this.db.prepare("SELECT display_name FROM people WHERE id = ?").get(id) as
          | { display_name: string }
          | undefined
      )?.display_name ?? ""
    );
  }

  private profileRow(personId: string) {
    return this.db.prepare("SELECT * FROM expert_profiles WHERE person_id = ?").get(personId) as
      | ProfileRow
      | undefined;
  }

  private profileView(r: ProfileRow, own: boolean) {
    const links = JSON.parse(r.links) as string[];
    return {
      person: { id: r.person_id, name: this.name(r.person_id) },
      state: own ? r.state : undefined,
      headline: r.headline,
      offer: r.offer,
      skills: (JSON.parse(r.skills) as Skill[]).map((k) => ({ key: k, label: SKILL_LABEL[k] })),
      availability: r.availability,
      capacity: r.capacity,
      pricing: { basis: r.pricing_basis, note: r.pricing_note },
      // Only public Everstreet businesses the expert chose; anything unpublished is dropped.
      work: links
        .map(
          (slug) =>
            this.db
              .prepare(
                "SELECT slug, name FROM businesses WHERE slug = ? AND published_at IS NOT NULL",
              )
              .get(slug) as { slug: string; name: string } | undefined,
        )
        .filter(Boolean),
      self_reported:
        "Everything here is what this person says about themselves. Everstreet doesn't verify it.",
      version: own ? r.version : undefined,
      updated_at: r.updated_at,
    };
  }

  // ---------- profiles ----------

  myProfile(viewer: Person) {
    const r = this.profileRow(viewer.id);
    return {
      profile: r ? this.profileView(r, true) : null,
      skills: SKILLS.map((k) => ({ key: k, label: SKILL_LABEL[k] })),
    };
  }

  saveProfile(viewer: Person, input: Record<string, unknown>) {
    const headline = text(input.headline, LIMITS.headline, "The headline", false);
    if (!headline) bad("Write a short headline");
    const offer = text(input.offer, LIMITS.offer, "The offer");
    if (!offer) bad("Say what you offer");
    const skills = input.skills;
    if (
      !Array.isArray(skills) ||
      skills.length < 1 ||
      skills.length > SKILLS.length ||
      !skills.every((s) => SKILLS.includes(s as Skill))
    )
      bad("Choose one or more of the listed skills");
    const capacity = CAPACITY.includes(input.capacity as never)
      ? (input.capacity as string)
      : bad("Choose your capacity");
    const pricing = PRICING.includes(input.pricing_basis as never)
      ? (input.pricing_basis as string)
      : bad("Choose a pricing basis (or unknown)");
    const links = Array.isArray(input.links) ? input.links : [];
    if (
      links.length > LIMITS.links ||
      !links.every((l) => typeof l === "string" && /^[a-z0-9-]{1,60}$/.test(l))
    )
      bad("Link up to 5 of your public Everstreet businesses by their page name");
    const version = Number(input.version ?? 0);
    const t = now();
    const prev = this.profileRow(viewer.id);
    if ((prev?.version ?? 0) !== version)
      bad("Your profile changed elsewhere. Reload to see the latest, then save again.", 409);
    this.db
      .prepare(
        `INSERT INTO expert_profiles (person_id, state, headline, offer, skills, availability, capacity, pricing_basis, pricing_note, links, version, updated_at, published_at)
         VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL)
         ON CONFLICT (person_id) DO UPDATE SET headline = excluded.headline, offer = excluded.offer, skills = excluded.skills,
           availability = excluded.availability, capacity = excluded.capacity, pricing_basis = excluded.pricing_basis,
           pricing_note = excluded.pricing_note, links = excluded.links, version = expert_profiles.version + 1, updated_at = excluded.updated_at`,
      )
      .run(
        viewer.id,
        headline,
        offer,
        JSON.stringify([...new Set(skills as string[])]),
        text(input.availability, LIMITS.availability, "Availability", false),
        capacity,
        pricing,
        text(input.pricing_note, LIMITS.pricing_note, "The pricing note", false),
        JSON.stringify(links),
        t,
      );
    return this.myProfile(viewer);
  }

  setPublished(viewer: Person, published: boolean) {
    const r = this.profileRow(viewer.id);
    if (!r) bad("Save your profile first", 409);
    this.db
      .prepare(
        "UPDATE expert_profiles SET state = ?, published_at = ?, updated_at = ?, version = version + 1 WHERE person_id = ?",
      )
      .run(published ? "published" : "unpublished", published ? now() : null, now(), viewer.id);
    return this.myProfile(viewer);
  }

  /** Published profiles only; each match says which stated field matched. */
  directory(query: { skill?: string; q?: string; capacity?: string }) {
    const skill =
      query.skill && SKILLS.includes(query.skill as Skill) ? (query.skill as Skill) : null;
    const q = (query.q ?? "").trim().toLowerCase().slice(0, 80);
    const rows = this.db
      .prepare(
        "SELECT * FROM expert_profiles WHERE state = 'published' ORDER BY updated_at DESC LIMIT 200",
      )
      .all() as unknown as ProfileRow[];
    const out = [];
    for (const r of rows) {
      const skills = JSON.parse(r.skills) as Skill[];
      const reasons: string[] = [];
      if (skill) {
        if (!skills.includes(skill)) continue;
        reasons.push(`Lists ${SKILL_LABEL[skill]}`);
      }
      if (q) {
        const hit = [
          ["headline", r.headline],
          ["offer", r.offer],
        ].find(([, v]) => (v as string).toLowerCase().includes(q));
        if (!hit) continue;
        reasons.push(`Their ${hit[0]} mentions "${q}"`);
      }
      if (query.capacity === "open" && r.capacity !== "open") continue;
      if (query.capacity === "open") reasons.push("Says they're taking new work");
      out.push({ ...this.profileView(r, false), reasons });
    }
    return {
      experts: out.slice(0, 50),
      skills: SKILLS.map((k) => ({ key: k, label: SKILL_LABEL[k] })),
      note: "Matches use only what each person stated. No ranking by AI, ratings or popularity.",
    };
  }

  publicProfile(personId: string) {
    const r = this.profileRow(personId);
    if (r?.state !== "published") throw new HttpError(404, "No such expert profile");
    return this.profileView(r, false);
  }

  // ---------- requests ----------

  private row(id: string) {
    return this.db.prepare("SELECT * FROM help_requests WHERE id = ?").get(String(id)) as
      | RequestRow
      | undefined;
  }

  private participant(viewer: Person, id: string) {
    const r = this.row(id);
    if (!r || (r.requester_id !== viewer.id && r.expert_id !== viewer.id))
      throw new HttpError(404, "No such help request");
    return r;
  }

  /** Paused when its business changed hands since it was made (generation or owner differs). */
  private paused(r: RequestRow) {
    if (!r.business_id) return false;
    const b = this.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(r.business_id) as
      | { owner_id: string }
      | undefined;
    const gen = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(r.business_id) as { n: number }
    ).n;
    return !b || b.owner_id !== r.requester_id || gen !== r.owner_generation;
  }

  private view(viewer: Person, r: RequestRow) {
    const events = this.db
      .prepare(
        "SELECT id, seq, actor_id, kind, body, created_at FROM help_request_events WHERE request_id = ? ORDER BY seq",
      )
      .all(r.id) as {
      id: string;
      seq: number;
      actor_id: string;
      kind: string;
      body: string;
      created_at: string;
    }[];
    const role = r.requester_id === viewer.id ? "requester" : "expert";
    const paused = OPEN.includes(r.state) && this.paused(r);
    const can = (k: Exclude<EventKind, "message">) =>
      !paused && NEXT[k].by === role && NEXT[k].from.includes(r.state);
    return {
      id: r.id,
      role,
      state: r.state,
      paused,
      paused_reason: paused
        ? "The business this request is about changed hands, so it's paused. Its history stays readable; the new owner can send their own request."
        : null,
      requester: { id: r.requester_id, name: this.name(r.requester_id) },
      expert: { id: r.expert_id, name: this.name(r.expert_id) },
      shared: JSON.parse(r.snapshot),
      events: events.map((e) => ({ ...e, actor: this.name(e.actor_id) })),
      actions: (Object.keys(NEXT) as Exclude<EventKind, "message">[]).filter(can),
      can_message: !paused && OPEN.includes(r.state),
      version: r.version,
      authority:
        "Discussing or accepting this request grants no access to the business, its studio, customers, source, wallet or treasury.",
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  /** The exact snapshot the expert would receive, before anything is sent. */
  preview(viewer: Person, input: Record<string, unknown>) {
    return { shared: this.snapshot(viewer, input).snapshot };
  }

  private snapshot(viewer: Person, input: Record<string, unknown>) {
    const expertId = String(input.expert_id ?? "");
    const p = this.profileRow(expertId);
    if (p?.state !== "published") throw new HttpError(404, "No such expert profile");
    if (expertId === viewer.id) bad("You can't send a request to yourself");
    const title = text(input.title, LIMITS.title, "The title", false);
    const task = text(input.task, LIMITS.text, "The task");
    if (!title || !task) bad("Give the request a title and describe the task");
    let context: {
      business: { id: string; name: string } | null;
      project: { id: string; name: string } | null;
    } = { business: null, project: null };
    let businessId: string | null = null;
    let projectId: string | null = null;
    let generation: number | null = null;
    if (input.business_id) {
      // Only a business the requester controls now; nothing private is read from it.
      const epoch = this.store.controlEpoch(viewer, String(input.business_id));
      businessId = epoch.businessId;
      generation = epoch.generation;
      const b = this.db.prepare("SELECT name FROM businesses WHERE id = ?").get(businessId) as {
        name: string;
      };
      context = { business: { id: businessId, name: b.name }, project: null };
      if (input.project_id) {
        const pr = this.db
          .prepare("SELECT id FROM product_projects WHERE id = ? AND business_id = ?")
          .get(String(input.project_id), businessId) as { id: string } | undefined;
        if (!pr) bad("That project isn't part of this business");
        projectId = (pr as { id: string }).id;
        const head = this.db
          .prepare(
            "SELECT brief FROM product_revisions WHERE project_id = ? ORDER BY number DESC LIMIT 1",
          )
          .get(projectId) as { brief: string } | undefined;
        context.project = {
          id: projectId as string,
          name: head
            ? ((JSON.parse(head.brief) as { name?: string }).name ?? "Untitled product")
            : "Untitled product",
        };
      }
    }
    const amount =
      input.budget_amount === undefined ||
      input.budget_amount === null ||
      input.budget_amount === ""
        ? null
        : Number(input.budget_amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e9))
      bad("The budget must be a number");
    const unit = text(input.budget_unit, 20, "The budget unit", false);
    if (amount !== null && !unit) bad("Say what the budget is in (e.g. USD, hours)");
    return {
      businessId,
      projectId,
      generation,
      expertId,
      snapshot: {
        title,
        task,
        outcome: text(input.outcome, LIMITS.text, "The desired outcome"),
        deliverables: text(input.deliverables, LIMITS.text, "The deliverables"),
        timing: text(input.timing, 200, "The timing", false),
        budget: amount === null ? null : { amount, unit, note: "A budget, not an agreed price." },
        context,
        not_shared:
          "Nothing else is shared: no customer documents or results, costs, source connections, credentials or conversations.",
      },
    };
  }

  create(viewer: Person, input: Record<string, unknown>) {
    const key = text(input.idempotency_key, LIMITS.key, "The request key", false);
    if (!key) bad("A request key is required (idempotency_key)");
    const prior = this.db
      .prepare("SELECT * FROM help_requests WHERE requester_id = ? AND idempotency_key = ?")
      .get(viewer.id, key) as RequestRow | undefined;
    if (prior) return { created: false, request: this.view(viewer, prior) };
    const s = this.snapshot(viewer, input);
    if (s.businessId) this.store.requireNoHandover(s.businessId);
    const id = randomUUID();
    const t = now();
    this.store.tx(() => {
      if (s.businessId)
        this.store.stillControls(viewer, {
          businessId: s.businessId,
          generation: s.generation as number,
        });
      this.db
        .prepare(
          "INSERT INTO help_requests (id, requester_id, expert_id, business_id, project_id, owner_generation, state, snapshot, idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, 1, ?, ?)",
        )
        .run(
          id,
          viewer.id,
          s.expertId,
          s.businessId,
          s.projectId,
          s.generation,
          JSON.stringify(s.snapshot),
          key,
          t,
          t,
        );
      this.db
        .prepare(
          "INSERT INTO help_request_events (id, request_id, seq, actor_id, kind, body, idempotency_key, created_at) VALUES (?, ?, 1, ?, 'requested', '', ?, ?)",
        )
        .run(randomUUID(), id, viewer.id, key, t);
    });
    return { created: true, request: this.view(viewer, this.row(id) as RequestRow) };
  }

  list(viewer: Person) {
    const rows = this.db
      .prepare(
        "SELECT * FROM help_requests WHERE requester_id = ? OR expert_id = ? ORDER BY updated_at DESC LIMIT 100",
      )
      .all(viewer.id, viewer.id) as unknown as RequestRow[];
    return {
      requests: rows.map((r) => {
        const v = this.view(viewer, r);
        return {
          id: v.id,
          role: v.role,
          state: v.state,
          paused: v.paused,
          title: v.shared.title,
          with: v.role === "requester" ? v.expert : v.requester,
          updated_at: r.updated_at,
        };
      }),
    };
  }

  get(viewer: Person, id: string) {
    return this.view(viewer, this.participant(viewer, id));
  }

  act(viewer: Person, id: string, input: Record<string, unknown>) {
    const r = this.participant(viewer, id);
    const kind = input.kind as EventKind;
    if (kind !== "message" && !(kind in NEXT)) bad("Unknown action");
    const key = text(input.idempotency_key, LIMITS.key, "The request key", false);
    if (!key) bad("A request key is required (idempotency_key)");
    const replay = this.db
      .prepare(
        "SELECT kind FROM help_request_events WHERE request_id = ? AND actor_id = ? AND idempotency_key = ?",
      )
      .get(r.id, viewer.id, key) as { kind: string } | undefined;
    if (replay) {
      if (replay.kind !== kind)
        bad("This request key was already used for a different action", 409);
      return { created: false, request: this.view(viewer, this.row(r.id) as RequestRow) };
    }
    const body = text(input.body, LIMITS.body, "The message");
    if (kind === "message" && !body) bad("Write a message");
    if (kind === "deliver" && !body) bad("Describe what you delivered");
    const role = r.requester_id === viewer.id ? "requester" : "expert";
    this.store.tx(() => {
      const cur = this.row(r.id) as RequestRow;
      if (OPEN.includes(cur.state) && this.paused(cur) && kind !== "withdraw")
        bad("The business this request is about changed hands, so it's paused", 409);
      if (kind === "message") {
        if (!OPEN.includes(cur.state)) bad("This request is closed", 409);
      } else {
        const rule = NEXT[kind];
        if (rule.by !== role) bad(`Only the ${rule.by} can do that`, 409);
        if (!rule.from.includes(cur.state))
          bad(`Not possible while the request is ${cur.state}`, 409);
        this.db
          .prepare(
            "UPDATE help_requests SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND state = ?",
          )
          .run(rule.to, now(), cur.id, cur.state);
      }
      if (kind === "message")
        this.db.prepare("UPDATE help_requests SET updated_at = ? WHERE id = ?").run(now(), cur.id);
      const seq =
        ((
          this.db
            .prepare("SELECT MAX(seq) AS n FROM help_request_events WHERE request_id = ?")
            .get(cur.id) as { n: number }
        ).n ?? 0) + 1;
      this.db
        .prepare(
          "INSERT INTO help_request_events (id, request_id, seq, actor_id, kind, body, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(randomUUID(), cur.id, seq, viewer.id, kind, body, key, now());
    });
    return { created: true, request: this.view(viewer, this.row(r.id) as RequestRow) };
  }
}
