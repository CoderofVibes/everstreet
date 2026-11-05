// Job 003wf2 (docs/design/DIRECT_SALE.md): the Direct sale in the browser, for both parties.
// One controller per business and signed-in account; a change of either retires it (every late
// answer is dropped). The server reads and verifies; the participant's own wallet signs:
//   review: an exact preview, checked HERE (verifyPreview: the call re-derived from the reviewed
//     facts, the contract digest and the terms document hash recomputed) before it is offered;
//   confirm: store it (the server re-reads and must reproduce it), check the stored request is
//     the reviewed one, claim the one wallet ask (only "granted" invokes the wallet), check the
//     wallet's account is this participant's, send exactly that call, record the hash, and let
//     the server check THIS request's own transaction.
// A lost answer stays unknown; nothing is resent. An unknown request of an exclusive kind may be
// replaced only by the identical request (same digest), named, with its own consent.

import {
  type CheckAnswer,
  type SaleAction,
  SaleError,
  type SaleKind,
  type SalePort,
  type SalePreview,
  type SaleResolution,
  type SaleSetup,
} from "./saleApi.ts";
import { EXCLUSIVE, storedIsReviewed, verifyPreview } from "./saleCalls.ts";
import type { WalletBoundary } from "./wallet.ts";

export interface SaleNotice {
  tone: "info" | "warn" | "ok";
  text: string;
}

/** A seller's terms as typed (never sent until reviewed); kept per kind for this controller. */
export interface TermsDraft {
  buyer: string;
  price: string;
  days: number;
  floor: string;
  metering: boolean;
  exclusions: string;
  note: string;
}

export interface SaleFlowState {
  status: "loading" | "ready" | "error";
  setup: SaleSetup | null;
  /** The exact request being reviewed (verified here), and the control it was opened from. */
  review: { preview: SalePreview; replaces: string | null; origin: string | null } | null;
  busy: null | "reading" | "reviewing" | "storing" | "wallet" | "checking";
  notice: SaleNotice | null;
  /** The newest check's answer, by action. */
  answers: Record<string, CheckAnswer>;
  /**
   * Terms being written, by kind (Astra's browser review: "Not now", a retry or a stale review
   * never discards them). The controller is one per business and signed-in account, so a draft
   * can never reach another person's or another business's page.
   */
  drafts: Partial<Record<"propose" | "revise", TermsDraft>>;
  /** Where focus returns after a review is set aside (a control's `data-focus` key). */
  focus: string | null;
}

const CANCEL = /closed the window|cancel|reject/i;
export const TX_ID = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/** What a check found, in words: the transaction's result, and any local follow-up still due. */
export function noticeFor(
  r: SaleResolution | null,
  cancelled = false,
  effects: Record<string, unknown> | null = null,
): SaleNotice | null {
  if (!r) return null;
  if (r.kind === "confirmed") {
    const rec = effects?.reconcile as { state?: string; message?: string } | undefined;
    // A stored TERMINAL answer other than applied (conflict, ended, superseded) is final here: it
    // is reported as it is, without offering to check again.
    if (rec && rec.state !== "applied" && rec.state !== "already" && effects?.finished === true)
      return {
        tone: "warn",
        text: `${r.message} It wasn't applied here: ${rec.message ?? rec.state}.`,
      };
    if (rec && rec.state !== "applied" && rec.state !== "already")
      return {
        tone: "info",
        text: `${r.message} Applying it here isn't finished yet (${rec.message ?? rec.state}). Use "Apply the close here" to check again; nothing is sent.`,
      };
    if (rec) return { tone: "ok", text: `${r.message} ${rec.message ?? ""}`.trim() };
    return { tone: "ok", text: r.message };
  }
  if (r.kind === "refused") return { tone: "warn", text: r.message };
  return { tone: "info", text: cancelled ? `You closed the wallet. ${r.message}` : r.message };
}

export class SaleFlow {
  private state: SaleFlowState = {
    status: "loading",
    setup: null,
    review: null,
    busy: null,
    notice: null,
    answers: {},
    drafts: {},
    focus: null,
  };
  private listeners = new Set<() => void>();
  private alive = true;
  private reads = 0;

  constructor(
    private readonly port: SalePort,
    private readonly wallet: () => Promise<WalletBoundary> | null,
    private readonly opts: { businessId: string; account: string; makeKey?: () => string },
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
  private set(patch: Partial<SaleFlowState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private key(prefix: string) {
    return (this.opts.makeKey ?? (() => `${prefix}-${crypto.randomUUID()}`))();
  }

  /** A fresh read at one final block; only the newest read's answer is applied. */
  async load(): Promise<boolean> {
    const mine = ++this.reads;
    if (this.state.setup) this.set({ busy: this.state.busy ?? "reading" });
    try {
      const s = await this.port.setup(this.opts.businessId);
      if (!this.alive || mine !== this.reads) return false;
      if (s.account !== this.opts.account) {
        this.set({
          status: "error",
          setup: null,
          review: null,
          notice: { tone: "warn", text: "That answer is for another account; sign in again." },
        });
        return false;
      }
      this.set({ status: "ready", setup: s });
      return true;
    } catch (e) {
      if (!this.alive || mine !== this.reads) return false;
      const lost = e instanceof SaleError && (e.status === 404 || e.code === "no_chain_account");
      this.set({
        status: this.state.setup && !lost ? "ready" : "error",
        setup: lost ? null : this.state.setup,
        notice: { tone: "warn", text: (e as Error).message },
      });
      return false;
    } finally {
      if (this.alive && mine === this.reads && this.state.busy === "reading")
        this.set({ busy: null });
    }
  }

  /** The exact request for review (nothing is stored or sent), verified here first. */
  async review(
    kind: SaleKind,
    input: Record<string, unknown> = {},
    replaces: string | null = null,
    origin: string | null = null,
  ) {
    if (this.state.busy) return;
    this.set({ busy: "reviewing", notice: null, review: null, focus: null });
    try {
      const p = await this.port.prepare(this.opts.businessId, kind, input);
      if (!this.alive) return;
      const setup = this.state.setup;
      if (!setup) return;
      const problem = await verifyPreview(p, setup, this.opts.account);
      if (!this.alive) return;
      if (problem) return this.set({ notice: { tone: "warn", text: problem }, focus: origin });
      if (replaces) {
        const open = setup.open.find((a) => a.id === replaces);
        if (!open || open.action_digest !== p.action_digest)
          return this.set({
            focus: origin,
            notice: {
              tone: "warn",
              text: "The sale has moved on, so this can't be the identical request any more. Check the open request instead: it can no longer take effect.",
            },
          });
      }
      this.set({ review: { preview: p, replaces, origin } });
    } catch (e) {
      if (!this.alive) return;
      this.set({ notice: { tone: "warn", text: (e as Error).message }, focus: origin });
    } finally {
      this.set({ busy: null });
    }
  }

  /** Set the review aside: nothing is stored or sent; the draft stays; focus goes back. */
  cancelReview() {
    const origin = this.state.review?.origin ?? null;
    this.set({ review: null, focus: origin });
  }

  /** Keep what the person typed (only in this controller: this business, this account). */
  setDraft(kind: "propose" | "revise", d: TermsDraft) {
    this.set({ drafts: { ...this.state.drafts, [kind]: d } });
  }

  /** A confirmed proposal or revision has been made: its draft is done. */
  private settledDrafts(r: CheckAnswer) {
    const k = r.action.kind;
    if (r.resolution?.kind !== "confirmed" || (k !== "propose" && k !== "revise"))
      return this.state.drafts;
    const { [k]: _done, ...rest } = this.state.drafts;
    return rest;
  }

  /** Focus was restored by the page. */
  focused() {
    if (this.state.focus !== null) this.set({ focus: null });
  }

  /** The wallet, connected with THIS participant's account, or null (with the reason shown). */
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

  /** Store the reviewed request, claim its one wallet ask, send exactly it, then check it. */
  async confirm() {
    const r = this.state.review;
    if (!r || this.state.busy) return;
    const p = r.preview;
    this.set({ busy: "storing", notice: null });
    try {
      const w = await this.walletFor();
      if (!w || !this.alive) return;
      let action: SaleAction;
      try {
        ({ action } = await this.port.create(this.opts.businessId, {
          kind: p.kind,
          input: p.input,
          action_digest: p.action_digest,
          idempotency_key: this.key(`sale-${p.kind}`),
          ...(r.replaces ? { replaces: r.replaces } : {}),
        }));
      } catch (e) {
        if (!this.alive) return;
        const err = e as SaleError;
        if (err.code === "review_changed") {
          this.set({
            review: null,
            focus: r.origin,
            notice: {
              tone: "warn",
              text:
                p.kind === "propose" || p.kind === "revise"
                  ? "The sale changed since you reviewed it. Your terms are kept: review them again."
                  : "The sale changed since you reviewed it, so nothing was stored or sent. Review it again.",
            },
          });
          return void (await this.load());
        }
        this.set({ review: null, focus: r.origin, notice: { tone: "warn", text: err.message } });
        return void (await this.load());
      }
      if (!this.alive) return;
      if (!storedIsReviewed(action, p)) {
        this.set({
          review: null,
          notice: {
            tone: "warn",
            text: "The stored request isn't the one you reviewed; nothing was sent. Set it aside and review again.",
          },
        });
        return void (await this.load());
      }
      await this.ask(w, action);
    } finally {
      this.set({ busy: null });
    }
  }

  /** Claim the one ask, then (only if granted) send exactly the stored call and check it. */
  private async ask(w: WalletBoundary, action: SaleAction) {
    const askId = this.key("ask");
    let granted = false;
    for (let i = 0; i < 2 && !granted && this.alive; i++) {
      try {
        granted = (await this.port.requested(action.id, { ask_id: askId })).ask === "granted";
        break;
      } catch {
        // A lost answer: ask again with the same claimant id (answered "granted" if it was ours).
      }
    }
    if (!this.alive) return;
    if (!granted) {
      this.set({
        review: null,
        notice: {
          tone: "warn",
          text: "This request's wallet ask couldn't be confirmed as yours, so your wallet wasn't asked from here. Check the request.",
        },
      });
      return void (await this.load());
    }
    await this.sendGranted(w, action, askId);
  }

  /**
   * At the send boundary (Astra's controller review 3): the account is checked AGAIN right before
   * the wallet is invoked, after every await. If it changed, nothing is sent: the request stays
   * asked-but-unsent and this page keeps its claim, so switching the wallet back can resume it
   * (the same claimant's ask is re-answered "granted"; the wallet has still never been invoked).
   */
  private async sendGranted(w: WalletBoundary, action: SaleAction, askId: string) {
    const acct = (await w.accounts().catch(() => []))[0] ?? null;
    if (!this.alive) return;
    if (acct !== this.opts.account) {
      this.resumable = { action, askId };
      this.set({
        review: null,
        notice: {
          tone: "warn",
          text: `Your wallet switched to ${acct ?? "no account"} before it was asked, so nothing was sent. Switch it back to ${this.opts.account}, then ask it for this request.`,
        },
      });
      return void (await this.load());
    }
    this.resumable = null;
    this.set({ busy: "wallet" });
    let txHash: string | null = null;
    let cancelled = false;
    try {
      txHash = (await w.send(action.call))?.txHash ?? null;
    } catch (e) {
      cancelled = CANCEL.test((e as Error)?.message ?? "");
    }
    if (!this.alive) return;
    this.set({ busy: "checking", review: null });
    if (txHash) await this.port.requested(action.id, { tx_hash: txHash }).catch(() => {});
    await this.checkOpen(action.id, txHash ?? undefined, cancelled, true);
  }

  /** A request this page claimed but didn't send (the wallet's account changed): resumable here. */
  private resumable: { action: SaleAction; askId: string } | null = null;
  get resumableId() {
    return this.resumable?.action.id ?? null;
  }

  /** Resume it: the same claimant asks again (granted only while nothing was sent), then sends. */
  async resume() {
    const r = this.resumable;
    if (!r || this.state.busy) return;
    this.set({ busy: "storing", notice: null });
    try {
      const w = await this.walletFor();
      if (!w || !this.alive) return;
      const a = await this.port.requested(r.action.id, { ask_id: r.askId }).catch(() => null);
      if (!this.alive) return;
      if (a?.ask !== "granted") {
        this.resumable = null;
        this.set({
          notice: {
            tone: "warn",
            text: "That request can't be resumed from here; check it instead.",
          },
        });
        return void (await this.load());
      }
      await this.sendGranted(w, r.action, r.askId);
    } finally {
      this.set({ busy: null });
    }
  }

  /** Continue a stored request your wallet was never asked for (it was reviewed and stored). */
  async continuePrepared(id: string) {
    if (this.state.busy) return;
    const a = this.state.setup?.open.find((x) => x.id === id && x.state === "prepared");
    if (!a) return;
    this.set({ busy: "storing", notice: null });
    try {
      const w = await this.walletFor();
      if (!w || !this.alive) return;
      await this.ask(w, a);
    } finally {
      this.set({ busy: null });
    }
  }

  /** A bounded explicit check of a request (with a hash, if one is known now). */
  async checkOpen(id: string, txHash?: string, cancelled = false, inner = false) {
    if (!inner && this.state.busy) return;
    if (!inner) this.set({ busy: "checking" });
    try {
      const r = await this.port.check(id, txHash ? { tx_hash: txHash } : {});
      if (!this.alive) return;
      this.set({
        answers: { ...this.state.answers, [id]: r },
        notice: noticeFor(r.resolution, cancelled, r.effects),
        drafts: this.settledDrafts(r),
      });
    } catch (e) {
      if (!this.alive) return;
      this.set({ notice: { tone: "warn", text: (e as Error).message } });
    } finally {
      if (!inner) this.set({ busy: null });
    }
    await this.load();
  }

  /** Check with the ORIGINAL transaction's ID from the wallet's activity; nothing is sent. */
  async checkWithTransaction(id: string, txId: string) {
    const t = txId.trim();
    if (!TX_ID.test(t))
      return this.set({
        notice: {
          tone: "warn",
          text: "That isn't a NEAR transaction ID: it is 43 or 44 letters and digits, as your wallet's activity shows it.",
        },
      });
    if (this.state.busy) return;
    this.set({ busy: "checking", notice: null });
    try {
      const r = await this.port.check(id, { tx_hash: t });
      if (!this.alive) return;
      this.set({
        answers: { ...this.state.answers, [id]: r },
        notice:
          r.transaction && !r.transaction.matched
            ? {
                tone: "warn",
                text: "That transaction isn't this request (or isn't final yet), so it shows nothing about it. Nothing was recorded from it.",
              }
            : noticeFor(r.resolution, false, r.effects),
        drafts: this.settledDrafts(r),
      });
    } catch (e) {
      if (!this.alive) return;
      this.set({ notice: { tone: "warn", text: (e as Error).message } });
    } finally {
      this.set({ busy: null });
    }
    await this.load();
  }

  /** The existing explicit reconciliation of a recorded close (it applies an exact close once). */
  async apply(intentId: string) {
    if (this.state.busy) return;
    this.set({ busy: "checking", notice: null });
    try {
      const a = await this.port.reconcile(this.opts.businessId, intentId);
      if (!this.alive) return;
      this.set({
        notice: {
          tone: a.state === "applied" || a.state === "already" ? "ok" : "info",
          text: a.message,
        },
      });
    } catch (e) {
      if (!this.alive) return;
      this.set({ notice: { tone: "warn", text: (e as Error).message } });
    } finally {
      this.set({ busy: null });
    }
    await this.load();
  }

  /** Set aside a stored request your wallet was NEVER asked for. */
  async setAside(id: string) {
    if (this.state.busy) return;
    try {
      await this.port.abandon(id);
      if (!this.alive) return;
      this.set({
        notice: { tone: "info", text: "Set aside: your wallet was never asked for it." },
      });
    } catch (e) {
      if (!this.alive) return;
      this.set({ notice: { tone: "warn", text: (e as Error).message } });
    }
    await this.load();
  }

  /**
   * Review the identical request in place of an unknown one (exclusive kinds only): a fresh
   * preview must reproduce its digest; then it is offered with its own consent.
   */
  async reviewReplacement(id: string) {
    const a = this.state.setup?.open.find((x) => x.id === id);
    if (!a || !EXCLUSIVE.includes(a.kind) || a.state === "prepared") return;
    const v = a.review;
    const input =
      a.kind === "propose" || a.kind === "revise"
        ? {
            buyer_account: v.buyer,
            price: v.price,
            expires_at_ms: v.expires_at_ms,
            available_floor: v.available_floor,
            grants: v.grants,
            exclusions: [],
            note: "",
          }
        : a.kind === "claim"
          ? { category: v.category }
          : {};
    await this.review(a.kind, input, a.id);
  }
}

// ---------- the one next action and the sentence (pure) ----------

export type Next =
  | { action: "check"; label: string; id: string }
  | { action: "continue"; label: string; id: string }
  | { action: "retry"; label: string }
  | { action: "apply"; label: string; intent: string }
  | { action: SaleKind; label: string; input?: Record<string, unknown> }
  | { action: "terms"; label: string }
  /** Job 003wf3 (aftercare): the new owner's primary action is operating the business. */
  | { action: "operate"; label: string; href: string }
  | { action: "none"; label: string; why: string };

/** DIRECT_SALE.md §7: first match wins. */
export function saleNext(st: SaleFlowState): Next {
  const s = st.setup;
  if (st.status === "error" || !s) return { action: "retry", label: "Try again" };
  const open = s.open[0];
  if (open)
    return open.state === "prepared"
      ? { action: "continue", label: "Continue in your wallet", id: open.id }
      : { action: "check", label: "Check what happened", id: open.id };
  if (!s.capability.supported && !s.roles.claimant)
    return {
      action: "none",
      label: "",
      why:
        s.capability.reason === "gated"
          ? "This business closes through a named closer, so a wallet sale can't close it here."
          : "This business's contract predates reviewed wallet sales here; it needs new contract code first.",
    };
  const r = s.roles;
  const d = s.control.live_deal;
  const unapplied = s.intents.find(
    (i) =>
      i.status === "recorded" &&
      s.outcomes.some(
        (o) => o.status === "closed" && o.seq === i.deal_seq && o.version === i.version,
      ),
  );
  if (unapplied) return { action: "apply", label: "Apply the close here", intent: unapplied.id };
  const p = s.party;
  const owed: [number, string][] = p
    ? (
        [
          [2, p.sale_proceeds_claim],
          [1, p.escrow_return_claim],
          [0, p.profit_claim],
        ] as [number, string][]
      ).filter(([, v]) => v !== "0")
    : [];
  if (owed.length > 0) {
    if (!s.token.registered)
      return { action: "register", label: "Register with the token to collect" };
    const [cat] = owed[0] as [number, string];
    return {
      action: "claim",
      label:
        cat === 2
          ? "Collect the sale proceeds"
          : cat === 1
            ? "Collect your returned escrow"
            : "Collect your claim",
      input: { category: cat },
    };
  }
  if (r.chain_owner && s.platform_operator && !s.metering_appointed && !d && r.new_owner)
    return { action: "appoint", label: "Appoint metering so customers continue" };
  if (d) {
    const expired = BigInt(s.block.timestamp_ms) >= BigInt(d.expires_at_ms);
    // Job 003wf3: a Gated sale that is closing changes only by its close or, after its deadline,
    // by either party ending it. The deadline alone reopens nothing.
    if (d.state === "closing" && (r.buyer || r.seller || r.former_seller)) {
      if (BigInt(s.block.timestamp_ms) >= BigInt(d.deadline_ms))
        return { action: "abort", label: "End the closing" };
      return {
        action: "none",
        label: "",
        why: "The sale is closing: Everstreet is checking the handover. Ownership changes only when the contract shows the close.",
      };
    }
    if (r.buyer || r.seller) {
      if (expired) return { action: "expire", label: "End the expired offer" };
      if (r.buyer && !s.token.registered)
        return { action: "register", label: "Register with the token" };
      if (r.buyer && d.escrow === "0") return { action: "fund", label: "Fund escrow" };
      if ((r.buyer && !d.buyer_accepted) || (r.seller && !d.seller_accepted)) {
        const other = r.buyer ? d.seller_accepted : d.buyer_accepted;
        return {
          action: "accept",
          label: other
            ? s.control.close_mode === "gated"
              ? `Accept version ${d.version} and start the closing`
              : `Accept version ${d.version} and close the sale`
            : `Accept version ${d.version}`,
        };
      }
      return {
        action: "none",
        label: "",
        why: r.buyer
          ? "Waiting for the seller to accept."
          : "Waiting for the buyer to fund and accept.",
      };
    }
  }
  // Astra's aftercare: after a close applied here, the new owner's primary action is running the
  // business; proposing a resale stays a secondary action on this page.
  if (r.new_owner && s.local_owner && !d)
    return { action: "operate", label: "Open your business", href: `/desk/${s.business.id}` };
  if (r.seller && !d) return { action: "terms", label: "Prepare terms" };
  return { action: "none", label: "", why: "Nothing needs you here now." };
}

/**
 * The ONE sale this page is about (Astra's controller review 1; the CurrentSaleAccepted
 * invariant): the live deal if there is one, else the newest ended or closed deal. Earlier
 * outcomes are history and never complete a step of the current sale.
 */
export function currentSale(
  s: SaleSetup,
):
  | { kind: "live"; deal: NonNullable<SaleSetup["control"]["live_deal"]> }
  | { kind: "ended"; outcome: SaleSetup["outcomes"][number] }
  | { kind: "none" } {
  const d = s.control.live_deal;
  if (d) return { kind: "live", deal: d };
  const newest = [...s.outcomes].sort((a, b) => (BigInt(b.seq) > BigInt(a.seq) ? 1 : -1))[0];
  return newest ? { kind: "ended", outcome: newest } : { kind: "none" };
}

/**
 * Who this person is IN THE DEAL THE PAGE SHOWS (Astra's 00:21 review), not what they may do
 * next: after a close, the buyer who now owns the business may propose a resale (`roles.seller`,
 * a permission, unchanged), but in the closed deal shown they are its buyer and the new owner.
 * "The seller" is said only when they are the named seller of the live deal, or the owner with no
 * live or closed deal shown (a sale they may start or one that ended without a change).
 */
export function saleRoleWords(s: SaleSetup): string {
  const r = s.roles;
  const me = s.account;
  const c = currentSale(s);
  if (c.kind === "live") {
    if (c.deal.seller === me) return "the seller";
    if (c.deal.buyer === me) return "the buyer";
  } else if (c.kind === "ended" && c.outcome.status === "closed") {
    if (c.outcome.buyer === me) return `the new owner (buyer in deal ${c.outcome.seq})`;
    if (c.outcome.seller === me) return "the former seller";
  } else if (c.kind === "ended" && c.outcome.buyer === me && !r.seller) {
    return `the buyer in deal ${c.outcome.seq} (it ${c.outcome.status === "aborted" ? "was aborted" : `was ${c.outcome.status}`})`;
  }
  if (r.former_seller) return "the former seller";
  if (r.new_owner) return "the new owner";
  if (r.seller && c.kind !== "live") return "the seller";
  if (r.buyer) return "the buyer";
  return "a participant";
}

/** One sentence from the reading (never more than it shows). */
export function saleSentence(s: SaleSetup): string {
  const at = `Read at block ${s.block.height}.`;
  const c = currentSale(s);
  if (c.kind === "live") {
    const d = c.deal;
    const acc = [d.seller_accepted && "the seller", d.buyer_accepted && "the buyer"]
      .filter(Boolean)
      .join(" and ");
    return `Deal ${d.seq}, version ${d.version}: ${d.escrow === "0" ? "escrow not funded" : "escrow funded"}; ${acc ? `accepted by ${acc}` : "nobody has accepted yet"}. ${at}`;
  }
  if (c.kind === "ended")
    return c.outcome.status === "closed"
      ? `Deal ${c.outcome.seq} closed on the contract: ${c.outcome.buyer} controls the business now. ${at}`
      : `Deal ${c.outcome.seq} ended (${c.outcome.status}); no sale is in progress. ${at}`;
  return `No sale is in progress. ${at}`;
}

export type StepStatus = "done" | "current" | "waiting" | "unknown";
/**
 * The current sale's progression, in words (never colour alone): only facts about THAT deal
 * complete a step. The seller's collection is a separate step, done only from the seller's own
 * confirmed payout evidence; anyone else sees it as not shown to them (Astra's review 2).
 */
export function saleSteps(s: SaleSetup) {
  const c = currentSale(s);
  const step = (key: string, title: string, status: StepStatus, detail = "") => ({
    key,
    title,
    status,
    detail,
  });
  if (c.kind === "none")
    return [step("terms", "Terms proposed", s.roles.seller ? "current" : "waiting")];
  if (c.kind === "live") {
    const d = c.deal;
    const funded = d.escrow !== "0";
    return [
      step("terms", `Terms proposed (version ${d.version})`, "done"),
      step("escrow", "Escrow funded", funded ? "done" : "current"),
      step("accept", "Both accept (closes)", funded ? "current" : "waiting"),
      step("apply", "Applied here", "waiting"),
      step("operate", "Buyer operates", "waiting"),
      step("collect", "Seller collects the proceeds", "waiting"),
    ];
  }
  const o = c.outcome;
  if (o.status !== "closed")
    return [
      step("terms", `Terms proposed (version ${o.version})`, "done"),
      step("ended", `Ended without a sale (${o.status})`, "done"),
    ];
  const applied = s.intents.some(
    (i) => i.deal_seq === o.seq && i.version === o.version && i.status === "applied",
  );
  const mineAsSeller = o.seller === s.account;
  // Only a proceeds claim bound to THIS sale (its review names the deal) speaks for it; an older
  // sale's confirmed payout says nothing about this one (Astra's repeat-sale counterexample).
  const forThis = s.actions.filter(
    (a) => a.kind === "claim" && a.review.category === 2 && a.review.for_deal === o.seq,
  );
  const paidEvidence = forThis.some(
    (a) => a.evidence?.kind === "confirmed" && a.evidence.result === "paid",
  );
  const inFlight =
    forThis.some((a) =>
      ["prepared", "requested", "unknown", "no_longer_possible"].includes(a.state),
    ) || s.payouts.some((p) => p.kind === "sale_proceeds");
  const owed = s.party ? s.party.sale_proceeds_claim !== "0" : false;
  const collect: StepStatus = !mineAsSeller
    ? "unknown"
    : paidEvidence && !owed && !inFlight
      ? "done"
      : owed || inFlight
        ? "current"
        : "unknown";
  return [
    step("terms", `Terms proposed (version ${o.version})`, "done"),
    step("escrow", "Escrow funded", "done"),
    step("accept", "Both accept (closes)", "done"),
    step("apply", "Applied here", applied ? "done" : "current"),
    step("operate", "Buyer operates", applied ? "done" : "waiting"),
    step(
      "collect",
      "Seller collects the proceeds",
      collect,
      !mineAsSeller
        ? "Not shown to you: only the seller sees their own collection."
        : collect === "unknown"
          ? "No payout of the proceeds is shown here."
          : collect === "current"
            ? "Owed or in flight; not paid until a payout is confirmed."
            : "Paid: confirmed by its own transaction.",
    ),
  ];
}
