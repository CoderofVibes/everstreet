// Job 003m: customer readback (docs/design/CUSTOMER_USE_RUNTIME.md §5). Strict decoders for the
// contract's `get_plan` and `get_entitlement` JSON, one pinned read with its block timestamp, and
// the reservation decision table. Read-only: the transport is injected, and nothing here signs,
// submits or calls a network itself. Decoded values are checked against the actual contract JSON
// (server/test/fixtures/v3/customer-readback.json, produced by the contract's unit tests).

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
    const [control, treasury, plan, entitlement] = await Promise.all([
      want.control ? read("get_control", {}) : none,
      want.treasury ? read("get_treasury", {}) : none,
      want.plan !== undefined ? read("get_plan", { plan_id: want.plan }) : none,
      want.entitlement
        ? read("get_entitlement", {
            customer: want.entitlement.customer,
            plan_id: want.entitlement.plan_id,
          })
        : none,
    ]);
    const out: PinnedRead = { block };
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
  | { kind: "reserved"; serving: boolean; reason: "key_revoked" | "key_changed" | null; row: 2 | 3 }
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
        // 2. Exactly our authorization. Serving needs the key still active at our epoch.
        const serving = key.state === "active" && key.epoch === exp.key_epoch;
        return { kind: "reserved", serving, reason: serving ? null : "key_changed", row: 2 };
      }
      // 3. Only revoke_key lowers serve_until, and it raises the key's epoch.
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
  // 6. open_hold needs the key active at exactly our epoch; epochs only rise.
  if (key.epoch !== exp.key_epoch) return { kind: "refused", reason: "key_changed", row: 6 };
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

/** Whether `account` holds METERING at the current generation (lib.rs `require_metering`). */
export function meters(control: ControlV3, account: string) {
  return control.operators.some(
    (o) => o.account === account && (o.caps & 1) !== 0 && o.generation === control.generation,
  );
}
