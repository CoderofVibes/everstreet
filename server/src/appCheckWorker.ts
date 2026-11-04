// Job 002e: the single isolated-check worker (docs/design/EXECUTABLE_PRODUCTS.md §4), revised
// after Astra's AppCheckLifecycleReview:
// - the lease is renewed on every poll tick from claim to the end (preflight, run, cleanup), so a
//   long but bounded run never expires mid-flight and only lapsed rows are recovered;
// - a cancel is honoured in the transactional dispatch gate (nothing is sent) and when an outcome
//   is applied (a cancel recorded first wins and the outcome is not applied);
// - every engine call is hard-bounded whether or not the adapter honours its AbortSignal;
// - an unconfirmed cleanup blocks further claims until a preflight succeeds again.

import { createHash } from "node:crypto";
import { storedBundle } from "./appBundle.ts";
import {
  type AppChecks,
  type CheckEngine,
  type CheckJob,
  type CheckReport,
  type CheckRow,
  type CheckState,
  validateRun,
} from "./appChecks.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface CheckWorkerOptions {
  id: string;
  /** Lease length; renewed on every poll tick while a check runs. */
  leaseMs?: number;
  /** Hard bound on one run (the engine's own VM deadline is shorter), settled or not. */
  runMs?: number;
  /** Hard bound on a preflight and on a cleanup, settled or not. */
  callMs?: number;
  pollMs?: number;
}

class BoundExceeded extends Error {}

/** Settles within `ms` whether or not `p` does. */
function bounded<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BoundExceeded(what)), ms);
    }),
  ]);
}

export class AppCheckWorker {
  /**
   * Set when a cleanup couldn't be confirmed: no further check is claimed until a preflight
   * succeeds again (the host launcher refuses while a run is live and removes only proven
   * orphans), so an unclean host never silently admits more work.
   */
  blocked: string | null = null;

  constructor(
    readonly checks: AppChecks,
    readonly engine: CheckEngine | null,
    readonly opts: CheckWorkerOptions,
  ) {}

  private get db() {
    return this.checks.db;
  }
  private leaseUntil() {
    return this.checks.iso(this.checks.now() + (this.opts.leaseMs ?? 30_000));
  }
  private callMs() {
    return this.opts.callMs ?? 30_000;
  }

  /** A write only for the same attempt, owner, live lease and live state; renews the lease. */
  private guarded(id: string, attempt: number, f: (c: CheckRow) => void): boolean {
    let ok = false;
    this.checks.store.tx(() => {
      const c = this.checks.row(id);
      if (c?.state !== "running" || c.attempt !== attempt || c.lease_owner !== this.opts.id) return;
      if (c.lease_expires_at && Date.parse(c.lease_expires_at) < this.checks.now()) return;
      this.db
        .prepare("UPDATE app_checks SET lease_expires_at = ? WHERE id = ?")
        .run(this.leaseUntil(), id);
      f(c);
      ok = true;
    });
    return ok;
  }

  /**
   * Applies an outcome. A cancel recorded before a pass or fail is applied wins: the outcome is
   * not applied, and the check says so.
   */
  private finish(
    id: string,
    attempt: number,
    state: CheckState,
    code: string | null,
    detail: string,
    extra: { result?: CheckReport } = {},
  ) {
    return this.guarded(id, attempt, (c) => {
      const t = this.checks.iso();
      const cancelledFirst =
        c.cancel_requested_at !== null && (state === "passed" || state === "failed");
      this.db
        .prepare(
          "UPDATE app_checks SET state = ?, failure_code = ?, failure_detail = ?, result = COALESCE(?, result), lease_owner = NULL, updated_at = ?, finished_at = ? WHERE id = ?",
        )
        .run(
          cancelledFirst ? "cancelled" : state,
          cancelledFirst ? "cancelled" : code,
          cancelledFirst
            ? "Stopped at your request; an outcome that arrived afterwards was not applied."
            : detail || null,
          cancelledFirst || !extra.result ? null : JSON.stringify(extra.result),
          t,
          t,
          id,
        );
    });
  }

  /**
   * Running rows whose lease has lapsed belong to no live run (a live run renews its lease on
   * every poll tick): never dispatched ⇒ queued again; dispatched ⇒ unknown, never re-run
   * automatically. Called at start and before every claim.
   */
  recover() {
    const t = this.checks.iso();
    const lapsed = "state = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)";
    this.checks.store.tx(() => {
      this.db
        .prepare(
          `UPDATE app_checks SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE ${lapsed} AND dispatched_at IS NULL`,
        )
        .run(t, t);
      this.db
        .prepare(
          `UPDATE app_checks SET state = 'unknown', failure_code = 'outcome_unknown', failure_detail = 'The worker stopped after this check was sent to the engine; its outcome is unknown. It is never run again automatically: request a new check.', lease_owner = NULL, updated_at = ?, finished_at = ? WHERE ${lapsed} AND dispatched_at IS NOT NULL`,
        )
        .run(t, t, t);
    });
  }

  /** Claims and runs the oldest queued check; returns its id, or null when there is none. */
  async runNext(): Promise<string | null> {
    if (this.blocked) {
      if (!this.engine) return null;
      const pre = await bounded(
        this.engine.preflight(new AbortController().signal),
        this.callMs(),
        "preflight",
      ).catch(() => ({ ok: false as const, reason: "" }));
      if (!pre.ok) return null;
      this.blocked = null;
    }
    this.recover();
    let claimed: CheckRow | null = null;
    this.checks.store.tx(() => {
      const live = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM app_checks WHERE state = 'running' AND lease_expires_at >= ?",
        )
        .get(this.checks.iso()) as { n: number };
      if (live.n > 0) return; // one check at a time, platform-wide
      const next = this.db
        .prepare("SELECT * FROM app_checks WHERE state = 'queued' ORDER BY created_at, id LIMIT 1")
        .get() as unknown as CheckRow | undefined;
      if (!next) return;
      this.db
        .prepare(
          "UPDATE app_checks SET state = 'running', attempt = attempt + 1, lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(this.opts.id, this.leaseUntil(), this.checks.iso(), next.id);
      claimed = this.checks.row(next.id) as CheckRow;
    });
    const c = claimed as CheckRow | null;
    if (!c) return null;
    await this.run(c);
    return c.id;
  }

  private async run(c: CheckRow) {
    const attempt = c.attempt;
    if (this.checks.isStale(c)) {
      this.checks.fenceStale(c.business_id);
      return;
    }
    if (!this.engine) {
      this.finish(
        c.id,
        attempt,
        "unavailable",
        "engine_not_configured",
        "No isolated check worker is configured here. Nothing ran.",
      );
      return;
    }
    const engine = this.engine;
    const controller = new AbortController();
    let stop: string | null = null;
    // From claim to the end: renew the lease; watch for a cancel and a change of owner.
    const poll = setInterval(() => {
      if (!this.guarded(c.id, attempt, () => {})) stop ??= "fenced";
      const now = this.checks.row(c.id);
      if (now?.cancel_requested_at) stop ??= "cancelled";
      else if (now && this.checks.isStale(now)) stop ??= "ownership_changed";
      if (stop) controller.abort();
    }, this.opts.pollMs ?? 250);
    try {
      const pre = await bounded(
        engine.preflight(controller.signal),
        this.callMs(),
        "preflight",
      ).catch((e: unknown) => ({
        ok: false as const,
        reason:
          e instanceof BoundExceeded
            ? "the worker host didn't answer its readiness check in time"
            : e instanceof Error
              ? e.message
              : "preflight failed",
      }));
      if (!pre.ok) {
        if (!this.stopped(c, attempt, stop))
          this.finish(
            c.id,
            attempt,
            "unavailable",
            "engine_unavailable",
            `The isolated check worker isn't ready: ${pre.reason.slice(0, 300)}. Nothing ran.`,
          );
        return;
      }
      const v = this.checks.version(c.project_id, c.job_id);
      if (v.digest !== c.digest || sha(v.content) !== c.digest) {
        this.finish(
          c.id,
          attempt,
          "failed",
          "digest_mismatch",
          "The stored version doesn't match the digest this check was requested for.",
        );
        return;
      }
      const job: CheckJob = {
        check_id: c.id,
        attempt,
        digest: c.digest,
        recipe: c.recipe,
        bundle: v.content,
      };
      const bundle = storedBundle(v.content);
      // The dispatch gate, in one transaction: same lease, no cancel, same owner. Dispatch is
      // recorded before the engine runs anything.
      let gate = "fenced" as "go" | "cancelled" | "stale" | "fenced";
      this.guarded(c.id, attempt, (now) => {
        if (now.cancel_requested_at) gate = "cancelled";
        else if (this.checks.isStale(now)) gate = "stale";
        else {
          this.db
            .prepare("UPDATE app_checks SET dispatched_at = ?, engine = ? WHERE id = ?")
            .run(this.checks.iso(), JSON.stringify(pre.identity), c.id);
          gate = "go";
        }
      });
      if (gate === "cancelled") {
        this.finish(
          c.id,
          attempt,
          "cancelled",
          "cancelled",
          "Stopped at your request before it was sent. Nothing ran.",
        );
        return;
      }
      if (gate === "stale") {
        this.checks.fenceStale(c.business_id);
        return;
      }
      if (gate === "fenced") return;

      let raw: unknown;
      let thrown: unknown = null;
      try {
        raw = await bounded(engine.run(job, controller.signal), this.opts.runMs ?? 75_000, "run");
      } catch (e) {
        thrown = e;
        if (e instanceof BoundExceeded) stop ??= "timeout";
      }
      if (stop) {
        controller.abort();
        const clean = await bounded(engine.cleanup(job), this.callMs(), "cleanup").then(
          () => true,
          () => false,
        );
        if (!clean) this.blocked = `cleanup of ${c.id} attempt ${attempt} wasn't confirmed`;
      }
      if (this.stopped(c, attempt, stop)) return;
      if (thrown) {
        this.finish(
          c.id,
          attempt,
          "failed",
          "worker_error",
          thrown instanceof Error ? thrown.message.slice(0, 300) : "The worker failed",
        );
        return;
      }
      const checked = validateRun(raw, {
        job,
        engine: pre.identity,
        jsFiles: bundle.files.filter((f) => f.path.endsWith(".js")).map((f) => f.path),
        caseIds: bundle.checks.map((x) => x.id),
      });
      if (!checked.ok) {
        this.finish(c.id, attempt, "failed", checked.code, checked.detail);
        return;
      }
      if (this.checks.isStale(c)) {
        this.checks.fenceStale(c.business_id); // a late output under a new owner is dropped
        return;
      }
      const allPass =
        checked.report.syntax.every((s) => s.ok) && checked.report.cases.every((x) => x.passed);
      this.finish(
        c.id,
        attempt,
        allPass ? "passed" : "failed",
        allPass ? null : "checks_failed",
        "",
        { result: checked.report },
      );
    } finally {
      clearInterval(poll);
    }
  }

  /** Applies a stop reason; returns whether one applied. */
  private stopped(c: CheckRow, attempt: number, stop: string | null) {
    if (!stop) return false;
    if (stop === "fenced") return true;
    if (stop === "ownership_changed") {
      this.checks.fenceStale(c.business_id); // the late output is dropped
      return true;
    }
    if (stop === "cancelled")
      this.finish(c.id, attempt, "cancelled", "cancelled", "Stopped at your request.");
    else
      this.finish(
        c.id,
        attempt,
        "failed",
        "timeout",
        "The check took longer than its limit and was stopped.",
      );
    return true;
  }
}
