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
import { applyKeyCall } from "../../scripts/lib/walletHarness.ts";
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
  UNGUARDED_REVOKE,
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
/** Another device's revocation (the unguarded method, applied to the double), not this page's. */
const elsewhereRevoke = (slot: number): WalletFunctionCall => ({
  receiverId: BUSINESS,
  methodName: "revoke_key",
  args: { plan_id: 1, slot },
  gas: "30000000000000",
  deposit: "1",
});

/** The customer's wallet over the test double: the contract's install/revoke rules, 1 yocto. */
function syntheticWallet(w: CustomerWorld, account = CUSTOMER) {
  const sent: WalletFunctionCall[] = [];
  const state = {
    /** "apply": land and answer; "lose": land, answer lost; "drop": neither; "close": cancelled. */
    mode: "apply" as "apply" | "lose" | "drop" | "close",
    beforeSend: null as null | (() => Promise<void> | void),
  };
  // The same double as the review harness: lib.rs install_key / revoke_key rules.
  const apply = (c: WalletFunctionCall) => {
    if (c.receiverId !== BUSINESS) throw new Error("E_RECEIVER");
    applyKeyCall(w.chain.ent(account) as Json, c, {
      plan_id: 1,
      max_hold_units: Number(w.chain.plan.max_hold_units),
      now_ms: w.chain.ts,
    });
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
    // Job 003wec: the revocation names the reviewed registration, epoch and key.
    expect(
      revokeCall({
        contract: BUSINESS,
        plan_id: 1,
        slot: 2,
        reg_id: "7",
        epoch: 3,
        public_key: "ab".repeat(32),
      }),
    ).toEqual({
      receiverId: BUSINESS,
      methodName: "revoke_key_guarded",
      args: { plan_id: 1, slot: 2, reg_id: "7", epoch: 3, pk: "ab".repeat(32) },
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
    t.wal.apply(elsewhereRevoke(1));
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

describe("003w-e2 storage-level atomicity (Astra's DeviceKeyReview), over separate IndexedDB handles", () => {
  it("two tabs enrolling at once keep ONE key: the second adopts the first's stored record", async () => {
    const t = await world();
    const tab = () =>
      new DeviceKeys({
        // Each tab opens its own connection to the same browser storage.
        store: () => openDeviceKeyStore(t.idb),
        read: t.read,
        wallet: () => Promise.resolve(t.wal.wallet),
        account: CUSTOMER,
      });
    const [a, b] = await Promise.all([
      tab().prepareEnrollment(t.offer, 10),
      tab().prepareEnrollment(t.offer, 10),
    ]);
    if (a.kind !== "request" || b.kind !== "request") throw new Error("not prepared");
    expect(a.call).toEqual(b.call); // the same key and slot for both
    const stored = await (await openDeviceKeyStore(t.idb)).get(
      recordId("testnet", BUSINESS, 1, CUSTOMER),
    );
    expect(stored?.public_key).toBe(a.call.args.pk);
  });

  it("the claim itself: a second claim for the same id returns the stored winner, never overwrites", async () => {
    const idb = new IDBFactory();
    const [s1, s2] = await Promise.all([openDeviceKeyStore(idb), openDeviceKeyStore(idb)]);
    const base = {
      id: "testnet|b|1|c",
      network: "testnet",
      contract: "b",
      plan_id: 1,
      account: "c",
      slot: 1,
      max_hold_units: 1,
      max_units_per_day: 1,
      intent: null,
      created_ms: 0,
    };
    const k = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
    ])) as CryptoKeyPair;
    const won = await s1.claim?.({ ...base, public_key: "aa".repeat(32), key: k.privateKey });
    const lost = await s2.claim?.({ ...base, public_key: "bb".repeat(32), key: k.privateKey });
    expect([won?.public_key, lost?.public_key]).toEqual(["aa".repeat(32), "aa".repeat(32)]);
    // A late delete for an older key leaves a newer record alone.
    expect(await s2.deleteIf?.(base.id, "bb".repeat(32))).toBe(false);
    expect((await s1.get(base.id))?.public_key).toBe("aa".repeat(32));
    s1.close?.();
    s2.close?.();
  });

  it("the reviewed request must still be the request: a changed slot is shown again, unsent", async () => {
    const t = await world();
    const k = t.keys();
    const p = await k.prepareEnrollment(t.offer, 10);
    if (p.kind !== "request") throw new Error("not prepared");
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
    const out = await k.enroll(t.offer, 10, p.call);
    expect(out).toMatchObject({ kind: "changed", call: { args: { slot: 2, pk: p.call.args.pk } } });
    expect(t.wal.sent).toEqual([]);
  });
});

describe("003w-e2 the harness double keeps the contract's continuity rules", () => {
  it("install checks the plan and its hold limit; revoke stops an active hold's serving now", async () => {
    const t = await customerWorld();
    const e = t.chain.ent(CUSTOMER) as Json;
    const plan = {
      plan_id: 1,
      max_hold_units: Number(t.chain.plan.max_hold_units),
      now_ms: t.chain.ts,
    };
    const install = (args: Json) =>
      applyKeyCall(e, { methodName: "install_key", args, deposit: "1" }, plan);
    expect(() =>
      install({
        plan_id: 2,
        slot: 1,
        pk: "ab".repeat(32),
        max_hold_units: 1,
        max_units_per_day: 1,
      }),
    ).toThrow(/plan/);
    expect(() =>
      install({
        plan_id: 1,
        slot: 1,
        pk: "ab".repeat(32),
        max_hold_units: plan.max_hold_units + 1,
        max_units_per_day: 1,
      }),
    ).toThrow(/hold units/);
    Object.assign(e, {
      hold_active: true,
      hold_key_slot: 0,
      serve_until_ms: String(plan.now_ms + 600_000n),
    });
    applyKeyCall(
      e,
      { methodName: "revoke_key", args: { plan_id: 1, slot: 0 }, deposit: "1" },
      plan,
    );
    expect(e.serve_until_ms).toBe(String(plan.now_ms));
    expect(e.hold_active).toBe(true); // uses already signed stay settleable until settle_until
  });
});

describe("003wea revocation is reviewed first, exactly", () => {
  it("prepareRevoke shows the exact revoke_key for this device's slot; revoke sends exactly that", async () => {
    const t = await world();
    const k = t.keys();
    const done = await k.enroll(t.offer, 10);
    if (done.kind !== "done" || done.readiness.kind !== "ready") throw new Error("not ready");
    const p = await k.prepareRevoke(t.offer, done.readiness.slot);
    expect(p).toMatchObject({
      kind: "request",
      slot: 1,
      thisDevice: true,
      account: CUSTOMER,
    });
    if (p.kind !== "request") throw new Error("no request");
    expect(p.call).toEqual(revokeCall(p.observed as never));
    expect(p.call.methodName).toBe("revoke_key_guarded");
    t.wal.sent.length = 0;
    expect(await k.revoke(t.offer, 1, p)).toMatchObject({ kind: "done" });
    expect(t.wal.sent).toEqual([p.call]);
  });

  it("a lost device's slot is reviewed as NOT this device's; a request that no longer matches is shown again, unsent", async () => {
    const t = await world();
    const k = t.keys();
    const p = await k.prepareRevoke(t.offer, 0); // the fixture's key: not this device's
    expect(p).toMatchObject({ kind: "request", slot: 0, thisDevice: false });
    if (p.kind !== "request") throw new Error("no review");
    const stale = { ...p.call, args: { ...p.call.args, slot: 3 } };
    expect(await k.revoke(t.offer, 0, stale)).toMatchObject({ kind: "changed", call: p.call });
    expect(t.wal.sent).toEqual([]);
    expect(await k.prepareRevoke(t.offer, 2)).toMatchObject({ kind: "refused" }); // empty slot
  });
});

describe("003wea one offer view owns its controller and store connection", () => {
  it("disposing closes a connection that opens late, refuses later opens, and retires the controller", async () => {
    const { deviceView } = await import("../../web/src/deviceKey.ts");
    let release: (s: DeviceKeyStore) => void = () => {};
    let opens = 0;
    let closed = 0;
    const store: DeviceKeyStore = {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
      close: () => void closed++,
    };
    const view = deviceView({
      read: async () => ({
        network: "testnet",
        contract: BUSINESS,
        plan_id: 1,
        customer: CUSTOMER,
        plan_max_hold_units: 1,
        block: { height: "1", timestamp_ms: "1" },
        registered: true,
        active: true,
        reg_id: "1",
        keys: [],
      }),
      wallet: () => null,
      account: CUSTOMER,
      open: () => {
        opens++;
        return new Promise<DeviceKeyStore>((r) => {
          release = r;
        });
      },
    });
    const pending = view.keys.status("offer"); // the open is still in flight
    await new Promise((r) => setTimeout(r, 0));
    view.dispose(); // the offer or account changed
    release(store); // ...and only now does the open resolve
    await pending.catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(closed).toBe(1);
    expect(view.keys.retired).toBe(true);
    await expect(view.keys.status("offer")).rejects.toThrow(/closed/);
    expect(opens).toBe(1);
  });
});

describe("003wea a revocation review is for one key, not for a slot", () => {
  it("if another device replaces the slot's key during review, nothing is sent and the new key is shown", async () => {
    const t = await world();
    const k = t.keys();
    const p = await k.prepareRevoke(t.offer, 0);
    if (p.kind !== "request") throw new Error("no review");
    t.wal.apply(elsewhereRevoke(0));
    t.wal.apply(
      installCall({
        contract: BUSINESS,
        plan_id: 1,
        slot: 0,
        public_key: "cd".repeat(32),
        max_hold_units: 1,
        max_units_per_day: 5,
      } as never),
    );
    t.wal.sent.length = 0;
    const out = await k.revoke(t.offer, 0, p);
    expect(out).toMatchObject({
      kind: "changed",
      observed: { slot: 0, public_key: "cd".repeat(32), epoch: p.observed.epoch + 2 },
    });
    expect(t.wal.sent).toEqual([]);
    // The old review again (identical call bytes): still changed, still nothing sent.
    expect(await k.revoke(t.offer, 0, p)).toMatchObject({ kind: "changed" });
    // A bare call never says which key it was reviewed for.
    expect(await k.revoke(t.offer, 0, p.call)).toMatchObject({ kind: "changed" });
    expect(t.wal.sent).toEqual([]);
    // The NEW review (shown for key cd..): sent, exactly once.
    if (out.kind !== "changed" || !out.review) throw new Error("no fresh review");
    expect(out.review.call).not.toEqual(p.call); // the requests now differ in their bytes
    expect(await k.revoke(t.offer, 0, out.review)).toMatchObject({ kind: "done" });
    expect(t.wal.sent).toEqual([out.review.call]);
  });
});

describe("003wec guarded revocation: the reviewed key, at execution", () => {
  it("the keys readback states the capability at the same block; an older contract or another shape is not supported", async () => {
    const t = await world();
    expect((await t.read(t.offer)).guarded_revoke).toBe(true);
    t.w.chain.keyTerms = false; // an older deployed contract: no get_key_terms
    const old = await t.read(t.offer);
    expect(old.guarded_revoke).toBe(false);
    expect(old.keys.map((k) => k.state)).toEqual(["active", "empty", "empty", "empty"]); // reads still work
    t.w.chain.keyTerms = true;
    const answer = t.w.chain.answer.bind(t.w.chain);
    t.w.chain.answer = (m, a) =>
      m === "get_key_terms" ? JSON.stringify({ version: 2, guarded_revoke: true }) : answer(m, a);
    expect((await t.read(t.offer)).guarded_revoke).toBe(false);
    t.w.chain.answer = (m, a) =>
      m === "get_key_terms"
        ? JSON.stringify({ version: 1, guarded_revoke: true, extra: 1 })
        : answer(m, a);
    expect((await t.read(t.offer)).guarded_revoke).toBe(false);
  });

  it("an older contract: no review, no send, never the unguarded method (even under an earlier review)", async () => {
    const t = await world();
    const k = t.keys();
    const p = await k.prepareRevoke(t.offer, 0);
    if (p.kind !== "request") throw new Error("no review");
    t.w.chain.keyTerms = false;
    expect(await k.prepareRevoke(t.offer, 0)).toEqual({
      kind: "refused",
      message: UNGUARDED_REVOKE,
    });
    expect(await k.revoke(t.offer, 0, p)).toEqual({ kind: "refused", message: UNGUARDED_REVOKE });
    expect(t.wal.sent).toEqual([]);
    expect(t.w.chain.ent(CUSTOMER)?.keys[0]).toMatchObject({ state: "active", epoch: 1 });
  });

  it("a replacement installed while the wallet is open: the contract refuses, the replacement and its local record stay", async () => {
    const t = await world();
    const k = t.keys();
    const done = await k.enroll(t.offer, 10);
    if (done.kind !== "done" || done.readiness.kind !== "ready") throw new Error("not ready");
    const slot = done.readiness.slot;
    const p = await k.prepareRevoke(t.offer, slot);
    if (p.kind !== "request") throw new Error("no review");
    const store = await openDeviceKeyStore(t.idb);
    const id = recordId("testnet", BUSINESS, 1, CUSTOMER);
    const stored = (await store.get(id)) as NonNullable<Awaited<ReturnType<typeof store.get>>>;
    const replacement = "cd".repeat(32);
    // Between the check and the transaction: another tab of this browser re-enrolls (its own
    // record) and another device revokes the old key and installs the replacement.
    t.wal.state.beforeSend = async () => {
      await store.put({ ...stored, public_key: replacement, intent: null });
      t.wal.apply(elsewhereRevoke(slot));
      t.wal.apply(
        installCall({ ...stored, public_key: replacement, max_units_per_day: 5 } as never),
      );
    };
    t.wal.sent.length = 0;
    const out = await k.revoke(t.offer, slot, p);
    // The guarded request was sent and refused by the contract's rule; nothing else was tried.
    expect(t.wal.sent).toEqual([p.call]);
    expect(t.wal.sent.some((c) => c.methodName === "revoke_key")).toBe(false);
    expect(t.w.chain.ent(CUSTOMER)?.keys[slot]).toMatchObject({
      state: "active",
      public_key: replacement,
      epoch: p.observed.epoch + 2,
    });
    expect(out).toMatchObject({
      kind: "done",
      message: /Another key is in this slot now; it was not revoked/,
    });
    expect((await store.get(id))?.public_key).toBe(replacement); // the other tab's record stays
  });

  it("a delayed wallet answer after a replacement: still refused at execution, the replacement stays active", async () => {
    const t = await world();
    const k = t.keys();
    const p = await k.prepareRevoke(t.offer, 0);
    if (p.kind !== "request") throw new Error("no review");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    t.wal.state.beforeSend = () => gate; // the wallet window stays open
    const pending = k.revoke(t.offer, 0, p);
    await new Promise((r) => setTimeout(r, 5));
    t.wal.apply(elsewhereRevoke(0));
    t.wal.apply(
      installCall({
        contract: BUSINESS,
        plan_id: 1,
        slot: 0,
        public_key: "ef".repeat(32),
        max_hold_units: 1,
        max_units_per_day: 5,
      } as never),
    );
    release();
    const out = await pending;
    expect(t.w.chain.ent(CUSTOMER)?.keys[0]).toMatchObject({
      state: "active",
      public_key: "ef".repeat(32),
    });
    expect(out).toMatchObject({ kind: "done", message: /it was not revoked/ });
  });

  it("a lost answer is confirmed by the readback; a request that never ran stays unconfirmed and the same review completes it once", async () => {
    const t = await world();
    const k = t.keys();
    const p = await k.prepareRevoke(t.offer, 0);
    if (p.kind !== "request") throw new Error("no review");
    t.wal.state.mode = "drop"; // the wallet failed; nothing ran
    expect(await k.revoke(t.offer, 0, p)).toMatchObject({ kind: "not_confirmed" });
    expect(t.w.chain.ent(CUSTOMER)?.keys[0]).toMatchObject({ state: "active", epoch: 1 });
    t.wal.state.mode = "lose"; // it runs; the answer is lost
    expect(await k.revoke(t.offer, 0, p)).toMatchObject({
      kind: "done",
      readiness: { kind: "none" },
      message: /no longer shows the key you reviewed as active/,
    });
    expect(t.w.chain.ent(CUSTOMER)?.keys[0]).toMatchObject({ state: "revoked", epoch: 2 });
    // The same review again: the key isn't active, so nothing more is sent.
    const sent = t.wal.sent.length;
    expect(await k.revoke(t.offer, 0, p)).toMatchObject({ kind: "refused" });
    expect(t.wal.sent.length).toBe(sent);
    // At the contract, a replay of the guarded request is refused (E_KEY) and changes nothing.
    expect(() => t.wal.apply(p.call)).toThrow(/^E_KEY/);
  });
});

describe("003wec this device keeps a key that still serves a newer authorization (Astra's GuardedRevokeDesignReview)", () => {
  /** This device's key enrolled in slot 1, reviewed for revocation; the store as the page uses it. */
  async function reviewedOwnKey() {
    const t = await world();
    const k = t.keys();
    const done = await k.enroll(t.offer, 10);
    if (done.kind !== "done" || done.readiness.kind !== "ready") throw new Error("not ready");
    const p = await k.prepareRevoke(t.offer, done.readiness.slot);
    if (p.kind !== "request" || !p.thisDevice) throw new Error("no review of this device's key");
    const store = await openDeviceKeyStore(t.idb);
    const id = recordId("testnet", BUSINESS, 1, CUSTOMER);
    const record = (await store.get(id)) as NonNullable<Awaited<ReturnType<typeof store.get>>>;
    t.wal.sent.length = 0;
    return { t, k, p, store, id, record, slot: done.readiness.slot };
  }

  it("the same key reinstalled at a later epoch while the wallet is open: refused at execution, the key and its record stay usable", async () => {
    const { t, k, p, store, id, record, slot } = await reviewedOwnKey();
    t.wal.state.beforeSend = () => {
      t.wal.apply(elsewhereRevoke(slot));
      t.wal.apply(installCall(record)); // the SAME public key, epoch + 2
    };
    const out = await k.revoke(t.offer, slot, p);
    expect(t.wal.sent).toEqual([p.call]); // the guarded request only
    expect(t.w.chain.ent(CUSTOMER)?.keys[slot]).toMatchObject({
      state: "active",
      public_key: record.public_key,
      epoch: p.observed.epoch + 2,
    });
    expect(out).toMatchObject({ kind: "done", message: /this device keeps it/ });
    expect(out.kind === "done" && out.readiness).toMatchObject({
      kind: "ready",
      epoch: p.observed.epoch + 2,
    });
    const kept = await store.get(id);
    expect(kept?.public_key).toBe(record.public_key);
    expect(kept?.intent).toBeNull();
    expect((await k.status(t.offer)).readiness).toMatchObject({ kind: "ready" });
  });

  it("a new registration reusing the slot and epoch with the same key: refused, the key and its record stay", async () => {
    const { t, k, p, store, id, record, slot } = await reviewedOwnKey();
    t.wal.state.beforeSend = () => {
      // Unregister and a new shell elsewhere, with this key reinstalled: same slot, same epoch,
      // only the registration differs (as the contract's s04e shows).
      const e = t.w.chain.ent(CUSTOMER) as Json;
      e.reg_id = String(BigInt(e.reg_id) + 1n);
    };
    const out = await k.revoke(t.offer, slot, p);
    const e = t.w.chain.ent(CUSTOMER) as Json;
    expect(e.reg_id).not.toBe(p.observed.reg_id);
    expect(e.keys[slot]).toMatchObject({ state: "active", epoch: p.observed.epoch });
    expect(out).toMatchObject({ kind: "done", message: /this device keeps it/ });
    expect((await store.get(id))?.public_key).toBe(record.public_key);
  });

  it("another tab re-enrolling the same stored key meanwhile: its record is never deleted", async () => {
    const { t, k, p, store, id, record, slot } = await reviewedOwnKey();
    t.wal.state.beforeSend = async () => {
      // Another tab of this browser asks again to enroll this stored key (its intent), and the
      // old authorization is revoked elsewhere: the key is inactive, but that tab owns the record.
      await store.put({ ...record, intent: "enroll" });
      t.wal.apply(elsewhereRevoke(slot));
    };
    const out = await k.revoke(t.offer, slot, p);
    expect(out).toMatchObject({ kind: "done", message: /no longer shows the key you reviewed/ });
    expect((await store.get(id))?.intent).toBe("enroll"); // kept: not the incarnation it marked
  });

  it("the reviewed key revoked and nothing newer: the record it marked is deleted", async () => {
    const { t, k, p, store, id, slot } = await reviewedOwnKey();
    const out = await k.revoke(t.offer, slot, p);
    expect(out).toMatchObject({ kind: "done", message: /no longer shows the key you reviewed/ });
    expect(out.kind === "done" ? out.message : "").not.toMatch(/this transaction|revoked by/);
    expect(await store.get(id)).toBeNull();
    expect(t.w.chain.ent(CUSTOMER)?.keys[slot]).toMatchObject({ state: "revoked" });
  });
});

describe("003wec the capability read is bounded (Astra's KeyCapabilityTimeoutReview)", () => {
  it("is cancelled at the read deadline and settles as unsupported; the keys still come back", async () => {
    const w = await customerWorld({ customer: { readTimeoutMs: 30 } });
    const offer = await w.offer();
    const original = w.reader.view.bind(w.reader);
    let seen: AbortSignal | undefined;
    w.reader.view = async (input) => {
      if (input.method !== "get_key_terms") return original(input);
      // The double's type doesn't declare it; the server passes one.
      const signal = (input as typeof input & { signal?: AbortSignal }).signal;
      seen = signal;
      // Answers affirmatively, but only after it was cancelled: too late to count.
      await new Promise<void>((r) => signal?.addEventListener("abort", () => r()));
      return original(input);
    };
    const r = await w.cara(`/api/customer/offers/${offer}/keys`);
    expect(seen?.aborted).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ guarded_revoke: false, registered: true });
    expect(r.body.keys).toHaveLength(4);
  });
});
