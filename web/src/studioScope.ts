// Job 002b2: the studio conversation's unsent thought and unresolved request belong to one
// person, one project and one owner epoch. Switching the side panel keeps them; any change of
// person, project or owner starts clean. Pure, so the rules are tested without a browser.

/** The scope a conversation's composer and outbox live in. */
export const studioScope = (personId: string, projectId: string, ownerEpoch: string) =>
  JSON.stringify([personId, projectId, ownerEpoch]);

/** Text offered to the composer (e.g. "ask again"), tagged with the scope it was offered in. */
export interface Prefill {
  text: string;
  n: number;
  scope: string;
}

/** Only text offered in this scope reaches this scope's composer. */
export const prefillFor = (p: Prefill | null, scope: string) => (p && p.scope === scope ? p : null);

/**
 * Offered text never wipes a thought the founder is typing: it replaces an empty box, and is
 * added below anything already there (once).
 */
export function withPrefill(current: string, offered: string) {
  if (!current.trim()) return offered;
  if (current.includes(offered)) return current;
  return `${current.trimEnd()}\n\n${offered}`;
}
