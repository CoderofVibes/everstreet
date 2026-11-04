// Job 001h1: a failed or pending books refresh never passes old figures off as the new period.
// Astra's browser finding: after 6 months loaded, choosing "Last 12 months" with the read failing
// (503) left the selector on 12 while every figure still covered 6 months, with no warning or
// retry in Performance or Overview. These drive the actual shared read (BooksRead) through the
// handle the page uses (booksHandle), with answers held and released by the test, and render the
// actual BooksPanel and Overview figures from it. Finite: a request cap per test, no timers.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BooksView } from "../src/api4.ts";
import { BooksRead, booksNotice } from "../src/booksRead.ts";
import { BooksPanel, booksHandle } from "../src/pages/DeskBooks.tsx";
import { OverviewFigures } from "../src/pages/DeskWorkspace.tsx";
import { SessionProvider } from "../src/session.tsx";

const ledger = {
  months: [],
  period_microcents: "0",
  total_microcents: "0",
  unknown_cost_requests: 0,
  period_unknown_cost_requests: 0,
  note: "",
};
const booksFor = (months: number): BooksView =>
  ({
    months: [],
    chain_error: null,
    costs: [],
    categories: [{ category: "AI model usage", kind: "direct", hint: "" }],
    now: { state: "not_applicable", reason: "Payments are off" },
    spend: { unit: "USD", basis: "Everstreet's own records", runtime: ledger, build: ledger },
    basis: "",
    period_months: months,
  }) as unknown as BooksView;

class HttpError extends Error {
  constructor(
    readonly status: number,
    m: string,
  ) {
    super(m);
  }
}

/** A books server whose answers the test releases; at most `cap` requests. */
function server(cap = 10) {
  const calls: { period: number; ok: (v: BooksView) => void; fail: (e: unknown) => void }[] = [];
  const read = new BooksRead<BooksView>(
    (period) =>
      new Promise<BooksView>((ok, fail) => {
        if (calls.length >= cap) throw new Error("request cap");
        calls.push({ period, ok, fail });
      }),
    6,
    () => new Date("2026-11-04T14:05:00"),
  );
  return { read, calls, handle: () => booksHandle("b1", read) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<SessionProvider>{node}</SessionProvider>);

describe("001h1 Astra's sequence: 6 loaded, 12 asked, 503, retry", () => {
  it("each step says which period is shown; success clears the warning", async () => {
    const s = server();
    void s.read.request(6);
    s.calls[0]?.ok(booksFor(6));
    await tick();
    expect(booksNotice(s.read.state)).toBeNull();

    // Pending 12: the old figures are labelled as 6 months until 12 arrives.
    void s.read.request(12);
    expect(s.read.state).toMatchObject({ requested: 12, status: "loading" });
    expect(booksNotice(s.read.state)?.text).toMatch(
      /Loading the last 12 months\. Until then the figures below are the last 6 months/,
    );

    // 503: the request is kept, the figures still say 6 months, with a retry.
    s.calls[1]?.fail(new HttpError(503, "Request failed (503)"));
    await tick();
    const failed = booksNotice(s.read.state);
    expect(failed).toMatchObject({ tone: "warn", retry: true });
    expect(failed?.text).toMatch(/The last 12 months couldn't be loaded: Request failed \(503\)/);
    expect(failed?.text).toMatch(
      /still the last 6 months \(read at .+ on this device\), not the last 12/,
    );

    // Rendered in Performance and Overview: the same notice and a Try again.
    const panel = render(<BooksPanel books={s.handle()} deliberate />);
    expect(panel).toContain("The last 12 months couldn&#x27;t be loaded");
    expect(panel).toContain("Try again");
    expect(panel).toMatch(/<option value="12" selected="">Last 12 months/);
    const overview = render(<OverviewFigures books={s.handle()} businessId="b1" />);
    expect(overview).toContain("The last 12 months couldn&#x27;t be loaded");
    expect(overview).toContain("Try again");

    // Retry asks for 12 again (nothing else); success shows 12 and clears the warning.
    void s.handle().load();
    expect(s.calls[2]?.period).toBe(12);
    s.calls[2]?.ok(booksFor(12));
    await tick();
    expect(s.read.state).toMatchObject({ requested: 12, status: "ready" });
    expect(s.read.state.data?.period_months).toBe(12);
    expect(booksNotice(s.read.state)).toBeNull();
    expect(render(<BooksPanel books={s.handle()} deliberate />)).not.toContain("couldn&#x27;t");
    expect(s.calls).toHaveLength(3);
  });

  it("a refresh of the same period that fails keeps the figures, labelled as last read", async () => {
    const s = server();
    void s.read.request(6);
    s.calls[0]?.ok(booksFor(6));
    await tick();
    void s.handle().load(); // e.g. after adding a cost
    s.calls[1]?.fail(new HttpError(503, "Request failed (503)"));
    await tick();
    expect(booksNotice(s.read.state)?.text).toMatch(
      /Couldn't refresh the books: .*Showing the figures last read for the last 6 months/,
    );
  });

  it("no figures yet and the read fails: an error with retry, never zero", async () => {
    const s = server();
    void s.read.request(6);
    s.calls[0]?.fail(new HttpError(503, "Request failed (503)"));
    await tick();
    const n = booksNotice(s.read.state);
    expect(n).toMatchObject({ tone: "error", retry: true });
    expect(n?.text).toMatch(/Nothing is shown as zero/);
    const panel = render(<BooksPanel books={s.handle()} />); // the legacy desk's panel
    expect(panel).toContain("The books couldn&#x27;t be loaded");
    expect(panel).not.toContain("$0");
  });
});

describe("001h1 order, access loss and unmount", () => {
  it("successive period answers arriving out of order: only the newest request lands", async () => {
    const s = server();
    void s.read.request(6);
    s.calls[0]?.ok(booksFor(6));
    await tick();
    void s.read.request(12);
    void s.read.request(3);
    s.calls[2]?.ok(booksFor(3));
    s.calls[1]?.ok(booksFor(12)); // the older request answers last
    await tick();
    expect(s.read.state.requested).toBe(3);
    expect(s.read.state.data?.period_months).toBe(3);
    expect(booksNotice(s.read.state)).toBeNull();
  });

  it("401, 403 and 404 clear figures; checking access keeps them hidden until a fresh read succeeds", async () => {
    for (const status of [401, 403, 404]) {
      const s = server();
      void s.read.request(6);
      s.calls[0]?.ok(booksFor(6));
      await tick();
      void s.read.request(3);
      s.calls[1]?.fail(new HttpError(status, "No such business"));
      await tick();
      expect(s.read.state).toMatchObject({ data: null, readAt: null, status: "refused" });
      expect(booksNotice(s.read.state)?.retry).toBe(true);
      const overview = render(<OverviewFigures books={s.handle()} businessId="b1" />);
      expect(overview).toContain("can&#x27;t be shown");
      expect(overview).toContain("Check access");
      expect(render(<BooksPanel books={s.handle()} />)).toContain("Check access");
      void s.handle().load();
      expect(s.calls[2]?.period).toBe(3);
      expect(s.read.state).toMatchObject({ data: null, readAt: null, status: "loading" });
      s.calls[2]?.fail(new HttpError(503, "Access check unavailable"));
      await tick();
      expect(s.read.state.data).toBeNull();
      void s.handle().load();
      expect(s.calls[3]?.period).toBe(3);
      expect(s.read.state.data).toBeNull();
      s.calls[3]?.ok(booksFor(3));
      await tick();
      expect(s.read.state).toMatchObject({ status: "ready", data: { period_months: 3 } });
      expect(booksNotice(s.read.state)).toBeNull();
    }
  });

  it("after the page closes, a late answer changes nothing", async () => {
    const s = server();
    void s.read.request(6);
    s.read.close();
    s.calls[0]?.ok(booksFor(6));
    await tick();
    expect(s.read.state.data).toBeNull();
  });
});
