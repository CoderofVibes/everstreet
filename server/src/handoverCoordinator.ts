// Job 003wf3 (docs/design/MANAGED_HANDOVER.md §4–§7, §16): the configured coordinator of managed
// (Gated) handovers. Only composed when `handover` is configured with a closer key per binding.
//
// One bounded pass per interval. Per business, under a per-business lease that every write
// re-checks (holder, generation AND unexpired: D7):
//   1. a fresh pinned read (its block's own timestamp), recorded through the observation
//      ordering rules, which arm and resolve the handover from accepted evidence only (D1);
//   2. drain: the existing leased customer operations (never-sent confirmations cancelled,
//      unexecuted units returned, pending reservations read back, settlements stepped);
//   3. every earlier close attempt resolved by its OWN hash (same bytes only; never a fresh
//      transaction for an unknown one);
//   4. readiness at that one read: the exact closing deal and contract checks, no active hold,
//      the floor, the deadline margin, every customer item final, no owner provider work running,
//      the closer capability, and no incompatible live peer (D3);
//   5. at most one new immutable order (its issue time the read block's time), created in one
//      transaction that re-checks the lease and peers, then dispatched through the closer writer;
//   6. after the contract shows this exact close: the existing reconciliation (system entry).
// Diagnostics are coalesced into the handover row; the journal stays bounded (D2). Nothing here
// opens a gate: only contract evidence does (handover.ts).

import { createHash } from "node:crypto";
import type { CustomerViewTransport, PinnedBlock } from "./customerRead.ts";
import type { CustomerUses } from "./customerUse.ts";
import type { TestnetCloserWriter, TxRpc } from "./customerWriter.ts";
import type { Db } from "./db.ts";
import {
  DEFAULT_JOURNAL,
  type HandoverRow,
  type JournalCaps,
  journal,
  latestHandover,
  openHandover,
} from "./handover.ts";
import type { V3Intents } from "./v3intents.ts";
import type { V3Observations } from "./v3observe.ts";
import {
  readSnapshot,
  type V3Binding,
  V3ReadError,
  type V3Snapshot,
  type ViewTransport,
} from "./v3read.ts";

/** lib.rs MAX_ISSUE_AGE_MS: a close order must land within 20 minutes of its issue time. */
export const MAX_ISSUE_AGE_MS = 1_200_000;
/** A finished handover's aged attempts are read by status at most this often. */
const STATUS_EVERY_MS = 60_000;

export interface CloserKey {
  /** The closer account the contract names (configured). */
  account: string;
  publicKey: string;
  writer: TestnetCloserWriter;
  rpc: TxRpc;
}

export interface CoordinatorOptions {
  holder: string;
  intervalMs: number;
  batch: number;
  passBudgetMs: number;
  opDeadlineMs: number;
  dispatchMarginMs: number;
  maxOrders: number;
  /** A function-call key's allowance must be unlimited or at least this (yoctoNEAR). */
  minAllowanceYocto?: bigint;
  journal?: JournalCaps;
  leaseMs?: number;
  readTimeoutMs?: number;
  now?: () => number;
}

export type Capability = { ready: boolean; reason: string | null };

class LeaseLost extends Error {}

const OPEN_STATES = ["gated", "ready", "ordering", "outcome_unknown"];

/** Live processes (presence) that don't declare the handover gate (D3). */
export function incompatiblePeers(db: Db, nowMs: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM process_presence WHERE until_ms > ?
           AND (capabilities IS NULL OR COALESCE(json_extract(capabilities, '$.handover_gate'), 0) < 1)`,
      )
      .get(nowMs) as { n: number }
  ).n;
}

export class HandoverCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private passing: Promise<unknown> | null = null;
  private stopped = false;
  /**
   * Astra 01:41: each business's step in flight and its operation token. A timed-out or stopped
   * step keeps running (a cancelled Promise isn't a stopped call) but its token is dead, so every
   * later write it reaches is refused (requireLease); a business with a step still running is
   * skipped, never stepped twice at once.
   */
  private readonly ops = new Map<string, { gen: number; dead: boolean; done: Promise<unknown> }>();
  /** When each finished handover's aged attempts were last read by status only. */
  private readonly statusReadAt = new Map<string, number>();
  /** The last business a pass visited (the next pass starts after it). */
  private cursor: string | null = null;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly caps: JournalCaps;

  constructor(
    private readonly db: Db,
    private readonly obs: V3Observations,
    private readonly intents: V3Intents,
    private readonly uses: CustomerUses | null,
    private readonly reader: CustomerViewTransport,
    private readonly keys: Map<string, CloserKey>,
    private readonly opts: CoordinatorOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.leaseMs = opts.leaseMs ?? 3 * Math.max(opts.intervalMs, opts.passBudgetMs);
    this.caps = opts.journal ?? DEFAULT_JOURNAL;
    if (this.caps.reserve < 3 * opts.maxOrders + 8)
      throw new Error("handover: the journal reserve must fit every order's entries (D2)");
  }

  // ---------- lifecycle ----------

  start() {
    if (this.stopped || this.timer) return;
    const tick = () => {
      this.timer = null;
      if (this.stopped) return;
      this.passing = this.pass()
        .catch(() => {})
        .finally(() => {
          this.passing = null;
          if (!this.stopped) this.timer = setTimeout(tick, this.opts.intervalMs);
        });
    };
    this.timer = setTimeout(tick, Math.min(1000, this.opts.intervalMs));
    (this.timer as { unref?: () => void }).unref?.();
  }

  /**
   * Ends scheduling and invalidates every step in flight (their later writes are refused), then
   * waits a bounded time for them. Returns whether they had all finished: a step blocked in a
   * read or a send may still be running, and is reported, not presented as quiescent.
   */
  async stop(): Promise<{ quiescent: boolean; running: number }> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const op of this.ops.values()) op.dead = true;
    const all = Promise.allSettled([this.passing, ...[...this.ops.values()].map((o) => o.done)]);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finished = await Promise.race([
      all.then(() => true),
      new Promise<boolean>((done) => {
        timer = setTimeout(() => done(false), this.opts.opDeadlineMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return { quiescent: finished, running: finished ? 0 : this.ops.size };
  }

  /** Steps still running (each one's token is dead once stopped). */
  running(): number {
    return this.ops.size;
  }

  /** Settles when every step in flight has actually finished (unbounded: the caller bounds it). */
  settled(): Promise<unknown> {
    return Promise.allSettled([this.passing, ...[...this.ops.values()].map((o) => o.done)]);
  }

  // ---------- capability (§16.3) ----------

  /** Whether this installation can manage a Gated close for the business now. */
  async capability(businessId: string, read?: { snapshot: V3Snapshot; terms: unknown }) {
    const key = this.keys.get(businessId);
    if (!key) return { ready: false, reason: "no_closer_key" } satisfies Capability;
    const binding = this.obs.bindingFor(businessId);
    if (!binding) return { ready: false, reason: "not_bound" };
    let r = read;
    if (!r) {
      try {
        r = await this.read(binding);
      } catch {
        return { ready: false, reason: "read_failed" };
      }
    }
    const c = r.snapshot.control;
    if (c.close_mode !== "gated") return { ready: false, reason: "not_gated" };
    if (c.closer !== key.account) return { ready: false, reason: "closer_mismatch" };
    const t = r.terms as { version?: unknown; closing_hold_guard?: unknown } | null;
    if (t?.closing_hold_guard !== true || !(Number(t.version) >= 1))
      return { ready: false, reason: "contract_upgrade" };
    let k: Awaited<ReturnType<TxRpc["accessKey"]>>;
    try {
      k = await key.rpc.accessKey(key.account, key.publicKey);
    } catch {
      return { ready: false, reason: "key_read_failed" };
    }
    if (!k) return { ready: false, reason: "key_unknown" };
    if (k.permission === "FullAccess") return { ready: false, reason: "full_access_key" };
    const fc = (
      k.permission as {
        FunctionCall?: { receiver_id?: unknown; method_names?: unknown; allowance?: unknown };
      } | null
    )?.FunctionCall;
    if (
      !fc ||
      fc.receiver_id !== binding.account ||
      !Array.isArray(fc.method_names) ||
      fc.method_names.length !== 1 ||
      fc.method_names[0] !== "close_sale"
    )
      return { ready: false, reason: "key_permission" };
    if (fc.allowance !== null && fc.allowance !== undefined) {
      const min = this.opts.minAllowanceYocto ?? 0n;
      let a: bigint;
      try {
        a = BigInt(String(fc.allowance));
      } catch {
        return { ready: false, reason: "key_permission" };
      }
      if (a < min) return { ready: false, reason: "allowance_low" };
    }
    if (incompatiblePeers(this.db, this.now()) > 0)
      return { ready: false, reason: "incompatible_peer" };
    return { ready: true, reason: null };
  }

  // ---------- one pass ----------

  async pass() {
    const started = this.now();
    const open = this.db
      .prepare(
        "SELECT business_id FROM business_handovers WHERE state IN ('gated','ready','ordering','outcome_unknown','closed_observed','reconciled','attention') ORDER BY updated_ms",
      )
      .all() as { business_id: string }[];
    // Astra 03:18: every open handover and every configured business is visited in turn, in a
    // stable order starting after the last one this coordinator visited. A business whose step
    // is busy counts as visited (it can't hold the front); one skipped for the pass budget comes
    // first next time. The batch and the pass budget stay finite.
    const all = [...new Set([...open.map((o) => o.business_id), ...this.keys.keys()])].sort();
    const from = this.cursor === null ? 0 : all.findIndex((id) => id > (this.cursor as string));
    const start = from < 0 ? 0 : from;
    const ids = [...all.slice(start), ...all.slice(0, start)].slice(0, this.opts.batch);
    const report: Record<string, string> = {};
    for (const id of ids) {
      if (this.stopped) break;
      if (this.now() - started >= this.opts.passBudgetMs) {
        report[id] = "budget";
        continue;
      }
      this.cursor = id;
      if (this.ops.has(id)) {
        report[id] = "busy"; // its earlier step is still running (dead or alive)
        continue;
      }
      const op = { gen: 0, dead: false, done: Promise.resolve() as Promise<unknown> };
      const running = this.step(id, op).finally(() => {
        if (this.ops.get(id) === op) this.ops.delete(id);
      });
      op.done = running.catch(() => {});
      this.ops.set(id, op);
      const out = await this.withDeadline(() => running).catch((e) =>
        e instanceof LeaseLost
          ? "lease_lost"
          : `error:${String((e as Error)?.message).slice(0, 60)}`,
      );
      if (out === "deadline") op.dead = true;
      report[id] = out;
    }
    return report;
  }

  private async withDeadline<T>(f: () => Promise<T>): Promise<T | "deadline"> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const late = new Promise<"deadline">((r) => {
      timer = setTimeout(() => r("deadline"), this.opts.opDeadlineMs);
    });
    try {
      return await Promise.race([f(), late]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---------- the per-business lease (D7) ----------

  private tx<T>(f: () => T): T {
    if (this.db.isTransaction) return f();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = f();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Claims, renews or takes over an expired lease; its generation, or null (another holds it). */
  claim(businessId: string): number | null {
    return this.tx(() => {
      const t = this.now();
      const row = this.db
        .prepare("SELECT holder, gen, until_ms FROM handover_lease WHERE business_id = ?")
        .get(businessId) as { holder: string; gen: number; until_ms: number } | undefined;
      if (!row) {
        this.db
          .prepare(
            "INSERT INTO handover_lease (business_id, holder, gen, until_ms) VALUES (?, ?, 1, ?)",
          )
          .run(businessId, this.opts.holder, t + this.leaseMs);
        return 1;
      }
      if (row.holder === this.opts.holder && row.until_ms > t) {
        this.db
          .prepare(
            "UPDATE handover_lease SET until_ms = ? WHERE business_id = ? AND holder = ? AND gen = ?",
          )
          .run(t + this.leaseMs, businessId, this.opts.holder, row.gen);
        return row.gen;
      }
      if (row.until_ms > t) return null;
      const gen = row.gen + 1;
      this.db
        .prepare(
          "UPDATE handover_lease SET holder = ?, gen = ?, until_ms = ? WHERE business_id = ? AND gen = ?",
        )
        .run(this.opts.holder, gen, t + this.leaseMs, businessId, row.gen);
      const h = openHandover(this.db, businessId);
      if (h) journal(this.db, h, "takeover", null, { leaseGen: gen, caps: this.caps, now: t });
      return gen;
    });
  }

  /** In the caller's transaction: this holder's lease, at this generation, unexpired (D7). */
  private requireLease(businessId: string, gen: number) {
    const op = this.ops.get(businessId);
    if (this.stopped || !op || op.dead || op.gen !== gen) throw new LeaseLost();
    const ok = this.db
      .prepare(
        "SELECT 1 FROM handover_lease WHERE business_id = ? AND holder = ? AND gen = ? AND until_ms > ?",
      )
      .get(businessId, this.opts.holder, gen, this.now());
    if (!ok) throw new LeaseLost();
  }

  // ---------- the read ----------

  /** One coherent snapshot at one final block, with that block's own timestamp. */
  async read(binding: V3Binding) {
    const ms = this.opts.readTimeoutMs ?? 10_000;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const block = (await this.reader.finalBlock(binding.network, ctl.signal)) as PinnedBlock;
      const pinned: ViewTransport = {
        network: this.reader.network,
        finalBlock: async () => ({ height: block.height, hash: block.hash }),
        view: (i) => this.reader.view(i),
      };
      const snapshot = await readSnapshot(pinned, binding, { timeoutMs: ms });
      let terms: unknown = null;
      try {
        const r = await this.reader.view({
          network: binding.network,
          account: binding.account,
          method: "get_handover_terms",
          args: {},
          block: { height: block.height, hash: block.hash },
          signal: ctl.signal,
        });
        if (r.block.height === block.height && r.block.hash === block.hash)
          terms = JSON.parse(r.result) as unknown;
      } catch {
        terms = null; // older code: no such view
      }
      return { snapshot, block, terms };
    } finally {
      clearTimeout(timer);
      ctl.abort();
    }
  }

  // ---------- one business ----------

  async step(businessId: string, op: { gen: number; dead: boolean }): Promise<string> {
    const gen = this.claim(businessId);
    if (gen === null) return "standby";
    op.gen = gen;
    const alive = () => {
      const o = this.ops.get(businessId);
      return !this.stopped && o !== undefined && !o.dead && o.gen === gen;
    };
    const binding = this.obs.bindingFor(businessId);
    if (!binding) return "unbound";
    let r: Awaited<ReturnType<HandoverCoordinator["read"]>>;
    try {
      r = await this.read(binding);
    } catch (e) {
      this.status(businessId, gen, e instanceof V3ReadError ? `read_${e.code}` : "read_failed");
      return "read_failed";
    }
    const recorded = this.tx(() => {
      this.requireLease(businessId, gen);
      return this.obs.record(businessId, r.snapshot, this.now()).outcome;
    });
    if (recorded !== "accepted" && recorded !== "duplicate") {
      this.status(businessId, gen, `evidence_${recorded}`);
      return `evidence_${recorded}`;
    }
    let h = openHandover(this.db, businessId);
    if (!h) {
      // S-12 / Astra 03:30, 03:40: finished handovers' close attempts still unresolved are
      // resolved by their own transactions, so their evidence is never left looking absent, and
      // nothing here moves a finished handover. The three most recent finished handovers with an
      // unknown attempt are considered (a resale doesn't discard an earlier one's recovery).
      // While an order is young enough to execute, its same bytes may be resent (the writer's
      // rules); once every order is past the contract's limit (MAX_ISSUE_AGE_MS) nothing is
      // sent: a status-only read of the original's own hash, at most once a minute per handover
      // (this coordinator's memory, not durable across a restart). A missing status proves
      // nothing: the attempt stays unknown.
      const pending = this.db
        .prepare(
          `SELECT h.id FROM business_handovers h WHERE h.business_id = ? AND EXISTS (
             SELECT 1 FROM closer_tx_attempts a WHERE a.operation LIKE 'close-' || h.id || '-%' AND a.state = 'signed')
           ORDER BY h.created_ms DESC LIMIT 3`,
        )
        .all(businessId) as { id: string }[];
      if (pending.length === 0) return "idle";
      const latest = latestHandover(this.db, businessId);
      for (const p of pending) {
        const old = this.db
          .prepare("SELECT * FROM business_handovers WHERE id = ?")
          .get(p.id) as unknown as HandoverRow;
        const youngest = this.db
          .prepare(
            "SELECT MAX(json_extract(order_json, '$.issued_at_ms')) AS t FROM close_orders WHERE handover_id = ?",
          )
          .get(old.id) as { t: string | null };
        const aged =
          youngest.t === null ||
          BigInt(r.block.timestamp_ms) - BigInt(youngest.t) > BigInt(MAX_ISSUE_AGE_MS);
        if (!aged && latest?.id === old.id) {
          if (!alive()) return "stopped";
          await this.resolveAttempts(old, binding.account, gen);
          return "attempts_resolved";
        }
        if (!aged) continue; // an older handover's young order: its own resolution comes later
        const due = (this.statusReadAt.get(old.id) ?? 0) + STATUS_EVERY_MS <= this.now();
        if (!due) continue;
        this.statusReadAt.set(old.id, this.now());
        if (!alive()) return "stopped";
        return this.statusOnly(old, gen);
      }
      return "idle";
    }
    if (h.state === "attention") return "attention";
    if (h.state === "closed_observed" || h.state === "reconciled") {
      if (!h.intent_id) {
        this.attention(h, gen, "intent_missing", r.block);
        return "attention";
      }
      // An earlier attempt still unresolved is resolved by its own hash (Astra 01:41): whichever
      // order closed it, the evidence is reconciled, never left looking absent.
      if (!alive()) return "stopped";
      await this.resolveAttempts(h, binding.account, gen);
      if (!alive()) return "stopped";
      const rec = await this.intents.reconcile(null, businessId, h.intent_id, {
        handoverId: h.id,
        fence: () => this.requireLease(businessId, gen),
      });
      if (rec.state === "conflict") this.attention(h, gen, `reconcile_${rec.code}`, r.block);
      return `reconcile_${rec.state}`;
    }
    // gated / ready / ordering / outcome_unknown
    if (!alive()) return "stopped";
    if (this.uses) await this.uses.drainForHandover(businessId);
    if (!alive()) return "stopped";
    await this.resolveAttempts(h, binding.account, gen);
    if (!alive()) return "stopped";
    h = openHandover(this.db, businessId) as HandoverRow | null;
    if (!h || !OPEN_STATES.includes(h.state)) return "moved";
    const cap = await this.capability(businessId, { snapshot: r.snapshot, terms: r.terms });
    const reason = this.readiness(h, r.snapshot, r.block, cap);
    if (reason) {
      this.status(businessId, gen, reason);
      return `not_ready:${reason}`;
    }
    // Ready at this read: does an order need to be (re)issued?
    const orders = this.db
      .prepare(
        "SELECT n, order_json, created_ms FROM close_orders WHERE handover_id = ? ORDER BY n",
      )
      .all(h.id) as { n: number; order_json: string; created_ms: number }[];
    const last = orders.at(-1);
    if (last) {
      const issued = Number((JSON.parse(last.order_json) as { issued_at_ms: string }).issued_at_ms);
      const age = Number(r.block.timestamp_ms) - issued;
      const state = this.attemptState(h, last.n);
      const failed = state === "failure";
      if (state === null && age < MAX_ISSUE_AGE_MS - this.opts.dispatchMarginMs) {
        // Astra 03:10: a durable order whose sending never started (the step that made it ended
        // before the writer ran). The SAME order is sent: its exact stored contents under its own
        // operation identity, through the writer's single-sender admission (the attempt is
        // persisted before any broadcast; a concurrent sender of this operation is refused there).
        // Never a replacement: an order that was never sent can't land late, but a new one isn't
        // needed while this one is still young enough.
        this.tx(() => {
          this.requireLease(businessId, gen);
          journal(this.db, h, "order_resumed", String(last.n), {
            caps: this.caps,
            now: this.now(),
          });
        });
        return this.dispatch(
          h,
          last.n,
          JSON.parse(last.order_json) as Record<string, unknown>,
          binding.account,
          gen,
        );
      }
      if (!failed && age < MAX_ISSUE_AGE_MS - this.opts.dispatchMarginMs) {
        this.status(businessId, gen, "order_outstanding");
        return "order_outstanding";
      }
      if (orders.length >= this.opts.maxOrders) {
        this.status(businessId, gen, "orders_exhausted");
        return "orders_exhausted";
      }
    }
    const made = this.createOrder(h, gen, r.snapshot, r.block);
    if (!made) return "order_refused";
    return this.dispatch(h, made.n, made.order, binding.account, gen);
  }

  /** The first reason this handover isn't ready at this read, or null (§4.2, §16). */
  private readiness(h: HandoverRow, s: V3Snapshot, block: PinnedBlock, cap: Capability) {
    if (!cap.ready) return `capability_${cap.reason}`;
    const c = s.control;
    const d = c.live_deal;
    if (d?.state !== "closing" || d.seq !== h.deal_seq || d.version !== h.version)
      return "deal_changed";
    if (d.digest !== h.digest) return "digest_changed";
    if (c.control_seq !== h.closing_control_seq) return "control_moved";
    if (c.generation !== h.expected_generation || c.owner !== h.seller_account)
      return "generation_changed";
    if (c.service_manifest !== h.manifest || c.manifest_seq !== h.manifest_seq)
      return "manifest_changed";
    if (d.escrow !== d.price) return "unfunded";
    if (BigInt(s.treasury.ent_held_value) !== 0n) return "holds_active";
    if (BigInt(s.treasury.available) < BigInt(h.available_floor)) return "below_floor";
    if (BigInt(h.deadline_ms) - BigInt(block.timestamp_ms) < BigInt(this.opts.dispatchMarginMs))
      return "too_late";
    const inv = this.uses?.handoverInventory(h.business_id);
    if (inv) for (const [k, v] of Object.entries(inv)) if (v > 0) return `customers_${k}`;
    const owner = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM eval_runs WHERE business_id = ? AND state = 'running')
              + (SELECT COUNT(*) FROM runtime_invocations WHERE business_id = ? AND state = 'running' AND purpose IN ('trial','evaluation','release')) AS n`,
      )
      .get(h.business_id, h.business_id) as { n: number };
    if (owner.n > 0) return "owner_work_running";
    return null;
  }

  /** Coalesced current diagnostics (D2): the row's status columns, and a bounded journal. */
  private status(businessId: string, gen: number, reason: string) {
    try {
      this.tx(() => {
        this.requireLease(businessId, gen);
        const h = openHandover(this.db, businessId);
        if (!h) return;
        const repeat = h.check_reason === reason ? h.check_repeat + 1 : 1;
        this.db
          .prepare(
            "UPDATE business_handovers SET check_ms = ?, check_reason = ?, check_repeat = ?, updated_ms = ? WHERE id = ?",
          )
          .run(this.now(), reason, repeat, this.now(), h.id);
        if (repeat === 1)
          journal(this.db, h, "not_ready", reason, {
            leaseGen: gen,
            caps: this.caps,
            now: this.now(),
          });
      });
    } catch (e) {
      if (!(e instanceof LeaseLost)) throw e;
    }
  }

  private attention(h: HandoverRow, gen: number, reason: string, block: PinnedBlock) {
    this.tx(() => {
      this.requireLease(h.business_id, gen);
      const c = this.db
        .prepare(
          "UPDATE business_handovers SET state = 'attention', attention_reason = ?, rev = rev + 1, updated_ms = ? WHERE id = ? AND state NOT IN ('attention','released_to_buyer','released_to_seller','released_current','ended')",
        )
        .run(reason, this.now(), h.id);
      if (c.changes)
        journal(this.db, h, "attention", reason, {
          block,
          leaseGen: gen,
          caps: this.caps,
          now: this.now(),
        });
    });
  }

  private evidence(h: HandoverRow, kind: string, e: unknown) {
    const n = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM handover_evidence WHERE handover_id = ?")
        .get(h.id) as {
        n: number;
      }
    ).n;
    if (n >= 2 * this.opts.maxOrders + 8) return;
    this.db
      .prepare(
        "INSERT INTO handover_evidence (handover_id, seq, kind, evidence, at_ms) VALUES (?, ?, ?, ?, ?)",
      )
      .run(h.id, n + 1, kind, JSON.stringify(e), this.now());
  }

  /** One immutable order, under the lease and with no incompatible live peer (D3, D7). */
  private createOrder(h: HandoverRow, gen: number, s: V3Snapshot, block: PinnedBlock) {
    const order = {
      deal_seq: h.deal_seq,
      version: h.version,
      digest: h.digest,
      expected_generation: h.expected_generation,
      closing_control_seq: h.closing_control_seq,
      manifest: h.manifest,
      manifest_seq: h.manifest_seq,
      issued_at_ms: block.timestamp_ms,
    };
    try {
      return this.tx(() => {
        this.requireLease(h.business_id, gen);
        if (incompatiblePeers(this.db, this.now()) > 0) {
          this.status(h.business_id, gen, "incompatible_peer");
          return null;
        }
        const now = openHandover(this.db, h.business_id);
        if (!now || now.id !== h.id || !OPEN_STATES.includes(now.state)) return null;
        const n =
          (
            this.db
              .prepare("SELECT COUNT(*) AS n FROM close_orders WHERE handover_id = ?")
              .get(h.id) as { n: number }
          ).n + 1;
        if (n > this.opts.maxOrders) return null;
        const json = JSON.stringify(order);
        this.db
          .prepare(
            "INSERT INTO close_orders (handover_id, n, order_json, order_digest, read_height, read_hash, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(h.id, n, json, hashText(json), block.height, block.hash, this.now());
        if (now.state === "gated")
          this.evidence(now, "ready", {
            block,
            treasury: {
              available: s.treasury.available,
              ent_held_value: s.treasury.ent_held_value,
            },
          });
        this.evidence(now, "order", { n, block, order });
        this.db
          .prepare(
            "UPDATE business_handovers SET state = 'ordering', check_reason = NULL, check_repeat = 0, rev = rev + 1, updated_ms = ? WHERE id = ?",
          )
          .run(this.now(), h.id);
        journal(this.db, now, "order_created", String(n), {
          block,
          leaseGen: gen,
          caps: this.caps,
          now: this.now(),
        });
        return { n, order };
      });
    } catch (e) {
      if (e instanceof LeaseLost) return null;
      throw e;
    }
  }

  private op(h: HandoverRow, n: number) {
    return `close-${h.id}-${n}`;
  }

  private attemptState(h: HandoverRow, n: number): string | null {
    const r = this.db
      .prepare(
        "SELECT state FROM closer_tx_attempts WHERE operation = ? ORDER BY attempt DESC LIMIT 1",
      )
      .get(`${this.op(h, n)}|close_sale`) as { state: string } | undefined;
    return r?.state ?? null;
  }

  /**
   * Astra 03:30: each of a finished handover's still-unknown attempts is read by its own hash
   * only (never sent). A final result is recorded on the attempt and journaled once.
   */
  private async statusOnly(h: HandoverRow, gen: number): Promise<string> {
    const key = this.keys.get(h.business_id);
    if (!key) return "no_closer_key";
    const orders = this.db
      .prepare("SELECT n FROM close_orders WHERE handover_id = ? ORDER BY n")
      .all(h.id) as { n: number }[];
    let resolved = 0;
    for (const o of orders) {
      if (this.attemptState(h, o.n) !== "signed") continue;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.opts.opDeadlineMs);
      try {
        const a = await key.writer.statusOnly(this.op(h, o.n), "close_sale", ctl.signal);
        const state = this.attemptState(h, o.n);
        if (state === "success" || state === "failure") {
          resolved++;
          try {
            this.tx(() => {
              this.requireLease(h.business_id, gen);
              journal(this.db, h, "attempt_final", `${o.n}:${state}:status_only`, {
                caps: this.caps,
                now: this.now(),
              });
            });
          } catch (e) {
            if (!(e instanceof LeaseLost)) throw e;
          }
        }
        void a;
      } finally {
        clearTimeout(timer);
      }
    }
    return resolved > 0 ? "attempts_status_resolved" : "attempts_status_unknown";
  }

  /** Sends one admitted order. The writer persists the signed attempt before broadcasting. */
  private async dispatch(
    h: HandoverRow,
    n: number,
    order: Record<string, unknown>,
    account: string,
    gen: number,
  ): Promise<string> {
    const key = this.keys.get(h.business_id);
    if (!key) return "no_closer_key";
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.opDeadlineMs);
    let answer: Awaited<ReturnType<TestnetCloserWriter["closeSale"]>>;
    try {
      answer = await key.writer.closeSale({
        operation: this.op(h, n),
        account,
        order,
        signal: ctl.signal,
      });
    } catch {
      answer = { status: "unknown", detail: "no_answer" };
    } finally {
      clearTimeout(timer);
    }
    // The writer already persisted the signed attempt (it is resolved by its own hash later,
    // whoever coordinates). Only a step still holding its lease and token records its journal and
    // moves the handover (D7, Astra 01:41).
    let current = true;
    try {
      this.tx(() => this.requireLease(h.business_id, gen));
    } catch (e) {
      if (!(e instanceof LeaseLost)) throw e;
      current = false;
    }
    if (!current) return `dispatched_without_lease:${answer.status}`;
    this.tx(() => {
      this.requireLease(h.business_id, gen);
      const now = openHandover(this.db, h.business_id);
      if (!now || now.id !== h.id) return;
      const code =
        answer.status === "refused"
          ? `refused:${answer.code}`
          : answer.status === "unknown"
            ? `unknown:${answer.detail ?? ""}`
            : answer.status;
      journal(this.db, now, "attempt_recorded", `${n}:${code}`, {
        caps: this.caps,
        now: this.now(),
      });
      if (answer.status === "unknown" && now.state === "ordering")
        this.db
          .prepare(
            "UPDATE business_handovers SET state = 'outcome_unknown', rev = rev + 1, updated_ms = ? WHERE id = ? AND state = 'ordering'",
          )
          .run(this.now(), h.id);
    });
    return `dispatched:${answer.status}`;
  }

  /**
   * Every earlier order's attempt that isn't final is resolved by its OWN transaction (the
   * writer reads its hash and rebroadcasts only the same bytes while valid). Its answer is
   * journaled; the contract's outcome ring decides the handover.
   */
  private async resolveAttempts(h: HandoverRow, account: string, gen: number) {
    const key = this.keys.get(h.business_id);
    if (!key) return;
    const orders = this.db
      .prepare("SELECT n, order_json FROM close_orders WHERE handover_id = ? ORDER BY n")
      .all(h.id) as { n: number; order_json: string }[];
    for (const o of orders) {
      const state = this.attemptState(h, o.n);
      if (state !== null && state !== "signed") {
        // Final by its own transaction (perhaps recorded by a step that had lost its lease): the
        // journal records it once, so the evidence is never shown as absent (Astra 01:41).
        const noted = this.db
          .prepare(
            "SELECT 1 FROM handover_journal WHERE handover_id = ? AND kind = 'attempt_final' AND code LIKE ?",
          )
          .get(h.id, `${o.n}:%`);
        if (!noted)
          try {
            this.tx(() => {
              this.requireLease(h.business_id, gen);
              journal(this.db, h, "attempt_final", `${o.n}:${state}`, {
                caps: this.caps,
                now: this.now(),
              });
            });
          } catch (e) {
            if (!(e instanceof LeaseLost)) throw e;
          }
        continue;
      }
      if (state !== "signed") continue;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.opts.opDeadlineMs);
      try {
        const a = await key.writer.closeSale({
          operation: this.op(h, o.n),
          account,
          order: JSON.parse(o.order_json) as Record<string, unknown>,
          signal: ctl.signal,
        });
        if (a.status !== "unknown")
          this.tx(() => {
            this.requireLease(h.business_id, gen);
            journal(
              this.db,
              h,
              "attempt_final",
              `${o.n}:${a.status === "refused" ? a.code : a.status}`,
              {
                caps: this.caps,
                now: this.now(),
              },
            );
          });
      } catch {
        // an unanswered status read is unknown, or this step lost its lease: either way the
        // attempt stays as recorded and is resolved by its own hash later
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

function hashText(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
