// Job 003s: the digital acquisition workspace (docs/design/ACQUISITION_WORKSPACE.md).
//
// Owner (OwnerHandover): reads the recorded v3 evidence and the business's sale intents, reviews
// the observed live deal exactly as observed, and records that exact version (seq, version and
// digest taken from the evidence, never typed). Refreshing evidence is its own deliberate action.
// Participants (Handovers): the seller's and buyer's own minimal receipts, and a deliberate,
// explained reconciliation that applies a matching closed sale here at most once. Opening a page,
// a receipt or refreshing evidence never reconciles. Nothing here signs, pays or closes on NEAR.

import { ApiError } from "./api.ts";
import { MalformedAnswer } from "./customerApi.ts";
import type { Storage } from "./customerWorkspace.ts";
import {
  type Handover,
  type HandoverPort,
  type Intent,
  type ObservedDeal,
  parseEvidence,
  parseHandovers,
  parseIntent,
  parseIntents,
  parseReconcile,
  parseRefresh,
  type ReconcileAnswer,
  type RefreshAnswer,
  type SaleEvidence,
} from "./handoverApi.ts";

export interface Notice {
  tone: "ok" | "warn" | "error";
  code: string | null;
  message: string;
}

const LOST =
  "We didn't get an answer. Nothing is lost: asking again sends the same request and never records or applies anything twice.";
const messageOf = (e: unknown) =>
  e instanceof ApiError
    ? e.message
    : e instanceof MalformedAnswer
      ? "The answer wasn't in the expected form, so nothing new is shown. You can try again."
      : LOST;
const unanswered = (e: unknown) =>
  !(e instanceof ApiError) || e.status >= 500 || e instanceof MalformedAnswer;

export const SELLER_ACCESS_ENDED =
  "You no longer manage this business here, so its records aren't shown. Your handover receipt stays below.";
const ACCESS_UNCONFIRMED =
  "We couldn't confirm that you still manage this business, so changes are paused. Check access to continue; nothing was changed.";

/** What applying a matching close does here, said before the participant confirms it. */
export const APPLY_EFFECTS = [
  "The app reads the contract again. Only an exactly matching closed sale is applied; anything else changes nothing.",
  "If it matches: the business, its products, releases and customer offers move to the buyer here, in one step, once.",
  "The seller's team access, listing and data-room access end; the seller keeps only this receipt.",
  "Customers keep their requests, results and units; nobody gains access to them.",
  "Not handed over by this: domains, provider accounts or other external services.",
];

const sameDeal = (a: ObservedDeal | null, b: { seq: string; version: number; digest: string }) =>
  a !== null && a.seq === b.seq && a.version === b.version && a.digest === b.digest;

/**
 * Job 003s1: why the current reading can't be the basis of a new record, or null if it can. The
 * terms stay visible either way; only the action is withheld. A flagged reading (the backend
 * refuses it too), a stale one (older than its freshness window: read again first), and a chain
 * owner that doesn't map to this business's owner here are disqualifying.
 */
export function reviewProblem(ev: SaleEvidence | null): string | null {
  const o = ev?.observed;
  if (!o) return "Nothing has been read from the contract yet.";
  if (!o.deal) return "The reading shows no sale in progress.";
  if (o.flag)
    return `This reading is flagged (${o.flag.code}): ${o.flag.message} It can't be recorded from.`;
  if (o.freshness === "stale")
    return "This reading is older than its freshness window. Read the contract again before recording.";
  if (o.owner_match !== "matches")
    return "The contract's owner account doesn't map to this business's owner here, so this can't be recorded.";
  return null;
}

// ---------- owner ----------

interface PendingRecord {
  idempotency_key: string;
  deal_seq: string;
  version: number;
  digest: string;
}

export interface OwnerHandoverState {
  status: "loading" | "ready" | "gone" | "error";
  access: "confirmed" | "unconfirmed";
  evidence: SaleEvidence | null;
  intents: Intent[];
  /** The live deal the owner is reviewing, exactly as observed; dropped if the evidence moves. */
  reviewing: ObservedDeal | null;
  /** A record request without an answer: its exact deal, apart from what is shown now. */
  unanswered: { seq: string; version: number } | null;
  /** The intent waiting for a second, confirming click before it is reconciled. */
  confirmApply: string | null;
  answers: Record<string, ReconcileAnswer>;
  /** After access ended: the seller's own receipts for this business (minimal). */
  receipts: Handover[];
  busy: "load" | "refresh" | "record" | "recover" | "reconcile" | "check_access" | null;
  notice: Notice | null;
}

export class OwnerHandover {
  private state: OwnerHandoverState = {
    status: "loading",
    access: "confirmed",
    evidence: null,
    intents: [],
    reviewing: null,
    unanswered: null,
    confirmApply: null,
    answers: {},
    receipts: [],
    busy: null,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private alive = true;
  private generation = 0;
  private pending: PendingRecord | null = null;

  constructor(
    private readonly port: HandoverPort,
    private readonly opts: {
      personId: string;
      businessId: string;
      storage?: Storage | null;
      makeKey?: () => string;
    },
  ) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  dispose() {
    this.alive = false;
    this.generation++;
    this.listeners.clear();
  }
  private set(p: Partial<OwnerHandoverState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  private key() {
    return `everstreet.handover.${this.opts.personId}.${this.opts.businessId}`;
  }
  private remember(p: PendingRecord | null) {
    try {
      if (p) this.opts.storage?.setItem(this.key(), JSON.stringify(p));
      else this.opts.storage?.removeItem(this.key());
    } catch {
      // Denied storage: recovery after a reload isn't available; on this page it still is.
    }
  }
  private recall(): PendingRecord | null {
    try {
      const v = JSON.parse(this.opts.storage?.getItem(this.key()) ?? "null") as PendingRecord;
      return v &&
        typeof v.idempotency_key === "string" &&
        /^[A-Za-z0-9_-]{8,80}$/.test(v.idempotency_key) &&
        typeof v.deal_seq === "string" &&
        /^(0|[1-9][0-9]{0,19})$/.test(v.deal_seq) &&
        Number.isSafeInteger(v.version) &&
        typeof v.digest === "string" &&
        /^[0-9a-f]{64}$/.test(v.digest)
        ? {
            idempotency_key: v.idempotency_key,
            deal_seq: v.deal_seq,
            version: v.version,
            digest: v.digest,
          }
        : null;
    } catch {
      return null;
    }
  }

  /** Access ended: clear everything private; show only this person's receipts for it. */
  private async gone(gen: number) {
    this.pending = null;
    this.remember(null);
    this.set({
      status: "gone",
      evidence: null,
      intents: [],
      reviewing: null,
      unanswered: null,
      confirmApply: null,
      notice: { tone: "warn", code: "access_ended", message: SELLER_ACCESS_ENDED },
    });
    try {
      const mine = parseHandovers(await this.port.mine());
      if (gen === this.generation)
        this.set({ receipts: mine.filter((h) => h.business.id === this.opts.businessId) });
    } catch {
      // The receipts are a convenience here; /handovers lists them too.
    }
  }

  private async load(gen: number) {
    const [e, i] = await Promise.all([
      this.port.evidence(this.opts.businessId),
      this.port.intents(this.opts.businessId),
    ]);
    const evidence = parseEvidence(e);
    const intents = parseIntents(i);
    if (gen !== this.generation) return;
    // A review is only of the deal now observed: if the evidence moved, it is set aside.
    const r = this.state.reviewing;
    const deal = evidence.observed?.deal ?? null;
    // Same seq, version and contract digest means the same terms (revise_sale raises the version);
    // acceptance and escrow are progress, shown as now observed.
    const reviewing = r && deal && sameDeal(deal, r) && !reviewProblem(evidence) ? deal : null;
    this.set({ status: "ready", access: "confirmed", evidence, intents, reviewing });
  }

  private async act(
    busy: NonNullable<OwnerHandoverState["busy"]>,
    f: (g: number) => Promise<void>,
  ) {
    if (this.state.busy || !this.alive || this.state.status === "gone") return;
    const gen = this.generation;
    this.set({ busy, notice: null });
    try {
      await f(gen);
    } catch (e) {
      if (gen !== this.generation) return;
      const doubt =
        e instanceof ApiError &&
        (e.status === 404 || (e.status === 409 && e.code === "control_changed"));
      if (doubt) {
        try {
          await this.load(gen);
        } catch (again) {
          if (gen !== this.generation) return;
          if (again instanceof ApiError && again.status === 404) return void (await this.gone(gen));
          this.set({
            access: "unconfirmed",
            reviewing: null,
            confirmApply: null,
            notice: { tone: "warn", code: "access_unconfirmed", message: ACCESS_UNCONFIRMED },
          });
          return;
        }
      }
      if (gen !== this.generation) return;
      this.set({
        notice: {
          tone: e instanceof ApiError && e.status < 500 ? "error" : "warn",
          code: e instanceof ApiError ? (e.code ?? null) : null,
          message: messageOf(e),
        },
      });
    } finally {
      if (gen === this.generation) this.set({ busy: null });
    }
  }

  private paused() {
    if (this.state.access !== "unconfirmed") return false;
    this.set({ notice: { tone: "warn", code: "access_unconfirmed", message: ACCESS_UNCONFIRMED } });
    return true;
  }

  async start() {
    const stored = this.recall();
    if (stored && !this.pending) {
      this.pending = stored;
      this.set({ unanswered: { seq: stored.deal_seq, version: stored.version } });
    }
    await this.act("load", async (gen) => {
      try {
        await this.load(gen);
      } catch (e) {
        if (gen !== this.generation) return;
        if (e instanceof ApiError && e.status === 404) return void (await this.gone(gen));
        this.set({ status: this.state.evidence ? "ready" : "error" });
        throw e;
      }
    });
  }

  checkAccess() {
    return this.act("check_access", async (gen) => {
      try {
        await this.load(gen);
      } catch (e) {
        if (gen !== this.generation) return;
        if (e instanceof ApiError && e.status === 404) return void (await this.gone(gen));
        throw e;
      }
    });
  }

  /** Reads the contract again (owner, deliberate). It records evidence; it never reconciles. */
  refreshEvidence() {
    if (this.paused()) return Promise.resolve();
    return this.act("refresh", async (gen) => {
      const raw = await this.port.refresh(this.opts.businessId);
      let answer: RefreshAnswer;
      try {
        answer = parseRefresh(raw);
      } catch {
        // 003s1: not the refresh's actual form. Nothing shown is replaced; reading again is safe.
        if (gen === this.generation)
          this.set({
            notice: {
              tone: "warn",
              code: "refresh_malformed",
              message:
                "The read's answer wasn't in the expected form, so nothing shown here changed. You can read again.",
            },
          });
        return;
      }
      await this.load(gen);
      if (gen !== this.generation) return;
      const ok = answer.outcome === "accepted" || answer.outcome === "duplicate";
      this.set({
        notice: {
          tone: ok ? "ok" : "warn",
          code: `refresh_${answer.outcome}`,
          message: answer.message,
        },
      });
    });
  }

  /** Starts reviewing the live deal exactly as observed now, if that reading can be used. */
  review() {
    const problem = reviewProblem(this.state.evidence);
    if (problem) {
      this.set({
        reviewing: null,
        notice: { tone: "warn", code: "evidence_disqualified", message: problem },
      });
      return;
    }
    this.set({ reviewing: this.state.evidence?.observed?.deal ?? null, notice: null });
  }

  /** Records the reviewed deal version. While a record is unanswered, only it may be resent. */
  record() {
    if (this.paused()) return Promise.resolve();
    if (this.pending) {
      this.set({
        notice: {
          tone: "warn",
          code: "recover_first",
          message:
            "An earlier record request wasn't answered. Recover it first: it's the same request, so nothing is recorded twice.",
        },
      });
      return Promise.resolve();
    }
    const problem = reviewProblem(this.state.evidence);
    if (problem) {
      this.set({
        reviewing: null,
        notice: { tone: "warn", code: "evidence_disqualified", message: problem },
      });
      return Promise.resolve();
    }
    const r = this.state.reviewing;
    const now = this.state.evidence?.observed?.deal ?? null;
    if (!r || !sameDeal(now, r)) {
      this.set({
        reviewing: null,
        notice: {
          tone: "warn",
          code: "not_reviewed",
          message: "Review the sale as it is observed now before recording it.",
        },
      });
      return Promise.resolve();
    }
    this.pending = {
      idempotency_key: (this.opts.makeKey ?? (() => `intent-${crypto.randomUUID()}`))(),
      deal_seq: r.seq,
      version: r.version,
      digest: r.digest,
    };
    this.remember(this.pending);
    return this.act("record", (gen) => this.send(gen));
  }

  recoverOriginal() {
    if (!this.pending || this.paused()) return Promise.resolve();
    return this.act("recover", (gen) => this.send(gen));
  }

  private async send(gen: number) {
    const p = this.pending as PendingRecord;
    try {
      const a = (await this.port.record(this.opts.businessId, p)) as { intent?: unknown };
      const intent = parseIntent(a?.intent);
      if (
        intent.deal.seq !== p.deal_seq ||
        intent.deal.version !== p.version ||
        intent.deal.digest !== p.digest
      )
        throw new MalformedAnswer("The answer named another deal.");
    } catch (e) {
      if (gen === this.generation) {
        if (unanswered(e)) this.set({ unanswered: { seq: p.deal_seq, version: p.version } });
        else {
          this.pending = null;
          this.remember(null);
          const moved = e instanceof ApiError && e.code === "deal_mismatch";
          this.set({ unanswered: null, reviewing: moved ? null : this.state.reviewing });
        }
        await this.load(gen).catch(() => {});
      }
      throw e;
    }
    if (gen !== this.generation) return;
    this.pending = null;
    this.remember(null);
    this.set({
      unanswered: null,
      reviewing: null,
      notice: {
        tone: "ok",
        code: "intent_recorded",
        message:
          "Recorded this exact version. Nothing was signed or sent; the sale itself happens on the contract.",
      },
    });
    await this.load(gen);
  }

  /** First click explains; the second asks the app to reconcile that exact intent. */
  reconcile(intentId: string) {
    if (this.paused()) return Promise.resolve();
    if (this.state.confirmApply !== intentId) {
      this.set({ confirmApply: intentId, notice: null });
      return Promise.resolve();
    }
    return this.act("reconcile", async (gen) => {
      let answer: ReconcileAnswer;
      try {
        answer = parseReconcile(await this.port.reconcile(this.opts.businessId, intentId));
        if (answer.receipt.intent_id !== intentId)
          throw new MalformedAnswer("The answer named another intent.");
      } catch (e) {
        if (gen === this.generation && unanswered(e))
          this.set({
            notice: {
              tone: "warn",
              code: "reconcile_unanswered",
              message:
                "No answer came back. Checking again is safe: a matching sale is applied here at most once.",
            },
          });
        if (unanswered(e)) return;
        throw e;
      }
      if (gen !== this.generation) return;
      this.set({
        confirmApply: null,
        answers: { ...this.state.answers, [intentId]: answer },
        notice: {
          tone: answer.state === "applied" || answer.state === "already" ? "ok" : "warn",
          code: `reconcile_${answer.state}`,
          message: answer.message,
        },
      });
      // Applied: this person (the seller) no longer manages the business; the load says so.
      await this.load(gen).catch(async (e) => {
        if (e instanceof ApiError && e.status === 404 && gen === this.generation)
          await this.gone(gen);
      });
    });
  }

  cancelApply() {
    this.set({ confirmApply: null });
  }
}

// ---------- participants: my receipts ----------

export interface HandoversState {
  status: "loading" | "ready" | "error";
  handovers: Handover[];
  confirmApply: string | null;
  answers: Record<string, ReconcileAnswer>;
  busy: "load" | "reconcile" | null;
  notice: Notice | null;
}

export class Handovers {
  private state: HandoversState = {
    status: "loading",
    handovers: [],
    confirmApply: null,
    answers: {},
    busy: null,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private alive = true;
  private generation = 0;

  constructor(private readonly port: HandoverPort) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  dispose() {
    this.alive = false;
    this.generation++;
    this.listeners.clear();
  }
  private set(p: Partial<HandoversState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  /** Reads this person's receipts. It never reconciles anything. */
  async load() {
    if (this.state.busy) return;
    const gen = this.generation;
    this.set({ busy: "load" });
    try {
      const handovers = parseHandovers(await this.port.mine());
      if (gen === this.generation) this.set({ status: "ready", handovers });
    } catch (e) {
      if (gen === this.generation)
        this.set({
          status: this.state.handovers.length ? "ready" : "error",
          notice: { tone: "warn", code: null, message: messageOf(e) },
        });
    } finally {
      if (gen === this.generation) this.set({ busy: null });
    }
  }

  /** First click explains the effects; the second asks the app to reconcile that intent once. */
  async reconcile(h: Handover) {
    const id = h.receipt.intent_id;
    if (this.state.busy) return;
    if (this.state.confirmApply !== id) {
      this.set({ confirmApply: id, notice: null });
      return;
    }
    const gen = this.generation;
    this.set({ busy: "reconcile", notice: null });
    try {
      const answer = parseReconcile(await this.port.reconcile(h.business.id, id));
      if (answer.receipt.intent_id !== id)
        throw new MalformedAnswer("The answer named another intent.");
      if (gen !== this.generation) return;
      this.set({
        confirmApply: null,
        answers: { ...this.state.answers, [id]: answer },
        notice: {
          tone: answer.state === "applied" || answer.state === "already" ? "ok" : "warn",
          code: `reconcile_${answer.state}`,
          message: answer.message,
        },
      });
      const handovers = parseHandovers(await this.port.mine());
      if (gen === this.generation) this.set({ handovers });
    } catch (e) {
      if (gen !== this.generation) return;
      this.set({
        notice: {
          tone: unanswered(e) ? "warn" : "error",
          code: unanswered(e)
            ? "reconcile_unanswered"
            : e instanceof ApiError
              ? (e.code ?? null)
              : null,
          message: unanswered(e)
            ? "No answer came back. Checking again is safe: a matching sale is applied here at most once."
            : messageOf(e),
        },
      });
    } finally {
      if (gen === this.generation) this.set({ busy: null });
    }
  }

  cancelApply() {
    this.set({ confirmApply: null });
  }
}
