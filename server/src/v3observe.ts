// Job 003h: durable, ordered observations of business-v3 contracts, and an owner-only read of
// them (docs/design/V3_OBSERVATIONS.md). Bindings come only from operator configuration. An
// observation never changes who owns a business in this app, grants access, or claims a sale
// completed beyond what the contract's own outcome ring showed.

import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import {
  type BlockRef,
  isAccountId,
  type OutcomeV3,
  type PeriodV3,
  readSnapshot,
  transitionProblem,
  type V3Binding,
  V3ReadError,
  type V3Snapshot,
  type ViewTransport,
} from "./v3read.ts";

/** Months of period evidence kept per business: the contract's own PERIOD_RING. */
export const PERIOD_MONTHS = 24;

/** The four views every refresh reads at one block, without any optional period. */
export type CoreSnapshot = Omit<V3Snapshot, "period">;

export type PeriodOutcome = "accepted" | "duplicate" | "stale" | "conflict" | "not_recorded";

export interface RecordResult {
  outcome: RecordOutcome;
  period: { yyyymm: number; outcome: PeriodOutcome } | null;
}

const NETWORK = /^[a-z][a-z0-9-]{0,31}$/;

/** Trusted setup must be sound; a bad option fails at construction, not at the first read. */
function validateOptions(o: V3Options) {
  const bad = (m: string): never => {
    throw new Error(`v3 options: ${m}`);
  };
  const r = o.retention ?? 50;
  if (!Number.isInteger(r) || r < 1 || r > 10_000)
    bad("retention must be a whole number from 1 to 10000");
  for (const [k, v] of [
    ["staleAfterMs", o.staleAfterMs],
    ["timeoutMs", o.timeoutMs],
  ] as const)
    if (v !== undefined && (!Number.isSafeInteger(v) || v < 1))
      bad(`${k} must be a positive whole number`);
  const seen = new Set<string>();
  for (const b of o.bindings) {
    if (typeof b.business_id !== "string" || !b.business_id) bad("a binding has no business");
    if (typeof b.network !== "string" || !NETWORK.test(b.network))
      bad("a binding has an invalid network");
    if (typeof b.account !== "string" || !isAccountId(b.account))
      bad("a binding has an invalid account");
    if (seen.has(b.business_id)) bad("two bindings name one business");
    seen.add(b.business_id);
  }
}

export interface V3Options {
  /** The read-only transport; null means v3 reads are unavailable here (the default). */
  transport: ViewTransport | null;
  /** Operator-supplied bindings; nothing else can create one. */
  bindings: V3Binding[];
  /** Observations kept per business (the projection and high-water mark are never pruned). */
  retention?: number;
  /** An observation older than this is shown as stale. */
  staleAfterMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

export type RecordOutcome =
  | "accepted"
  | "duplicate"
  | "stale"
  | "conflict"
  | "contradictory"
  | "source_changed";

const MESSAGES: Record<string, string> = {
  accepted: "Recorded.",
  duplicate: "Already recorded at this block.",
  stale: "An older block than what is already recorded; nothing changed.",
  conflict:
    "Two different answers for the same block or height. Nothing was applied; this needs checking.",
  contradictory:
    "A newer block whose control state can't follow what was recorded (for example an older control sequence, or an owner change without a control step). Nothing was applied; this needs checking.",
  source_changed:
    "The configured contract differs from the one already recorded. Nothing was applied.",
  unavailable: "Reading NEAR isn't available here.",
  timeout: "The NEAR read took too long.",
  mixed_blocks: "The answers came from different blocks.",
  malformed: "The contract's answer wasn't in the expected form.",
  unknown_enum: "The contract's answer had a value this version doesn't know.",
  out_of_range: "The contract's answer had a value out of range.",
  // Job 003i: what an RPC endpoint can report, in fixed words (never its own text).
  unsupported: "That read isn't supported by the configured transport.",
  block_unavailable: "The endpoint no longer has that block (an archival endpoint would).",
  unknown_account: "The endpoint doesn't know the configured contract account.",
  execution_failed: "The contract's view call failed at that block.",
  rpc_error: "The endpoint refused the request.",
  too_large: "The endpoint's answer was larger than allowed.",
  format_upgrade_failed:
    "Earlier observations couldn't be upgraded to the current format, so this capability is paused; nothing was changed.",
};

interface ProjectionRow {
  business_id: string;
  network: string;
  account: string;
  schema: string;
  observation_id: number;
  high_block_height: string;
  high_block_hash: string;
  high_control_seq: string;
  flag: string | null;
  flag_detail: string | null;
  updated_at: string;
}

const now = () => new Date().toISOString();

/**
 * The core snapshot's digest (decoded values only; never raw transport text). A period read
 * alongside it never changes it (§4a).
 */
export const coreDigest = (s: V3Snapshot | CoreSnapshot) => {
  const { period: _ignored, ...core } = s as V3Snapshot;
  return createHash("sha256").update(JSON.stringify(core)).digest("hex");
};

/** The stored observation format: 2 = core-only snapshots and digests, months in v3_periods. */
export const OBSERVATION_FORMAT = "2";

const MONTH_OK = (m: unknown) =>
  typeof m === "number" &&
  Number.isInteger(m) &&
  m >= 197_001 &&
  m <= 999_912 &&
  m % 100 >= 1 &&
  m % 100 <= 12;

/**
 * Job 003i: upgrades observations written by 003h, whose snapshots and digests included the
 * optional month, to format 2. Every row is validated first; only then, in one transaction,
 * snapshots are rewritten core-only with recomputed core digests, and each month moves to
 * v3_periods with its original block and observation time (the newest per month wins, at most
 * PERIOD_MONTHS months). Sources, high-water marks, outcomes, projections and flags are left as
 * they are; a genuine conflict flag is never cleared. Safe to run again: once the format is
 * recorded it does nothing, and recomputing an already-core row changes nothing.
 */
export function upgradeObservationFormat(db: Db): { upgraded: number; months: number } {
  const done = db.prepare("SELECT value FROM v3_meta WHERE key = 'observation_format'").get() as
    | { value: string }
    | undefined;
  if (done?.value === OBSERVATION_FORMAT) return { upgraded: 0, months: 0 };
  const rows = db.prepare("SELECT * FROM v3_observations ORDER BY id").all() as {
    id: number;
    business_id: string;
    network: string;
    account: string;
    schema: string;
    block_height: string;
    block_hash: string;
    control_seq: string;
    snapshot: string;
    digest: string;
    observed_at: string;
  }[];
  // 1. Validate everything; nothing is written if any row is malformed.
  const plan = rows.map((r) => {
    const bad = (what: string): never => {
      throw new Error(
        `v3 format upgrade: observation ${r.id} is malformed (${what}); nothing was changed`,
      );
    };
    let s: Record<string, unknown>;
    try {
      s = JSON.parse(r.snapshot) as Record<string, unknown>;
    } catch {
      return bad("not JSON");
    }
    if (!s || typeof s !== "object" || Array.isArray(s)) bad("not an object");
    const src = s.source as Record<string, unknown> | undefined;
    if (!src || src.network !== r.network || src.account !== r.account || src.schema !== r.schema)
      bad("source differs from its row");
    const block = s.block as Record<string, unknown> | undefined;
    if (!block || block.height !== r.block_height || block.hash !== r.block_hash)
      bad("block differs from its row");
    const control = s.control as Record<string, unknown> | undefined;
    if (!control || typeof control !== "object" || control.control_seq !== r.control_seq)
      bad("control differs from its row");
    if (
      !Array.isArray(s.outcomes) ||
      !Array.isArray(s.pending) ||
      !s.treasury ||
      typeof s.treasury !== "object"
    )
      bad("a core view is missing");
    const period = s.period;
    if (period !== undefined && period !== null) {
      const p = period as Record<string, unknown>;
      if (typeof p !== "object" || !MONTH_OK(p.yyyymm) || typeof p.status !== "string")
        bad("its month is malformed");
    }
    const { period: _p, ...core } = s;
    return { row: r, core, period: (period ?? null) as PeriodV3 | null };
  });
  // 2. Rewrite, in one transaction.
  let months = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { row, core, period } of plan) {
      const digest = coreDigest(core as unknown as CoreSnapshot);
      db.prepare("UPDATE v3_observations SET snapshot = ?, digest = ? WHERE id = ?").run(
        JSON.stringify(core),
        digest,
        row.id,
      );
      if (!period) continue;
      const have = db
        .prepare("SELECT block_height FROM v3_periods WHERE business_id = ? AND yyyymm = ?")
        .get(row.business_id, period.yyyymm) as { block_height: string } | undefined;
      if (have && BigInt(have.block_height) >= BigInt(row.block_height)) continue;
      db.prepare(
        `INSERT INTO v3_periods (business_id, yyyymm, block_height, block_hash, period, digest, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(business_id, yyyymm) DO UPDATE SET block_height = excluded.block_height,
           block_hash = excluded.block_hash, period = excluded.period, digest = excluded.digest,
           observed_at = excluded.observed_at`,
      ).run(
        row.business_id,
        period.yyyymm,
        row.block_height,
        row.block_hash,
        JSON.stringify(period),
        createHash("sha256").update(JSON.stringify(period)).digest("hex"),
        row.observed_at,
      );
      months++;
    }
    // The same bound as live recording: at most PERIOD_MONTHS months, oldest evidence dropped.
    const businesses = db.prepare("SELECT DISTINCT business_id FROM v3_periods").all() as {
      business_id: string;
    }[];
    for (const { business_id } of businesses)
      db.prepare(
        `DELETE FROM v3_periods WHERE business_id = ? AND yyyymm NOT IN (
           SELECT yyyymm FROM v3_periods WHERE business_id = ?
           ORDER BY length(block_height) DESC, block_height DESC, observed_at DESC LIMIT ?)`,
      ).run(business_id, business_id, PERIOD_MONTHS);
    db.prepare(
      "INSERT INTO v3_meta (key, value) VALUES ('observation_format', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(OBSERVATION_FORMAT);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { upgraded: plan.length, months };
}

export class V3Observations {
  private readonly bindings: Map<string, V3Binding>;
  /** Set when stored observations couldn't be upgraded: the capability pauses, the app runs. */
  readonly upgradeError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly opts: V3Options = { transport: null, bindings: [] },
  ) {
    validateOptions(opts);
    this.bindings = new Map(opts.bindings.map((b) => [b.business_id, b]));
    try {
      upgradeObservationFormat(db);
    } catch (e) {
      this.upgradeError = (e as Error).message;
    }
  }

  private clock() {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private event(type: string, subject: string, actor: string | null, payload: object) {
    this.db
      .prepare("INSERT INTO events (type, subject, actor, payload, at) VALUES (?, ?, ?, ?, ?)")
      .run(type, subject, actor, JSON.stringify(payload), now());
  }

  private projection(businessId: string): ProjectionRow | undefined {
    return this.db
      .prepare("SELECT * FROM v3_projection WHERE business_id = ?")
      .get(businessId) as unknown as ProjectionRow | undefined;
  }

  // ---------- read-only accessors for the v3 reconciler (job 003k) ----------
  // None of these lets a caller write an observation: fresh evidence goes through readFresh and
  // then the normal ordering rules in `record`.

  /** The operator-configured binding, if any. */
  bindingFor(businessId: string): V3Binding | undefined {
    return this.bindings.get(businessId);
  }

  /** The recorded projection and its (core) snapshot, or null if nothing has been observed. */
  latest(businessId: string): {
    snapshot: CoreSnapshot;
    flag: string | null;
    source: { network: string; account: string; schema: string };
  } | null {
    const proj = this.projection(businessId);
    if (!proj) return null;
    const row = this.db
      .prepare("SELECT snapshot FROM v3_observations WHERE id = ?")
      .get(proj.observation_id) as { snapshot: string } | undefined;
    if (!row) return null;
    return {
      snapshot: JSON.parse(row.snapshot) as CoreSnapshot,
      flag: proj.flag,
      source: { network: proj.network, account: proj.account, schema: proj.schema },
    };
  }

  /** One coherent snapshot through the trusted transport; null when no transport is set. */
  async readFresh(binding: V3Binding): Promise<V3Snapshot | null> {
    if (this.upgradeError || !this.opts.transport) return null;
    return readSnapshot(this.opts.transport, binding, { timeoutMs: this.opts.timeoutMs });
  }

  /** The immutable copy of a deal's outcome, if it was ever observed. */
  storedOutcome(businessId: string, seq: string): OutcomeV3 | null {
    const r = this.db
      .prepare("SELECT outcome FROM v3_outcomes WHERE business_id = ? AND seq = ?")
      .get(businessId, seq) as { outcome: string } | undefined;
    return r ? (JSON.parse(r.outcome) as OutcomeV3) : null;
  }

  /** Whether `seq` ended unobserved (a history gap): it can't be judged, only reported. */
  inHistoryGap(businessId: string, seq: string, s: CoreSnapshot): boolean {
    if (this.storedOutcome(businessId, seq) || s.control.live_deal?.seq === seq) return false;
    // At or below the highest deal number seen, with no outcome and not live: it ended unseen.
    const highest = s.control.live_deal ? BigInt(s.control.live_deal.seq) : 0n;
    const max = (
      this.db.prepare("SELECT seq FROM v3_outcomes WHERE business_id = ?").all(businessId) as {
        seq: string;
      }[]
    ).reduce((m, r) => (BigInt(r.seq) > m ? BigInt(r.seq) : m), highest);
    return BigInt(seq) <= max;
  }

  private flag(businessId: string, code: RecordOutcome, detail: string) {
    this.db
      .prepare(
        "UPDATE v3_projection SET flag = ?, flag_detail = ?, updated_at = ? WHERE business_id = ?",
      )
      .run(code, detail, now(), businessId);
  }

  /**
   * Records one snapshot for a business, in the caller's transaction: its core first, then (only
   * if that core block wasn't refused) the month it covered. See the note's §4 and §4a.
   */
  record(businessId: string, s: V3Snapshot, observedAtMs = this.clock()): RecordResult {
    const { period, ...core } = s;
    const outcome = this.recordCore(businessId, core, observedAtMs);
    if (!period) return { outcome, period: null };
    const usable = outcome === "accepted" || outcome === "duplicate" || outcome === "stale";
    return {
      outcome,
      period: {
        yyyymm: period.yyyymm,
        outcome: usable
          ? this.recordPeriod(businessId, s.block, period, observedAtMs)
          : "not_recorded",
      },
    };
  }

  /**
   * The core snapshot. Exact duplicates are idempotent; stale, conflicting, contradictory or
   * differently-sourced snapshots change no observation or projection data (conflicts and
   * contradictions flag the projection).
   */
  private recordCore(businessId: string, s: CoreSnapshot, observedAtMs: number): RecordOutcome {
    const digest = coreDigest(s);
    const proj = this.projection(businessId);
    if (
      proj &&
      (proj.network !== s.source.network ||
        proj.account !== s.source.account ||
        proj.schema !== s.source.schema)
    )
      return "source_changed";
    const same = this.db
      .prepare("SELECT digest FROM v3_observations WHERE business_id = ? AND block_hash = ?")
      .get(businessId, s.block.hash) as { digest: string } | undefined;
    if (same) {
      if (same.digest === digest) return "duplicate";
      this.flag(businessId, "conflict", `block ${s.block.height}`);
      return "conflict";
    }
    if (proj) {
      const h = BigInt(s.block.height);
      const hw = BigInt(proj.high_block_height);
      if (h === hw) {
        this.flag(businessId, "conflict", `height ${s.block.height}`);
        return "conflict";
      }
      if (h < hw) {
        // A retained observation at this height has another hash (same hash was handled above).
        const other = this.db
          .prepare("SELECT 1 FROM v3_observations WHERE business_id = ? AND block_height = ?")
          .get(businessId, s.block.height);
        if (other) {
          this.flag(businessId, "conflict", `height ${s.block.height}`);
          return "conflict";
        }
        return "stale";
      }
      const high = this.db
        .prepare("SELECT snapshot FROM v3_observations WHERE id = ?")
        .get(proj.observation_id) as { snapshot: string };
      const problem = transitionProblem(JSON.parse(high.snapshot) as CoreSnapshot, s);
      if (problem) {
        this.flag(businessId, "contradictory", `block ${s.block.height}: ${problem}`);
        return "contradictory";
      }
    }
    // An outcome, once seen, never changes: a different one for the same deal is a conflict.
    for (const o of s.outcomes) {
      const seen = this.db
        .prepare("SELECT outcome FROM v3_outcomes WHERE business_id = ? AND seq = ?")
        .get(businessId, o.seq) as { outcome: string } | undefined;
      if (seen && seen.outcome !== JSON.stringify(o)) {
        if (proj) this.flag(businessId, "conflict", `outcome ${o.seq}`);
        return "conflict";
      }
    }
    const at = new Date(observedAtMs).toISOString();
    const id = Number(
      this.db
        .prepare(
          "INSERT INTO v3_observations (business_id, network, account, schema, block_height, block_hash, control_seq, generation, owner, snapshot, digest, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          businessId,
          s.source.network,
          s.source.account,
          s.source.schema,
          s.block.height,
          s.block.hash,
          s.control.control_seq,
          s.control.generation,
          s.control.owner,
          JSON.stringify(s),
          digest,
          at,
        ).lastInsertRowid,
    );
    for (const o of s.outcomes)
      this.db
        .prepare(
          "INSERT OR IGNORE INTO v3_outcomes (business_id, seq, status, outcome, first_block_height) VALUES (?, ?, ?, ?, ?)",
        )
        .run(businessId, o.seq, o.status, JSON.stringify(o), s.block.height);
    this.db
      .prepare(
        `INSERT INTO v3_projection (business_id, network, account, schema, observation_id, high_block_height, high_block_hash, high_control_seq, flag, flag_detail, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
         ON CONFLICT(business_id) DO UPDATE SET observation_id = excluded.observation_id, high_block_height = excluded.high_block_height,
           high_block_hash = excluded.high_block_hash, high_control_seq = excluded.high_control_seq, updated_at = excluded.updated_at`,
      )
      .run(
        businessId,
        s.source.network,
        s.source.account,
        s.source.schema,
        id,
        s.block.height,
        s.block.hash,
        s.control.control_seq,
        at,
      );
    // Bounded retention; the projection, high-water mark and outcomes are kept.
    const keep = this.opts.retention ?? 50;
    this.db
      .prepare(
        "DELETE FROM v3_observations WHERE business_id = ? AND id NOT IN (SELECT id FROM v3_observations WHERE business_id = ? ORDER BY id DESC LIMIT ?)",
      )
      .run(businessId, businessId, keep);
    return "accepted";
  }

  /**
   * One month's evidence, kept as the newest per month with its own block (§4a). The same method,
   * arguments and block answering differently is a conflict; an older block is stale for the
   * month; a read without a month never reaches here, so nothing is erased by not asking.
   */
  private recordPeriod(
    businessId: string,
    block: BlockRef,
    p: PeriodV3,
    observedAtMs: number,
  ): PeriodOutcome {
    const digest = createHash("sha256").update(JSON.stringify(p)).digest("hex");
    const row = this.db
      .prepare(
        "SELECT block_height, block_hash, digest FROM v3_periods WHERE business_id = ? AND yyyymm = ?",
      )
      .get(businessId, p.yyyymm) as
      | { block_height: string; block_hash: string; digest: string }
      | undefined;
    if (row) {
      if (row.block_hash === block.hash) {
        if (row.digest === digest) return "duplicate";
        this.flag(businessId, "conflict", `period ${p.yyyymm} at block ${block.height}`);
        return "conflict";
      }
      const h = BigInt(block.height);
      const r = BigInt(row.block_height);
      if (h === r) {
        this.flag(businessId, "conflict", `period ${p.yyyymm} at height ${block.height}`);
        return "conflict";
      }
      if (h < r) return "stale";
    }
    this.db
      .prepare(
        `INSERT INTO v3_periods (business_id, yyyymm, block_height, block_hash, period, digest, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(business_id, yyyymm) DO UPDATE SET block_height = excluded.block_height,
           block_hash = excluded.block_hash, period = excluded.period, digest = excluded.digest,
           observed_at = excluded.observed_at`,
      )
      .run(
        businessId,
        p.yyyymm,
        block.height,
        block.hash,
        JSON.stringify(p),
        digest,
        new Date(observedAtMs).toISOString(),
      );
    // At most PERIOD_MONTHS months: drop the month with the oldest evidence (never this one).
    const months = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM v3_periods WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
    if (months > PERIOD_MONTHS)
      this.db
        .prepare(
          `DELETE FROM v3_periods WHERE business_id = ? AND yyyymm = (
             SELECT yyyymm FROM v3_periods WHERE business_id = ? AND yyyymm != ?
             ORDER BY length(block_height), block_height, observed_at LIMIT 1)`,
        )
        .run(businessId, businessId, p.yyyymm);
    return "accepted";
  }

  /** The owner's view of what has been observed. */
  view(viewer: Person, businessId: string) {
    const business = this.store.ownedBusiness(viewer, businessId);
    // Job 003j: every state names the control epoch it was read under, so a page can drop what
    // it shows when the business changes hands (or comes back), and fence late answers.
    const owner_epoch = `${business.owner_id}:${this.store.controlEpoch(viewer, businessId).generation}`;
    const binding = this.bindings.get(businessId);
    if (!binding)
      return {
        state: "unbound" as const,
        owner_epoch,
        message:
          "This business isn't connected to a v3 contract here; its existing records are unchanged.",
      };
    if (this.upgradeError)
      return {
        state: "paused" as const,
        owner_epoch,
        code: "format_upgrade_failed",
        message: MESSAGES.format_upgrade_failed,
      };
    const proj = this.projection(businessId);
    const transport = this.opts.transport ? "configured" : "unavailable";
    if (!proj)
      return {
        state: "never_observed" as const,
        owner_epoch,
        binding: this.bindingView(binding),
        transport,
      };
    const row = this.db
      .prepare("SELECT snapshot, observed_at FROM v3_observations WHERE id = ?")
      .get(proj.observation_id) as { snapshot: string; observed_at: string };
    const s = JSON.parse(row.snapshot) as V3Snapshot;
    const age = this.clock() - Date.parse(row.observed_at);
    const staleAfter = this.opts.staleAfterMs ?? 600_000;
    const mapped = this.db
      .prepare("SELECT owner_id FROM chain_accounts WHERE owner_kind = 'person' AND account_id = ?")
      .get(s.control.owner) as { owner_id: string } | undefined;
    const bindingMatches = binding.network === proj.network && binding.account === proj.account;
    return {
      state: "observed" as const,
      owner_epoch,
      /** When this answer was made, by the server's clock, and the age past which it is stale. */
      served_at: new Date(this.clock()).toISOString(),
      stale_after_ms: staleAfter,
      binding: this.bindingView(binding),
      binding_matches_record: bindingMatches,
      transport,
      source: { network: proj.network, account: proj.account, schema: proj.schema },
      block: s.block,
      finality: s.finality,
      provenance: "Reported by the configured read transport; not independently verified.",
      network_identity:
        "The network is named by operator configuration; which chain the endpoint serves isn't verified.",
      observed_at: row.observed_at,
      age_ms: age,
      freshness: age > staleAfter ? ("stale" as const) : ("fresh" as const),
      high_water: { block_height: proj.high_block_height, control_seq: proj.high_control_seq },
      flag: proj.flag
        ? { code: proj.flag, detail: proj.flag_detail, message: MESSAGES[proj.flag] }
        : null,
      control: {
        ...s.control,
        manifest_note:
          "A hash pointer to a service manifest; not evidence that any code or artifact is available.",
        closer_note:
          s.control.close_mode === "gated"
            ? "The account allowed to finalize a sale; not a verified handover."
            : "Direct: a sale closes on the second matching acceptance.",
      },
      owner_match: !mapped
        ? ("unknown_mapping" as const)
        : mapped.owner_id === business.owner_id
          ? ("matches" as const)
          : ("mismatch" as const),
      owner_note:
        "An observation never changes who controls this business in the app; a mismatch needs reconciliation.",
      treasury: s.treasury,
      claims_note: "Claims are owed; only the period counters show what was actually paid.",
      pending: s.pending,
      periods: this.periods(businessId, s.block, staleAfter),
      periods_note:
        "Each month shows the block it was read at. A month never read here is absent, not zero.",
      outcomes: this.outcomes(businessId),
      history: this.history(businessId, s),
    };
  }

  /** Period evidence, newest month first, each with its own block and observation time. */
  private periods(businessId: string, core: BlockRef, staleAfter: number) {
    const rows = this.db
      .prepare(
        "SELECT yyyymm, block_height, block_hash, period, observed_at FROM v3_periods WHERE business_id = ? ORDER BY yyyymm DESC",
      )
      .all(businessId) as {
      yyyymm: number;
      block_height: string;
      block_hash: string;
      period: string;
      observed_at: string;
    }[];
    return rows.map((r) => {
      const age = this.clock() - Date.parse(r.observed_at);
      return {
        ...(JSON.parse(r.period) as PeriodV3),
        block: { height: r.block_height, hash: r.block_hash },
        at_core_block: r.block_hash === core.hash,
        observed_at: r.observed_at,
        age_ms: age,
        freshness: age > staleAfter ? ("stale" as const) : ("fresh" as const),
      };
    });
  }

  private bindingView(b: V3Binding) {
    return { network: b.network, account: b.account };
  }

  private outcomes(businessId: string) {
    return (
      this.db
        .prepare("SELECT outcome, first_block_height FROM v3_outcomes WHERE business_id = ?")
        .all(businessId) as { outcome: string; first_block_height: string }[]
    )
      .map((r) => ({ ...JSON.parse(r.outcome), observed_from_block: r.first_block_height }))
      .sort((a, b) => (BigInt(b.seq) > BigInt(a.seq) ? 1 : BigInt(b.seq) < BigInt(a.seq) ? -1 : 0));
  }

  /**
   * Deals numbered 1..highest seen that were never observed ended and aren't live are gaps: the
   * contract keeps only its last 8 outcomes, so they ended unseen. Nothing is inferred about them.
   */
  private history(businessId: string, s: V3Snapshot) {
    const seen = new Set(
      (
        this.db.prepare("SELECT seq FROM v3_outcomes WHERE business_id = ?").all(businessId) as {
          seq: string;
        }[]
      ).map((r) => r.seq),
    );
    const live = s.control.live_deal?.seq ?? null;
    let highest = 0n;
    for (const q of seen) if (BigInt(q) > highest) highest = BigInt(q);
    if (live !== null && BigInt(live) > highest) highest = BigInt(live);
    const known = BigInt(seen.size) + (live !== null && !seen.has(live) ? 1n : 0n);
    const missing = highest - known;
    const first: string[] = [];
    for (let q = 1n; q <= highest && first.length < 8 && missing > 0n; q++) {
      const k = q.toString();
      if (!seen.has(k) && k !== live) first.push(k);
    }
    return {
      complete: missing === 0n,
      missing_count: missing.toString(),
      first_missing: first,
      note:
        missing === 0n
          ? "Every deal up to the latest was observed."
          : "Some deals ended without being observed here (the contract keeps only its last 8 outcomes). Nothing is assumed about how they ended.",
    };
  }

  /** Takes a snapshot through the transport and records it; owner only, fenced on control. */
  async refresh(viewer: Person, businessId: string, input: { period?: unknown } = {}) {
    const epoch = this.store.controlEpoch(viewer, businessId);
    const binding = this.bindings.get(businessId);
    if (!binding) throw new HttpError(409, "This business isn't connected to a v3 contract here");
    let period: number | undefined;
    if (input.period !== undefined && input.period !== null) {
      const p = Number(input.period);
      if (!Number.isInteger(p) || p < 197_001 || p > 999_912 || p % 100 < 1 || p % 100 > 12)
        throw new HttpError(400, "The period is a month written yyyymm");
      period = p;
    }
    if (this.upgradeError)
      return {
        outcome: "refused" as const,
        code: "format_upgrade_failed",
        message: MESSAGES.format_upgrade_failed,
      };
    const transport = this.opts.transport;
    if (!transport)
      return { outcome: "refused" as const, code: "unavailable", message: MESSAGES.unavailable };
    let snapshot: V3Snapshot;
    try {
      snapshot = await readSnapshot(transport, binding, { period, timeoutMs: this.opts.timeoutMs });
    } catch (e) {
      this.store.stillControls(viewer, epoch);
      const code = e instanceof V3ReadError ? e.code : "unavailable";
      this.event("v3.read_refused", businessId, viewer.id, { code });
      return { outcome: "refused" as const, code, message: MESSAGES[code] ?? MESSAGES.unavailable };
    }
    // Control may have changed while reading.
    this.store.stillControls(viewer, epoch);
    const r = this.store.tx(() => {
      this.store.stillControls(viewer, epoch);
      const result = this.record(businessId, snapshot);
      this.event("v3.observed", businessId, viewer.id, {
        outcome: result.outcome,
        block_height: snapshot.block.height,
        digest: coreDigest(snapshot),
        period: result.period,
      });
      return result;
    });
    return {
      outcome: r.outcome,
      message: MESSAGES[r.outcome],
      period: r.period,
      view: this.view(viewer, businessId),
    };
  }
}
