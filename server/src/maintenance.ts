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
    // 002d1: starting proves nothing; health is written only by a holder's pass.
    this.schedule(0);
  }

  /**
   * No more passes; resolves when the current one ends (bounded by its budget and deadline). Only
   * the active holder records "stopped" and releases its lease (so another may take over at
   * once); a standby's stop changes nothing anyone else can see.
   */
  async stop() {
    this.stopping = true;
    this.started = false;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (this.running) await this.running;
    this.publish("stopped", undefined, true);
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

  /** Whether this instance is the active holder now (the durable lease, this generation). */
  private holds(): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM maintenance_lease WHERE name = ? AND holder = ? AND gen = ? AND until_ms > ?",
        )
        .get(this.name, this.opts.holder, this.gen, this.now()),
    );
  }

  /**
   * Job 002d1: health, the phase cursor and (on stop) the lease release are written only while
   * this instance holds the active lease generation, checked in the same transaction. A standby,
   * a stale instance or a late finish after a takeover writes nothing.
   */
  private publish(
    state: "running" | "stopped",
    pass?: PassReport,
    release = false,
    nextPhase: number | null = null,
    inFlight = false,
  ): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const ok = this.holds();
      if (ok) {
        this.status(state, pass, inFlight);
        if (nextPhase !== null)
          this.db
            .prepare(
              `INSERT INTO maintenance_cursor (name, next_phase, updated_ms) VALUES (?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET next_phase = excluded.next_phase, updated_ms = excluded.updated_ms`,
            )
            .run(this.name, nextPhase, this.now());
        if (release)
          this.db
            .prepare(
              "UPDATE maintenance_lease SET until_ms = ? WHERE name = ? AND holder = ? AND gen = ?",
            )
            .run(this.now(), this.name, this.opts.holder, this.gen);
      }
      this.db.exec("COMMIT");
      return ok;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /**
   * Job 002d2: `scheduled` says whether this holder's passes are scheduled (start() in effect),
   * not merely that one ran; `pass_started_ms` marks a pass in progress and is cleared by its
   * finish or by stop.
   */
  private status(state: "running" | "stopped", pass: PassReport | undefined, inFlight: boolean) {
    const now = this.now();
    const scheduled = state === "running" && this.started && !this.stopping ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO maintenance_status (name, holder, state, interval_ms, started_ms, heartbeat_ms, last_pass_ms, last_pass, scheduled, pass_started_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, state = excluded.state, interval_ms = excluded.interval_ms,
           started_ms = CASE WHEN excluded.state = 'running' AND maintenance_status.state != 'running' THEN excluded.started_ms ELSE maintenance_status.started_ms END,
           heartbeat_ms = excluded.heartbeat_ms,
           last_pass_ms = COALESCE(excluded.last_pass_ms, maintenance_status.last_pass_ms),
           last_pass = COALESCE(excluded.last_pass, maintenance_status.last_pass),
           scheduled = excluded.scheduled, pass_started_ms = excluded.pass_started_ms`,
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
        scheduled,
        inFlight ? now : null,
      );
  }

  // ---------- one pass ----------

  private async pass(): Promise<PassReport> {
    const started = this.now();
    const report: PassReport = { outcome: "done", started_ms: started, counts: {}, skipped: [] };
    if (!this.claim()) return { ...report, outcome: "standby" };
    // The holder is alive and a pass is in flight (a heartbeat; not a completed pass, and not a
    // schedule unless start() is in effect).
    this.publish("running", undefined, false, null, true);
    const bump = (k: string) => {
      report.counts[k] = (report.counts[k] ?? 0) + 1;
    };
    this.prune();
    // Job 002d1: phases rotate from a durable cursor, so no phase can always go first and use the
    // whole budget, and the rotation survives restarts and takeovers. A phase that had eligible
    // work but no budget left goes first in the next pass.
    const first = this.cursor();
    let budgetSkipped: number | null = null;
    for (let i = 0; i < PHASES.length; i++) {
      const at = (first + i) % PHASES.length;
      const name = PHASES[at] as Phase;
      const skips = report.skipped.length;
      const stop = await this.runPhase(name, bump, started, report);
      if (budgetSkipped === null && report.skipped.slice(skips).includes(`${name}:budget`))
        budgetSkipped = at;
      if (stop) return this.finish({ ...report, outcome: stop }, null);
    }
    return this.finish(report, budgetSkipped ?? (first + 1) % PHASES.length);
  }

  private cursor(): number {
    const r = this.db
      .prepare("SELECT next_phase FROM maintenance_cursor WHERE name = ?")
      .get(this.name) as { next_phase: number } | undefined;
    const n = r?.next_phase ?? 0;
    return Number.isSafeInteger(n) && n >= 0 ? n % PHASES.length : 0;
  }

  private async runPhase(
    name: Phase,
    bump: (k: string) => void,
    started: number,
    report: PassReport,
  ): Promise<PassReport["outcome"] | null> {
    if (name === "prepared") return this.phasePrepared(bump, started, report);
    if (name === "orphans") return this.phaseOrphans(bump, started, report);
    const guard =
      name === "reserve" || name === "settle" ? this.guards?.chain : this.guards?.storage;
    if (guard?.saturated()) {
      report.skipped.push(`${name}:adapter_saturated`);
      return null;
    }
    if ((name === "result" || name === "input") && this.uses.deletionScheme() === null) {
      report.skipped.push(`${name}:deletion_unavailable`);
      return null;
    }
    return this.phase(name, bump, started, report);
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
      // 002d1: after the await, publish nothing unless this instance still holds the lease.
      if (!this.holds()) return "lease_lost";
      bump(`${task}:${code}`);
      if (NEUTRAL.has(code)) continue;
      if (PROGRESS[task].has(code)) this.clearBackoff(task, id);
      else this.backoff(task, id, code);
    }
    return null;
  }

  /**
   * Job 003v: one bounded orphan sweep of protected storage (`CustomerUses.sweepProtected`). It
   * deletes only copies whose publication window is closed and that nothing references; the
   * scan position is this instance's (a restart starts from the beginning, which is safe).
   */
  private sweepAfter: string | null = null;
  private async phaseOrphans(
    bump: (k: string) => void,
    started: number,
    report: PassReport,
  ): Promise<PassReport["outcome"] | null> {
    if (this.guards?.storage.saturated()) {
      report.skipped.push("orphans:adapter_saturated");
      return null;
    }
    if (this.uses.deletionScheme() === null) {
      report.skipped.push("orphans:deletion_unavailable");
      return null;
    }
    if (this.now() - started >= this.passBudgetMs) {
      report.skipped.push("orphans:budget");
      return null;
    }
    if (!this.claim()) return "lease_lost";
    let result: Awaited<ReturnType<CustomerUses["sweepProtected"]>> | null = null;
    const code = await this.withDeadline(async () => {
      result = await this.uses.sweepProtected(this.batch, this.sweepAfter);
      return "swept";
    });
    if (!this.holds()) return "lease_lost";
    const r = result as Awaited<ReturnType<CustomerUses["sweepProtected"]>> | null;
    if (code !== "swept" || !r) {
      bump(`orphans:${code}`);
      return null;
    }
    this.sweepAfter = r.next;
    for (const k of ["deleted", "failed", "anomalies"] as const)
      for (let i = 0; i < r[k]; i++) bump(`orphans:${k}`);
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

  /** Records the pass (and the next phase) only if this instance still holds the lease. */
  private finish(report: PassReport, nextPhase: number | null) {
    if (report.outcome === "lease_lost") return report;
    this.publish("running", report, false, nextPhase);
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
    /**
     * running: a current holder's passes are scheduled and its heartbeat is fresh (the only state
     * that supports "by itself"); overdue: scheduled, heartbeat stale; not_scheduled: passes ran
     * only when asked (or a row from before 002d2); stopped; not_started: no pass ever recorded.
     */
    state: "not_started" | "running" | "overdue" | "stopped" | "not_scheduled";
    heartbeat_at: string | null;
    last_pass_at: string | null;
    last_outcome: string | null;
    /** A pass is in progress now (its start is recent). */
    in_flight: boolean;
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
/**
 * Job 003wf1: the platform worker's observed state only (no business, holder, count or customer
 * material): what maintenance_status says a holder's passes did, never what was configured.
 */
export function maintenanceWorker(db: Db, now: number, name = NAME): MaintenanceHealth["worker"] {
  const st = db
    .prepare(
      "SELECT state, interval_ms, heartbeat_ms, last_pass_ms, last_pass, scheduled, pass_started_ms FROM maintenance_status WHERE name = ?",
    )
    .get(name) as
    | {
        state: "running" | "stopped";
        interval_ms: number;
        heartbeat_ms: number | null;
        last_pass_ms: number | null;
        last_pass: string | null;
        scheduled: number;
        pass_started_ms: number | null;
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
      : st.scheduled !== 1
        ? "not_scheduled"
        : now - (st.heartbeat_ms ?? 0) > 3 * st.interval_ms
          ? "overdue"
          : "running";
  const inFlight =
    st?.state === "running" &&
    st.pass_started_ms !== null &&
    now - st.pass_started_ms <= 3 * st.interval_ms;
  return {
    state,
    heartbeat_at: at(st?.heartbeat_ms),
    last_pass_at: at(st?.last_pass_ms),
    last_outcome: outcome,
    in_flight: inFlight,
  };
}

export function maintenanceHealth(
  db: Db,
  businessId: string,
  now: number,
  name = NAME,
): MaintenanceHealth {
  const n = (sql: string, ...args: (string | number)[]) =>
    (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
  const backed = (tasks: string, cond: string) =>
    n(
      `SELECT COUNT(*) AS n FROM maintenance_backoff b JOIN customer_requests r ON r.id = b.subject
        WHERE r.business_id = ? AND b.task IN (${tasks}) AND ${cond}`,
      businessId,
    );
  return {
    worker: maintenanceWorker(db, now, name),
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

/** The phases, in rotation order; a pass starts at the durable cursor (job 002d1). */
type Phase = "prepared" | Task | "orphans";
const PHASES: readonly Phase[] = ["prepared", "reserve", "settle", "result", "input", "orphans"];

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
