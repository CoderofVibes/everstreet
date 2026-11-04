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
}

export type Action =
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
  private remember(offerId: string, v: { key: string; id?: string } | null) {
    const s = this.opts.storage;
    if (!s) return;
    if (v) s.setItem(this.storeKey(offerId), JSON.stringify(v));
    else s.removeItem(this.storeKey(offerId));
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
    this.set({ use, offer: use.offer, status: "ready" });
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
        // A request whose prepare answer was lost before a reload: resume it if its id is known.
        const r = this.recall(offer.offer_id);
        if (r?.id) this.applyUse(await this.port.use(r.id), gen);
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

  /** Prepares one use from the draft. A lost answer is retried with the same key and document. */
  prepare() {
    const offer = this.state.offer;
    const text = this.state.draft;
    if (!offer || !text.trim()) return;
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
    return this.act("prepare", async (gen) => {
      const key =
        this.pending && this.pending.text === text
          ? this.pending.key
          : (this.opts.makeKey ?? (() => `use-${crypto.randomUUID()}`))();
      this.pending = { key, text };
      this.remember(offer.offer_id, { key });
      const raw = await this.port.prepare(offer.offer_id, { idempotency_key: key, input: text });
      if (!this.applyUse(raw, gen)) return;
      this.pending = null;
      this.remember(offer.offer_id, { key, id: this.state.use?.id });
      this.set({ accepted: text, result: null });
      await this.checkEnvelope();
      await this.loadRecent();
    });
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
      await this.checkEnvelope(); // again, now: the time to authorize may have passed
      if (gen !== this.generation) return;
      if (!this.state.check?.ok) return;
      const env = use.envelope as NonNullable<UseView["envelope"]>;
      const s = await a.sign({
        hold_message_hex: env.hold.message_hex,
        use_message_hex: env.use.message_hex,
      });
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
    this.generation++;
    if (this.state.offer) this.remember(this.state.offer.offer_id, null);
    this.pending = null;
    this.set({ use: null, accepted: null, check: null, result: null, busy: null, notice: null });
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
  if (!u)
    return s.draft.trim()
      ? {
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
