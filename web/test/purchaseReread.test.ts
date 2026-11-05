// Job 003wf3 (Astra 03:05): the purchase panel's re-read after a unit change never replaces a
// purchase being reviewed or sent, and a failed re-read keeps the earlier reading, marked as
// such. The actual PurchaseFlow with a scripted port (no network, no wallet).

import { describe, expect, it } from "vitest";
import { PurchaseFlow, type PurchaseSetup } from "../src/purchase.ts";

const ACCOUNT = "cara.testnet";
const setup = (free: string) =>
  ({ customer: ACCOUNT, entitlement: { free } }) as unknown as PurchaseSetup;

function flowWith(answers: (PurchaseSetup | Error)[]) {
  let calls = 0;
  const port = {
    setup: async () => {
      calls++;
      const a = answers.shift();
      if (!a || a instanceof Error) throw a ?? new Error("script exhausted");
      return a;
    },
  };
  const f = new PurchaseFlow(port as never, () => null, { offerId: "o1", account: ACCOUNT });
  return { f, calls: () => calls };
}

describe("003wf3 the purchase reading is taken again only when nothing is in progress", () => {
  it("a review or a request in progress keeps its exact reading; once idle, the re-read follows", async () => {
    const { f, calls } = flowWith([setup("99"), setup("100")]);
    await f.load();
    const state = f as unknown as { state: Record<string, unknown> };
    const review = { kind: "purchase", units: 10 };
    state.state = { ...state.state, review };
    expect(await f.reread()).toBe(false);
    state.state = { ...state.state, review: null, busy: "wallet" };
    expect(await f.reread()).toBe(false);
    expect(calls()).toBe(1);
    expect(f.getState().setup?.entitlement?.free).toBe("99");
    state.state = { ...state.state, busy: null };
    expect(await f.reread()).toBe(true);
    expect(f.getState()).toMatchObject({ rereadFailed: false });
    expect(f.getState().setup?.entitlement?.free).toBe("100");
  });

  it("a failed re-read keeps the earlier reading and its time, marked as not re-read", async () => {
    const { f } = flowWith([setup("99"), new Error("The contract couldn't be read.")]);
    await f.load();
    const at = f.getState().readAtMs;
    expect(await f.reread()).toBe(false);
    expect(f.getState()).toMatchObject({ status: "ready", rereadFailed: true, readAtMs: at });
    expect(f.getState().setup?.entitlement?.free).toBe("99");
  });
});
