// Job 003h: a strictly read-only reader for business-v3 (docs/design/V3_OBSERVATIONS.md). It is
// separate from the signing v2 `Chain` on purpose: it holds no keys, creates no accounts and
// broadcasts nothing. Its only dependency is an injected `ViewTransport`, which in development
// and tests is a deterministic in-memory double; this module makes no network calls itself.
//
// Every view of one snapshot is read at one pinned final block, and every answer must name that
// same block. Values are decoded strictly against the contract's actual JSON (the 003g view
// structs). u64/u128 stay decimal strings, compared only with BigInt; never JavaScript numbers.

/** Which contract interface these decoders match. */
export const V3_SCHEMA = "business-v3/003g";

export interface BlockRef {
  /** Decimal string. */
  height: string;
  hash: string;
}

/**
 * Read-only access to a NEAR view interface. It asserts where answers came from (provenance); it
 * is not cryptographic proof. It can't sign, create accounts or broadcast: it has no such methods.
 */
export interface ViewTransport {
  /**
   * The one network this transport reads, if it is fixed (job 003i). A binding for another
   * network is refused before anything is sent. This names the operator's configuration; it is
   * not a verification of which chain the endpoint serves.
   */
  readonly network?: string;
  /** The current final block. `signal` aborts the request when the snapshot's time is up. */
  finalBlock(network: string, signal?: AbortSignal): Promise<BlockRef>;
  /** Calls a view method at exactly `block`; returns the raw result text and the block it ran at. */
  view(input: {
    network: string;
    account: string;
    method: string;
    args: Record<string, unknown>;
    block: BlockRef;
    signal?: AbortSignal;
  }): Promise<{ result: string; block: BlockRef }>;
}

/** An operator-configured binding of one app business to one v3 contract account. */
export interface V3Binding {
  business_id: string;
  network: string;
  account: string;
}

export type ReadFailure =
  | "unavailable"
  | "timeout"
  | "mixed_blocks"
  | "malformed"
  | "unknown_enum"
  | "out_of_range"
  // Job 003i: what an RPC endpoint can say, each kept distinct and truthful.
  | "unsupported"
  | "block_unavailable"
  | "unknown_account"
  | "execution_failed"
  | "rpc_error"
  | "too_large";

/** A refused read. `code` is safe to show; nothing from the transport is carried in it. */
export class V3ReadError extends Error {
  constructor(
    readonly code: ReadFailure,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

// ---------- strict decoding ----------

type Raw = unknown;

const fail = (code: ReadFailure, detail: string): never => {
  throw new V3ReadError(code, detail);
};

function obj(v: Raw, where: string, keys: readonly string[]): Record<string, Raw> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return fail("malformed", `${where} is not an object`);
  const o = v as Record<string, Raw>;
  const have = Object.keys(o);
  for (const k of keys) if (!(k in o)) fail("malformed", `${where}.${k} is missing`);
  for (const k of have)
    if (!keys.includes(k)) fail("malformed", `${where} has an unexpected field`);
  return o;
}

function arr(v: Raw, where: string, max: number): Raw[] {
  if (!Array.isArray(v)) return fail("malformed", `${where} is not a list`);
  if (v.length > max) fail("out_of_range", `${where} has more than ${max} entries`);
  return v;
}

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const DEC = /^(0|[1-9][0-9]*)$/;

/** A u64/u128 sent as a decimal string; returned as the same canonical string. */
function dec(v: Raw, where: string, max: bigint): string {
  if (typeof v !== "string" || !DEC.test(v) || v.length > 39)
    return fail("malformed", `${where} is not a decimal string`);
  if (BigInt(v) > max) fail("out_of_range", `${where} is out of range`);
  return v;
}
const u64 = (v: Raw, w: string) => dec(v, w, U64_MAX);
const u128 = (v: Raw, w: string) => dec(v, w, U128_MAX);

/** A small integer (u8/u16/u32) sent as a JSON number. */
function small(v: Raw, where: string, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    return fail("malformed", `${where} is not a whole number`);
  if (v > max) fail("out_of_range", `${where} is out of range`);
  return v;
}
const u8 = (v: Raw, w: string) => small(v, w, 0xff);
const u32 = (v: Raw, w: string) => small(v, w, 0xffff_ffff);

function bool(v: Raw, where: string): boolean {
  if (typeof v !== "boolean") return fail("malformed", `${where} is not true or false`);
  return v;
}

const HEX32 = /^[0-9a-f]{64}$/;
function hex32(v: Raw, where: string): string {
  if (typeof v !== "string" || !HEX32.test(v))
    return fail("malformed", `${where} is not a 32-byte hex digest`);
  return v;
}

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export function isAccountId(s: string): boolean {
  return s.length >= 2 && s.length <= 64 && ACCOUNT.test(s);
}
function account(v: Raw, where: string): string {
  if (typeof v !== "string" || !isAccountId(v))
    return fail("malformed", `${where} is not an account id`);
  return v;
}

function oneOf<T extends string>(v: Raw, where: string, allowed: readonly T[]): T {
  if (typeof v !== "string") return fail("malformed", `${where} is not text`);
  if (!allowed.includes(v as T)) fail("unknown_enum", `${where} has an unknown value`);
  return v as T;
}

// ---------- decoded views (the contract's own field names) ----------

export interface DealV3 {
  seq: string;
  version: number;
  state: "proposed" | "accepting" | "closing";
  digest: string;
  seller: string;
  buyer: string;
  price: string;
  available_floor: string;
  expires_at_ms: string;
  close_window_ms: string;
  grants: { account: string; caps: number }[];
  terms_hash: string;
  expected_generation: number;
  seller_accepted: boolean;
  buyer_accepted: boolean;
  escrow: string;
  deadline_ms: string;
  closing_started_ms: string;
  closing_control_seq: string;
}

export interface ControlV3 {
  owner: string;
  generation: number;
  control_seq: string;
  close_mode: "direct" | "gated";
  closer: string | null;
  service_manifest: string;
  manifest_seq: string;
  operators: { account: string; caps: number; generation: number }[];
  live_deal: DealV3 | null;
}

export interface OutcomeV3 {
  status: "closed" | "cancelled" | "expired" | "aborted";
  seq: string;
  version: number;
  digest: string;
  generation_after: number;
  control_seq: string;
  at_ms: string;
  seller: string;
  buyer: string;
  price: string;
  escrow_returned: string;
}

export interface TreasuryV3 {
  asset: string;
  held: string;
  ent_free_value: string;
  ent_held_value: string;
  available: string;
  withdrawable: string;
  pending_total: string;
  claims_total: string;
  escrow_total: string;
}

export interface PendingV3 {
  slot: number;
  state: "in_flight" | "stranded";
  kind: "refund" | "customer_claim" | "party_claim" | "profit" | "escrow_return" | "sale_proceeds";
  amount: string;
  to: string;
  plan_id: number;
  payout_id: string;
  started_at_ms: string;
}

export interface CounterV3 {
  amount: string;
  exact: boolean;
}

export interface PeriodV3 {
  yyyymm: number;
  status: "recorded" | "no_activity" | "not_retained" | "invalid";
  period: Record<
    | "purchases_in"
    | "earned"
    | "customer_returns"
    | "owner_withdrawals"
    | "paid_on_retry"
    | "escrow_in"
    | "escrow_returned"
    | "sale_proceeds_paid",
    CounterV3
  > | null;
}

const CAPS = (v: Raw, w: string) => {
  const c = u8(v, w);
  if (c === 0 || (c & ~3) !== 0) fail("out_of_range", `${w} is not a capability set`);
  return c;
};

function decodeDeal(v: Raw): DealV3 {
  const o = obj(v, "live_deal", [
    "seq",
    "version",
    "state",
    "digest",
    "seller",
    "buyer",
    "price",
    "available_floor",
    "expires_at_ms",
    "close_window_ms",
    "grants",
    "terms_hash",
    "expected_generation",
    "seller_accepted",
    "buyer_accepted",
    "escrow",
    "deadline_ms",
    "closing_started_ms",
    "closing_control_seq",
  ]);
  return {
    seq: u64(o.seq, "live_deal.seq"),
    version: u32(o.version, "live_deal.version"),
    state: oneOf(o.state, "live_deal.state", ["proposed", "accepting", "closing"] as const),
    digest: hex32(o.digest, "live_deal.digest"),
    seller: account(o.seller, "live_deal.seller"),
    buyer: account(o.buyer, "live_deal.buyer"),
    price: u128(o.price, "live_deal.price"),
    available_floor: u128(o.available_floor, "live_deal.available_floor"),
    expires_at_ms: u64(o.expires_at_ms, "live_deal.expires_at_ms"),
    close_window_ms: u64(o.close_window_ms, "live_deal.close_window_ms"),
    grants: arr(o.grants, "live_deal.grants", 4).map((g, i) => {
      const x = obj(g, `live_deal.grants[${i}]`, ["account", "caps"]);
      return { account: account(x.account, "grant.account"), caps: CAPS(x.caps, "grant.caps") };
    }),
    terms_hash: hex32(o.terms_hash, "live_deal.terms_hash"),
    expected_generation: u32(o.expected_generation, "live_deal.expected_generation"),
    seller_accepted: bool(o.seller_accepted, "live_deal.seller_accepted"),
    buyer_accepted: bool(o.buyer_accepted, "live_deal.buyer_accepted"),
    escrow: u128(o.escrow, "live_deal.escrow"),
    deadline_ms: u64(o.deadline_ms, "live_deal.deadline_ms"),
    closing_started_ms: u64(o.closing_started_ms, "live_deal.closing_started_ms"),
    closing_control_seq: u64(o.closing_control_seq, "live_deal.closing_control_seq"),
  };
}

export function decodeControl(v: Raw): ControlV3 {
  const o = obj(v, "control", [
    "owner",
    "generation",
    "control_seq",
    "close_mode",
    "closer",
    "service_manifest",
    "manifest_seq",
    "operators",
    "live_deal",
  ]);
  const mode = oneOf(o.close_mode, "close_mode", ["direct", "gated"] as const);
  const closer = o.closer === null ? null : account(o.closer, "closer");
  if ((mode === "gated") !== (closer !== null))
    fail("malformed", "closer doesn't match the close mode");
  return {
    owner: account(o.owner, "owner"),
    generation: u32(o.generation, "generation"),
    control_seq: u64(o.control_seq, "control_seq"),
    close_mode: mode,
    closer,
    service_manifest: hex32(o.service_manifest, "service_manifest"),
    manifest_seq: u64(o.manifest_seq, "manifest_seq"),
    // The contract serializes each operator as a tuple: [account, caps, generation].
    operators: arr(o.operators, "operators", 8).map((t, i) => {
      const x = arr(t, `operators[${i}]`, 3);
      if (x.length !== 3) fail("malformed", `operators[${i}] is not a 3-tuple`);
      return {
        account: account(x[0], "operator.account"),
        caps: CAPS(x[1], "operator.caps"),
        generation: u32(x[2], "operator.generation"),
      };
    }),
    live_deal: o.live_deal === null ? null : decodeDeal(o.live_deal),
  };
}

export function decodeOutcomes(v: Raw): OutcomeV3[] {
  return arr(v, "outcomes", 8).map((e, i) => {
    const o = obj(e, `outcomes[${i}]`, [
      "status",
      "seq",
      "version",
      "digest",
      "generation_after",
      "control_seq",
      "at_ms",
      "seller",
      "buyer",
      "price",
      "escrow_returned",
    ]);
    return {
      status: oneOf(o.status, "outcome.status", [
        "closed",
        "cancelled",
        "expired",
        "aborted",
      ] as const),
      seq: u64(o.seq, "outcome.seq"),
      version: u32(o.version, "outcome.version"),
      digest: hex32(o.digest, "outcome.digest"),
      generation_after: u32(o.generation_after, "outcome.generation_after"),
      control_seq: u64(o.control_seq, "outcome.control_seq"),
      at_ms: u64(o.at_ms, "outcome.at_ms"),
      seller: account(o.seller, "outcome.seller"),
      buyer: account(o.buyer, "outcome.buyer"),
      price: u128(o.price, "outcome.price"),
      escrow_returned: u128(o.escrow_returned, "outcome.escrow_returned"),
    };
  });
}

export function decodeTreasury(v: Raw): TreasuryV3 {
  const o = obj(v, "treasury", [
    "asset",
    "held",
    "ent_free_value",
    "ent_held_value",
    "available",
    "withdrawable",
    "pending_total",
    "claims_total",
    "escrow_total",
  ]);
  const t: TreasuryV3 = {
    asset: account(o.asset, "asset"),
    held: u128(o.held, "held"),
    ent_free_value: u128(o.ent_free_value, "ent_free_value"),
    ent_held_value: u128(o.ent_held_value, "ent_held_value"),
    available: u128(o.available, "available"),
    withdrawable: u128(o.withdrawable, "withdrawable"),
    pending_total: u128(o.pending_total, "pending_total"),
    claims_total: u128(o.claims_total, "claims_total"),
    escrow_total: u128(o.escrow_total, "escrow_total"),
  };
  // The contract's own invariant (I1′): every token held is in exactly one bucket.
  const sum =
    BigInt(t.ent_free_value) +
    BigInt(t.ent_held_value) +
    BigInt(t.available) +
    BigInt(t.pending_total) +
    BigInt(t.claims_total) +
    BigInt(t.escrow_total);
  if (sum !== BigInt(t.held))
    fail("malformed", "the treasury buckets don't add up to what is held");
  if (BigInt(t.withdrawable) > BigInt(t.available))
    fail("malformed", "withdrawable exceeds available");
  return t;
}

export function decodePending(v: Raw): PendingV3[] {
  return arr(v, "pending", 16).map((e, i) => {
    const o = obj(e, `pending[${i}]`, [
      "slot",
      "state",
      "kind",
      "amount",
      "to",
      "plan_id",
      "payout_id",
      "started_at_ms",
    ]);
    const slot = u8(o.slot, "pending.slot");
    if (slot > 15) fail("out_of_range", "pending.slot is out of range");
    return {
      slot,
      state: oneOf(o.state, "pending.state", ["in_flight", "stranded"] as const),
      kind: oneOf(o.kind, "pending.kind", [
        "refund",
        "customer_claim",
        "party_claim",
        "profit",
        "escrow_return",
        "sale_proceeds",
      ] as const),
      amount: u128(o.amount, "pending.amount"),
      to: account(o.to, "pending.to"),
      plan_id: u32(o.plan_id, "pending.plan_id"),
      payout_id: u64(o.payout_id, "pending.payout_id"),
      started_at_ms: u64(o.started_at_ms, "pending.started_at_ms"),
    };
  });
}

const COUNTERS = [
  "purchases_in",
  "earned",
  "customer_returns",
  "owner_withdrawals",
  "paid_on_retry",
  "escrow_in",
  "escrow_returned",
  "sale_proceeds_paid",
] as const;

export function decodePeriod(v: Raw, yyyymm: number): PeriodV3 {
  const o = obj(v, "period", ["yyyymm", "status", "period"]);
  const status = oneOf(o.status, "period.status", [
    "recorded",
    "no_activity",
    "not_retained",
    "invalid",
  ] as const);
  const month = u32(o.yyyymm, "period.yyyymm");
  if (month !== yyyymm) fail("malformed", "the period answer is for another month");
  if ((status === "recorded") !== (o.period !== null))
    fail("malformed", "the period's status doesn't match its body");
  let period: PeriodV3["period"] = null;
  if (o.period !== null) {
    const p = obj(o.period, "period.period", ["yyyymm", ...COUNTERS]);
    if (u32(p.yyyymm, "period.period.yyyymm") !== yyyymm)
      fail("malformed", "the period body is for another month");
    period = Object.fromEntries(
      COUNTERS.map((k) => {
        const c = obj(p[k], `period.${k}`, ["amount", "exact"]);
        return [
          k,
          {
            amount: u128(c.amount, `period.${k}.amount`),
            exact: bool(c.exact, `period.${k}.exact`),
          },
        ];
      }),
    ) as NonNullable<PeriodV3["period"]>;
  }
  return { yyyymm: month, status, period };
}

// ---------- one coherent snapshot ----------

export interface V3Snapshot {
  source: { network: string; account: string; schema: string };
  block: BlockRef;
  /** What the transport claimed; provenance, not a proof. */
  finality: "final";
  control: ControlV3;
  outcomes: OutcomeV3[];
  treasury: TreasuryV3;
  pending: PendingV3[];
  period: PeriodV3 | null;
}

const HEIGHT = /^(0|[1-9][0-9]{0,19})$/;
const BLOCK_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function checkBlock(b: Raw, where: string): BlockRef {
  if (!b || typeof b !== "object") return fail("malformed", `${where} has no block`);
  const { height, hash } = b as Record<string, unknown>;
  if (typeof height !== "string" || !HEIGHT.test(height) || BigInt(height) > U64_MAX)
    return fail("malformed", `${where} has an invalid block height`);
  if (typeof hash !== "string" || !BLOCK_HASH.test(hash))
    return fail("malformed", `${where} has an invalid block hash`);
  return { height, hash };
}

/**
 * Why a newer observation can't follow `prev` (both coherent, `next` at a higher block), or null.
 * Rules and the contract methods behind them: docs/design/V3_OBSERVATIONS.md §4a.
 */
export function transitionProblem(
  prev: Pick<V3Snapshot, "control" | "outcomes" | "treasury">,
  next: Pick<V3Snapshot, "control" | "outcomes" | "treasury">,
): string | null {
  const a = prev.control;
  const b = next.control;
  const seqA = BigInt(a.control_seq);
  const seqB = BigInt(b.control_seq);
  if (seqB < seqA) return "a lower control sequence";
  if (seqB === seqA) {
    // Every change to these two views raises the control sequence.
    if (JSON.stringify(a) !== JSON.stringify(b)) return "control changed without a control step";
    if (JSON.stringify(prev.outcomes) !== JSON.stringify(next.outcomes))
      return "outcomes changed without a control step";
    return null;
  }
  const steps = seqB - seqA;
  // Set only by `new`.
  if (a.close_mode !== b.close_mode || a.closer !== b.closer) return "the close mode changed";
  if (prev.treasury.asset !== next.treasury.asset) return "the asset changed";
  // Only finalize raises the generation (by one, in one step) and changes the owner.
  if (b.generation < a.generation) return "the generation went back";
  if (BigInt(b.generation - a.generation) > steps) return "the generation rose too fast";
  if (b.generation === a.generation && b.owner !== a.owner)
    return "the owner changed within a generation";
  // set_manifest raises both sequences together.
  const mA = BigInt(a.manifest_seq);
  const mB = BigInt(b.manifest_seq);
  if (mB < mA) return "the manifest sequence went back";
  if (mB - mA > steps) return "the manifest sequence rose too fast";
  if (mB === mA && a.service_manifest !== b.service_manifest)
    return "the manifest changed without its sequence";
  // propose_sale is the only place deal numbers rise; its seller and generation stay fixed.
  if (latestDeal(next) < latestDeal(prev)) return "the latest deal number went back";
  if (
    a.live_deal &&
    b.live_deal &&
    a.live_deal.seq === b.live_deal.seq &&
    (a.live_deal.seller !== b.live_deal.seller ||
      a.live_deal.expected_generation !== b.live_deal.expected_generation)
  )
    return "a live deal changed seller or generation";
  return null;
}

function latestDeal(s: Pick<V3Snapshot, "control" | "outcomes">): bigint {
  if (s.control.live_deal) return BigInt(s.control.live_deal.seq);
  return s.outcomes.reduce((x, o) => (BigInt(o.seq) > x ? BigInt(o.seq) : x), 0n);
}

/**
 * Reads one snapshot at one pinned final block. Any failure refuses the whole snapshot; nothing
 * partial is returned. Raw transport text never leaves this function except inside the decoded
 * (validated) values.
 */
export async function readSnapshot(
  transport: ViewTransport,
  binding: V3Binding,
  opts: { period?: number; timeoutMs?: number } = {},
): Promise<V3Snapshot> {
  // Job 003i: one deadline for the whole snapshot. When it passes (or the snapshot fails or
  // finishes) the signal aborts every request still in flight, so a transport that honours it
  // stops its network and body reads instead of carrying on unobserved.
  const timeout = opts.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new V3ReadError("timeout", "the read took too long")),
    timeout,
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
    return await readPinned(transport, binding, opts.period, call);
  } finally {
    clearTimeout(timer);
    controller.abort(new V3ReadError("unavailable", "the snapshot is over"));
  }
}

async function readPinned(
  transport: ViewTransport,
  binding: V3Binding,
  periodMonth: number | undefined,
  call: <T>(p: (signal: AbortSignal) => Promise<T>) => Promise<T>,
): Promise<V3Snapshot> {
  const opts = { period: periodMonth };
  if (transport.network !== undefined && transport.network !== binding.network)
    fail("unsupported", "the binding names another network than the transport reads");
  const pinned = checkBlock(
    await call((signal) => transport.finalBlock(binding.network, signal)),
    "final block",
  );
  const read = async (method: string, args: Record<string, unknown>) => {
    const answer = await call((signal) =>
      transport.view({
        network: binding.network,
        account: binding.account,
        method,
        args,
        block: pinned,
        signal,
      }),
    );
    const at = checkBlock(answer?.block, method);
    if (at.height !== pinned.height || at.hash !== pinned.hash)
      fail("mixed_blocks", `${method} answered from another block`);
    if (typeof answer.result !== "string" || answer.result.length > 64 * 1024)
      fail("malformed", `${method} returned no bounded text`);
    try {
      return JSON.parse(answer.result) as unknown;
    } catch {
      return fail("malformed", `${method} returned invalid JSON`);
    }
  };
  const [control, outcomes, treasury, pending, period] = await Promise.all([
    read("get_control", {}),
    read("get_outcomes", {}),
    read("get_treasury", {}),
    read("get_pending", {}),
    opts.period === undefined ? Promise.resolve(null) : read("get_period", { yyyymm: opts.period }),
  ]);
  const snapshot: V3Snapshot = {
    source: { network: binding.network, account: binding.account, schema: V3_SCHEMA },
    block: pinned,
    finality: "final",
    control: decodeControl(control),
    outcomes: decodeOutcomes(outcomes),
    treasury: decodeTreasury(treasury),
    pending: decodePending(pending),
    period: opts.period === undefined ? null : decodePeriod(period, opts.period),
  };
  coherent(snapshot);
  return snapshot;
}

/**
 * Views read at one block must agree with each other, as the contract guarantees. Each rule cites
 * the 003g methods that make it hold (docs/design/V3_OBSERVATIONS.md §4a); nothing is guessed.
 */
export function coherent(s: Pick<V3Snapshot, "control" | "outcomes" | "treasury" | "pending">) {
  const c = s.control;
  const d = c.live_deal;
  const escrow = d ? BigInt(d.escrow) : 0n;
  if (BigInt(s.treasury.escrow_total) !== escrow)
    fail("malformed", "escrow differs between the views");
  const pending = s.pending.reduce((a, p) => a + BigInt(p.amount), 0n);
  if (pending !== BigInt(s.treasury.pending_total))
    fail("malformed", "pending payouts don't add up");
  const seqs = s.outcomes.map((o) => o.seq);
  if (new Set(seqs).size !== seqs.length) fail("malformed", "an outcome appears twice");
  if (d && seqs.includes(d.seq)) fail("malformed", "the live deal also appears as ended");

  // 1. appoint_operator writes the current generation; finalize resets every slot.
  if (c.operators.some((o) => o.generation !== c.generation))
    fail("malformed", "an operator belongs to another generation");
  if (new Set(c.operators.map((o) => o.account)).size !== c.operators.length)
    fail("malformed", "an operator appears twice");
  if (d) {
    // 2. propose_sale takes seller and generation from control; only finalize changes either.
    if (d.seller !== c.owner || d.expected_generation !== c.generation)
      fail("malformed", "the live deal doesn't match the current owner and generation");
    if (BigInt(d.seq) < 1n) fail("malformed", "the live deal has no number");
    // 3. validate_terms and accept_sale: Direct has no close window and never sits closing; a
    //    closing deal is fully accepted and freezes the control sequence until it ends.
    if (c.close_mode === "direct" && (d.close_window_ms !== "0" || d.state === "closing"))
      fail("malformed", "the live deal doesn't fit a direct close");
    if (
      d.state === "closing" &&
      (!d.seller_accepted || !d.buyer_accepted || d.closing_control_seq !== c.control_seq)
    )
      fail("malformed", "a closing deal doesn't match the control sequence");
    // 4. fund_deal takes exactly the price; revise_sale returns it if the price changes.
    if (d.escrow !== "0" && d.escrow !== d.price)
      fail("malformed", "the live deal's escrow isn't all or nothing");
  }
  for (const o of s.outcomes) {
    if (o.escrow_returned !== "0" && o.escrow_returned !== o.price)
      fail("malformed", "an outcome returned part of its escrow");
    if (o.status === "closed" && o.escrow_returned !== "0")
      fail("malformed", "a closed sale returned escrow");
  }

  // 5. Deals end in order (propose_sale needs no live deal) into slot seq % 8: the ring holds
  //    exactly deals max(1, m-7)..m, m the latest ended (with a live deal, its number - 1).
  const asc = [...s.outcomes].sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1));
  const last = asc.length ? BigInt((asc[asc.length - 1] as OutcomeV3).seq) : 0n;
  const m = d ? BigInt(d.seq) - 1n : last;
  if (last !== m) fail("malformed", "the outcomes don't end at the deal before the live one");
  const expected = m < 8n ? m : 8n;
  if (BigInt(asc.length) !== expected) fail("malformed", "the outcome ring has gaps");
  for (const [i, o] of asc.entries())
    if (BigInt(o.seq) !== m - expected + 1n + BigInt(i))
      fail("malformed", "the outcome ring isn't contiguous");

  // 6. Each end is its own control step; generations never go back.
  let prev: OutcomeV3 | null = null;
  for (const o of asc) {
    if (BigInt(o.control_seq) > BigInt(c.control_seq))
      fail("malformed", "an outcome is newer than control");
    if (o.generation_after > c.generation)
      fail("malformed", "an outcome is from a later generation");
    if (prev && BigInt(o.control_seq) <= BigInt(prev.control_seq))
      fail("malformed", "outcomes are out of control order");
    if (prev && o.generation_after < prev.generation_after)
      fail("malformed", "outcomes go back a generation");
    prev = o;
  }

  // 7. finalize makes the buyer the owner at the next generation; a later close would be later in
  //    the ring, and anything that ended after it ended in the same generation.
  const closedAt = asc.map((o) => o.status).lastIndexOf("closed");
  if (closedAt >= 0) {
    const k = asc[closedAt] as OutcomeV3;
    if (k.buyer !== c.owner || k.generation_after !== c.generation)
      fail("malformed", "the latest sale doesn't match the current owner");
    for (const o of asc.slice(closedAt + 1))
      if (o.generation_after !== c.generation)
        fail("malformed", "an outcome after the latest sale is from another generation");
  }

  // 8. new starts at generation 1 and only finalize raises it, recording a closed outcome: while
  //    the ring still holds deal 1, every close is visible.
  if (m <= 8n) {
    const closes = asc.filter((o) => o.status === "closed").length;
    if (c.generation !== 1 + closes) fail("malformed", "the generation doesn't match the sales");
  }
}
