// Job 003q: the customer product workspace's state and every request it makes. The page renders
// this; the rules are tested without a browser (web/test/customerWorkspace.test.ts).
//
// - One request at a time. A late answer after the page closed, the person changed, or a new
//   request was started lands nowhere (a generation counter).
// - What the customer is typing (the draft) stays separate from the exact document an accepted
//   request was prepared from. Retyping never changes a prepared request.
// - A lost prepare reply is retried with the same opaque key and the same document: the same
//   request is found, never a second one. Only that opaque key and the request id are kept in
//   session storage, scoped to the person and offer: never the document, result, salt or signature.
// - Nothing is authorized until the browser has recomputed the envelope itself
//   (customerEnvelope.ts). Without an authorizer the review still works; authorizing is
//   explained as unavailable.
// - A 404 on the customer's own request means access ended: the request, its result and any
//   unsent text are cleared from the page.
// - Unit outcomes are only what the contract's views said, with their block and time.

import { ApiError } from "./api.ts";
import {
  type CustomerPort,
  MalformedAnswer,
  type OfferView,
  parseOffer,
  parseResult,
  parseUse,
  parseUses,
  type ResultView,
  type UseSummary,
  type UseView,
} from "./customerApi.ts";
import { AUTHORIZATION_UNAVAILABLE, type CustomerAuthorizer } from "./customerAuthorizer.ts";
import { sha256Hex, verifyEnvelope } from "./customerEnvelope.ts";

export interface Notice {
  tone: "info" | "ok" | "warn" | "error";
  code: string | null;
  message: string;
}

export interface WorkspaceState {
  status: "loading" | "ready" | "gone" | "error";
  offer: OfferView | null;
  use: UseView | null;
  recent: UseSummary[];
  /** What the customer is typing now. */
  draft: string;
  /** The exact document the current request was prepared from (memory only). */
  accepted: string | null;
  /** The browser's own check of the current prepared envelope. */
  check: { ok: boolean; problem: string | null } | null;
  /** The customer's result, once asked for (memory only). */
  result: ResultView | null;
  /** The action in flight, if any. */
  busy: Action | null;
  notice: Notice | null;
  authorizer: { label: string; synthetic: boolean } | null;
  /**
   * 003q1: a prepare whose answer never arrived (its size only; its text stays in memory, never
   * in state or storage). While set, no other request is made; it can only be recovered.
   */
  unanswered: { chars: number } | null;
  /**
   * 003r1: a new request was refused because an earlier, stopped request's authorization stays
   * valid until its deadline. The draft is kept; checking again is the customer's choice.
   */
  waiting: { request_id: string | null; until_ms: string } | null;
  /**
   * 001j1: an action that changes this request was sent and its answer was lost (no answer, a
   * gateway failure or an unreadable one). The server may have acted, so the request shown is
   * the state from before it. Until a fresh read of the same request answers, the only next step
   * is to check it: never run, authorize, return or cancel again on that stale state. Cleared by a
   * fresh answer for this request, access ending or leaving the request; never by elapsed time.
   */
  inDoubt: { action: DoubtAction; useId: string } | null;
}

/** The actions that change a request on the server; a lost answer leaves them in doubt. */
export type DoubtAction = "authorize" | "run" | "release" | "check_unit" | "cancel";
const DOUBT: readonly Action[] = ["authorize", "run", "release", "check_unit", "cancel"];

/** A failure on this device before anything was sent (001j1): definite, never "answer lost". */
class NotSent extends Error {
  constructor(readonly cause: unknown) {
    super("not sent");
  }
}
const NOT_SENT =
  "Your authorization wasn't completed on this device, so nothing was sent and nothing is held. You can authorize this same request again.";

/** No answer, a gateway failure, or an answer we couldn't read: the server may have acted. */
const unansweredError = (e: unknown) =>
  !(e instanceof ApiError) || e.status >= 500 || e instanceof MalformedAnswer;

const DOUBT_WHY: Record<DoubtAction, string> = {
  authorize:
    "Your authorization was sent, but no answer came back. It may have been received. Check this request before anything else: nothing is signed again by checking.",
  run: "Your request to run it was sent, but no answer came back. It may have run. Check this request: it is never run again automatically, and checking makes no new run.",
  release:
    "Your request to return the unit was sent, but no answer came back. Check this request to see what the contract and this app now show.",
  check_unit:
    "Your request to settle the unit was sent, but no answer came back. Check this request to see its unit now.",
  cancel:
    "Your request to cancel was sent, but no answer came back. Check this request to see whether it was cancelled.",
};

const at = (ms: string) => new Date(Number(ms)).toLocaleString();
const WAIT_WHY = (ms: string) =>
  `The authorization prepared for your stopped request stays valid on the contract until ${at(ms)}. To keep your units safe, a new request for them can start only after that. Nothing is signed or created by checking; your document is kept.`;

export type Action =
  | "recover_original"
  | "prepare"
  | "match_document"
  | "authorize"
  | "check_reservation"
  | "run"
  | "show_result"
  | "check_unit"
  | "release"
  | "cancel"
  | "refresh"
  | "check_request"
  | "start_another";

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const LOST =
  "We didn't get an answer. Nothing is lost: trying again finds the same request, never a second one.";
export const ACCESS_ENDED =
  "This request is no longer available to you here. Nothing private from it is kept on this page.";

const message = (e: unknown) =>
  e instanceof ApiError
    ? e.message
    : e instanceof MalformedAnswer
      ? "The answer wasn't in the expected form, so nothing new is shown. You can try again."
      : LOST;

export class CustomerWorkspace {
  private state: WorkspaceState = {
    status: "loading",
    offer: null,
    use: null,
    recent: [],
    draft: "",
    accepted: null,
    check: null,
    result: null,
    busy: null,
    notice: null,
    authorizer: null,
    unanswered: null,
    waiting: null,
    inDoubt: null,
  };
  private listeners = new Set<() => void>();
  private alive = true;
  /** Bumped by "start another" and retirement: older answers land nowhere. */
  private generation = 0;
  /** A prepare whose answer was lost: its key and exact document, to retry the same request. */
  private pending: { key: string; text: string } | null = null;

  constructor(
    private readonly port: CustomerPort,
    private readonly opts: {
      personId: string;
      offerId?: string;
      useId?: string;
      authorizer: () => CustomerAuthorizer | null;
      now?: () => number;
      storage?: Storage | null;
      makeKey?: () => string;
    },
  ) {
    const a = opts.authorizer();
    this.state.authorizer = a ? { label: a.label, synthetic: a.synthetic } : null;
  }

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  retire() {
    this.alive = false;
    this.generation++;
    this.listeners.clear();
  }
  private set(patch: Partial<WorkspaceState>) {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private now() {
    return (this.opts.now ?? Date.now)();
  }
  private storeKey(offerId: string) {
    return `everstreet.use.${this.opts.personId}.${offerId}`;
  }
  /** Best effort (003q1): denied storage never blocks an action; in-session recovery still works. */
  private remember(offerId: string, v: { key: string; id?: string } | null) {
    const s = this.opts.storage;
    if (!s) return;
    try {
      if (v) s.setItem(this.storeKey(offerId), JSON.stringify(v));
      else s.removeItem(this.storeKey(offerId));
    } catch {
      // Storage denied: recovery after a reload isn't available, nothing else changes.
    }
  }
  private recall(offerId: string): { key: string; id?: string } | null {
    try {
      const v = JSON.parse(this.opts.storage?.getItem(this.storeKey(offerId)) ?? "null");
      return v && typeof v.key === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(v.key)
        ? { key: v.key, id: typeof v.id === "string" ? v.id : undefined }
        : null;
    } catch {
      return null;
    }
  }

  /** Access to this request ended: forget everything private. */
  private gone() {
    if (this.state.offer) this.remember(this.state.offer.offer_id, null);
    this.pending = null;
    this.set({
      status: "gone",
      use: null,
      result: null,
      accepted: null,
      draft: "",
      check: null,
      busy: null,
      unanswered: null,
      waiting: null,
      inDoubt: null,
      notice: { tone: "warn", code: "access_ended", message: ACCESS_ENDED },
    });
  }

  /** Runs one action; its answer is applied only if nothing newer replaced the page meanwhile. */
  private async act(action: Action, f: (gen: number) => Promise<void>) {
    if (this.state.busy || !this.alive) return;
    const gen = this.generation;
    this.set({ busy: action, notice: null });
    try {
      await f(gen);
    } catch (e) {
      if (gen !== this.generation) return;
      if (e instanceof ApiError && e.status === 404 && this.state.use) return this.gone();
      const use = this.state.use;
      if (e instanceof NotSent) {
        this.set({ notice: { tone: "warn", code: "not_sent", message: NOT_SENT } });
        return;
      }
      if (DOUBT.includes(action) && use && unansweredError(e)) {
        // 001j1: the server may have acted; the request shown is stale until it is read again.
        const doubt = action as DoubtAction;
        this.set({
          inDoubt: { action: doubt, useId: use.id },
          notice: { tone: "warn", code: "answer_lost", message: DOUBT_WHY[doubt] },
        });
        return;
      }
      const unavailable = e instanceof ApiError && e.status === 503;
      this.set({
        notice: {
          tone: unavailable ? "warn" : "error",
          code: e instanceof ApiError ? (e.code ?? null) : null,
          message: message(e),
        },
      });
    } finally {
      if (gen === this.generation) this.set({ busy: null });
    }
  }

  private applyUse(raw: unknown, gen: number) {
    if (gen !== this.generation) return false;
    const use = parseUse(raw);
    // 001j1: a fresh, readable answer from the server is the request's state now: any doubt
    // about a lost answer is settled by it (for another request, the doubt no longer applies).
    this.set({ use, offer: use.offer, status: "ready", inDoubt: null });
    return true;
  }

  async start() {
    const gen = this.generation;
    try {
      if (this.opts.useId) {
        this.applyUse(await this.port.use(this.opts.useId), gen);
      } else if (this.opts.offerId) {
        const answer = (await this.port.offer(this.opts.offerId)) as { offer?: unknown } | null;
        const offer = parseOffer(answer?.offer);
        if (gen !== this.generation) return;
        this.set({ offer, status: "ready" });
        // A request from before a reload: by its id, or (its answer lost) by its exact key.
        const r = this.recall(offer.offer_id);
        if (r?.id) this.applyUse(await this.port.use(r.id), gen);
        else if (r?.key) {
          try {
            this.applyUse(await this.port.byKey(r.key), gen);
            this.remember(offer.offer_id, { key: r.key, id: this.state.use?.id });
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 404)) throw e;
            // The server never recorded that attempt: say so; a new request is the customer's call.
            this.remember(offer.offer_id, null);
            this.set({
              notice: {
                tone: "info",
                code: "earlier_attempt_not_recorded",
                message:
                  "An earlier attempt on this page didn't get an answer and isn't recorded, so nothing was prepared or held. You can review a use again.",
              },
            });
          }
        }
      }
    } catch (e) {
      if (gen !== this.generation) return;
      if (e instanceof ApiError && e.status === 404) return this.gone();
      this.set({ status: "error", notice: { tone: "error", code: null, message: message(e) } });
      return;
    }
    await this.loadRecent();
    if (this.state.use?.state === "prepared") await this.checkEnvelope();
  }

  async loadRecent() {
    const gen = this.generation;
    try {
      const recent = parseUses(await this.port.uses());
      if (gen === this.generation) this.set({ recent });
    } catch {
      // The list is a convenience; the request itself is unaffected.
    }
  }

  setDraft(text: string) {
    this.set({ draft: text });
  }

  /**
   * Prepares one use from the draft. While an earlier attempt is unanswered (003q1) nothing new is
   * made, whatever the draft says: that attempt can only be recovered (`recoverOriginal`).
   */
  prepare() {
    const offer = this.state.offer;
    const text = this.state.draft;
    if (!offer) return;
    // The same document again is the same request: recover it.
    if (this.pending && this.pending.text === text) return this.recoverOriginal();
    if (this.pending) {
      this.set({
        notice: {
          tone: "warn",
          code: "recover_first",
          message:
            "Your earlier request didn't get an answer yet. Recover it first: it may already be prepared, and a new one can't start while it's open.",
        },
      });
      return;
    }
    if (!text.trim()) return;
    if (text.length > offer.product.max_chars) {
      this.set({
        notice: {
          tone: "warn",
          code: "input_too_long",
          message: `This product reads up to ${offer.product.max_chars} characters; this document has ${text.length}.`,
        },
      });
      return;
    }
    const key = (this.opts.makeKey ?? (() => `use-${crypto.randomUUID()}`))();
    this.pending = { key, text };
    this.remember(offer.offer_id, { key });
    return this.act("prepare", (gen) => this.send(offer.offer_id, gen));
  }

  /** Retries the unanswered attempt exactly: its own key and document, never the draft. */
  recoverOriginal() {
    const offer = this.state.offer;
    if (!offer || !this.pending) return;
    return this.act("recover_original", (gen) => this.send(offer.offer_id, gen));
  }

  /** Sends the pending attempt; an unanswered outcome keeps it, a definite one ends it. */
  private async send(offerId: string, gen: number) {
    const p = this.pending as { key: string; text: string };
    try {
      const raw = await this.port.prepare(offerId, { idempotency_key: p.key, input: p.text });
      if (!this.applyUse(raw, gen)) return;
    } catch (e) {
      // Unanswered: no answer, a gateway failure, or an answer we couldn't read. The server may
      // have acted, so the attempt stays recoverable. A definite refusal ends it.
      const unanswered = unansweredError(e);
      if (gen === this.generation) {
        if (unanswered) this.set({ unanswered: { chars: p.text.length } });
        else {
          this.pending = null;
          this.remember(offerId, null);
          // 003r1: an earlier stopped request's window is still open: say until when.
          const d = e instanceof ApiError ? e.detail : undefined;
          const waiting =
            e instanceof ApiError &&
            e.code === "previous_window_open" &&
            typeof d?.until_ms === "string" &&
            /^[0-9]{1,20}$/.test(d.until_ms)
              ? {
                  request_id: typeof d.request_id === "string" ? d.request_id : null,
                  until_ms: d.until_ms,
                }
              : null;
          this.set({ unanswered: null, waiting });
        }
        await this.loadRecent();
      }
      throw e;
    }
    this.pending = null;
    this.remember(offerId, { key: p.key, id: this.state.use?.id });
    this.set({ accepted: p.text, result: null, unanswered: null, waiting: null });
    await this.checkEnvelope();
    await this.loadRecent();
  }

  /** The browser's own check of what would be authorized (never an opaque server hash). */
  async checkEnvelope() {
    const use = this.state.use;
    if (!use?.envelope) return this.set({ check: null });
    if (this.state.accepted === null) {
      return this.set({
        check: {
          ok: false,
          problem:
            "To check this request before authorizing it, paste the same document again: it isn't kept on this page after a reload.",
        },
      });
    }
    const a = this.opts.authorizer();
    const t = use.offer.terms;
    const r = await verifyEnvelope(use.envelope, {
      input: this.state.accepted,
      offerId: use.offer.offer_id,
      network: t.network,
      contract: t.contract,
      unitPrice: t.unit_price,
      asset: t.asset,
      retentionDays: t.retention_days,
      publicKey: a ? await a.publicKey() : null,
      now: this.now(),
    });
    if (use.id === this.state.use?.id)
      this.set({ check: r.ok ? { ok: true, problem: null } : { ok: false, problem: r.problem } });
  }

  /** After a reload, the customer pastes the same document: it must match the prepared one. */
  matchDocument() {
    const use = this.state.use;
    const text = this.state.draft;
    if (!use) return;
    return this.act("match_document", async (gen) => {
      const same = (await sha256Hex(text)) === use.input.sha256 && text.length === use.input.chars;
      if (gen !== this.generation) return;
      if (!same) {
        this.set({
          notice: {
            tone: "warn",
            code: "input_mismatch",
            message: "That isn't the document this request was prepared for.",
          },
        });
        return;
      }
      this.set({ accepted: text });
      await this.checkEnvelope();
    });
  }

  authorize() {
    const use = this.state.use;
    if (!use?.envelope || use.state !== "prepared") return;
    const a = this.opts.authorizer();
    if (!a) {
      this.set({
        notice: {
          tone: "warn",
          code: "authorization_unavailable",
          message: AUTHORIZATION_UNAVAILABLE,
        },
      });
      return;
    }
    return this.act("authorize", async (gen) => {
      const env = use.envelope as NonNullable<UseView["envelope"]>;
      let s: Awaited<ReturnType<CustomerAuthorizer["sign"]>>;
      // 001j1 (Astra's recovery review): everything before `confirm` happens on this device. A
      // failure here (the check, the key, the signer refusing) sent nothing, so it is never
      // treated as a lost answer: the same request can simply be authorized again.
      try {
        await this.checkEnvelope(); // again, now: the time to authorize may have passed
        if (gen !== this.generation) return;
        if (!this.state.check?.ok) return;
        s = await a.sign({
          hold_message_hex: env.hold.message_hex,
          use_message_hex: env.use.message_hex,
        });
      } catch (e) {
        throw new NotSent(e);
      }
      if (gen !== this.generation) return;
      this.applyUse(
        await this.port.confirm(use.id, { envelope_digest: env.envelope_digest, ...s }),
        gen,
      );
      await this.loadRecent();
    });
  }

  private onRequest(action: Action, call: (id: string) => Promise<unknown>) {
    const req = this.state.use;
    if (!req) return;
    return this.act(action, async (gen) => {
      this.applyUse(await call(req.id), gen);
      await this.loadRecent();
    });
  }

  checkReservation() {
    return this.onRequest("check_reservation", (id) => this.port.reconcile(id));
  }

  /**
   * 001j1: after a lost answer, reads this same request (a GET: it changes nothing) and says what
   * it found. A failed read keeps the doubt and this action; nothing is retried automatically.
   */
  checkRequest() {
    const req = this.state.use;
    const doubt = this.state.inDoubt;
    if (!req) return;
    return this.act("check_request", async (gen) => {
      if (!this.applyUse(await this.port.use(req.id), gen)) return;
      const now = this.state.use;
      if (doubt && now) this.set({ notice: found(doubt.action, now) });
      await this.loadRecent();
    });
  }
  refresh() {
    return this.onRequest("refresh", (id) => this.port.use(id));
  }
  cancel() {
    return this.onRequest("cancel", (id) => this.port.cancel(id));
  }
  checkUnit() {
    return this.onRequest("check_unit", (id) => this.port.units(id));
  }
  release() {
    return this.onRequest("release", (id) => this.port.release(id));
  }

  /** Runs the reserved use, with the accepted document if it is still in memory. */
  run() {
    const use = this.state.use;
    if (!use) return;
    const text = this.state.accepted;
    return this.act("run", async (gen) => {
      this.applyUse(await this.port.execute(use.id, text === null ? {} : { input: text }), gen);
      await this.loadRecent();
    });
  }

  showResult() {
    const use = this.state.use;
    if (!use) return;
    return this.act("show_result", async (gen) => {
      const result = parseResult(await this.port.result(use.id));
      if (gen === this.generation && use.id === this.state.use?.id) this.set({ result });
    });
  }

  /** Leaves this request (it stays in My activity) for a new one; the draft is kept. */
  startAnother() {
    // An unanswered attempt is never dropped here (003q1): it stays recoverable.
    if (this.pending) return;
    this.generation++;
    if (this.state.offer) this.remember(this.state.offer.offer_id, null);
    this.set({
      use: null,
      accepted: null,
      check: null,
      result: null,
      busy: null,
      notice: null,
      inDoubt: null,
    });
  }
}

/** 001j1: what a fresh read of the request showed after a lost answer, in plain words. */
function found(action: DoubtAction, u: UseView): Notice {
  const ok = (message: string): Notice => ({ tone: "ok", code: "request_checked", message });
  const x = u.execution;
  switch (action) {
    case "run":
      // Astra's recovery review: say what is recorded now; never infer more from the read.
      if (!x)
        return {
          tone: "info",
          code: "run_not_recorded",
          message:
            "Checked: no run is recorded for this request yet, and nothing has been charged for it. Running it uses this same request.",
        };
      if (x.state === "unknown")
        return {
          tone: "warn",
          code: "run_unknown",
          message:
            "Checked: it can't be told whether this run finished. It is never run again automatically, and it isn't charged.",
        };
      return x.state === "running"
        ? ok("Checked: it is running. It is never run twice.")
        : x.state === "completed"
          ? ok("Checked: the run finished. Nothing was run twice.")
          : {
              tone: "warn",
              code: "run_no_result",
              message: `Checked: the run ${x.state === "cancelled" ? "was cancelled" : "failed"} without a usable result. It isn't run again automatically.`,
            };
    case "authorize":
      return u.state === "prepared"
        ? {
            tone: "info",
            code: "authorization_not_recorded",
            message:
              "Checked: no authorization is recorded for this request yet, so nothing is held now. You can authorize this same request.",
          }
        : ok("Checked: your authorization was received. What happened next is shown below.");
    default:
      return ok("Checked: this request's current state is shown below.");
  }
}

export interface Next {
  action: Action | null;
  label: string;
  why: string;
}

/** The one primary next step for the current state, in plain words. */
export function nextStep(s: WorkspaceState): Next {
  const u = s.use;
  // 001j1: a lost answer for this request comes first: the state shown may be stale.
  if (u && s.inDoubt?.useId === u.id)
    return {
      action: "check_request",
      label: "Check what happened",
      why: DOUBT_WHY[s.inDoubt.action],
    };
  if (!u && s.unanswered)
    return {
      action: "recover_original",
      label: "Recover my original request",
      why: `Your request for a ${s.unanswered.chars.toLocaleString()}-character document didn't get an answer. Recovering finds it again: it is never made twice. What you're typing now is kept for later.`,
    };
  if (!u)
    return s.draft.trim()
      ? s.waiting
        ? { action: "prepare", label: "Check again and review", why: WAIT_WHY(s.waiting.until_ms) }
        : {
            action: "prepare",
            label: "Review one use",
            why: "Nothing is reserved or charged by reviewing.",
          }
      : {
          action: null,
          label: "Add your document",
          why: "Paste the document you want turned into data.",
        };
  const x = u.execution;
  switch (u.state) {
    case "prepared":
      if (s.accepted === null)
        return {
          action: "match_document",
          label: "Check it's the same document",
          why: "Paste the same document to check the request before authorizing.",
        };
      if (!s.check?.ok)
        return {
          action: "cancel",
          label: "Cancel this request",
          why: s.check?.problem ?? "This request couldn't be checked.",
        };
      return s.authorizer
        ? {
            action: "authorize",
            label: "Authorize this one use",
            why: "Reserves one unit for this document. It's charged only if you get a result.",
          }
        : {
            action: null,
            label: "Authorizing isn't available here",
            why: AUTHORIZATION_UNAVAILABLE,
          };
    case "reserve_requested":
    case "reserve_unknown":
      return {
        action: "check_reservation",
        label: "Check the reservation",
        why: "Your authorization was sent; the contract hasn't confirmed it yet. Checking never makes a second reservation.",
      };
    case "reserved":
      break;
    case "cancelled":
    case "expired":
      // 003r1: not reusable at once; the server's view of the deadline says so.
      if (u.next_use?.state === "wait")
        return { action: "refresh", label: "Check again", why: WAIT_WHY(u.next_use.until_ms) };
      return { action: "start_another", label: "Start a new request", why: u.explanation };
    case "refused":
    case "unresolved":
      return { action: "start_another", label: "Start a new request", why: u.explanation };
  }
  if (!x) {
    if (u.units.unit === "release_pending" || u.units.unit === "returned")
      return unitStep(u.units.unit, u.units.retryable);
    return {
      action: "run",
      label: "Run it on my document",
      why: "One run of the released product on this document.",
    };
  }
  if (x.state === "running")
    return {
      action: "refresh",
      label: "Check progress",
      why: "It's running. It is never run twice.",
    };
  if (x.result === "available" && !s.result)
    return { action: "show_result", label: "Show my result", why: "Only you can read it." };
  if (x.result === "pending")
    return { action: "refresh", label: "Check again", why: "Your result is still being saved." };
  return unitStep(u.units.unit, u.units.retryable);
}

function unitStep(unit: UseView["units"]["unit"], retryable: boolean): Next {
  switch (unit) {
    case "reserved_awaiting_settlement":
    case "charge_pending":
    case "release_pending":
      return retryable || unit === "reserved_awaiting_settlement"
        ? {
            action: "check_unit",
            label: "Settle my unit",
            why: "Checks the contract and charges only a delivered result, or returns the unit.",
          }
        : {
            action: "refresh",
            label: "Check again later",
            why: "The contract hasn't confirmed this unit yet; it isn't retried automatically.",
          };
    case "charged":
    case "returned":
      return {
        action: "start_another",
        label: "Start another use",
        why:
          unit === "charged" ? "This use was charged one unit." : "This unit was returned to you.",
      };
    default:
      return {
        action: "refresh",
        label: "Check again",
        why: "The contract's records can't yet show what happened to this unit. Nothing is charged or refunded on a guess.",
      };
  }
}
