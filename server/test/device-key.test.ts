// Job 003w-e2: the customer's device use key (web/src/deviceKey.ts), exercised for real:
// - the REAL IndexedDB adapter over fake-indexeddb (a spec implementation), storing a REAL
//   non-extractable WebCrypto Ed25519 CryptoKey made by Node's WebCrypto;
// - readiness from the REAL route GET /api/customer/offers/:offer/keys of the customer test world,
//   whose entitlement is the contract-produced JSON (customer-readback.json);
// - a synthetic wallet whose install_key / revoke_key apply the contract's rules (lib.rs
//   install_key, revoke_key) to that test double, and which can lose its answer or be closed;
// - the real prepare -> client check -> device signature -> confirm -> open_hold path, and the
//   contract's own signing fixture digests.
// No real wallet, account, key, chain or network. Every key here is newly generated.

import { createPublicKey, verify } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { verifyEnvelope } from "../../web/src/customerEnvelope.ts";
import {
  classify,
  DeviceKeyError,
  type DeviceKeyStore,
  DeviceKeys,
  installCall,
  type KeysReadback,
  openDeviceKeyStore,
  recordId,
  revokeCall,
} from "../../web/src/deviceKey.ts";
import type { WalletBoundary, WalletFunctionCall } from "../../web/src/wallet.ts";
import { verifiesEd25519 } from "../src/customerSigning.ts";
import {
  BUSINESS,
  CUSTOMER,
  type CustomerWorld,
  customerWorld,
  type Json,
  SIGNING,
} from "./customer-world.ts";

const INPUT = "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

/** The customer's wallet over the test double: the contract's install/revoke rules, 1 yocto. */
function syntheticWallet(w: CustomerWorld, account = CUSTOMER) {
  const sent: WalletFunctionCall[] = [];
  const state = {
    /** "apply": land and answer; "lose": land, answer lost; "drop": neither; "close": cancelled. */
    mode: "apply" as "apply" | "lose" | "drop" | "close",
    beforeSend: null as null | (() => Promise<void> | void),
  };
  const apply = (c: WalletFunctionCall) => {
    if (c.receiverId !== BUSINESS || c.deposit !== "1") throw new Error("E_DEPOSIT");
    const e = w.chain.ent(account) as Json;
    const a = c.args as Json;
    const k = e.keys[a.slot] as Json;
    if (c.methodName === "install_key") {
      if (k.state === "active") throw new Error("E_KEY: that key slot is in use");
      if (!/^[0-9a-f]{64}$/.test(a.pk)) throw new Error("E_KEY_INVALID");
      Object.assign(k, {
        state: "active",
        epoch: k.epoch + 1,
        public_key: a.pk,
        max_hold_units: a.max_hold_units,
        max_units_per_day: a.max_units_per_day,
      });
    } else if (c.methodName === "revoke_key") {
      if (k.state !== "active") throw new Error("E_KEY: that key is not active");
      Object.assign(k, { state: "revoked", epoch: k.epoch + 1 });
    } else throw new Error("unexpected method");
    e.key_states = e.keys.map(
      (x: Json) => ({ empty: 0, active: 1, revoked: 2 })[x.state as string],
    );
    e.key_epochs = e.keys.map((x: Json) => x.epoch);
  };
  const wallet: WalletBoundary = {
    label: "synthetic wallet (test)",
    synthetic: true,
    signMessage: async () => {
      throw new Error("not used here");
    },
    connect: async () => account,
    accounts: async () => [account],
    send: async (c) => {
      sent.push(c);
      await state.beforeSend?.();
      if (state.mode === "close") throw new Error("User closed the window");
      if (state.mode === "drop") throw new Error("Failed to fetch");
      apply(c);
      if (state.mode === "lose") throw new Error("Failed to fetch");
    },
    disconnect: async () => {},
    onChange: () => () => {},
  };
  return { wallet, sent, state, apply };
}

async function world(opts: { idb?: IDBFactory } = {}) {
  const w = await customerWorld();
  const offer = await w.offer();
  const idb = opts.idb ?? new IDBFactory();
  const reads: number[] = [];
  const read = async (offerId: string) => {
    const r = await w.cara(`/api/customer/offers/${offerId}/keys`);
    reads.push(r.status);
    if (r.status !== 200) throw new Error(r.body.error);
    return r.body as KeysReadback;
  };
  const wal = syntheticWallet(w);
  let generated = 0;
  const subtle = new Proxy(globalThis.crypto.subtle, {
    get(t, p) {
      const v = Reflect.get(t, p, t);
      if (p === "generateKey")
        return (...a: Parameters<SubtleCrypto["generateKey"]>) => {
          generated++;
          return (v as SubtleCrypto["generateKey"]).apply(t, a);
        };
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const keys = (store = () => openDeviceKeyStore(idb)) =>
    new DeviceKeys({
      store,
      read,
      wallet: () => Promise.resolve(wal.wallet),
      account: CUSTOMER,
      subtle,
    });
  return { w, offer, idb, read, reads, wal, keys, generated: () => generated };
}

describe("003w-e2 the route and the readiness rules", () => {
  it("the keys route reads the caller's own slots fresh: public keys only", async () => {
    const { w, offer, read } = await world();
    const rb = await read(offer);
    expect(rb).toMatchObject({
      contract: BUSINESS,
      plan_id: 1,
      customer: CUSTOMER,
      registered: true,
      active: true,
    });
    expect(rb.keys.map((k) => k.state)).toEqual(["active", "empty", "empty", "empty"]);
    expect(JSON.stringify(rb)).not.toMatch(/private|secret/i);
    const stranger = w.person("Nobody Linked");
    expect((await stranger(`/api/customer/offers/${offer}/keys`)).body.code).toBe(
      "no_chain_account",
    );
  });

  it("the exact wallet requests: install_key and revoke_key, 1 yoctoNEAR, every field explicit", () => {
    const r = {
      contract: BUSINESS,
      plan_id: 1,
      slot: 2,
      public_key: "ab".repeat(32),
      max_hold_units: 1,
      max_units_per_day: 10,
    } as Parameters<typeof installCall>[0];
    expect(installCall(r)).toEqual({
      receiverId: BUSINESS,
      methodName: "install_key",
      args: { plan_id: 1, slot: 2, pk: "ab".repeat(32), max_hold_units: 1, max_units_per_day: 10 },
      gas: "30000000000000",
      deposit: "1",
    });
    expect(revokeCall(BUSINESS, 1, 2)).toEqual({
      receiverId: BUSINESS,
      methodName: "revoke_key",
      args: { plan_id: 1, slot: 2 },
      gas: "30000000000000",
      deposit: "1",
    });
  });
});

describe("003w-e2 enrolling this device", () => {
  it("one non-extractable key, stored with its intent BEFORE the wallet is asked; ready only from the readback", async () => {
    const t = await world();
    const k = t.keys();
    expect((await k.status(t.offer)).readiness).toEqual({ kind: "elsewhere", slots: [0] });
    let storedFirst: unknown = null;
    t.wal.state.beforeSend = async () => {
      const s = await openDeviceKeyStore(t.idb);
      storedFirst = await s.get(recordId("testnet", BUSINESS, 1, CUSTOMER));
    };
    const out = await k.enroll(t.offer, 10);
    expect(storedFirst).toMatchObject({
      slot: 1,
      intent: "enroll",
      max_hold_units: 1,
      max_units_per_day: 10,
    });
    expect(out).toMatchObject({ kind: "done", readiness: { kind: "ready", slot: 1, epoch: 1 } });
    const rec = (await (
      await openDeviceKeyStore(t.idb)
    ).get(recordId("testnet", BUSINESS, 1, CUSTOMER))) as NonNullable<
      Awaited<ReturnType<DeviceKeyStore["get"]>>
    >;
    expect(rec.key.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey("pkcs8", rec.key)).rejects.toThrow();
    expect(t.wal.sent).toEqual([installCall(rec)]);
    expect(t.generated()).toBe(1);
  });

  it("a lost wallet answer: the readback decides (landed: ready), with no second request", async () => {
    const t = await world();
    t.wal.state.mode = "lose";
    expect(await t.keys().enroll(t.offer, 10)).toMatchObject({
      kind: "done",
      readiness: { kind: "ready" },
    });
    expect(t.wal.sent).toHaveLength(1);
  });

  it("an unanswered enrollment that didn't land: retried with the SAME key, never a replacement", async () => {
    const t = await world();
    t.wal.state.mode = "drop";
    const first = await t.keys().enroll(t.offer, 10);
    expect(first).toMatchObject({ kind: "not_confirmed", readiness: { kind: "pending", slot: 1 } });
    // A reload: a new controller over the same storage.
    t.wal.state.mode = "apply";
    const again = await t.keys().enroll(t.offer, 10);
    expect(again).toMatchObject({ kind: "done", readiness: { kind: "ready", slot: 1 } });
    expect(t.wal.sent.map((c) => c.args.pk)).toEqual([
      first.kind === "not_confirmed" && first.readiness.kind === "pending"
        ? first.readiness.public_key
        : "?",
      t.wal.sent[0]?.args.pk,
    ]);
    expect(t.generated()).toBe(1);
  });

  it("closing the wallet changes nothing; the stored key stays for the next try", async () => {
    const t = await world();
    t.wal.state.mode = "close";
    expect(await t.keys().enroll(t.offer, 10)).toMatchObject({
      kind: "cancelled",
      readiness: { kind: "pending" },
    });
    expect((t.w.chain.ent(CUSTOMER) as Json).keys[1].state).toBe("empty");
  });

  it("if its slot was taken meanwhile (another device), the SAME key goes to a free slot", async () => {
    const t = await world();
    t.wal.state.mode = "drop";
    const pending = await t.keys().enroll(t.offer, 10);
    const pk =
      pending.kind === "not_confirmed" && pending.readiness.kind === "pending"
        ? pending.readiness.public_key
        : "";
    t.wal.apply({
      ...installCall({
        contract: BUSINESS,
        plan_id: 1,
        slot: 1,
        public_key: "cd".repeat(32),
        max_hold_units: 1,
        max_units_per_day: 5,
      } as never),
    });
    t.wal.state.mode = "apply";
    expect(await t.keys().enroll(t.offer, 10)).toMatchObject({
      kind: "done",
      readiness: { kind: "ready", slot: 2, public_key: pk },
    });
    expect(t.generated()).toBe(1);
  });

  it("a wallet signed into another account is refused before anything is sent", async () => {
    const t = await world();
    const other = syntheticWallet(t.w, "mallory.near");
    const k = new DeviceKeys({
      store: () => openDeviceKeyStore(t.idb),
      read: t.read,
      wallet: () => Promise.resolve(other.wallet),
      account: CUSTOMER,
    });
    const out = await k.enroll(t.offer, 10);
    expect(out).toMatchObject({ kind: "refused" });
    expect(out.kind === "refused" && out.message).toContain("mallory.near");
    expect(other.sent).toEqual([]);
  });

  it("an answer after the account changed (retired) lands nowhere", async () => {
    const t = await world();
    const k = t.keys();
    t.wal.state.beforeSend = () => k.retire();
    expect(await k.enroll(t.offer, 10)).toEqual({ kind: "stale" });
  });

  it("storage unavailable or refused, and no Ed25519: said plainly, nothing generated or sent", async () => {
    await expect(openDeviceKeyStore(undefined)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    const refusing = {
      open: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as IDBFactory;
    await expect(openDeviceKeyStore(refusing)).rejects.toBeInstanceOf(DeviceKeyError);
    const t = await world();
    const noEd = {
      ...globalThis.crypto.subtle,
      generateKey: async () => {
        throw new DOMException("no", "NotSupportedError");
      },
    } as unknown as SubtleCrypto;
    const k = new DeviceKeys({
      store: () => openDeviceKeyStore(t.idb),
      read: t.read,
      wallet: () => Promise.resolve(t.wal.wallet),
      account: CUSTOMER,
      subtle: noEd,
    });
    await expect(k.enroll(t.offer, 10)).rejects.toMatchObject({ code: "unsupported" });
    expect(t.wal.sent).toEqual([]);
  });
});

describe("003w-e2 authorizing one exact request with the device key", () => {
  it("prepare -> the client's own check -> device signature -> confirm -> open_hold, in the enrolled slot", async () => {
    const t = await world();
    const k = t.keys();
    const done = await k.enroll(t.offer, 10);
    if (done.kind !== "done" || done.readiness.kind !== "ready") throw new Error("not ready");
    const a = k.authorizer(t.offer, done.readiness);
    const r = await t.w.cara(`/api/customer/offers/${t.offer}/prepare`, "POST", {
      idempotency_key: "device-use-0001",
      input: INPUT,
      key_slot: a.slot,
    });
    expect(r.status).toBe(201);
    const env = r.body.use.envelope as Json;
    expect([env.key_slot, env.key_epoch, env.public_key]).toEqual([
      1,
      1,
      done.readiness.public_key,
    ]);
    const terms = r.body.use.offer.terms as Json;
    const check = await verifyEnvelope(env as never, {
      input: INPUT,
      offerId: t.offer,
      network: terms.network,
      contract: terms.contract,
      unitPrice: terms.unit_price,
      asset: terms.asset,
      retentionDays: terms.retention_days,
      publicKey: await a.publicKey(),
      now: Number(t.w.clock.now),
    });
    expect(check).toEqual({ ok: true });
    const s = await a.sign({
      hold_message_hex: env.hold.message_hex,
      use_message_hex: env.use.message_hex,
    });
    const c = await t.w.cara(`/api/customer/uses/${r.body.use.id}/confirm`, "POST", {
      envelope_digest: env.envelope_digest,
      ...s,
    });
    expect(c.status).toBe(200);
    expect(t.w.chain.opened).toBe(1);
  });

  it("signs the contract fixture's own 32-byte digests; the server's verifier accepts them", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pk = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("hex");
    for (const msg of [SIGNING.hold.message_hex, SIGNING.use.message_hex] as string[]) {
      const sig = Buffer.from(
        await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, Buffer.from(msg, "hex")),
      ).toString("hex");
      expect(verifiesEd25519(pk, msg, sig)).toBe(true);
      // A signature over the hex TEXT (or a NEP-413 wrapper) is not one over the digest.
      const wrong = Buffer.from(
        await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, Buffer.from(msg)),
      ).toString("hex");
      expect(verifiesEd25519(pk, msg, wrong)).toBe(false);
      const spki = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(pk, "hex"),
        ]),
        format: "der",
        type: "spki",
      });
      expect(verify(null, Buffer.from(msg, "hex"), spki, Buffer.from(sig, "hex"))).toBe(true);
    }
  });

  it("a changed key or epoch (revoked and reinstalled elsewhere) refuses to sign", async () => {
    const t = await world();
    const k = t.keys();
    const done = await k.enroll(t.offer, 10);
    if (done.kind !== "done" || done.readiness.kind !== "ready") throw new Error("not ready");
    const a = k.authorizer(t.offer, done.readiness);
    t.wal.apply(revokeCall(BUSINESS, 1, 1));
    t.wal.apply(
      installCall({
        contract: BUSINESS,
        plan_id: 1,
        slot: 1,
        public_key: "cd".repeat(32),
        max_hold_units: 1,
        max_units_per_day: 5,
      } as never),
    );
    await expect(
      a.sign({ hold_message_hex: "00".repeat(32), use_message_hex: "00".repeat(32) }),
    ).rejects.toThrow(/changed/);
  });
});

describe("003w-e2 revocation, removal and lost storage", () => {
  it("revoking this device: deleted locally only once the readback shows it revoked", async () => {
    const t = await world();
    const k = t.keys();
    const done = await k.enroll(t.offer, 10);
    if (done.kind !== "done" || done.readiness.kind !== "ready") throw new Error("not ready");
    t.wal.state.mode = "drop";
    expect(await k.revoke(t.offer, 1)).toMatchObject({
      kind: "not_confirmed",
      readiness: { kind: "ready" },
    });
    t.wal.state.mode = "apply";
    expect(await k.revoke(t.offer, 1)).toMatchObject({
      kind: "done",
      readiness: { kind: "elsewhere", slots: [0] },
    });
    expect(
      await (await openDeviceKeyStore(t.idb)).get(recordId("testnet", BUSINESS, 1, CUSTOMER)),
    ).toBeNull();
  });

  it("lost device storage: the slot shows as held elsewhere and is revoked from the account alone", async () => {
    const t = await world();
    await t.keys().enroll(t.offer, 10);
    const fresh = new IDBFactory(); // the browser's storage was cleared
    const k = t.keys(() => openDeviceKeyStore(fresh));
    expect((await k.status(t.offer)).readiness).toEqual({ kind: "elsewhere", slots: [0, 1] });
    expect(await k.revoke(t.offer, 1)).toMatchObject({
      kind: "done",
      readiness: { kind: "elsewhere", slots: [0] },
    });
  });

  it("forgetting the key locally says the slot stays active until revoked", async () => {
    const t = await world();
    const k = t.keys();
    await k.enroll(t.offer, 10);
    expect(await k.forget(t.offer)).toEqual({ kind: "elsewhere", slots: [0, 1] });
  });

  it("classify: no units yet means the fresh-customer steps come first", () => {
    const rb = { registered: false, active: false, keys: [] } as unknown as KeysReadback;
    expect(classify(null, rb)).toEqual({ kind: "no_entitlement" });
  });
});
