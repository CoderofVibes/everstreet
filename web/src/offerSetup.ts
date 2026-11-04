// Job 003r: a founder connects a tested release to its customers. The owner reads a readiness
// summary made of local facts (configured / unavailable / unknown), inspects one plan number
// (observed terms with their block), reviews the exact terms and creates one offer that must
// present the digest of what was reviewed. Creating is idempotent: a lost answer keeps the
// original request apart from the draft, and "recover" resends exactly it. Retiring targets one
// exact offer and is safely repeatable. Nothing here publishes, connects or signs anything.

import { ApiError } from "./api.ts";
import { call, MalformedAnswer } from "./customerApi.ts";
import type { Storage } from "./customerWorkspace.ts";

// ---------- answers, parsed strictly ----------

export type Evidence = "observed" | "configured" | "unavailable" | "unknown";

export interface ReadinessItem {
  key: string;
  label: string;
  state: Evidence;
  detail: string;
  next: string | null;
}

export interface ProductName {
  name: string;
  revision: number | null;
}

export interface Readiness {
  owner_generation: number;
  evaluated_at: string;
  items: ReadinessItem[];
  next: string | null;
  release: {
    id: string;
    artifact_digest: string;
    activated_at: string;
    product: ProductName;
  } | null;
  offers: { active: number; retired: number };
}

export interface PlanTerms {
  unit_price: string;
  max_units_per_purchase: number;
  max_units_outstanding: number;
  max_hold_units: number;
  hold_ttl_ms: string;
  settle_grace_ms: string;
  created_generation: number;
}

export interface Block {
  height: string;
  hash: string;
  timestamp_ms: string;
}

export interface Inspection {
  release: {
    id: string;
    project_id: string;
    artifact_digest: string;
    activated_at: string;
    product: ProductName;
  };
  source: { network: string; account: string };
  plan_id: number;
  plan: PlanTerms;
  asset: string;
  retention_days: number;
  block: Block;
  metering: { operator: string | null; platform_meters: boolean | null };
  owner_generation: number;
  terms_digest: string;
  active_offer: string | null;
}

export interface OwnerOffer {
  id: string;
  state: "active" | "retired";
  release_id: string;
  project_id: string;
  artifact_digest: string;
  product: ProductName;
  source: { network: string; account: string };
  plan_id: number;
  plan: PlanTerms;
  asset: string;
  read_block: Block;
  retention_days: number;
  created_at: string;
  retired_at: string | null;
}

const fail = (where: string): never => {
  throw new MalformedAnswer(`The answer wasn't in the expected form (${where}).`);
};
const obj = (v: unknown, where: string) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(where);
const str = (v: unknown, where: string) => (typeof v === "string" ? v : fail(where));
const dec = (v: unknown, where: string) =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v) ? v : fail(where);
const int = (v: unknown, where: string) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail(where);
const hex32 = (v: unknown, where: string) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail(where);
const nullable = <T>(v: unknown, f: (x: unknown) => T) => (v === null ? null : f(v));
const EVIDENCE = ["observed", "configured", "unavailable", "unknown"] as const;

function parseProduct(raw: unknown): ProductName {
  const p = obj(raw, "product");
  return {
    name: str(p.name, "product.name"),
    revision: nullable(p.revision, (x) => int(x, "product.revision")),
  };
}

function parseBlock(raw: unknown, where: string): Block {
  const b = obj(raw, where);
  return {
    height: dec(b.height, `${where}.height`),
    hash: str(b.hash, `${where}.hash`),
    timestamp_ms: dec(b.timestamp_ms, `${where}.timestamp_ms`),
  };
}

function parsePlan(raw: unknown): PlanTerms {
  const p = obj(raw, "plan");
  return {
    unit_price: dec(p.unit_price, "plan.unit_price"),
    max_units_per_purchase: int(p.max_units_per_purchase, "plan.max_units_per_purchase"),
    max_units_outstanding: int(p.max_units_outstanding, "plan.max_units_outstanding"),
    max_hold_units: int(p.max_hold_units, "plan.max_hold_units"),
    hold_ttl_ms: dec(p.hold_ttl_ms, "plan.hold_ttl_ms"),
    settle_grace_ms: dec(p.settle_grace_ms, "plan.settle_grace_ms"),
    created_generation: int(p.created_generation, "plan.created_generation"),
  };
}

function parseSource(raw: unknown) {
  const s = obj(raw, "source");
  return { network: str(s.network, "source.network"), account: str(s.account, "source.account") };
}

export function parseReadiness(raw: unknown): Readiness {
  const r = obj(obj(raw, "answer").readiness, "readiness");
  const items = Array.isArray(r.items) ? r.items : fail("readiness.items");
  if (items.length > 30) fail("readiness.items");
  const release = nullable(r.release, (x) => {
    const v = obj(x, "readiness.release");
    return {
      id: str(v.id, "release.id"),
      artifact_digest: hex32(v.artifact_digest, "release.artifact_digest"),
      activated_at: str(v.activated_at, "release.activated_at"),
      product: parseProduct(v.product),
    };
  });
  const offers = obj(r.offers, "readiness.offers");
  return {
    owner_generation: int(r.owner_generation, "readiness.owner_generation"),
    evaluated_at: str(r.evaluated_at, "readiness.evaluated_at"),
    items: items.map((x) => {
      const i = obj(x, "readiness.item");
      const state = i.state;
      if (typeof state !== "string" || !(EVIDENCE as readonly string[]).includes(state))
        fail("readiness.item.state");
      return {
        key: str(i.key, "item.key"),
        label: str(i.label, "item.label"),
        state: state as Evidence,
        detail: str(i.detail, "item.detail"),
        next: nullable(i.next, (n) => str(n, "item.next")),
      };
    }),
    next: nullable(r.next, (n) => str(n, "readiness.next")),
    release,
    offers: {
      active: int(offers.active, "offers.active"),
      retired: int(offers.retired, "offers.retired"),
    },
  };
}

export function parseInspection(raw: unknown): Inspection {
  const i = obj(obj(raw, "answer").inspection, "inspection");
  const rel = obj(i.release, "inspection.release");
  const m = obj(i.metering, "inspection.metering");
  return {
    release: {
      id: str(rel.id, "release.id"),
      project_id: str(rel.project_id, "release.project_id"),
      artifact_digest: hex32(rel.artifact_digest, "release.artifact_digest"),
      activated_at: str(rel.activated_at, "release.activated_at"),
      product: parseProduct(rel.product),
    },
    source: parseSource(i.source),
    plan_id: int(i.plan_id, "inspection.plan_id"),
    plan: parsePlan(i.plan),
    asset: str(i.asset, "inspection.asset"),
    retention_days: int(i.retention_days, "inspection.retention_days"),
    block: parseBlock(i.block, "inspection.block"),
    metering: {
      operator: nullable(m.operator, (x) => str(x, "metering.operator")),
      platform_meters: nullable(m.platform_meters, (x) =>
        typeof x === "boolean" ? x : fail("metering.platform_meters"),
      ),
    },
    owner_generation: int(i.owner_generation, "inspection.owner_generation"),
    terms_digest: hex32(i.terms_digest, "inspection.terms_digest"),
    active_offer: nullable(i.active_offer, (x) => str(x, "inspection.active_offer")),
  };
}

export function parseOwnerOffer(raw: unknown): OwnerOffer {
  const o = obj(raw, "offer");
  const state = o.state === "active" || o.state === "retired" ? o.state : fail("offer.state");
  return {
    id: str(o.id, "offer.id"),
    state,
    release_id: str(o.release_id, "offer.release_id"),
    project_id: str(o.project_id, "offer.project_id"),
    artifact_digest: hex32(o.artifact_digest, "offer.artifact_digest"),
    product: parseProduct(o.product),
    source: parseSource(o.source),
    plan_id: int(o.plan_id, "offer.plan_id"),
    plan: parsePlan(o.plan),
    asset: str(o.asset, "offer.asset"),
    read_block: parseBlock(o.read_block, "offer.read_block"),
    retention_days: int(o.retention_days, "offer.retention_days"),
    created_at: str(o.created_at, "offer.created_at"),
    retired_at: nullable(o.retired_at, (x) => str(x, "offer.retired_at")),
  };
}

export function parseOwnerOffers(raw: unknown): OwnerOffer[] {
  const list = obj(raw, "answer").offers;
  if (!Array.isArray(list) || list.length > 50) fail("offers");
  return (list as unknown[]).map(parseOwnerOffer);
}

// ---------- the port ----------

export interface CreateBody {
  idempotency_key: string;
  release_id: string;
  plan_id: number;
  retention_days: number;
  reviewed_terms: string;
}

/** What the controller calls; tests pass their own over the real app. */
export interface OfferPort {
  readiness(businessId: string, projectId: string): Promise<unknown>;
  list(businessId: string): Promise<unknown>;
  inspect(
    businessId: string,
    body: { release_id: string; plan_id: number; retention_days: number },
  ): Promise<unknown>;
  create(businessId: string, body: CreateBody): Promise<unknown>;
  retire(businessId: string, offerId: string): Promise<unknown>;
}

const enc = encodeURIComponent;
export const offerHttp: OfferPort = {
  readiness: (b, p) => call(`/api/businesses/${enc(b)}/customer-offer-readiness?project=${enc(p)}`),
  list: (b) => call(`/api/businesses/${enc(b)}/customer-offers`),
  inspect: (b, body) => call(`/api/businesses/${enc(b)}/customer-offer-inspections`, "POST", body),
  create: (b, body) => call(`/api/businesses/${enc(b)}/customer-offers`, "POST", body),
  retire: (b, o) => call(`/api/businesses/${enc(b)}/customer-offers/${enc(o)}/retire`, "POST"),
};

// ---------- the controller ----------

export type OfferAction = "load" | "inspect" | "create" | "recover" | "retire";

export interface OfferNotice {
  tone: "ok" | "warn" | "error";
  code: string | null;
  message: string;
}

export interface OfferSetupState {
  status: "loading" | "ready" | "gone" | "error";
  readiness: Readiness | null;
  offers: OwnerOffer[];
  /** What is typed: never sent until inspected, and never mixed with a pending create. */
  draft: { plan: string; retention: string };
  /** The observed terms the owner is reviewing, read for exactly the inspected values. */
  inspection: Inspection | null;
  /** A create whose answer didn't come back: its exact terms, kept apart from the draft. */
  unanswered: { plan_id: number; retention_days: number } | null;
  /** The offer this page just created (or recovered), to open its customer page. */
  created: string | null;
  /** The offer the owner asked to retire, waiting for a second, confirming click. */
  confirmRetire: string | null;
  busy: OfferAction | null;
  notice: OfferNotice | null;
}

const LOST =
  "We didn't get an answer. Nothing is lost: recovering resends the same request and never creates a second offer.";
export const OFFER_ACCESS_ENDED =
  "You no longer manage this business, so its offers aren't shown here. Nothing was changed.";

const messageOf = (e: unknown) =>
  e instanceof ApiError
    ? e.message
    : e instanceof MalformedAnswer
      ? "The answer wasn't in the expected form, so nothing new is shown. You can try again."
      : LOST;

/** Not answered: it may have happened, so only the same request may follow. */
const unansweredError = (e: unknown) =>
  !(e instanceof ApiError) || e.status >= 500 || e instanceof MalformedAnswer;

const PLAN = /^[1-9][0-9]{0,9}$/;
const DAYS = /^[1-9][0-9]{0,2}$/;

export function draftProblem(d: { plan: string; retention: string }): string | null {
  const plan = d.plan.trim();
  const days = d.retention.trim();
  if (!PLAN.test(plan) || Number(plan) > 0xffff_ffff)
    return "Enter the contract's plan number: a whole number from 1.";
  if (!DAYS.test(days) || Number(days) > 365) return "Keep results for 1 to 365 days.";
  return null;
}

export class OfferSetup {
  private state: OfferSetupState = {
    status: "loading",
    readiness: null,
    offers: [],
    draft: { plan: "1", retention: "30" },
    inspection: null,
    unanswered: null,
    created: null,
    confirmRetire: null,
    busy: null,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private alive = true;
  /** Bumped on retirement of this page: older answers land nowhere. */
  private generation = 0;
  /** The create in flight or unanswered: its exact body, to resend the same request. */
  private pending: CreateBody | null = null;

  constructor(
    private readonly port: OfferPort,
    private readonly opts: {
      personId: string;
      businessId: string;
      projectId: string;
      storage?: Storage | null;
      makeKey?: () => string;
    },
  ) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  retire() {
    this.alive = false;
    this.generation++;
    this.listeners.clear();
  }
  private set(patch: Partial<OfferSetupState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private storeKey() {
    return `everstreet.offer.${this.opts.personId}.${this.opts.businessId}.${this.opts.projectId}`;
  }
  /** Only the owner's own create body (no secret, no customer data); denied storage never blocks. */
  private remember(v: CreateBody | null) {
    const s = this.opts.storage;
    if (!s) return;
    try {
      if (v) s.setItem(this.storeKey(), JSON.stringify(v));
      else s.removeItem(this.storeKey());
    } catch {
      // Storage denied: recovery after a reload isn't available; in this page it still is.
    }
  }
  private recall(): CreateBody | null {
    try {
      const v = JSON.parse(this.opts.storage?.getItem(this.storeKey()) ?? "null") as CreateBody;
      return v &&
        typeof v.idempotency_key === "string" &&
        /^[A-Za-z0-9_-]{8,80}$/.test(v.idempotency_key) &&
        typeof v.release_id === "string" &&
        Number.isSafeInteger(v.plan_id) &&
        Number.isSafeInteger(v.retention_days) &&
        typeof v.reviewed_terms === "string" &&
        /^[0-9a-f]{64}$/.test(v.reviewed_terms)
        ? {
            idempotency_key: v.idempotency_key,
            release_id: v.release_id,
            plan_id: v.plan_id,
            retention_days: v.retention_days,
            reviewed_terms: v.reviewed_terms,
          }
        : null;
    } catch {
      return null;
    }
  }

  private gone() {
    this.pending = null;
    this.remember(null);
    this.set({
      status: "gone",
      readiness: null,
      offers: [],
      inspection: null,
      unanswered: null,
      created: null,
      confirmRetire: null,
      busy: null,
      notice: { tone: "warn", code: "access_ended", message: OFFER_ACCESS_ENDED },
    });
  }

  private async act(action: OfferAction, f: (gen: number) => Promise<void>) {
    if (this.state.busy || !this.alive || this.state.status === "gone") return;
    const gen = this.generation;
    this.set({ busy: action, notice: null });
    try {
      await f(gen);
    } catch (e) {
      if (gen !== this.generation) return;
      // A 404 may mean this person no longer manages the business: check, don't assume.
      if (e instanceof ApiError && e.status === 404 && (await this.stillOwner(gen)) === false)
        return this.gone();
      if (gen !== this.generation) return;
      this.set({
        notice: {
          tone: e instanceof ApiError && e.status < 500 ? "error" : "warn",
          code: e instanceof ApiError ? (e.code ?? null) : null,
          message: messageOf(e),
        },
      });
    } finally {
      if (gen === this.generation) this.set({ busy: null });
    }
  }

  /** True or false when known; null when the check itself wasn't answered. */
  private async stillOwner(gen: number): Promise<boolean | null> {
    try {
      await this.reload(gen);
      return true;
    } catch (e) {
      return e instanceof ApiError && e.status === 404 ? false : null;
    }
  }

  /** Readiness and offers, read together; nothing on the page claims more than they say. */
  private async reload(gen: number) {
    const [r, o] = await Promise.all([
      this.port.readiness(this.opts.businessId, this.opts.projectId),
      this.port.list(this.opts.businessId),
    ]);
    const readiness = parseReadiness(r);
    const offers = parseOwnerOffers(o);
    if (gen !== this.generation) return;
    // A review made under another ownership is no longer a review of these terms.
    const inspection =
      this.state.inspection?.owner_generation === readiness.owner_generation
        ? this.state.inspection
        : null;
    this.set({ status: "ready", readiness, offers, inspection });
  }

  async start() {
    const stored = this.recall();
    if (stored && !this.pending) {
      this.pending = stored;
      this.set({
        unanswered: { plan_id: stored.plan_id, retention_days: stored.retention_days },
      });
    }
    await this.act("load", async (gen) => {
      try {
        await this.reload(gen);
      } catch (e) {
        if (gen === this.generation && !(e instanceof ApiError && e.status === 404))
          this.set({ status: this.state.readiness ? "ready" : "error" });
        throw e;
      }
    });
  }

  refresh() {
    return this.act("load", (gen) => this.reload(gen));
  }

  setDraft(patch: Partial<{ plan: string; retention: string }>) {
    const draft = { ...this.state.draft, ...patch };
    const i = this.state.inspection;
    // Changed values aren't what was reviewed: the review is set aside, never re-labelled.
    const same =
      i !== null &&
      draft.plan.trim() === String(i.plan_id) &&
      draft.retention.trim() === String(i.retention_days);
    this.set({ draft, inspection: same ? i : null });
  }

  /** One bounded read of the typed plan number, with the typed retention. */
  inspect() {
    const problem = draftProblem(this.state.draft);
    if (problem) {
      this.set({ notice: { tone: "error", code: "draft_invalid", message: problem } });
      return Promise.resolve();
    }
    const release = this.state.readiness?.release;
    if (!release) {
      this.set({
        notice: {
          tone: "warn",
          code: "no_release",
          message: "Release a tested version first; an offer names one exact release.",
        },
      });
      return Promise.resolve();
    }
    const plan_id = Number(this.state.draft.plan.trim());
    const retention_days = Number(this.state.draft.retention.trim());
    return this.act("inspect", async (gen) => {
      this.set({ inspection: null });
      const answer = await this.port.inspect(this.opts.businessId, {
        release_id: release.id,
        plan_id,
        retention_days,
      });
      const inspection = parseInspection(answer);
      if (gen !== this.generation) return;
      if (
        inspection.plan_id !== plan_id ||
        inspection.retention_days !== retention_days ||
        inspection.release.id !== release.id
      )
        throw new MalformedAnswer("The inspection answered for other terms.");
      // Only if the draft still says what was inspected.
      const d = this.state.draft;
      if (d.plan.trim() !== String(plan_id) || d.retention.trim() !== String(retention_days))
        return;
      this.set({ inspection });
    });
  }

  /** Create exactly the reviewed terms. While a create is unanswered, only it may be resent. */
  create() {
    if (this.pending) {
      this.set({
        notice: {
          tone: "warn",
          code: "recover_first",
          message:
            "An earlier offer request wasn't answered. Recover it first: it's the same request, so nothing is made twice.",
        },
      });
      return Promise.resolve();
    }
    const i = this.state.inspection;
    if (!i) {
      this.set({
        notice: {
          tone: "warn",
          code: "not_reviewed",
          message: "Inspect the plan and review its terms first.",
        },
      });
      return Promise.resolve();
    }
    const key = (this.opts.makeKey ?? (() => `offer-${crypto.randomUUID()}`))();
    this.pending = {
      idempotency_key: key,
      release_id: i.release.id,
      plan_id: i.plan_id,
      retention_days: i.retention_days,
      reviewed_terms: i.terms_digest,
    };
    this.remember(this.pending);
    return this.act("create", (gen) => this.send(gen));
  }

  /** Resend the unanswered create exactly as it was, whatever the draft says now. */
  recoverOriginal() {
    if (!this.pending) return Promise.resolve();
    return this.act("recover", (gen) => this.send(gen));
  }

  private async send(gen: number) {
    const p = this.pending as CreateBody;
    let offer: OwnerOffer;
    try {
      const answer = obj(await this.port.create(this.opts.businessId, p), "answer");
      offer = parseOwnerOffer(answer.offer);
      if (offer.plan_id !== p.plan_id || offer.retention_days !== p.retention_days)
        throw new MalformedAnswer("The offer answered with other terms.");
    } catch (e) {
      if (gen === this.generation) {
        if (unansweredError(e)) {
          this.set({ unanswered: { plan_id: p.plan_id, retention_days: p.retention_days } });
        } else {
          // A definite answer: nothing was created under this key.
          this.pending = null;
          this.remember(null);
          const changed = e instanceof ApiError && e.code === "terms_changed";
          this.set({ unanswered: null, inspection: changed ? null : this.state.inspection });
        }
        await this.reload(gen).catch(() => {});
      }
      throw e;
    }
    if (gen !== this.generation) return;
    this.pending = null;
    this.remember(null);
    this.set({
      unanswered: null,
      inspection: null,
      created: offer.id,
      notice: {
        tone: offer.state === "active" ? "ok" : "warn",
        code: offer.state === "active" ? "offer_active" : "offer_retired",
        message:
          offer.state === "active"
            ? "The offer is active. Customers can open it from the business page; nothing else was connected or published."
            : "That request's offer was retired since; a retry never reactivates it. Review the terms again to make a new offer.",
      },
    });
    await this.reload(gen);
  }

  /** First click asks; the second retires that exact offer. Repeating it is harmless. */
  retireOffer(offerId: string) {
    if (this.state.confirmRetire !== offerId) {
      this.set({ confirmRetire: offerId, notice: null });
      return Promise.resolve();
    }
    return this.act("retire", async (gen) => {
      try {
        const answer = obj(await this.port.retire(this.opts.businessId, offerId), "answer");
        const o = parseOwnerOffer(answer.offer);
        if (o.id !== offerId || o.state !== "retired")
          throw new MalformedAnswer("The answer named another offer.");
        if (gen !== this.generation) return;
        this.set({
          confirmRetire: null,
          notice: {
            tone: "ok",
            code: "offer_retired",
            message:
              "Retired: no new uses start. Customers keep their requests, results and units.",
          },
        });
      } finally {
        if (gen === this.generation) await this.reload(gen).catch(() => {});
      }
    });
  }

  cancelRetire() {
    this.set({ confirmRetire: null });
  }
}
