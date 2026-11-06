// Job 003wf2 (docs/design/DIRECT_SALE.md): a Direct sale through each participant's own wallet,
// driven through the real app routes over one synthetic state (sale-world.ts). Every wallet
// transaction is the exact stored call, applied to the double by the contract's rules; ownership
// changes here only through the existing reconciliation. Synthetic evidence, not a contract run.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveSaleTx, type SaleActionRow } from "../src/saleActions.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import { BUYER, PRICE, proposal, SELLER, saleWorld } from "./sale-world.ts";

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

describe("003wf2 Direct sale: proposal to close and customer continuity", () => {
  it("proposes, funds, accepts and closes; reconciles once; customers keep everything; proceeds are a claim until paid", async () => {
    const s = await saleWorld();
    // The seller's picture: supported contract, exact customer obligations; strangers see nothing.
    const a0 = await s.setup(s.ava);
    expect(a0.status).toBe(200);
    expect(a0.body.roles).toMatchObject({ seller: true, buyer: false });
    expect(a0.body.capability).toEqual({ supported: true, reason: null });
    expect(a0.body.customer_obligations).toMatchObject({
      prepaid_unused: "5000000",
      reserved_in_use: "0",
    });
    expect((await s.setup(s.noah)).status).toBe(404);
    expect((await s.setup(s.stranger)).status).toBe(404);

    // The exact proposal: guarded call, measured party deposit, immutable terms document.
    const prop = await s.act(s.ava, SELLER, "propose", proposal({ floor: "100000" }));
    expect(prop.p.status).toBe(200);
    const call = prop.p.body.call as Json;
    expect(call).toMatchObject({
      receiverId: s.BUSINESS,
      methodName: "propose_sale_guarded",
      gas: "50000000000000",
    });
    expect(call.deposit).toBe(String((176n + BigInt(BUYER.length)) * 10_000_000_000_000_000_000n));
    expect(call.args.expected_control_seq).toBe("2");
    expect(prop.p.body.review.metering_granted).toBe(true);
    expect(sha(prop.p.body.terms_doc.text)).toBe(prop.p.body.terms_doc.hash);
    expect(call.args.terms.terms_hash).toBe(prop.p.body.terms_doc.hash);
    expect(prop.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "proposed" });
    expect(prop.check?.body.effects).toMatchObject({ recorded: { deal_seq: "1", version: 1 } });
    const live = s.control().live_deal as Json;
    expect([live.seq, live.version, live.digest]).toEqual(["1", 1, call.args.digest]);
    const intents = s.w.state.store.db
      .prepare("SELECT deal_seq, version, status FROM v3_intents WHERE business_id = ?")
      .all(s.biz);
    expect(intents).toEqual([{ deal_seq: "1", version: 1, status: "recorded" }]);

    // The buyer now sees exactly the terms (hash checked), nothing private about customers.
    const b0 = await s.setup(s.noah);
    expect(b0.status).toBe(200);
    expect(b0.body.roles).toMatchObject({ buyer: true, seller: false });
    expect(sha(b0.body.terms_doc.text)).toBe(live.terms_hash);
    expect(b0.body.terms_doc.text).toContain("ledgerline.example domain");
    expect(JSON.stringify(b0.body)).not.toContain(CUSTOMER);

    // Funding needs the buyer's own token registration first (an exact, separate request).
    expect((await s.prepare(s.noah, "fund")).body.code).toBe("register_first");
    const reg = await s.act(s.noah, BUYER, "register");
    expect(reg.p.body.call).toMatchObject({
      methodName: "storage_deposit",
      args: { account_id: BUYER, registration_only: true },
    });
    expect(reg.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "registered" });
    const fund = await s.act(s.noah, BUYER, "fund");
    expect(fund.p.body.call).toMatchObject({
      receiverId: s.TOKEN,
      methodName: "ft_transfer_call",
      deposit: "1",
    });
    expect(JSON.parse(fund.p.body.call.args.msg)).toEqual({
      fund_deal: { deal_seq: "1", version: 1, price: PRICE, expected_control_seq: "3" },
    });
    expect(fund.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "funded" });
    expect((s.control().live_deal as Json).escrow).toBe(PRICE);
    expect(s.w.chain.balances.get(BUYER)).toBe(1_000_000_000n - BigInt(PRICE));

    // Either acceptance waits for the agreed floor; customers' settled uses raise `available` in
    // the same state (one economic model), and then the buyer accepts first.
    expect((await s.prepare(s.noah, "accept")).body.code).toBe("floor");
    expect((await s.prepare(s.ava, "accept")).body.code).toBe("floor");
    const before = structuredClone(s.w.chain.ent(CUSTOMER));
    expect((await s.customerUse()).unit).toBe("charged");
    expect(s.sale.treasuryView().available).toBe("50000");
    expect((await s.prepare(s.noah, "accept")).body.code).toBe("floor");
    expect((await s.customerUse()).unit).toBe("charged");
    expect(s.sale.treasuryView()).toMatchObject({ available: "100000", ent_held_value: "0" });
    const mid = structuredClone(s.w.chain.ent(CUSTOMER)) as Json;
    expect([mid.free, mid.consumed]).toEqual([String(BigInt(before?.free) - 2n), "2"]);
    const ba = await s.act(s.noah, BUYER, "accept");
    expect(ba.p.body.review.other_accepted).toBe(false);
    expect(ba.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "accepted" });

    // The seller's acceptance closes the sale; the existing reconciliation applies it once.
    const sa = await s.act(s.ava, SELLER, "accept");
    expect(sa.p.body.review.other_accepted).toBe(true);
    expect(sa.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closed" });
    expect(sa.check?.body.effects).toMatchObject({ reconcile: { state: "applied" } });
    expect(s.control()).toMatchObject({ owner: BUYER, generation: 2, live_deal: null });
    const owner = s.w.state.store.db
      .prepare("SELECT owner_id FROM businesses WHERE id = ?")
      .get(s.biz) as Json;
    expect(owner.owner_id).toBe(s.noah.id);
    const transfers = s.w.state.store.db
      .prepare(
        "SELECT from_id, to_id, generation FROM ownership WHERE business_id = ? AND v3_intent_id IS NOT NULL",
      )
      .all(s.biz);
    expect(transfers).toEqual([{ from_id: s.w.f.ava.id, to_id: s.noah.id, generation: 2 }]);

    // Customers: the same entitlement, and the next use is served under the buyer's grants.
    expect(s.w.chain.ent(CUSTOMER)).toEqual(mid);
    expect((await s.customerUse()).unit).toBe("charged");

    // The former seller: management ended here; the price is an owed claim, not yet paid.
    const a1 = await s.setup(s.ava);
    expect(a1.body.local_owner).toBe(false);
    expect(a1.body.roles).toMatchObject({ seller: false, former_seller: true, claimant: true });
    expect(a1.body.party.sale_proceeds_claim).toBe(PRICE);
    expect((await s.prepare(s.ava, "propose", proposal())).body.code).toBe("not_seller");
    // Collecting needs the seller's own token registration (a token record, not a party record).
    expect((await s.prepare(s.ava, "claim", { category: 2 })).body.code).toBe("register_first");
    expect((await s.act(s.ava, SELLER, "register")).check?.body.resolution.kind).toBe("confirmed");
    const claim = await s.act(s.ava, SELLER, "claim", { category: 2 });
    expect(claim.p.body.call).toMatchObject({
      methodName: "claim_party_guarded",
      args: { category: 2, expected_amount: PRICE, expected_payout_seq: "0" },
    });
    expect(claim.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "paid" });
    expect(s.w.chain.balances.get(SELLER)).toBe(BigInt(PRICE));
    expect((await s.setup(s.ava)).body.party.sale_proceeds_claim).toBe("0");
    // The judge rehearsal: the former seller's own wallet tries an owner action (appointing
    // itself), and the contract refuses it; the refusal is recorded with its own transaction.
    const control = s.w.chain.sale?.controlSeq;
    const probe = await s.act(s.ava, SELLER, "owner_probe");
    expect(probe.p.body.call).toMatchObject({
      methodName: "appoint_operator_guarded",
      args: { account: SELLER, caps: 1 },
    });
    expect(probe.check?.body.resolution).toMatchObject({ kind: "refused", reason: "E_NOT_OWNER" });
    expect(s.w.chain.sale?.controlSeq).toBe(control);
    const after = await s.setup(s.ava);
    expect(after.body.actions[0]).toMatchObject({ kind: "owner_probe", state: "refused" });
    expect(after.body.actions[0].tx_hash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    // Only a former seller is offered it.
    expect((await s.prepare(s.noah, "owner_probe")).body.code).toBe("not_former_seller");
    // The new owner's picture: it owns the business here and on the contract.
    const b1 = await s.setup(s.noah);
    expect(b1.body.roles).toMatchObject({ new_owner: true, chain_owner: true, seller: true });
    expect(b1.body.metering_appointed).toBe(true);
  });

  it("terms naming no metering: honest interruption after the close, then the new owner appoints it", async () => {
    const s = await saleWorld();
    const prop = await s.act(s.ava, SELLER, "propose", proposal({ metering: false }));
    expect(prop.p.body.review.metering_granted).toBe(false);
    expect(prop.p.body.review.effects.join(" ")).toContain(
      "new uses pause until the new owner appoints metering",
    );
    expect(prop.p.body.terms_doc.text).toContain('"metering_granted":false');
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    await s.act(s.ava, SELLER, "accept");
    expect((await s.act(s.noah, BUYER, "accept")).check?.body.effects).toMatchObject({
      reconcile: { state: "applied" },
    });
    const next = await s.customerUse();
    expect([next.status, next.code]).toEqual([409, "operator_not_authorized"]);
    expect((await s.setup(s.noah)).body.metering_appointed).toBe(false);
    expect((await s.prepare(s.ava, "appoint")).body.code).toBe("not_owner");
    const ap = await s.act(s.noah, BUYER, "appoint");
    expect(ap.p.body.call).toMatchObject({
      methodName: "appoint_operator_guarded",
      args: { account: s.OPERATOR, caps: 1 },
    });
    expect(ap.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "appointed" });
    expect((await s.customerUse()).unit).toBe("charged");
    expect((await s.prepare(s.noah, "appoint")).body.code).toBe("already_appointed");
  });
});

describe("003wf2 revision, cancel, expiry, unfund and claims", () => {
  it("a funded revision at the same price keeps escrow; another price returns it as a claim; stale requests are refused on chain", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    // The seller stores a reviewed revision; the buyer accepts before it lands: the contract
    // refuses the revision whole (its control sequence moved) and nothing changes.
    const rev = await s.act(
      s.ava,
      SELLER,
      "revise",
      { ...proposal(), note: "Revised note." },
      { send: false },
    );
    const buyerAccept = await s.act(s.noah, BUYER, "accept");
    expect(buyerAccept.check?.body.resolution.result).toBe("accepted");
    const landed = s.wallet(SELLER, rev.action?.call);
    await s.ava(`/api/sales/actions/${rev.action?.id}/requested`, "POST", {
      tx_hash: landed.transaction.hash,
    });
    const refused = await s.ava(`/api/sales/actions/${rev.action?.id}/check`, "POST", {});
    expect(refused.body.resolution).toMatchObject({ kind: "refused", reason: "E_REVIEWED" });
    expect((s.control().live_deal as Json).version).toBe(1);
    // Reviewed again: same price, escrow stays, version 2, acceptances cleared.
    const same = await s.act(s.ava, SELLER, "revise", { ...proposal(), note: "Revised note." });
    expect(same.p.body.review).toMatchObject({ next_version: 2, escrow_returned: "0" });
    expect(same.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "revised" });
    expect(same.check?.body.effects).toMatchObject({ recorded: { deal_seq: "1", version: 2 } });
    expect(s.control().live_deal).toMatchObject({
      version: 2,
      escrow: PRICE,
      buyer_accepted: false,
    });
    // Another price: the escrow becomes the buyer's returned-escrow claim at once.
    const other = await s.act(s.ava, SELLER, "revise", proposal({ price: "260000000" }));
    expect(other.p.body.review.escrow_returned).toBe(PRICE);
    expect(other.check?.body.resolution.result).toBe("revised");
    expect(s.control().live_deal).toMatchObject({ version: 3, escrow: "0", price: "260000000" });
    const b = await s.setup(s.noah);
    expect(b.body.party.escrow_return_claim).toBe(PRICE);
    const claim = await s.act(s.noah, BUYER, "claim", { category: 1 });
    expect(claim.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "paid" });
    expect(s.w.chain.balances.get(BUYER)).toBe(1_000_000_000n);
  });

  it("unfund, fund again, cancel by the buyer, and an offer ended after expiry; returned escrow is collected", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    const un = await s.act(s.noah, BUYER, "unfund");
    expect(un.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "unfunded" });
    expect((await s.prepare(s.noah, "unfund")).body.code).toBe("nothing_funded");
    await s.act(s.noah, BUYER, "fund");
    const cancel = await s.act(s.noah, BUYER, "cancel");
    expect(cancel.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "cancelled" });
    expect(s.sale.outcomesView()[0]).toMatchObject({ status: "cancelled", escrow_returned: PRICE });
    // Nothing for a live deal is offered once none is live.
    expect((await s.prepare(s.noah, "fund")).body.code).toBe("no_live_deal");
    expect((await s.prepare(s.noah, "accept")).body.code).toBe("no_live_deal");
    const party = (await s.setup(s.noah)).body.party as Json;
    expect(party.escrow_return_claim).toBe(String(2n * BigInt(PRICE)));
    // A second deal that expires; the seller ends it once it has.
    await s.act(s.ava, SELLER, "propose", proposal({ days: 1 }));
    expect((await s.prepare(s.ava, "expire")).body.code).toBe("not_expired");
    s.w.chain.tick(86_400_000n);
    expect((await s.prepare(s.noah, "accept")).body.code).toBe("expired");
    const ex = await s.act(s.ava, SELLER, "expire");
    expect(ex.p.body.call).toMatchObject({ methodName: "expire_sale_guarded", deposit: "0" });
    expect(ex.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "expired" });
    const claim = await s.act(s.noah, BUYER, "claim", { category: 1 });
    expect(claim.check?.body.resolution.result).toBe("paid");
    expect(s.w.chain.balances.get(BUYER)).toBe(1_000_000_000n);
  });

  it("a failed payout is restored as the same claim, never called paid; the old request can't collect again", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    await s.act(s.noah, BUYER, "cancel");
    s.sale.failPayouts = 1;
    const first = await s.act(s.noah, BUYER, "claim", { category: 1 });
    expect(first.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "restored" });
    expect((await s.setup(s.noah)).body.party.escrow_return_claim).toBe(PRICE);
    // The same request again (a delayed duplicate): its payout already started, so it is refused.
    const again = s.wallet(BUYER, first.action?.call);
    expect(JSON.stringify(again.status)).toContain("E_REVIEWED");
    const second = await s.act(s.noah, BUYER, "claim", { category: 1 });
    expect(second.check?.body.resolution.result).toBe("paid");
  });
});

describe("003wf2 local follow-up after a confirmed close", () => {
  it("a failed read during reconciliation isn't cached as finished: the next check applies it; a later failed read can't undo it", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    await s.act(s.noah, BUYER, "accept");
    const close = await s.act(s.ava, SELLER, "accept", {}, { lose: true });
    const id = close.action?.id as string;
    const hash = close.outcome?.transaction.hash as string;
    // The observation transport is down (the transaction lookup still works).
    const transport = s.w.v3.transport;
    s.w.v3.transport = null;
    const c1 = await s.ava(`/api/sales/actions/${id}/check`, "POST", { tx_hash: hash });
    expect(c1.body.resolution).toMatchObject({ kind: "confirmed", result: "closed" });
    expect(c1.body.effects).toMatchObject({ reconcile: { state: "unavailable" }, finished: false });
    const owner = () =>
      (
        s.w.state.store.db
          .prepare("SELECT owner_id FROM businesses WHERE id = ?")
          .get(s.biz) as Json
      ).owner_id;
    expect(owner()).toBe(s.w.f.ava.id);
    // Restored: checking the same confirmed action again runs the reconciliation again.
    s.w.v3.transport = transport;
    const c2 = await s.ava(`/api/sales/actions/${id}/check`, "POST", {});
    expect(c2.body.effects).toMatchObject({ reconcile: { state: "applied" } });
    expect(owner()).toBe(s.noah.id);
    // A later failed read can't overwrite the applied result: it is stored and returned as is.
    s.w.v3.transport = null;
    const c3 = await s.noah(`/api/sales/actions/${id}/check`, "POST", {}).catch(() => null);
    expect(c3?.status).toBe(404); // not the buyer's action
    const c4 = await s.ava(`/api/sales/actions/${id}/check`, "POST", {});
    expect(c4.body.effects).toMatchObject({ reconcile: { state: "applied" } });
    expect(owner()).toBe(s.noah.id);
  });

  it("a late retryable answer reports the authoritative stored result, not its own stale failure", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    await s.act(s.noah, BUYER, "accept");
    const close = await s.act(s.ava, SELLER, "accept", {}, { lose: true });
    const id = close.action?.id as string;
    const hash = close.outcome?.transaction.hash as string;
    // The first observation read is slow: while it is outstanding another check of the same
    // confirmed action applies the close; then the slow read fails (a late, retryable answer).
    const transport = s.w.v3.transport as unknown as Record<string, unknown>;
    let inner: Json | null = null;
    s.w.v3.transport = new Proxy(transport, {
      get(t, k) {
        const f = t[k as string];
        if (typeof f !== "function") return f;
        return async () => {
          s.w.v3.transport = transport as never;
          inner = (await s.ava(`/api/sales/actions/${id}/check`, "POST", {})).body;
          throw new Error("synthetic late read failure");
        };
      },
    }) as never;
    const late = await s.ava(`/api/sales/actions/${id}/check`, "POST", { tx_hash: hash });
    expect(inner).toMatchObject({ effects: { reconcile: { state: "applied" }, finished: true } });
    expect(late.body.resolution).toMatchObject({ kind: "confirmed", result: "closed" });
    // Not "unavailable" or an error: the stored, applied answer, marked finished.
    expect(late.body.effects).toMatchObject({ reconcile: { state: "applied" }, finished: true });
    expect(JSON.stringify(late.body.effects)).not.toContain("unavailable");
    expect(
      (
        s.w.state.store.db
          .prepare("SELECT owner_id FROM businesses WHERE id = ?")
          .get(s.biz) as Json
      ).owner_id,
    ).toBe(s.noah.id);
  });
});

describe("003wf2 claim receipts: the returned promise is the evidence", () => {
  it("paid and restored only through the connected callback; old shapes, wrong pointers, pending and contradictions prove nothing", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    await s.act(s.noah, BUYER, "cancel");
    const claim = async (fail: boolean) => {
      s.sale.failPayouts = fail ? 1 : 0;
      const r = await s.act(s.noah, BUYER, "claim", { category: 1 }, { send: false });
      const row = s.w.state.store.db
        .prepare("SELECT * FROM sale_actions WHERE id = ?")
        .get(r.action?.id) as unknown as SaleActionRow;
      return { row, out: s.wallet(BUYER, r.action?.call), id: r.action?.id as string };
    };
    const first = await claim(true);
    const real = first.out;
    const rs = real.receipts_outcome as Json[];
    expect((rs[0] as Json).outcome.status).toEqual({ SuccessReceiptId: (rs[2] as Json).id });
    expect(resolveSaleTx(first.row, real, real.transaction.hash)).toMatchObject({
      kind: "confirmed",
      result: "restored",
    });
    const h = real.transaction.hash as string;
    const edit = (f: (o: Json) => void) => {
      const o = structuredClone(real);
      f(o);
      return resolveSaleTx(first.row, o, h);
    };
    // The old fabricated shape: an immediate empty value on the claim receipt.
    expect(edit((o) => (o.receipts_outcome[0].outcome.status = { SuccessValue: "" }))).toBeNull();
    // A pointer to the transfer receipt, or to a receipt it didn't create.
    expect(
      edit(
        (o) => (o.receipts_outcome[0].outcome.status = { SuccessReceiptId: (rs[1] as Json).id }),
      ),
    ).toBeNull();
    expect(
      edit((o) => (o.receipts_outcome[0].outcome.status = { SuccessReceiptId: "elsewhere" })),
    ).toBeNull();
    // The callback missing: pending, never paid.
    expect(edit((o) => o.receipts_outcome.splice(2, 1))).toMatchObject({ kind: "unknown" });
    // Duplicate receipt ids make the graph ambiguous.
    expect(edit((o) => o.receipts_outcome.push(structuredClone(o.receipts_outcome[2])))).toBeNull();
    // Contradictions: the transfer succeeded but the callback says it failed; the final value differs;
    // another payout id settled; the callback ran elsewhere.
    expect(edit((o) => (o.receipts_outcome[1].outcome.status = { SuccessValue: "" }))).toBeNull();
    expect(
      edit((o) => (o.status = { SuccessValue: Buffer.from("true").toString("base64") })),
    ).toBeNull();
    expect(
      edit((o) => {
        o.receipts_outcome[2].outcome.logs = [
          o.receipts_outcome[2].outcome.logs[0].replace(/"payout_id":"\d+"/, '"payout_id":"999"'),
        ];
      }),
    ).toBeNull();
    expect(edit((o) => (o.receipts_outcome[2].outcome.executor_id = s.TOKEN))).toBeNull();
    // A gas refund the runtime appends to the claim receipt's children is allowed...
    const refund = {
      id: "refund-receipt-1",
      outcome: { executor_id: BUYER, logs: [], receipt_ids: [], status: { SuccessValue: "" } },
    };
    const withRefund = (o: Json) => {
      o.receipts_outcome[0].outcome.receipt_ids.push(refund.id);
      o.receipts_outcome.push(structuredClone(refund));
    };
    expect(edit(withRefund)).toMatchObject({ kind: "confirmed", result: "restored" });
    // ...but not one that isn't a refund, and not a second transfer or callback (ambiguous paths).
    expect(
      edit((o) => {
        withRefund(o);
        o.receipts_outcome[3].outcome.logs = ["something"];
      }),
    ).toBeNull();
    expect(
      edit((o) => {
        o.receipts_outcome[0].outcome.receipt_ids.push("transfer-2");
        o.receipts_outcome.push({ ...structuredClone(o.receipts_outcome[1]), id: "transfer-2" });
      }),
    ).toBeNull();
    // The transfer's status must be affirmatively success or failure.
    for (const status of [
      {},
      { SuccessValue: "", Failure: {} },
      { Failure: null },
      { SuccessValue: 1 },
    ])
      expect(edit((o) => (o.receipts_outcome[1].outcome.status = status))).toBeNull();
    // Through the route: restored, then a fresh review collects it, paid.
    expect(
      (await s.noah(`/api/sales/actions/${first.id}/check`, "POST", { tx_hash: h })).body.resolution
        .result,
    ).toBe("restored");
    const second = await claim(false);
    const paid = second.out;
    const h2 = paid.transaction.hash as string;
    expect(resolveSaleTx(second.row, paid, h2)).toMatchObject({
      kind: "confirmed",
      result: "paid",
    });
    const paidEdit = (f: (o: Json) => void) => {
      const o = structuredClone(paid);
      f(o);
      return resolveSaleTx(second.row, o, h2);
    };
    // Astra's probes on the paid graph: a refund child is fine; an empty transfer status is no payment.
    expect(
      paidEdit((o) => {
        o.receipts_outcome[0].outcome.receipt_ids.push(refund.id);
        o.receipts_outcome.push(structuredClone(refund));
      }),
    ).toMatchObject({ kind: "confirmed", result: "paid" });
    expect(paidEdit((o) => (o.receipts_outcome[1].outcome.status = {}))).toBeNull();
    expect(
      paidEdit((o) => (o.receipts_outcome[1].outcome.status = { Failure: { ActionError: "x" } })),
    ).toBeNull();
    expect(
      paidEdit(
        (o) =>
          (o.receipts_outcome[2].outcome.status = {
            SuccessValue: o.receipts_outcome[2].outcome.status.SuccessValue,
            Failure: {},
          }),
      ),
    ).toBeNull();
  });
});

describe("003wf2 wallet loss, recovery and admission", () => {
  it("a lost answer stays unknown until this action's own transaction shows it; lookalikes and other IDs prove nothing", async () => {
    const s = await saleWorld();
    const r = await s.act(s.ava, SELLER, "propose", proposal(), { lose: true });
    const id = r.action?.id as string;
    // The proposal landed, but its hash never came back: the check can't confirm it.
    const c1 = await s.ava(`/api/sales/actions/${id}/check`, "POST", {});
    expect(c1.body.resolution.kind).toBe("no_longer_possible");
    expect(c1.body.action.state).toBe("no_longer_possible");
    // Another real transaction's ID (the buyer's registration) shows nothing about it.
    const other = await s.act(s.noah, BUYER, "register");
    const c2 = await s.ava(`/api/sales/actions/${id}/check`, "POST", {
      tx_hash: other.outcome?.transaction.hash,
    });
    expect(c2.body.transaction).toEqual({ hash: other.outcome?.transaction.hash, matched: false });
    expect(c2.body.action.tx_hash).toBeNull();
    // The original transaction's ID, copied from the wallet's activity: confirmed, and the version recorded.
    const c3 = await s.ava(`/api/sales/actions/${id}/check`, "POST", {
      tx_hash: r.outcome?.transaction.hash,
    });
    expect(c3.body.resolution).toMatchObject({ kind: "confirmed", result: "proposed" });
    expect(c3.body.action).toMatchObject({
      state: "confirmed",
      tx_hash: r.outcome?.transaction.hash,
    });
    expect(c3.body.effects).toMatchObject({ recorded: { deal_seq: "1", version: 1 } });
    // Nothing was sent twice: exactly one proposal on the contract.
    expect(s.sale.dealSeq).toBe(1n);
    expect((await s.ava(`/api/sales/actions/${id}/check`, "POST", {})).body.resolution).toBeNull();
  });

  it("no fresh ask for an unknown request; only a same-identity replacement, and at most one of them takes effect", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    // The wallet was asked but never sent anything (the window crashed before approval).
    const lost = await s.act(s.noah, BUYER, "fund", {}, { send: false });
    const c = await s.noah(`/api/sales/actions/${lost.action?.id}/check`, "POST", {});
    expect(c.body.resolution.kind).toBe("unknown");
    expect(c.body.action.state).toBe("unknown");
    expect((await s.noah(`/api/sales/actions/${lost.action?.id}/abandon`, "POST")).body.code).toBe(
      "action_requested",
    );
    // A new request without naming the open one: refused, with the open one to recover.
    const p = await s.prepare(s.noah, "fund");
    const blocked = await s.noah(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "fund",
      input: {},
      action_digest: p.body.action_digest,
      idempotency_key: "fund-replace-0001",
    });
    expect([blocked.status, blocked.body.code, blocked.body.detail?.replaceable]).toEqual([
      409,
      "action_open",
      true,
    ]);
    // Named as the replacement, and the identical immutable request (same digest): admitted.
    const rep = await s.act(s.noah, BUYER, "fund", {}, { replaces: lost.action?.id });
    expect(rep.check?.body.resolution.result).toBe("funded");
    // The original, arriving late: the contract returns it whole; its own transaction shows it.
    const late = s.wallet(BUYER, lost.action?.call);
    const lc = await s.noah(`/api/sales/actions/${lost.action?.id}/check`, "POST", {
      tx_hash: late.transaction.hash,
    });
    expect(lc.body.resolution).toMatchObject({ kind: "refused" });
    expect(lc.body.resolution.message).toContain("returned the whole amount");
    expect((s.control().live_deal as Json).escrow).toBe(PRICE);
    expect(s.w.chain.balances.get(BUYER)).toBe(1_000_000_000n - BigInt(PRICE));
    // An unknown request never blocks another KIND (it can't duplicate it)...
    const open = await s.act(s.noah, BUYER, "unfund", {}, { send: false });
    const accept = await s.act(s.noah, BUYER, "accept");
    expect(accept.check?.body.resolution.result).toBe("accepted");
    // ...but the same kind waits: the state moved, so another unfund isn't the identical request.
    const again = await s.prepare(s.noah, "unfund");
    const diff = await s.noah(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "unfund",
      input: {},
      action_digest: again.body.action_digest,
      idempotency_key: "unfund-while-open-0001",
      replaces: open.action?.id,
    });
    expect([diff.status, diff.body.code, diff.body.detail?.replaceable]).toEqual([
      409,
      "action_open",
      false,
    ]);
    // The open unfund can never land now (control moved): proven inapplicable, it stops blocking.
    const gone = await s.noah(`/api/sales/actions/${open.action?.id}/check`, "POST", {});
    expect(gone.body.resolution.kind).toBe("no_longer_possible");
    expect((await s.act(s.noah, BUYER, "unfund")).check?.body.resolution.result).toBe("unfunded");
  });

  it("acceptance and registration are never replaced, and never declared inapplicable from reversible state", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "propose", proposal());
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    // The buyer's acceptance was asked for and never sent (as far as anyone here knows).
    const acc = await s.act(s.noah, BUYER, "accept", {}, { send: false });
    expect(
      (await s.noah(`/api/sales/actions/${acc.action?.id}/check`, "POST", {})).body.resolution.kind,
    ).toBe("unknown");
    // Not replaceable, even as the identical request: two acceptances could both take effect.
    const p = await s.prepare(s.noah, "accept");
    expect(p.body.action_digest).toBe(acc.action?.action_digest);
    const rep = await s.noah(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "accept",
      input: {},
      action_digest: p.body.action_digest,
      idempotency_key: "accept-replace-0001",
      replaces: acc.action?.id,
    });
    expect([rep.status, rep.body.code, rep.body.detail?.replaceable]).toEqual([
      409,
      "action_open",
      false,
    ]);
    // Unfund and fund again clear and restore what an acceptance needs without a new version:
    // the open acceptance stays possible (an accepted flag is reversible).
    await s.act(s.noah, BUYER, "unfund");
    await s.act(s.noah, BUYER, "fund");
    expect(
      (await s.noah(`/api/sales/actions/${acc.action?.id}/check`, "POST", {})).body.resolution.kind,
    ).toBe("unknown");
    // It finally lands, and its own transaction settles it (a result of its own).
    const late = s.wallet(BUYER, acc.action?.call);
    const lc = await s.noah(`/api/sales/actions/${acc.action?.id}/check`, "POST", {
      tx_hash: late.transaction.hash,
    });
    expect(lc.body.resolution).toMatchObject({ kind: "confirmed", result: "accepted" });
    // Registration: the token says registered (done elsewhere, synthetic), yet the open request
    // stays unknown: registered state can be undone (storage_unregister).
    const reg = await s.act(s.ava, SELLER, "register", {}, { send: false });
    s.w.chain.tokenRegistered.add(SELLER);
    const rc = await s.ava(`/api/sales/actions/${reg.action?.id}/check`, "POST", {});
    expect([rc.body.resolution.kind, rc.body.action.state]).toEqual(["unknown", "unknown"]);
    // A revision (a new version) is irreversible: an open acceptance of the old one is then inapplicable.
    const acc2 = await s.act(s.ava, SELLER, "accept", {}, { send: false });
    await s.act(s.ava, SELLER, "revise", { ...proposal(), note: "v2" });
    expect(
      (await s.ava(`/api/sales/actions/${acc2.action?.id}/check`, "POST", {})).body.resolution.kind,
    ).toBe("no_longer_possible");
  });

  it("one wallet ask per request: a single winner across tabs; a returned hash grants nothing", async () => {
    const s = await saleWorld();
    const p = await s.prepare(s.ava, "propose", proposal());
    const c = await s.ava(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "propose",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: "ask-once-0001",
    });
    const id = c.body.action.id as string;
    const asks = await Promise.all(
      [1, 2, 3].map(() => s.ava(`/api/sales/actions/${id}/requested`, "POST", {})),
    );
    expect(asks.map((a) => a.body.ask).sort()).toEqual([
      "already_asked",
      "already_asked",
      "granted",
    ]);
    expect((await s.ava(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask).toBe(
      "already_asked",
    );
    const out = s.wallet(SELLER, c.body.action.call);
    const h = await s.ava(`/api/sales/actions/${id}/requested`, "POST", {
      tx_hash: out.transaction.hash,
    });
    expect([h.body.ask, h.body.action.asks, h.body.action.tx_hash]).toEqual([
      null,
      1,
      out.transaction.hash,
    ]);
    expect(
      (await s.ava(`/api/sales/actions/${id}/requested`, "POST", { tx_hash: "x" })).body.code,
    ).toBe("bad_tx_hash");
  });

  it("concurrent checks commit one coherent result: the hash, evidence and state of one transaction", async () => {
    // A second transaction for the same request that the contract refused (synthetic: exactly
    // this request otherwise), so two checks race with contradictory exact answers.
    const A = "2".repeat(44);
    const B = "B";
    const failure = {
      Failure: {
        ActionError: { kind: { FunctionCallError: { ExecutionError: "E_ARGS: synthetic" } } },
      },
    };
    for (const order of [
      [B, A],
      [A, B],
    ]) {
      const t = await saleWorld();
      const r = await t.act(t.ava, SELLER, "register", {}, { send: false });
      const ok = t.wallet(SELLER, r.action?.call);
      const no = structuredClone(ok);
      no.transaction.hash = A;
      no.transaction_outcome.id = A;
      no.status = failure;
      no.receipts_outcome[0].outcome.status = failure;
      const answers: Record<string, Json> = { [ok.transaction.hash]: ok, [A]: no };
      const gates = new Map<string, () => void>();
      t.w.reader.txOutcome = (h: string) =>
        new Promise((res) => gates.set(h, () => res(answers[h] ?? null))) as never;
      const first = t.ava(`/api/sales/actions/${r.action?.id}/check`, "POST", {
        tx_hash: order[0] === B ? ok.transaction.hash : A,
      });
      const second = t.ava(`/api/sales/actions/${r.action?.id}/check`, "POST", {
        tx_hash: order[1] === B ? ok.transaction.hash : A,
      });
      while (gates.size < 2) await new Promise((x) => setTimeout(x, 5));
      gates.get(order[0] === B ? ok.transaction.hash : A)?.();
      await first;
      gates.get(order[1] === B ? ok.transaction.hash : A)?.();
      await second;
      const row = t.w.state.store.db
        .prepare("SELECT state, tx_hash, evidence FROM sale_actions WHERE id = ?")
        .get(r.action?.id) as Json;
      const ev = JSON.parse(row.evidence) as Json;
      // Whichever reply landed first is the row's one coherent result; the late one changed nothing.
      if (order[0] === B)
        expect([row.state, row.tx_hash, ev.kind]).toEqual([
          "confirmed",
          ok.transaction.hash,
          "confirmed",
        ]);
      else expect([row.state, row.tx_hash, ev.kind]).toEqual(["refused", A, "refused"]);
    }
  });

  it("duplicate keys, a changed review, an open preparation, set-aside, and two tabs creating at once", async () => {
    const s = await saleWorld();
    const p = await s.prepare(s.ava, "propose", proposal());
    const body = {
      kind: "propose",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: "propose-dup-0001",
    };
    const first = await s.ava(`/api/sales/${s.biz}/actions`, "POST", body);
    expect(first.status).toBe(201);
    const again = await s.ava(`/api/sales/${s.biz}/actions`, "POST", body);
    expect([again.status, again.body.created, again.body.action.id]).toEqual([
      200,
      false,
      first.body.action.id,
    ]);
    const conflict = await s.ava(`/api/sales/${s.biz}/actions`, "POST", {
      ...body,
      action_digest: "0".repeat(64),
    });
    expect(conflict.body.code).toBe("idempotency_conflict");
    // An open, never-asked preparation is returned for recovery, then can be set aside.
    const second = await s.ava(`/api/sales/${s.biz}/actions`, "POST", {
      ...body,
      idempotency_key: "propose-dup-0002",
    });
    expect([second.body.code, second.body.detail.action.id]).toEqual([
      "action_open",
      first.body.action.id,
    ]);
    const aside = await s.ava(`/api/sales/actions/${first.body.action.id}/abandon`, "POST");
    expect(aside.body.action.state).toBe("set_aside");
    // The review changed (another price reviewed under the old digest): review again.
    const changed = await s.ava(`/api/sales/${s.biz}/actions`, "POST", {
      ...body,
      input: { ...p.body.input, price: "1" },
      idempotency_key: "propose-dup-0003",
    });
    expect(changed.body.code).toBe("review_changed");
    expect(changed.body.detail.preview.call.args.terms.price).toBe("1");
    // Two tabs create at once: exactly one is admitted; the other gets it back to recover.
    const p2 = await s.prepare(s.ava, "propose", proposal());
    const [x, y] = await Promise.all(
      ["propose-tab-0001", "propose-tab-0002"].map((k) =>
        s.ava(`/api/sales/${s.biz}/actions`, "POST", {
          ...body,
          input: p2.body.input,
          action_digest: p2.body.action_digest,
          idempotency_key: k,
        }),
      ),
    );
    expect([x?.status, y?.status].sort()).toEqual([201, 409]);
    const rows = s.w.state.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM sale_actions WHERE business_id = ? AND state = 'prepared'",
      )
      .get(s.biz) as Json;
    expect(rows.n).toBe(1);
  });

  it("an older contract and wrong accounts are refused; nothing falls back", async () => {
    const s = await saleWorld();
    s.sale.saleTerms = false;
    const a = await s.setup(s.ava);
    expect(a.body.capability).toEqual({ supported: false, reason: "contract_upgrade" });
    expect((await s.prepare(s.ava, "propose", proposal())).body.code).toBe("contract_upgrade");
    s.sale.saleTerms = true;
    expect(
      (await s.prepare(s.ava, "propose", { ...proposal(), buyer_account: "nobody.near" })).body
        .code,
    ).toBe("buyer_unmapped");
    expect(
      (await s.prepare(s.ava, "propose", { ...proposal(), buyer_account: SELLER })).body.code,
    ).toBe("bad_buyer");
    expect((await s.prepare(s.ava, "nonsense")).body.code).toBe("bad_kind");
    // A transaction from another signer, to another receiver, or with other arguments isn't this action.
    const r = await s.act(s.ava, SELLER, "propose", proposal(), { send: false });
    const row = s.w.state.store.db
      .prepare("SELECT * FROM sale_actions WHERE id = ?")
      .get(r.action?.id) as unknown as SaleActionRow;
    const real = s.wallet(SELLER, r.action?.call);
    expect(resolveSaleTx(row, real, real.transaction.hash)).toMatchObject({ kind: "confirmed" });
    const edit = (f: (o: Json) => void) => {
      const o = structuredClone(real);
      f(o);
      return resolveSaleTx(row, o, real.transaction.hash);
    };
    expect(edit((o) => (o.transaction.signer_id = BUYER))).toBeNull();
    expect(edit((o) => (o.transaction.receiver_id = s.TOKEN))).toBeNull();
    expect(edit((o) => (o.final_execution_status = "EXECUTED_OPTIMISTIC"))).toBeNull();
    expect(edit((o) => (o.status = {}))).toBeNull();
    expect(
      edit((o) => {
        o.transaction.actions[0].FunctionCall.args = Buffer.from(
          JSON.stringify({ ...r.action?.call.args, digest: "0".repeat(64) }),
        ).toString("base64");
      }),
    ).toBeNull();
    expect(edit((o) => (o.receipts_outcome[0].outcome.logs = []))).toBeNull();
    expect(edit((o) => (o.receipts_outcome[0].outcome.executor_id = "elsewhere.near"))).toBeNull();
    expect(edit((o) => (o.transaction_outcome.id = "other"))).toBeNull();
    expect(resolveSaleTx(row, real, "1".repeat(44))).toBeNull();
  });
});
