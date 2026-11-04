// Job 001h1: the books read shared by the operating workspace's Overview and Performance and by the
// legacy desk. It keeps the period that was asked for apart from the period the figures shown
// actually cover. A pending or failed read for another period never passes the earlier figures off
// as the new period; the notice says which period is shown, when it was read on this device, and
// what couldn't be loaded, with a retry of the requested period. Only the newest request lands;
// losing access (401/403/404) drops every figure (003t); a closed page changes nothing.

export interface BooksState<T> {
  /** The last successful answer (null before one, or after access was lost). */
  data: T | null;
  /** The period asked for most recently (what the selector shows). */
  requested: number;
  status: "loading" | "ready" | "failed" | "refused";
  error: string | null;
  /** When the shown figures were read, on this device's clock (labelled as such). */
  readAt: Date | null;
}

const lost = (e: unknown) => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" && [401, 403, 404].includes(s);
};

export class BooksRead<T extends { period_months: number }> {
  private seq = 0;
  private closed = false;
  private s: BooksState<T>;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly get: (period: number) => Promise<T>,
    period: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.s = { data: null, requested: period, status: "loading", error: null, readAt: null };
  }

  get state(): BooksState<T> {
    return this.s;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Ask for a period (also a refresh of the same one). Earlier answers no longer land. */
  request(period: number): Promise<void> {
    const n = ++this.seq;
    this.set({ requested: period, status: "loading", error: null });
    return this.get(period).then(
      (data) => {
        if (this.current(n)) this.set({ data, status: "ready", error: null, readAt: this.now() });
      },
      (e) => {
        if (!this.current(n)) return;
        const message = (e as Error).message;
        this.set(
          lost(e)
            ? { data: null, readAt: null, status: "refused", error: message }
            : { status: "failed", error: message },
        );
      },
    );
  }

  /** Try the requested period again (never resubmits anything else). */
  retry() {
    return this.request(this.s.requested);
  }

  open() {
    this.closed = false;
  }

  close() {
    this.closed = true;
    this.seq++;
  }

  private current(n: number) {
    return !this.closed && n === this.seq;
  }

  private set(p: Partial<BooksState<T>>) {
    this.s = { ...this.s, ...p };
    for (const fn of this.listeners) fn();
  }
}

const span = (n: number) => `last ${n} ${n === 1 ? "month" : "months"}`;
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * What to say about the books right now (null when the figures shown answer what was asked and
 * nothing failed). Whether figures are shown at all is separate: an error with no data is the
 * "couldn't be loaded" state, never zero.
 */
export function booksNotice<T extends { period_months: number }>(
  s: BooksState<T>,
): { tone: "info" | "warn" | "error"; text: string; retry: boolean } | null {
  const shown = s.data?.period_months ?? null;
  const at = s.readAt ? ` (read at ${clock(s.readAt)} on this device)` : "";
  if (s.status === "refused")
    return {
      tone: "error",
      text: `The books can't be shown: ${s.error ?? "access ended"}.`,
      // A fresh authorized read may restore access. Keep the figures cleared until it succeeds.
      retry: true,
    };
  if (s.status === "failed") {
    if (shown === null)
      return {
        tone: "error",
        text: `The books couldn't be loaded: ${s.error ?? "unknown error"}. Nothing is shown as zero.`,
        retry: true,
      };
    return {
      tone: "warn",
      text:
        shown === s.requested
          ? `Couldn't refresh the books: ${s.error ?? "unknown error"}. Showing the figures last read for the ${span(shown)}${at}.`
          : `The ${span(s.requested)} couldn't be loaded: ${s.error ?? "unknown error"}. The figures below are still the ${span(shown)}${at}, not the ${span(s.requested)}.`,
      retry: true,
    };
  }
  if (s.status === "loading" && shown !== null && shown !== s.requested)
    return {
      tone: "info",
      text: `Loading the ${span(s.requested)}. Until then the figures below are the ${span(shown)}${at}.`,
      retry: false,
    };
  return null;
}
