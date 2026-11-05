// Job 003w-e3 → 003web (docs/design/APPLICATION_COMPOSITION.md §10): a FRESH customer's purchase, in
// the browser. The server reads and verifies; the customer's own wallet signs every request:
//   1. sponsor_shell(customer, plan_id) with the server's EXACT quote (the contract's measured
//      growth: 811 + len(customer) bytes x the protocol byte cost; any excess is refunded);
//   2. the token's storage_deposit, only if this account isn't registered with it;
//   3. ft_transfer_call on the business's own token with msg {"buy": {plan_id, units,
//      purchase_seq, install?}}: accepted for exactly units x unit_price at the NEXT sequence,
//      otherwise returned whole by the contract.
// `PurchaseFlow` re-derives each reviewed request from its terms (the server's call must equal
// it), stores the reviewed purchase before the wallet is asked, and resolves it only through the
// server's check of THIS purchase's own transaction. A lost answer stays unknown; nothing is
// retried or paid again automatically. Every answer after retirement (sign-out, another account,
// another offer) is dropped.

import type { DeviceKeyRecord } from "./deviceKey.ts";
import type { WalletBoundary, WalletFunctionCall } from "./wallet.ts";

const DEC = /^(0|[1-9][0-9]{0,38})$/;
const U128_MAX = (1n << 128n) - 1n;
const U32_MAX = 0xffff_ffff;
/** A u128 decimal string (the regex alone isn't an upper bound). */
export const isU128 = (v: unknown): v is string =>
  typeof v === "string" && DEC.test(v) && BigInt(v) <= U128_MAX;

export function sponsorShellCall(input: {
  contract: string;
  customer: string;
  planId: number;
  /** yoctoNEAR, quoted from the contract's storage cost; never guessed here. */
  quotedDeposit: string;
}): WalletFunctionCall {
  if (!isU128(input.quotedDeposit) || input.quotedDeposit === "0")
    throw new Error("A quoted storage deposit (yoctoNEAR) is required.");
  return {
    receiverId: input.contract,
    methodName: "sponsor_shell",
    args: { customer: input.customer, plan_id: input.planId },
    gas: "30000000000000",
    deposit: input.quotedDeposit,
  };
}

export function buyCall(input: {
  asset: string;
  contract: string;
  planId: number;
  units: number;
  /** The plan's unit price in the token's base units (decimal string). */
  unitPrice: string;
  maxUnitsPerPurchase: number;
  /** The entitlement's current purchase_seq (the call uses the NEXT one). */
  purchaseSeq: number;
  /** Enroll this device's key in the same purchase (a stored, not yet enrolled key). */
  install?: Pick<DeviceKeyRecord, "slot" | "public_key" | "max_hold_units" | "max_units_per_day">;
  /** The registration this purchase is for (the contract refuses it for any other). */
  regId: string;
}): WalletFunctionCall {
  if (
    !Number.isInteger(input.units) ||
    input.units < 1 ||
    input.units > U32_MAX ||
    input.units > input.maxUnitsPerPurchase
  )
    throw new Error(`Choose 1 to ${input.maxUnitsPerPurchase} units.`);
  if (!isU128(input.unitPrice) || input.unitPrice === "0")
    throw new Error("The plan's unit price must be a positive whole number of base units.");
  if (!Number.isInteger(input.purchaseSeq) || input.purchaseSeq < 0 || input.purchaseSeq >= U32_MAX)
    throw new Error("The purchase sequence is invalid.");
  const amount = BigInt(input.units) * BigInt(input.unitPrice);
  if (amount > U128_MAX) throw new Error("That total is too large.");
  if (!/^(0|[1-9][0-9]{0,19})$/.test(input.regId))
    throw new Error("The registration id is invalid.");
  const buy = {
    plan_id: input.planId,
    units: input.units,
    purchase_seq: input.purchaseSeq + 1,
    install: input.install
      ? {
          slot: input.install.slot,
          pk: input.install.public_key,
          max_hold_units: input.install.max_hold_units,
          max_units_per_day: input.install.max_units_per_day,
        }
      : null,
    reg_id: input.regId,
  };
  return {
    receiverId: input.asset,
    methodName: "ft_transfer_call",
    args: { receiver_id: input.contract, amount: amount.toString(), msg: JSON.stringify({ buy }) },
    gas: "100000000000000",
    deposit: "1",
  };
}

/** A token amount from base units and VALIDATED decimals, e.g. ("5000000", 6) → "5". */
export function tokenAmount(base: string, decimals: number): string {
  if (!isU128(base) || !Number.isInteger(decimals) || decimals < 0 || decimals > 38)
    throw new Error("not a token amount");
  const v = BigInt(base);
  if (decimals === 0) return v.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = v / scale;
  const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** yoctoNEAR as NEAR (24 decimals), for the separate storage deposit. */
export const nearAmount = (yocto: string) => tokenAmount(yocto, 24);

// ---------- the server's answers (§10.2, §10.4) ----------

export interface PurchasePreview {
  account: string;
  network: string;
  contract: string;
  asset: string;
  reg_id: string;
  purchase_seq: number;
  units: number;
  amount: string;
  call: WalletFunctionCall;
  terms_digest: string;
}
export interface PurchaseView {
  id: string;
  offer_id: string;
  customer: string;
  contract: string;
  asset: string;
  purchase_seq: number;
  units: number;
  amount: string;
  call: WalletFunctionCall;
  state:
    | "prepared"
    | "requested"
    | "unknown"
    | "confirmed"
    | "returned"
    | "not_accepted"
    | "registration_replaced"
    | "set_aside"
    | "legacy_abandoned";
  reg_id: string;
  network: string;
  asks: number;
  tx_hash: string | null;
  evidence: Resolution | null;
}
export type Resolution =
  | { kind: "confirmed"; units: number; amount: string }
  | { kind: "returned"; amount: string; reason: string }
  | { kind: "not_accepted"; message: string }
  | { kind: "registration_replaced"; message: string; reg_id_now: string | null }
  | { kind: "unknown"; message: string; purchase_seq_now: number | null; free_now: string | null };
export interface PurchaseSetup {
  network: string;
  contract: string;
  asset: string;
  plan_id: number;
  customer: string;
  offer_state: string;
  /** The contract's declared purchase terms (null on a contract without them). */
  terms: null | { version: number; shell_bytes: string; storage_byte_cost: string };
  plan: { unit_price: string; max_units_per_purchase: number; max_units_outstanding: number };
  token: {
    symbol: string;
    name: string;
    decimals: number;
    balance: string;
    customer_registered: boolean;
    business_registered: boolean;
  };
  entitlement: null | {
    reg_id: string;
    active?: boolean;
    purchase_seq: number;
    free: string;
    held: number;
    purchased: string;
  };
  shell: {
    needed: boolean;
    quote: null | { exact: true; bytes: string; byte_cost: string; deposit: string; basis: string };
    call: WalletFunctionCall | null;
  };
  token_storage: { needed: boolean; call: WalletFunctionCall | null };
  steps: string[];
  open: PurchaseView | null;
  /** Earlier purchases that no longer block a payment, but whose outcome is still unknown. */
  unresolved?: PurchaseView[];
  preview: PurchasePreview | { code: string; problem: string } | null;
}

export interface PurchasePort {
  setup(offerId: string, units?: number): Promise<PurchaseSetup>;
  create(
    offerId: string,
    body: { idempotency_key: string; units: number; terms_digest: string },
  ): Promise<{ created: boolean; purchase: PurchaseView }>;
  requested(id: string, body: { tx_hash?: string }): Promise<{ purchase: PurchaseView }>;
  check(
    id: string,
    body: { tx_hash?: string },
  ): Promise<{
    purchase: PurchaseView;
    resolution: Resolution | null;
    /** For a NAMED transaction: whether it was shown to be exactly this purchase's. */
    transaction?: { hash: string; matched: boolean } | null;
  }>;
  abandon(id: string): Promise<{ purchase: PurchaseView }>;
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: string; detail?: unknown })
    | null;
  if (!res.ok) {
    const e = new Error(data?.error ?? `Request failed (${res.status})`) as Error & {
      code?: string;
      detail?: unknown;
      status?: number;
    };
    e.code = data?.code;
    e.detail = data?.detail;
    e.status = res.status;
    throw e;
  }
  return data as T;
}

export const purchaseHttp: PurchasePort = {
  setup: (offerId, units) =>
    call(
      `/api/customer/offers/${encodeURIComponent(offerId)}/purchase-setup${units === undefined ? "" : `?units=${units}`}`,
    ),
  create: (offerId, body) =>
    call(`/api/customer/offers/${encodeURIComponent(offerId)}/purchases`, "POST", body),
  requested: (id, body) =>
    call(`/api/customer/purchases/${encodeURIComponent(id)}/requested`, "POST", body),
  check: (id, body) =>
    call(`/api/customer/purchases/${encodeURIComponent(id)}/check`, "POST", body),
  abandon: (id) => call(`/api/customer/purchases/${encodeURIComponent(id)}/abandon`, "POST"),
};

// ---------- the controller ----------

export type Review =
  | { kind: "shell"; call: WalletFunctionCall }
  | { kind: "token_storage"; call: WalletFunctionCall }
  | { kind: "purchase"; preview: PurchasePreview }
  /** Asking the wallet AGAIN for an open purchase's identical request: its own consent. */
  | { kind: "resend"; purchase: PurchaseView };

/** What asking again means, in plain words (the same sequence: at most one is ever accepted). */
export const RESEND_CONSENT =
  "Your wallet will be asked again for exactly the same purchase. The contract accepts at most one purchase with this sequence: if the first one already went through, this one is returned in full, but your wallet still spends a little NEAR on gas, and the token briefly moves the amount before returning it.";

export interface FlowState {
  status: "loading" | "ready" | "error";
  setup: PurchaseSetup | null;
  units: number;
  review: Review | null;
  busy: null | "checking" | "wallet" | "processing";
  notice: { tone: "info" | "warn" | "ok"; text: string } | null;
  resolution: Resolution | null;
  /**
   * Job 003wf3 (Astra 03:05): when the shown reading was taken (this browser's clock), and
   * whether the latest attempt to read again failed (the reading shown is then older).
   */
  readAtMs?: number | null;
  rereadFailed?: boolean;
}

const isPreview = (p: PurchaseSetup["preview"]): p is PurchasePreview => Boolean(p && "call" in p);

const CANCEL = /closed the window|cancel|reject/i;
/** A NEAR transaction ID (base58, 32 bytes). */
export const TX_ID = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** What a check's resolution tells the customer (shared by every check path). */
function noticeFor(res: Resolution | null, cancelled = false): FlowState["notice"] {
  if (!res) return null;
  if (res.kind === "confirmed") return { tone: "ok", text: "Purchase confirmed by the contract." };
  if (res.kind === "returned")
    return {
      tone: "warn",
      text: `This payment came back to you in full, as the token's own records show (${res.reason}).`,
    };
  if (res.kind === "unknown" && cancelled)
    return { tone: "info", text: `You closed the wallet. ${res.message}` };
  return { tone: "info", text: res.message };
}

export class PurchaseFlow {
  private state: FlowState = {
    status: "loading",
    setup: null,
    units: 10,
    review: null,
    busy: null,
    notice: null,
    resolution: null,
  };
  private listeners = new Set<() => void>();
  private alive = true;

  constructor(
    private readonly port: PurchasePort,
    private readonly wallet: () => Promise<WalletBoundary> | null,
    private readonly opts: { offerId: string; account: string; makeKey?: () => string },
  ) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  retire() {
    this.alive = false;
    this.listeners.clear();
  }
  get retired() {
    return !this.alive;
  }
  private set(patch: Partial<FlowState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private key() {
    return (this.opts.makeKey ?? (() => `purchase-${crypto.randomUUID()}`))();
  }

  /** Reads started; only the newest one's answer is ever applied (Astra's PurchaseRefreshReview). */
  private reads = 0;

  /**
   * A fresh read at one final block; an open purchase is shown (and must be resolved) first.
   * Only the NEWEST read's answer is applied: an older one answering late never replaces a newer
   * reading. The quantity is the customer's own and is never taken from a reading (an edit made
   * while it was in flight stays). True only when this read's answer was applied.
   */
  async load(units = this.state.units): Promise<boolean> {
    const mine = ++this.reads;
    try {
      const s = await this.port.setup(this.opts.offerId, units);
      if (!this.alive || mine !== this.reads) return false;
      if (s.customer !== this.opts.account) {
        this.set({
          status: "error",
          notice: { tone: "warn", text: "That answer is for another account; sign in again." },
        });
        return false;
      }
      this.set({ status: "ready", setup: s, readAtMs: Date.now(), rereadFailed: false });
      return true;
    } catch (e) {
      if (!this.alive || mine !== this.reads) return false;
      this.set({
        status: this.state.setup ? "ready" : "error",
        notice: { tone: "warn", text: (e as Error).message },
        rereadFailed: this.state.setup !== null,
      });
      return false;
    }
  }

  /**
   * Job 003wf3 (Astra 03:05): reads the contract again because something this page knows changed
   * (e.g. a unit came back). Never while a purchase is being reviewed or sent: that exact request
   * and its recovery stay as they are, and false is returned so the caller can try later.
   */
  async reread(): Promise<boolean> {
    if (!this.alive || this.state.busy !== null || this.state.review !== null) return false;
    return this.load();
  }

  /**
   * A reading that is current for the quantity being reviewed: if a newer read or an edit
   * superseded it meanwhile, it is read once more; still superseded, nothing is reviewed.
   */
  private async currentReading(): Promise<PurchaseSetup | null> {
    for (let i = 0; i < 2 && this.alive; i++) {
      const units = this.state.units;
      const applied = await this.load(units);
      if (!this.alive) return null;
      if (applied && this.state.units === units) return this.state.setup;
    }
    return null;
  }

  setUnits(units: number) {
    this.set({ units, review: null });
  }

  /** The exact request for review (nothing is sent). */
  async review(kind: Review["kind"]) {
    const s = await this.currentReading();
    if (!s || !this.alive) return;
    if (kind === "shell" && s.shell.call) return this.set({ review: { kind, call: s.shell.call } });
    if (kind === "token_storage" && s.token_storage.call)
      return this.set({ review: { kind, call: s.token_storage.call } });
    if (kind === "resend") {
      if (!s.open || s.open.state === "prepared") return;
      return this.set({ review: { kind, purchase: s.open } });
    }
    if (kind === "purchase") {
      if (s.open)
        return this.set({
          notice: {
            tone: "warn",
            text: "A purchase is still waiting for its outcome; check it first.",
          },
        });
      const p = s.preview;
      if (!isPreview(p))
        return this.set({
          review: null,
          notice: { tone: "warn", text: p?.problem ?? "That purchase can't be made." },
        });
      return this.set({ review: { kind, preview: p } });
    }
  }

  /** The reviewed request must be exactly what its terms say (the browser's own check). */
  private verify(p: PurchasePreview): string | null {
    const s = this.state.setup;
    if (!s) return "Nothing to check against.";
    if (p.account !== this.opts.account) return "This purchase names another account.";
    if (p.asset !== s.asset || p.contract !== s.contract)
      return "This purchase names another token or business.";
    if (!s.entitlement || p.reg_id !== s.entitlement.reg_id)
      return "This purchase names another registration.";
    const install = (() => {
      try {
        const m = JSON.parse(String(p.call.args.msg)) as {
          buy?: { install?: Record<string, unknown> | null };
        };
        const i = m.buy?.install;
        return i
          ? {
              slot: Number(i.slot),
              public_key: String(i.pk),
              max_hold_units: Number(i.max_hold_units),
              max_units_per_day: Number(i.max_units_per_day),
            }
          : undefined;
      } catch {
        return undefined;
      }
    })();
    let expected: WalletFunctionCall;
    try {
      expected = buyCall({
        asset: s.asset,
        contract: s.contract,
        planId: s.plan_id,
        units: p.units,
        unitPrice: s.plan.unit_price,
        maxUnitsPerPurchase: s.plan.max_units_per_purchase,
        purchaseSeq: p.purchase_seq - 1,
        install,
        regId: p.reg_id,
      });
    } catch (e) {
      return (e as Error).message;
    }
    if (JSON.stringify(expected) !== JSON.stringify(p.call) || expected.args.amount !== p.amount)
      return "The request doesn't match its own terms; nothing was sent.";
    return null;
  }

  private async walletFor(): Promise<WalletBoundary | null> {
    const w = await this.wallet();
    if (!w) {
      this.set({ notice: { tone: "warn", text: "There is no wallet on this server." } });
      return null;
    }
    const acct = (await w.accounts())[0] ?? (await w.connect());
    if (!this.alive) return null;
    if (acct !== this.opts.account) {
      this.set({
        notice: {
          tone: "warn",
          text: `Your wallet is using ${acct ?? "no account"}, not ${this.opts.account}. Switch accounts in the wallet first; nothing was sent.`,
        },
      });
      return null;
    }
    return w;
  }

  /** Shell or token storage: send exactly the reviewed request; the readback decides. */
  async confirmSetupStep() {
    const r = this.state.review;
    if (!r || r.kind === "purchase" || r.kind === "resend") return;
    this.set({ busy: "wallet", notice: null });
    try {
      const w = await this.walletFor();
      if (!w || !this.alive) return;
      let cancelled = false;
      try {
        await w.send(r.call);
      } catch (e) {
        cancelled = CANCEL.test((e as Error)?.message ?? "");
      }
      if (!this.alive) return;
      this.set({ busy: "checking", review: null });
      await this.load();
      const s = this.state.setup;
      const done = r.kind === "shell" ? s && !s.shell.needed : s && !s.token_storage.needed;
      this.set({
        notice: done
          ? {
              tone: "ok",
              text:
                r.kind === "shell"
                  ? "Your registration with this business is confirmed."
                  : "Your account is registered with the token.",
            }
          : cancelled
            ? { tone: "info", text: "You closed the wallet before approving. Nothing changed." }
            : {
                tone: "warn",
                text: "The contract doesn't show it yet. If you approved it, check again in a moment.",
              },
      });
    } finally {
      this.set({ busy: null });
    }
  }

  /**
   * The purchase: store the reviewed intent (the server re-reads and must reproduce its terms),
   * mark the wallet asked, ask the wallet for EXACTLY that request, then let the server check
   * this purchase's own transaction.
   */
  async confirmPurchase() {
    const r = this.state.review;
    if (r?.kind !== "purchase") return;
    const problem = this.verify(r.preview);
    if (problem) return this.set({ notice: { tone: "warn", text: problem } });
    this.set({ busy: "processing", notice: null });
    try {
      const w = await this.walletFor();
      if (!w || !this.alive) return;
      let purchase: PurchaseView;
      try {
        ({ purchase } = await this.port.create(this.opts.offerId, {
          idempotency_key: this.key(),
          units: r.preview.units,
          terms_digest: r.preview.terms_digest,
        }));
      } catch (e) {
        if (!this.alive) return;
        const err = e as Error & { code?: string; detail?: { preview?: PurchasePreview } };
        if (err.code === "terms_changed" && err.detail?.preview) {
          this.set({
            review: { kind: "purchase", preview: err.detail.preview },
            notice: {
              tone: "warn",
              text: "The purchase changed since you reviewed it. Review it again.",
            },
          });
          return;
        }
        this.set({ review: null, notice: { tone: "warn", text: err.message } });
        await this.load();
        return;
      }
      if (!this.alive) return;
      // Consent survives the create response only if the stored request IS the reviewed one.
      const pv = r.preview;
      if (
        JSON.stringify(purchase.call) !== JSON.stringify(pv.call) ||
        purchase.units !== pv.units ||
        purchase.amount !== pv.amount ||
        purchase.purchase_seq !== pv.purchase_seq ||
        purchase.reg_id !== pv.reg_id ||
        purchase.asset !== pv.asset ||
        purchase.contract !== pv.contract ||
        purchase.customer !== pv.account
      ) {
        this.set({
          review: null,
          notice: {
            tone: "warn",
            text: "The stored purchase isn't the one you reviewed; nothing was sent. Set it aside and review again.",
          },
        });
        await this.load();
        return;
      }
      await this.port.requested(purchase.id, {});
      if (!this.alive) return;
      this.set({ busy: "wallet" });
      let txHash: string | null = null;
      let cancelled = false;
      try {
        txHash = (await w.send(purchase.call))?.txHash ?? null;
      } catch (e) {
        cancelled = CANCEL.test((e as Error)?.message ?? "");
      }
      if (!this.alive) return;
      this.set({ busy: "checking", review: null });
      if (txHash) await this.port.requested(purchase.id, { tx_hash: txHash }).catch(() => {});
      await this.checkOpen(purchase.id, txHash ?? undefined, cancelled);
    } finally {
      this.set({ busy: null });
    }
  }

  /** A bounded explicit check of an open purchase (with a hash, if one is known now). */
  async checkOpen(id: string, txHash?: string, cancelled = false) {
    // A check the customer starts is one at a time (one inside a send already holds busy).
    const own = this.state.busy === null;
    if (own) this.set({ busy: "checking" });
    try {
      const r = await this.port.check(id, txHash ? { tx_hash: txHash } : {});
      if (!this.alive) return;
      this.set({ resolution: r.resolution, notice: noticeFor(r.resolution, cancelled) });
    } catch (e) {
      if (!this.alive) return;
      this.set({ notice: { tone: "warn", text: (e as Error).message } });
    } finally {
      if (own) this.set({ busy: null });
    }
    await this.load();
  }

  /**
   * Checks a purchase with the ORIGINAL transaction's ID, copied from the wallet's history, when
   * the wallet's answer never carried it (Astra's PurchaseBrowserReview 2). The wallet is not
   * asked for anything. The server's strict resolver decides: only a FINAL transaction that is
   * exactly this purchase's request, from this account, with its receipts, can settle it; any
   * other ID shows nothing about it and is not recorded. Answers after retirement are dropped.
   */
  async checkWithTransaction(id: string, txId: string) {
    const t = txId.trim();
    if (!TX_ID.test(t))
      return this.set({
        notice: {
          tone: "warn",
          text: "That isn't a NEAR transaction ID: it is 43 or 44 letters and digits, as your wallet's activity shows it.",
        },
      });
    if (this.state.busy !== null) return;
    this.set({ busy: "checking", notice: null, review: null });
    try {
      const r = await this.port.check(id, { tx_hash: t });
      if (!this.alive) return;
      if (r.transaction && !r.transaction.matched)
        this.set({
          resolution: r.resolution,
          notice: {
            tone: "warn",
            text: "That transaction isn't this purchase (or isn't final yet), so it shows nothing about it. Nothing was recorded from it, and the purchase stays as it was.",
          },
        });
      else this.set({ resolution: r.resolution, notice: noticeFor(r.resolution) });
    } catch (e) {
      if (!this.alive) return;
      this.set({ notice: { tone: "warn", text: (e as Error).message } });
    } finally {
      this.set({ busy: null });
    }
    await this.load();
  }

  /**
   * Set aside a preparation the wallet was NEVER asked for. A requested purchase stays open until
   * its outcome is known (the server refuses otherwise).
   */
  async setAside(id: string) {
    try {
      await this.port.abandon(id);
      if (!this.alive) return;
      this.set({
        resolution: null,
        notice: {
          tone: "info",
          text: "Set aside: your wallet was never asked for it.",
        },
      });
    } catch (e) {
      if (!this.alive) return;
      this.set({ notice: { tone: "warn", text: (e as Error).message } });
    }
    await this.load();
  }

  /**
   * Ask the wallet AGAIN for the reviewed open purchase's IDENTICAL request (review("resend")
   * first: a recovered row is not new consent). At most one is ever accepted; a duplicate is
   * returned whole by the contract (its gas is still spent).
   */
  async confirmResend() {
    const r = this.state.review;
    if (r?.kind !== "resend") return;
    const p = this.state.setup?.open;
    if (!p || p.id !== r.purchase.id || JSON.stringify(p.call) !== JSON.stringify(r.purchase.call))
      return this.set({
        review: null,
        notice: { tone: "warn", text: "That purchase changed; review it again." },
      });
    this.set({ busy: "wallet", notice: null });
    try {
      const w = await this.walletFor();
      if (!w || !this.alive) return;
      await this.port.requested(p.id, {});
      if (!this.alive) return;
      let txHash: string | null = null;
      try {
        txHash = (await w.send(p.call))?.txHash ?? null;
      } catch {
        // The check decides.
      }
      if (!this.alive) return;
      this.set({ review: null });
      if (txHash) await this.port.requested(p.id, { tx_hash: txHash }).catch(() => {});
      await this.checkOpen(p.id, txHash ?? undefined);
    } finally {
      this.set({ busy: null });
    }
  }
}
