// Promises 3 and 4: a signed-in stranger (Sam, with a linked account and no part in this sale)
// learns nothing from a real business id: every answer equals the one for a missing id. Ids from
// another person's records (a funding, a companion request) are no use to them either.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

const MISSING = "no-such-business";

describe("pr13 a stranger with real ids and with missing ids", () => {
  it("every current reading answers the same for both", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const q = (await r.i.quote()).body;
    const s = r.stranger;
    const pairs: [string, (id: string) => Promise<{ status: number; body: unknown }>][] = [
      ["sale page", (id) => s(`/api/sales/${id}`)],
      ["economics", (id) => s(`/api/sales/${id}/economics`)],
      ["companions", (id) => s(`/api/companions/${id}`)],
      ["companion list", (id) => s(`/api/businesses/${id}/companions`)],
      ["intents panel", (id) => s(`/api/sales/${id}/intents`)],
      ["quote", (id) => s(`/api/sales/${id}/intents/quote`, "POST", { token: r.ALT_TOKEN })],
      [
        "prepare companion",
        (id) => s(`/api/companions/${id}/prepare`, "POST", { kind: "feed_move" }),
      ],
      ["prepare fund", (id) => s(`/api/sales/${id}/prepare`, "POST", { kind: "fund", input: {} })],
      ["proof", (id) => s(`/api/sales/${id}/proof`)],
      ["members", (id) => s(`/api/businesses/${id}/members`)],
      ["agent switches", (id) => s(`/api/businesses/${id}/agent-access`)],
    ];
    for (const [name, call] of pairs) {
      const real = await call(r.biz);
      const missing = await call(MISSING);
      expect(real.status, name).toBe(404);
      expect(real.body, name).toEqual(missing.body);
    }
    // Another person's funding and companion request, by id.
    expect((await s(`/api/intents/${q.id}`)).status).toBe(404);
    expect((await s(`/api/intents/${q.id}/sign`, "POST", r.i.signature(q))).status).toBe(404);
    expect((await s(`/api/intents/${MISSING}`)).body).toEqual(
      (await s(`/api/intents/${q.id}`)).body,
    );
    // The buyer can't sign in another person's name either: the row is theirs or nothing.
    expect((await r.noah(`/api/intents/${MISSING}`)).status).toBe(404);
  });

  it("another person's companion request can't be marked sent, and the owner's own is checked by its transaction", async () => {
    const r = await reviewWorld();
    const c = r.companions as NonNullable<typeof r.companions>;
    // An invoice above the review threshold waits for the owner.
    const invoice = "ab".repeat(32);
    c.allowance.pay("agent.synthetic.near", "supplier.synthetic.near", 6_000_000n, invoice);
    const p = await r.c.prepare(r.ava, "allowance_approve", { invoice });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    // Noah (the buyer) and Sam send a hash for Ava's request.
    for (const who of [r.noah, r.stranger]) {
      const res = await r.c.sent(who, p.body.id, "4".repeat(44));
      expect(res.status).toBe(404);
    }
    // Ava sends a hash of a transaction that isn't this request (someone else's grant).
    const other = c.allowance.walletCall(r.BUYER, {
      methodName: "approve",
      args: { invoice },
      gas: "1",
      deposit: "0",
    });
    (r.w.chain as unknown as { txs: Map<string, unknown> }).txs.set(other.transaction.hash, other);
    const wrong = await r.c.sent(r.ava, p.body.id, other.transaction.hash);
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe("not_this_request");
  });
});
