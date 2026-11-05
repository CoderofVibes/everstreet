// The synthetic chain's install_key (Stage C browser pass, Nov 5): a customer enrolls a device key
// on its own, with the contract's checks and refusal codes (contracts/business-v3 lib.rs
// install_key). Before, the double refused every call that wasn't on the purchase path, so a
// browser enrollment in the harness could never succeed. Fictional customer and keys.

import { describe, expect, it } from "vitest";
import { BUSINESS, CUSTOMER, customerWorld, type Json } from "./customer-world.ts";

const pk = (c: string) => c.repeat(64);
const call = (args: Json, deposit = "1") => ({
  receiverId: BUSINESS,
  methodName: "install_key",
  args: { plan_id: 1, slot: 2, pk: pk("a"), max_hold_units: 1, max_units_per_day: 10, ...args },
  deposit,
  gas: "30000000000000",
});
const failure = (out: Json) =>
  JSON.stringify(out.status?.Failure ?? null).match(/E_[A-Z_]+/)?.[0] ?? null;

describe("the synthetic chain's install_key", () => {
  it("enrolls a free slot like the contract, and refuses what the contract refuses", async () => {
    const w = await customerWorld();
    const before = w.chain.ent(CUSTOMER) as Json;
    const epoch = before.keys[2].epoch as number;
    const out = w.chain.walletCall(CUSTOMER, call({}) as never);
    expect(failure(out)).toBeNull();
    const after = w.chain.ent(CUSTOMER) as Json;
    expect(after.keys[2]).toMatchObject({ state: "active", public_key: pk("a"), epoch: epoch + 1 });
    expect(failure(w.chain.walletCall(CUSTOMER, call({ pk: pk("b") }) as never))).toBe("E_KEY");
    expect(failure(w.chain.walletCall(CUSTOMER, call({ slot: 3, pk: "zz" }) as never))).toBe(
      "E_KEY_INVALID",
    );
    expect(
      failure(w.chain.walletCall(CUSTOMER, call({ slot: 3, max_hold_units: 200 }) as never)),
    ).toBe("E_ARGS");
    expect(failure(w.chain.walletCall(CUSTOMER, call({ slot: 3 }, "0") as never))).toBe(
      "E_DEPOSIT",
    );
    expect(failure(w.chain.walletCall("nobody.near", call({ slot: 3 }) as never))).toBe(
      "E_NO_ENTITLEMENT",
    );
  });
});
