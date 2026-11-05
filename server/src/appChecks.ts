// Job 002e: isolated logic checks of a web app version (docs/design/EXECUTABLE_PRODUCTS.md §4).
// Execution records, apart from the generation they check: no model call, no spend, and a retry
// never re-runs a generation. The worker claims one check at a time platform-wide, asks the
// engine for a verified preflight (none or a failed one: `unavailable`, nothing ran), records
// dispatch before running, and applies a report only if it is bound to exactly this check,
// attempt, digest, recipe and engine, under a live lease and the same owner epoch. After a
// restart a dispatched check is `unknown`: it is never re-run automatically.

import { createHash, randomUUID } from "node:crypto";
import { APP_RECIPE } from "./appBundle.ts";
import { canonicalJson } from "./artifacts.ts";
import type { Db } from "./db.ts";
import { HttpError, type Store } from "./store.ts";

export type CheckState =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "unavailable"
  | "unknown";

/** Non-secret identity of the engine that ran (or would run) a check. */
export type EngineIdentity = Record<string, string> & { engine: string; recipe: string };

export interface CheckJob {
  check_id: string;
  attempt: number;
  digest: string;
  recipe: string;
  /** The platform's canonical bundle text; its SHA-256 is `digest`. */
  bundle: string;
}

/**
 * An isolated check engine. `preflight` must verify the real engine (identities, access,
 * limits) and never claim more than it checked; `run` returns the launcher's raw answer, which
 * the platform validates. A test double must say so in its identity (`engine: "test-double"`).
 */
export interface CheckEngine {
  preflight(
    signal: AbortSignal,
  ): Promise<{ ok: true; identity: EngineIdentity } | { ok: false; reason: string }>;
  run(job: CheckJob, signal: AbortSignal): Promise<unknown>;
  /** Removes anything a job left behind; idempotent. */
  cleanup(job: CheckJob): Promise<void>;
}

export interface CheckRow {
  id: string;
  project_id: string;
  business_id: string;
  job_id: string;
  digest: string;
  recipe: string;
  idempotency_key: string;
  fingerprint: string;
  requested_by: string;
  owner_id: string;
  owner_generation: number;
  state: CheckState;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  dispatched_at: string | null;
  cancel_requested_at: string | null;
  engine: string | null;
  result: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface CheckReport {
  syntax: { path: string; ok: boolean; detail: string }[];
  cases: { id: string; passed: boolean; detail: string }[];
  usage: { untrusted_memory_peak_bytes: number | null; vmm_memory_peak_bytes: number | null };
}

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const LIVE: CheckState[] = ["queued", "running"];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Validates the launcher's answer against exactly what was asked: binding, engine, the bundle's
 * own JS files and declared cases (no more, no fewer), bounded fields. Anything else is invalid.
 */
export function validateRun(
  raw: unknown,
  want: { job: CheckJob; engine: EngineIdentity; jsFiles: string[]; caseIds: string[] },
): { ok: true; report: CheckReport } | { ok: false; code: string; detail: string } {
  const bad = (detail: string) => ({ ok: false as const, code: "invalid_report", detail });
  if (!raw || typeof raw !== "object") return bad("The worker's answer wasn't an object");
  const top = raw as Record<string, unknown>;
  if (typeof top.error === "string") {
    const code = ["timeout", "limits_unverified", "unavailable", "invalid_report"].includes(
      top.error,
    )
      ? top.error
      : "worker_error";
    return { ok: false, code, detail: text(top.detail, 300) || top.error };
  }
  const r = top.report as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return bad("No report in the worker's answer");
  if (typeof r.error === "string")
    return { ok: false, code: "worker_error", detail: text(r.error, 100) };
  if (
    r.check_id !== want.job.check_id ||
    r.attempt !== want.job.attempt ||
    r.digest !== want.job.digest ||
    r.recipe !== want.job.recipe
  )
    return bad("The report is for a different check, attempt, version or recipe");
  if (canonicalJson(r.engine) !== canonicalJson(want.engine))
    return bad("The report names a different engine than the one checked before the run");
  if (!Array.isArray(r.syntax) || !Array.isArray(r.cases)) return bad("The report is incomplete");
  const syntax = r.syntax.map((s) => {
    const x = (s ?? {}) as Record<string, unknown>;
    return { path: text(x.path, 200), ok: x.ok === true, detail: text(x.detail, 300) };
  });
  const cases = r.cases.map((c) => {
    const x = (c ?? {}) as Record<string, unknown>;
    return { id: text(x.id, 80), passed: x.passed === true, detail: text(x.detail, 300) };
  });
  const same = (a: string[], b: string[]) =>
    canonicalJson([...a].sort()) === canonicalJson([...b].sort());
  if (
    !same(
      syntax.map((s) => s.path),
      want.jsFiles,
    )
  )
    return bad("The report's syntax results don't match the version's files");
  if (
    !same(
      cases.map((c) => c.id),
      want.caseIds,
    )
  )
    return bad("The report's cases don't match the version's declared checks");
  const num = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const host = (top.host ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    report: {
      syntax,
      cases,
      usage: {
        untrusted_memory_peak_bytes: num(usage.untrusted_memory_peak_bytes),
        vmm_memory_peak_bytes: num(host.vmm_memory_peak_bytes),
      },
    },
  };
}

export class AppChecks {
  constructor(
    readonly db: Db,
    readonly store: Store,
    readonly opts: { now?: () => number } = {},
  ) {}

  now() {
    return (this.opts.now ?? Date.now)();
  }
  iso(ms = this.now()) {
    return new Date(ms).toISOString();
  }
  row(id: string) {
    return this.db.prepare("SELECT * FROM app_checks WHERE id = ?").get(id) as unknown as
      | CheckRow
      | undefined;
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
  isStale(c: { business_id: string; owner_id: string; owner_generation: number }) {
    const e = this.ownerEpoch(c.business_id);
    return e.owner_id !== c.owner_id || e.generation !== c.owner_generation;
  }

  /** The project, if the viewer owns its business now; otherwise 404 (no existence leak). */
  ownedProject(viewerId: string, projectId: string) {
    const p = this.db
      .prepare(
        "SELECT p.id, p.business_id FROM product_projects p JOIN businesses b ON b.id = p.business_id WHERE p.id = ? AND b.owner_id = ?",
      )
      .get(projectId, viewerId) as { id: string; business_id: string } | undefined;
    if (!p) throw new HttpError(404, "No such project");
    return p;
  }

  /** A succeeded app version of this project, with its stored canonical bundle. */
  version(projectId: string, jobId: string) {
    const v = this.db
      .prepare(
        "SELECT j.id, j.business_id, a.digest, a.content, a.created_at FROM build_jobs j JOIN build_artifacts a ON a.job_id = j.id WHERE j.id = ? AND j.project_id = ? AND j.intent = 'app' AND j.state = 'succeeded' AND a.kind = 'web_app_bundle'",
      )
      .get(jobId, projectId) as
      | { id: string; business_id: string; digest: string; content: string; created_at: string }
      | undefined;
    if (!v) throw new HttpError(404, "No such app version");
    return v;
  }

  request(viewerId: string, projectId: string, jobId: string, key: unknown) {
    const p = this.ownedProject(viewerId, projectId);
    if (typeof key !== "string" || !KEY.test(key))
      throw new HttpError(
        400,
        "idempotency_key must be 8 to 80 letters, digits, dashes or underscores",
      );
    const v = this.version(p.id, jobId);
    const fingerprint = sha(canonicalJson({ job_id: v.id, digest: v.digest, recipe: APP_RECIPE }));
    const existing = () =>
      this.db
        .prepare("SELECT * FROM app_checks WHERE project_id = ? AND idempotency_key = ?")
        .get(p.id, key) as unknown as CheckRow | undefined;
    const found = existing();
    if (found) {
      if (found.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          "This idempotency key was already used for a different check. Nothing new was started.",
        );
      return { check: this.view(found), created: false };
    }
    const id = randomUUID();
    const epoch = this.ownerEpoch(p.business_id);
    const t = this.iso();
    try {
      this.store.tx(() => {
        this.store.requireNoHandover(p.business_id); // job 003wf3 (D5)
        this.db
          .prepare(
            `INSERT INTO app_checks (id, project_id, business_id, job_id, digest, recipe, idempotency_key, fingerprint, requested_by, owner_id, owner_generation, state, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
          )
          .run(
            id,
            p.id,
            p.business_id,
            v.id,
            v.digest,
            APP_RECIPE,
            key,
            fingerprint,
            viewerId,
            epoch.owner_id,
            epoch.generation,
            t,
            t,
          );
      });
    } catch (e) {
      const raced = existing();
      if (raced && e instanceof Error && /UNIQUE/.test(e.message))
        return { check: this.view(raced), created: false };
      throw e;
    }
    return { check: this.view(this.row(id) as CheckRow), created: true };
  }

  list(viewerId: string, projectId: string) {
    const p = this.ownedProject(viewerId, projectId);
    this.fenceStale(p.business_id);
    return (
      this.db
        .prepare("SELECT * FROM app_checks WHERE project_id = ? ORDER BY created_at DESC LIMIT 50")
        .all(p.id) as unknown as CheckRow[]
    ).map((c) => this.view(c));
  }

  cancel(viewerId: string, checkId: string) {
    const c = this.row(checkId);
    if (!c) throw new HttpError(404, "No such check");
    this.ownedProject(viewerId, c.project_id);
    this.store.tx(() => {
      const now = this.row(checkId) as CheckRow;
      if (!LIVE.includes(now.state)) return;
      const t = this.iso();
      if (now.state === "queued")
        this.db
          .prepare(
            "UPDATE app_checks SET state = 'cancelled', cancel_requested_at = ?, failure_code = 'cancelled', updated_at = ?, finished_at = ? WHERE id = ?",
          )
          .run(t, t, t, checkId);
      else
        this.db
          .prepare(
            "UPDATE app_checks SET cancel_requested_at = COALESCE(cancel_requested_at, ?), updated_at = ? WHERE id = ?",
          )
          .run(t, t, checkId);
    });
    return this.view(this.row(checkId) as CheckRow);
  }

  /** Live checks under a former owner end now: queued never run; a running one is cancelled. */
  fenceStale(businessId: string) {
    const live = this.db
      .prepare("SELECT * FROM app_checks WHERE business_id = ? AND state IN ('queued','running')")
      .all(businessId) as unknown as CheckRow[];
    for (const c of live)
      if (this.isStale(c))
        this.store.tx(() => {
          const t = this.iso();
          this.db
            .prepare(
              "UPDATE app_checks SET state = 'cancelled', failure_code = 'ownership_changed', failure_detail = 'The business changed hands; this check was requested by its former owner.', lease_owner = NULL, updated_at = ?, finished_at = ? WHERE id = ? AND state IN ('queued','running')",
            )
            .run(t, t, c.id);
        });
  }

  view(c: CheckRow) {
    const result = c.result ? (JSON.parse(c.result) as CheckReport) : null;
    const engine = c.engine ? (JSON.parse(c.engine) as EngineIdentity) : null;
    return {
      id: c.id,
      job_id: c.job_id,
      digest: c.digest,
      recipe: c.recipe,
      state: c.state,
      attempt: c.attempt,
      engine,
      /** A double's result is never presented as isolation (EXECUTABLE_PRODUCTS §7). */
      isolation_evidence:
        engine !== null && engine.engine !== "test-double" && c.state === "passed",
      result,
      failure: c.failure_code ? { code: c.failure_code, detail: c.failure_detail ?? "" } : null,
      can_cancel: LIVE.includes(c.state),
      created_at: c.created_at,
      finished_at: c.finished_at,
    };
  }
}
