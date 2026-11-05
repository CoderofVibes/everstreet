// Independent cross-handle storage review. The production IndexedDB adapter runs over
// fake-indexeddb; these are fictional records, with no cryptography, wallet or network.
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { type DeviceKeyRecord, openDeviceKeyStore } from "../../web/src/deviceKey.ts";

const record = (publicKey: string): DeviceKeyRecord => ({
  id: "testnet|fictional-business.testnet|1|fictional-customer.testnet",
  network: "testnet",
  contract: "fictional-business.testnet",
  plan_id: 1,
  account: "fictional-customer.testnet",
  slot: 0,
  public_key: publicKey,
  key: {} as CryptoKey,
  max_hold_units: 1,
  max_units_per_day: 10,
  intent: "enroll",
  created_ms: 1,
});

it("independent IndexedDB handles return the same stored winner for competing enrollments", async () => {
  const idb = new IDBFactory();
  const a = await openDeviceKeyStore(idb);
  const b = await openDeviceKeyStore(idb);
  try {
    if (!a.claim || !b.claim) throw new Error("An atomic enrollment claim is required");
    const first = record("11".repeat(32));
    const second = record("22".repeat(32));
    const [fromA, fromB] = await Promise.all([a.claim(first), b.claim(second)]);
    const stored = await b.get(first.id);
    expect(stored).not.toBeNull();
    expect(fromA.public_key).toBe(stored?.public_key);
    expect(fromB.public_key).toBe(stored?.public_key);
    expect(await a.claim(second)).toEqual(stored);
  } finally {
    a.close?.();
    b.close?.();
  }
});

it("an old handle cannot overwrite or delete a replacement key", async () => {
  const idb = new IDBFactory();
  const a = await openDeviceKeyStore(idb);
  const b = await openDeviceKeyStore(idb);
  try {
    if (!a.claim || !a.putIf || !a.deleteIf || !b.claim || !b.deleteIf)
      throw new Error("Atomic device-record operations are required");
    const old = record("11".repeat(32));
    const replacement = record("22".repeat(32));
    await a.claim(old);
    expect(await b.deleteIf(old.id, old.public_key)).toBe(true);
    await b.claim(replacement);
    expect(await a.putIf({ ...old, intent: "revoke" })).toBe(false);
    expect(await a.deleteIf(old.id, old.public_key)).toBe(false);
    expect(await b.get(old.id)).toEqual(replacement);
  } finally {
    a.close?.();
    b.close?.();
  }
});
