// Job 003wf2 (docs/design/DIRECT_SALE.md §6): the sale half of ONE synthetic state model with the
// customer chain double (customer-world.ts FixtureChain). A TEST DOUBLE of business-v3's sale,
// party records, payout slots, outcome ring and treasury buckets, applying the actual encoded
// calls a wallet sends (receiver, method, JSON args, deposit, signer) by lib.rs's rules, in its
// order, every check before any change. Views are answered in the contract's own JSON (field
// order included) and each transaction's FINAL outcome carries its receipt graph and logs.
//
// Anchored by server/test/sale-chain.test.ts, which replays the contract's own scripted history
// (fixtures/v3/direct-sale.json): the same calls must give byte-identical views, the same refusal
// codes, values and logs. The customer double's purchases, holds, settlements and releases move
// the same buckets (FixtureChain calls `customer*`). Not modelled: gas, NEAR balances and refunds,
// the monthly books, and receipt timing (each transaction lands at once).

import { createHash } from "node:crypto";
import { type DigestInput, dealDigest } from "../src/saleTerms.ts";

// biome-ignore lint/suspicious/noExplicitAny: decoded contract JSON, read field by field
type Json = Record<string, any>;

export const PARTY_BASE_BYTES = 176n;
const MAX_GRANTS = 4;
const MAX_OPERATORS = 8;
const PAYOUT_SLOTS = 16;
const OUTCOME_RING = 8;
const MIN_OFFER_MS = 60_000n;
const MAX_OFFER_MS = 30n * 86_400_000n;
const MAX_PARTY_PENDING_EACH = 2;
const MAX_PARTY_PENDING_TOTAL = 4;
const METERING = 1;
const SUPPORT = 2;
const U128_MAX = (1n << 128n) - 1n;
const KINDS = [
  "refund",
  "customer_claim",
  "party_claim",
  "profit",
  "escrow_return",
  "sale_proceeds",
];
const KIND = {
  refund: 0,
  customer_claim: 1,
  party_claim: 2,
  profit: 3,
  escrow_return: 4,
  sale_proceeds: 5,
};
const STATES = ["proposed", "accepting", "closing"] as const;
const OUTCOMES = ["none", "closed", "cancelled", "expired", "aborted"];
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** A contract refusal: the receipt fails with this message and nothing changes. */
export class Refusal extends Error {}

// ---------- the supported envelopes (Astra's DirectSaleRecoveryAddendum) ----------

const CANON = /^(0|[1-9][0-9]*)$/;
/** A canonical U64/U128 decimal string, as the contract's JSON takes it (never coerced). */
export const isUint = (v: unknown, bits: 64 | 128) =>
  typeof v === "string" && CANON.test(v) && v.length <= 39 && BigInt(v) < 1n << BigInt(bits);
const isSmall = (v: unknown, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const isAccount = (v: unknown) =>
  typeof v === "string" && v.length >= 2 && v.length <= 64 && ACCOUNT.test(v);
const isHex = (v: unknown) => typeof v === "string";
const exactly = (o: unknown, keys: string[], optional: string[] = []): o is Json =>
  typeof o === "object" &&
  o !== null &&
  !Array.isArray(o) &&
  keys.every((k) => k in o) &&
  Object.keys(o).every((k) => keys.includes(k) || optional.includes(k));
const TERMS_KEYS = [
  "buyer",
  "price",
  "expires_at_ms",
  "close_window_ms",
  "available_floor",
  "grants",
  "terms_hash",
];
const validTermsArg = (t: unknown) =>
  exactly(t, TERMS_KEYS) &&
  isAccount(t.buyer) &&
  isUint(t.price, 128) &&
  isUint(t.expires_at_ms, 64) &&
  isUint(t.close_window_ms, 64) &&
  isUint(t.available_floor, 128) &&
  Array.isArray(t.grants) &&
  t.grants.every(
    (g: unknown) => Array.isArray(g) && g.length === 2 && isAccount(g[0]) && isSmall(g[1], 0xff),
  ) &&
  isHex(t.terms_hash);
/** Each business method's arguments, exactly (JSON as the contract deserializes them). */
const BUSINESS_ARGS: Record<string, (a: Json) => boolean> = {
  propose_sale_guarded: (a) =>
    exactly(a, ["terms", "expected_control_seq", "digest"]) &&
    validTermsArg(a.terms) &&
    isUint(a.expected_control_seq, 64) &&
    isHex(a.digest),
  revise_sale_guarded: (a) =>
    exactly(a, ["deal_seq", "expected_control_seq", "terms", "digest"]) &&
    isUint(a.deal_seq, 64) &&
    isUint(a.expected_control_seq, 64) &&
    validTermsArg(a.terms) &&
    isHex(a.digest),
  accept_sale: (a) =>
    exactly(a, ["deal_seq", "version", "digest"]) &&
    isUint(a.deal_seq, 64) &&
    isSmall(a.version, 0xffff_ffff) &&
    isHex(a.digest),
  unfund_deal_guarded: (a) =>
    exactly(a, ["deal_seq", "expected_control_seq"]) &&
    isUint(a.deal_seq, 64) &&
    isUint(a.expected_control_seq, 64),
  cancel_sale_guarded: (a) => BUSINESS_ARGS.unfund_deal_guarded?.(a) === true,
  expire_sale_guarded: (a) => BUSINESS_ARGS.unfund_deal_guarded?.(a) === true,
  appoint_operator_guarded: (a) =>
    exactly(a, ["account", "caps", "expected_control_seq"]) &&
    isAccount(a.account) &&
    isSmall(a.caps, 0xff) &&
    isUint(a.expected_control_seq, 64),
  claim_party_guarded: (a) =>
    exactly(a, ["category", "expected_amount", "expected_payout_seq"]) &&
    isSmall(a.category, 0xff) &&
    isUint(a.expected_amount, 128) &&
    isUint(a.expected_payout_seq, 64),
};
const MIN_GAS = 1_000_000_000_000n;
const MAX_GAS = 300_000_000_000_000n;

/**
 * Why an envelope isn't one this double supports, or null. Checked before ANY change: a canonical
 * deposit and gas in range, a supported receiver/method, exactly the method's JSON arguments.
 */
export function envelopeProblem(
  call: { receiverId: string; methodName: string; args: unknown; deposit: unknown; gas: unknown },
  business: string,
  asset: string,
): string | null {
  if (call.receiverId !== business && call.receiverId !== asset) return "not a sale-path call";
  if (!isUint(call.deposit, 128)) return "Invalid deposit: not a canonical yoctoNEAR amount";
  if (
    !isUint(call.gas, 64) ||
    BigInt(call.gas as string) < MIN_GAS ||
    BigInt(call.gas as string) > MAX_GAS
  )
    return "Invalid gas: outside 1 to 300 Tgas";
  if (typeof call.args !== "object" || call.args === null || Array.isArray(call.args))
    return "Failed to deserialize input from JSON.";
  const a = call.args as Json;
  if (call.receiverId === business) {
    const check = BUSINESS_ARGS[call.methodName];
    if (!check) return `MethodNotFound: ${call.methodName}`;
    return check(a) ? null : "Failed to deserialize input from JSON.";
  }
  if (call.receiverId === asset) {
    if (call.methodName !== "ft_transfer_call") return `MethodNotFound: ${call.methodName}`;
    if (!exactly(a, ["receiver_id", "amount", "msg"], ["memo"]) || !isAccount(a.receiver_id))
      return "Failed to deserialize input from JSON.";
    if (!isUint(a.amount, 128) || a.amount === "0") return "The amount should be a positive number";
    if (typeof a.msg !== "string") return "Failed to deserialize input from JSON.";
    return null;
  }
  return "not a sale-path call";
}

/** A fund_deal message's fields, as lib.rs's FundDeal deserializes them; null if it wouldn't. */
function fundDealOf(msg: string): Json | null {
  let m: unknown;
  try {
    m = JSON.parse(msg);
  } catch {
    return null;
  }
  if (!exactly(m, ["fund_deal"])) return null;
  const f = m.fund_deal;
  if (
    !exactly(f, ["deal_seq", "version", "price"], ["expected_control_seq"]) ||
    !isUint(f.deal_seq, 64) ||
    !isSmall(f.version, 0xffff_ffff) ||
    !isUint(f.price, 128) ||
    !(
      f.expected_control_seq === undefined ||
      f.expected_control_seq === null ||
      isUint(f.expected_control_seq, 64)
    )
  )
    return null;
  return f;
}
const refuse = (m: string): never => {
  throw new Refusal(m);
};
const need = (ok: boolean, m: string) => {
  if (!ok) refuse(m);
};

const event = (name: string, data: Json) =>
  `EVENT_JSON:${JSON.stringify({ standard: "business_core", version: "3.0.0", event: name, data: [data] })}`;

interface Grant {
  account: string;
  caps: number;
}
interface Deal {
  state: 0 | 1 | 2;
  seq: bigint;
  version: number;
  seller: string;
  buyer: string;
  price: bigint;
  expires_at_ms: bigint;
  close_window_ms: bigint;
  available_floor: bigint;
  grants: Grant[];
  terms_hash: string;
  expected_generation: number;
  manifest: string;
  manifest_seq: bigint;
  plan_count: number;
  seller_accepted: boolean;
  buyer_accepted: boolean;
  escrow: bigint;
  escrow_owner: string | null;
  closing_started_ms: bigint;
  deadline_ms: bigint;
  closing_control_seq: bigint;
}
interface Outcome {
  status: number;
  seq: bigint;
  version: number;
  digest: string;
  generation_after: number;
  control_seq: bigint;
  at_ms: bigint;
  seller: string;
  buyer: string;
  price: bigint;
  escrow_returned: bigint;
}
interface Party {
  claims: [bigint, bigint, bigint];
  pending_refs: number;
  payer: string;
  deposit: bigint;
}
interface Slot {
  state: "in_flight" | "stranded";
  kind: number;
  amount: bigint;
  started_at_ms: bigint;
  to: string;
  plan_id: number;
  payout_id: bigint;
}

/** What a sale double starts from (the contract's own views, or a coherent derived state). */
export interface SaleStart {
  business: string;
  asset: string;
  now_ms: bigint;
  storage_byte_cost: bigint;
  min_reserve: bigint;
  plan_count: number;
  payout_seq: bigint;
  deal_seq: bigint;
  control: Json;
  treasury: Json;
  pending: Json[];
  outcomes: Json[];
  parties: Record<string, Json | null>;
}

export class SaleChain {
  business: string;
  asset: string;
  now: bigint;
  readonly byteCost: bigint;
  readonly minReserve: bigint;
  owner: string;
  generation: number;
  controlSeq: bigint;
  closeMode: "direct" | "gated";
  closer: string | null;
  manifest: string;
  manifestSeq: bigint;
  operators: ({ account: string; caps: number; generation: number } | null)[];
  planCount: number;
  dealSeq: bigint;
  deal: Deal | null = null;
  outcomes: (Outcome | null)[];
  held: bigint;
  entFree: bigint;
  entHeld: bigint;
  available: bigint;
  pendingTotal: bigint;
  claimsTotal: bigint;
  escrowTotal: bigint;
  party = new Map<string, Party>();
  slots: (Slot | null)[];
  payoutSeq: bigint;
  /** The token ledger (shared with the customer double): balances and NEP-145 registrations. */
  balances: Map<string, bigint>;
  registered: Set<string>;
  /** Synthetic faults: the next payout transfers fail (a harness control). */
  failPayouts = 0;
  /** False: answers like an older contract without the sale capability (no get_sale_terms). */
  saleTerms = true;
  calls = 0;
  readonly ceiling = 2_000;

  constructor(
    s: SaleStart,
    token: { balances: Map<string, bigint>; registered: Set<string> } = {
      balances: new Map(),
      registered: new Set(),
    },
  ) {
    this.business = s.business;
    this.asset = s.asset;
    this.now = s.now_ms;
    this.byteCost = s.storage_byte_cost;
    this.minReserve = s.min_reserve;
    const c = s.control;
    this.owner = c.owner;
    this.generation = c.generation;
    this.controlSeq = BigInt(c.control_seq);
    this.closeMode = c.close_mode;
    this.closer = c.closer;
    this.manifest = c.service_manifest;
    this.manifestSeq = BigInt(c.manifest_seq);
    this.operators = Array(MAX_OPERATORS).fill(null);
    (c.operators as [string, number, number][]).forEach(([account, caps, generation], i) => {
      this.operators[i] = { account, caps, generation };
    });
    if (c.live_deal) throw new Error("a sale double starts with no live deal");
    this.planCount = s.plan_count;
    this.dealSeq = s.deal_seq;
    this.outcomes = Array(OUTCOME_RING).fill(null);
    for (const o of s.outcomes)
      this.outcomes[Number(BigInt(o.seq) % 8n)] = {
        status: OUTCOMES.indexOf(o.status),
        seq: BigInt(o.seq),
        version: o.version,
        digest: o.digest,
        generation_after: o.generation_after,
        control_seq: BigInt(o.control_seq),
        at_ms: BigInt(o.at_ms),
        seller: o.seller,
        buyer: o.buyer,
        price: BigInt(o.price),
        escrow_returned: BigInt(o.escrow_returned),
      };
    const t = s.treasury;
    this.held = BigInt(t.held);
    this.entFree = BigInt(t.ent_free_value);
    this.entHeld = BigInt(t.ent_held_value);
    this.available = BigInt(t.available);
    this.pendingTotal = BigInt(t.pending_total);
    this.claimsTotal = BigInt(t.claims_total);
    this.escrowTotal = BigInt(t.escrow_total);
    for (const [a, p] of Object.entries(s.parties))
      if (p)
        this.party.set(a, {
          claims: [
            BigInt(p.profit_claim),
            BigInt(p.escrow_return_claim),
            BigInt(p.sale_proceeds_claim),
          ],
          pending_refs: p.pending_refs,
          payer: p.payer,
          deposit: BigInt(p.deposit),
        });
    this.slots = Array(PAYOUT_SLOTS).fill(null);
    for (const p of s.pending)
      this.slots[p.slot] = {
        state: p.state,
        kind: KINDS.indexOf(p.kind),
        amount: BigInt(p.amount),
        started_at_ms: BigInt(p.started_at_ms),
        to: p.to,
        plan_id: p.plan_id,
        payout_id: BigInt(p.payout_id),
      };
    this.payoutSeq = s.payout_seq;
    this.balances = token.balances;
    this.registered = token.registered;
    this.check();
  }

  private bump() {
    if (++this.calls > this.ceiling) throw new Error("sale chain ceiling reached");
  }

  /**
   * An independent copy of this state (the token ledger included), so a view pinned to an older
   * block answers THAT state (lifecycleWorld.ts snapshots), never the current one under an old label.
   */
  fork(): SaleChain {
    const copy = Object.create(SaleChain.prototype) as SaleChain;
    Object.assign(copy, structuredClone({ ...this }));
    return copy;
  }

  // ---------- views (the contract's JSON, field order included) ----------

  private digestOf(d: Deal): string {
    const input: DigestInput = {
      business: this.business,
      seq: String(d.seq),
      version: d.version,
      seller: d.seller,
      buyer: d.buyer,
      asset: this.asset,
      price: String(d.price),
      expires_at_ms: String(d.expires_at_ms),
      close_window_ms: String(d.close_window_ms),
      available_floor: String(d.available_floor),
      grants: d.grants,
      terms_hash: d.terms_hash,
      expected_generation: d.expected_generation,
      manifest: d.manifest,
      manifest_seq: String(d.manifest_seq),
      plan_count: d.plan_count,
      min_reserve: String(this.minReserve),
      close_mode: this.closeMode,
      closer: this.closer,
    };
    return dealDigest(input);
  }

  controlView(): Json {
    const d = this.deal;
    return {
      owner: this.owner,
      generation: this.generation,
      control_seq: String(this.controlSeq),
      close_mode: this.closeMode,
      closer: this.closeMode === "gated" ? this.closer : null,
      service_manifest: this.manifest,
      manifest_seq: String(this.manifestSeq),
      operators: this.operators
        .filter((o): o is NonNullable<typeof o> => o !== null)
        .map((o) => [o.account, o.caps, o.generation]),
      live_deal: d
        ? {
            seq: String(d.seq),
            version: d.version,
            state: STATES[d.state],
            digest: this.digestOf(d),
            seller: d.seller,
            buyer: d.buyer,
            price: String(d.price),
            available_floor: String(d.available_floor),
            expires_at_ms: String(d.expires_at_ms),
            close_window_ms: String(d.close_window_ms),
            grants: d.grants.map((g) => ({ account: g.account, caps: g.caps })),
            terms_hash: d.terms_hash,
            expected_generation: d.expected_generation,
            seller_accepted: d.seller_accepted,
            buyer_accepted: d.buyer_accepted,
            escrow: String(d.escrow),
            deadline_ms: String(d.deadline_ms),
            closing_started_ms: String(d.closing_started_ms),
            closing_control_seq: String(d.closing_control_seq),
          }
        : null,
    };
  }

  treasuryView(): Json {
    const withdrawable = this.available > this.minReserve ? this.available - this.minReserve : 0n;
    return {
      asset: this.asset,
      held: String(this.held),
      ent_free_value: String(this.entFree),
      ent_held_value: String(this.entHeld),
      available: String(this.available),
      withdrawable: String(withdrawable),
      pending_total: String(this.pendingTotal),
      claims_total: String(this.claimsTotal),
      escrow_total: String(this.escrowTotal),
    };
  }

  outcomesView(): Json[] {
    return this.outcomes
      .filter((o): o is Outcome => o !== null && o.status !== 0)
      .sort((a, b) => (a.seq < b.seq ? 1 : -1))
      .map((o) => ({
        status: OUTCOMES[o.status],
        seq: String(o.seq),
        version: o.version,
        digest: o.digest,
        generation_after: o.generation_after,
        control_seq: String(o.control_seq),
        at_ms: String(o.at_ms),
        seller: o.seller,
        buyer: o.buyer,
        price: String(o.price),
        escrow_returned: String(o.escrow_returned),
      }));
  }

  pendingView(): Json[] {
    const out: Json[] = [];
    this.slots.forEach((s, i) => {
      if (!s) return;
      out.push({
        slot: i,
        state: s.state,
        kind: KINDS[s.kind],
        amount: String(s.amount),
        to: s.to,
        plan_id: s.plan_id,
        payout_id: String(s.payout_id),
        started_at_ms: String(s.started_at_ms),
      });
    });
    return out;
  }

  private pinned(a: string) {
    const d = this.deal;
    return (
      d !== null && (d.seller === a || d.buyer === a || (d.escrow > 0n && d.escrow_owner === a))
    );
  }

  partyView(a: string): Json | null {
    const r = this.party.get(a);
    if (!r) return null;
    return {
      profit_claim: String(r.claims[0]),
      escrow_return_claim: String(r.claims[1]),
      sale_proceeds_claim: String(r.claims[2]),
      pending_refs: r.pending_refs,
      payer: r.payer,
      deposit: String(r.deposit),
      pinned: this.pinned(a),
    };
  }

  saleTermsView(buyer: string): Json {
    const exists = this.party.has(buyer);
    return {
      version: 1,
      guarded: true,
      next_deal_seq: String(this.dealSeq + 1n),
      plan_count: this.planCount,
      min_reserve: String(this.minReserve),
      party_exists: exists,
      party_bytes: String(exists ? 0n : PARTY_BASE_BYTES + BigInt(Buffer.byteLength(buyer))),
      storage_byte_cost: String(this.byteCost),
      payout_seq: String(this.payoutSeq),
    };
  }

  /** A business view by method name (the sale's part), or undefined if it isn't one. */
  view(method: string, args: Json): string | undefined {
    this.bump();
    if (method === "get_control") return JSON.stringify(this.controlView());
    if (method === "get_treasury") return JSON.stringify(this.treasuryView());
    if (method === "get_outcomes") return JSON.stringify(this.outcomesView());
    if (method === "get_pending") return JSON.stringify(this.pendingView());
    if (method === "get_party") return JSON.stringify(this.partyView(String(args.account)));
    if (method === "get_sale_terms") {
      if (!this.saleTerms) throw new Error("MethodNotFound: get_sale_terms");
      return JSON.stringify(this.saleTermsView(String(args.buyer)));
    }
    return undefined;
  }

  /** The owner, or a current-generation METERING operator (lib.rs require_metering). */
  meters(signer: string) {
    if (signer === this.owner) return true;
    return this.operators.some(
      (o) =>
        o !== null &&
        o.account === signer &&
        (o.caps & METERING) !== 0 &&
        o.generation === this.generation,
    );
  }

  // ---------- the customer double's bookings (lib.rs, the same buckets) ----------

  /** A purchase accepted: units x price into held and free value. */
  customerBought(amount: bigint) {
    this.held += amount;
    this.entFree += amount;
    this.check();
  }
  /** A hold opened: value moves from free to held. */
  customerHeld(value: bigint) {
    this.entFree -= value;
    this.entHeld += value;
    this.check();
  }
  /** Uses charged: their value moves from held to available (earned). */
  customerCharged(value: bigint) {
    this.entHeld -= value;
    this.available += value;
    this.check();
  }
  /** A hold closed: its uncharged value goes back to free. */
  customerReleased(value: bigint) {
    this.entHeld -= value;
    this.entFree += value;
    this.check();
  }

  // ---------- helpers, in lib.rs's order ----------

  private nextControl() {
    return this.controlSeq + 1n;
  }
  private requireOwner(who: string) {
    need(who === this.owner, "E_NOT_OWNER: only the current owner");
  }
  private requireNoDeal() {
    need(this.deal === null, "E_DEAL_PENDING: not while a sale is in progress");
  }
  private requireReviewed(expected: bigint | null) {
    if (expected !== null)
      need(
        expected === this.controlSeq,
        "E_REVIEWED: the sale changed since you reviewed it; review it again",
      );
  }
  private liveDeal(seq: bigint): Deal {
    const d = this.deal;
    if (!d || d.seq !== seq) return refuse("E_NO_DEAL: no live deal with that number");
    return d;
  }
  private oneYocto(deposit: bigint) {
    need(deposit === 1n, "E_DEPOSIT: attach exactly 1 yoctoNEAR");
  }
  private check() {
    const sum =
      this.entFree +
      this.entHeld +
      this.available +
      this.pendingTotal +
      this.claimsTotal +
      this.escrowTotal;
    if (sum !== this.held) throw new Error("I1′: buckets do not add up to what the business holds");
    if (this.escrowTotal !== (this.deal ? this.deal.escrow : 0n))
      throw new Error("D1: escrow total");
  }

  private validateTerms(seller: string, t: Json) {
    const buyer = String(t.buyer);
    need(
      ACCOUNT.test(buyer) && buyer.length >= 2 && buyer.length <= 64,
      "E_ARGS: the buyer is not an account id",
    );
    need(
      buyer !== seller && buyer !== this.business && buyer !== this.asset && buyer !== this.closer,
      "E_ARGS: the buyer must be another account (not the owner, the business, its token or the closer)",
    );
    const price = BigInt(String(t.price));
    need(price > 0n && price <= U128_MAX, "E_ARGS: the price must be above 0");
    const expires = BigInt(String(t.expires_at_ms));
    need(
      expires >= this.now + MIN_OFFER_MS && expires <= this.now + MAX_OFFER_MS,
      "E_ARGS: the offer must stay open between a minute and 30 days",
    );
    const window = BigInt(String(t.close_window_ms));
    if (this.closeMode === "direct")
      need(window === 0n, "E_ARGS: a direct close has no close window");
    else
      need(
        window >= 600_000n && window <= 86_400_000n,
        "E_ARGS: the close window must be 10 minutes to 24 hours",
      );
    const raw = t.grants as [string, number][];
    need(Array.isArray(raw) && raw.length <= MAX_GRANTS, "E_ARGS: at most 4 operator grants");
    const grants: Grant[] = [];
    raw.forEach(([account, caps], i) => {
      need(
        caps !== 0 && (caps & ~(METERING | SUPPORT)) === 0,
        "E_ARGS: capabilities are METERING (1) and SUPPORT (2)",
      );
      need(
        raw.slice(0, i).every(([b]) => b !== account),
        "E_ARGS: each grant names a different account",
      );
      grants.push({ account, caps });
    });
    if (this.closeMode === "gated")
      need(
        grants.some((g) => (g.caps & METERING) !== 0),
        "E_ARGS: a gated close needs a successor METERING grant",
      );
    const terms_hash = String(t.terms_hash);
    need(/^[0-9a-fA-F]{64}$/.test(terms_hash), "E_ARGS: the terms hash is 64 hex characters");
    return {
      buyer,
      price,
      expires_at_ms: expires,
      close_window_ms: window,
      available_floor: BigInt(String(t.available_floor)),
      grants,
      terms_hash: terms_hash.toLowerCase(),
    };
  }

  private requireDigest(given: string, d: Deal) {
    need(/^[0-9a-fA-F]{64}$/.test(given), "E_TERMS: the digest is 64 hex characters");
    need(given.toLowerCase() === this.digestOf(d), "E_TERMS: these aren't the terms you reviewed");
  }

  /** ensure_party: kept (1 yoctoNEAR kept) or created at its measured cost, paid by the caller. */
  private ensureParty(account: string, payer: string, deposit: bigint) {
    if (this.party.has(account)) return;
    const cost = (PARTY_BASE_BYTES + BigInt(Buffer.byteLength(account))) * this.byteCost;
    need(
      deposit >= cost,
      `E_STORAGE: attach at least ${cost} yoctoNEAR for ${PARTY_BASE_BYTES + BigInt(Buffer.byteLength(account))} bytes`,
    );
    this.party.set(account, { claims: [0n, 0n, 0n], pending_refs: 0, payer, deposit: cost });
  }

  private credit(account: string, category: number, amount: bigint) {
    const r = this.party.get(account) ?? refuse("E_STATE: a pinned party record is missing");
    r.claims[category] = (r.claims[category] as bigint) + amount;
    this.claimsTotal += amount;
  }

  private recordOutcome(
    d: Deal,
    status: number,
    generationAfter: number,
    control: bigint,
    returned: bigint,
  ) {
    this.outcomes[Number(d.seq % 8n)] = {
      status,
      seq: d.seq,
      version: d.version,
      digest: this.digestOf(d),
      generation_after: generationAfter,
      control_seq: control,
      at_ms: this.now,
      seller: d.seller,
      buyer: d.buyer,
      price: d.price,
      escrow_returned: returned,
    };
  }

  private terminate(d: Deal, status: number, control: bigint): string[] {
    const returned = d.escrow;
    if (returned > 0n) {
      this.credit(d.escrow_owner as string, 1, returned);
      this.escrowTotal -= returned;
    }
    this.recordOutcome(d, status, this.generation, control, returned);
    this.deal = null;
    this.controlSeq = control;
    this.check();
    return [
      event("sale_ended", { deal_seq: String(d.seq), status, escrow_returned: String(returned) }),
    ];
  }

  private finalize(d: Deal, control: bigint, genAfter: number): string[] {
    need(d.escrow === d.price, "E_UNFUNDED: escrow doesn't match the price");
    this.escrowTotal -= d.price;
    this.credit(d.seller, 2, d.price);
    this.owner = d.buyer;
    this.generation = genAfter;
    this.operators = Array(MAX_OPERATORS).fill(null);
    d.grants.forEach((g, i) => {
      this.operators[i] = { account: g.account, caps: g.caps, generation: genAfter };
    });
    this.recordOutcome(d, 1, genAfter, control, 0n);
    this.deal = null;
    this.controlSeq = control;
    this.check();
    return [
      event("sale_finalized", {
        deal_seq: String(d.seq),
        buyer: d.buyer,
        price: String(d.price),
        generation: genAfter,
      }),
    ];
  }

  // ---------- the business's sale methods ----------

  /** One business call by `signer`: its JSON value (undefined: no value) and logs, or a Refusal. */
  businessCall(
    signer: string,
    method: string,
    a: Json,
    deposit: bigint,
  ): { value: unknown; logs: string[]; payout?: { slot: number; id: bigint } } {
    this.bump();
    const seqOf = (k: string) => {
      const v = a[k];
      need(
        typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v),
        `E_ARGS: ${k} is a decimal string`,
      );
      return BigInt(v);
    };
    switch (method) {
      case "propose_sale_guarded": {
        need(deposit >= 1n, "E_DEPOSIT: attach at least 1 yoctoNEAR");
        this.requireOwner(signer);
        this.requireNoDeal();
        this.requireReviewed(seqOf("expected_control_seq"));
        const t = this.validateTerms(signer, a.terms ?? refuse("E_ARGS: terms"));
        const seq = this.dealSeq + 1n;
        const control = this.nextControl();
        const d: Deal = {
          state: 0,
          seq,
          version: 1,
          seller: signer,
          ...t,
          expected_generation: this.generation,
          manifest: this.manifest,
          manifest_seq: this.manifestSeq,
          plan_count: this.planCount,
          seller_accepted: false,
          buyer_accepted: false,
          escrow: 0n,
          escrow_owner: null,
          closing_started_ms: 0n,
          deadline_ms: 0n,
          closing_control_seq: 0n,
        };
        this.requireDigest(String(a.digest), d);
        this.ensureParty(t.buyer, signer, deposit);
        this.deal = d;
        this.dealSeq = seq;
        this.controlSeq = control;
        return {
          value: String(seq),
          logs: [
            event("sale_proposed", {
              deal_seq: String(seq),
              buyer: t.buyer,
              price: String(t.price),
              control_seq: String(control),
            }),
          ],
        };
      }
      case "revise_sale_guarded": {
        need(deposit >= 1n, "E_DEPOSIT: attach at least 1 yoctoNEAR");
        this.requireOwner(signer);
        const d = this.liveDeal(seqOf("deal_seq"));
        this.requireReviewed(seqOf("expected_control_seq"));
        need(d.state !== 2, "E_CLOSING: the sale is closing; terms can't change");
        need(
          d.seller === signer && d.expected_generation === this.generation,
          "E_GENERATION: control changed since this deal was proposed",
        );
        const t = this.validateTerms(signer, a.terms ?? refuse("E_ARGS: terms"));
        const buyerChanges = d.buyer !== t.buyer;
        need(
          !(buyerChanges && d.escrow > 0n),
          "E_FUNDED_BUYER: the buyer can't change while their escrow is held",
        );
        const version = d.version + 1;
        const control = this.nextControl();
        const next: Deal = { ...d, ...t, version };
        this.requireDigest(String(a.digest), next);
        const returned = d.escrow > 0n && t.price !== d.price ? d.escrow : 0n;
        if (returned > 0n && !this.party.has(d.escrow_owner as string))
          refuse("E_STATE: a pinned party record is missing");
        if (buyerChanges) this.ensureParty(t.buyer, signer, deposit);
        if (returned > 0n) {
          this.credit(d.escrow_owner as string, 1, returned);
          this.escrowTotal -= returned;
          next.escrow = 0n;
          next.escrow_owner = null;
        }
        next.state = 0;
        next.seller_accepted = false;
        next.buyer_accepted = false;
        this.deal = next;
        this.controlSeq = control;
        this.check();
        return {
          value: undefined,
          logs: [
            event("sale_revised", {
              deal_seq: String(d.seq),
              version,
              escrow_returned: String(returned),
            }),
          ],
        };
      }
      case "unfund_deal_guarded": {
        this.oneYocto(deposit);
        const d = this.liveDeal(seqOf("deal_seq"));
        this.requireReviewed(seqOf("expected_control_seq"));
        need(d.buyer === signer, "E_NOT_BUYER: only the buyer");
        need(
          d.state !== 2,
          "E_CLOSING: the sale is closing; escrow stays until it closes or is aborted",
        );
        need(d.escrow > 0n, "E_FUNDS: nothing is funded");
        const control = this.nextControl();
        const e = d.escrow;
        this.credit(d.escrow_owner as string, 1, e);
        this.escrowTotal -= e;
        d.escrow = 0n;
        d.escrow_owner = null;
        d.buyer_accepted = false;
        if (!d.seller_accepted) d.state = 0;
        this.controlSeq = control;
        this.check();
        return {
          value: undefined,
          logs: [event("sale_unfunded", { deal_seq: String(d.seq), amount: String(e) })],
        };
      }
      case "accept_sale": {
        this.oneYocto(deposit);
        const d = this.liveDeal(seqOf("deal_seq"));
        need(d.state !== 2, "E_CLOSING: already closing");
        need(a.version === d.version, "E_VERSION: the terms were revised; read them again");
        need(this.now < d.expires_at_ms, "E_EXPIRED: the offer has expired");
        need(
          this.generation === d.expected_generation && this.owner === d.seller,
          "E_GENERATION: control changed since this deal was proposed",
        );
        const isSeller = d.seller === signer;
        const isBuyer = d.buyer === signer;
        need(isSeller || isBuyer, "E_NOT_PARTY: only the seller or the buyer");
        need(
          !(isSeller && d.seller_accepted) && !(isBuyer && d.buyer_accepted),
          "E_ALREADY_ACCEPTED: you have accepted these terms",
        );
        need(
          typeof a.digest === "string" && /^[0-9a-fA-F]{64}$/.test(a.digest),
          "E_TERMS: the digest is 64 hex characters",
        );
        need(
          String(a.digest).toLowerCase() === this.digestOf(d),
          "E_TERMS: these aren't the live terms",
        );
        need(
          this.available >= d.available_floor,
          "E_FLOOR: available money is below the agreed floor",
        );
        if (isBuyer) need(d.escrow === d.price, "E_UNFUNDED: fund the escrow first");
        const control = this.nextControl();
        const both = (d.seller_accepted || isSeller) && (d.buyer_accepted || isBuyer);
        if (both && this.closeMode === "direct")
          return { value: "closed", logs: this.finalize(d, control, this.generation + 1) };
        if (isSeller) d.seller_accepted = true;
        if (isBuyer) d.buyer_accepted = true;
        if (both) {
          d.state = 2;
          d.closing_started_ms = this.now;
          d.deadline_ms = this.now + d.close_window_ms;
          d.closing_control_seq = control;
        } else d.state = 1;
        this.controlSeq = control;
        return {
          value: both ? "closing" : "accepted",
          logs: [
            event("sale_accepted", {
              deal_seq: String(d.seq),
              by: signer,
              closing: both,
              control_seq: String(control),
            }),
          ],
        };
      }
      case "cancel_sale_guarded": {
        this.oneYocto(deposit);
        const d = this.liveDeal(seqOf("deal_seq"));
        this.requireReviewed(seqOf("expected_control_seq"));
        need(
          d.seller === signer || d.buyer === signer,
          "E_NOT_PARTY: only the seller or the buyer",
        );
        need(d.state !== 2, "E_CLOSING: a closing sale ends by its close or its abort");
        return { value: undefined, logs: this.terminate(d, 2, this.nextControl()) };
      }
      case "expire_sale_guarded": {
        // Not payable: the runtime refuses an attached deposit before the method runs.
        need(deposit === 0n, "Method expire_sale_guarded doesn't accept deposit");
        const d = this.liveDeal(seqOf("deal_seq"));
        this.requireReviewed(seqOf("expected_control_seq"));
        need(d.state !== 2, "E_CLOSING: a closing sale ends by its close or its abort");
        need(this.now >= d.expires_at_ms, "E_NOT_EXPIRED: the offer is still open");
        return { value: undefined, logs: this.terminate(d, 3, this.nextControl()) };
      }
      case "appoint_operator_guarded": {
        need(deposit >= 1n, "E_DEPOSIT: attach at least 1 yoctoNEAR");
        this.requireOwner(signer);
        this.requireNoDeal();
        this.requireReviewed(seqOf("expected_control_seq"));
        const caps = a.caps;
        need(
          Number.isInteger(caps) && caps !== 0 && (caps & ~(METERING | SUPPORT)) === 0,
          "E_ARGS: capabilities are METERING (1) and SUPPORT (2)",
        );
        const account = String(a.account);
        const control = this.nextControl();
        let slot = this.operators.findIndex((o) => o !== null && o.account === account);
        if (slot < 0) slot = this.operators.indexOf(null);
        need(slot >= 0, "E_LIMIT: at most 8 operators");
        this.operators[slot] = { account, caps, generation: this.generation };
        this.controlSeq = control;
        return {
          value: undefined,
          logs: [event("operator_appointed", { account, caps, generation: this.generation })],
        };
      }
      case "claim_party_guarded": {
        this.oneYocto(deposit);
        const category = a.category;
        need(
          Number.isInteger(category) && category >= 0 && category < 3,
          "E_ARGS: claim categories are 0, 1 and 2",
        );
        const r = this.party.get(signer) ?? refuse("E_NO_RECORD: no party record");
        const amount = r.claims[category] as bigint;
        need(
          String(amount) === String(a.expected_amount) &&
            String(this.payoutSeq) === String(a.expected_payout_seq),
          "E_REVIEWED: what you are owed changed since you reviewed it; review it again",
        );
        need(amount > 0n, "E_FUNDS: nothing to claim");
        need(
          r.pending_refs < MAX_PARTY_PENDING_EACH,
          "E_PARTY_CAP: 2 of your payouts are already in flight; wait for them to settle",
        );
        const partySlots = this.slots.filter(
          (s) => s && s.kind !== KIND.refund && s.kind !== KIND.customer_claim,
        ).length;
        need(
          partySlots < MAX_PARTY_PENDING_TOTAL,
          "E_PARTY_CAP: 4 owner payouts are already in flight; the other slots are kept for customers",
        );
        const slot = this.slots.indexOf(null);
        need(slot >= 0, "E_BUSY: every payout slot is in use");
        const id = this.payoutSeq + 1n;
        r.claims[category] = 0n;
        r.pending_refs += 1;
        this.claimsTotal -= amount;
        this.payoutSeq = id;
        this.slots[slot] = {
          state: "in_flight",
          kind:
            category === 1
              ? KIND.escrow_return
              : category === 2
                ? KIND.sale_proceeds
                : KIND.party_claim,
          amount,
          started_at_ms: this.now,
          to: signer,
          plan_id: 0,
          payout_id: id,
        };
        this.pendingTotal += amount;
        this.check();
        return {
          value: undefined,
          logs: [
            event("payout_started", {
              slot,
              payout_id: String(id),
              to: signer,
              amount: String(amount),
            }),
          ],
          payout: { slot, id },
        };
      }
      default:
        return refuse(`MethodNotFound: ${method}`);
    }
  }

  /** on_payout (lib.rs): settles the slot once the transfer's outcome is known; never panics. */
  onPayout(slotId: number, payoutId: bigint, ok: boolean): { value: boolean; logs: string[] } {
    const s = this.slots[slotId];
    if (s?.state !== "in_flight" || s.payout_id !== payoutId)
      return {
        value: false,
        logs: [event("payout_mismatch", { slot: slotId, payout_id: String(payoutId) })],
      };
    const r = this.party.get(s.to);
    if (ok) {
      this.held -= s.amount;
      this.pendingTotal -= s.amount;
      if (r) r.pending_refs -= 1;
      this.slots[slotId] = null;
    } else if (r) {
      this.pendingTotal -= s.amount;
      this.claimsTotal += s.amount;
      r.pending_refs -= 1;
      const c = s.kind === KIND.escrow_return ? 1 : s.kind === KIND.sale_proceeds ? 2 : 0;
      r.claims[c] = (r.claims[c] as bigint) + s.amount;
      this.slots[slotId] = null;
    } else s.state = "stranded";
    this.check();
    return {
      value: ok,
      logs: [
        event("payout_settled", {
          slot: slotId,
          payout_id: String(payoutId),
          ok,
          amount: String(s.amount),
        }),
      ],
    };
  }

  /** ft_on_transfer's fund_deal path (lib.rs fund_deal): the unused amount, and its logs. */
  onFund(sender: string, amount: bigint, f: Json): { unused: bigint; logs: string[] } {
    this.bump();
    const d = this.deal;
    const back = (reason: string) => ({
      unused: amount,
      logs: [event("funding_returned", { sender, amount: String(amount), reason })],
    });
    if (!d || String(d.seq) !== String(f.deal_seq)) return back("no live deal with that number");
    if (d.state === 2) return back("the sale is closing");
    if (f.version !== d.version) return back("the terms were revised");
    if (
      f.expected_control_seq !== undefined &&
      f.expected_control_seq !== null &&
      String(f.expected_control_seq) !== String(this.controlSeq)
    )
      return back("the sale changed since this funding was reviewed");
    if (d.buyer !== sender) return back("only the buyer funds the deal");
    if (String(f.price) !== String(d.price) || amount !== d.price)
      return back("the amount is not the price");
    if (d.escrow !== 0n) return back("already funded");
    if (this.now >= d.expires_at_ms) return back("the offer has expired");
    const control = this.nextControl();
    d.escrow = amount;
    d.escrow_owner = d.buyer;
    this.held += amount;
    this.escrowTotal += amount;
    this.controlSeq = control;
    this.check();
    return {
      unused: 0n,
      logs: [event("sale_funded", { deal_seq: String(d.seq), amount: String(amount) })],
    };
  }

  // ---------- one wallet transaction, with its FINAL outcome ----------

  private txCount = 0;
  private hashOf() {
    const b = createHash("sha256")
      .update(`sale-tx-${++this.txCount}-${this.business}`)
      .digest();
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = BigInt(`0x${b.toString("hex")}`);
    let out = "";
    while (n > 0n) {
      out = A[Number(n % 58n)] + out;
      n /= 58n;
    }
    return out;
  }

  /**
   * One wallet transaction from `signer` with ONE FunctionCall: a business sale method, or the
   * token's ft_transfer_call carrying a fund_deal message. Returns its FINAL outcome (the caller
   * records it by hash). A contract refusal is a failed receipt with nothing changed.
   */
  walletCall(
    signer: string,
    call: { receiverId: string; methodName: string; args: Json; deposit: string; gas: string },
  ): Json {
    const hash = this.hashOf();
    const rid = (k: string) => `${hash.slice(0, 10)}-${k}`;
    const b64 = (v: unknown) =>
      Buffer.from(v === undefined ? "" : JSON.stringify(v)).toString("base64");
    const ok = (
      executor: string,
      logs: string[],
      value: string,
      id: string,
      children: string[] = [],
    ) => ({
      id,
      outcome: {
        executor_id: executor,
        logs,
        receipt_ids: children,
        status: { SuccessValue: value },
      },
    });
    const failed = (executor: string, id: string, message: string) => ({
      id,
      outcome: {
        executor_id: executor,
        logs: [],
        receipt_ids: [],
        status: {
          Failure: {
            ActionError: {
              kind: {
                FunctionCallError: { ExecutionError: `Smart contract panicked: ${message}` },
              },
            },
          },
        },
      },
    });
    const receipts: Json[] = [];
    let status: Json;
    const problem = envelopeProblem(call, this.business, this.asset);
    if (problem === "not a sale-path call") throw new Error("not a sale-path call");
    if (problem) {
      // Refused before anything runs: nothing changes, on the token or the business.
      receipts.push(failed(call.receiverId, rid("call"), problem));
      status = (receipts[0] as Json).outcome.status;
    } else if (call.receiverId === this.business) {
      const deposit = BigInt(call.deposit);
      // Snapshot so a refusal changes nothing (a failed receipt rolls back on chain).
      const before = this.snapshot();
      try {
        const r = this.businessCall(signer, call.methodName, call.args, deposit);
        if (r.payout) {
          const transferOk =
            this.failPayouts === 0 && this.registered.has(this.slots[r.payout.slot]?.to as string);
          if (this.failPayouts > 0) this.failPayouts--;
          const amount = this.slots[r.payout.slot]?.amount as bigint;
          const to = this.slots[r.payout.slot]?.to as string;
          if (transferOk) {
            this.balances.set(this.business, (this.balances.get(this.business) ?? 0n) - amount);
            this.balances.set(to, (this.balances.get(to) ?? 0n) + amount);
          }
          const cb = this.onPayout(r.payout.slot, r.payout.id, transferOk);
          // claim_party returns `ft_transfer.then(on_payout)`: its result is the callback's
          // (SuccessReceiptId naming it), as the runtime reports a returned promise.
          receipts.push({
            id: rid("claim"),
            outcome: {
              executor_id: this.business,
              logs: r.logs,
              receipt_ids: [rid("transfer"), rid("callback")],
              status: { SuccessReceiptId: rid("callback") },
            },
          });
          receipts.push(
            transferOk
              ? ok(this.asset, [], "", rid("transfer"))
              : failed(this.asset, rid("transfer"), `The account ${to} is not registered`),
          );
          receipts.push(ok(this.business, cb.logs, b64(cb.value), rid("callback")));
          status = { SuccessValue: b64(cb.value) };
        } else {
          receipts.push(ok(this.business, r.logs, b64(r.value), rid("call")));
          status = { SuccessValue: b64(r.value) };
        }
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        this.restore(before);
        receipts.push(failed(this.business, rid("call"), e.message));
        status = (receipts[0] as Json).outcome.status;
      }
    } else {
      const deposit = BigInt(call.deposit);
      const amount = BigInt(call.args.amount as string);
      const receiver = call.args.receiver_id as string;
      const msg = call.args.msg as string;
      const refusal =
        deposit !== 1n
          ? "Requires attached deposit of exactly 1 yoctoNEAR"
          : receiver !== this.business || !msg.includes("fund_deal")
            ? "The sale double only carries fund_deal transfers to the business"
            : !this.registered.has(signer)
              ? `The account ${signer} is not registered`
              : !this.registered.has(receiver)
                ? `The account ${receiver} is not registered`
                : (this.balances.get(signer) ?? 0n) < amount
                  ? "The account doesn't have enough balance"
                  : null;
      if (refusal) {
        receipts.push(failed(this.asset, rid("call"), refusal));
        status = (receipts[0] as Json).outcome.status;
      } else {
        this.balances.set(signer, (this.balances.get(signer) ?? 0n) - amount);
        this.balances.set(receiver, (this.balances.get(receiver) ?? 0n) + amount);
        const fund = fundDealOf(msg);
        // A message lib.rs can't read as a fund_deal is returned whole ("malformed message").
        const r = fund
          ? this.onFund(signer, amount, fund)
          : {
              unused: amount,
              logs: [
                event("purchase_returned", {
                  customer: signer,
                  amount: String(amount),
                  reason: "malformed message",
                }),
              ],
            };
        if (r.unused > 0n) {
          this.balances.set(receiver, (this.balances.get(receiver) ?? 0n) - r.unused);
          this.balances.set(signer, (this.balances.get(signer) ?? 0n) + r.unused);
        }
        const used = b64(String(amount - r.unused));
        receipts.push({
          id: rid("call"),
          outcome: {
            executor_id: this.asset,
            logs: [],
            receipt_ids: [rid("receiver"), rid("resolution")],
            status: { SuccessReceiptId: rid("resolution") },
          },
        });
        receipts.push(ok(this.business, r.logs, b64(String(r.unused)), rid("receiver")));
        receipts.push(ok(this.asset, [], used, rid("resolution")));
        status = { SuccessValue: used };
      }
    }
    return {
      final_execution_status: "FINAL",
      transaction: {
        hash,
        signer_id: signer,
        receiver_id: call.receiverId,
        actions: [
          {
            FunctionCall: {
              method_name: call.methodName,
              args: Buffer.from(JSON.stringify(call.args)).toString("base64"),
              gas: Number(call.gas),
              deposit: call.deposit,
            },
          },
        ],
      },
      status,
      transaction_outcome: {
        id: hash,
        outcome: {
          executor_id: signer,
          logs: [],
          receipt_ids: [(receipts[0] as Json).id],
          status: { SuccessReceiptId: (receipts[0] as Json).id },
        },
      },
      receipts_outcome: receipts,
    };
  }

  /** A deep copy of the mutable state (a refused receipt restores it). */
  private snapshot() {
    return structuredClone({
      owner: this.owner,
      generation: this.generation,
      controlSeq: this.controlSeq,
      operators: this.operators,
      dealSeq: this.dealSeq,
      deal: this.deal,
      outcomes: this.outcomes,
      t: [
        this.held,
        this.entFree,
        this.entHeld,
        this.available,
        this.pendingTotal,
        this.claimsTotal,
        this.escrowTotal,
      ],
      party: [...this.party.entries()],
      slots: this.slots,
      payoutSeq: this.payoutSeq,
    });
  }
  private restore(s: ReturnType<SaleChain["snapshot"]>) {
    this.owner = s.owner;
    this.generation = s.generation;
    this.controlSeq = s.controlSeq;
    this.operators = s.operators;
    this.dealSeq = s.dealSeq;
    this.deal = s.deal;
    this.outcomes = s.outcomes;
    [
      this.held,
      this.entFree,
      this.entHeld,
      this.available,
      this.pendingTotal,
      this.claimsTotal,
      this.escrowTotal,
    ] = s.t as [bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    this.party = new Map(s.party);
    this.slots = s.slots;
    this.payoutSeq = s.payoutSeq;
  }
}

/** The double's start from the contract fixture's own views (direct-sale.json `start`). */
export function startFromFixture(doc: Json): SaleStart {
  const v = doc.start as Json;
  const st = JSON.parse(v.get_sale_terms[Object.keys(v.get_sale_terms)[0] as string]) as Json;
  return {
    business: doc.business,
    asset: doc.asset,
    now_ms: BigInt(doc.internal.now_ms),
    storage_byte_cost: BigInt(doc.internal.storage_byte_cost),
    min_reserve: BigInt(st.min_reserve),
    plan_count: st.plan_count,
    payout_seq: BigInt(doc.internal.payout_seq),
    deal_seq: BigInt(doc.internal.deal_seq),
    control: JSON.parse(v.get_control),
    treasury: JSON.parse(v.get_treasury),
    pending: JSON.parse(v.get_pending),
    outcomes: JSON.parse(v.get_outcomes),
    parties: Object.fromEntries(
      Object.entries(v.get_party as Record<string, string>).map(([a, p]) => [a, JSON.parse(p)]),
    ),
  };
}
