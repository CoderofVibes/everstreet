// Two real IndexedDB handles and the real DeviceKeys controller/keys route.
// A late wallet answer must not restore an older same-key record over another tab's intent.
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { applyKeyCall } from "../../scripts/lib/walletHarness.ts";
import { DeviceKeys, type KeysReadback, openDeviceKeyStore } from "../../web/src/deviceKey.ts";
import type { WalletBoundary } from "../../web/src/wallet.ts";
import { CUSTOMER, customerWorld, type Json } from "./customer-world.ts";

it.each([false, true])(
  "late revoke reply preserves another tab's same-key record (new registration: %s)",
  async (newRegistration) => {
    const w = await customerWorld();
    const offer = await w.offer();
    const idb = new IDBFactory();
    const primary = await openDeviceKeyStore(idb);
    const other = await openDeviceKeyStore(idb);
    let onSend = async () => {};
    const wallet: WalletBoundary = {
      label: "synthetic offline test",
      synthetic: true,
      accounts: async () => [CUSTOMER],
      connect: async () => CUSTOMER,
      disconnect: async () => {},
      onChange: () => () => {},
      signMessage: async () => {
        throw new Error("unused");
      },
      send: async () => {
        await onSend();
        throw new Error("Failed to fetch");
      },
    };
    const controller = new DeviceKeys({
      account: CUSTOMER,
      store: async () => primary,
      wallet: async () => wallet,
      read: async (id) => {
        const response = await w.cara(`/api/customer/offers/${id}/keys`);
        expect(response.status).toBe(200);
        return response.body as KeysReadback;
      },
    });
    try {
      const enrollment = await controller.prepareEnrollment(offer, 10);
      expect(enrollment.kind).toBe("request");
      if (enrollment.kind !== "request") throw new Error("missing review");
      // Contract-anchored fixture installation establishes the test's starting authorization.
      applyKeyCall(w.chain.ent(CUSTOMER) as Json, enrollment.call, {
        plan_id: 1,
        max_hold_units: Number(w.chain.plan.max_hold_units),
        now_ms: w.chain.ts,
      });
      const original = enrollment.record;
      const review = await controller.prepareRevoke(offer, original.slot);
      expect(review.kind).toBe("request");
      if (review.kind !== "request") throw new Error("missing revoke review");
      const newer = {
        ...original,
        created_ms: original.created_ms + 1,
        max_units_per_day: 15,
        intent: "enroll" as const,
      };
      onSend = async () => {
        await other.put(newer);
        if (newRegistration) {
          const entitlement = w.chain.ent(CUSTOMER) as Json;
          entitlement.reg_id = String(BigInt(entitlement.reg_id) + 1n);
        }
      };
      await controller.revoke(offer, original.slot, review);
      expect(await other.get(original.id)).toMatchObject({
        public_key: newer.public_key,
        created_ms: newer.created_ms,
        max_units_per_day: 15,
        intent: "enroll",
      });
    } finally {
      controller.retire();
      primary.close?.();
      other.close?.();
    }
  },
);
