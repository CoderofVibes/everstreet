// Job 003wf2: the browser's SaleFlow controller (web/src/saleFlow.ts) driven against the REAL app
// routes over the one synthetic customer+sale state (sale-world.ts), with a synthetic wallet
// boundary that signs nothing and applies exactly the call it is given (or loses its answer, is
// closed, or uses another account, as a harness control says). Node environment: the controller
// needs no DOM; SubtleCrypto is Node's own.

import { describe, expect, it } from "vitest";
import type { SalePort } from "../../web/src/saleApi.ts";
import { SaleError } from "../../web/src/saleApi.ts";
import { verifyPreview } from "../../web/src/saleCalls.ts";
import { noticeFor, SaleFlow, saleNext, saleSentence, saleSteps } from "../../web/src/saleFlow.ts";
import type { WalletBoundary } from "../../web/src/wallet.ts";
import type { Json } from "./customer-world.ts";
import { BUYER, PRICE, proposal, type SaleWorld, SELLER, saleWorld } from "./sale-world.ts";

type Caller = SaleWorld["ava"];

/** The real routes, as the browser's port reaches them. */
function port(
  s: SaleWorld,
  who: Caller,
  tamper?: (p: Json) => void,
): SalePort & { creates: number } {
  const go = async (path: string, method = "GET", body?: unknown) => {
    const r = await who(path, method, body);
    if (r.status >= 400)
      throw new SaleError(
        r.body.error ?? `failed ${r.status}`,
        r.status,
        r.body.code,
        r.body.detail,
      );
    return r.body as never;
  };
  const p = {
    creates: 0,
    setup: (b: string) => go(`/api/sales/${b}`),
    prepare: async (b: string, kind: string, input: Json) => {
      const out = (await go(`/api/sales/${b}/prepare`, "POST", { kind, input })) as Json;
      tamper?.(out);
      return out as never;
    },
    create: (b: string, body: unknown) => {
      p.creates++;
      return go(`/api/sales/${b}/actions`, "POST", body);
    },
    requested: (id: string, body: unknown) =>
      go(`/api/sales/actions/${id}/requested`, "POST", body),
    check: (id: string, body: unknown) => go(`/api/sales/actions/${id}/check`, "POST", body),
    abandon: (id: string) => go(`/api/sales/actions/${id}/abandon`, "POST"),
    reconcile: (b: string, i: string) =>
      go(`/api/businesses/${b}/v3/intents/${i}/reconcile`, "POST"),
  };
  return p as unknown as SalePort & { creates: number };
}

/** A synthetic wallet boundary over the double (no keys): exactly one FunctionCall per send. */
function wallet(s: SaleWorld, account: string) {
  const c = { account, cancelNext: false, loseNext: false, sent: 0 };
  const w: WalletBoundary = {
    label: "Synthetic controller-test wallet",
    synthetic: true,
    signMessage: async () => undefined,
    connect: async () => c.account,
    accounts: async () => [c.account],
    async send(call) {
      if (c.cancelNext) {
        c.cancelNext = false;
        throw new Error("User closed the window");
      }
      c.sent++;
      const out = s.wallet(c.account, call as never);
      if (c.loseNext) {
        c.loseNext = false;
        throw new Error("Synthetic: the wallet's answer was lost");
      }
      return { txHash: out.transaction.hash as string };
    },
    disconnect: async () => {},
    onChange: () => () => {},
  };
  return { w, c };
}

const flowFor = (s: SaleWorld, who: Caller, account: string, tamper?: (p: Json) => void) => {
  const p = port(s, who, tamper);
  const wl = wallet(s, account);
  const f = new SaleFlow(p, () => Promise.resolve(wl.w), { businessId: s.biz, account });
  return { f, p, wl };
};

describe("003wf2 SaleFlow controller against the real routes", () => {
  it("seller and buyer reach a verified close and reconciliation through their own controllers", async () => {
    const s = await saleWorld();
    const seller = flowFor(s, s.ava, SELLER);
    await seller.f.load();
    expect(saleNext(seller.f.getState())).toMatchObject({ action: "terms" });
    await seller.f.review("propose", proposal());
    expect(seller.f.getState().review?.preview.kind).toBe("propose");
    await seller.f.confirm();
    expect(seller.f.getState().notice).toMatchObject({ tone: "ok" });
    expect(s.control().live_deal).toMatchObject({ seq: "1", version: 1 });

    const buyer = flowFor(s, s.noah, BUYER);
    await buyer.f.load();
    const steps: string[] = [];
    for (let i = 0; i < 4; i++) {
      const n = saleNext(buyer.f.getState());
      steps.push(n.action);
      if (n.action === "none") break;
      await buyer.f.review(n.action as never, (n as { input?: Json }).input ?? {});
      await buyer.f.confirm();
    }
    expect(steps).toEqual(["register", "fund", "accept", "none"]);
    expect(saleNext(buyer.f.getState())).toMatchObject({
      why: "Waiting for the seller to accept.",
    });

    await seller.f.load();
    const n = saleNext(seller.f.getState());
    expect(n).toMatchObject({ action: "accept", label: "Accept version 1 and close the sale" });
    await seller.f.review("accept");
    await seller.f.confirm();
    expect(s.control()).toMatchObject({ owner: BUYER, generation: 2 });
    // Applied here by the existing reconciliation (the confirmed close ran it): nothing to apply.
    const after = seller.f.getState().setup as Json;
    expect(after.local_owner).toBe(false);
    expect(saleNext(seller.f.getState())).toMatchObject({
      action: "register",
      label: "Register with the token to collect",
    });
    expect(seller.wl.c.sent + buyer.wl.c.sent).toBe(5);
  });

  it("another wallet account, a closed wallet and a tampered preview send nothing", async () => {
    const s = await saleWorld();
    const seller = flowFor(s, s.ava, SELLER);
    await seller.f.load();
    seller.wl.c.account = BUYER; // the wallet switched accounts
    await seller.f.review("propose", proposal());
    await seller.f.confirm();
    expect(seller.f.getState().notice?.text).toContain(`not ${SELLER}`);
    expect([seller.p.creates, seller.wl.c.sent, s.sale.dealSeq]).toEqual([0, 0, 0n]);
    seller.wl.c.account = SELLER;
    // Closed before approving: the request stays asked and unknown; nothing went out.
    seller.wl.c.cancelNext = true;
    await seller.f.confirm();
    expect(seller.wl.c.sent).toBe(0);
    expect(seller.f.getState().setup?.open[0]?.state).toBe("unknown");
    // A preview whose call says another price than its reviewed terms is refused in the browser.
    const t = await saleWorld();
    const tampered = flowFor(t, t.ava, SELLER, (p) => {
      p.call.args.terms.price = "1";
    });
    await tampered.f.load();
    await tampered.f.review("propose", proposal());
    expect(tampered.f.getState().review).toBeNull();
    expect(tampered.f.getState().notice?.text).toContain("doesn't match its own reviewed terms");
    // A terms document that says something else than its hash: refused too.
    const u = await saleWorld();
    const doc = flowFor(u, u.ava, SELLER, (p) => {
      p.terms_doc.text = p.terms_doc.text.replace("Fictional terms", "Other terms");
    });
    await doc.f.load();
    await doc.f.review("propose", proposal());
    expect(doc.f.getState().notice?.text).toContain("doesn't hash to the terms hash");
    expect(doc.p.creates).toBe(0);
  });

  it("verifyPreview recomputes the contract digest itself", async () => {
    const s = await saleWorld();
    const seller = flowFor(s, s.ava, SELLER);
    await seller.f.load();
    const p = (await seller.p.prepare(s.biz, "propose", proposal())) as unknown as Json;
    const setup = seller.f.getState().setup as never;
    expect(await verifyPreview(p as never, setup, SELLER)).toBeNull();
    const wrong = structuredClone(p);
    wrong.review.digest_basis.plan_count = 9;
    expect(await verifyPreview(wrong as never, setup, SELLER)).toContain("doesn't recompute");
  });

  it("a lost wallet answer stays unknown; the original transaction confirms it; nothing is resent", async () => {
    const s = await saleWorld();
    const seller = flowFor(s, s.ava, SELLER);
    await seller.f.load();
    await seller.f.review("propose", proposal());
    seller.wl.c.loseNext = true;
    await seller.f.confirm();
    // Proven unable to take effect: no longer open (it stops blocking), listed with its state.
    expect(seller.f.getState().setup?.open).toEqual([]);
    const open = seller.f.getState().setup?.actions[0];
    expect(open?.state).toBe("no_longer_possible"); // it landed: control moved, outcome unknown
    expect(saleNext(seller.f.getState()).action).not.toBe("propose");
    const tx = [...s.w.chain.txs.keys()].at(-1) as string;
    await seller.f.checkWithTransaction(open?.id as string, "not-an-id");
    expect(seller.f.getState().notice?.text).toContain("isn't a NEAR transaction ID");
    await seller.f.checkWithTransaction(open?.id as string, tx);
    expect(seller.f.getState().notice).toMatchObject({ tone: "ok" });
    expect([seller.wl.c.sent, s.sale.dealSeq]).toEqual([1, 1n]);
  });

  it("a lost answer to the ask is retried by the same claimant only; a reload recovers a stored request", async () => {
    const s = await saleWorld();
    const seller = flowFor(s, s.ava, SELLER);
    let lose = 1;
    const real = seller.p.requested;
    seller.p.requested = async (id, body) => {
      const r = await real(id, body);
      if (!body.tx_hash && lose-- > 0) throw new Error("Synthetic: the ask's answer was lost");
      return r;
    };
    await seller.f.load();
    await seller.f.review("propose", proposal());
    await seller.f.confirm();
    expect([seller.wl.c.sent, seller.f.getState().notice?.tone]).toEqual([1, "ok"]);
    // A stored request whose wallet was never asked, recovered by a NEW controller (a reload).
    const t = await saleWorld();
    const first = flowFor(t, t.ava, SELLER);
    first.p.requested = async () => {
      throw new Error("Synthetic: the page closed here");
    };
    await first.f.load();
    await first.f.review("propose", proposal());
    await first.f.confirm();
    first.f.retire();
    const reload = flowFor(t, t.ava, SELLER);
    await reload.f.load();
    const n = saleNext(reload.f.getState());
    expect(n.action).toBe("continue");
    await reload.f.continuePrepared((n as { id: string }).id);
    expect([reload.wl.c.sent, t.sale.dealSeq]).toEqual([1, 1n]);
  });

  it("progress is the CURRENT deal's: an earlier close never completes a new sale; collection is shown only from the seller's own evidence", async () => {
    const s = await saleWorld();
    const close = async () => {
      await s.act(s.ava, SELLER, "propose", proposal());
      await s.act(s.noah, BUYER, "register");
      await s.act(s.noah, BUYER, "fund");
      await s.act(s.noah, BUYER, "accept");
      await s.act(s.ava, SELLER, "accept");
    };
    await close();
    const seller = flowFor(s, s.ava, SELLER);
    const buyer = flowFor(s, s.noah, BUYER);
    await Promise.all([seller.f.load(), buyer.f.load()]);
    const status = (f: SaleFlow) =>
      Object.fromEntries(saleSteps(f.getState().setup as never).map((x) => [x.key, x.status]));
    // Before any payout: the seller sees proceeds owed; the buyer isn't shown the seller's collection.
    expect(status(seller.f)).toMatchObject({ apply: "done", operate: "done", collect: "current" });
    expect(status(buyer.f)).toMatchObject({ apply: "done", operate: "done", collect: "unknown" });
    // A restored payout is still owed; only the confirmed paid one completes it.
    await s.act(s.ava, SELLER, "register");
    s.sale.failPayouts = 1;
    await s.act(s.ava, SELLER, "claim", { category: 2 });
    await seller.f.load();
    expect(status(seller.f).collect).toBe("current");
    await s.act(s.ava, SELLER, "claim", { category: 2 });
    await Promise.all([seller.f.load(), buyer.f.load()]);
    expect(status(seller.f).collect).toBe("done");
    expect(status(buyer.f).collect).toBe("unknown");
    // The new owner sells on to the former seller: deal 2 is the current sale, not funded.
    await s.act(s.noah, BUYER, "propose", { ...proposal(), buyer_account: SELLER });
    await Promise.all([seller.f.load(), buyer.f.load()]);
    expect(status(buyer.f)).toMatchObject({
      terms: "done",
      escrow: "current",
      accept: "waiting",
      apply: "waiting",
    });
    expect(saleSentence(buyer.f.getState().setup as never)).toMatch(
      /^Deal 2, version 1: escrow not funded/,
    );
    expect(saleNext(seller.f.getState())).toMatchObject({ action: "fund" });
  });

  it("a repeat sale: an earlier sale's confirmed payout never marks this sale's proceeds collected", async () => {
    const s = await saleWorld();
    s.w.chain.ceiling = 900; // an explicit, still finite budget for three sales
    const sell = async (from: Caller, fromAcct: string, to: Caller, toAcct: string) => {
      await s.act(from, fromAcct, "propose", { ...proposal(), buyer_account: toAcct });
      if (!(await s.setup(to)).body.token.registered) await s.act(to, toAcct, "register");
      await s.act(to, toAcct, "fund");
      await s.act(to, toAcct, "accept");
      expect((await s.act(from, fromAcct, "accept")).check?.body.resolution.result).toBe("closed");
    };
    s.w.chain.balances.set(SELLER, 2_000_000_000n);
    await sell(s.ava, SELLER, s.noah, BUYER); // deal 1: Ava -> Noah
    await s.act(s.ava, SELLER, "register");
    expect(
      (await s.act(s.ava, SELLER, "claim", { category: 2 })).check?.body.resolution.result,
    ).toBe("paid");
    await sell(s.noah, BUYER, s.ava, SELLER); // deal 2: Noah -> Ava
    await sell(s.ava, SELLER, s.noah, BUYER); // deal 3: Ava -> Noah
    // Ava's deal 3 claim: the wallet sends it, its answer is lost, and nobody has checked it.
    const lost = await s.act(s.ava, SELLER, "claim", { category: 2 }, { lose: true });
    expect(lost.action?.review.for_deal).toBe("3");
    const seller = flowFor(s, s.ava, SELLER);
    await seller.f.load();
    const collect = saleSteps(seller.f.getState().setup as never).find((x) => x.key === "collect");
    expect(collect).toMatchObject({ status: "current" });
    expect(collect?.detail).not.toContain("Paid");
    // Its own transaction confirms it: only then is THIS sale's collection done.
    await seller.f.checkWithTransaction(
      lost.action?.id as string,
      lost.outcome?.transaction.hash as string,
    );
    const after = saleSteps(seller.f.getState().setup as never).find((x) => x.key === "collect");
    expect(after).toMatchObject({ status: "done" });
  });

  it("a wallet that switches accounts after the ask sends nothing; switching back resumes the same request once", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    const buyer = flowFor(s, s.noah, BUYER);
    const real = buyer.p.requested;
    buyer.p.requested = async (id, body) => {
      const r = await real(id, body);
      if (!body.tx_hash) buyer.wl.c.account = "stranger.near"; // switched while the ask answered
      return r;
    };
    await buyer.f.load();
    await buyer.f.review("register");
    await buyer.f.confirm();
    expect(buyer.wl.c.sent).toBe(0);
    expect(buyer.f.getState().notice?.text).toContain("switched to stranger.near");
    expect(buyer.f.resumableId).toBeTruthy();
    // Back to the buyer's account: the same claimant's ask is re-granted (nothing was sent), once.
    buyer.p.requested = real;
    buyer.wl.c.account = BUYER;
    await buyer.f.resume();
    expect(buyer.wl.c.sent).toBe(1);
    expect(buyer.f.resumableId).toBeNull();
    const reg = buyer.f.getState().setup?.actions.find((a) => a.kind === "register");
    expect(reg?.state).toBe("confirmed");
    // Another tab (another claimant) can't claim it: it was asked already.
    const other = await s.noah(`/api/sales/actions/${reg?.id}/requested`, "POST", {
      ask_id: "other-tab-0001",
    });
    expect(other.body.ask).toBe("already_asked");
  });

  it("a review that went stale before storing is refused for a new review; retired controllers drop late answers", async () => {
    const s = await saleWorld();
    const seller = flowFor(s, s.ava, SELLER);
    await seller.f.load();
    await seller.f.review("propose", proposal());
    await s.act(s.ava, SELLER, "register"); // another tab moved nothing on the sale...
    // ...but the business's control does move when another tab proposes first:
    await s.act(s.ava, SELLER, "propose", proposal({ price: "1000000" }));
    await seller.f.confirm();
    expect(seller.f.getState().notice?.text).toMatch(
      /changed since you reviewed it|already in progress/,
    );
    expect(seller.wl.c.sent).toBe(0);
    const old = flowFor(s, s.ava, SELLER);
    const pending = old.f.load();
    old.f.retire();
    await pending;
    expect(old.f.getState().setup).toBeNull();
    expect(PRICE).toBe("250000000");
  });

  it("Not now keeps the draft and returns focus to its origin; a changed sale keeps the terms; a confirmed proposal settles them", async () => {
    const s = await saleWorld();
    const seller = flowFor(s, s.ava, SELLER);
    await seller.f.load();
    const draft = {
      buyer: BUYER,
      price: "250",
      days: 7,
      floor: "0.1",
      metering: true,
      exclusions: "ledgerline.example domain",
      note: "",
    };
    seller.f.setDraft("propose", draft);
    await seller.f.review("propose", proposal(), null, "terms-propose");
    expect(seller.f.getState().review?.origin).toBe("terms-propose");
    seller.f.cancelReview();
    expect(seller.f.getState()).toMatchObject({
      review: null,
      focus: "terms-propose",
      drafts: { propose: draft },
    });
    seller.f.focused();
    expect(seller.f.getState().focus).toBeNull();
    // The sale changes between review and confirm: nothing stored or sent, the terms are kept.
    await seller.f.review("propose", proposal(), null, "terms-propose");
    await s.act(s.ava, SELLER, "propose", proposal({ price: "1000000" }));
    await seller.f.confirm();
    expect(seller.f.getState()).toMatchObject({
      review: null,
      focus: "terms-propose",
      drafts: { propose: draft },
    });
    // The one create attempt was refused (review_changed): the other tab's terms stand.
    expect([seller.wl.c.sent, seller.p.creates]).toEqual([0, 1]);
    expect(s.control().live_deal).toMatchObject({ price: "1000000", version: 1 });
    // A confirmed revision settles its own draft only.
    seller.f.setDraft("revise", { ...draft, price: "260" });
    await seller.f.load();
    await seller.f.review("revise", proposal({ price: "260000000" }), null, "terms-revise");
    await seller.f.confirm();
    expect(seller.f.getState().notice).toMatchObject({ tone: "ok" });
    expect(seller.f.getState().drafts).toEqual({ propose: draft });
  });

  it("the notice for a confirmed close follows the stored follow-up: unfinished, final-but-not-applied, applied", () => {
    const r = { kind: "confirmed", result: "closed", message: "Closed." } as never;
    expect(
      noticeFor(r, false, {
        reconcile: { state: "unavailable", message: "no read" },
        finished: false,
      }),
    ).toMatchObject({ tone: "info", text: expect.stringContaining("Apply the close here") });
    const final = noticeFor(r, false, {
      reconcile: { state: "superseded", message: "A later version replaced it" },
      finished: true,
    });
    expect(final).toMatchObject({ tone: "warn" });
    expect(final?.text).not.toContain("check again");
    expect(
      noticeFor(r, false, {
        reconcile: { state: "already", message: "Already applied." },
        finished: true,
      }),
    ).toMatchObject({ tone: "ok", text: "Closed. Already applied." });
  });
});
