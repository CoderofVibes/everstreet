// Job 003web (Astra's PurchaseBrowserRepeat): the review harness's read-only synthetic wallet
// history, on the CONTROL listener only. It projects the transactions the in-memory chain double
// actually recorded; nothing is computed or added. Driven without a listener; fictional data.

import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  harnessControl,
  walletHarness,
  walletHistory,
} from "../../scripts/lib/walletHarness.ts";
import { buyCall } from "../../server/src/customerPurchase.ts";
import { BUSINESS, FRESH, type Json, TOKEN } from "./customer-world.ts";

const ORIGIN = "http://127.0.0.1:8814";

async function fresh() {
  const h = await walletHarness({ origin: ORIGIN, customer: "fresh" });
  const control = harnessControl(h);
  const ctl = async (path: string, method = "GET") =>
    (await (await control.request(`http://127.0.0.1:8815${path}`, { method })).json()) as Json;
  /** What the page's synthetic wallet module posts for one call. */
  const send = (c: {
    receiverId: string;
    methodName: string;
    args: Json;
    gas: string;
    deposit: string;
  }) =>
    h.site.request(`${ORIGIN}/__harness/tx`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        receiverId: c.receiverId,
        actions: [
          {
            methodName: c.methodName,
            args: JSON.stringify(c.args),
            gas: c.gas,
            deposit: c.deposit,
          },
        ],
      }),
    });
  return { h, ctl, send };
}

describe("003web the harness's synthetic wallet history (control listener, read-only)", () => {
  it("lists the original ID a lost answer withheld, exactly as the chain recorded it, and nothing private", async () => {
    const { h, ctl, send } = await fresh();
    try {
      expect((await ctl("/history")).transactions).toEqual([]);
      const shell = await send({
        receiverId: BUSINESS,
        methodName: "sponsor_shell",
        args: { customer: FRESH, plan_id: 1 },
        gas: "30000000000000",
        deposit: "8200000000000000000000",
      });
      expect(shell.status).toBe(200);
      const regId = String(h.world.chain.ent(FRESH)?.reg_id);
      const buy = buyCall(TOKEN, BUSINESS, "500000", {
        plan_id: 1,
        units: 10,
        purchase_seq: 1,
        install: null,
        reg_id: regId,
      });
      await ctl("/lose-next", "POST");
      const lost = await send(buy);
      // The app got no ID: the answer was lost (the purchase landed).
      expect(lost.status).toBe(502);
      expect(JSON.stringify(await lost.json())).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{43}/);
      expect(h.world.chain.ent(FRESH)).toMatchObject({ free: "10", purchase_seq: 1 });
      const { note, transactions } = await ctl("/history");
      expect(note).toMatch(/Not whether a purchase was accepted/);
      const recorded = [...h.world.chain.txs.values()] as Json[];
      // Newest first; each entry is the recorded transaction's own fields, no more.
      expect(transactions).toEqual(
        recorded.reverse().map((o) => ({
          id: o.transaction.hash,
          signer: o.transaction.signer_id,
          receiver: o.transaction.receiver_id,
          method: o.transaction.actions[0].FunctionCall.method_name,
          status: "success",
        })),
      );
      expect(transactions.map((t: Json) => t.method)).toEqual([
        "ft_transfer_call",
        "sponsor_shell",
      ]);
      for (const t of transactions)
        expect(Object.keys(t).sort()).toEqual(["id", "method", "receiver", "signer", "status"]);
      const text = JSON.stringify(transactions);
      expect(text).not.toContain(h.accountKey); // no key
      expect(text).not.toContain("purchase_seq"); // no arguments
      expect(text).not.toContain("SuccessValue"); // no raw outcome
      // The app's own site has no such route.
      const onSite = await h.site.request(`${ORIGIN}/history`);
      expect(onSite.headers.get("content-type") ?? "").not.toMatch(/json/);
      expect((await h.site.request(`${ORIGIN}/api/history`)).status).toBe(404);
    } finally {
      h.world.rw.store.db.close();
    }
  });

  it("a refused transaction is listed as failed, other accounts can be filtered out, and the list is bounded", async () => {
    const { h, ctl, send } = await fresh();
    try {
      // A call the token itself refuses (an unregistered signer) fails the whole transaction.
      await ctl("/account/mallory.near", "POST");
      await send({
        receiverId: TOKEN,
        methodName: "ft_transfer_call",
        args: { receiver_id: BUSINESS, amount: "1", msg: "{}" },
        gas: "100000000000000",
        deposit: "1",
      });
      await ctl(`/account/${FRESH}`, "POST");
      await send({
        receiverId: BUSINESS,
        methodName: "sponsor_shell",
        args: { customer: FRESH, plan_id: 1 },
        gas: "30000000000000",
        deposit: "8200000000000000000000",
      });
      const all = (await ctl("/history")).transactions as Json[];
      expect(all.map((t) => [t.signer, t.status])).toEqual([
        [FRESH, "success"],
        ["mallory.near", "failure"],
      ]);
      expect(
        ((await ctl(`/history?account=${FRESH}`)).transactions as Json[]).map((t) => t.signer),
      ).toEqual([FRESH]);
      const many = new Map<string, Json>();
      for (let i = 0; i < HISTORY_LIMIT + 5; i++)
        many.set(String(i), { transaction: { hash: String(i) }, status: { SuccessValue: "" } });
      const listed = walletHistory(many);
      expect(listed).toHaveLength(HISTORY_LIMIT);
      expect(listed[0]?.id).toBe(String(HISTORY_LIMIT + 4)); // newest first
    } finally {
      h.world.rw.store.db.close();
    }
  });
});
