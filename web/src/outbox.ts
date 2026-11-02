// The message being sent from the studio's assistant, kept apart from the composer. The text
// and its request key travel together and never change, so a retry after an uncertain answer
// is the same request, and whatever the founder types meanwhile is never overwritten.

export type OutboxState = "sending" | "unknown" | "refused";

export interface Outbox {
  text: string;
  key: string;
  state: OutboxState;
  reason: string | null;
}

/** What happened to a send: the server answered yes, answered no, or we cannot tell. */
export type SendResult =
  | { kind: "accepted" }
  | { kind: "refused"; reason: string }
  | { kind: "unknown"; reason: string };

/**
 * Classifies a failed request. A 4xx answer from the server is a definite "no" (nothing was
 * queued). No answer, a network error or a 5xx leaves the outcome unknown.
 */
export function classify(error: unknown): SendResult {
  const status = (error as { status?: unknown } | null)?.status;
  const reason = (error as Error | null)?.message || "Something went wrong";
  if (typeof status === "number" && status >= 400 && status < 500)
    return { kind: "refused", reason };
  return {
    kind: "unknown",
    reason: "No clear answer arrived, so it may or may not have been sent.",
  };
}

/** Starts sending `text`, unless something is already in flight or unresolved. */
export function start(current: Outbox | null, text: string, key: string): Outbox | null {
  const said = text.trim();
  if (!said || current) return null;
  return { text: said, key, state: "sending", reason: null };
}

/** The next outbox after a send resolves; `null` when nothing is left to show. */
export function settle(current: Outbox, result: SendResult): Outbox | null {
  if (result.kind === "accepted") return null;
  return { ...current, state: result.kind, reason: result.reason };
}

/** A retry of an uncertain send: the same text under the same key. */
export function retry(current: Outbox): Outbox | null {
  if (current.state !== "unknown") return null;
  return { ...current, state: "sending", reason: null };
}

/**
 * Taking a refused message back to edit: only into an empty composer, so nothing the founder
 * has typed since is replaced. Returns the new composer text, or null if it would overwrite.
 */
export function takeBack(current: Outbox, composer: string): string | null {
  if (current.state !== "refused") return null;
  return composer.trim() ? null : current.text;
}
