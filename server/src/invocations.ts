// Running a product: one invocation of a checked artifact on pasted text, under the business's
// separate runtime budget and ledger (docs/design/MANAGED_RUNTIME.md §5). Before anything is
// reserved the input is checked for free; then one transaction checks owner, budget, operator
// ceiling and concurrency, reserves the worst case and records the dispatch before the
// provider is called. Same key and same request returns the same record; a different request
// under that key is a conflict. A paid request is never re-run on its own: a restart turns a
// running request into "unknown", with its reservation held. Retention: see RETENTION_NOTE.

import { createHash, randomUUID } from "node:crypto";
import type { ExtractionSpec } from "./artifacts.ts";
import { type BuildAvailability, ceilCents, costMicroCents, validPricing } from "./build.ts";
import type { Db } from "./db.ts";
import { RELEASE_POLICY } from "./evaluations.ts";
import { EXTRACT_VALIDATOR, type Extraction, validateExtraction } from "./extract.ts";
import {
  RUNTIME_LIMITS,
  RuntimeFailure,
  type RuntimeProvider,
  type RuntimeUsage,
} from "./runtime.ts";
import { HttpError, type Person, type Store } from "./store.ts";

/**
 * `customer_use` (job 003n) is a customer's execution of a released product: business cost
 * history only. Owner routes never return it, and its output is never stored on the record.
 */
export type Purpose = "trial" | "evaluation" | "release" | "customer_use";
export type InvocationState = "running" | "completed" | "failed" | "cancelled" | "unknown";

export interface InvocationRow {
  id: string;
  business_id: string;
  project_id: string;
  artifact_job: string;
  artifact_digest: string;
  release_id: string | null;
  purpose: Purpose;
  eval_run: string | null;
  eval_case: string | null;
  requested_by: string;
  owner_id: string;
  owner_generation: number;
  idempotency_key: string;
  fingerprint: string;
  input_sha: string;
  input_chars: number;
  provider: string;
  provider_config: string;
  validator: string;
  pricing: string;
  state: InvocationState;
  outcome: Extraction["outcome"] | null;
  failure_class: string | null;
  failure_detail: string | null;
  output: string | null;
  reserved_cents: number;
  charged_cents: number;
  charged_microcents: number;
  usage_state: "none" | "final" | "partial" | "unknown";
  input_tokens: number;
  output_tokens: number;
  cancel_requested_at: string | null;
  dispatched_at: string | null;
  created_at: string;
  finished_at: string | null;
  elapsed_ms: number | null;
}

/**
 * Who may run a business's product, and how a use is settled. Before M3 commerce only the
 * owner runs private trials; customer entitlements and usage settlement plug in here.
 */
export interface Admission {
  /** Throws (404) if this person may not run the business's product for this purpose. */
  admit(viewer: Person, business: { id: string; owner_id: string }, purpose: Purpose): void;
  /** Called once per finished invocation; `fulfilled` only for a clean extraction. */
  settle(invocation: { id: string; business_id: string }, fulfilled: boolean): void;
}

export const ownerOnly: Admission = {
  admit(viewer, business) {
    if (business.owner_id !== viewer.id) throw new HttpError(404, "No such product project");
  },
  settle() {
    // No customer ledger before M3: nothing is charged to anyone but the runtime budget.
  },
};

export interface RuntimeOptions {
  now?: () => number;
  /** The operator's overall ceiling for running products, in cents; null: unavailable. */
  ceilingCents?: number | null;
  admission?: Admission;
  /** Override the per-request time limit (tests). */
  timeoutMs?: number;
}

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const plain = (s: string, max = 300) => s.replace(CONTROL, " ").trim().slice(0, max);

/**
 * What is kept, said precisely (job 002c1). Runtime records are the business's operating
 * history (PLATFORM_VISION) and move with it on a sale; nothing here is erased or made personal.
 */
export const RETENTION_NOTE =
  "The pasted text itself isn't stored, only its length and fingerprint. The result (extracted values, notes and any reported issues) is kept as one of the business's records, can contain text from the document, and moves with the business if it is sold. Test cases you save keep their input.";

export const NO_RUNTIME: BuildAvailability = {
  available: false,
  provider: null,
  reason:
    "Running products isn't connected on this server, so nothing can be processed here. Nothing is simulated.",
};

/** The identity of the runtime model configuration: non-secret, stored on every record. */
export function runtimeConfig(p: RuntimeProvider) {
  const i = p.identity();
  return JSON.stringify({ id: i.id, model: i.model, version: i.version, pricing: p.pricing() });
}

export class ManagedRuntime {
  readonly now: () => number;
  readonly ceilingCents: number | null;
  readonly admission: Admission;
  readonly timeoutMs: number;
  /** Abort functions of requests running in this process. */
  private readonly active = new Map<string, (why: "cancelled" | "timeout") => void>();

  constructor(
    readonly db: Db,
    readonly store: Store,
    readonly provider: RuntimeProvider | null,
    options: RuntimeOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    const c = options.ceilingCents;
    this.ceilingCents = typeof c === "number" && Number.isSafeInteger(c) && c >= 0 ? c : null;
    this.admission = options.admission ?? ownerOnly;
    this.timeoutMs = options.timeoutMs ?? RUNTIME_LIMITS.maxSeconds * 1000;
  }

  iso(offset = 0) {
    return new Date(this.now() + offset).toISOString();
  }

  availability(): BuildAvailability {
    if (!this.provider) return NO_RUNTIME;
    const a = this.provider.availability();
    if (!a.available) return a;
    if (!validPricing(this.provider.pricing()))
      return {
        available: false,
        provider: this.provider.id,
        reason: "The runtime has no usable prices.",
      };
    if (this.ceilingCents === null)
      return {
        available: false,
        provider: this.provider.id,
        reason: "The operator has not set a spending ceiling for running products.",
      };
    return a;
  }

  /** The current runtime identity, or null when nothing can run. */
  configNow(): string | null {
    return this.provider && this.availability().available ? runtimeConfig(this.provider) : null;
  }

  /** Worst case for one request at the fixed limits, rounded up to whole cents. */
  worstCents() {
    const p = this.provider?.pricing();
    if (!p) return 0;
    return ceilCents(
      costMicroCents(p, RUNTIME_LIMITS.maxInputTokens, RUNTIME_LIMITS.maxOutputTokens),
    );
  }

  /** After a restart: anything that was running may have been billed; it is never re-run. */
  recover() {
    const running = this.db
      .prepare("SELECT * FROM runtime_invocations WHERE state = 'running'")
      .all() as unknown as InvocationRow[];
    for (const r of running)
      this.store.tx(() =>
        this.finish(r, "unknown", null, {
          failureClass: "outcome_unknown",
          detail:
            "The server stopped while this request was running. It may have been processed and billed; it was not run again.",
          usage: null,
        }),
      );
    return running.length;
  }

  // ---------- records ----------

  row(id: string) {
    return this.db.prepare("SELECT * FROM runtime_invocations WHERE id = ?").get(String(id)) as
      | InvocationRow
      | undefined;
  }

  private ledger(
    id: string,
    kind: "reservation" | "release" | "actual" | "unknown",
    cents: number | null,
    note: string,
    extra: { micro?: number; input?: number; output?: number } = {},
  ) {
    this.db
      .prepare(
        "INSERT INTO runtime_usage (invocation_id, ledger, kind, cents, microcents, input_tokens, output_tokens, note, at) VALUES (?, 'runtime', ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        kind,
        cents,
        extra.micro ?? null,
        extra.input ?? null,
        extra.output ?? null,
        note,
        this.iso(),
      );
  }

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

  /** The project, if this person may run its product for this purpose; otherwise 404. */
  project(viewer: Person, projectId: string, purpose: Purpose = "trial") {
    const p = this.db
      .prepare(
        "SELECT p.id, p.business_id, b.owner_id FROM product_projects p JOIN businesses b ON b.id = p.business_id WHERE p.id = ?",
      )
      .get(String(projectId)) as { id: string; business_id: string; owner_id: string } | undefined;
    if (!p) throw new HttpError(404, "No such product project");
    this.admission.admit(viewer, { id: p.business_id, owner_id: p.owner_id }, purpose);
    return p;
  }

  /** A succeeded build of this project with its checked artifact. */
  artifact(projectId: string, jobId: string) {
    const a = this.db
      .prepare(
        `SELECT j.id AS job_id, j.revision, j.owner_id, j.owner_generation, a.digest, a.content, a.created_at
           FROM build_jobs j JOIN build_artifacts a ON a.job_id = j.id
          WHERE j.id = ? AND j.project_id = ? AND j.intent = 'build' AND j.state = 'succeeded'`,
      )
      .get(String(jobId), projectId) as
      | {
          job_id: string;
          revision: number;
          owner_id: string;
          owner_generation: number;
          digest: string;
          content: string;
          created_at: string;
        }
      | undefined;
    if (!a) throw new HttpError(404, "No checked version with that id");
    return { ...a, spec: JSON.parse(a.content) as ExtractionSpec };
  }

  // ---------- budget ----------

  committed(businessId: string | null) {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(reserved_cents), 0) AS held, COALESCE(SUM(charged_cents), 0) AS charged,
           COALESCE(SUM(charged_microcents), 0) AS micro,
           COALESCE(SUM(CASE WHEN state <> 'running' AND usage_state IN ('partial','unknown') THEN reserved_cents ELSE 0 END), 0) AS unresolved
           FROM runtime_invocations WHERE (? IS NULL OR business_id = ?)`,
      )
      .get(businessId, businessId) as {
      held: number;
      charged: number;
      micro: number;
      unresolved: number;
    };
  }

  budgetFor(businessId: string) {
    const row = this.db
      .prepare("SELECT limit_cents FROM runtime_budgets WHERE business_id = ?")
      .get(businessId) as { limit_cents: number } | undefined;
    const c = this.committed(businessId);
    return {
      ledger: "runtime" as const,
      limit_cents: row?.limit_cents ?? null,
      reserved_cents: c.held,
      counted_cents: c.charged,
      used_microcents: c.micro,
      unresolved_cents: c.unresolved,
      available_cents: row ? Math.max(0, row.limit_cents - c.held - c.charged) : null,
      per_request_cents: this.worstCents(),
      max_settable_cents: this.ceilingCents,
      basis:
        "Running your product has its own budget, separate from the AI that builds it. Used is computed from reported tokens at the declared prices, not a provider invoice; each request reserves its worst case until it settles.",
    };
  }

  setBudget(viewer: Person, businessId: string, input: { limit_cents?: unknown }) {
    this.store.ownedBusiness(viewer, businessId);
    const most = this.ceilingCents ?? 0;
    const n = Number(input.limit_cents);
    if (!Number.isInteger(n) || n < 0 || n > most)
      throw new HttpError(
        400,
        `The runtime budget must be a whole number of cents from 0 to ${most}`,
      );
    this.db
      .prepare(
        "INSERT INTO runtime_budgets (business_id, limit_cents, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (business_id) DO UPDATE SET limit_cents = excluded.limit_cents, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      )
      .run(businessId, n, viewer.id, this.iso());
    return this.budgetFor(businessId);
  }

  // ---------- running ----------

  /**
   * Starts (or finds) one invocation. Returns its record now and a promise of the final record.
   * `release` pins the active release's artifact at this moment.
   */
  start(
    viewer: Person,
    projectId: string,
    input: { idempotency_key?: unknown; artifact_job?: unknown; release?: unknown; text?: unknown },
    purpose: Purpose = "trial",
    evalRef: { run: string; case: string } | null = null,
  ): { invocation: InvocationRow; created: boolean; done: Promise<InvocationRow> } {
    const project = this.project(viewer, projectId, purpose);
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!KEY.test(key))
      throw new HttpError(
        400,
        "idempotency_key must be 8 to 80 letters, digits, dashes or underscores",
      );
    const text = typeof input.text === "string" ? input.text : "";
    const inputSha = sha(text);
    // The request as asked, never today's release or model: a retry of a recorded request is
    // recognized even after a release, rollback or model change (job 002c1), and a different
    // request under the same key is still a conflict.
    const target = input.release === true ? "release" : `job:${String(input.artifact_job ?? "")}`;
    const fingerprint = sha(JSON.stringify([purpose, target, inputSha, evalRef]));
    const existing = () =>
      this.db
        .prepare("SELECT * FROM runtime_invocations WHERE project_id = ? AND idempotency_key = ?")
        .get(project.id, key) as InvocationRow | undefined;
    const same = (r: InvocationRow) => {
      if (r.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          "This request key was already used for a different request. Nothing new was run.",
        );
      return { invocation: r, created: false, done: this.settled(r.id) };
    };
    const found = existing();
    if (found) return same(found);

    // A new request. Which artifact: the active release now, or a named checked candidate.
    let release: { id: string; artifact_job: string } | null = null;
    if (input.release === true) {
      const active = this.db
        .prepare(
          "SELECT id, artifact_job, provider_config, validator, policy FROM runtime_releases WHERE project_id = ? AND state = 'active'",
        )
        .get(project.id) as
        | {
            id: string;
            artifact_job: string;
            provider_config: string;
            validator: string;
            policy: string;
          }
        | undefined;
      if (!active) throw new HttpError(409, "Nothing is released yet");
      // A release serves only under the model, checks and release policy it was released with.
      if (
        active.provider_config !== this.configNow() ||
        active.validator !== EXTRACT_VALIDATOR ||
        active.policy !== RELEASE_POLICY
      )
        throw new HttpError(
          409,
          "The model or the platform's checks changed since this release; check it again and release it before it serves requests",
        );
      release = { id: active.id, artifact_job: active.artifact_job };
    }
    const artifact = this.artifact(
      project.id,
      release ? release.artifact_job : String(input.artifact_job ?? ""),
    );
    // Free checks: nothing is reserved or sent for these.
    if (!text.trim()) throw new HttpError(400, "Paste some text to process first");
    const max = Math.min(artifact.spec.input.max_chars, RUNTIME_LIMITS.maxInputChars);
    if (text.length > max)
      throw new HttpError(
        400,
        `This service reads up to ${max} characters; the text has ${text.length}`,
      );
    const availability = this.availability();
    if (!availability.available || !this.provider) throw new HttpError(409, availability.reason);
    const pricing = this.provider.pricing();
    const config = runtimeConfig(this.provider);
    const worst = this.worstCents();

    const id = randomUUID();
    try {
      this.store.tx(() => {
        if (existing()) return;
        const epoch = this.ownerEpoch(project.business_id);
        if (epoch.owner_id !== project.owner_id)
          throw new HttpError(404, "No such product project");
        this.reserveChecks(project.business_id, worst);
        this.insertRunning({
          id,
          business_id: project.business_id,
          project_id: project.id,
          artifact_job: artifact.job_id,
          artifact_digest: artifact.digest,
          release_id: release?.id ?? null,
          purpose,
          eval_run: evalRef?.run ?? null,
          eval_case: evalRef?.case ?? null,
          requested_by: viewer.id,
          epoch,
          key,
          fingerprint,
          input_sha: inputSha,
          input_chars: text.length,
          config,
          pricing: JSON.stringify(pricing),
          worst,
        });
      });
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) {
        const raced = existing();
        if (raced) return same(raced);
      }
      throw e;
    }
    const made = existing() as InvocationRow;
    if (made.id !== id) return same(made);
    const done = this.run(made, artifact.spec, text);
    return { invocation: made, created: true, done };
  }

  /**
   * The runtime's own admission checks, inside the caller's transaction: the business's budget,
   * the operator's overall ceiling and the concurrency limit, all for the worst case.
   */
  private reserveChecks(businessId: string, worst: number) {
    const limit = this.db
      .prepare("SELECT limit_cents FROM runtime_budgets WHERE business_id = ?")
      .get(businessId) as { limit_cents: number } | undefined;
    if (!limit)
      throw new HttpError(
        409,
        "Set a runtime budget for this business first",
        this.coded("no_budget"),
      );
    const mine = this.committed(businessId);
    if (mine.held + mine.charged + worst > limit.limit_cents)
      throw new HttpError(
        409,
        `Not enough runtime budget: a request reserves up to ${worst} cents and ${Math.max(0, limit.limit_cents - mine.held - mine.charged)} are available`,
        this.coded("budget_exhausted"),
      );
    const all = this.committed(null);
    if (all.held + all.charged + worst > (this.ceilingCents ?? 0))
      throw new HttpError(
        409,
        "The platform's overall limit for running products has been reached. Nothing was sent.",
        this.coded("ceiling_reached"),
      );
    const running = (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM runtime_invocations WHERE business_id = ? AND state = 'running'",
        )
        .get(businessId) as { n: number }
    ).n;
    if (running >= RUNTIME_LIMITS.concurrency)
      throw new HttpError(
        409,
        `At most ${RUNTIME_LIMITS.concurrency} requests run at once; wait for one to finish`,
        this.coded("concurrency_limit"),
      );
  }

  /** Codes only on the customer path (job 003n), so existing trial answers stay as they were. */
  private codes = false;
  private coded(code: string) {
    return this.codes ? code : undefined;
  }

  /** The dispatch intent: a running record and its worst-case reservation, in one transaction. */
  private insertRunning(v: {
    id: string;
    business_id: string;
    project_id: string;
    artifact_job: string;
    artifact_digest: string;
    release_id: string | null;
    purpose: Purpose;
    eval_run: string | null;
    eval_case: string | null;
    requested_by: string;
    epoch: { owner_id: string; generation: number };
    key: string;
    fingerprint: string;
    input_sha: string;
    input_chars: number;
    config: string;
    pricing: string;
    worst: number;
  }) {
    const t = this.iso();
    this.db
      .prepare(
        `INSERT INTO runtime_invocations (id, business_id, project_id, artifact_job, artifact_digest, release_id, purpose, eval_run, eval_case, requested_by, owner_id, owner_generation, idempotency_key, fingerprint, input_sha, input_chars, provider, provider_config, validator, pricing, state, reserved_cents, dispatched_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
        v.id,
        v.business_id,
        v.project_id,
        v.artifact_job,
        v.artifact_digest,
        v.release_id,
        v.purpose,
        v.eval_run,
        v.eval_case,
        v.requested_by,
        v.epoch.owner_id,
        v.epoch.generation,
        v.key,
        v.fingerprint,
        v.input_sha,
        v.input_chars,
        this.provider?.id ?? "none",
        v.config,
        EXTRACT_VALIDATOR,
        v.pricing,
        v.worst,
        t,
        t,
      );
    this.ledger(v.id, "reservation", v.worst, "Worst case at the fixed runtime limits");
  }

  /**
   * The release a customer offer serves, if it can serve now: still the project's active
   * release, under the model, checks and policy it was released with, with this exact artifact.
   */
  releaseFor(projectId: string, releaseId: string, artifactDigest: string) {
    const r = this.db
      .prepare(
        "SELECT id, artifact_job, provider_config, validator, policy FROM runtime_releases WHERE id = ? AND project_id = ? AND state = 'active'",
      )
      .get(releaseId, projectId) as
      | {
          id: string;
          artifact_job: string;
          provider_config: string;
          validator: string;
          policy: string;
        }
      | undefined;
    if (!r) return { ok: false as const, code: "release_not_active" };
    if (
      r.provider_config !== this.configNow() ||
      r.validator !== EXTRACT_VALIDATOR ||
      r.policy !== RELEASE_POLICY
    )
      return { ok: false as const, code: "release_needs_recheck" };
    const artifact = this.artifact(projectId, r.artifact_job);
    if (artifact.digest !== artifactDigest) return { ok: false as const, code: "artifact_changed" };
    return { ok: true as const, release: r, artifact };
  }

  /**
   * Job 003n: dispatches one customer execution (purpose `customer_use`). The caller has already
   * authorized the customer and read fresh chain evidence; `inTx` rechecks its own state and
   * records the execution inside the same transaction as the reservation and the intent. The
   * owner admission is not used (customers aren't owners), and nothing here reads an owner's
   * trial. `sink` receives the validated result after the record is finished, to protect it;
   * the result is never written to the business's record.
   */
  startCustomer(ctx: {
    business_id: string;
    project_id: string;
    release_id: string;
    artifact_job: string;
    artifact_digest: string;
    spec: ExtractionSpec;
    text: string;
    request_id: string;
    person_id: string;
    inTx: (invocationId: string) => void;
    sink: (row: InvocationRow, result: Extraction) => Promise<void>;
  }): { invocation: InvocationRow; created: boolean; done: Promise<InvocationRow> } {
    const availability = this.availability();
    if (!availability.available || !this.provider)
      throw new HttpError(503, availability.reason, "runtime_unavailable");
    const key = `customer-${ctx.request_id}`;
    const inputSha = sha(ctx.text);
    const fingerprint = sha(
      JSON.stringify(["customer_use", ctx.release_id, inputSha, ctx.request_id]),
    );
    const existing = () =>
      this.db
        .prepare("SELECT * FROM runtime_invocations WHERE project_id = ? AND idempotency_key = ?")
        .get(ctx.project_id, key) as InvocationRow | undefined;
    const found = existing();
    if (found) return { invocation: found, created: false, done: this.settled(found.id) };
    const worst = this.worstCents();
    const config = runtimeConfig(this.provider);
    const pricing = JSON.stringify(this.provider.pricing());
    const id = randomUUID();
    try {
      this.codes = true;
      this.store.tx(() => {
        if (existing()) return;
        this.reserveChecks(ctx.business_id, worst);
        this.insertRunning({
          id,
          business_id: ctx.business_id,
          project_id: ctx.project_id,
          artifact_job: ctx.artifact_job,
          artifact_digest: ctx.artifact_digest,
          release_id: ctx.release_id,
          purpose: "customer_use",
          eval_run: null,
          eval_case: null,
          requested_by: ctx.person_id,
          epoch: this.ownerEpoch(ctx.business_id),
          key,
          fingerprint,
          input_sha: inputSha,
          input_chars: ctx.text.length,
          config,
          pricing,
          worst,
        });
        ctx.inTx(id);
      });
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) {
        const raced = existing();
        if (raced) return { invocation: raced, created: false, done: this.settled(raced.id) };
      }
      throw e;
    } finally {
      this.codes = false;
    }
    const made = existing() as InvocationRow;
    if (made.id !== id) return { invocation: made, created: false, done: this.settled(made.id) };
    const done = this.run(made, ctx.spec, ctx.text, ctx.sink);
    return { invocation: made, created: true, done };
  }

  /** Cancels a running customer execution by its invocation (the customer path checks the caller). */
  cancelCustomer(invocationId: string) {
    const r = this.row(invocationId);
    if (r?.purpose !== "customer_use" || r.state !== "running") return;
    if (!r.cancel_requested_at)
      this.db
        .prepare("UPDATE runtime_invocations SET cancel_requested_at = ? WHERE id = ?")
        .run(this.iso(), invocationId);
    this.active.get(invocationId)?.("cancelled");
  }

  /** Runs the request and returns the final record. The input exists only in this call. */
  private async run(
    row: InvocationRow,
    spec: ExtractionSpec,
    text: string,
    sink?: (row: InvocationRow, result: Extraction) => Promise<void>,
  ): Promise<InvocationRow> {
    const provider = this.provider as RuntimeProvider;
    const controller = new AbortController();
    let why: "cancelled" | "timeout" | null = null;
    const stop = (reason: "cancelled" | "timeout") => {
      why ??= reason;
      controller.abort();
    };
    this.active.set(row.id, stop);
    const timer = setTimeout(() => stop("timeout"), this.timeoutMs);
    const started = this.now();
    try {
      const { usage, output } = await provider.extract(
        {
          invocationId: row.id,
          spec,
          document: text,
          limits: {
            maxInputTokens: RUNTIME_LIMITS.maxInputTokens,
            maxOutputTokens: RUNTIME_LIMITS.maxOutputTokens,
          },
        },
        controller.signal,
      );
      const result = validateExtraction(spec, output);
      // Job 003n: a customer's late answer after a cancellation is neither stored nor delivered;
      // its usage is still accounted.
      const late =
        row.purpose === "customer_use" &&
        (why !== null || Boolean(this.row(row.id)?.cancel_requested_at));
      this.store.tx(() =>
        this.finish(
          this.row(row.id) as InvocationRow,
          late ? "cancelled" : "completed",
          late ? null : result,
          {
            failureClass: late ? "cancelled" : null,
            detail: late ? "Cancelled; the answer that arrived afterwards was not kept" : null,
            usage,
            elapsed: this.now() - started,
          },
        ),
      );
      if (sink && !late) {
        const finished = this.row(row.id) as InvocationRow;
        // The sink protects and records the result; it handles its own failures.
        if (finished.state === "completed") await sink(finished, result).catch(() => {});
      }
    } catch (e) {
      const f =
        e instanceof RuntimeFailure
          ? e
          : new RuntimeFailure("The request failed unexpectedly", "provider_error", null);
      const cls =
        why === "timeout" ? "timeout" : why === "cancelled" ? "cancelled" : f.failureClass;
      const state: InvocationState =
        cls === "cancelled"
          ? "cancelled"
          : f.usage === null && cls !== "not_sent"
            ? "unknown"
            : "failed";
      this.store.tx(() =>
        this.finish(this.row(row.id) as InvocationRow, state, null, {
          failureClass: cls,
          detail:
            cls === "timeout"
              ? "No answer within the time limit; the request was stopped"
              : f.message,
          usage: f.usage,
          elapsed: this.now() - started,
        }),
      );
    } finally {
      clearTimeout(timer);
      this.active.delete(row.id);
    }
    return this.row(row.id) as InvocationRow;
  }

  /**
   * Settles a request in the caller's transaction. A final receipt charges exact usage and
   * releases the hold; partial or no usage after dispatch keeps the hold as unresolved.
   */
  private finish(
    row: InvocationRow,
    state: Exclude<InvocationState, "running">,
    result: Extraction | null,
    info: {
      failureClass: string | null;
      detail: string | null;
      usage: RuntimeUsage | null;
      elapsed?: number;
    },
  ) {
    if (row.state !== "running") return;
    const pricing = JSON.parse(row.pricing);
    const u = info.usage;
    let usageState: InvocationRow["usage_state"] = "unknown";
    let micro = 0;
    if (u) {
      micro = costMicroCents(pricing, u.inputTokens, u.outputTokens);
      usageState = u.final ? "final" : "partial";
      this.ledger(
        row.id,
        "actual",
        ceilCents(micro),
        u.final ? "Final usage" : "At least this much; full cost unknown",
        {
          micro,
          input: u.inputTokens,
          output: u.outputTokens,
        },
      );
    } else this.ledger(row.id, "unknown", null, "Sent, but no usage was reported");
    const charged = u ? ceilCents(micro) : 0;
    const release = usageState === "final";
    if (release) this.ledger(row.id, "release", row.reserved_cents, "Settled by the final receipt");
    this.db
      .prepare(
        `UPDATE runtime_invocations SET state = ?, outcome = ?, failure_class = ?, failure_detail = ?, output = ?,
           usage_state = ?, input_tokens = ?, output_tokens = ?, charged_microcents = ?, charged_cents = ?,
           reserved_cents = ?, finished_at = ?, elapsed_ms = ? WHERE id = ? AND state = 'running'`,
      )
      .run(
        state,
        result?.outcome ?? null,
        info.failureClass,
        info.detail ? plain(info.detail, 500) : null,
        // A customer's result is never stored on the business's record (job 003n).
        result && row.purpose !== "customer_use" ? JSON.stringify(result) : null,
        usageState,
        u?.inputTokens ?? 0,
        u?.outputTokens ?? 0,
        micro,
        charged,
        release ? 0 : row.reserved_cents,
        this.iso(),
        info.elapsed ?? null,
        row.id,
      );
    this.admission.settle(row, state === "completed" && result?.outcome === "extracted");
  }

  /** Resolves when a request (possibly running in this process) has finished. */
  private async settled(id: string): Promise<InvocationRow> {
    for (;;) {
      const r = this.row(id) as InvocationRow;
      if (r.state !== "running" || !this.active.has(id)) return r;
      await new Promise((ok) => setTimeout(ok, 10));
    }
  }

  /**
   * After the final await (job 002c1): may this person still receive this request's answer?
   * They must still be admitted to the business now, and control must not have moved since the
   * request started (owner away and back counts as a change). The request itself is finished and
   * accounted either way; its record belongs to the business.
   */
  answerFor(viewer: Person, row: InvocationRow) {
    this.project(viewer, row.project_id, row.purpose);
    const now = this.ownerEpoch(row.business_id);
    if (now.owner_id !== row.owner_id || now.generation !== row.owner_generation)
      throw new HttpError(
        409,
        "Control of this business changed while the request was running. It finished and is kept in the business's records; its answer isn't returned here.",
      );
    return this.view(row);
  }

  cancel(viewer: Person, id: string) {
    const r = this.owned(viewer, id);
    if (r.state !== "running") return this.view(r);
    if (!r.cancel_requested_at)
      this.db
        .prepare("UPDATE runtime_invocations SET cancel_requested_at = ? WHERE id = ?")
        .run(this.iso(), id);
    this.active.get(id)?.("cancelled");
    return this.view(this.row(id) as InvocationRow);
  }

  owned(viewer: Person, id: string) {
    const r = this.row(id);
    // A customer's execution is never an owner's record to read or cancel (job 003n).
    if (!r || r.purpose === "customer_use") throw new HttpError(404, "No such request");
    // Authorized on every read, including direct links: the business's current owner only.
    this.project(viewer, r.project_id, r.purpose);
    return r;
  }

  get(viewer: Person, id: string) {
    return this.view(this.owned(viewer, id));
  }

  list(viewer: Person, projectId: string) {
    const p = this.project(viewer, projectId);
    const rows = this.db
      .prepare(
        "SELECT * FROM runtime_invocations WHERE project_id = ? AND purpose NOT IN ('evaluation','customer_use') ORDER BY created_at DESC, rowid DESC LIMIT 50",
      )
      .all(p.id) as unknown as InvocationRow[];
    return {
      availability: this.availability(),
      budget: this.budgetFor(p.business_id),
      limits: RUNTIME_LIMITS,
      invocations: rows.map((r) => this.view(r)),
    };
  }

  view(r: InvocationRow) {
    const config = JSON.parse(r.provider_config) as { model?: string };
    return {
      id: r.id,
      purpose: r.purpose,
      artifact_job: r.artifact_job,
      artifact_digest: r.artifact_digest,
      release_id: r.release_id,
      model: config.model ?? null,
      provider_config: JSON.parse(r.provider_config) as object,
      validator: r.validator,
      state: r.state,
      outcome: r.outcome,
      fulfilled: r.state === "completed" && r.outcome === "extracted",
      result: r.output ? (JSON.parse(r.output) as Extraction) : null,
      failure: r.failure_class ? { class: r.failure_class, detail: r.failure_detail ?? "" } : null,
      input_chars: r.input_chars,
      input_note: RETENTION_NOTE,
      usage_state: r.usage_state,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      charged_microcents: r.charged_microcents,
      charged_cents: r.charged_cents,
      reserved_cents: r.reserved_cents,
      elapsed_ms: r.elapsed_ms,
      cancel_requested: Boolean(r.cancel_requested_at),
      created_at: r.created_at,
      finished_at: r.finished_at,
    };
  }
}
