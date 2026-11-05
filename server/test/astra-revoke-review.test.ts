// Reviewed revocation targets the observed key, not whichever key occupies its slot later.
// Actual DeviceKeys; fictional injected read/store/wallet boundaries, no crypto or network.
import { expect, it } from "vitest";
import { DeviceKeys, type KeysReadback } from "../../web/src/deviceKey.ts";
import type { WalletBoundary, WalletFunctionCall } from "../../web/src/wallet.ts";

it("does not revoke a replacement key under an earlier key's review", async () => {
  const account = "fictional-customer.testnet";
  const rb: KeysReadback = {
    network: "testnet",
    contract: "fictional-business.testnet",
    plan_id: 1,
    customer: account,
    plan_max_hold_units: 1,
    block: { height: "1", timestamp_ms: String(Date.now()) },
    registered: true,
    active: true,
    reg_id: "1",
    keys: [
      {
        slot: 0,
        state: "active",
        epoch: 1,
        public_key: "11".repeat(32),
        max_hold_units: 1,
        max_units_per_day: 10,
      },
    ],
  };
  const sent: WalletFunctionCall[] = [];
  const wallet: WalletBoundary = {
    label: "Synthetic review wallet",
    synthetic: true,
    accounts: async () => [account],
    connect: async () => account,
    disconnect: async () => {},
    onChange: () => () => {},
    signMessage: async () => {
      throw new Error("No sign-in in this test");
    },
    send: async (call) => {
      sent.push(call);
    },
  };
  const keys = new DeviceKeys({
    account,
    read: async () => structuredClone(rb),
    store: async () => ({ get: async () => null, put: async () => {}, delete: async () => {} }),
    wallet: async () => wallet,
  });
  const reviewed = await keys.prepareRevoke("offer", 0);
  if (reviewed.kind !== "request") throw new Error("Expected a revocation review");
  // Another device revokes the old key and installs a new one while the review is open.
  const original = rb.keys[0];
  if (!original) throw new Error("Missing fixture key");
  rb.keys[0] = { ...original, epoch: 3, public_key: "22".repeat(32) };
  rb.block.height = "2";
  await keys.revoke("offer", 0, reviewed.call);
  expect(sent, "changed key identity needs renewed review before any wallet request").toEqual([]);
});
