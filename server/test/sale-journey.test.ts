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
    expect([blocked.status, blocked.body.code, blocked.body.detail?.same_identity]).toEqual([
      409,
      "action_open",
      true,
    ]);
    // Named as a replacement under the same identity: admitted.
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
    // A different identity while an asked request is open: refused.
    const open = await s.act(s.noah, BUYER, "unfund", {}, { send: false });
    const accept = await s.prepare(s.noah, "accept");
    const diff = await s.noah(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "accept",
      input: {},
      action_digest: accept.body.action_digest,
      idempotency_key: "accept-while-open-0001",
      replaces: open.action?.id,
    });
    expect([diff.status, diff.body.code, diff.body.detail?.same_identity]).toEqual([
      409,
      "action_open",
      false,
    ]);
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
