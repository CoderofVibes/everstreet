// Job 003h: durable, ordered observations of business-v3 contracts, and an owner-only read of
// them (docs/design/V3_OBSERVATIONS.md). Bindings come only from operator configuration. An
// observation never changes who owns a business in this app, grants access, or claims a sale
// completed beyond what the contract's own outcome ring showed.

import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import {
  readSnapshot,
  type V3Binding,
  V3ReadError,
  type V3Snapshot,
  type ViewTransport,
} from "./v3read.ts";

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
    "A newer block with an older control sequence. Nothing was applied; this needs checking.",
  source_changed:
    "The configured contract differs from the one already recorded. Nothing was applied.",
  unavailable: "Reading NEAR isn't available here.",
  timeout: "The NEAR read took too long.",
  mixed_blocks: "The answers came from different blocks.",
  malformed: "The contract's answer wasn't in the expected form.",
  unknown_enum: "The contract's answer had a value this version doesn't know.",
  out_of_range: "The contract's answer had a value out of range.",
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

/** The stored, normalized snapshot's digest (decoded values only; never raw transport text). */
export const snapshotDigest = (s: V3Snapshot) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");

export class V3Observations {
  private readonly bindings: Map<string, V3Binding>;

  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly opts: V3Options = { transport: null, bindings: [] },
  ) {
    this.bindings = new Map(opts.bindings.map((b) => [b.business_id, b]));
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

  private flag(businessId: string, code: RecordOutcome, detail: string) {
    this.db
      .prepare(
        "UPDATE v3_projection SET flag = ?, flag_detail = ?, updated_at = ? WHERE business_id = ?",
      )
      .run(code, detail, now(), businessId);
  }

  /**
   * Records one snapshot for a business, in the caller's transaction. Exact duplicates are
   * idempotent; stale, conflicting, contradictory or differently-sourced snapshots change no
   * observation or projection data (conflicts and contradictions flag the projection).
   */
  record(businessId: string, s: V3Snapshot, observedAtMs = this.clock()): RecordOutcome {
    const digest = snapshotDigest(s);
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
      if (h < hw) return "stale";
      if (BigInt(s.control.control_seq) < BigInt(proj.high_control_seq)) {
        this.flag(businessId, "contradictory", `block ${s.block.height}`);
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

  /** The owner's view of what has been observed. */
  view(viewer: Person, businessId: string) {
    const business = this.store.ownedBusiness(viewer, businessId);
    const binding = this.bindings.get(businessId);
    if (!binding)
      return {
        state: "unbound" as const,
        message:
          "This business isn't connected to a v3 contract here; its existing records are unchanged.",
      };
    const proj = this.projection(businessId);
    const transport = this.opts.transport ? "configured" : "unavailable";
    if (!proj)
      return { state: "never_observed" as const, binding: this.bindingView(binding), transport };
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
      binding: this.bindingView(binding),
      binding_matches_record: bindingMatches,
      transport,
      source: { network: proj.network, account: proj.account, schema: proj.schema },
      block: s.block,
      finality: s.finality,
      provenance: "Reported by the configured read transport; not independently verified.",
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
      period: s.period,
      outcomes: this.outcomes(businessId),
      history: this.history(businessId, s),
    };
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
    const outcome = this.store.tx(() => {
      this.store.stillControls(viewer, epoch);
      const r = this.record(businessId, snapshot);
      this.event("v3.observed", businessId, viewer.id, {
        outcome: r,
        block_height: snapshot.block.height,
        digest: snapshotDigest(snapshot),
      });
      return r;
    });
    return { outcome, message: MESSAGES[outcome], view: this.view(viewer, businessId) };
  }
}
