// Job 002c1: one Service request's identity in the browser. The text, the chosen target and the
// request key are fixed when it starts. Until an answer arrives, running the same text on the
// same target again re-sends that key, which the server answers from its record without
// running anything new. Anything else while it's in flight waits. After a lost answer, new
// paid work needs an explicit choice. Pure, so these rules are tested without a browser.

export type AttemptState = "sending" | "answered" | "unknown" | "refused";

export interface Attempt {
  key: string;
  text: string;
  /** "release" or "job:<build id>", as chosen when it started. */
  target: string;
  state: AttemptState;
  invocationId: string | null;
  message: string | null;
}

export type Action =
  /** A new request (new key, may be paid). */
  | "run"
  /** Ask the server about the recorded request (same key; never runs it again). */
  | "check"
  /** A request is in flight; wait for it. */
  | "wait";

/** What the main button does for this text and target now. */
export function nextAction(current: Attempt | null, text: string, target: string): Action {
  if (!current) return "run";
  if (current.state === "sending") return "wait";
  const same = current.text === text && current.target === target;
  if (current.state === "unknown" && same) return "check";
  return "run";
}

/** Starts or re-sends. Returns null when nothing may be sent now. */
export function begin(
  current: Attempt | null,
  text: string,
  target: string,
  mint: () => string,
): Attempt | null {
  const action = nextAction(current, text, target);
  if (action === "wait" || !text.trim()) return null;
  if (action === "check" && current) return { ...current, state: "sending", message: null };
  return { key: mint(), text, target, state: "sending", invocationId: null, message: null };
}

/** The answer (or its absence). A 4xx means the server refused; anything else is unknown. */
export function settle(
  a: Attempt,
  answer: { ok: true; invocationId: string } | { ok: false; status: number; message: string },
): Attempt {
  if (answer.ok)
    return { ...a, state: "answered", invocationId: answer.invocationId, message: null };
  if (answer.status >= 400 && answer.status < 500)
    return { ...a, state: "refused", message: answer.message };
  return {
    ...a,
    state: "unknown",
    message:
      "No answer arrived. It may still be running or may have finished. Check on it: that asks about this same request and won't run it again.",
  };
}

/** Polling for running work: growing gaps, a fixed cap, only while the page is visible. */
export const POLL = { maxPolls: 40, delay: (n: number) => Math.min(15_000, 1_500 * 1.4 ** n) };
