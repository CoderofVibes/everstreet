// Promise 11: an agent that gets a 402 pays from its own account and gets exactly the units it
// bought; its purchases never land on another customer or let it act as the owner.
import { describe, expect, it } from "vitest";
import type { Json } from "../customer-world.ts";
import { type Caller, reviewWorld } from "./world.ts";

const INSTALL = { slot: 1, pk: "cd".repeat(32), max_hold_units: 1, max_units_per_day: 20 };

describe("pr09: HTTP 402 purchases", () => {
  async function get402(w: Awaited<ReturnType<typeof reviewWorld>>, who: Caller, account: string) {
    let n = 0;
    const prepare = () =>
      who(`/api/customer/offers/${w.offerId}/prepare`, "POST", {
        idempotency_key: `agent-${account.split(".")[0]}-${++n}`,
        input: "Fictional invoice SH-1042 from Stackline Hosting Ltd, total 412.50 USD",
        key_slot: 1,
        buy: { units: 3, install: INSTALL },
      });
    let r = await prepare();
    expect(r.status).toBe(402);
    for (const step of (r.body.before ?? []) as { call: Json }[]) w.wallet(account, step.call);
    if (r.body.before?.length) r = await prepare();
    expect(r.status).toBe(402);
    expect(r.body.purchase).not.toBeNull();
    return r.body;
  }

  it("the agent's purchase is confirmed for its own account and nobody else's", async () => {
    const w = await reviewWorld();
    const offer = await get402(w, w.dana, "dana.near");
    expect(offer.offer.payer).toBe("dana.near");
    const made = await w.dana(`/api/customer/offers/${w.offerId}/purchases`, "POST", {
      idempotency_key: "agent-dana-buy",
      units: 3,
      install: INSTALL,
      terms_digest: offer.purchase.terms_digest,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.purchase.id as string;
    const tx = w.wallet("dana.near", offer.purchase.call);
    const hash = String(tx.transaction.hash);
    await w.dana(`/api/customer/purchases/${id}/requested`, "POST", { tx_hash: hash });
    const checked = await w.dana(`/api/customer/purchases/${id}/check`, "POST", { tx_hash: hash });
    expect(checked.body.resolution?.kind).toBe("confirmed");
    expect(checked.body.resolution?.units).toBe(3);
    expect(w.w.chain.ent("dana.near")?.free).toBe("3");
    expect(w.w.chain.ent("cara.near")?.free).toBe("100");
    // Another customer with their own 402 can't have Dana's transaction confirm their purchase.
    w.w.chain.balances.set("stranger.near", 10_000_000n);
    w.w.chain.tokenRegistered.add("stranger.near");
    const theirs = await get402(w, w.stranger, "stranger.near");
    const made2 = await w.stranger(`/api/customer/offers/${w.offerId}/purchases`, "POST", {
      idempotency_key: "agent-sam-buy",
      units: 3,
      install: INSTALL,
      terms_digest: theirs.purchase.terms_digest,
    });
    expect(made2.status, JSON.stringify(made2.body)).toBe(201);
    const id2 = made2.body.purchase.id as string;
    await w.stranger(`/api/customer/purchases/${id2}/requested`, "POST", {});
    const stolen = await w.stranger(`/api/customer/purchases/${id2}/check`, "POST", {
      tx_hash: hash,
    });
    expect(stolen.body.transaction).toEqual({ hash, matched: false });
    expect(stolen.body.resolution?.kind).toBe("unknown");
    expect(stolen.body.purchase.state).not.toBe("confirmed");
    expect(w.w.chain.ent("stranger.near")?.free).toBe("0");
    // Nor check Dana's purchase at all.
    expect((await w.stranger(`/api/customer/purchases/${id}/check`, "POST", {})).status).toBe(404);
    expect((await w.stranger(`/api/customer/purchases/${id}/abandon`, "POST", {})).status).toBe(
      404,
    );
    expect((await w.stranger(`/api/customer/purchases/${id}/requested`, "POST", {})).status).toBe(
      404,
    );
    // The owner's desk shows both 402s, Dana's confirmed, each on its own account.
    const desk = await w.ava(`/api/businesses/${w.biz}/agent-purchases`);
    expect(desk.status).toBe(200);
    const dana = desk.body.offers.filter((o: Json) => o.account === "dana.near");
    expect(dana.some((o: Json) => o.purchase?.units_granted === 3)).toBe(true);
    const sam = desk.body.offers.filter((o: Json) => o.account === "stranger.near");
    expect(sam.every((o: Json) => !o.purchase || o.purchase.units_granted === 0)).toBe(true);
    // The agent is a customer, never the owner.
    expect((await w.dana(`/api/businesses/${w.biz}/agent-purchases`)).status).toBe(404);
    expect((await w.dana(`/api/businesses/${w.biz}`)).status).toBe(404);
    // The 402 itself grants nothing: the next prepare still needs units until the contract has them.
  });

  it("a 402 names only the asker's account and the business's exact plan", async () => {
    const w = await reviewWorld();
    const offer = await get402(w, w.dana, "dana.near");
    const text = JSON.stringify(offer);
    expect(text).not.toContain("cara.near");
    expect(offer.offer.contract).toBe(w.BUSINESS);
    expect(offer.purchase.call.args.receiver_id).toBe(w.BUSINESS);
    expect(JSON.parse(offer.purchase.call.args.msg).buy.units).toBe(3);
  });
});
