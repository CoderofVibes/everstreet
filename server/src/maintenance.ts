// Job 002d: the customer maintenance supervisor (docs/design/CUSTOMER_MAINTENANCE.md). It advances
// already-authorized customer obligations through the existing fenced operations in
// customerUse.ts: it never prepares, signs, runs a provider call, reconciles a sale or grants
// itself authority. Explicit lifecycle (start, bounded pass, stop/drain); durable coordination
// (a compare-and-set lease across processes); bounded work per pass. Nothing starts it in main.

import type { CustomerUseOptions, CustomerUses } from "./customerUse.ts";
import type { Db } from "./db.ts";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface MaintenanceOptions {
  /** This instance's identity (opaque). */
  holder: string;
  /** The coordination name: one active supervisor per name. */
  name?: string;
  intervalMs?: number;
  /** How long a claim lasts without renewal. */
  leaseMs?: number;
  /** Items per phase per pass (1..25). */
  batch?: number;
  /** Wall time a pass may spend starting items. */
  passBudgetMs?: number;
  /** Time one item may take before the pass moves on (its own lease fences a late finish). */
  opDeadlineMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  now?: () => number;
  timers?: Timers;
}

export type Task = "reserve" | "settle" | "result" | "input";

export interface PassReport {
  outcome: "done" | "busy" | "standby" | "lease_lost" | "stopped";
  started_ms: number;
  counts: Record<string, number>;
  skipped: string[];
}

/**
 * Counts an adapter's underlying calls still outstanding, including ones that outlived their
 * timeout because the adapter ignored the abort signal. It never answers for the adapter.
 */
export class AdapterGuard {
  outstanding = 0;
  constructor(readonly cap: number) {}
  saturated() {
    return this.outstanding >= this.cap;
  }
  track<T>(p: Promise<T>): Promise<T> {
    this.outstanding++;
    const done = () => {
      this.outstanding--;
    };
    p.then(done, done);
    return p;
  }
}

export interface AdapterGuards {
  chain: AdapterGuard;
  storage: AdapterGuard;
}

/** Wraps the injected chain reader/writer and protection storage with outstanding-call guards. */
export function guardAdapters(
  options: CustomerUseOptions,
  cap = 4,
): { options: CustomerUseOptions; guards: AdapterGuards } {
  const guards = { chain: new AdapterGuard(cap), storage: new AdapterGuard(cap) };
  const wrap = <T extends object>(target: T | null | undefined, guard: AdapterGuard): T | null => {
    if (!target) return (target ?? null) as T | null;
    return new Proxy(target, {
      get(t, key, recv) {
        const v = Reflect.get(t, key, recv);
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          const r = (v as (...a: unknown[]) => unknown).apply(t, args);
          return r instanceof Promise ? guard.track(r) : r;
        };
      },
    });
  };
  return {
    guards,
    options: {
      ...options,
      reader: wrap(options.reader, guards.chain),
      writer: wrap(options.writer, guards.chain),
      protection: wrap(options.protection, guards.storage) ?? undefined,
    },
  };
}

const NAME = "customer-maintenance";
const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class MaintenanceSupervisor {
  private readonly name: string;
  private readonly intervalMs: number;
  private readonly leaseMs: number;
  private readonly batch: number;
  private readonly passBudgetMs: number;
  private readonly opDeadlineMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly now: () => number;
  private readonly timers: Timers;
  private running: Promise<PassReport> | null = null;
  private timer: unknown = null;
  private started = false;
  private stopping = false;
  private gen = 0;

  constructor(
    private readonly db: Db,
    private readonly uses: CustomerUses,
    private readonly opts: MaintenanceOptions,
    private readonly guards: AdapterGuards | null = null,
  ) {
    const pos = (v: number | undefined, d: number, min = 1) => {
      const x = v ?? d;
      if (!Number.isSafeInteger(x) || x < min) throw new Error("maintenance options: invalid");
      return x;
    };
    if (!opts.holder || opts.holder.length > 80) throw new Error("maintenance options: holder");
    this.name = opts.name ?? NAME;
    this.intervalMs = pos(opts.intervalMs, 30_000);
    this.passBudgetMs = pos(opts.passBudgetMs, 20_000);
    this.opDeadlineMs = pos(opts.opDeadlineMs, 15_000);
    this.leaseMs = pos(opts.leaseMs, Math.max(this.intervalMs, this.passBudgetMs) * 3);
    this.batch = Math.min(25, pos(opts.batch, 10));
    this.backoffBaseMs = pos(opts.backoffBaseMs, 10_000);
    this.backoffMaxMs = pos(opts.backoffMaxMs, 600_000);
    this.now = opts.now ?? Date.now;
    this.timers = opts.timers ?? realTimers;
  }

  // ---------- lifecycle ----------

  start() {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.status("running");
    this.schedule(0);
  }

  /** No more passes; resolves when the current one ends (bounded by its budget and deadline). */
  async stop() {
    this.stopping = true;
    this.started = false;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (this.running) await this.running;
    this.status("stopped");
  }

  private schedule(ms: number) {
    if (!this.started || this.stopping) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.runPass().finally(() => this.schedule(this.intervalMs));
    }, ms);
  }

  /** One bounded pass; never overlaps another in this instance. */
  runPass(): Promise<PassReport> {
    if (this.running)
      return Promise.resolve({ outcome: "busy", started_ms: this.now(), counts: {}, skipped: [] });
    this.running = this.pass().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  // ---------- coordination ----------

  /** Claims or renews the lease by compare-and-set; returns whether this instance holds it. */
  private claim(): boolean {
    const now = this.now();
    const until = now + this.leaseMs;
    const me = this.opts.holder;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT holder, gen, until_ms FROM maintenance_lease WHERE name = ?")
        .get(this.name) as { holder: string; gen: number; until_ms: number } | undefined;
      let ok = false;
      if (!row) {
        this.db
          .prepare(
            "INSERT INTO maintenance_lease (name, holder, gen, until_ms) VALUES (?, ?, 1, ?)",
          )
          .run(this.name, me, until);
        this.gen = 1;
        ok = true;
      } else if (row.holder === me && row.gen === this.gen && row.until_ms > now) {
        this.db
          .prepare(
            "UPDATE maintenance_lease SET until_ms = ? WHERE name = ? AND holder = ? AND gen = ?",
          )
          .run(until, this.name, me, this.gen);
        ok = true;
      } else if (row.until_ms <= now) {
        this.db
          .prepare(
            "UPDATE maintenance_lease SET holder = ?, gen = gen + 1, until_ms = ? WHERE name = ? AND gen = ?",
          )
          .run(me, until, this.name, row.gen);
        this.gen = row.gen + 1;
        ok = true;
      }
      this.db.exec("COMMIT");
      return ok;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private status(state: "running" | "stopped", pass?: PassReport) {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO maintenance_status (name, holder, state, interval_ms, started_ms, heartbeat_ms, last_pass_ms, last_pass)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, state = excluded.state, interval_ms = excluded.interval_ms,
           started_ms = CASE WHEN excluded.state = 'running' AND maintenance_status.state != 'running' THEN excluded.started_ms ELSE maintenance_status.started_ms END,
           heartbeat_ms = excluded.heartbeat_ms,
           last_pass_ms = COALESCE(excluded.last_pass_ms, maintenance_status.last_pass_ms),
           last_pass = COALESCE(excluded.last_pass, maintenance_status.last_pass)`,
      )
      .run(
        this.name,
        this.opts.holder,
        state,
        this.intervalMs,
        now,
        now,
        pass ? now : null,
        pass
          ? JSON.stringify({ outcome: pass.outcome, counts: pass.counts, skipped: pass.skipped })
          : null,
      );
  }

  // ---------- one pass ----------

  private async pass(): Promise<PassReport> {
    const started = this.now();
    const report: PassReport = { outcome: "done", started_ms: started, counts: {}, skipped: [] };
    if (!this.claim()) return { ...report, outcome: "standby" };
    if (this.started) this.status("running");
    const bump = (k: string) => {
      report.counts[k] = (report.counts[k] ?? 0) + 1;
    };
    this.prune();
    const halt = await this.phasePrepared(bump, started, report);
    if (halt) return this.finish({ ...report, outcome: halt });
    for (const task of ["reserve", "settle", "result", "input"] as const) {
      const guard =
        task === "reserve" || task === "settle" ? this.guards?.chain : this.guards?.storage;
      if (guard?.saturated()) {
        report.skipped.push(`${task}:adapter_saturated`);
        continue;
      }
      if ((task === "result" || task === "input") && this.uses.deletionScheme() === null) {
        report.skipped.push(`${task}:deletion_unavailable`);
        continue;
      }
      const stop = await this.phase(task, bump, started, report);
      if (stop) return this.finish({ ...report, outcome: stop });
    }
    return this.finish(report);
  }

  /**
   * One phase: up to `batch` items eligible now and not backed off, oldest first. Before each
   * item: stopping, the pass budget and the lease are checked. Each item is raced against the
   * operation deadline; its own lease fences a late finish.
   */
  private async phase(
    task: Task,
    bump: (k: string) => void,
    started: number,
    report: PassReport,
  ): Promise<PassReport["outcome"] | null> {
    const ids = this.select(task);
    for (const id of ids) {
      if (this.stopping) return "stopped";
      if (this.now() - started >= this.passBudgetMs) {
        report.skipped.push(`${task}:budget`);
        return null;
      }
      if (!this.claim()) return "lease_lost";
      const code = await this.withDeadline(() => this.operate(task, id));
      bump(`${task}:${code}`);
      if (NEUTRAL.has(code)) continue;
      if (PROGRESS[task].has(code)) this.clearBackoff(task, id);
      else this.backoff(task, id, code);
    }
    return null;
  }

  private operate(task: Task, id: string): Promise<string> {
    switch (task) {
      case "reserve":
        return this.uses.step(id);
      case "settle":
        return this.uses.settleOne(id);
      case "result":
        return this.uses.deleteResult(id);
      case "input":
        return this.uses.deleteInput(id);
    }
  }

  private withDeadline(op: () => Promise<string>): Promise<string> {
    let handle: unknown = null;
    const deadline = new Promise<string>((resolve) => {
      handle = this.timers.set(() => resolve("timeout"), this.opDeadlineMs);
    });
    const work = op().catch(() => "error");
    return Promise.race([work, deadline]).finally(() => this.timers.clear(handle));
  }

  /** Eligible now and not backed off, by the same rules the operation re-checks itself. */
  private select(task: Task): string[] {
    const now = this.now();
    const notBacked = (alias: string) =>
      `NOT EXISTS (SELECT 1 FROM maintenance_backoff b WHERE b.task = '${task}' AND b.subject = ${alias} AND b.next_ms > ${Number(now)})`;
    let sql: string;
    let args: (string | number)[];
    if (task === "reserve") {
      sql = `SELECT r.id FROM customer_requests r
              WHERE r.state IN ('reserve_requested','reserve_unknown') AND r.conflict IS NULL
                AND (r.lease_until IS NULL OR r.lease_until <= ?) AND ${notBacked("r.id")}
              ORDER BY r.updated_at, r.id LIMIT ?`;
      args = [now, this.batch];
    } else if (task === "settle") {
      sql = `SELECT r.id FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
              WHERE r.state = 'reserved' AND r.conflict IS NULL
                AND (s.request_id IS NULL OR (s.state IN ('requested','unknown') AND (s.lease_until IS NULL OR s.lease_until <= ?)))
                AND ${notBacked("r.id")}
              ORDER BY r.updated_at, r.id LIMIT ?`;
      args = [now, this.batch];
    } else if (task === "result") {
      sql = `SELECT x.request_id AS id FROM customer_executions x
              WHERE x.result_state = 'stored' AND x.retention_until_ms <= ? AND x.result_scheme = ?
                AND ${notBacked("x.request_id")}
              ORDER BY x.retention_until_ms, x.request_id LIMIT ?`;
      args = [now, this.uses.deletionScheme() as string, this.batch];
    } else {
      // Filtered in SQL before the limit: a backlog of inputs that can't be deleted yet never
      // hides one that can (the 003n1 rules; deleteInput re-checks them).
      sql = `SELECT r.id FROM customer_requests r
               LEFT JOIN customer_executions x ON x.request_id = r.id
               LEFT JOIN runtime_invocations i ON i.id = x.invocation_id
              WHERE r.input_ref IS NOT NULL AND r.input_scheme = ?
                AND (r.state IN ('cancelled','expired','refused','unresolved')
                     OR CAST(r.serve_until_ms AS INTEGER) <= ?
                     OR (x.invocation_id IS NOT NULL AND COALESCE(i.state, '') != 'running'))
                AND ${notBacked("r.id")}
              ORDER BY r.created_at, r.id LIMIT ?`;
      args = [this.uses.deletionScheme() as string, now, this.batch];
    }
    return (this.db.prepare(sql).all(...args) as { id: string }[]).map((r) => r.id);
  }

  private backoff(task: Task, subject: string, code: string) {
    const now = this.now();
    const prior = this.db
      .prepare("SELECT failures FROM maintenance_backoff WHERE task = ? AND subject = ?")
      .get(task, subject) as { failures: number } | undefined;
    const failures = Math.min((prior?.failures ?? 0) + 1, 60);
    const wait = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** Math.min(failures - 1, 20));
    this.db
      .prepare(
        `INSERT INTO maintenance_backoff (task, subject, failures, next_ms, code, updated_ms) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(task, subject) DO UPDATE SET failures = excluded.failures, next_ms = excluded.next_ms, code = excluded.code, updated_ms = excluded.updated_ms`,
      )
      .run(task, subject, failures, now + wait, safeCode(code), now);
  }

  private clearBackoff(task: Task, subject: string) {
    this.db
      .prepare("DELETE FROM maintenance_backoff WHERE task = ? AND subject = ?")
      .run(task, subject);
  }

  /** Bounded upkeep: drop backoff rows untouched for a week (at most 200 per pass). */
  private prune() {
    this.db
      .prepare(
        "DELETE FROM maintenance_backoff WHERE rowid IN (SELECT rowid FROM maintenance_backoff WHERE updated_ms < ? LIMIT 200)",
      )
      .run(this.now() - 7 * 86_400_000);
  }

  private finish(report: PassReport) {
    if (this.started || report.outcome !== "standby")
      this.status(this.started ? "running" : "stopped", report);
    return report;
  }

  /** Expires prepared, unsigned requests past their signing time (local; never authorized). */
  private async phasePrepared(
    bump: (k: string) => void,
    started: number,
    report: PassReport,
  ): Promise<PassReport["outcome"] | null> {
    const ids = this.db
      .prepare(
        "SELECT id FROM customer_requests WHERE state = 'prepared' AND sign_by_ms < ? ORDER BY sign_by_ms, id LIMIT ?",
      )
      .all(this.now(), this.batch) as { id: string }[];
    for (const { id } of ids) {
      if (this.stopping) return "stopped";
      if (this.now() - started >= this.passBudgetMs) {
        report.skipped.push("prepared:budget");
        return null;
      }
      if (this.uses.expirePrepared(id) === "expired") bump("prepared:expired");
    }
    return null;
  }
}

// ---------- owner-safe health (counts only) ----------

export interface MaintenanceHealth {
  worker: {
    state: "not_started" | "running" | "overdue" | "stopped";
    heartbeat_at: string | null;
    last_pass_at: string | null;
    last_outcome: string | null;
  };
  /** This business only: aggregate counts, never ids, references or customer content. */
  work: {
    reservations_pending: number;
    units_waiting: number;
    units_unknown: number;
    paused_by_authority: number;
    needs_attention: number;
    results_overdue: number;
    results_deleted: number;
    deletions_failing: number;
  };
}

/**
 * The maintenance status a business owner may see. The worker's heartbeat is the platform's (not
 * per business); the counts are this business's own obligations, derived from the actual request,
 * settlement, execution and backoff records, never from what a worker intended.
 */
export function maintenanceHealth(
  db: Db,
  businessId: string,
  now: number,
  name = NAME,
): MaintenanceHealth {
  const st = db
    .prepare(
      "SELECT state, interval_ms, heartbeat_ms, last_pass_ms, last_pass FROM maintenance_status WHERE name = ?",
    )
    .get(name) as
    | {
        state: "running" | "stopped";
        interval_ms: number;
        heartbeat_ms: number | null;
        last_pass_ms: number | null;
        last_pass: string | null;
      }
    | undefined;
  const at = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
  let outcome: string | null = null;
  try {
    outcome = st?.last_pass
      ? ((JSON.parse(st.last_pass) as { outcome?: string }).outcome ?? null)
      : null;
  } catch {
    outcome = null;
  }
  const state: MaintenanceHealth["worker"]["state"] = !st
    ? "not_started"
    : st.state === "stopped"
      ? "stopped"
      : now - (st.heartbeat_ms ?? 0) > 3 * st.interval_ms
        ? "overdue"
        : "running";
  const n = (sql: string, ...args: (string | number)[]) =>
    (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
  const backed = (tasks: string, cond: string) =>
    n(
      `SELECT COUNT(*) AS n FROM maintenance_backoff b JOIN customer_requests r ON r.id = b.subject
        WHERE r.business_id = ? AND b.task IN (${tasks}) AND ${cond}`,
      businessId,
    );
  return {
    worker: {
      state,
      heartbeat_at: at(st?.heartbeat_ms),
      last_pass_at: at(st?.last_pass_ms),
      last_outcome: outcome,
    },
    work: {
      reservations_pending: n(
        "SELECT COUNT(*) AS n FROM customer_requests WHERE business_id = ? AND state IN ('reserve_requested','reserve_unknown') AND conflict IS NULL",
        businessId,
      ),
      units_waiting: n(
        `SELECT COUNT(*) AS n FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
          WHERE r.business_id = ? AND r.state = 'reserved' AND r.conflict IS NULL AND (s.request_id IS NULL OR s.state = 'requested')`,
        businessId,
      ),
      units_unknown: n(
        "SELECT COUNT(*) AS n FROM customer_settlements s JOIN customer_requests r ON r.id = s.request_id WHERE r.business_id = ? AND s.state = 'unknown'",
        businessId,
      ),
      paused_by_authority: backed("'settle'", "b.code = 'operator_not_authorized'"),
      needs_attention:
        n(
          "SELECT COUNT(*) AS n FROM customer_requests WHERE business_id = ? AND conflict IS NOT NULL",
          businessId,
        ) +
        n(
          "SELECT COUNT(*) AS n FROM customer_settlements s JOIN customer_requests r ON r.id = s.request_id WHERE r.business_id = ? AND s.state IN ('conflict','unresolved')",
          businessId,
        ) +
        backed(
          "'reserve','settle'",
          "(b.code = 'attempts_exhausted' OR (b.failures >= 3 AND b.code != 'not_decidable' AND b.code != 'operator_not_authorized'))",
        ),
      results_overdue: n(
        "SELECT COUNT(*) AS n FROM customer_executions x JOIN customer_requests r ON r.id = x.request_id WHERE r.business_id = ? AND x.result_state = 'stored' AND x.retention_until_ms <= ?",
        businessId,
        now,
      ),
      results_deleted: n(
        "SELECT COUNT(*) AS n FROM customer_executions x JOIN customer_requests r ON r.id = x.request_id WHERE r.business_id = ? AND x.result_state = 'deleted'",
        businessId,
      ),
      deletions_failing: backed("'result','input'", "b.code = 'failed'"),
    },
  };
}

/** Outcomes that mean another worker or a newer lease has the item: nothing to record. */
const NEUTRAL = new Set(["not_due", "stale"]);

/** Outcomes that are progress for each task; anything else is backed off. */
const PROGRESS: Record<Task, Set<string>> = {
  reserve: new Set(["reserved", "refused", "unresolved", "evidence_conflict", "resent"]),
  settle: new Set([
    "charged",
    "returned",
    "conflict",
    "unknown",
    "evidence_conflict",
    "submitted_settle",
    "submitted_release",
  ]),
  result: new Set(["deleted"]),
  input: new Set(["deleted"]),
};

/** Codes stored for backoff: fixed words only, never adapter text. */
const safeCode = (c: string) => (/^[a-z_]{1,40}$/.test(c) ? c : "other");
