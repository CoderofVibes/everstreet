// Job 003wf3 (docs/design/MANAGED_HANDOVER.md): the keyless half of a managed (Gated) handover.
//
// A business whose contract shows its deal Closing gets ONE open `business_handovers` row, created
// from a pinned contract read by whichever path sees it first (customer prepare/execute, the sale
// setup read, observation recording, the coordinator). While that row is open, every admission
// of new work for that business is refused inside its own write transaction (the services call
// `requireNoHandover`/`pauseError` there; db.ts triggers are the backstop at commit). The row
// opens again only on contract evidence, decided by the coordinator (handoverCoordinator.ts).
// Nothing here signs, sends or reads the chain.

import { randomUUID } from "node:crypto";
import { type Db, HANDOVER_OPEN_STATES, type HandoverState } from "./db.ts";
import { HttpError } from "./store.ts";
import type { BlockRef, ControlV3, OutcomeV3 } from "./v3read.ts";

export interface HandoverRow {
  id: string;
  business_id: string;
  network: string;
  account: string;
  deal_seq: string;
  version: number;
  digest: string;
  expected_generation: number;
  closing_control_seq: string;
  closing_started_ms: string;
  deadline_ms: string;
  manifest: string;
  manifest_seq: string;
  price: string;
  available_floor: string;
  grants: string;
  closer: string | null;
  seller_account: string;
  buyer_account: string;
  seller_person_id: string | null;
  buyer_person_id: string | null;
  intent_id: string | null;
  local_epoch: number | null;
  armed_block: string;
  armed_source: string;
  evidence_height: string;
  state: HandoverState;
  attention_reason: string | null;
  outcome: string | null;
  check_ms: number | null;
  check_reason: string | null;
  check_counts: string | null;
  check_repeat: number;
  journal_full: number;
  rev: number;
  created_ms: number;
  updated_ms: number;
}

const OPEN_SQL = HANDOVER_OPEN_STATES.map((s) => `'${s}'`).join(",");

/** This business's open handover (its gate is closed), or null. */
export function openHandover(db: Db, businessId: string): HandoverRow | null {
  return (
    (db
      .prepare(`SELECT * FROM business_handovers WHERE business_id = ? AND state IN (${OPEN_SQL})`)
      .get(businessId) as unknown as HandoverRow | undefined) ?? null
  );
}

/** The newest handover of a business, open or finished (for the sale page's history). */
export function latestHandover(db: Db, businessId: string): HandoverRow | null {
  return (
    (db
      .prepare(
        "SELECT * FROM business_handovers WHERE business_id = ? ORDER BY created_ms DESC, rowid DESC LIMIT 1",
      )
      .get(businessId) as unknown as HandoverRow | undefined) ?? null
  );
}

// ---------- the refusals people see (§4.3, §16.11 D6) ----------

/** What the caller's own request shows about its unit; never a claim the state doesn't prove. */
export type PauseUnit = "none" | "returning" | "returned" | "unknown";

const PAUSE: Record<PauseUnit, string> = {
  none: "New uses are paused while this business changes hands. Nothing was signed, held or charged.",
  returning:
    "This business is changing hands, so your reserved use can't run now. Its unit is being returned; you weren't charged.",
  returned:
    "This business is changing hands, so your reserved use can't run now. Its unit was returned; you weren't charged.",
  unknown:
    "This business is changing hands, so your reserved use can't run now. We're confirming what happened to its unit; you'll see it here.",
};

export function pauseMessage(unit: PauseUnit) {
  return PAUSE[unit];
}

/** A customer admission refused while the business is changing hands. */
export function pauseError(unit: PauseUnit, h: Pick<HandoverRow, "deal_seq">) {
  return new HttpError(409, PAUSE[unit], "handover_pause", {
    unit,
    deal_seq: h.deal_seq,
    retry_after_ms: 60_000,
  });
}

/** An owner change refused while the business is changing hands. */
export function inProgressError(h: Pick<HandoverRow, "deal_seq">) {
  return new HttpError(
    409,
    `This business is closing (deal ${h.deal_seq}); changes are paused until the contract decides.`,
    "handover_in_progress",
    { deal_seq: h.deal_seq },
  );
}

/** Refuses an owner change for a business with an open handover. Call it inside the write tx. */
export function requireNoHandover(db: Db, businessId: string) {
  const h = openHandover(db, businessId);
  if (h) throw inProgressError(h);
}

function inTx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

// ---------- the journal (§16.7 D2): bounded, with capacity reserved for what recovery needs ----------

export interface JournalCaps {
  /** Entries per handover, at most. */
  cap: number;
  /** The last slots, kept for MUST kinds only. */
  reserve: number;
}
export const DEFAULT_JOURNAL: JournalCaps = { cap: 256, reserve: 40 };
const MUST = new Set([
  "armed",
  "order_created",
  "attempt_recorded",
  "attempt_final",
  "outcome",
  "reconciled",
  "terminal",
  "attention",
  "ended_for_newer",
]);

/**
 * Appends one journal entry if the caps allow: an ordinary kind only below `cap − reserve` and
 * only when it differs from the previous ordinary entry; a MUST kind up to `cap`. A full journal
 * never stops a transition: it only sets `journal_full`. In the caller's transaction.
 */
export function journal(
  db: Db,
  h: Pick<HandoverRow, "id">,
  kind: string,
  code: string | null,
  o: { block?: BlockRef | null; leaseGen?: number | null; caps?: JournalCaps; now: number },
): boolean {
  const caps = o.caps ?? DEFAULT_JOURNAL;
  const n = (
    db.prepare("SELECT COUNT(*) AS n FROM handover_journal WHERE handover_id = ?").get(h.id) as {
      n: number;
    }
  ).n;
  const must = MUST.has(kind);
  if (!must) {
    if (n >= caps.cap - caps.reserve) return false;
    const last = db
      .prepare(
        `SELECT kind, code FROM handover_journal WHERE handover_id = ? AND kind NOT IN (${[...MUST].map(() => "?").join(",")}) ORDER BY seq DESC LIMIT 1`,
      )
      .get(h.id, ...MUST) as { kind: string; code: string | null } | undefined;
    if (last && last.kind === kind && last.code === code) return false;
  } else if (n >= caps.cap) {
    // Only an open row is updated (a finished one is immutable); its state stays authoritative.
    db.prepare(
      `UPDATE business_handovers SET journal_full = 1 WHERE id = ? AND state IN (${OPEN_SQL})`,
    ).run(h.id);
    return false;
  }
  db.prepare(
    "INSERT INTO handover_journal (handover_id, seq, kind, code, block, lease_gen, at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    h.id,
    n + 1,
    kind,
    code,
    o.block ? JSON.stringify({ height: o.block.height, hash: o.block.hash }) : null,
    o.leaseGen ?? null,
    o.now,
  );
  return true;
}

// ---------- arming (§16.3): keyless, from any pinned contract read ----------

export interface ArmInput {
  businessId: string;
  network: string;
  account: string;
  block: BlockRef;
  control: ControlV3;
  source: string;
  now: number;
  caps?: JournalCaps;
}

const personFor = (db: Db, account: string) =>
  (
    db
      .prepare("SELECT owner_id FROM chain_accounts WHERE owner_kind = 'person' AND account_id = ?")
      .get(account) as { owner_id: string } | undefined
  )?.owner_id ?? null;

/**
 * If this pinned read shows the business's Gated deal Closing, ensures its handover row exists
 * (one per exact deal and version; a finished one is never re-opened by a late read) and returns
 * the business's open handover, if any. In the caller's transaction, or its own.
 */
export function armHandover(db: Db, a: ArmInput): HandoverRow | null {
  return inTx(db, () => {
    const d = a.control.live_deal;
    const existing = openHandover(db, a.businessId);
    if (a.control.close_mode !== "gated" || d?.state !== "closing") return existing;
    if (existing) return existing; // the coordinator resolves another deal's row (D1)
    const intent = db
      .prepare(
        "SELECT id, local_epoch FROM v3_intents WHERE business_id = ? AND network = ? AND account = ? AND deal_seq = ? AND version = ? AND digest = ?",
      )
      .get(a.businessId, a.network, a.account, d.seq, d.version, d.digest) as
      | { id: string; local_epoch: number }
      | undefined;
    const id = randomUUID();
    const made = db
      .prepare(
        `INSERT INTO business_handovers (id, business_id, network, account, deal_seq, version, digest,
           expected_generation, closing_control_seq, closing_started_ms, deadline_ms, manifest, manifest_seq,
           price, available_floor, grants, closer, seller_account, buyer_account, seller_person_id,
           buyer_person_id, intent_id, local_epoch, armed_block, armed_source, evidence_height, state,
           created_ms, updated_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gated', ?, ?)
         ON CONFLICT (business_id, deal_seq, version) DO NOTHING`,
      )
      .run(
        id,
        a.businessId,
        a.network,
        a.account,
        d.seq,
        d.version,
        d.digest,
        d.expected_generation,
        d.closing_control_seq,
        d.closing_started_ms,
        d.deadline_ms,
        a.control.service_manifest,
        a.control.manifest_seq,
        d.price,
        d.available_floor,
        JSON.stringify(d.grants),
        a.control.closer,
        d.seller,
        d.buyer,
        personFor(db, d.seller),
        personFor(db, d.buyer),
        intent?.id ?? null,
        intent?.local_epoch ?? null,
        JSON.stringify({ height: a.block.height, hash: a.block.hash }),
        a.source,
        a.block.height,
        a.now,
        a.now,
      );
    if (made.changes === 1) {
      journal(db, { id }, "armed", a.source, { block: a.block, caps: a.caps, now: a.now });
      db.prepare(
        "INSERT INTO events (type, subject, actor, payload, at) VALUES ('handover.armed', ?, 'system:handover', ?, ?)",
      ).run(
        a.businessId,
        JSON.stringify({ handover: id, deal_seq: d.seq, version: d.version, source: a.source }),
        new Date(a.now).toISOString(),
      );
    }
    return openHandover(db, a.businessId);
  });
}

/**
 * A customer admission's check, inside its write transaction: refused while this business is
 * changing hands, with the request's own unit state (D6).
 */
export function requireCustomerAdmission(db: Db, businessId: string, unit: PauseUnit = "none") {
  const h = openHandover(db, businessId);
  if (h) throw pauseError(unit, h);
}

// ---------- resolution from contract evidence (§4.2, §16.6 D1): keyless, from accepted reads ----------

export interface Evidence {
  block: BlockRef;
  control: ControlV3;
  outcomes: OutcomeV3[];
}

function setState(
  db: Db,
  h: HandoverRow,
  state: HandoverState,
  extra: { outcome?: unknown; attention?: string | null; height?: string },
  now: number,
) {
  db.prepare(
    `UPDATE business_handovers SET state = ?, outcome = COALESCE(?, outcome), attention_reason = ?,
       evidence_height = COALESCE(?, evidence_height), rev = rev + 1, updated_ms = ? WHERE id = ? AND rev = ?`,
  ).run(
    state,
    extra.outcome === undefined ? null : JSON.stringify(extra.outcome),
    extra.attention ?? null,
    extra.height ?? null,
    now,
    h.id,
    h.rev,
  );
}

const TERMINAL: HandoverState[] = [
  "released_to_buyer",
  "released_to_seller",
  "released_current",
  "ended",
];

/** Whether the local authority is the buyer's, through exactly this handover's intent. */
/**
 * The generation local authority has applied: the newest ownership row's, or the contract's first
 * (1) when no sale was ever applied here.
 */
export function localGeneration(db: Db, businessId: string): number {
  const r = db
    .prepare("SELECT MAX(generation) AS g FROM ownership WHERE business_id = ?")
    .get(businessId) as { g: number | null };
  return r.g ?? 1;
}

/**
 * Whether the CURRENT authority is this handover's buyer through exactly this close (D1, Astra
 * 01:12/01:28): the local owner is the buyer by an ownership row of this intent at the close's
 * generation, that generation is the newest applied here, and the contract still shows the buyer
 * owning at that same generation. A historical row plus the same person is not enough once the
 * contract's generation moved on.
 */
export function buyerApplied(db: Db, h: HandoverRow, o: OutcomeV3, e: Evidence) {
  if (!h.intent_id || !h.buyer_person_id) return false;
  const b = db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(h.business_id) as
    | { owner_id: string }
    | undefined;
  const row = db
    .prepare(
      "SELECT 1 FROM ownership WHERE business_id = ? AND v3_intent_id = ? AND generation = ? LIMIT 1",
    )
    .get(h.business_id, h.intent_id, o.generation_after);
  return (
    b?.owner_id === h.buyer_person_id &&
    Boolean(row) &&
    localGeneration(db, h.business_id) === o.generation_after &&
    e.control.owner === h.buyer_account &&
    e.control.generation === o.generation_after
  );
}

/** The outcome of this handover's deal: in the read, or its immutable observed copy. */
function outcomeFor(db: Db, h: HandoverRow, e: Evidence): OutcomeV3 | null {
  const seen = e.outcomes.find((o) => o.seq === h.deal_seq);
  if (seen) return seen;
  const stored = db
    .prepare("SELECT outcome FROM v3_outcomes WHERE business_id = ? AND seq = ?")
    .get(h.business_id, h.deal_seq) as { outcome: string } | undefined;
  return stored ? (JSON.parse(stored.outcome) as OutcomeV3) : null;
}

/**
 * Moves this business's handover from ACCEPTED contract evidence only (the caller recorded it
 * through the observation ordering rules). Arms a new one if the read shows a Gated deal Closing.
 * Never opens a gate from a timeout, a missing answer or a read older than the handover's own
 * evidence. Returns the business's open handover afterwards (null: its gate is open).
 */
export function resolveFromEvidence(
  db: Db,
  a: {
    businessId: string;
    network: string;
    account: string;
    evidence: Evidence;
    source: string;
    now: number;
    caps?: JournalCaps;
  },
): HandoverRow | null {
  return inTx(db, () => {
    const e = a.evidence;
    const arm = () =>
      armHandover(db, {
        businessId: a.businessId,
        network: a.network,
        account: a.account,
        block: e.block,
        control: e.control,
        source: a.source,
        now: a.now,
        caps: a.caps,
      });
    const h = openHandover(db, a.businessId);
    if (!h) return arm();
    // Ordering (D1): a read older than this handover's evidence changes nothing.
    if (BigInt(e.block.height) < BigInt(h.evidence_height)) return h;
    const height = e.block.height;
    const j = (kind: string, code: string | null) =>
      journal(db, h, kind, code, { block: e.block, caps: a.caps, now: a.now });
    const o = outcomeFor(db, h, e);
    const live = e.control.live_deal;

    if (o?.status === "closed") {
      if (o.version !== h.version || o.digest !== h.digest) {
        if (h.state !== "attention") {
          setState(db, h, "attention", { attention: "outcome_mismatch", height }, a.now);
          j("attention", "outcome_mismatch");
        }
        return openHandover(db, a.businessId);
      }
      const intent = h.intent_id
        ? (db.prepare("SELECT status FROM v3_intents WHERE id = ?").get(h.intent_id) as
            | { status: string }
            | undefined)
        : undefined;
      // D1: "superseded" is not the buyer's authority; it needs current-authority evidence.
      if (intent?.status === "superseded") {
        if (h.state !== "attention") {
          setState(db, h, "attention", { attention: "superseded", outcome: o, height }, a.now);
          j("attention", "superseded");
        }
        return resolveCurrent(db, a, openHandover(db, a.businessId) as HandoverRow, j);
      }
      if (h.state !== "closed_observed" && h.state !== "reconciled" && h.state !== "attention") {
        setState(db, h, "closed_observed", { outcome: o, height }, a.now);
        j("outcome", "closed");
      }
      const now = openHandover(db, a.businessId) as HandoverRow;
      // D1: after the close the contract moved on (another sale, a new generation) before it was
      // applied here: the buyer's historical authority is not current authority.
      if (e.control.generation !== o.generation_after || e.control.owner !== h.buyer_account) {
        if (now.state !== "attention") {
          setState(
            db,
            now,
            "attention",
            { attention: "authority_advanced", outcome: o, height },
            a.now,
          );
          j("attention", "authority_advanced");
        }
        return resolveCurrent(db, a, openHandover(db, a.businessId) as HandoverRow, j);
      }
      if (buyerApplied(db, now, o, e)) {
        setState(db, now, "released_to_buyer", { outcome: o, height }, a.now);
        journal(db, now, "reconciled", "applied", { block: e.block, caps: a.caps, now: a.now });
        journal(db, now, "terminal", "released_to_buyer", {
          block: e.block,
          caps: a.caps,
          now: a.now,
        });
        return arm();
      }
      if (now.state === "attention") return resolveCurrent(db, a, now, j);
      return now;
    }

    if (o?.status === "aborted") {
      // D1: the aborted outcome AND current authority: the seller still controls on chain and here.
      if (live?.state === "closing" && live.seq !== h.deal_seq) {
        setState(db, h, "ended", { outcome: o, height }, a.now);
        journal(db, h, "ended_for_newer", live.seq, { block: e.block, caps: a.caps, now: a.now });
        return arm();
      }
      const b = db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(h.business_id) as
        | { owner_id: string }
        | undefined;
      const epoch = (
        db
          .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
          .get(h.business_id) as {
          n: number;
        }
      ).n;
      const chainSeller =
        e.control.owner === h.seller_account && e.control.generation === h.expected_generation;
      const localSeller =
        b?.owner_id === h.seller_person_id &&
        h.seller_person_id !== null &&
        (h.local_epoch === null || epoch === h.local_epoch) &&
        localGeneration(db, h.business_id) === h.expected_generation;
      if (chainSeller && localSeller) {
        setState(db, h, "released_to_seller", { outcome: o, height }, a.now);
        journal(db, h, "outcome", "aborted", { block: e.block, caps: a.caps, now: a.now });
        journal(db, h, "terminal", "released_to_seller", {
          block: e.block,
          caps: a.caps,
          now: a.now,
        });
        return arm();
      }
      if (h.state !== "attention") {
        setState(
          db,
          h,
          "attention",
          { attention: "authority_mismatch", outcome: o, height },
          a.now,
        );
        j("attention", "authority_mismatch");
      }
      return resolveCurrent(db, a, openHandover(db, a.businessId) as HandoverRow, j);
    }

    if (o) {
      // A closing deal ends only by its close or its abort: anything else is a contradiction.
      if (h.state !== "attention") {
        setState(
          db,
          h,
          "attention",
          { attention: `unexpected_${o.status}`, outcome: o, height },
          a.now,
        );
        j("attention", `unexpected_${o.status}`);
      }
      return resolveCurrent(db, a, openHandover(db, a.businessId) as HandoverRow, j);
    }

    // Still closing (or not yet shown ended): only the evidence height moves.
    db.prepare(
      "UPDATE business_handovers SET evidence_height = ?, updated_ms = ? WHERE id = ? AND CAST(evidence_height AS INTEGER) <= CAST(? AS INTEGER)",
    ).run(height, a.now, h.id, height);
    if (h.state === "attention")
      return resolveCurrent(db, a, openHandover(db, a.businessId) as HandoverRow, j);
    return openHandover(db, a.businessId);
  });
}

/**
 * Leaving `attention` (D1): only when the CURRENT authority agrees on chain and here: no live
 * Closing deal, and the contract owner's account maps to this business's local owner. Recorded as
 * `released_current` with that owner and generation; historical authority is never restored.
 */
function resolveCurrent(
  db: Db,
  a: { businessId: string; evidence: Evidence; now: number; caps?: JournalCaps },
  h: HandoverRow,
  j: (kind: string, code: string | null) => boolean,
) {
  const e = a.evidence;
  if (h.state !== "attention") return h;
  if (e.control.live_deal?.state === "closing") return h;
  const owner = db
    .prepare("SELECT owner_id FROM chain_accounts WHERE owner_kind = 'person' AND account_id = ?")
    .get(e.control.owner) as { owner_id: string } | undefined;
  const b = db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(h.business_id) as
    | { owner_id: string }
    | undefined;
  if (!owner || owner.owner_id !== b?.owner_id) return h;
  // D1 (Astra 01:28): the same account is not current authority unless the contract's CURRENT
  // generation is exactly what was applied here, by an ownership row naming this owner. A chain
  // generation ahead of the local history stays in attention until it is reconciled.
  const applied = db
    .prepare(
      "SELECT to_id FROM ownership WHERE business_id = ? ORDER BY generation DESC, rowid DESC LIMIT 1",
    )
    .get(h.business_id) as { to_id: string } | undefined;
  const localGen = localGeneration(db, h.business_id);
  if (localGen !== e.control.generation) return h;
  if (applied && applied.to_id !== b?.owner_id) return h;
  setState(
    db,
    h,
    "released_current",
    {
      outcome: { owner: e.control.owner, generation: e.control.generation, block: e.block },
      attention: h.attention_reason,
      height: e.block.height,
    },
    a.now,
  );
  j("terminal", "released_current");
  return openHandover(db, a.businessId);
}

export const isTerminal = (s: HandoverState) => TERMINAL.includes(s);
