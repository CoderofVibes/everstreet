// Real DeviceKeys controller with synthetic boundaries: no real cryptographic operation,
// wallet, transaction, browser storage or network. These tests exercise asynchronous identity.
import { expect, it } from "vitest";
import {
  type DeviceKeyRecord,
  type DeviceKeyStore,
  DeviceKeys,
  type KeysReadback,
} from "../../web/src/deviceKey.ts";
import type { WalletBoundary, WalletFunctionCall } from "../../web/src/wallet.ts";

const ACCOUNT = "fictional-customer.testnet";
const PUBLIC = "11".repeat(32);
const view = (): KeysReadback => ({
  network: "testnet",
  contract: "fictional-business.testnet",
  plan_id: 1,
  customer: ACCOUNT,
  plan_max_hold_units: 1,
  block: { height: "1", timestamp_ms: String(Date.now()) },
  registered: true,
  active: true,
  reg_id: "1",
  keys: Array.from({ length: 4 }, (_, slot) => ({
    slot,
    state: "empty",
    epoch: 0,
    public_key: "00".repeat(32),
    max_hold_units: 1,
    max_units_per_day: 10,
  })),
});

it("retiring while readiness is read prevents both device signatures", async () => {
  let finishRead: (r: KeysReadback) => void = () => {};
  const read = new Promise<KeysReadback>((resolve) => {
    finishRead = resolve;
  });
  const rb = view();
  rb.keys[0] = {
    slot: 0,
    state: "active",
    epoch: 1,
    public_key: PUBLIC,
    max_hold_units: 1,
    max_units_per_day: 10,
  };
  const record: DeviceKeyRecord = {
    id: "test-record",
    network: rb.network,
    contract: rb.contract,
    plan_id: 1,
    account: ACCOUNT,
    slot: 0,
    public_key: PUBLIC,
    key: {} as CryptoKey,
    max_hold_units: 1,
    max_units_per_day: 10,
    intent: null,
    created_ms: 0,
  };
  let signatures = 0;
  const store: DeviceKeyStore = {
    async get() {
      return record;
    },
    async put() {},
    async delete() {},
  };
  const device = new DeviceKeys({
    account: ACCOUNT,
    read: async () => read,
    store: async () => store,
    wallet: () => null,
    subtle: {
      async sign() {
        signatures++;
        return new ArrayBuffer(64);
      },
    } as unknown as SubtleCrypto,
  });
  const authorizer = device.authorizer("offer", {
    kind: "ready",
    slot: 0,
    epoch: 1,
    public_key: PUBLIC,
  });
  const pending = authorizer.sign({
    hold_message_hex: "aa".repeat(32),
    use_message_hex: "bb".repeat(32),
  });
  device.retire();
  finishRead(rb);
  await pending.catch(() => {});
  expect(signatures).toBe(0);
});

it("two controllers keep one enrollment identity rather than overwriting an outstanding key", async () => {
  const records = new Map<string, DeviceKeyRecord>();
  let firstReads = 0;
  let bothRead: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    bothRead = resolve;
  });
  const store: DeviceKeyStore = {
    async get(id) {
      if (++firstReads <= 2) {
        if (firstReads === 2) bothRead();
        await barrier;
        return null; // both tabs observed the original empty store before either generated a key
      }
      return records.get(id) ?? null;
    },
    async put(record) {
      records.set(record.id, record);
    },
    async delete(id) {
      records.delete(id);
    },
  };
  let generated = 0;
  const subtle = {
    async generateKey() {
      const n = ++generated;
      return { publicKey: { n }, privateKey: { n } };
    },
    async exportKey(_format: string, key: { n: number }) {
      return new Uint8Array(32).fill(key.n).buffer;
    },
  } as unknown as SubtleCrypto;
  const sent: WalletFunctionCall[] = [];
  const wallet: WalletBoundary = {
    label: "Synthetic",
    synthetic: true,
    async accounts() {
      return [ACCOUNT];
    },
    async connect() {
      return ACCOUNT;
    },
    async disconnect() {},
    onChange() {
      return () => {};
    },
    async signMessage() {
      throw new Error("No account proof in this test");
    },
    async send(call) {
      sent.push(call);
    },
  };
  const make = () =>
    new DeviceKeys({
      account: ACCOUNT,
      store: async () => store,
      read: async () => view(),
      wallet: async () => wallet,
      subtle,
    });
  await Promise.all([make().enroll("offer", 10), make().enroll("offer", 10)]);
  const requestedKeys = new Set(sent.map((call) => call.args.pk));
  expect(
    requestedKeys.size,
    "both requests must retain the same recoverable key identity",
  ).toBeLessThanOrEqual(1);
  for (const key of requestedKeys) expect([...records.values()][0]?.public_key).toBe(key);
});
