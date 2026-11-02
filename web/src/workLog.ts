// Joining pages of the product work log. The studio polls the newest page (the tail, which
// carries the latest status of recent requests) and loads older pages on request. Pages may
// overlap; each message appears once, in sequence order, with the most recently fetched copy.

export interface Sequenced {
  id: string;
  seq: number;
}

/** Merges pages; for a message in both, `newer`'s copy wins. Sorted by sequence. */
export function mergeLog<T extends Sequenced>(older: T[], newer: T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of older) byId.set(m.id, m);
  for (const m of newer) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** The cursor for "Show earlier messages": the oldest sequence shown, not the newest overall. */
export function olderCursor<T extends Sequenced>(shown: T[]): number | null {
  return shown.length ? (shown[0] as T).seq : null;
}
