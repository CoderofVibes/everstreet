// Job 003wf2 (docs/design/DIRECT_SALE.md): the pure sale-path terms. Strict decoders for the
// contract's sale capability and party views, the contract digest recomputed byte for byte
// (lib.rs `digest_of`), the immutable off-chain terms document, the exact wallet calls for every
// visible action, and each call's exclusivity identity. Nothing here reads, signs or sends.
//
// Amounts are canonical base-unit decimal strings, compared and encoded with BigInt only.

import { createHash } from "node:crypto";
import type { WalletCall } from "./customerPurchase.ts";
import { strict } from "./v3read.ts";

const { obj, u64, u128, u32, bool, account, small } = strict;

export const SALE_TERMS_VERSION = 1;
export const DEAL_DOMAIN = "business-deal/v3";
export const METERING = 1;
export const SUPPORT = 2;
export const CLAIM_PROFIT = 0;
export const CLAIM_ESCROW_RETURN = 1;
export const CLAIM_SALE_PROCEEDS = 2;
const DAY_MS = 86_400_000n;
export const MIN_OFFER_MS = 60_000n;
export const MAX_OFFER_MS = 30n * DAY_MS;

export const GAS = {
  /** Party record, digest and a refund promise. */
  propose: "50000000000000",
  call: "30000000000000",
  /** The token's transfer, the business's receiver and the token's resolution. */
  fund: "100000000000000",
  /** The claim, the token's transfer (10 Tgas) and the payout callback (10 Tgas). */
  claim: "60000000000000",
} as const;

// ---------- strict decoders (the contract's own JSON) ----------

export interface SaleTermsV3 {
  version: 1;
  guarded: true;
  next_deal_seq: string;
  plan_count: number;
  min_reserve: string;
  party_exists: boolean;
  party_bytes: string;
  storage_byte_cost: string;
  payout_seq: string;
}

/** `get_sale_terms`, strictly; any other shape (an older or unknown capability) is null. */
export function decodeSaleTerms(v: unknown): SaleTermsV3 | null {
  try {
    const o = obj(v, "sale_terms", [
      "version",
      "guarded",
      "next_deal_seq",
      "plan_count",
      "min_reserve",
      "party_exists",
      "party_bytes",
      "storage_byte_cost",
      "payout_seq",
    ]);
    if (o.version !== SALE_TERMS_VERSION || o.guarded !== true) return null;
    const out: SaleTermsV3 = {
      version: 1,
      guarded: true,
      next_deal_seq: u64(o.next_deal_seq, "next_deal_seq"),
      plan_count: u32(o.plan_count, "plan_count"),
      min_reserve: u128(o.min_reserve, "min_reserve"),
      party_exists: bool(o.party_exists, "party_exists"),
      party_bytes: u64(o.party_bytes, "party_bytes"),
      storage_byte_cost: u128(o.storage_byte_cost, "storage_byte_cost"),
      payout_seq: u64(o.payout_seq, "payout_seq"),
    };
    // A record that exists costs nothing; a new one is a bounded, measured size.
    if (out.party_exists !== (out.party_bytes === "0")) return null;
    if (BigInt(out.party_bytes) > 1_000n || out.storage_byte_cost === "0") return null;
    return out;
  } catch {
    return null;
  }
}

export interface PartyV3 {
  profit_claim: string;
  escrow_return_claim: string;
  sale_proceeds_claim: string;
  pending_refs: number;
  payer: string;
  deposit: string;
  pinned: boolean;
}

/** `get_party`, strictly; null is the contract's "no record". Throws a V3ReadError otherwise. */
export function decodeParty(v: unknown): PartyV3 | null {
  if (v === null) return null;
  const o = obj(v, "party", [
    "profit_claim",
    "escrow_return_claim",
    "sale_proceeds_claim",
    "pending_refs",
    "payer",
    "deposit",
    "pinned",
  ]);
  return {
    profit_claim: u128(o.profit_claim, "party.profit_claim"),
    escrow_return_claim: u128(o.escrow_return_claim, "party.escrow_return_claim"),
    sale_proceeds_claim: u128(o.sale_proceeds_claim, "party.sale_proceeds_claim"),
    pending_refs: small(o.pending_refs, "party.pending_refs", 0xffff),
    payer: account(o.payer, "party.payer"),
    deposit: u128(o.deposit, "party.deposit"),
    pinned: bool(o.pinned, "party.pinned"),
  };
}

export const claimOf = (p: PartyV3 | null, category: number): string =>
  !p
    ? "0"
    : category === CLAIM_SALE_PROCEEDS
      ? p.sale_proceeds_claim
      : category === CLAIM_ESCROW_RETURN
        ? p.escrow_return_claim
        : p.profit_claim;

// ---------- the contract digest (lib.rs digest_of), byte for byte ----------

export interface DigestInput {
  business: string;
  seq: string;
  version: number;
  seller: string;
  buyer: string;
  asset: string;
  price: string;
  expires_at_ms: string;
  close_window_ms: string;
  available_floor: string;
  grants: { account: string; caps: number }[];
  terms_hash: string;
  expected_generation: number;
  manifest: string;
  manifest_seq: string;
  plan_count: number;
  min_reserve: string;
  close_mode: "direct" | "gated";
  closer: string | null;
}

function le(v: bigint, bytes: number): Buffer {
  if (v < 0n || v >= 1n << BigInt(bytes * 8)) throw new Error("value out of range");
  const b = Buffer.alloc(bytes);
  let x = v;
  for (let i = 0; i < bytes; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}
const str = (s: string) => {
  const u = Buffer.from(s, "utf8");
  return Buffer.concat([le(BigInt(u.length), 4), u]);
};
const hex32 = (h: string) => {
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("not a 32-byte hex digest");
  return Buffer.from(h, "hex");
};

/** The borsh bytes lib.rs hashes: two nested tuples (domain .. close window; floor .. closer). */
export function dealDigestBytes(d: DigestInput): Buffer {
  const grants = Buffer.concat([
    le(BigInt(d.grants.length), 4),
    ...d.grants.map((g) => Buffer.concat([str(g.account), le(BigInt(g.caps), 1)])),
  ]);
  return Buffer.concat([
    str(DEAL_DOMAIN),
    str(d.business),
    le(BigInt(d.seq), 8),
    le(BigInt(d.version), 4),
    str(d.seller),
    str(d.buyer),
    str(d.asset),
    le(BigInt(d.price), 16),
    le(BigInt(d.expires_at_ms), 8),
    le(BigInt(d.close_window_ms), 8),
    le(BigInt(d.available_floor), 16),
    grants,
    hex32(d.terms_hash),
    le(BigInt(d.expected_generation), 4),
    hex32(d.manifest),
    le(BigInt(d.manifest_seq), 8),
    le(BigInt(d.plan_count), 4),
    le(BigInt(d.min_reserve), 16),
    le(d.close_mode === "gated" ? 1n : 0n, 1),
    str(d.close_mode === "gated" ? (d.closer ?? "") : ""),
  ]);
}

export const dealDigest = (d: DigestInput) =>
  createHash("sha256").update(dealDigestBytes(d)).digest("hex");

// ---------- the immutable off-chain terms document ----------

/** What every sale here includes and excludes, in plain words (fixed: part of the hashed text). */
export const INCLUDED = [
  "The owner role of this business's NEAR contract, with its owner powers.",
  "The right to appoint the business's operators from the close on; earlier operators end with the close.",
  "The treasury's available balance. Customer money stays reserved for customers.",
] as const;
export const NOT_INCLUDED = [
  "Customer obligations do not move to anyone: customers keep their prepaid units, holds, requests and results with the business.",
  "Domains, provider and model accounts, secrets and anything outside this app are not included; each needs its own verified transfer.",
  "No legal entity, intellectual property or contract outside this app changes hands by this sale.",
] as const;

export interface TermsDoc {
  schema: "sale-terms/1";
  business: { id: string; name: string };
  contract: { network: string; account: string };
  seller: string;
  buyer: string;
  asset: { account: string; symbol: string; decimals: number };
  price: string;
  expires_at_ms: string;
  available_floor: string;
  grants: { account: string; caps: number }[];
  continuity: { metering_account: string; metering_granted: boolean };
  transfers: { included: string[]; not_included: string[] };
  note: string;
}

const TEXT = (s: string, max: number) =>
  s.length <= max && ![...s].some((c) => c.charCodeAt(0) < 32 && c !== "\n");

/** The seller's own words, validated: at most 8 listed exclusions and a bounded note. */
export function validSellerText(exclusions: unknown, note: unknown): string | null {
  if (!Array.isArray(exclusions) || exclusions.length > 8) return "List at most 8 exclusions.";
  for (const e of exclusions)
    if (typeof e !== "string" || e.trim().length === 0 || !TEXT(e, 160) || e.includes("\n"))
      return "Each exclusion is one line of at most 160 characters.";
  if (typeof note !== "string" || !TEXT(note, 1000))
    return "The note is at most 1000 characters of plain text.";
  return null;
}

/** The canonical text: a fixed structure in a fixed key order, so it hashes reproducibly. */
export function canonicalTerms(d: TermsDoc): string {
  return JSON.stringify({
    schema: d.schema,
    business: { id: d.business.id, name: d.business.name },
    contract: { network: d.contract.network, account: d.contract.account },
    seller: d.seller,
    buyer: d.buyer,
    asset: { account: d.asset.account, symbol: d.asset.symbol, decimals: d.asset.decimals },
    price: d.price,
    expires_at_ms: d.expires_at_ms,
    available_floor: d.available_floor,
    grants: d.grants.map((g) => ({ account: g.account, caps: g.caps })),
    continuity: {
      metering_account: d.continuity.metering_account,
      metering_granted: d.continuity.metering_granted,
    },
    transfers: { included: [...d.transfers.included], not_included: [...d.transfers.not_included] },
    note: d.note,
  });
}

export const sha256hex = (text: string) =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

// ---------- exact wallet calls ----------

/** The terms argument exactly as the contract's DealTermsInput takes it. */
export interface DealTermsArg {
  buyer: string;
  price: string;
  expires_at_ms: string;
  /** "0" in Direct mode; 10 minutes to 24 hours in Gated mode (job 003wf3). */
  close_window_ms: string;
  available_floor: string;
  grants: [string, number][];
  terms_hash: string;
}

export const termsArg = (t: {
  buyer: string;
  price: string;
  expires_at_ms: string;
  available_floor: string;
  grants: { account: string; caps: number }[];
  terms_hash: string;
  close_window_ms?: string;
}): DealTermsArg => ({
  buyer: t.buyer,
  price: t.price,
  expires_at_ms: t.expires_at_ms,
  close_window_ms: t.close_window_ms ?? "0",
  available_floor: t.available_floor,
  grants: t.grants.map((g) => [g.account, g.caps]),
  terms_hash: t.terms_hash,
});

export const proposeCall = (
  contract: string,
  terms: DealTermsArg,
  expectedControlSeq: string,
  digest: string,
  deposit: string,
): WalletCall => ({
  receiverId: contract,
  methodName: "propose_sale_guarded",
  args: { terms, expected_control_seq: expectedControlSeq, digest },
  gas: GAS.propose,
  deposit,
});

export const reviseCall = (
  contract: string,
  dealSeq: string,
  expectedControlSeq: string,
  terms: DealTermsArg,
  digest: string,
  deposit: string,
): WalletCall => ({
  receiverId: contract,
  methodName: "revise_sale_guarded",
  args: { deal_seq: dealSeq, expected_control_seq: expectedControlSeq, terms, digest },
  gas: GAS.propose,
  deposit,
});

export const acceptCall = (
  contract: string,
  dealSeq: string,
  version: number,
  digest: string,
): WalletCall => ({
  receiverId: contract,
  methodName: "accept_sale",
  args: { deal_seq: dealSeq, version, digest },
  gas: GAS.call,
  deposit: "1",
});

/** unfund / cancel / expire: the deal and the control state reviewed (expire takes no deposit). */
export const dealStepCall = (
  contract: string,
  method: "unfund_deal_guarded" | "cancel_sale_guarded" | "expire_sale_guarded",
  dealSeq: string,
  expectedControlSeq: string,
): WalletCall => ({
  receiverId: contract,
  methodName: method,
  args: { deal_seq: dealSeq, expected_control_seq: expectedControlSeq },
  gas: GAS.call,
  deposit: method === "expire_sale_guarded" ? "0" : "1",
});

export const fundMsg = (dealSeq: string, version: number, price: string, cs: string) =>
  JSON.stringify({
    fund_deal: { deal_seq: dealSeq, version, price, expected_control_seq: cs },
  });

export const fundCall = (
  asset: string,
  contract: string,
  dealSeq: string,
  version: number,
  price: string,
  expectedControlSeq: string,
): WalletCall => ({
  receiverId: asset,
  methodName: "ft_transfer_call",
  args: {
    receiver_id: contract,
    amount: price,
    msg: fundMsg(dealSeq, version, price, expectedControlSeq),
  },
  gas: GAS.fund,
  deposit: "1",
});

export const claimCall = (
  contract: string,
  category: number,
  amount: string,
  payoutSeq: string,
): WalletCall => ({
  receiverId: contract,
  methodName: "claim_party_guarded",
  args: { category, expected_amount: amount, expected_payout_seq: payoutSeq },
  gas: GAS.claim,
  deposit: "1",
});

export const appointCall = (
  contract: string,
  operator: string,
  caps: number,
  expectedControlSeq: string,
): WalletCall => ({
  receiverId: contract,
  methodName: "appoint_operator_guarded",
  args: { account: operator, caps, expected_control_seq: expectedControlSeq },
  gas: GAS.call,
  deposit: "1",
});

/** Job 003wf4: a plan's immutable terms, exactly as create_plan_guarded takes them (lib.rs PlanInput). */
export interface PlanInputV3 {
  unit_price: string;
  max_units_per_purchase: number;
  max_units_outstanding: number;
  max_hold_units: number;
  hold_ttl_ms: string;
  settle_grace_ms: string;
}

/** Job 003wf4: the guarded plan creation, attaching exactly the measured quote. */
export const createPlanCall = (
  contract: string,
  input: PlanInputV3,
  expectedControlSeq: string,
  expectedPlanId: number,
  deposit: string,
): WalletCall => ({
  receiverId: contract,
  methodName: "create_plan_guarded",
  args: { input, expected_control_seq: expectedControlSeq, expected_plan_id: expectedPlanId },
  gas: GAS.call,
  deposit,
});

/** lib.rs PlanTermsView: the guarded plan-creation terms and the measured quote (job 003wf4). */
export interface PlanTermsV3 {
  version: number;
  guarded: boolean;
  next_plan_id: number;
  plan_count: number;
  max_plans: number;
  plan_bytes: string;
  storage_byte_cost: string;
  control_seq: string;
  generation: number;
  live_deal: boolean;
  rules: {
    rules: {
      min_reserve: string;
      max_hold_units: number;
      max_hold_ttl_ms: string;
      max_settle_grace_ms: string;
    };
    min_hold_ttl_ms: string;
    max_hold_ttl_ms: string;
    max_settle_grace_ms: string;
    payout_slots: number;
    max_party_pending_total: number;
    max_party_pending_each: number;
    max_customer_pending: number;
  };
}

const DECIMAL = /^(0|[1-9][0-9]{0,38})$/;
const keysExactly = (o: unknown, keys: string[]): o is Record<string, unknown> =>
  typeof o === "object" &&
  o !== null &&
  !Array.isArray(o) &&
  Object.keys(o).length === keys.length &&
  keys.every((k) => k in o);
const int = (v: unknown, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const dec = (v: unknown, bits: 64 | 128) =>
  typeof v === "string" && DECIMAL.test(v) && BigInt(v) < 1n << BigInt(bits);

/** The plan terms view, strictly (every field, its type and range); null if it isn't one. */
export function decodePlanTerms(v: unknown): PlanTermsV3 | null {
  if (
    !keysExactly(v, [
      "version",
      "guarded",
      "next_plan_id",
      "plan_count",
      "max_plans",
      "plan_bytes",
      "storage_byte_cost",
      "control_seq",
      "generation",
      "live_deal",
      "rules",
    ])
  )
    return null;
  const r = v.rules;
  if (
    !keysExactly(r, [
      "rules",
      "min_hold_ttl_ms",
      "max_hold_ttl_ms",
      "max_settle_grace_ms",
      "payout_slots",
      "max_party_pending_total",
      "max_party_pending_each",
      "max_customer_pending",
    ]) ||
    !keysExactly(r.rules, [
      "min_reserve",
      "max_hold_units",
      "max_hold_ttl_ms",
      "max_settle_grace_ms",
    ])
  )
    return null;
  const rr = r.rules as Record<string, unknown>;
  const ok =
    v.version === 1 &&
    v.guarded === true &&
    int(v.next_plan_id, 0xffff_ffff) &&
    int(v.plan_count, 0xffff_ffff) &&
    int(v.max_plans, 0xffff_ffff) &&
    v.next_plan_id === (v.plan_count as number) + 1 &&
    dec(v.plan_bytes, 64) &&
    dec(v.storage_byte_cost, 128) &&
    dec(v.control_seq, 64) &&
    int(v.generation, 0xffff_ffff) &&
    typeof v.live_deal === "boolean" &&
    dec(rr.min_reserve, 128) &&
    int(rr.max_hold_units, 0xff) &&
    dec(rr.max_hold_ttl_ms, 64) &&
    dec(rr.max_settle_grace_ms, 64) &&
    dec(r.min_hold_ttl_ms, 64) &&
    dec(r.max_hold_ttl_ms, 64) &&
    dec(r.max_settle_grace_ms, 64) &&
    int(r.payout_slots, 0xff) &&
    int(r.max_party_pending_total, 0xff) &&
    int(r.max_party_pending_each, 0xffff) &&
    int(r.max_customer_pending, 0xff);
  return ok ? (v as unknown as PlanTermsV3) : null;
}

/** A token amount from base units and validated decimals, e.g. ("250000000", 6) → "250". */
export function readableAmount(base: string, decimals: number): string {
  const v = BigInt(base);
  if (decimals === 0) return v.toString();
  const scale = 10n ** BigInt(decimals);
  const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${v / scale}.${frac}` : (v / scale).toString();
}

export const registerCall = (asset: string, account: string, deposit: string): WalletCall => ({
  receiverId: asset,
  methodName: "storage_deposit",
  args: { account_id: account, registration_only: true },
  gas: GAS.call,
  deposit,
});

// ---------- kinds and exclusivity ----------

export type SaleKind =
  | "propose"
  | "revise"
  | "fund"
  | "accept"
  | "unfund"
  | "cancel"
  | "expire"
  | "claim"
  | "appoint"
  | "register"
  | "abort"
  | "create_plan";
/** Job 003wf3: a party ends a Gated closing whose deadline passed (anyone may, on chain). */
export const abortCall = (contract: string, dealSeq: string): WalletCall => ({
  receiverId: contract,
  methodName: "abort_close",
  args: { deal_seq: dealSeq },
  gas: GAS.call,
  deposit: "0",
});

export const SALE_KINDS: SaleKind[] = [
  "propose",
  "revise",
  "fund",
  "accept",
  "unfund",
  "cancel",
  "expire",
  "claim",
  "appoint",
  "register",
  "abort",
  "create_plan",
];

/**
 * The identity at most one action can take effect under (DIRECT_SALE.md §5): control-guarded
 * calls share their reviewed control sequence; an acceptance its party, deal and version; a claim
 * its category and payout sequence; a registration its token and account.
 */
export function exclusivity(kind: SaleKind, call: WalletCall, actor: string): string {
  const a = call.args as Record<string, unknown>;
  switch (kind) {
    case "propose":
    case "revise":
    case "unfund":
    case "cancel":
    case "expire":
    case "appoint":
    case "create_plan":
      return `control:${String(a.expected_control_seq)}`;
    case "fund": {
      const m = JSON.parse(String(a.msg)) as { fund_deal: { expected_control_seq: string } };
      return `control:${m.fund_deal.expected_control_seq}`;
    }
    case "accept":
      return `accept:${String(a.deal_seq)}:${String(a.version)}:${actor}`;
    case "claim":
      return `claim:${String(a.category)}:${String(a.expected_payout_seq)}`;
    case "register":
      return `register:${call.receiverId}:${String(a.account_id)}`;
    case "abort":
      return `abort:${String(a.deal_seq)}`;
  }
}

/** Offer bounds at a block timestamp (ms, decimal): [now + 1 minute, now + 30 days]. */
export function offerWindow(blockMs: string) {
  const now = BigInt(blockMs);
  return { earliest: now + MIN_OFFER_MS, latest: now + MAX_OFFER_MS };
}
