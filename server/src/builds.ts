// Durable build jobs. A job builds one immutable product revision with one pinned provider
// configuration under a budget reserved before anything is dispatched. Workers claim jobs
// atomically and every worker write is fenced by (attempt, lease owner, unexpired lease, live
// state), so a cancelled, expired or superseded worker can never dispatch or record success.
// Dispatch intent is persisted before the provider is called; after a restart or a lapsed
// lease, work that was never dispatched is requeued and work that may have reached the
// provider is held for reconciliation, never re-run on its own. Usage is settled only by the
// provider's complete receipt; partial reports and silence keep the reservation held. Usage
// over the request's limits stops the attempt and its output is never used. Ownership is
// captured at request time and rechecked before claiming, before dispatch, on every stream
// event, in quiet heartbeats and before applying output. Build-time usage is its own ledger
// ("build"), separate from any customer runtime usage.

import { createHash, randomUUID } from "node:crypto";
import { APP_SCHEMA, MAX_BUNDLE_BYTES, validateBundle } from "./appBundle.ts";
import { MAX_ARTIFACT_BYTES, validateArtifact } from "./artifacts.ts";
import {
  conversationFor,
  PROPOSAL_SCHEMA,
  type Proposal,
  recordProposal,
  validateProposal,
} from "./authoring.ts";
import {
  type BuildAvailability,
  type BuildEvent,
  type BuildLimits,
  type BuildPricing,
  type BuildProvider,
  buildAvailability,
  ceilCents,
  costMicroCents,
  validPricing,
  worstCaseCents,
} from "./build.ts";
import type { Db } from "./db.ts";
import type { Brief, Foundation, Prototype } from "./products.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const BUILD_LIMITS = {
  maxInputTokens: 200_000,
  maxOutputTokens: 32_000,
  minSeconds: 10,
  maxSeconds: 900,
  maxCostCents: 100_000,
  maxBudgetCents: 1_000_000,
  eventsPage: 100,
  /** Largest token count accepted in any one usage report. */
  maxReportedTokens: 1_000_000_000,
} as const;

export type JobState =
  | "queued"
  | "running"
  | "validating"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";

const LIVE: JobState[] = ["queued", "running", "validating"];
const TERMINAL: JobState[] = ["succeeded", "failed", "cancelled", "needs_reconciliation"];

export interface BuildBudget {
  max_input_tokens: number;
  max_output_tokens: number;
  max_seconds: number;
  max_cost_cents: number;
}

/** How much of the attempt's usage is known. */
export type UsageView = "none" | "partial" | "final" | "unknown";

interface JobRow {
  id: string;
  project_id: string;
  business_id: string;
  revision: number;
  content_hash: string;
  intent: "build" | "propose" | "app";
  idempotency_key: string;
  fingerprint: string;
  request_ref: string | null;
  /** Job 002e: for `app`, the version a change starts from, and the founder's instructions. */
  base_job: string | null;
  instructions: string | null;
  provider: string;
  provider_config: string;
  budget: string;
  pricing: string;
  retry_of: string | null;
  requested_by: string;
  owner_id: string;
  owner_generation: number;
  state: JobState;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
  dispatched_at: string | null;
  cancel_requested_at: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  reserved_cents: number;
  charged_cents: number;
  charged_microcents: number;
  usage_state: "none" | "reported" | "unknown";
  usage_final: number;
  input_tokens: number;
  output_tokens: number;
  event_count: number;
  artifact_digest: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

/** Job 002e: the version an app change starts from, as validated data (or none). */
function baseVersion(db: Db, jobId: string | null) {
  if (!jobId) return null;
  const a = db
    .prepare(
      "SELECT digest, content FROM build_artifacts WHERE job_id = ? AND kind = 'web_app_bundle'",
    )
    .get(jobId) as { digest: string; content: string } | undefined;
  return a ? { job: jobId, digest: a.digest, bundle: JSON.parse(a.content) as unknown } : null;
}

// ---------- plain-data hygiene for anything a provider says ----------

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const SECRETS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*(?:Bearer\s+)?\S+/gi,
  /ed25519:[1-9A-HJ-NP-Za-km-z]{20,}/g,
  /secp256k1:[1-9A-HJ-NP-Za-km-z]{20,}/g,
];

/** Bounded, single-line, with anything that looks like a credential removed. */
export function redact(text: unknown, max = 300): string {
  let s = String(text ?? "")
    .replace(CONTROL, " ")
    .trim();
  for (const re of SECRETS) s = s.replace(re, "[redacted]");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

function bad(message: string): never {
  throw new HttpError(400, message);
}

function whole(v: unknown, min: number, max: number, what: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
    bad(`${what} must be a whole number from ${min} to ${max}`);
  return n as number;
}

export function parseBudget(input: unknown): BuildBudget {
  if (!input || typeof input !== "object" || Array.isArray(input))
    bad("Give the build's limits (budget)");
  const b = input as Record<string, unknown>;
  return {
    max_input_tokens: whole(b.max_input_tokens, 1, BUILD_LIMITS.maxInputTokens, "Input tokens"),
    max_output_tokens: whole(b.max_output_tokens, 1, BUILD_LIMITS.maxOutputTokens, "Output tokens"),
    max_seconds: whole(b.max_seconds, BUILD_LIMITS.minSeconds, BUILD_LIMITS.maxSeconds, "Seconds"),
    max_cost_cents: whole(b.max_cost_cents, 1, BUILD_LIMITS.maxCostCents, "The cost limit"),
  };
}

const KEY = /^[A-Za-z0-9_-]{8,80}$/;

/** A token count a provider may report: a safe, non-negative, bounded integer. */
const tokenCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= BUILD_LIMITS.maxReportedTokens;

/** The provider configuration a job is pinned to: identity and prices, never secrets. */
export function providerConfig(provider: BuildProvider) {
  const i = provider.identity();
  return canon({
    id: String(i.id).slice(0, 80),
    model: String(i.model).slice(0, 120),
    version: String(i.version).slice(0, 80),
    pricing: provider.pricing(),
  });
}

// ---------- the service ----------

export interface BuildsOptions {
  /** Milliseconds since the epoch; injectable so tests can move time. */
  now?: () => number;
  /** Most progress events kept per job; state events are always kept. */
  maxProgressEvents?: number;
  /**
   * The operator's overall spending ceiling for AI building across every business, in cents.
   * Required for dispatch: a founder raising their own budget never authorizes more of the
   * operator's credit. Null means no ceiling was set, so nothing dispatches.
   */
  operatorCeilingCents?: number | null;
}

export class Builds {
  readonly now: () => number;
  readonly maxProgressEvents: number;
  readonly operatorCeilingCents: number | null;
  /** Abort functions of attempts running in this process, by job id. */
  readonly active = new Map<string, (reason: "cancelled" | "fenced") => void>();

  constructor(
    readonly db: Db,
    readonly store: Store,
    readonly provider: BuildProvider | null,
    options: BuildsOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxProgressEvents = options.maxProgressEvents ?? 200;
    const c = options.operatorCeilingCents;
    this.operatorCeilingCents =
      typeof c === "number" && Number.isSafeInteger(c) && c >= 0 ? c : null;
  }

  iso(offsetMs = 0) {
    return new Date(this.now() + offsetMs).toISOString();
  }

  availability(): BuildAvailability {
    const a = buildAvailability(this.provider);
    if (a.available && this.operatorCeilingCents === null)
      return {
        available: false,
        provider: a.provider,
        reason: "The operator has not set an overall AI spending ceiling, so nothing is sent.",
      };
    return a;
  }

  /** Everything committed on the build ledger across all businesses. */
  operatorCommitted() {
    return (
      this.db
        .prepare(
          "SELECT COALESCE(SUM(reserved_cents), 0) + COALESCE(SUM(charged_cents), 0) AS n FROM build_jobs",
        )
        .get() as { n: number }
    ).n;
  }

  // ---------- records ----------

  row(jobId: string): JobRow | undefined {
    return this.db.prepare("SELECT * FROM build_jobs WHERE id = ?").get(String(jobId)) as unknown as
      | JobRow
      | undefined;
  }

  /** Appends an event in the caller's transaction. Progress beyond the cap is dropped. */
  event(job: Pick<JobRow, "id">, attempt: number, type: string, data: object = {}) {
    const j = this.db.prepare("SELECT event_count FROM build_jobs WHERE id = ?").get(job.id) as {
      event_count: number;
    };
    if (type === "progress" || type === "ignored") {
      const kept = (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM build_events WHERE job_id = ? AND type = ?")
          .get(job.id, type) as { n: number }
      ).n;
      if (kept >= (type === "progress" ? this.maxProgressEvents : 5)) return;
    }
    const payload = JSON.stringify(data);
    const seq = j.event_count + 1;
    this.db
      .prepare(
        "INSERT INTO build_events (job_id, seq, attempt, type, data, at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(job.id, seq, attempt, type, payload.length > 2000 ? "{}" : payload, this.iso());
    this.db
      .prepare("UPDATE build_jobs SET event_count = ?, updated_at = ? WHERE id = ?")
      .run(seq, this.iso(), job.id);
  }

  ledger(
    jobId: string,
    attempt: number,
    kind: "reservation" | "release" | "actual" | "unknown",
    cents: number | null,
    note: string,
    tokens: { input?: number; output?: number } = {},
  ) {
    this.db
      .prepare(
        "INSERT INTO build_usage (job_id, attempt, ledger, kind, cents, input_tokens, output_tokens, note, at) VALUES (?, ?, 'build', ?, ?, ?, ?, ?, ?)",
      )
      .run(
        jobId,
        attempt,
        kind,
        cents,
        tokens.input ?? null,
        tokens.output ?? null,
        note,
        this.iso(),
      );
  }

  /** Who owns the business now, and how many times it has changed hands. */
  ownerEpoch(businessId: string) {
    const b = this.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(businessId) as
      | { owner_id: string }
      | undefined;
    const n = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
    return { owner_id: b?.owner_id ?? "", generation: n };
  }

  isStaleOwner(job: JobRow) {
    const e = this.ownerEpoch(job.business_id);
    return e.owner_id !== job.owner_id || e.generation !== job.owner_generation;
  }

  /** Releases whatever a job still holds, in the caller's transaction. */
  release(job: JobRow, attempt: number, note: string) {
    if (job.reserved_cents === 0) return;
    this.ledger(job.id, attempt, "release", job.reserved_cents, note);
    this.db.prepare("UPDATE build_jobs SET reserved_cents = 0 WHERE id = ?").run(job.id);
  }

  /**
   * Ends a job for good, in the caller's transaction. The reservation is released only when
   * nothing was dispatched, or when the provider's complete usage receipt arrived. Partial
   * reports or silence after dispatch leave it held as unresolved.
   */
  finish(
    job: JobRow,
    state: Exclude<JobState, "queued" | "running" | "validating">,
    failure: { code: string; detail: string } | null,
  ) {
    const fresh = this.row(job.id) as JobRow;
    let usage = fresh.usage_state;
    const complete = fresh.usage_final === 1;
    if (fresh.dispatched_at && !complete) {
      if (usage === "none") usage = "unknown";
      this.ledger(
        job.id,
        fresh.attempt,
        "unknown",
        null,
        usage === "reported"
          ? "Usage incomplete: no final receipt"
          : "Dispatched without a usage report",
      );
    }
    this.db
      .prepare(
        "UPDATE build_jobs SET state = ?, failure_code = ?, failure_detail = ?, usage_state = ?, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        state,
        failure?.code ?? null,
        failure ? redact(failure.detail, 500) : null,
        usage,
        this.iso(),
        this.iso(),
        job.id,
      );
    if (!fresh.dispatched_at) this.release(fresh, fresh.attempt, "Never dispatched");
    else if (complete && state !== "needs_reconciliation")
      this.release(fresh, fresh.attempt, "Final usage receipt");
    this.event(job, fresh.attempt, state, failure ? { code: failure.code } : {});
  }

  /** Fences live jobs requested under a former owner. Runs in its own transaction. */
  fenceStale(businessId: string) {
    const live = this.db
      .prepare(
        `SELECT * FROM build_jobs WHERE business_id = ? AND state IN ('queued','running','validating')`,
      )
      .all(businessId) as unknown as JobRow[];
    const stale = live.filter((j) => this.isStaleOwner(j));
    if (!stale.length) return;
    this.store.tx(() => {
      for (const j of stale) {
        const fresh = this.row(j.id) as JobRow;
        if (!LIVE.includes(fresh.state) || !this.isStaleOwner(fresh)) continue;
        this.event(fresh, fresh.attempt, "fenced", { reason: "ownership_changed" });
        this.finish(fresh, fresh.dispatched_at ? "needs_reconciliation" : "cancelled", {
          code: "ownership_changed",
          detail:
            "The business changed hands; work requested by the former owner was stopped and its output will not be applied.",
        });
      }
    });
    for (const j of stale) this.active.get(j.id)?.("fenced");
  }

  // ---------- budgets ----------

  committed(businessId: string) {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(reserved_cents), 0) AS held, COALESCE(SUM(charged_cents), 0) AS charged,
           COALESCE(SUM(charged_microcents), 0) AS charged_micro,
           COALESCE(SUM(CASE WHEN dispatched_at IS NOT NULL AND usage_final = 0
             AND state IN ('succeeded','failed','cancelled','needs_reconciliation')
             THEN reserved_cents ELSE 0 END), 0) AS unresolved
         FROM build_jobs WHERE business_id = ?`,
      )
      .get(businessId) as {
      held: number;
      charged: number;
      charged_micro: number;
      unresolved: number;
    };
  }

  budget(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    return this.budgetFor(businessId);
  }

  /**
   * The business's AI budget. Two different amounts are kept apart: `used_microcents` is the
   * exact cost computed from reported tokens at declared prices; `counted_cents` is what the
   * budget is charged, rounded up to whole cents per job (conservative).
   */
  budgetFor(businessId: string) {
    const row = this.db
      .prepare("SELECT limit_cents, updated_at FROM build_budgets WHERE business_id = ?")
      .get(businessId) as { limit_cents: number; updated_at: string } | undefined;
    const c = this.committed(businessId);
    return {
      limit_cents: row?.limit_cents ?? null,
      reserved_cents: c.held,
      counted_cents: c.charged,
      used_microcents: c.charged_micro,
      unresolved_cents: c.unresolved,
      available_cents: row ? Math.max(0, row.limit_cents - c.held - c.charged) : null,
      max_settable_cents: this.operatorCeilingCents,
      basis:
        "Used is computed from reported tokens at the declared prices; it is not a provider invoice. Counted rounds each job up to whole cents. Reserved is the worst case held for work not yet settled.",
      ledger: "build" as const,
    };
  }

  setBudget(viewer: Person, businessId: string, input: { limit_cents?: unknown }) {
    this.store.ownedBusiness(viewer, businessId);
    const most =
      this.operatorCeilingCents === null
        ? BUILD_LIMITS.maxBudgetCents
        : Math.min(BUILD_LIMITS.maxBudgetCents, this.operatorCeilingCents);
    const limit = whole(input.limit_cents, 0, most, "The AI budget (cents)");
    this.db
      .prepare(
        "INSERT INTO build_budgets (business_id, limit_cents, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (business_id) DO UPDATE SET limit_cents = excluded.limit_cents, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      )
      .run(businessId, limit, viewer.id, this.iso());
    return this.budgetFor(businessId);
  }

  // ---------- requests ----------

  private ownedProject(viewer: Person, projectId: string) {
    const p = this.db
      .prepare(
        "SELECT p.id, p.business_id, p.foundation, b.owner_id FROM product_projects p JOIN businesses b ON b.id = p.business_id WHERE p.id = ?",
      )
      .get(String(projectId)) as
      | { id: string; business_id: string; foundation: Foundation; owner_id: string }
      | undefined;
    if (!p || p.owner_id !== viewer.id) throw new HttpError(404, "No such product project");
    return p;
  }

  private ownedJob(viewer: Person, jobId: string): JobRow {
    const job = this.row(jobId);
    if (!job) throw new HttpError(404, "No such build");
    const owner = this.ownerEpoch(job.business_id).owner_id;
    if (owner !== viewer.id) throw new HttpError(404, "No such build");
    this.fenceStale(job.business_id);
    return this.row(jobId) as JobRow;
  }

  request(
    viewer: Person,
    projectId: string,
    input: Record<string, unknown>,
    retryOf: JobRow | null = null,
    /** For `propose`: the work-log message this job answers. Set by the server, never a browser. */
    requestRef: string | null = null,
  ): { job: ReturnType<Builds["view"]>; created: boolean } {
    const project = this.ownedProject(viewer, projectId);
    this.fenceStale(project.business_id);
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!KEY.test(key))
      bad("idempotency_key must be 8 to 80 letters, digits, dashes or underscores");
    const asked = input.intent ?? "build";
    if (asked !== "build" && asked !== "propose" && asked !== "app") bad("Unknown build intent");
    const intent = asked as "build" | "propose" | "app";
    if (intent === "propose" && !requestRef) bad("A proposal answers a message in the work log");
    // Job 002e: an `app` job may change a base version; the founder's words are data.
    let baseJob: string | null = null;
    let instructions: string | null = null;
    if (intent === "app") {
      const raw = input.instructions ?? "";
      if (typeof raw !== "string" || raw.length > 2000)
        bad("instructions must be text of at most 2,000 characters");
      instructions = (raw as string).trim() || null;
      if (input.base_job !== undefined && input.base_job !== null) {
        const base = this.db
          .prepare(
            "SELECT j.id FROM build_jobs j JOIN build_artifacts a ON a.job_id = j.id WHERE j.id = ? AND j.project_id = ? AND j.intent = 'app' AND j.state = 'succeeded' AND a.kind = 'web_app_bundle'",
          )
          .get(String(input.base_job), project.id) as { id: string } | undefined;
        if (!base) throw new HttpError(404, "No such app version in this project");
        baseJob = base.id;
      }
    } else if (input.base_job !== undefined || input.instructions !== undefined)
      bad("base_job and instructions belong to an app build");
    const revision = whole(input.revision, 1, 1_000_000, "The revision");
    const budget = parseBudget(input.budget);
    const rev = this.db
      .prepare("SELECT content_hash FROM product_revisions WHERE project_id = ? AND number = ?")
      .get(project.id, revision) as { content_hash: string } | undefined;
    if (!rev) throw new HttpError(404, "No such revision");

    const existing = () =>
      this.db
        .prepare("SELECT * FROM build_jobs WHERE project_id = ? AND idempotency_key = ?")
        .get(project.id, key) as unknown as JobRow | undefined;
    // The request as asked, without the provider: a duplicate is recognized even if the
    // provider has since changed, and a different request under the same key is a conflict.
    const fingerprint = sha(
      canon({
        revision,
        content_hash: rev.content_hash,
        intent,
        budget,
        retry_of: retryOf?.id ?? null,
        request_ref: requestRef,
        // Job 002e: the base version and instructions are part of an app request's identity.
        ...(intent === "app" ? { base_job: baseJob, instructions } : {}),
      }),
    );
    const same = (j: JobRow) => {
      if (j.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          "This idempotency key was already used for a different build request. Nothing new was started.",
        );
      return { job: this.view(j), created: false };
    };
    const found = existing();
    if (found) return same(found);

    const availability = this.availability();
    if (!availability.available || !this.provider) throw new HttpError(409, availability.reason);
    const pricing = this.provider.pricing();
    if (!validPricing(pricing))
      throw new HttpError(409, "The build provider's prices are not usable");
    const config = providerConfig(this.provider);
    const limits: BuildLimits = {
      maxInputTokens: budget.max_input_tokens,
      maxOutputTokens: budget.max_output_tokens,
      maxSeconds: budget.max_seconds,
    };
    const worst = worstCaseCents(pricing, limits);
    if (worst > budget.max_cost_cents)
      bad(
        `These limits could cost up to ${worst} cents at the provider's declared prices; raise the cost limit or lower the token limits`,
      );

    const id = randomUUID();
    try {
      this.store.tx(() => {
        const again = existing();
        if (again) return;
        const limit = this.db
          .prepare("SELECT limit_cents FROM build_budgets WHERE business_id = ?")
          .get(project.business_id) as { limit_cents: number } | undefined;
        if (!limit) throw new HttpError(409, "Set an AI budget for this business before starting");
        const c = this.committed(project.business_id);
        if (c.held + c.charged + worst > limit.limit_cents)
          throw new HttpError(
            409,
            `Not enough AI budget: this reserves up to ${worst} cents and ${Math.max(0, limit.limit_cents - c.held - c.charged)} cents are available`,
          );
        // The operator's overall ceiling, checked in the same transaction.
        if (this.operatorCommitted() + worst > (this.operatorCeilingCents ?? 0))
          throw new HttpError(
            409,
            "The platform's overall AI spending limit has been reached. Nothing was sent.",
          );
        const epoch = this.ownerEpoch(project.business_id);
        const t = this.iso();
        this.db
          .prepare(
            `INSERT INTO build_jobs (id, project_id, business_id, revision, content_hash, intent, idempotency_key, fingerprint, provider, provider_config, budget, pricing, retry_of, requested_by, owner_id, owner_generation, state, reserved_cents, created_at, updated_at, request_ref, base_job, instructions)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            project.id,
            project.business_id,
            revision,
            rev.content_hash,
            intent,
            key,
            fingerprint,
            this.provider?.id ?? "none",
            config,
            JSON.stringify(budget),
            JSON.stringify(pricing),
            retryOf?.id ?? null,
            viewer.id,
            epoch.owner_id,
            epoch.generation,
            worst,
            t,
            t,
            requestRef,
            baseJob,
            instructions,
          );
        this.ledger(id, 0, "reservation", worst, "Worst case at declared prices and limits");
        this.event({ id }, 0, "queued", {
          intent,
          revision,
          reserved_cents: worst,
          retry_of: retryOf?.id ?? null,
        });
      });
    } catch (e) {
      // Another writer may have inserted the same key between our read and write.
      if (e instanceof Error && /UNIQUE/.test(e.message)) {
        const raced = existing();
        if (raced) return same(raced);
      }
      throw e;
    }
    const made = existing() as JobRow;
    if (made.id !== id) return same(made);
    return { job: this.view(made), created: true };
  }

  cancel(viewer: Person, jobId: string) {
    const job = this.ownedJob(viewer, jobId);
    if (TERMINAL.includes(job.state)) return this.view(job);
    let abort = false;
    this.store.tx(() => {
      const fresh = this.row(job.id) as JobRow;
      if (TERMINAL.includes(fresh.state)) return;
      if (!fresh.cancel_requested_at) {
        this.db
          .prepare("UPDATE build_jobs SET cancel_requested_at = ?, updated_at = ? WHERE id = ?")
          .run(this.iso(), this.iso(), job.id);
        this.event(fresh, fresh.attempt, "cancel_requested", { by: "owner" });
      }
      if (fresh.state === "queued")
        this.finish(fresh, "cancelled", { code: "cancelled", detail: "Cancelled before it ran" });
      else abort = true;
    });
    if (abort) this.active.get(job.id)?.("cancelled");
    return this.view(this.row(job.id) as JobRow);
  }

  retry(viewer: Person, jobId: string, input: Record<string, unknown>) {
    const job = this.ownedJob(viewer, jobId);
    if (!["failed", "cancelled", "needs_reconciliation"].includes(job.state))
      throw new HttpError(409, "Only a failed, cancelled or unreconciled build can be retried");
    if (job.dispatched_at && job.usage_final !== 1 && input.acknowledge_unknown_cost !== true)
      throw new HttpError(
        409,
        "The earlier attempt may have reached the provider and its full cost is not known. Confirm that a new, separately reserved attempt is wanted (acknowledge_unknown_cost).",
      );
    return this.request(
      viewer,
      job.project_id,
      {
        idempotency_key: input.idempotency_key,
        intent: job.intent,
        revision: job.revision,
        budget: JSON.parse(job.budget),
      },
      job,
      job.request_ref,
    );
  }

  list(viewer: Person, projectId: string, intent: "build" | "propose" | null = null) {
    const project = this.ownedProject(viewer, projectId);
    this.fenceStale(project.business_id);
    const rows = this.db
      .prepare(
        "SELECT * FROM build_jobs WHERE project_id = ? AND (? IS NULL OR intent = ?) ORDER BY created_at DESC LIMIT 50",
      )
      .all(project.id, intent, intent) as unknown as JobRow[];
    const availability = this.availability();
    return {
      availability,
      pricing: availability.available ? (this.provider?.pricing() ?? null) : null,
      provider: availability.available && this.provider ? this.provider.identity() : null,
      budget: this.budgetFor(project.business_id),
      limits: BUILD_LIMITS,
      jobs: rows.map((r) => this.view(r)),
    };
  }

  get(viewer: Person, jobId: string) {
    return this.view(this.ownedJob(viewer, jobId), true);
  }

  events(viewer: Person, jobId: string, after: number, limit: number) {
    const job = this.ownedJob(viewer, jobId);
    const from = Number.isInteger(after) && after > 0 ? after : 0;
    const n = Number.isInteger(limit)
      ? Math.min(Math.max(limit, 1), BUILD_LIMITS.eventsPage)
      : BUILD_LIMITS.eventsPage;
    const rows = this.db
      .prepare(
        "SELECT seq, attempt, type, data, at FROM build_events WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT ?",
      )
      .all(job.id, from, n) as {
      seq: number;
      attempt: number;
      type: string;
      data: string;
      at: string;
    }[];
    const last = rows.at(-1)?.seq ?? from;
    return {
      job_state: job.state,
      events: rows.map((r) => ({ ...r, data: JSON.parse(r.data) as object })),
      last_seq: job.event_count,
      /** Pass `next_after` as `after` to read the next page. */
      next_after: last,
      has_more: last < job.event_count,
    };
  }

  usageView(job: JobRow): UsageView {
    if (job.usage_final === 1) return "final";
    if (job.usage_state === "reported") return "partial";
    if (job.usage_state === "unknown" || job.dispatched_at) return "unknown";
    return "none";
  }

  view(job: JobRow, withArtifact = false) {
    const requester = this.db
      .prepare("SELECT display_name FROM people WHERE id = ?")
      .get(job.requested_by) as { display_name: string } | undefined;
    const artifact =
      withArtifact && job.artifact_digest
        ? (this.db
            .prepare(
              "SELECT kind, schema_version, digest, bytes, content, checks, provenance, created_at FROM build_artifacts WHERE job_id = ?",
            )
            .get(job.id) as
            | {
                kind: string;
                schema_version: number;
                digest: string;
                bytes: number;
                content: string;
                checks: string;
                provenance: string;
                created_at: string;
              }
            | undefined)
        : undefined;
    const config = job.provider_config ? (JSON.parse(job.provider_config) as object) : null;
    return {
      id: job.id,
      project_id: job.project_id,
      revision: job.revision,
      content_hash: job.content_hash,
      intent: job.intent,
      provider: job.provider,
      provider_config: config,
      state: job.state,
      attempt: job.attempt,
      budget: JSON.parse(job.budget) as BuildBudget,
      reserved_cents: job.reserved_cents,
      charged_cents: job.charged_cents,
      charged_microcents: job.charged_microcents,
      usage_state: this.usageView(job),
      input_tokens: job.input_tokens,
      output_tokens: job.output_tokens,
      dispatched: Boolean(job.dispatched_at),
      cancel_requested: Boolean(job.cancel_requested_at),
      failure: job.failure_code
        ? { code: job.failure_code, detail: job.failure_detail ?? "" }
        : null,
      retry_of: job.retry_of,
      base_job: job.base_job,
      instructions: job.instructions,
      requested_by: requester?.display_name ?? "Someone",
      artifact_digest: job.artifact_digest,
      artifact: artifact
        ? {
            kind: artifact.kind,
            schema_version: artifact.schema_version,
            digest: artifact.digest,
            bytes: artifact.bytes,
            spec: JSON.parse(artifact.content) as object,
            checks: JSON.parse(artifact.checks) as object[],
            provenance: JSON.parse(artifact.provenance) as object,
          }
        : null,
      event_count: job.event_count,
      can_cancel: LIVE.includes(job.state),
      can_retry: ["failed", "cancelled", "needs_reconciliation"].includes(job.state),
      retry_needs_ack: Boolean(job.dispatched_at) && job.usage_final !== 1,
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: job.finished_at,
    };
  }
}

// ---------- the worker ----------

export interface WorkerOptions {
  id?: string;
  /** Most attempts this worker may run at once across the platform. */
  maxConcurrent?: number;
  /** How long a claim stays valid without a heartbeat. */
  leaseMs?: number;
  /** Real milliseconds between heartbeats; defaults to a third of the lease, at least 1 s. */
  heartbeatMs?: number;
  /** Real milliseconds per budget second (1000); tests shrink it to exercise timeouts. */
  msPerSecond?: number;
  /** Most events read from one provider stream before the attempt is stopped. */
  maxStreamEvents?: number;
}

class Stale extends Error {}

/** Why an attempt stopped early, and what to tell the founder. */
type StopReason =
  | { kind: "cancelled" }
  | { kind: "fenced" }
  | { kind: "timeout" }
  | { kind: "fail"; code: string; detail: string };

export class BuildWorker {
  readonly id: string;
  readonly maxConcurrent: number;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly msPerSecond: number;
  readonly maxStreamEvents: number;

  constructor(
    private readonly builds: Builds,
    private readonly provider: BuildProvider,
    options: WorkerOptions = {},
  ) {
    this.id = options.id ?? `worker-${randomUUID()}`;
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? Math.max(1000, Math.floor(this.leaseMs / 3));
    this.msPerSecond = options.msPerSecond ?? 1000;
    this.maxStreamEvents = options.maxStreamEvents ?? 1000;
  }

  private get db() {
    return this.builds.db;
  }

  /**
   * After a restart (`orphanAll`) or when leases lapse: never-dispatched work goes back to the
   * queue (or ends, if a cancel was pending); work that may have reached the provider is held
   * for reconciliation, not re-run.
   */
  recover(options: { orphanAll?: boolean } = {}) {
    const b = this.builds;
    const rows = this.db
      .prepare("SELECT * FROM build_jobs WHERE state IN ('running','validating')")
      .all() as unknown as JobRow[];
    const now = b.now();
    const lost = rows.filter((r) =>
      options.orphanAll
        ? r.lease_owner !== this.id
        : !r.lease_expires_at || Date.parse(r.lease_expires_at) <= now,
    );
    let requeued = 0;
    let held = 0;
    b.store.tx(() => {
      for (const r of lost) {
        if (r.dispatched_at) {
          b.event(r, r.attempt, "recovery", {
            outcome: "needs_reconciliation",
            reason: "The provider call may have run; it will not be repeated automatically",
          });
          b.finish(r, "needs_reconciliation", {
            code: "outcome_unknown",
            detail:
              "The worker stopped after the request was sent to the provider. Whether it ran, and what it cost, is unknown.",
          });
          held++;
        } else if (r.cancel_requested_at) {
          b.finish(r, "cancelled", {
            code: "cancelled",
            detail: "Cancelled; the worker stopped before anything was sent",
          });
        } else {
          this.db
            .prepare(
              "UPDATE build_jobs SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
            )
            .run(b.iso(), r.id);
          b.event(r, r.attempt, "recovery", {
            outcome: "requeued",
            reason: "The worker stopped before anything was sent to the provider",
          });
          requeued++;
        }
      }
    });
    return { requeued, held };
  }

  /** Claims the oldest runnable job atomically, or returns null. */
  claim(): { job: JobRow; attempt: number } | null {
    const b = this.builds;
    for (;;) {
      let fenceBusiness: string | null = null;
      const claimed = b.store.tx(() => {
        const running = (
          this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM build_jobs WHERE state IN ('running','validating') AND lease_expires_at > ?",
            )
            .get(b.iso()) as { n: number }
        ).n;
        if (running >= this.maxConcurrent) return null;
        const next = this.db
          .prepare(
            "SELECT * FROM build_jobs WHERE state = 'queued' AND cancel_requested_at IS NULL ORDER BY created_at, id LIMIT 1",
          )
          .get() as unknown as JobRow | undefined;
        if (!next) return null;
        if (b.isStaleOwner(next)) {
          fenceBusiness = next.business_id;
          return null;
        }
        const attempt = next.attempt + 1;
        this.db
          .prepare(
            "UPDATE build_jobs SET state = 'running', attempt = ?, lease_owner = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND state = 'queued'",
          )
          .run(attempt, this.id, b.iso(this.leaseMs), b.iso(), b.iso(), next.id);
        b.event(next, attempt, "claimed", { worker: this.id });
        return { job: b.row(next.id) as JobRow, attempt };
      });
      if (fenceBusiness) {
        b.fenceStale(fenceBusiness);
        continue;
      }
      return claimed;
    }
  }

  /**
   * Runs one write only if this worker still holds this attempt of a live job under an
   * unexpired lease, and renews the lease. An expired lease is never revived.
   */
  private guarded<T>(jobId: string, attempt: number, fn: (job: JobRow) => T): T {
    const b = this.builds;
    return b.store.tx(() => {
      const job = b.row(jobId);
      if (
        !job ||
        job.attempt !== attempt ||
        job.lease_owner !== this.id ||
        (job.state !== "running" && job.state !== "validating") ||
        !job.lease_expires_at ||
        Date.parse(job.lease_expires_at) <= b.now()
      )
        throw new Stale();
      this.db
        .prepare("UPDATE build_jobs SET lease_expires_at = ? WHERE id = ?")
        .run(b.iso(this.leaseMs), jobId);
      return fn(job);
    });
  }

  /** Claims and runs one job to an end state. Returns the job id, or null if none ran. */
  async runNext(): Promise<string | null> {
    const claimed = this.claim();
    if (!claimed) return null;
    await this.run(claimed.job, claimed.attempt);
    return claimed.job.id;
  }

  /** Runs one already-claimed attempt. Exposed for tests that interleave workers. */
  async run(job: JobRow, attempt: number): Promise<void> {
    const b = this.builds;
    const budget = JSON.parse(job.budget) as BuildBudget;
    const pricing = JSON.parse(job.pricing) as BuildPricing;
    const snapshot = this.db
      .prepare(
        "SELECT r.brief, r.prototype, r.content_hash, p.foundation FROM product_revisions r JOIN product_projects p ON p.id = r.project_id WHERE r.project_id = ? AND r.number = ?",
      )
      .get(job.project_id, job.revision) as
      | { brief: string; prototype: string; content_hash: string; foundation: Foundation }
      | undefined;
    const controller = new AbortController();
    // An object, not a let: it is changed from callbacks while this function awaits.
    const stop: { reason: StopReason | null } = { reason: null };
    const abort = (reason: StopReason) => {
      if (stop.reason) return;
      stop.reason = reason;
      controller.abort(reason.kind);
    };
    const external = (why: "cancelled" | "fenced") => abort({ kind: why });
    b.active.set(job.id, external);
    const timer = setTimeout(
      () => abort({ kind: "timeout" }),
      budget.max_seconds * this.msPerSecond,
    );
    timer.unref?.();
    // Quiet heartbeats keep the lease, and notice a cancel or a change of owner even when the
    // provider says nothing. Losing the lease stops this attempt.
    const heartbeat = setInterval(() => {
      try {
        const seen = this.guarded(job.id, attempt, (j) =>
          b.isStaleOwner(j) ? "stale" : j.cancel_requested_at ? "cancel" : "ok",
        );
        if (seen === "stale") b.fenceStale(job.business_id);
        else if (seen === "cancel") abort({ kind: "cancelled" });
      } catch (e) {
        if (e instanceof Stale) abort({ kind: "fenced" });
      }
    }, this.heartbeatMs);
    heartbeat.unref?.();
    try {
      // Last checks, then record the intent to dispatch before anything is sent.
      const ready = this.guarded(job.id, attempt, (j) => {
        if (b.isStaleOwner(j)) return "fenced" as const;
        if (j.cancel_requested_at) return "cancelled" as const;
        if (!snapshot || snapshot.content_hash !== j.content_hash) return "missing" as const;
        if (this.provider.id !== j.provider || providerConfig(this.provider) !== j.provider_config)
          return "changed" as const;
        if (!this.provider.availability().available) return "unavailable" as const;
        this.db
          .prepare("UPDATE build_jobs SET dispatched_at = ?, updated_at = ? WHERE id = ?")
          .run(b.iso(), b.iso(), j.id);
        b.event(j, attempt, "dispatched", { provider: this.provider.id });
        return "go" as const;
      });
      if (ready === "fenced") {
        b.fenceStale(job.business_id);
        return;
      }
      if (ready === "cancelled")
        return this.end(job.id, attempt, "cancelled", "cancelled", "Cancelled before it ran");
      if (ready === "missing" || !snapshot)
        return this.end(job.id, attempt, "failed", "revision_missing", "The revision changed");
      if (ready === "changed")
        return this.end(
          job.id,
          attempt,
          "failed",
          "provider_changed",
          "The build provider or its prices changed after this build was requested. Nothing was sent; start a new build to use the current provider.",
        );
      if (ready === "unavailable")
        return this.end(
          job.id,
          attempt,
          "failed",
          "provider_unavailable",
          "The build provider was not available. Nothing was sent; start a new build when it is.",
        );

      const stream = this.provider.start(
        {
          jobId: job.id,
          attempt,
          dispatchKey: `${job.id}:${attempt}`,
          projectId: job.project_id,
          businessId: job.business_id,
          revision: job.revision,
          contentHash: job.content_hash,
          content: {
            foundation: snapshot.foundation,
            brief: JSON.parse(snapshot.brief) as Brief,
            prototype: JSON.parse(snapshot.prototype) as Prototype,
          },
          intent: job.intent,
          conversation:
            job.intent === "propose"
              ? conversationFor(this.db, job.project_id, job.request_ref)
              : [],
          limits: {
            maxInputTokens: budget.max_input_tokens,
            maxOutputTokens: budget.max_output_tokens,
            maxSeconds: budget.max_seconds,
          },
          outputSchema:
            job.intent === "propose"
              ? PROPOSAL_SCHEMA
              : job.intent === "app"
                ? APP_SCHEMA
                : "extraction_spec/1",
          ...(job.intent === "app"
            ? {
                app: {
                  instructions: job.instructions ?? "",
                  base: baseVersion(this.db, job.base_job),
                },
              }
            : {}),
        },
        controller.signal,
      );
      const result = await this.consume(job.id, attempt, stream, controller.signal, pricing, abort);
      const reason = stop.reason as StopReason | null;
      if (reason?.kind === "fenced") return;
      if (reason?.kind === "cancelled")
        return this.end(
          job.id,
          attempt,
          "cancelled",
          "cancelled",
          "Stopped; the final cost is not yet known unless shown",
        );
      if (reason?.kind === "timeout")
        return this.end(
          job.id,
          attempt,
          "failed",
          "timeout",
          `Stopped after ${budget.max_seconds} seconds`,
        );
      if (reason?.kind === "fail")
        return this.end(job.id, attempt, "failed", reason.code, reason.detail);
      if (result.error) return this.end(job.id, attempt, "failed", "provider_error", result.error);
      if (result.artifact === undefined)
        return this.end(
          job.id,
          attempt,
          "failed",
          "no_output",
          "The provider finished without an artifact",
        );
      this.validateAndApply(job.id, attempt, result.artifact, JSON.parse(snapshot.prototype));
    } catch (e) {
      if (!(e instanceof Stale)) throw e;
      controller.abort("fenced");
      // The claim lapsed or was taken over. Settle any expired claim by whether it was sent.
      this.recover();
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (b.active.get(job.id) === external) b.active.delete(job.id);
    }
  }

  private async consume(
    jobId: string,
    attempt: number,
    stream: AsyncIterable<BuildEvent>,
    signal: AbortSignal,
    pricing: BuildPricing,
    abort: (reason: StopReason) => void,
  ) {
    const b = this.builds;
    let artifact: unknown;
    let error: string | null = null;
    let count = 0;
    const it = stream[Symbol.asyncIterator]();
    const aborted = new Promise<"aborted">((resolve) => {
      if (signal.aborted) resolve("aborted");
      signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    try {
      for (;;) {
        const pending = it.next();
        // If the abort wins the race, a later rejection from the provider is not unhandled.
        pending.catch(() => {});
        const next = await Promise.race([pending, aborted]);
        if (next === "aborted" || signal.aborted || next.done) break;
        count++;
        // A stream that never waits must still let cancels, timers and requests run.
        if (count % 25 === 0) await new Promise<void>((r) => setImmediate(r));
        if (count > this.maxStreamEvents) {
          abort({
            kind: "fail",
            code: "stream_limit",
            detail: `The provider sent more than ${this.maxStreamEvents} events; the attempt was stopped`,
          });
          break;
        }
        const ev = next.value as BuildEvent | undefined;
        const seen = this.guarded(jobId, attempt, (j) => {
          if (ev?.type === "progress")
            b.event(j, attempt, "progress", { message: redact(ev.message, 200) });
          else if (ev?.type === "usage" || ev?.type === "usage_final") {
            const stopped = this.recordUsage(j, attempt, ev, pricing);
            if (stopped) abort(stopped);
          } else if (ev?.type === "output") {
            if (artifact !== undefined) {
              abort({
                kind: "fail",
                code: "invalid_output",
                detail: "The provider returned more than one artifact",
              });
            } else {
              let size = 0;
              try {
                size =
                  typeof ev.artifact === "string"
                    ? Buffer.byteLength(ev.artifact, "utf8")
                    : Buffer.byteLength(JSON.stringify(ev.artifact) ?? "", "utf8");
              } catch {
                size = Number.POSITIVE_INFINITY;
              }
              // Job 002e: an app bundle has its own bound; every other artifact stays at 64 KB.
              const limit = j.intent === "app" ? MAX_BUNDLE_BYTES : MAX_ARTIFACT_BYTES;
              if (size > limit)
                abort({
                  kind: "fail",
                  code: "invalid_output",
                  detail: `The output is larger than ${limit / 1024} KB`,
                });
              else {
                artifact = ev.artifact;
                b.event(j, attempt, "output_received", { bytes: size });
              }
            }
          } else b.event(j, attempt, "ignored", { reason: "Unknown event from the provider" });
          return b.isStaleOwner(j) ? "stale" : j.cancel_requested_at ? "cancel" : "ok";
        });
        if (seen === "stale") {
          // A change of owner fences the job in the database too (which also aborts this run).
          b.fenceStale((b.row(jobId) as JobRow).business_id);
          break;
        }
        if (seen === "cancel") {
          abort({ kind: "cancelled" });
          break;
        }
        if (signal.aborted) break;
      }
    } catch (e) {
      if (e instanceof Stale) throw e;
      if (!signal.aborted) error = redact((e as Error)?.message ?? e, 300) || "The provider failed";
    } finally {
      // Ask the provider to stop; don't wait on one that ignores it.
      void Promise.resolve(it.return?.()).catch(() => {});
    }
    return { artifact, error };
  }

  /**
   * Records a usage report in the caller's transaction and says whether to stop. Deltas add
   * to the totals; the final receipt sets them (never below what was already reported) and
   * settles usage. Known spend is always recorded before any stop.
   */
  private recordUsage(
    job: JobRow,
    attempt: number,
    ev: { type: "usage" | "usage_final"; inputTokens: number; outputTokens: number },
    pricing: BuildPricing,
  ): StopReason | null {
    const b = this.builds;
    if (!tokenCount(ev.inputTokens) || !tokenCount(ev.outputTokens)) {
      b.event(job, attempt, "usage_unreadable", {});
      return {
        kind: "fail",
        code: "invalid_usage",
        detail:
          "The provider reported usage that is not a valid token count; the attempt was stopped",
      };
    }
    let input = job.input_tokens;
    let output = job.output_tokens;
    if (ev.type === "usage") {
      if (job.usage_final === 1) {
        b.event(job, attempt, "usage_after_final", {});
        return null;
      }
      input += ev.inputTokens;
      output += ev.outputTokens;
    } else {
      if (job.usage_final === 1) {
        const same = ev.inputTokens === job.input_tokens && ev.outputTokens === job.output_tokens;
        b.event(job, attempt, same ? "usage_duplicate" : "usage_mismatch", {
          input_tokens: ev.inputTokens,
          output_tokens: ev.outputTokens,
        });
        if (same) return null;
      } else if (ev.inputTokens < input || ev.outputTokens < output)
        b.event(job, attempt, "usage_mismatch", {
          detail:
            "The final receipt is lower than the usage already reported; the higher figure is kept",
        });
      input = Math.max(input, ev.inputTokens);
      output = Math.max(output, ev.outputTokens);
    }
    const micro = costMicroCents(pricing, input, output);
    const cents = ceilCents(micro);
    this.db
      .prepare(
        "UPDATE build_jobs SET input_tokens = ?, output_tokens = ?, charged_microcents = ?, charged_cents = ?, usage_state = 'reported', usage_final = CASE WHEN ? THEN 1 ELSE usage_final END WHERE id = ?",
      )
      .run(input, output, micro, cents, ev.type === "usage_final" ? 1 : 0, job.id);
    b.ledger(
      job.id,
      attempt,
      "actual",
      cents - job.charged_cents,
      ev.type === "usage_final" ? "Final receipt from the provider" : "Provisional usage report",
      { input: input - job.input_tokens, output: output - job.output_tokens },
    );
    b.event(job, attempt, ev.type === "usage_final" ? "usage_final" : "usage", {
      input_tokens: input,
      output_tokens: output,
      microcents: micro,
      cents,
    });
    const budget = JSON.parse(job.budget) as BuildBudget;
    if (input > budget.max_input_tokens || output > budget.max_output_tokens) {
      b.event(job, attempt, "limit_exceeded", {
        input_tokens: input,
        output_tokens: output,
        max_input_tokens: budget.max_input_tokens,
        max_output_tokens: budget.max_output_tokens,
      });
      return {
        kind: "fail",
        code: "limit_exceeded",
        detail: `The provider used ${input} input and ${output} output tokens, over this build's limits of ${budget.max_input_tokens} and ${budget.max_output_tokens}. The attempt was stopped and its output is not used; the usage is still recorded.`,
      };
    }
    return null;
  }

  private end(
    jobId: string,
    attempt: number,
    state: "failed" | "cancelled",
    code: string,
    detail: string,
  ) {
    try {
      this.guarded(jobId, attempt, (j) => this.builds.finish(j, state, { code, detail }));
    } catch (e) {
      if (!(e instanceof Stale)) throw e;
      this.recover();
    }
  }

  private validateAndApply(jobId: string, attempt: number, raw: unknown, prototype: Prototype) {
    const b = this.builds;
    try {
      const stale = this.guarded(jobId, attempt, (j) => {
        if (b.isStaleOwner(j)) return true;
        this.db.prepare("UPDATE build_jobs SET state = 'validating' WHERE id = ?").run(j.id);
        b.event(j, attempt, "validating", {});
        return false;
      });
      if (stale) {
        b.fenceStale((b.row(jobId) as JobRow).business_id);
        return;
      }
      const intent = (b.row(jobId) as JobRow).intent;
      // One validator per intent; both rebuild the output from checked parts.
      const checked:
        | {
            ok: true;
            kind: string;
            schema: string;
            digest: string;
            bytes: number;
            canonical: string;
            checks: { id: string; passed: boolean }[];
            proposal: Proposal | null;
          }
        | { ok: false; reason: string; checks: { id: string; passed: boolean }[] } = (() => {
        if (intent === "propose") {
          const r = validateProposal(raw);
          return r.ok
            ? {
                ok: true as const,
                kind: "product_proposal",
                schema: PROPOSAL_SCHEMA,
                digest: r.digest,
                bytes: r.bytes,
                canonical: r.canonical,
                checks: [{ id: "proposal_schema", passed: true }],
                proposal: r.proposal,
              }
            : {
                ok: false as const,
                reason: r.reason,
                checks: [{ id: "proposal_schema", passed: false }],
              };
        }
        // Job 002e: an app job accepts only a web app bundle, rebuilt and hashed by the platform.
        if (intent === "app") {
          const a = validateBundle(raw);
          return a.ok
            ? {
                ok: true as const,
                kind: "web_app_bundle",
                schema: APP_SCHEMA,
                digest: a.digest,
                bytes: a.bytes,
                canonical: a.canonical,
                checks: a.checks.map((c) => ({ id: c.id, passed: c.passed })),
                proposal: null,
              }
            : {
                ok: false as const,
                reason: a.reason,
                checks: [{ id: "web_app_bundle", passed: false }],
              };
        }
        const r = validateArtifact(raw, prototype);
        return r.ok
          ? {
              ok: true as const,
              kind: "extraction_spec",
              schema: "extraction_spec/1",
              digest: r.digest,
              bytes: r.bytes,
              canonical: r.canonical,
              checks: r.checks.map((c) => ({ id: c.id, passed: c.passed })),
              proposal: null,
            }
          : {
              ok: false as const,
              reason: r.reason,
              checks: r.checks.map((c) => ({ id: c.id, passed: c.passed })),
            };
      })();
      this.guarded(jobId, attempt, (j) => {
        // Ownership is checked once more right before output is applied.
        if (b.isStaleOwner(j)) throw new Stale();
        if (!checked.ok) {
          b.event(j, attempt, "checks", { checks: checked.checks });
          b.finish(j, "failed", { code: "invalid_output", detail: checked.reason });
          return;
        }
        this.db
          .prepare(
            "INSERT INTO build_artifacts (job_id, attempt, kind, schema_version, digest, bytes, content, checks, provenance, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            j.id,
            attempt,
            checked.kind,
            checked.digest,
            checked.bytes,
            checked.canonical,
            JSON.stringify(checked.checks),
            JSON.stringify({
              schema: checked.schema,
              provider: JSON.parse(j.provider_config || "{}"),
              job: j.id,
              attempt,
              project: j.project_id,
              revision: j.revision,
              content_hash: j.content_hash,
              validator: `platform ${checked.schema}`,
            }),
            b.iso(),
          );
        this.db
          .prepare("UPDATE build_jobs SET artifact_digest = ? WHERE id = ?")
          .run(checked.digest, j.id);
        b.event(j, attempt, "checks", { checks: checked.checks });
        // A proposal is recorded with the job's success, in the same transaction.
        if (checked.proposal) {
          const id = recordProposal(this.db, j, checked.proposal, b.iso());
          b.event(j, attempt, "proposal_recorded", { proposal: id });
        }
        b.finish(j, "succeeded", null);
      });
    } catch (e) {
      if (!(e instanceof Stale)) throw e;
      const j = b.row(jobId);
      if (j && LIVE.includes(j.state)) {
        if (b.isStaleOwner(j)) b.fenceStale(j.business_id);
        else this.recover();
      }
    }
  }
}

/**
 * Runs a worker inside this server process: settles anything a previous run left behind
 * (requeue what was never sent, hold what may have been), then takes queued jobs one at a
 * time. Only started when a real, priced provider and an operator ceiling are configured.
 */
export function startBuildWorker(
  builds: Builds,
  provider: BuildProvider,
  options: WorkerOptions & { pollMs?: number } = {},
) {
  const worker = new BuildWorker(builds, provider, options);
  worker.recover({ orphanAll: true });
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      while (await worker.runNext()) {}
    } catch {
      console.error("Build worker: a job could not be processed; it will be recovered");
    } finally {
      busy = false;
    }
  }, options.pollMs ?? 2000);
  timer.unref?.();
  return { worker, stop: () => clearInterval(timer) };
}

/** The server's limits for one proposal; founders never choose tokens. */
export function proposalBudget(
  provider: BuildProvider | null,
  limits = { max_input_tokens: 24_000, max_output_tokens: 6_000, max_seconds: 120 },
): BuildBudget | null {
  const pricing = provider?.pricing();
  if (!validPricing(pricing)) return null;
  return {
    ...limits,
    max_cost_cents: worstCaseCents(pricing, {
      maxInputTokens: limits.max_input_tokens,
      maxOutputTokens: limits.max_output_tokens,
      maxSeconds: limits.max_seconds,
    }),
  };
}
