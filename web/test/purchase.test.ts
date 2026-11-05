// Job 003w-e3: the fresh customer's prepared transactions (web/src/purchase.ts), checked against the
// contract's rules (contracts/business-v3/src/lib.rs: sponsor_shell, ft_on_transfer/validate_buy,
// the externally tagged `Incoming::Buy` message and `Install`). Nothing is sent.

import { describe, expect, it } from "vitest";
import { buyCall, sponsorShellCall } from "../src/purchase.ts";

describe("003w-e3 fresh-customer transactions", () => {
  it("sponsor_shell needs a quoted deposit (the contract refunds any excess); it is never guessed", () => {
    expect(() =>
      sponsorShellCall({
        contract: "studio.biz.near",
        customer: "cara.near",
        planId: 1,
        quotedDeposit: "0",
      }),
    ).toThrow(/quoted/);
    expect(
      sponsorShellCall({
        contract: "studio.biz.near",
        customer: "cara.near",
        planId: 1,
        quotedDeposit: "10000000000000000000000",
      }),
    ).toEqual({
      receiverId: "studio.biz.near",
      methodName: "sponsor_shell",
      args: { customer: "cara.near", plan_id: 1 },
      gas: "30000000000000",
      deposit: "10000000000000000000000",
    });
  });

  it("the purchase pays exactly units x price to the business through its own token, with the NEXT sequence and this device's key", () => {
    const call = buyCall({
      asset: "usd.fixture.near",
      contract: "studio.biz.near",
      planId: 1,
      units: 100,
      unitPrice: "1000000",
      maxUnitsPerPurchase: 100,
      purchaseSeq: 0,
      regId: "1",
      install: { slot: 1, public_key: "ab".repeat(32), max_hold_units: 1, max_units_per_day: 10 },
    });
    expect(call).toMatchObject({
      receiverId: "usd.fixture.near",
      methodName: "ft_transfer_call",
      deposit: "1",
    });
    expect(call.args.receiver_id).toBe("studio.biz.near");
    expect(call.args.amount).toBe("100000000");
    expect(JSON.parse(call.args.msg as string)).toEqual({
      buy: {
        plan_id: 1,
        units: 100,
        purchase_seq: 1,
        install: { slot: 1, pk: "ab".repeat(32), max_hold_units: 1, max_units_per_day: 10 },
        reg_id: "1",
      },
    });
  });

  it("refuses what the contract would return: too many units, a zero price, a bad sequence", () => {
    const base = {
      asset: "usd.fixture.near",
      contract: "studio.biz.near",
      planId: 1,
      unitPrice: "5",
      maxUnitsPerPurchase: 10,
      purchaseSeq: 3,
      regId: "4",
    };
    expect(() => buyCall({ ...base, units: 11 })).toThrow(/1 to 10/);
    expect(() => buyCall({ ...base, units: 0 })).toThrow();
    expect(() => buyCall({ ...base, units: 1, unitPrice: "0" })).toThrow(/price/);
    expect(() => buyCall({ ...base, units: 1, purchaseSeq: -1 })).toThrow(/sequence/);
    expect(JSON.parse(buyCall({ ...base, units: 2 }).args.msg as string).buy).toMatchObject({
      purchase_seq: 4,
      install: null,
      reg_id: "4",
    });
    expect(() => buyCall({ ...base, units: 1, regId: "x" })).toThrow(/registration/);
    expect(() => buyCall({ ...base, units: 1, unitPrice: (1n << 128n).toString() })).toThrow(
      /price/,
    );
  });
});
