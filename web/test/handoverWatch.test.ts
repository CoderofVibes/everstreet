// Job 003wf3 (Astra 02:23): the sale page's read-only handover check and its bounded follow,
// on the actual SaleFlow controller with a scripted port (no network, no wallet, fake timers).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaleSetup } from "../src/saleApi.ts";
import { SaleFlow } from "../src/saleFlow.ts";

const ACCOUNT = "ava-founder.near";
const setup = (state: string | null, live = "closing") =>
  ({
    account: ACCOUNT,
    control: {
      close_mode: "gated",
      closer: "c.testnet",
      live_deal: state === null ? null : { state: live },
    },
    handover: state === null ? null : { state },
  }) as unknown as SaleSetup;

/** A port whose setup answers come from a script; each call takes the next entry. */
function scripted(answers: (SaleSetup | Error)[]) {
  const calls = { setup: 0, other: 0 };
  const port = {
    setup: async () => {
      calls.setup++;
      const a = answers.shift();
      if (!a) throw new Error("script exhausted");
      if (a instanceof Error) throw a;
      return a;
    },
    prepare: async () => {
      calls.other++;
      throw new Error("not in this test");
    },
  };
  return { port: port as never, calls };
}
const flowOf = (port: never) =>
  new SaleFlow(port, () => null, { businessId: "biz-1", account: ACCOUNT });
const tick = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

afterEach(() => {
  vi.useRealTimers();
});

describe("003wf3 following a handover on the sale page", () => {
  it("checks every few seconds while it's in progress and stops by itself once it's over", async () => {
    vi.useFakeTimers();
    const { port, calls } = scripted([
      setup("gated"),
      setup("ordering"),
      setup("released_to_buyer", "closing"),
    ]);
    const f = flowOf(port);
    await f.load();
    f.watchHandover(5_000, 60);
    expect(f.watching).toBe(true);
    await tick(5_000);
    expect(f.getState().setup?.handover?.state).toBe("ordering");
    await tick(5_000);
    // released, but the contract read here still says closing: one more read is due
    expect(f.getState().setup?.handover?.state).toBe("released_to_buyer");
    expect(calls.other).toBe(0); // only reads; nothing prepared, stored or sent
    f.retire();
  });

  it("is bounded: at most `max` reads, then it stops", async () => {
    vi.useFakeTimers();
    const { port, calls } = scripted(Array.from({ length: 10 }, () => setup("gated")));
    const f = flowOf(port);
    await f.load();
    f.watchHandover(1_000, 3);
    await tick(10_000);
    expect(calls.setup).toBe(4); // the first load and 3 checks
    expect(f.watching).toBe(false);
  });

  it("a review in progress is never replaced: the tick is skipped (not counted) until it's set aside", async () => {
    vi.useFakeTimers();
    const { port, calls } = scripted(Array.from({ length: 5 }, () => setup("gated")));
    const f = flowOf(port);
    await f.load();
    const review = { preview: { kind: "abort" }, replaces: null, origin: null };
    (f as unknown as { state: Record<string, unknown> }).state.review = review;
    f.watchHandover(1_000, 2);
    await tick(3_000);
    expect(calls.setup).toBe(1);
    expect(f.getState().review).toBe(review);
    expect(await f.checkHandover()).toBe(false); // the explicit check also waits
    f.cancelReview();
    await tick(2_000);
    expect(calls.setup).toBe(3);
    f.retire();
  });

  it("a failed read keeps what was shown and says so; the next check recovers and clears only that warning", async () => {
    const { port } = scripted([
      setup("gated"),
      new Error("The contract couldn't be read."),
      setup("ordering"),
    ]);
    const f = flowOf(port);
    await f.load();
    expect(await f.checkHandover()).toBe(false);
    expect(f.getState()).toMatchObject({ status: "ready", notice: { tone: "warn" } });
    expect(f.getState().setup?.handover?.state).toBe("gated");
    expect(await f.checkHandover()).toBe(true);
    expect(f.getState().notice).toBeNull();
    expect(f.getState().setup?.handover?.state).toBe("ordering");
    expect(f.getState().handoverCheckedMs).toEqual(expect.any(Number));
  });

  it("another notice (a request's answer) is kept by a successful check", async () => {
    const { port } = scripted([setup("gated"), setup("ordering")]);
    const f = flowOf(port);
    await f.load();
    const answer = { tone: "ok" as const, text: "Your acceptance was recorded." };
    (f as unknown as { state: Record<string, unknown> }).state.notice = answer;
    expect(await f.checkHandover()).toBe(true);
    expect(f.getState().notice).toBe(answer);
  });

  it("a retired controller (route or account change) schedules and reads nothing more", async () => {
    vi.useFakeTimers();
    const { port, calls } = scripted(Array.from({ length: 5 }, () => setup("gated")));
    const f = flowOf(port);
    await f.load();
    f.watchHandover(1_000, 10);
    f.retire();
    await tick(5_000);
    expect(calls.setup).toBe(1);
    expect(f.watching).toBe(false);
    expect(await f.checkHandover()).toBe(false);
  });
});
