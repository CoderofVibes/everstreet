// Companions through the app's routes over the synthetic sale (server/test/companion-chain.ts
// follows contracts/asset-key and contracts/spend-allowance): what they hold before and after a
// close, the former owner refused, the buyer's move of the external role relayed and pending
// until final on the other chain, and the allowance granted again by the buyer.

import { describe, expect, it } from "vitest";
import { attachCompanions, testAddress } from "./companion-chain.ts";
import type { Json } from "./customer-world.ts";
import { BUYER, proposal, SELLER, saleWorld } from "./sale-world.ts";

const ASSET = "feed.synthetic.near";
const BUDGET = "budget.synthetic.near";

async function world() {
  const s = await saleWorld();
  const control = () => {
    const c = s.sale.controlView() as Json;
    return {
      owner: String(c.owner),
      generation: Number(c.generation),
      control_seq: String(c.control_seq),
    };
  };
  const c = attachCompanions(s.w.chain, s.BUSINESS, control, {
    asset: ASSET,
    allowance: BUDGET,
    token: s.TOKEN,
  });
  c.allowance.fund(60_000_000n);
  c.allowance.walletCall(SELLER, {
    methodName: "grant",
    args: {
      agent: "agent.synthetic.near",
      suppliers: ["larchmere.synthetic.near"],
      per_payment: "2000000",
      per_period: "60000000",
      period_ms: "604800000",
      review_above: "5000000",
    },
    gas: "1",
    deposit: "0",
  });
  s.w.state.app = s.w.make(s.w.state.store, undefined, {
    customer: s.w.options(),
    companions: {
      bindings: [{ business_id: s.biz, asset: { account: ASSET }, allowance: { account: BUDGET } }],
      evm: c.evm,
    },
  });
  return { s, c };
}

/** One owner request through the routes: prepare, the wallet sends exactly it, then sent. */
async function request(
  s: Awaited<ReturnType<typeof saleWorld>>,
  who: typeof s.noah,
  account: string,
  kind: string,
  input: Json = {},
) {
  const p = await who(`/api/companions/${s.biz}/prepare`, "POST", { kind, input });
  if (p.status !== 200) return { p, sent: null };
  const out = s.wallet(account, p.body.call);
  const sent = await who(`/api/companions/actions/${p.body.id}/sent`, "POST", {
    tx_hash: out.transaction.hash,
  });
  return { p, sent };
}

describe("companions through the app", () => {
  it("before the close: the role is at generation 1's address and the allowance is active", async () => {
    const { s } = await world();
    await s.act(s.ava, SELLER, "propose", proposal());
    const v = await s.ava(`/api/companions/${s.biz}`);
    expect(v.status).toBe(200);
    expect(v.body.asset).toMatchObject({ controller_generation: 1, chain: "synthetic EVM chain" });
    expect(v.body.asset.addresses[0].address).toBe(testAddress(ASSET, "gen-1"));
    expect(v.body.allowance).toMatchObject({ active: true, balance: "60000000" });
    expect((await s.stranger(`/api/companions/${s.biz}`)).status).toBe(404);
  });

  it("after the close: the buyer moves the role (pending until final) and grants the allowance again", async () => {
    const { s, c } = await world();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    await s.act(s.noah, BUYER, "accept");
    await s.act(s.ava, SELLER, "accept");
    const v = await s.noah(`/api/companions/${s.biz}`);
    expect(v.body.control).toMatchObject({ owner: BUYER, generation: 2 });
    expect(v.body.asset.controller_generation).toBe(1);
    expect(v.body.allowance.active).toBe(false);

    // The former seller can't prepare anything.
    expect(
      (await s.ava(`/api/companions/${s.biz}/prepare`, "POST", { kind: "feed_move" })).body.code,
    ).toBe("not_owner");
    // And if their wallet sent the companion a request anyway, the companion refuses it.
    const direct = c.asset.walletCall(SELLER, {
      methodName: "request",
      args: {
        action: { kind: "set_controller", to: testAddress(ASSET, "gen-1"), from_generation: 1 },
        tx: {
          nonce: "0",
          gas_limit: "80000",
          max_fee_per_gas: "3000000000",
          max_priority_fee_per_gas: "1000000000",
        },
      },
      gas: "1",
      deposit: "1",
    });
    expect(
      Buffer.from(String((direct.status as Json).SuccessValue), "base64").toString(),
    ).toContain("E_NOT_OWNER");

    // The buyer moves the role: exactly the reviewed move, relayed, pending until final.
    const move = await request(s, s.noah, BUYER, "feed_move");
    expect(move.p.body.review).toMatchObject({
      from_generation: 1,
      to_generation: 2,
      to_address: testAddress(ASSET, "gen-2"),
    });
    expect(move.p.body.call).toMatchObject({
      receiverId: ASSET,
      methodName: "request",
      deposit: "1",
    });
    expect(move.sent?.body).toMatchObject({ state: "external_pending" });
    expect(c.registry.controller).toBe(testAddress(ASSET, "gen-2").toLowerCase());
    let after = await s.noah(`/api/companions/${s.biz}`);
    expect(after.body.asset.move.state).toBe("external_pending");
    c.registry.mine(3);
    after = await s.noah(`/api/companions/${s.biz}`);
    expect(after.body.asset).toMatchObject({
      controller_generation: 2,
      move: { state: "external_final" },
    });
    // Asking again: already moved.
    expect(
      (await s.noah(`/api/companions/${s.biz}/prepare`, "POST", { kind: "feed_move" })).body.code,
    ).toBe("already_moved");

    // The allowance: granted again by the buyer, on the same terms.
    const grant = await request(s, s.noah, BUYER, "allowance_grant");
    expect(grant.p.body.call).toMatchObject({ receiverId: BUDGET, methodName: "grant" });
    expect(grant.sent?.body.state).toBe("confirmed");
    const v2 = await s.noah(`/api/companions/${s.biz}`);
    expect(v2.body.allowance).toMatchObject({
      active: true,
      grant: { generation: 2, granted_by: BUYER },
    });
  });

  it("an invoice above the review threshold waits for the owner, who approves it", async () => {
    const { s, c } = await world();
    const r = c.allowance.pay(
      "agent.synthetic.near",
      "larchmere.synthetic.near",
      6_300_000n,
      "ab".repeat(32),
    );
    expect(r.value).toBe("awaiting_approval");
    const v = await s.ava(`/api/companions/${s.biz}`);
    expect(v.body.allowance.awaiting).toHaveLength(1);
    const a = await request(s, s.ava, SELLER, "allowance_approve", { invoice: "ab".repeat(32) });
    expect(a.sent?.body.state).toBe("confirmed");
    expect(c.allowance.payments.get("ab".repeat(32))?.state).toBe("Paid");
  });
});
