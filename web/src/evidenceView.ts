// Job 003p: what the browser may keep showing from an evidence room. Every load is tagged with
// who asked (the signed-in person), which room, and a load number. Changing person or room hides
// the evidence at once; an answer from an older load is ignored; a refusal or failed check
// clears it. Pure, so the rules are tested without a browser.

export interface EvidenceView<T> {
  actor: string | null;
  room: string;
  /** Increases with every load; only the newest load's answer is used. */
  load: number;
  state: "checking" | "shown" | "refused" | "unchecked";
  data: T | null;
  message: string | null;
}

export const initial = <T>(actor: string | null, room: string): EvidenceView<T> => ({
  actor,
  room,
  load: 0,
  state: "checking",
  data: null,
  message: null,
});

/**
 * A new load begins. Another person or another room never sees what was shown before. The
 * same person returning to the same room keeps it visible while access is rechecked.
 */
export function begin<T>(
  current: EvidenceView<T>,
  actor: string | null,
  room: string,
): EvidenceView<T> {
  const same = current.actor === actor && current.room === room;
  return {
    actor,
    room,
    load: current.load + 1,
    state: same && current.data ? current.state : "checking",
    data: same ? current.data : null,
    message: same ? current.message : null,
  };
}

/** An answer arrived for `load`. Older loads, and loads for someone or somewhere else, change nothing. */
export function settle<T>(
  current: EvidenceView<T>,
  load: number,
  actor: string | null,
  room: string,
  answer: { ok: true; data: T } | { ok: false; status: number; message: string },
): EvidenceView<T> {
  if (load !== current.load || actor !== current.actor || room !== current.room) return current;
  if (answer.ok) return { ...current, state: "shown", data: answer.data, message: null };
  // Any refusal or a check that couldn't complete hides the evidence: nothing is shown that
  // the server hasn't just confirmed this person may see.
  const refused = answer.status === 401 || answer.status === 403 || answer.status === 404;
  return {
    ...current,
    state: refused ? "refused" : "unchecked",
    data: null,
    message: refused
      ? answer.message
      : "Access couldn't be checked just now, so nothing is shown. Try again.",
  };
}
