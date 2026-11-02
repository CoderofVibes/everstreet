// Running a product: one invocation of a checked artifact on pasted text, under the business's
// separate runtime budget and ledger (docs/design/MANAGED_RUNTIME.md §5). Before anything is
// reserved the input is checked for free; then one transaction checks owner, budget, operator
// ceiling and concurrency, reserves the worst case and records the dispatch before the
// provider is called. Same key and same request returns the same record; a different request
// under that key is a conflict. A paid request is never re-run on its own: a restart turns a
// running request into "unknown", with its reservation held. The pasted text is not stored.

import { createHash, randomUUID } from "node:crypto";
import type { ExtractionSpec } from "./artifacts.ts";
import { type BuildAvailability, ceilCents, costMicroCents, validPricing } from "./build.ts";
import type { Db } from "./db.ts";
import { EXTRACT_VALIDATOR, type Extraction, validateExtraction } from "./extract.ts";
import {
  RUNTIME_LIMITS,
  RuntimeFailure,
  type RuntimeProvider,
  type RuntimeUsage,
} from "./runtime.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export type Purpose = "trial" | "evaluation" | "release";
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

    // Which artifact: the active release, or a named checked version (a candidate).
    let release: { id: string; artifact_job: string } | null = null;
    if (input.release === true) {
      const active = this.db
        .prepare(
          "SELECT id, artifact_job, provider_config, validator FROM runtime_releases WHERE project_id = ? AND state = 'active'",
        )
        .get(project.id) as
        | { id: string; artifact_job: string; provider_config: string; validator: string }
        | undefined;
      if (!active) throw new HttpError(409, "Nothing is released yet");
      // A release serves only under the model and checks it was released with.
      if (active.provider_config !== this.configNow() || active.validator !== EXTRACT_VALIDATOR)
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
    const inputSha = sha(text);
    const fingerprint = sha(
      JSON.stringify([purpose, artifact.digest, release?.id ?? null, inputSha, evalRef]),
    );
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
        const limit = this.db
          .prepare("SELECT limit_cents FROM runtime_budgets WHERE business_id = ?")
          .get(project.business_id) as { limit_cents: number } | undefined;
        if (!limit) throw new HttpError(409, "Set a runtime budget for this business first");
        const mine = this.committed(project.business_id);
        if (mine.held + mine.charged + worst > limit.limit_cents)
          throw new HttpError(
            409,
            `Not enough runtime budget: a request reserves up to ${worst} cents and ${Math.max(0, limit.limit_cents - mine.held - mine.charged)} are available`,
          );
        const all = this.committed(null);
        if (all.held + all.charged + worst > (this.ceilingCents ?? 0))
          throw new HttpError(
            409,
            "The platform's overall limit for running products has been reached. Nothing was sent.",
          );
        const running = (
          this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM runtime_invocations WHERE business_id = ? AND state = 'running'",
            )
            .get(project.business_id) as { n: number }
        ).n;
        if (running >= RUNTIME_LIMITS.concurrency)
          throw new HttpError(
            409,
            `At most ${RUNTIME_LIMITS.concurrency} requests run at once; wait for one to finish`,
          );
        const t = this.iso();
        this.db
          .prepare(
            `INSERT INTO runtime_invocations (id, business_id, project_id, artifact_job, artifact_digest, release_id, purpose, eval_run, eval_case, requested_by, owner_id, owner_generation, idempotency_key, fingerprint, input_sha, input_chars, provider, provider_config, validator, pricing, state, reserved_cents, dispatched_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
          )
          .run(
            id,
            project.business_id,
            project.id,
            artifact.job_id,
            artifact.digest,
            release?.id ?? null,
            purpose,
            evalRef?.run ?? null,
            evalRef?.case ?? null,
            viewer.id,
            epoch.owner_id,
            epoch.generation,
            key,
            fingerprint,
            inputSha,
            text.length,
            this.provider?.id ?? "none",
            config,
            EXTRACT_VALIDATOR,
            JSON.stringify(pricing),
            worst,
            t,
            t,
          );
        this.ledger(id, "reservation", worst, "Worst case at the fixed runtime limits");
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

  /** Runs the request and returns the final record. The input exists only in this call. */
  private async run(
    row: InvocationRow,
    spec: ExtractionSpec,
    text: string,
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
      this.store.tx(() =>
        this.finish(this.row(row.id) as InvocationRow, "completed", result, {
          failureClass: null,
          detail: null,
          usage,
          elapsed: this.now() - started,
        }),
      );
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
        result ? JSON.stringify(result) : null,
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
    if (!r) throw new HttpError(404, "No such request");
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
        "SELECT * FROM runtime_invocations WHERE project_id = ? AND purpose <> 'evaluation' ORDER BY created_at DESC, rowid DESC LIMIT 50",
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
      input_note: "The pasted text is not kept; only its length and fingerprint are recorded.",
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
