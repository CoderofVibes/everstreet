// Job 003web: the browser's PurchaseFlow controller (web/src/purchase.ts) over the REAL routes of the
// customer world, for a FRESH customer, with a wallet whose send applies the exact call through the
// contract-anchored double (FixtureChain.walletCall) and answers with the transaction's hash, as
// the pinned adapter's FinalExecutionOutcome would. Cancellation, a lost answer, renewed review,
// the browser's own request check, the wallet's account and retirement are covered.

import { describe, expect, it } from "vitest";
import { PurchaseFlow, type PurchasePort } from "../../web/src/purchase.ts";
import type { WalletBoundary, WalletFunctionCall } from "../../web/src/wallet.ts";
import {
  type CustomerWorld,
  customerWorld,
  FRESH,
  type Json,
  SyntheticProtection,
} from "./customer-world.ts";

async function world() {
  const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
  return { w, offer: await w.offer() };
}

/** The page's port, over the real routes as Dana's session; errors carry code/detail like HTTP. */
function port(w: CustomerWorld, tamper?: (b: Json) => Json): PurchasePort {
  const go = async (path: string, method = "GET", body?: unknown) => {
    const r = await w.dana(path, method, body);
    if (r.status >= 400) {
      const e = new Error(r.body.error) as Error & { code?: string; detail?: unknown };
      e.code = r.body.code;
      e.detail = r.body.detail;
      throw e;
    }
    return tamper ? tamper(r.body) : r.body;
  };
  return {
    setup: (o, units) =>
      go(
        `/api/customer/offers/${o}/purchase-setup${units === undefined ? "" : `?units=${units}`}`,
      ) as never,
    create: (o, b) => go(`/api/customer/offers/${o}/purchases`, "POST", b) as never,
    requested: (id, b) => go(`/api/customer/purchases/${id}/requested`, "POST", b) as never,
    check: (id, b) => go(`/api/customer/purchases/${id}/check`, "POST", b) as never,
    abandon: (id) => go(`/api/customer/purchases/${id}/abandon`, "POST") as never,
  };
}

/** The customer's wallet over the double: "land", "lose" (lands, answer lost), "close" (cancelled). */
function wallet(w: CustomerWorld, account = FRESH) {
  const st = {
    mode: "land" as "land" | "lose" | "close",
    sent: [] as WalletFunctionCall[],
    before: null as null | (() => void),
  };
  const b: WalletBoundary = {
    label: "synthetic wallet (test)",
    synthetic: true,
    signMessage: async () => {
      throw new Error("not used");
    },
    connect: async () => account,
    accounts: async () => [account],
    send: async (call) => {
      st.before?.();
      st.sent.push(call);
      if (st.mode === "close") throw new Error("User closed the window");
      const o = w.chain.walletCall(account, call as never);
      if (st.mode === "lose") throw new Error("Failed to fetch");
      return { txHash: o.transaction.hash as string };
    },
    disconnect: async () => {},
    onChange: () => () => {},
  };
  return { b, st };
}

describe("003web PurchaseFlow for a fresh customer", () => {
  it("shell, then 100 uses: exact reviews, the wallet asked once each, confirmed by the contract", async () => {
    const { w, offer } = await world();
    const wal = wallet(w);
    const f = new PurchaseFlow(port(w), async () => wal.b, { offerId: offer, account: FRESH });
    f.setUnits(100);
    await f.load();
    expect(f.getState().setup?.steps).toEqual(["shell"]);
    await f.review("shell");
    expect(f.getState().review).toMatchObject({
      kind: "shell",
      call: { methodName: "sponsor_shell", deposit: "8200000000000000000000" },
    });
    await f.confirmSetupStep();
    expect(f.getState().notice?.text).toMatch(/registration with this business is confirmed/);
    await f.review("purchase");
    const r = f.getState().review;
    expect(r).toMatchObject({
      kind: "purchase",
      preview: { units: 100, amount: "5000000", purchase_seq: 1 },
    });
    await f.confirmPurchase();
    expect(f.getState().resolution).toEqual({ kind: "confirmed", units: 100, amount: "5000000" });
    expect(f.getState().setup?.entitlement).toMatchObject({ free: "100", purchase_seq: 1 });
    expect(wal.st.sent.map((c) => c.methodName)).toEqual(["sponsor_shell", "ft_transfer_call"]);
  });

  it("a lost wallet answer: unknown, recovered first; the identical request again is accepted at most once", async () => {
    const { w, offer } = await world();
    const wal = wallet(w);
    const f = new PurchaseFlow(port(w), async () => wal.b, { offerId: offer, account: FRESH });
    await f.load();
    await f.review("shell");
    await f.confirmSetupStep();
    f.setUnits(10);
    await f.review("purchase");
    wal.st.mode = "lose";
    await f.confirmPurchase();
    expect(f.getState().resolution?.kind).toBe("unknown");
    const open = f.getState().setup?.open;
    expect(open?.state).toBe("unknown");
    // Recovery comes first: no new purchase is offered while this one is open.
    await f.review("purchase");
    expect(f.getState().notice?.text).toMatch(/still waiting/);
    // Asking again is its own reviewed consent, for the IDENTICAL request.
    wal.st.mode = "land";
    await f.review("resend");
    expect(f.getState().review).toMatchObject({ kind: "resend", purchase: { id: open?.id } });
    await f.confirmResend();
    expect(wal.st.sent.slice(-2).map((c) => JSON.stringify(c))).toEqual([
      JSON.stringify(open?.call),
      JSON.stringify(open?.call),
    ]);
    // The duplicate came back whole; asked twice, that alone can't say the first wasn't accepted.
    expect(f.getState().resolution?.kind).toBe("unknown");
    expect(w.chain.ent(FRESH)).toMatchObject({ free: "10", purchase_seq: 1 }); // bought once
    expect(w.chain.balances.get(FRESH)).toBe(10_000_000n - 500_000n); // paid once
    // The FIRST attempt's own transaction (e.g. from the wallet's history) confirms it.
    const first = [...w.chain.txs.values()].find(
      (t) => t.transaction.actions[0].FunctionCall.method_name === "ft_transfer_call",
    );
    await f.checkOpen(open?.id as string, first?.transaction.hash);
    expect(f.getState().resolution).toEqual({ kind: "confirmed", units: 10, amount: "500000" });
  });

  it("cancelled in the wallet: it stays open (never set aside); the reviewed identical request completes it once", async () => {
    const { w, offer } = await world();
    const wal = wallet(w);
    const f = new PurchaseFlow(port(w), async () => wal.b, { offerId: offer, account: FRESH });
    await f.load();
    await f.review("shell");
    await f.confirmSetupStep();
    f.setUnits(2);
    await f.review("purchase");
    wal.st.mode = "close";
    await f.confirmPurchase();
    expect(f.getState().notice?.text).toMatch(/closed the wallet/);
    const open = f.getState().setup?.open;
    expect(open?.state).toBe("unknown");
    await f.setAside(open?.id as string);
    expect(f.getState().notice?.text).toMatch(/stays open/);
    expect(f.getState().setup?.open?.id).toBe(open?.id);
    wal.st.mode = "land";
    await f.review("resend");
    await f.confirmResend();
    expect(f.getState().resolution?.kind).toBe("confirmed");
    expect(w.chain.balances.get(FRESH)).toBe(10_000_000n - 100_000n);
  });

  it("terms that changed after review are shown again, never sent", async () => {
    const { w, offer } = await world();
    const wal = wallet(w);
    const f = new PurchaseFlow(port(w), async () => wal.b, { offerId: offer, account: FRESH });
    await f.load();
    await f.review("shell");
    await f.confirmSetupStep();
    f.setUnits(3);
    await f.review("purchase");
    const reviewed = f.getState().review;
    // Another device buys first: sequence 1 is used.
    w.chain.walletCall(
      FRESH,
      (f.getState().review as unknown as { preview: { call: never } }).preview.call,
    );
    const sent = wal.st.sent.length;
    await f.confirmPurchase();
    expect(wal.st.sent.length).toBe(sent);
    expect(f.getState().notice?.text).toMatch(/changed since you reviewed/);
    expect(f.getState().review).toMatchObject({ kind: "purchase", preview: { purchase_seq: 2 } });
    expect(f.getState().review).not.toEqual(reviewed);
  });

  it("the browser's own check: a request that doesn't match its terms is refused, nothing stored or sent", async () => {
    const { w, offer } = await world();
    const wal = wallet(w);
    const evil = (b: Json) =>
      b.preview?.call
        ? {
            ...b,
            preview: {
              ...b.preview,
              call: {
                ...b.preview.call,
                args: { ...b.preview.call.args, receiver_id: "elsewhere.near" },
              },
            },
          }
        : b;
    const ok = new PurchaseFlow(port(w), async () => wal.b, { offerId: offer, account: FRESH });
    await ok.load();
    await ok.review("shell");
    await ok.confirmSetupStep();
    const f = new PurchaseFlow(port(w, evil), async () => wal.b, {
      offerId: offer,
      account: FRESH,
    });
    f.setUnits(1);
    await f.review("purchase");
    await f.confirmPurchase();
    expect(f.getState().notice?.text).toMatch(/doesn't match its own terms/);
    expect(wal.st.sent.map((c) => c.methodName)).toEqual(["sponsor_shell"]);
    expect((await w.dana("/api/customer/purchases")).body.purchases).toEqual([]);
  });

  it("a wallet on another account sends nothing; a retired flow (sign-out, switch) applies nothing", async () => {
    const { w, offer } = await world();
    const other = wallet(w, "mallory.near");
    const f = new PurchaseFlow(port(w), async () => other.b, { offerId: offer, account: FRESH });
    await f.load();
    await f.review("shell");
    await f.confirmSetupStep();
    expect(f.getState().notice?.text).toMatch(/mallory\.near/);
    expect(other.st.sent).toEqual([]);
    const mine = wallet(w);
    const g = new PurchaseFlow(port(w), async () => mine.b, { offerId: offer, account: FRESH });
    await g.load();
    await g.review("shell");
    mine.st.before = () => g.retire();
    await g.confirmSetupStep();
    expect(g.retired).toBe(true);
    expect(g.getState().notice).toBeNull();
  });

  it("recovery by the original transaction's ID: wrong ones change nothing, the right one confirms, no wallet request", async () => {
    const { w, offer } = await world();
    const wal = wallet(w);
    const f = new PurchaseFlow(port(w), async () => wal.b, { offerId: offer, account: FRESH });
    await f.load();
    await f.review("shell");
    await f.confirmSetupStep();
    f.setUnits(4);
    await f.review("purchase");
    wal.st.mode = "lose";
    await f.confirmPurchase();
    const open = f.getState().setup?.open;
    expect(open?.state).toBe("unknown");
    const sent = wal.st.sent.length;
    const txs = [...w.chain.txs.values()];
    const mine = txs.find(
      (t) => t.transaction.actions[0].FunctionCall.method_name === "ft_transfer_call",
    );
    const shell = txs.find(
      (t) => t.transaction.actions[0].FunctionCall.method_name === "sponsor_shell",
    );
    await f.checkWithTransaction(open?.id as string, "nope");
    expect(f.getState().notice?.text).toMatch(/isn't a NEAR transaction ID/);
    await f.checkWithTransaction(open?.id as string, `  ${shell?.transaction.hash}  `);
    expect(f.getState().notice?.text).toMatch(/isn't this purchase/);
    expect(f.getState().setup?.open).toMatchObject({
      id: open?.id,
      state: "unknown",
      tx_hash: null,
    });
    await f.checkWithTransaction(open?.id as string, mine?.transaction.hash as string);
    expect(f.getState().resolution).toEqual({ kind: "confirmed", units: 4, amount: "200000" });
    expect(f.getState().setup?.open).toBeNull();
    expect(wal.st.sent.length).toBe(sent);
  });

  it("a transaction check is one at a time, and its late answer after an account switch applies nothing", async () => {
    const { w, offer } = await world();
    const wal = wallet(w);
    const base = port(w);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let checks = 0;
    const slow: PurchasePort = {
      ...base,
      check: async (id, b) => {
        checks++;
        await gate;
        return base.check(id, b);
      },
    };
    const f = new PurchaseFlow(slow, async () => wal.b, { offerId: offer, account: FRESH });
    await f.load();
    await f.review("shell");
    await f.confirmSetupStep();
    f.setUnits(2);
    await f.review("purchase");
    wal.st.mode = "lose";
    const sending = f.confirmPurchase();
    // The purchase's own check is waiting: another check is refused meanwhile.
    for (let i = 0; i < 50 && checks === 0; i++) await new Promise((r) => setTimeout(r, 5));
    const mine = [...w.chain.txs.values()].find(
      (t) => t.transaction.actions[0].FunctionCall.method_name === "ft_transfer_call",
    );
    await f.checkWithTransaction("any", mine?.transaction.hash as string);
    expect(checks).toBe(1);
    release();
    await sending;
    const open = f.getState().setup?.open;
    expect(open?.state).toBe("unknown");
    // Now a slow transaction check, and the account changes (the page retires the flow) first.
    let release2: () => void = () => {};
    const gate2 = new Promise<void>((r) => {
      release2 = r;
    });
    const g = new PurchaseFlow(
      {
        ...base,
        check: async (id, b) => {
          await gate2;
          return base.check(id, b);
        },
      },
      async () => wal.b,
      { offerId: offer, account: FRESH },
    );
    await g.load();
    const before = g.getState();
    const late = g.checkWithTransaction(open?.id as string, mine?.transaction.hash as string);
    g.retire();
    release2();
    await late;
    expect(g.getState().resolution).toBe(before.resolution);
    expect(g.getState().setup).toBe(before.setup);
    // The server did settle it from its own transaction; only the retired view showed nothing.
    const listed = (await w.dana("/api/customer/purchases")).body.purchases;
    expect(listed.find((p: Json) => p.id === open?.id)?.state).toBe("confirmed");
  });

  it("a review reads the CURRENT state: an edit during its read is reviewed, not the older quantity; a retired flow stays inert", async () => {
    const { w, offer } = await world();
    const wal = wallet(w);
    const base = port(w);
    const held: (() => void)[] = [];
    let hold = false;
    const gated: PurchasePort = {
      ...base,
      setup: async (o, u) => {
        const answer = await base.setup(o, u); // read now; only the delivery waits
        if (hold) await new Promise<void>((r) => held.push(r));
        return answer;
      },
    };
    const arrived = async () => {
      for (let i = 0; i < 400 && held.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
      expect(held.length).toBe(1);
    };
    const f = new PurchaseFlow(gated, async () => wal.b, { offerId: offer, account: FRESH });
    await f.load();
    await f.review("shell");
    await f.confirmSetupStep();
    f.setUnits(3);
    hold = true;
    const reviewing = f.review("purchase");
    await arrived();
    f.setUnits(7); // edited while the review's read is in flight
    hold = false;
    for (const r of held.splice(0)) r();
    await reviewing;
    expect(f.getState().units).toBe(7);
    expect(f.getState().review).toMatchObject({ kind: "purchase", preview: { units: 7 } });
    // A retired flow: its in-flight read applies nothing, and a review prepares nothing.
    hold = true;
    const late = f.load();
    await arrived();
    const before = f.getState();
    f.retire();
    for (const r of held.splice(0)) r();
    expect(await late).toBe(false);
    hold = false;
    await f.review("purchase");
    expect(f.getState()).toBe(before);
    expect(wal.st.sent.map((c) => c.methodName)).toEqual(["sponsor_shell"]);
  });
});
