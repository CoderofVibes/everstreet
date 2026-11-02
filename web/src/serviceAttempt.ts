// Jobs 002c1 and 002c2: Service requests in the browser, kept apart from the editable draft.
// Each request's text, target and key are fixed when it starts. A request whose answer was lost
// stays recoverable from its own stored fields, whatever the founder has typed or chosen since
// (or if the box is empty). Recovering re-sends that same key, which the server answers from its
// record without running anything new, and leaves the draft untouched. While a request whose
// answer was lost is unresolved, new paid work needs its own explicitly labelled action; a
// plain Run never replaces it. Job 002c3: the list is bounded, but only settled history is
// trimmed; when every slot holds an unresolved request, new paid work is refused (before a key
// is minted) until one is checked. Pure, so these rules are tested without a browser.

export type AttemptState = "sending" | "answered" | "unknown" | "refused";

export interface Attempt {
  key: string;
  text: string;
  /** "release" or "job:<build id>", as chosen when it started. */
  target: string;
  state: AttemptState;
  invocationId: string | null;
  message: string | null;
  /** When it was first sent (ISO), to identify it to the founder. */
  startedAt: string;
}

/** All Service requests this view knows about, newest last (bounded). */
export interface Requests {
  attempts: Attempt[];
}

export const MAX_TRACKED = 10;

export const empty = (): Requests => ({ attempts: [] });

/** The request being sent right now, if any. */
export const inFlight = (r: Requests) => r.attempts.find((a) => a.state === "sending") ?? null;

/** Requests whose answer was lost, oldest first: each can be recovered. */
export const unresolved = (r: Requests) => r.attempts.filter((a) => a.state === "unknown");

export type RunAction =
  /** Nothing is unresolved: an ordinary new request. */
  | "run"
  /** An earlier request is unresolved: new work only by the explicit "new, separately paid" action. */
  | "new_paid_only"
  /** Every tracked request is unresolved: check on one before any new paid work. */
  | "full"
  /** A request is being sent; wait. */
  | "wait";

/** Requests that must never be dropped: being sent, or answer lost. */
const pinned = (a: Attempt) => a.state === "sending" || a.state === "unknown";

/** What the draft's Run control may do now. Independent of the draft's content. */
export function runAction(r: Requests): RunAction {
  if (inFlight(r)) return "wait";
  if (r.attempts.filter(pinned).length >= MAX_TRACKED) return "full";
  return unresolved(r).length ? "new_paid_only" : "run";
}

/**
 * Replaces or appends `a`, then trims to MAX_TRACKED by dropping the oldest *settled* entries
 * (answered or refused). Unresolved and in-flight requests are never dropped; `start` refuses
 * new work instead when they fill every slot.
 */
const put = (r: Requests, a: Attempt): Requests => {
  let attempts = [...r.attempts.filter((x) => x.key !== a.key), a];
  while (attempts.length > MAX_TRACKED) {
    const i = attempts.findIndex((x) => !pinned(x));
    if (i < 0) break;
    attempts = attempts.filter((_, j) => j !== i);
  }
  return { attempts };
};

/**
 * Starts new paid work from the draft. Refused (null, before a key is minted) while one is in
 * flight, for empty text, when every tracked request is unresolved, or while an earlier request
 * is unresolved unless `explicitNew` is set by its own action.
 */
export function start(
  r: Requests,
  text: string,
  target: string,
  mint: () => string,
  now: string,
  explicitNew = false,
): { requests: Requests; attempt: Attempt } | null {
  const action = runAction(r);
  if (action === "wait" || action === "full" || !text.trim()) return null;
  if (action === "new_paid_only" && !explicitNew) return null;
  const attempt: Attempt = {
    key: mint(),
    text,
    target,
    state: "sending",
    invocationId: null,
    message: null,
    startedAt: now,
  };
  return { requests: put(r, attempt), attempt };
}

/**
 * Recovers an unresolved request from its own stored key, text and target; the draft plays no
 * part. Null if that request isn't unresolved or something is in flight.
 */
export function recover(r: Requests, key: string): { requests: Requests; attempt: Attempt } | null {
  if (inFlight(r)) return null;
  const a = r.attempts.find((x) => x.key === key && x.state === "unknown");
  if (!a) return null;
  const attempt = { ...a, state: "sending" as const, message: null };
  return { requests: put(r, attempt), attempt };
}

/** The answer (or its absence) for one request. A 4xx is a refusal; anything else is unknown. */
export function settle(
  r: Requests,
  key: string,
  answer: { ok: true; invocationId: string } | { ok: false; status: number; message: string },
): Requests {
  const a = r.attempts.find((x) => x.key === key);
  if (!a) return r;
  let next: Attempt;
  if (answer.ok)
    next = { ...a, state: "answered", invocationId: answer.invocationId, message: null };
  else if (answer.status >= 400 && answer.status < 500)
    next = { ...a, state: "refused", message: answer.message };
  else
    next = {
      ...a,
      state: "unknown",
      message:
        "No answer arrived. It may still be running or may have finished. Checking on it asks about this same request and won't run it again.",
    };
  return put(r, next);
}

/** A short way to identify a request to the founder. */
export function describeAttempt(a: Pick<Attempt, "text" | "target" | "startedAt">): string {
  const first =
    a.text
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? "(empty)";
  const t = new Date(a.startedAt);
  const time = Number.isNaN(t.getTime()) ? a.startedAt : t.toLocaleTimeString();
  return `sent ${time} on ${a.target === "release" ? "the released version" : `build ${a.target.replace(/^job:/, "").slice(0, 8)}`}: "${first.slice(0, 60)}${first.length > 60 ? "…" : ""}"`;
}

/** Polling for running work: growing gaps, a fixed cap, only while the page is visible. */
export const POLL = { maxPolls: 40, delay: (n: number) => Math.min(15_000, 1_500 * 1.4 ** n) };
