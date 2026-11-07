// The handoff proof (Continuity Receipt): the close snapshot recorded when the close confirms,
// the customer's next settled use, each fact's source, agreement across two providers (and the
// Uncertain state with the last coherent observation), who sees which customer, and the receipt's
// digest. Driven through the real routes over the synthetic sale world.

import { describe, expect, it } from "vitest";
import { receiptDigestOk } from "../src/handoffProof.ts";
import { CUSTOMER, FixtureReader, type Json } from "./customer-world.ts";
import { BUYER, proposal, SELLER, saleWorld } from "./sale-world.ts";

async function closedSale() {
  const s = await saleWorld();
  // A second provider over the same chain; it can be made to misreport the owner.
  const second = new FixtureReader(s.w.chain);
  second.ceiling = 10_000;
  s.w.state.app = s.w.make(s.w.state.store, undefined, {
    customer: {
      ...s.w.options(),
      proof: {
        source: "synthetic",
        primaryName: "Provider A",
        second: { name: "Provider B", reader: second },
      },
    },
  });
  await s.act(s.ava, SELLER, "propose", proposal());
  await s.act(s.noah, BUYER, "register");
  await s.act(s.noah, BUYER, "fund");
  expect((await s.customerUse()).unit).toBe("charged");
  await s.act(s.noah, BUYER, "accept");
  const close = await s.act(s.ava, SELLER, "accept");
  expect(close.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closed" });
  return { s, second };
}

describe("handoff proof", () => {
  it("records the close snapshot, leads with the next settled use and tags every fact", async () => {
    const { s } = await closedSale();
    const atClose = structuredClone(s.w.chain.ent(CUSTOMER)) as Json;
    const snap = s.w.state.store.db
      .prepare("SELECT deal_seq, snapshot FROM handoff_snapshots WHERE business_id = ?")
      .all(s.biz) as { deal_seq: string; snapshot: string }[];
    expect(snap.map((r) => r.deal_seq)).toEqual(["1"]);
    const recorded = JSON.parse(snap[0]?.snapshot as string);
    expect(recorded.customers).toEqual([
      expect.objectContaining({ account: CUSTOMER, free: atClose.free }),
    ]);
    expect(recorded.account).toEqual({ code_hash: "synthetic", keys: 0 });

    // Before any use after the close: units at close, no next use yet.
    const p0 = await s.noah(`/api/sales/${s.biz}/proof`);
    expect(p0.status).toBe(200);
    expect(p0.body.continuity).toMatchObject({ after: null, charged: 0 });
    expect(p0.body.facts.find((f: Json) => f.key === "next_settled_use").value).toBeNull();

    // The customer's next use under the buyer settles: at close → after, one charged.
    expect((await s.customerUse()).unit).toBe("charged");
    const p = await s.noah(`/api/sales/${s.biz}/proof`);
    expect(p.body.continuity).toMatchObject({
      customer: { account: CUSTOMER, name: "Cara Okafor" },
      at_close: atClose.free,
      after: String(BigInt(atClose.free) - 1n),
      charged: 1,
    });
    expect(p.body.deal).toMatchObject({ seq: "1", seller: SELLER, buyer: BUYER });
    const facts = Object.fromEntries(p.body.facts.map((f: Json) => [f.key, f]));
    expect(facts.owner).toMatchObject({ value: BUYER, source: "synthetic" });
    expect(facts.generation).toMatchObject({ value: 2, source: "synthetic" });
    expect(facts.access_keys).toMatchObject({ value: 0, source: "synthetic" });
    expect(facts.contract.source).toBe("everstreet");
    expect(facts.close_tx.value).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(facts.close_tx.source).toBe("synthetic"); // the synthetic chain shows its outcome
    expect(p.body.rights.ended[0]).toMatchObject({ what: "owner_role", account: SELLER });
    expect(p.body.rights.operates).toMatchObject({ account: BUYER, generation: 2, moved: true });
    expect(p.body.rights.seller_claim.owed).toBe(proposal().price);
    expect(p.body.agreement).toMatchObject({ status: "agree" });
    expect(p.body.agreement.providers.map((x: Json) => x.name)).toEqual([
      "Provider A",
      "Provider B",
    ]);
  });

  it("the former seller sees the close but not which customer used it; strangers see nothing", async () => {
    const { s } = await closedSale();
    expect((await s.customerUse()).unit).toBe("charged");
    const a = await s.ava(`/api/sales/${s.biz}/proof`);
    expect(a.status).toBe(200);
    expect(a.body.viewer.operates).toBe(false);
    expect(a.body.continuity.customer).toEqual({ account: null, name: null });
    expect(JSON.stringify(a.body)).not.toContain(CUSTOMER);
    expect((await s.stranger(`/api/sales/${s.biz}/proof`)).status).toBe(404);
  });

  it("providers that disagree are Uncertain, with the last coherent observation kept", async () => {
    const { s, second } = await closedSale();
    const ok = await s.noah(`/api/sales/${s.biz}/proof`);
    expect(ok.body.agreement.status).toBe("agree");
    second.disagreeOwner = "someone-else.testnet";
    const bad = await s.noah(`/api/sales/${s.biz}/proof`);
    expect(bad.body.agreement.status).toBe("uncertain");
    expect(bad.body.agreement.providers[1].owner).toBe("someone-else.testnet");
    expect(bad.body.agreement.last_coherent).toMatchObject({ owner: BUYER, generation: 2 });
    // The receipt stays available with the disputed observation attached.
    const r = await s.noah(`/api/sales/${s.biz}/receipt`);
    expect(r.status).toBe(200);
    expect(r.body.agreement.status).toBe("uncertain");
    second.disagreeOwner = null;
    expect((await s.noah(`/api/sales/${s.biz}/proof`)).body.agreement.status).toBe("agree");
  });

  it("the receipt is digest-sealed and carries no customer identity", async () => {
    const { s } = await closedSale();
    expect((await s.customerUse()).unit).toBe("charged");
    const r = await s.noah(`/api/sales/${s.biz}/receipt`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      format: "everstreet.handoff-receipt",
      version: 1,
      source: "synthetic",
      close_signer: SELLER,
      deal: { seq: "1", buyer: BUYER, generation_after: 2 },
      at_close: { customers: 1 },
    });
    expect(r.body.first_settled_use.units_after).toBe(
      String(BigInt(r.body.first_settled_use.units_before) - 1n),
    );
    expect(JSON.stringify(r.body)).not.toContain(CUSTOMER);
    expect(receiptDigestOk(r.body)).toBe(true);
    expect(receiptDigestOk({ ...r.body, control: { owner: "x.testnet", generation: 9 } })).toBe(
      false,
    );
  });

  it("no close yet: the proof says so", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    const p = await s.ava(`/api/sales/${s.biz}/proof`);
    expect(p.status).toBe(404);
    expect(p.body.code).toBe("no_close");
  });
});
