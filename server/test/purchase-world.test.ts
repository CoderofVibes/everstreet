// Job 003web: the purchase-path test double (FixtureChain.walletCall) against the CONTRACT's own
// outcomes (server/test/fixtures/v3/customer-purchase.json, written by
// contracts/business-v3 tests.rs customer_purchase_matches_server_fixture). Each case replays the
// same call the contract test made, as a wallet transaction, and compares the exact event logs,
// the returned amount and the resulting entitlement JSON. Fictional accounts; no network.

import { describe, expect, it } from "vitest";
import { BUSINESS, CUSTOMER, FixtureChain, type Json, PURCHASE, TOKEN } from "./customer-world.ts";

const ent = (c: FixtureChain, who: string) => {
  const { reg_id: _r, ...rest } = c.ent(who) as Json;
  return rest;
};
const fixtureEnt = (raw: string) => {
  const { reg_id: _r, ...rest } = JSON.parse(raw) as Json;
  return rest;
};
const shell = (c: FixtureChain, payer: string, customer: string, deposit: string) =>
  c.walletCall(payer, {
    receiverId: BUSINESS,
    methodName: "sponsor_shell",
    args: { customer, plan_id: 1 },
    deposit,
    gas: "30000000000000",
  });
const pay = (c: FixtureChain, sender: string, amount: string, msg: string) =>
  c.walletCall(sender, {
    receiverId: TOKEN,
    methodName: "ft_transfer_call",
    args: { receiver_id: BUSINESS, amount, msg },
    deposit: "1",
    gas: "100000000000000",
  });
const businessLogs = (o: Json) =>
  (o.receipts_outcome as Json[]).find((r) => r.outcome.executor_id === BUSINESS)?.outcome.logs;
const returned = (o: Json) => {
  const r = (o.receipts_outcome as Json[]).find((x) => x.outcome.executor_id === BUSINESS);
  return JSON.parse(Buffer.from(r?.outcome.status.SuccessValue, "base64").toString());
};
/** A double with no entitlement for Cara (as the contract test's fresh world). */
const fresh = () => {
  const c = new FixtureChain();
  c.ents.delete(CUSTOMER);
  c.balances.set(CUSTOMER, 10n ** 12n);
  return c;
};

describe("003web the purchase double matches the contract's own outcomes", () => {
  it("the plan, token and storage price are the contract test's", () => {
    const c = new FixtureChain();
    expect(c.plan).toEqual(JSON.parse(PURCHASE.plan));
    expect(String(c.byteCost)).toBe(PURCHASE.storage_byte_cost);
    expect(PURCHASE.business).toBe(BUSINESS);
    expect(PURCHASE.token).toBe(TOKEN);
  });

  it("sponsor_shell: exactly the measured growth for every customer and payer length, never twice", () => {
    for (const s of PURCHASE.shells as Json[]) {
      const c = fresh();
      c.ents.delete(s.customer);
      expect(BigInt(s.bytes)).toBe(811n + BigInt(s.customer.length));
      const low = shell(c, s.payer, s.customer, String(BigInt(s.storage_paid) - 1n));
      expect(JSON.stringify(low.status)).toContain("E_STORAGE");
      const o = shell(c, s.payer, s.customer, s.storage_paid);
      expect(o.status).toEqual({ SuccessValue: "" });
      expect(ent(c, s.customer)).toEqual(fixtureEnt(s.entitlement));
      expect(JSON.stringify(shell(c, s.payer, s.customer, s.storage_paid).status)).toContain(
        "E_EXISTS",
      );
    }
  });

  it("an accepted purchase, then each refusal returned whole with the contract's own event", () => {
    const c = fresh();
    shell(c, CUSTOMER, CUSTOMER, "8200000000000000000000");
    const a = PURCHASE.accepted as Json;
    const o = pay(c, a.sender, a.amount, a.msg);
    expect(businessLogs(o)).toEqual(a.logs);
    expect(returned(o)).toBe(a.returned);
    expect(ent(c, CUSTOMER)).toEqual(fixtureEnt(a.entitlement));
    for (const r of PURCHASE.refusals as Json[]) {
      const before = c.balances.get(r.sender);
      const x = pay(c, r.sender, r.amount, r.msg);
      expect(businessLogs(x), r.case).toEqual(r.logs);
      expect(returned(x), r.case).toBe(r.returned);
      if (r.returned === r.amount) expect(c.balances.get(r.sender), r.case).toBe(before);
    }
    expect(ent(c, CUSTOMER)).toEqual(fixtureEnt(PURCHASE.after_refusals));
  });

  it("buy with install enrolls the key in the same call; an occupied slot is returned whole", () => {
    const c = fresh();
    shell(c, CUSTOMER, CUSTOMER, "8200000000000000000000");
    const i = PURCHASE.install as Json;
    const o = pay(c, i.sender, i.amount, i.msg);
    expect(businessLogs(o)).toEqual(i.logs);
    expect(ent(c, CUSTOMER)).toEqual(fixtureEnt(i.entitlement));
    const occ = pay(c, CUSTOMER, i.occupied.amount, i.occupied.msg);
    expect(businessLogs(occ)).toEqual(i.occupied.logs);
    expect(returned(occ)).toBe(i.occupied.returned);
  });

  it("the token's own refusals fail the whole transaction: no funds, unregistered receiver", () => {
    const c = fresh();
    shell(c, CUSTOMER, CUSTOMER, "8200000000000000000000");
    c.balances.set(CUSTOMER, 10n);
    const poor = pay(c, CUSTOMER, "5000000", (PURCHASE.accepted as Json).msg);
    expect(JSON.stringify(poor.status)).toContain("enough balance");
    expect(c.balances.get(CUSTOMER)).toBe(10n);
    c.balances.set(CUSTOMER, 10n ** 12n);
    c.tokenRegistered.delete(BUSINESS);
    const nowhere = pay(c, CUSTOMER, "5000000", (PURCHASE.accepted as Json).msg);
    expect(JSON.stringify(nowhere.status)).toContain("not registered");
    expect((c.ent(CUSTOMER) as Json).purchase_seq).toBe(0);
  });
});

describe("003web registration-bound purchases and the contract's declared terms", () => {
  it("get_purchase_terms states the measured shell bytes for every fixture customer", () => {
    const c = new FixtureChain();
    for (const s of PURCHASE.shells as Json[])
      expect(c.answer("get_purchase_terms", { customer: s.customer })).toBe(s.terms);
  });

  it("a buy for a replaced registration is returned whole; one for the current registration is accepted", () => {
    const x = PURCHASE.replacement as Json;
    const c = new FixtureChain();
    // The first registration, then unregistered (nothing bought) and a new shell: purchase_seq 0.
    shell(c, x.customer, x.customer, "8200000000000000000000");
    const first = (c.ent(x.customer) as Json).reg_id;
    c.ents.delete(x.customer);
    shell(c, x.customer, x.customer, "8200000000000000000000");
    const second = (c.ent(x.customer) as Json).reg_id;
    const old = x.bound_old.msg.replace(`"reg_id":"${x.first_reg_id}"`, `"reg_id":"${first}"`);
    const o = pay(c, x.customer, x.bound_old.amount, old);
    expect(businessLogs(o)).toEqual(x.bound_old.logs);
    expect(returned(o)).toBe(x.bound_old.returned);
    const cur = x.bound_current.msg.replace(
      `"reg_id":"${x.second_reg_id}"`,
      `"reg_id":"${second}"`,
    );
    const ok = pay(c, x.customer, x.bound_current.amount, cur);
    expect(businessLogs(ok)).toEqual(x.bound_current.logs);
    expect(returned(ok)).toBe("0");
  });
});
