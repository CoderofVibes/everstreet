// Job 003m: customer readback (docs/design/CUSTOMER_USE_RUNTIME.md §5). Strict decoders for the
// contract's `get_plan` and `get_entitlement` JSON, one pinned read with its block timestamp, and
// the reservation decision table. Read-only: the transport is injected, and nothing here signs,
// submits or calls a network itself. Decoded values are checked against the actual contract JSON
// (server/test/fixtures/v3/customer-readback.json, produced by the contract's unit tests).

import { createHash } from "node:crypto";
import {
  type BlockRef,
  type ControlV3,
  checkBlock,
  decodeControl,
  decodeTreasury,
  strict,
  type TreasuryV3,
  V3ReadError,
} from "./v3read.ts";

const { fail, obj, arr, u64, u128, u8, u32, small, bool, hex32, account, oneOf } = strict;
const u16 = (v: unknown, w: string) => small(v, w, 0xffff);

/** A pinned final block with its timestamp, which proves deadlines (§5.2 row 7). */
export interface PinnedBlock extends BlockRef {
  /** Milliseconds, decimal string: the block's own timestamp, never the server clock. */
  timestamp_ms: string;
}

/**
 * A read-only view transport whose final block carries its timestamp. Like `ViewTransport` it
 * can't sign or broadcast: it has no such methods. Unconfigured, customer use is unavailable.
 */
export interface CustomerViewTransport {
  readonly network?: string;
  finalBlock(network: string, signal?: AbortSignal): Promise<PinnedBlock>;
  view(input: {
    network: string;
    account: string;
    method: string;
    args: Record<string, unknown>;
    block: BlockRef;
    signal?: AbortSignal;
  }): Promise<{ result: string; block: BlockRef }>;
  /** Job 003web: one transaction's FINAL outcome, raw; null when unknown or not final. */
  txOutcome?(hash: string, sender: string, signal?: AbortSignal): Promise<unknown | null>;
  /** The handoff proof: the account's code hash and access-key count at exactly `block`. */
  accountState?(input: {
    network: string;
    account: string;
    block: BlockRef;
    signal?: AbortSignal;
  }): Promise<{ code_hash: string; keys: number }>;
}

export interface PlanV3 {
  unit_price: string;
  max_units_per_purchase: number;
  max_units_outstanding: number;
  max_hold_units: number;
  hold_ttl_ms: string;
  settle_grace_ms: string;
  created_generation: number;
}

export interface KeyV3 {
  slot: number;
  state: "empty" | "active" | "revoked";
  epoch: number;
  public_key: string;
  max_hold_units: number;
  max_units_per_day: number;
  day: number;
  held_today: number;
}

export interface EntitlementV3 {
  reg_id: string;
  active: boolean;
  free: string;
  consumed: string;
  purchased: string;
  /** Job 003web: the last accepted purchase's sequence (the next must be this + 1). */
  purchase_seq: number;
  hold_seq: number;
  hold_active: boolean;
  hold_key_slot: number;
  hold_key_epoch: number;
  hold_units: number;
  hold_charged: number;
  hold_used: number;
  hold_slots: (string | null)[];
  serve_until_ms: string;
  settle_until_ms: string;
  last_hold_seq: number;
  last_hold_used: number;
  last_hold_charged: number;
  last_hold_root: string;
  keys: KeyV3[];
  paused: boolean;
}

const PLAN_KEYS = [
  "unit_price",
  "max_units_per_purchase",
  "max_units_outstanding",
  "max_hold_units",
  "hold_ttl_ms",
  "settle_grace_ms",
  "created_generation",
] as const;

export function decodePlan(v: unknown): PlanV3 | null {
  if (v === null) return null;
  const o = obj(v, "plan", PLAN_KEYS);
  return {
    unit_price: u128(o.unit_price, "plan.unit_price"),
    max_units_per_purchase: u32(o.max_units_per_purchase, "plan.max_units_per_purchase"),
    max_units_outstanding: u32(o.max_units_outstanding, "plan.max_units_outstanding"),
    max_hold_units: u8(o.max_hold_units, "plan.max_hold_units"),
    hold_ttl_ms: u64(o.hold_ttl_ms, "plan.hold_ttl_ms"),
    settle_grace_ms: u64(o.settle_grace_ms, "plan.settle_grace_ms"),
    created_generation: u32(o.created_generation, "plan.created_generation"),
  };
}

const ENT_KEYS = [
  "reg_id",
  "active",
  "free",
  "consumed",
  "units_retired_to_refund",
  "purchased",
  "purchase_seq",
  "hold_seq",
  "hold_active",
  "hold_key_slot",
  "hold_key_epoch",
  "hold_units",
  "hold_charged",
  "hold_used",
  "hold_slots",
  "hold_opened_at_ms",
  "serve_until_ms",
  "settle_until_ms",
  "last_hold_seq",
  "last_hold_used",
  "last_hold_charged",
  "last_hold_root",
  "key_states",
  "key_epochs",
  "keys",
  "claim",
  "pending_refs",
  "paused",
  "storage_payer",
  "storage_paid",
] as const;

const KEY_KEYS = [
  "slot",
  "state",
  "epoch",
  "public_key",
  "max_hold_units",
  "max_units_per_day",
  "day",
  "held_today",
] as const;

/** `get_entitlement`, strictly; null is the contract's "no entitlement". */
export function decodeEntitlement(v: unknown): EntitlementV3 | null {
  if (v === null) return null;
  const o = obj(v, "entitlement", ENT_KEYS);
  const hold_units = u8(o.hold_units, "entitlement.hold_units");
  const hold_active = bool(o.hold_active, "entitlement.hold_active");
  const slots = arr(o.hold_slots, "entitlement.hold_slots", 10).map((s, i) =>
    s === null ? null : hex32(s, `entitlement.hold_slots[${i}]`),
  );
  // The view lists one entry per slot of the active hold, and none otherwise.
  if (slots.length !== (hold_active ? hold_units : 0))
    fail("malformed", "entitlement.hold_slots doesn't match the hold");
  const keys = arr(o.keys, "entitlement.keys", 4).map((k, i) => {
    const x = obj(k, `entitlement.keys[${i}]`, KEY_KEYS);
    const key: KeyV3 = {
      slot: u8(x.slot, "key.slot"),
      state: oneOf(x.state, "key.state", ["empty", "active", "revoked"] as const),
      epoch: u32(x.epoch, "key.epoch"),
      public_key: hex32(x.public_key, "key.public_key"),
      max_hold_units: u8(x.max_hold_units, "key.max_hold_units"),
      max_units_per_day: u16(x.max_units_per_day, "key.max_units_per_day"),
      day: u32(x.day, "key.day"),
      held_today: u16(x.held_today, "key.held_today"),
    };
    if (key.slot !== i) fail("malformed", "entitlement.keys are out of slot order");
    return key;
  });
  if (keys.length !== 4) fail("malformed", "entitlement.keys must list the four key slots");
  const states = arr(o.key_states, "entitlement.key_states", 4).map((s) => u8(s, "key_states"));
  const epochs = arr(o.key_epochs, "entitlement.key_epochs", 4).map((s) => u32(s, "key_epochs"));
  const code = { empty: 0, active: 1, revoked: 2 } as const;
  keys.forEach((k, i) => {
    if (states[i] !== code[k.state] || epochs[i] !== k.epoch)
      fail("malformed", "entitlement key summaries disagree with the keys");
  });
  u64(o.units_retired_to_refund, "entitlement.units_retired_to_refund");
  u32(o.purchase_seq, "entitlement.purchase_seq");
  u64(o.hold_opened_at_ms, "entitlement.hold_opened_at_ms");
  u128(o.claim, "entitlement.claim");
  u8(o.pending_refs, "entitlement.pending_refs");
  account(o.storage_payer, "entitlement.storage_payer");
  u128(o.storage_paid, "entitlement.storage_paid");
  return {
    reg_id: u64(o.reg_id, "entitlement.reg_id"),
    active: bool(o.active, "entitlement.active"),
    free: u64(o.free, "entitlement.free"),
    consumed: u64(o.consumed, "entitlement.consumed"),
    purchased: u64(o.purchased, "entitlement.purchased"),
    purchase_seq: u32(o.purchase_seq, "entitlement.purchase_seq"),
    hold_seq: u32(o.hold_seq, "entitlement.hold_seq"),
    hold_active,
    hold_key_slot: u8(o.hold_key_slot, "entitlement.hold_key_slot"),
    hold_key_epoch: u32(o.hold_key_epoch, "entitlement.hold_key_epoch"),
    hold_units,
    hold_charged: u8(o.hold_charged, "entitlement.hold_charged"),
    hold_used: u16(o.hold_used, "entitlement.hold_used"),
    hold_slots: slots,
    serve_until_ms: u64(o.serve_until_ms, "entitlement.serve_until_ms"),
    settle_until_ms: u64(o.settle_until_ms, "entitlement.settle_until_ms"),
    last_hold_seq: u32(o.last_hold_seq, "entitlement.last_hold_seq"),
    last_hold_used: u16(o.last_hold_used, "entitlement.last_hold_used"),
    last_hold_charged: u8(o.last_hold_charged, "entitlement.last_hold_charged"),
    last_hold_root: hex32(o.last_hold_root, "entitlement.last_hold_root"),
    keys,
    paused: bool(o.paused, "entitlement.paused"),
  };
}

const MAX_RESULT = 64 * 1024;
const TIMESTAMP = /^(0|[1-9][0-9]{0,19})$/;

export interface PinnedRead {
  block: PinnedBlock;
  control?: ControlV3;
  plan?: PlanV3 | null;
  entitlement?: EntitlementV3 | null;
  treasury?: TreasuryV3;
  checkUse?: UseCheckV3;
}

/**
 * Reads the named views at one pinned final block, under one deadline that aborts every request
 * still in flight. Any failure refuses the whole read (a `V3ReadError`); nothing partial returns.
 */
export async function readCustomerViews(
  transport: CustomerViewTransport,
  at: { network: string; account: string },
  want: {
    control?: boolean;
    treasury?: boolean;
    plan?: number;
    entitlement?: { customer: string; plan_id: number };
    /** Job 003o: `check_use` for one slot, at the same block. */
    checkUse?: {
      customer: string;
      plan_id: number;
      reg_id: string;
      hold_seq: number;
      slot: number;
      fingerprint: string;
    };
  },
  timeoutMs: number,
): Promise<PinnedRead> {
  if (transport.network !== undefined && transport.network !== at.network)
    fail("unsupported", "the binding names another network than the transport reads");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new V3ReadError("timeout", "the read took too long")),
    timeoutMs,
  );
  const ended = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        const r = controller.signal.reason;
        reject(r instanceof V3ReadError ? r : new V3ReadError("unavailable", "the read ended"));
      },
      { once: true },
    );
  });
  ended.catch(() => {});
  const call = async <T>(p: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    try {
      return await Promise.race([p(controller.signal), ended]);
    } catch (e) {
      if (e instanceof V3ReadError) throw e;
      throw new V3ReadError("unavailable", "the NEAR read failed");
    }
  };
  try {
    const final = await call((signal) => transport.finalBlock(at.network, signal));
    const pinned = checkBlock(final, "final block");
    const ts = (final as { timestamp_ms?: unknown })?.timestamp_ms;
    if (typeof ts !== "string" || !TIMESTAMP.test(ts) || BigInt(ts) > (1n << 64n) - 1n)
      fail("malformed", "the final block has no timestamp");
    const block: PinnedBlock = { ...pinned, timestamp_ms: ts as string };
    const read = async (method: string, args: Record<string, unknown>) => {
      const answer = await call((signal) =>
        transport.view({
          network: at.network,
          account: at.account,
          method,
          args,
          block: pinned,
          signal,
        }),
      );
      const b = checkBlock(answer?.block, method);
      if (b.height !== pinned.height || b.hash !== pinned.hash)
        fail("mixed_blocks", `${method} answered from another block`);
      if (typeof answer.result !== "string" || answer.result.length > MAX_RESULT)
        fail("too_large", `${method} returned no bounded text`);
      try {
        return JSON.parse(answer.result) as unknown;
      } catch {
        return fail("malformed", `${method} returned invalid JSON`);
      }
    };
    const none = Promise.resolve(undefined);
    const [control, treasury, plan, entitlement, checkUse] = await Promise.all([
      want.control ? read("get_control", {}) : none,
      want.treasury ? read("get_treasury", {}) : none,
      want.plan !== undefined ? read("get_plan", { plan_id: want.plan }) : none,
      want.entitlement
        ? read("get_entitlement", {
            customer: want.entitlement.customer,
            plan_id: want.entitlement.plan_id,
          })
        : none,
      want.checkUse ? read("check_use", { ...want.checkUse }) : none,
    ]);
    const out: PinnedRead = { block };
    if (want.checkUse) out.checkUse = decodeUseCheck(checkUse);
    if (want.control) out.control = decodeControl(control);
    if (want.treasury) out.treasury = decodeTreasury(treasury);
    if (want.plan !== undefined) out.plan = decodePlan(plan);
    if (want.entitlement) out.entitlement = decodeEntitlement(entitlement);
    return out;
  } finally {
    clearTimeout(timer);
    controller.abort(new V3ReadError("unavailable", "the read is over"));
  }
}

/** What a persisted reservation expects to find (CUSTOMER_USE_RUNTIME §5.2). */
export interface ExpectedHold {
  reg_id: string;
  key_slot: number;
  key_epoch: number;
  hold_seq: number;
  units: number;
  serve_until_ms: string;
  settle_until_ms: string;
  accept_by_ms: string;
}

export type Decision =
  | {
      kind: "reserved";
      serving: boolean;
      reason: "key_revoked" | "key_changed" | "serve_window_passed" | null;
      row: 2 | 3;
    }
  | { kind: "refused"; reason: "superseded" | "key_changed" | "expired_unopened"; row: 4 | 6 | 7 }
  | { kind: "unresolved"; reason: "registration_changed" | "sequence_used"; row: 1 | 9 }
  | { kind: "inconsistent"; reason: string; row: 5 }
  | {
      kind: "pending";
      blocked: "paused" | "no_free_unit" | "daily_cap" | null;
      row: 8;
    };

const DAY_MS = 86_400_000n;

/**
 * The decision table (§5.2), in its order. Pure: one entitlement read at a pinned block and its
 * timestamp. Every outcome cites the contract rule that makes it sound; nothing is guessed.
 */
export function decideReservation(
  exp: ExpectedHold,
  e: EntitlementV3 | null,
  blockTimestampMs: string,
): Decision {
  // 1. Our messages name this registration; another one can never accept them.
  if (!e || e.reg_id !== exp.reg_id)
    return { kind: "unresolved", reason: "registration_changed", row: 1 };
  const key = e.keys[exp.key_slot] as KeyV3;
  if (e.hold_active) {
    if (e.hold_seq === exp.hold_seq) {
      const same =
        e.hold_units === exp.units &&
        e.hold_key_slot === exp.key_slot &&
        e.hold_key_epoch === exp.key_epoch &&
        e.settle_until_ms === exp.settle_until_ms;
      // 4. One sequence opens at most once: a different hold at ours means ours never opens.
      if (!same) return { kind: "refused", reason: "superseded", row: 4 };
      if (e.serve_until_ms === exp.serve_until_ms) {
        // 2. Exactly our authorization. "Serving" is a fact about block B only (003m1): the key
        //    still active at our epoch and B before serve_until (revoke_key or revoke_key_guarded, and the hold's own
        //    window both end serving there). It is never a capability to dispatch later.
        const keyOk = key.state === "active" && key.epoch === exp.key_epoch;
        const inWindow = BigInt(blockTimestampMs) < BigInt(exp.serve_until_ms);
        const reason = !keyOk ? "key_changed" : !inWindow ? "serve_window_passed" : null;
        return { kind: "reserved", serving: keyOk && inWindow, reason, row: 2 };
      }
      // 3. Only a revocation (revoke_key, or job 003wec's revoke_key_guarded) lowers serve_until, and
      //    it raises the key's epoch.
      if (BigInt(e.serve_until_ms) < BigInt(exp.serve_until_ms) && key.epoch > exp.key_epoch)
        return { kind: "reserved", serving: false, reason: "key_revoked", row: 3 };
      return { kind: "inconsistent", reason: "the hold's serving time changed", row: 5 };
    }
    if (e.hold_seq > exp.hold_seq) return { kind: "unresolved", reason: "sequence_used", row: 9 };
    // An earlier sequence can't be newly active: allocation saw it closed.
    return { kind: "inconsistent", reason: "an earlier hold is active", row: 5 };
  }
  if (e.hold_seq >= exp.hold_seq) return { kind: "unresolved", reason: "sequence_used", row: 9 };
  if (e.hold_seq < exp.hold_seq - 1)
    return { kind: "inconsistent", reason: "the hold sequence went back", row: 5 };
  // 6. open_hold needs the key active at exactly our epoch; epochs only rise, so a higher epoch
  //    proves ours can't open. A lower one is a regression: evidence of another source (003m1).
  if (key.epoch < exp.key_epoch)
    return { kind: "inconsistent", reason: "the key epoch went back", row: 5 };
  if (key.epoch > exp.key_epoch) return { kind: "refused", reason: "key_changed", row: 6 };
  if (key.state !== "active")
    return { kind: "inconsistent", reason: "the key is inactive at our epoch", row: 5 };
  // 7. open_hold needs serve_until ≥ now + 60 s; block time only rises (assumption A1).
  if (BigInt(blockTimestampMs) > BigInt(exp.accept_by_ms))
    return { kind: "refused", reason: "expired_unopened", row: 7 };
  // 8. Still acceptable: the exact resend either opens once or answers "already".
  let blocked: "paused" | "no_free_unit" | "daily_cap" | null = null;
  const day = Number(BigInt(blockTimestampMs) / DAY_MS);
  if (e.paused) blocked = "paused";
  else if (BigInt(e.free) < BigInt(exp.units)) blocked = "no_free_unit";
  else if (key.day === day && key.held_today + exp.units > key.max_units_per_day)
    blocked = "daily_cap";
  return { kind: "pending", blocked, row: 8 };
}

/**
 * The contract's own authority (lib.rs `require_metering`, unit test c01): the current owner, or
 * an account holding METERING granted in the current generation.
 */
export function contractMeters(control: ControlV3, account: string) {
  return control.owner === account || platformMeters(control, account);
}

/**
 * The platform's narrower policy: it acts only as an explicitly granted METERING operator of the
 * current generation, never through owner authority (it never holds an owner key). Admission
 * uses this; it is an app policy, not a contract rule.
 */
export function platformMeters(control: ControlV3, account: string) {
  return control.operators.some(
    (o) => o.account === account && (o.caps & 1) !== 0 && o.generation === control.generation,
  );
}

// ---------- evidence fencing (job 003m1) ----------

/** The facts of one accepted readback that later evidence must be consistent with. */
export interface EvidenceMark {
  height: string;
  hash: string;
  timestamp_ms: string;
  /** sha256 of the decoded entitlement (our own canonical decoding). */
  digest: string;
  /** What may only rise: registration, then (within it) hold sequence and each key's epoch. */
  summary: { reg_id: string; hold_seq: number; key_epochs: number[] } | null;
}

export function markOf(block: PinnedBlock, e: EntitlementV3 | null): EvidenceMark {
  return {
    height: block.height,
    hash: block.hash,
    timestamp_ms: block.timestamp_ms,
    digest: createHash("sha256").update(JSON.stringify(e)).digest("hex"),
    summary: e
      ? { reg_id: e.reg_id, hold_seq: e.hold_seq, key_epochs: e.keys.map((k) => k.epoch) }
      : null,
  };
}

/**
 * How a new readback relates to the last accepted one: `stale` (a lower block: ignored),
 * `null` (acceptable), or a conflict reason. An equal block must be identical in hash, time and
 * content; a higher block must have a later time (assumption A1) and no regression. A conflict is
 * evidence of an unreliable source; it never proves anything about the hold.
 */
export function evidenceProblem(prev: EvidenceMark, next: EvidenceMark): "stale" | string | null {
  const h = BigInt(next.height);
  const p = BigInt(prev.height);
  if (h < p) return "stale";
  if (h === p) {
    if (next.hash !== prev.hash) return "equal_height_hash_differs";
    if (next.timestamp_ms !== prev.timestamp_ms) return "equal_block_time_differs";
    if (next.digest !== prev.digest) return "equal_block_view_differs";
    return null;
  }
  if (BigInt(next.timestamp_ms) <= BigInt(prev.timestamp_ms)) return "block_time_not_rising";
  const a = prev.summary;
  const b = next.summary;
  if (a && b) {
    if (BigInt(b.reg_id) < BigInt(a.reg_id)) return "registration_regressed";
    if (b.reg_id === a.reg_id) {
      if (b.hold_seq < a.hold_seq) return "hold_sequence_regressed";
      if (b.key_epochs.some((x, i) => x < (a.key_epochs[i] ?? 0))) return "key_epoch_regressed";
    }
  }
  return null;
}

// ---------- settlement readback (job 003o) ----------

export interface UseCheckV3 {
  status:
    | "charged"
    | "conflict"
    | "unused"
    | "closed"
    | "unknown_hold"
    | "other_registration"
    | "no_entitlement"
    | "invalid";
  slot_used: boolean | null;
  closed_root: string | null;
}

/** `check_use`, strictly (lib.rs `check_use`). */
export function decodeUseCheck(v: unknown): UseCheckV3 {
  const o = obj(v, "check_use", ["status", "slot_used", "closed_root"]);
  return {
    status: oneOf(o.status, "check_use.status", [
      "charged",
      "conflict",
      "unused",
      "closed",
      "unknown_hold",
      "other_registration",
      "no_entitlement",
      "invalid",
    ] as const),
    slot_used: o.slot_used === null ? null : bool(o.slot_used, "check_use.slot_used"),
    closed_root: o.closed_root === null ? null : hex32(o.closed_root, "check_use.closed_root"),
  };
}

const rootOf = (used: [number, string][]) => {
  const parts = [Buffer.alloc(4)];
  (parts[0] as Buffer).writeUInt32LE(used.length);
  for (const [slot, fp] of used) parts.push(Buffer.from([slot]), Buffer.from(fp, "hex"));
  return createHash("sha256").update(Buffer.concat(parts)).digest("hex");
};
/** `closed_hold_root` of the empty list (lib.rs; fixture `closed_root_empty`). */
export const EMPTY_ROOT = rootOf([]);
/** `closed_hold_root` of a one-unit hold whose slot 0 holds `fingerprint`. */
export const oneSlotRoot = (fingerprint: string) => rootOf([[0, fingerprint]]);

export interface ExpectedUse extends ExpectedHold {
  /** Our use's fingerprint for slot 0. */
  fingerprint: string;
}

export type SettlementFact =
  /** Positive proof: our fingerprint charged slot 0, with the hold `closed` or still open. */
  | { kind: "charged"; closed: boolean }
  /** Proof the unit wasn't charged and came back: our hold closed with no used slot. */
  | { kind: "returned" }
  /** Our hold is open and slot 0 unused; it can still be charged only until settle_until. */
  | { kind: "unused_open"; settleable: boolean }
  /** Another fingerprint holds slot 0, or the views disagree: never resolved automatically. */
  | { kind: "conflict"; reason: string }
  /** The readback can't establish the outcome: never a charge, never a refund. */
  | { kind: "unknown"; reason: string };

/**
 * What a one-unit hold's settlement readback proves (CUSTOMER_USE_RUNTIME §14). It uses the
 * entitlement and `check_use` read at one block, and requires them to agree. A closed hold is
 * decided only by recomputing the contract's root from the complete ordered list of used slots
 * implied by the bitmap: `check_use` alone says the same for any fingerprint. The one-unit scope
 * is validated, not assumed. Expiry alone never proves a use wasn't charged.
 */
export function decideSettlement(
  exp: ExpectedUse,
  e: EntitlementV3 | null,
  c: UseCheckV3,
  blockTimestampMs: string,
): SettlementFact {
  if (exp.units !== 1) return { kind: "unknown", reason: "not_one_unit" };
  if (!e || e.reg_id !== exp.reg_id) {
    if (!["no_entitlement", "other_registration"].includes(c.status))
      return { kind: "conflict", reason: "views_disagree" };
    return { kind: "unknown", reason: "registration_changed" };
  }
  if (e.hold_active && e.hold_seq === exp.hold_seq) {
    const ours =
      e.hold_units === 1 &&
      e.hold_key_slot === exp.key_slot &&
      e.hold_key_epoch === exp.key_epoch &&
      e.settle_until_ms === exp.settle_until_ms;
    if (!ours) return { kind: "unknown", reason: "not_our_hold" };
    if ((e.hold_used & ~1) !== 0) return { kind: "unknown", reason: "not_one_unit" };
    const used = (e.hold_used & 1) !== 0;
    const slot = e.hold_slots[0] ?? null;
    // 003o1: check_use's slot bit must agree with the entitlement's bitmap, not only its status.
    if (c.slot_used !== used) return { kind: "conflict", reason: "views_disagree" };
    if (!used) {
      if (c.status !== "unused" || slot !== null)
        return { kind: "conflict", reason: "views_disagree" };
      // settle_hold needs now ≤ settle_until; block time only rises (A1).
      return {
        kind: "unused_open",
        settleable: BigInt(blockTimestampMs) <= BigInt(exp.settle_until_ms),
      };
    }
    if (slot === exp.fingerprint) {
      if (c.status !== "charged") return { kind: "conflict", reason: "views_disagree" };
      return { kind: "charged", closed: false };
    }
    if (c.status !== "conflict") return { kind: "conflict", reason: "views_disagree" };
    return { kind: "conflict", reason: "other_fingerprint" };
  }
  if (!e.hold_active && e.last_hold_seq === exp.hold_seq && e.hold_seq === exp.hold_seq) {
    if (
      c.status !== "closed" ||
      c.closed_root !== e.last_hold_root ||
      c.slot_used !== ((e.last_hold_used & 1) !== 0)
    )
      return { kind: "conflict", reason: "views_disagree" };
    // The count must agree with the bitmap (U2: popcount of used == charged).
    if (e.last_hold_charged !== (e.last_hold_used & 1))
      return { kind: "unknown", reason: "root_mismatch" };
    if (e.last_hold_used === 0) {
      if (e.last_hold_charged !== 0 || e.last_hold_root !== EMPTY_ROOT)
        return { kind: "unknown", reason: "root_mismatch" };
      return { kind: "returned" };
    }
    if (e.last_hold_used !== 1) return { kind: "unknown", reason: "not_one_unit" };
    // The complete used list of a one-unit hold is slot 0 alone: the root decides whose use.
    if (e.last_hold_charged === 1 && e.last_hold_root === oneSlotRoot(exp.fingerprint))
      return { kind: "charged", closed: true };
    return { kind: "unknown", reason: "root_mismatch" };
  }
  if (e.hold_seq < exp.hold_seq) return { kind: "conflict", reason: "hold_sequence_regressed" };
  // Our sequence is behind the contract's only record: whose use it carried is not readable.
  return { kind: "unknown", reason: "history_lost" };
}
