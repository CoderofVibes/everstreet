// Job 003l: the customer-use readback fixture (produced by the business-v3 contract's own unit
// test, customer_readback_matches_server_fixture) says what docs/design/CUSTOMER_USE_RUNTIME.md
// §9 relies on. A fixture check only: no customer admission exists. Test signing keys, not wallets.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
type Json = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(join(here, "fixtures", "v3", "customer-readback.json"), "utf8"),
) as Record<string, string>;
const v = (k: string) => JSON.parse(raw[k] as string) as Json;

describe("003l customer readback (contract fixture)", () => {
  it("has every state the protocol interprets, each the contract's JSON", () => {
    expect(Object.keys(raw).sort()).toEqual(
      [
        "plan_1",
        "funded_100.entitlement",
        "consumed_20.entitlement",
        "consumed_20.check_use.closed_hold",
        "consumed_20.check_use.closed_hold_altered",
        "consumed_20.check_use.unknown_hold",
        "active_hold.entitlement",
        "active_hold.check_use.charged",
        "active_hold.check_use.altered_fingerprint",
        "active_hold.check_use.unused_slot",
        "active_hold.settle_replay",
        "released_after_deadline.entitlement",
        "released_after_deadline.check_use.charged_slot",
        "released_after_deadline.check_use.unused_slot",
        "after_sale.entitlement",
        "after_sale.control",
      ].sort(),
    );
  });

  it("100 funded, then 20 used, then 80 left across an actual sale", () => {
    expect(v("funded_100.entitlement")).toMatchObject({
      free: "100",
      consumed: "0",
      purchased: "100",
    });
    expect(v("consumed_20.entitlement")).toMatchObject({
      free: "80",
      consumed: "20",
      hold_active: false,
    });
    expect(v("after_sale.entitlement")).toMatchObject({
      free: "80",
      consumed: "20",
      purchased: "100",
    });
    expect(v("after_sale.control")).toMatchObject({
      owner: "buyer.near",
      generation: 2,
      operators: [["meter2.near", 1, 2]],
    });
  });

  it("an active hold answers charged / conflict / unused; a replay is 'already'", () => {
    expect(v("active_hold.check_use.charged").status).toBe("charged");
    expect(v("active_hold.check_use.altered_fingerprint").status).toBe("conflict");
    expect(v("active_hold.check_use.unused_slot")).toMatchObject({
      status: "unused",
      slot_used: false,
    });
    expect(v("active_hold.settle_replay")).toEqual(["already"]);
    // The active hold's fingerprints are public on chain: why the protocol salts them (§3).
    expect(v("active_hold.entitlement").hold_slots.filter(Boolean)).toHaveLength(4);
  });

  it("a closed hold answers the same for the real and an altered fingerprint: only the root decides", () => {
    expect(v("consumed_20.check_use.closed_hold")).toEqual(
      v("consumed_20.check_use.closed_hold_altered"),
    );
    expect(v("consumed_20.check_use.closed_hold")).toMatchObject({
      status: "closed",
      slot_used: true,
    });
    expect(v("consumed_20.check_use.closed_hold").closed_root).toBe(
      v("consumed_20.entitlement").last_hold_root,
    );
    expect(v("consumed_20.check_use.unknown_hold").status).toBe("unknown_hold");
  });

  it("released after its deadline: charged uses stay consumed, the rest return to free", () => {
    expect(v("released_after_deadline.entitlement")).toMatchObject({
      free: "76",
      consumed: "24",
      hold_active: false,
      last_hold_seq: 3,
      last_hold_charged: 4,
    });
    expect(v("released_after_deadline.check_use.charged_slot")).toMatchObject({
      status: "closed",
      slot_used: true,
    });
    expect(v("released_after_deadline.check_use.unused_slot")).toMatchObject({
      status: "closed",
      slot_used: false,
    });
  });
});
