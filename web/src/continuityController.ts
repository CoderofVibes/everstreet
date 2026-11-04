// Job 003j: the Ownership and continuity page's state and every request it makes. The page
// renders this; the rules are tested without a browser.
//
// - Loading is a plain read; nothing refreshes on its own (no polling, no refresh on open).
// - Refresh is deliberate, optionally for one month. A refused or unanswered refresh never
//   replaces the evidence shown: it keeps its ORIGINAL observation time, and the result says
//   what happened. Nothing clears a flag.
// - Reads are sequenced: an older answer finishing late never replaces a newer one.
// - Each view names its control epoch. A different epoch (the business changed hands, even back)
//   drops the month typed and the last refresh result.
// - Access: a 404 from a refresh is checked with a read. 404 again: everything private is
//   cleared. Any other failure: access is "unconfirmed", the evidence stays labelled as such, and
//   refreshing waits for an explicit, successful check. Nothing stays "in progress" once its
//   request has settled.
// - Freshness is recomputed as time passes from the server's own times (observed_at, served_at
//   and stale_after_ms), so a badge can't stay green forever.
// - Leaving the page retires the controller; late answers land nowhere.

import { ApiError } from "./api.ts";
import {
  type ContinuityView,
  MalformedView,
  parseView,
  type RefreshAnswer,
} from "./continuityApi.ts";

export interface ContinuityPort {
  get(businessId: string): Promise<unknown>;
  refresh(businessId: string, body: { period?: number }): Promise<unknown>;
}

export interface RefreshStatus {
  state: "idle" | "sending" | "done" | "refused" | "unknown";
  /** The server's outcome for a completed refresh (accepted, duplicate, stale, conflict...). */
  outcome: string | null;
  code: string | null;
  message: string | null;
  period: { yyyymm: number; outcome: string } | null;
}

export interface ContinuityState {
  status: "loading" | "ready" | "gone" | "error";
  message: string | null;
  view: ContinuityView | null;
  /** The client time the shown view arrived, for recomputing its age. */
  receivedAt: number | null;
  access: "current" | "unconfirmed" | "checking";
  refresh: RefreshStatus;
  /** The month typed for the next refresh, yyyymm or empty. */
  month: string;
}

const IDLE: RefreshStatus = {
  state: "idle",
  outcome: null,
  code: null,
  message: null,
  period: null,
};

export const ACCESS_ENDED =
  "This business's ownership evidence is no longer available to you. Nothing private from it is kept on this page.";

export const ACCESS_UNCONFIRMED =
  "We couldn't check whether this business is still yours. The evidence below may be out of date, and nothing can be refreshed until access is checked.";

const OUTCOME: Record<string, string> = {
  accepted: "Recorded a newer block.",
  duplicate: "Already recorded at this block; nothing changed.",
  stale: "The endpoint answered with an older block than the one recorded; nothing changed.",
  conflict:
    "Two different answers for the same block or height. Nothing was applied; this needs checking.",
  contradictory:
    "The newer block's control state can't follow what was recorded. Nothing was applied.",
  source_changed: "The configured contract differs from the one recorded. Nothing was applied.",
};

/** A month written yyyymm, or null if it isn't one. */
export function parseMonth(s: string): number | null {
  const t = s.trim();
  if (!/^\d{6}$/.test(t)) return null;
  const n = Number(t);
  const m = n % 100;
  return n >= 197_001 && n <= 999_912 && m >= 1 && m <= 12 ? n : null;
}

export class ContinuityController {
  private state: ContinuityState = {
    status: "loading",
    message: null,
    view: null,
    receivedAt: null,
    access: "current",
    refresh: IDLE,
    month: "",
  };
  private listeners = new Set<() => void>();
  private alive = true;
  private reads = 0;
  private applied = 0;

  constructor(
    private readonly businessId: string,
    private readonly api: ContinuityPort,
    private readonly now: () => number = Date.now,
  ) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(fn: (s: ContinuityState) => ContinuityState) {
    if (!this.alive) return;
    this.state = fn(this.state);
    for (const l of this.listeners) l();
  }
  dispose() {
    this.alive = false;
  }

  private epoch() {
    return this.state.view?.owner_epoch ?? null;
  }

  /** Applies a validated view read as number `seq`; older reads never replace newer ones. */
  private apply(seq: number, raw: unknown): boolean {
    if (seq <= this.applied) return false;
    let v: ContinuityView;
    try {
      v = parseView(raw);
    } catch (e) {
      if (!(e instanceof MalformedView)) throw e;
      this.applied = seq;
      this.set((s) => ({
        ...s,
        status: s.view ? s.status : "error",
        message: "The evidence couldn't be shown safely: the answer wasn't in the expected form.",
      }));
      return false;
    }
    this.applied = seq;
    const changed = this.epoch() !== null && this.epoch() !== v.owner_epoch;
    this.set((s) => ({
      ...s,
      status: "ready",
      message: null,
      view: v,
      receivedAt: this.now(),
      access: "current",
      // Another control epoch: nothing typed or reported for the previous one carries over.
      ...(changed ? { refresh: IDLE, month: "" } : {}),
    }));
    return true;
  }

  private gone() {
    this.applied = Number.MAX_SAFE_INTEGER; // no later answer may bring anything back
    this.set(() => ({
      status: "gone",
      message: ACCESS_ENDED,
      view: null,
      receivedAt: null,
      access: "current",
      refresh: IDLE,
      month: "",
    }));
  }

  /** A plain read. Returns "ok", "ended" or "failed". */
  load = async (): Promise<"ok" | "ended" | "failed"> => {
    if (this.state.status === "gone") return "ended";
    const seq = ++this.reads;
    try {
      const raw = await this.api.get(this.businessId);
      if (!this.alive) return "failed";
      this.apply(seq, raw);
      return "ok";
    } catch (e) {
      if (!this.alive || seq <= this.applied) return "failed";
      if (e instanceof ApiError && e.status === 404) {
        this.gone();
        return "ended";
      }
      this.set((s) => ({
        ...s,
        status: s.view ? s.status : "error",
        message: s.view
          ? "The latest read didn't arrive; what is shown is from the earlier read."
          : (e as Error).message || "The evidence couldn't be loaded.",
      }));
      return "failed";
    }
  };

  /** The explicit check after an unconfirmed access. */
  checkAccess = async () => {
    if (this.state.access !== "unconfirmed") return;
    this.set((s) => ({ ...s, access: "checking" }));
    const r = await this.load();
    const after = this.getState().access;
    if (r === "failed" && after === "checking") this.set((s) => ({ ...s, access: "unconfirmed" }));
  };

  setMonth = (month: string) => this.set((s) => ({ ...s, month }));

  /** Why Refresh can't be used now, or null. */
  get blocked(): string | null {
    const s = this.state;
    if (s.status !== "ready" || !s.view) return "Nothing to refresh yet.";
    if (s.view.state === "unbound") return "This business isn't connected to a contract here.";
    if (s.view.state === "paused") return "This capability is paused.";
    if (s.access !== "current") return "Check access first.";
    if (s.refresh.state === "sending") return "A refresh is already running.";
    if (s.month.trim() && parseMonth(s.month) === null)
      return "Write the month as yyyymm, e.g. 202611.";
    return null;
  }

  refresh = async () => {
    if (this.blocked) return;
    const period = this.state.month.trim() ? (parseMonth(this.state.month) as number) : undefined;
    const epoch = this.epoch();
    const seq = ++this.reads;
    this.set((s) => ({ ...s, refresh: { ...IDLE, state: "sending" } }));
    const settle = (r: Partial<RefreshStatus>) =>
      this.set((s) => ({ ...s, refresh: { ...IDLE, ...r } }));
    try {
      const raw = (await this.api.refresh(
        this.businessId,
        period ? { period } : {},
      )) as RefreshAnswer;
      if (!this.alive || this.epoch() !== epoch) return;
      if (raw.outcome === "refused") {
        settle({ state: "refused", code: raw.code ?? null, message: raw.message ?? null });
        return;
      }
      if (raw.view) this.apply(seq, raw.view);
      settle({
        state: "done",
        outcome: raw.outcome,
        message: OUTCOME[raw.outcome] ?? raw.message ?? null,
        period: raw.period ?? null,
      });
    } catch (e) {
      if (!this.alive || this.epoch() !== epoch) return;
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 404) {
        // Is it still ours? A read tells a gone business apart from a passing failure.
        const r = await this.load();
        if (r === "ended") return;
        if (r === "failed") {
          this.set((s) => ({ ...s, access: "unconfirmed" }));
          settle({ state: "unknown", message: ACCESS_UNCONFIRMED });
          return;
        }
        settle({ state: "refused", message: (e as Error).message });
        return;
      }
      if (status === 409) {
        // Control changed while reading: say so, then read the current state.
        settle({ state: "refused", code: "control_changed", message: (e as Error).message });
        await this.load();
        return;
      }
      if (status >= 400 && status < 500) {
        settle({ state: "refused", message: (e as Error).message });
        return;
      }
      settle({
        state: "unknown",
        message: "No answer arrived. The evidence shown is unchanged, with its original time.",
      });
    }
  };

  /** Freshness right now, from the server's times; null when there is no observation. */
  freshness(): { age_ms: number; stale: boolean } | null {
    const v = this.state.view;
    if (v?.state !== "observed" || this.state.receivedAt === null) return null;
    const atServe = Date.parse(v.served_at) - Date.parse(v.observed_at);
    const age = Math.max(0, atServe) + Math.max(0, this.now() - this.state.receivedAt);
    return { age_ms: age, stale: age > v.stale_after_ms };
  }
}
