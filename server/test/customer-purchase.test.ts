// Job 003web: a FRESH customer (dana.near: no entitlement, no device key, their own test tokens)
// buys 100 uses and completes one, through the real routes, over the contract-anchored double
// (purchase-world.test.ts checks it against the contract's own outcomes). Each wallet step is
// applied as the actual call by FixtureChain.walletCall, never a seeded post-state. The device
// key is newly generated here. Fictional data; no network.

import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import {
  BUSINESS,
  type CustomerWorld,
  customerWorld,
  FRESH,
  type Json,
  SyntheticProtection,
  TOKEN,
} from "./customer-world.ts";

const INPUT = "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function world(extra: Parameters<typeof customerWorld>[0] = {}) {
  const w = await customerWorld({ ...extra, customer: { protection: new SyntheticProtection() } });
  const offer = await w.offer();
  return { w, offer };
}
const sync = (w: CustomerWorld) => {
  w.clock.now = Number(w.chain.ts);
};
/** A newly generated device key: raw public hex and a signer of 32-byte digests. */
function deviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pk = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  return {
    pk,
    sign: (hex: string) => sign(null, Buffer.from(hex, "hex"), privateKey).toString("hex"),
  };
}
const setup = async (w: CustomerWorld, offer: string, units?: number, install?: Json) => {
  const q = new URLSearchParams();
  if (units !== undefined) q.set("units", String(units));
  if (install) q.set("install", JSON.stringify(install));
  const r = await w.dana(`/api/customer/offers/${offer}/purchase-setup?${q}`);
  return r;
};
/** The customer's wallet sends exactly this call; the double applies it by the contract's rules. */
const wallet = (w: CustomerWorld, call: Json, signer = FRESH) =>
  w.chain.walletCall(signer, call as never);

async function buy(w: CustomerWorld, offer: string, units: number, key: string, install?: Json) {
  const s = (await setup(w, offer, units, install)).body;
  const c = await w.dana(`/api/customer/offers/${offer}/purchases`, "POST", {
    idempotency_key: key,
    units,
    install,
    terms_digest: s.preview.terms_digest,
  });
  return { s, c };
}

describe("003web a fresh customer: shell, purchase, enrollment, one use", () => {
  it("starts with nothing; the exact shell quote and token picture are read at one block", async () => {
    const { w, offer } = await world();
    const r = await setup(w, offer, 100);
    expect(r.status).toBe(200);
    const s = r.body;
    expect(s.entitlement).toBeNull();
    expect(s.steps).toEqual(["shell"]);
    expect(s.shell.quote).toMatchObject({
      exact: true,
      bytes: String(811 + FRESH.length),
      byte_cost: "10000000000000000000",
      deposit: String(BigInt(811 + FRESH.length) * 10n ** 19n),
    });
    expect(s.shell.call).toEqual({
      receiverId: BUSINESS,
      methodName: "sponsor_shell",
      args: { customer: FRESH, plan_id: 1 },
      gas: "30000000000000",
      deposit: s.shell.quote.deposit,
    });
    expect(s.token).toMatchObject({
      symbol: "TUSD",
      decimals: 6,
      balance: "10000000",
      customer_registered: true,
      business_registered: true,
    });
    expect(s.preview).toEqual({
      code: "shell",
      problem: "Create your registration with this business first.",
    });
  });

  it("shell → buy 100 (with this device's key) → confirmed from its own transaction → one use charged", async () => {
    const { w, offer } = await world();
    const before = (await setup(w, offer)).body;
    expect(wallet(w, before.shell.call).status).toEqual({ SuccessValue: "" });
    const key = deviceKey();
    const install = { slot: 0, pk: key.pk, max_hold_units: 1, max_units_per_day: 10 };
    const { s, c } = await buy(w, offer, 100, "buy-key-0001", install);
    expect(s.preview).toMatchObject({ units: 100, amount: "5000000", purchase_seq: 1 });
    expect(s.preview.call).toMatchObject({
      receiverId: TOKEN,
      methodName: "ft_transfer_call",
      deposit: "1",
    });
    expect(c.status).toBe(201);
    const id = c.body.purchase.id as string;
    expect(c.body.purchase.state).toBe("prepared");
    await w.dana(`/api/customer/purchases/${id}/requested`, "POST", {});
    const tx = wallet(w, c.body.purchase.call);
    const done = await w.dana(`/api/customer/purchases/${id}/check`, "POST", {
      tx_hash: tx.transaction.hash,
    });
    expect(done.body.resolution).toEqual({ kind: "confirmed", units: 100, amount: "5000000" });
    expect(done.body.purchase.state).toBe("confirmed");
    const e = w.chain.ent(FRESH) as Json;
    expect([e.free, e.purchase_seq, e.keys[0].state, e.keys[0].public_key]).toEqual([
      "100",
      1,
      "active",
      key.pk,
    ]);
    expect(w.chain.balances.get(FRESH)).toBe(5_000_000n);
    // One real use with the newly enrolled key, through the existing routes.
    sync(w);
    const p = await w.dana(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "use-key-0001",
      input: INPUT,
      key_slot: 0,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const env = p.body.use.envelope as Json;
    const conf = await w.dana(`/api/customer/uses/${p.body.use.id}/confirm`, "POST", {
      envelope_digest: env.envelope_digest,
      hold_signature: key.sign(env.hold.message_hex),
      use_signature: key.sign(env.use.message_hex),
    });
    expect(conf.body.use.state).toBe("reserved");
    sync(w);
    expect((await w.dana(`/api/customer/uses/${p.body.use.id}/execute`, "POST", {})).status).toBe(
      200,
    );
    let u: Json = {};
    for (
      let i = 0;
      i < 4 && !["charged", "returned", "conflict", "unknown"].includes(u.unit);
      i++
    ) {
      sync(w);
      u = (await w.dana(`/api/customer/uses/${p.body.use.id}/units/reconcile`, "POST")).body.use
        .units;
    }
    expect(u.unit).toBe("charged");
    expect(w.chain.ent(FRESH)).toMatchObject({ free: "99", consumed: "1" });
  });

  it("purchase first, then enrollment separately: no key is added by the purchase", async () => {
    const { w, offer } = await world();
    wallet(w, (await setup(w, offer)).body.shell.call);
    const { c } = await buy(w, offer, 10, "buy-key-0002");
    const tx = wallet(w, c.body.purchase.call);
    await w.dana(`/api/customer/purchases/${c.body.purchase.id}/check`, "POST", {
      tx_hash: tx.transaction.hash,
    });
    const e = w.chain.ent(FRESH) as Json;
    expect(e.free).toBe("10");
    expect(e.keys.every((k: Json) => k.state === "empty")).toBe(true);
  });
});

describe("003web refusals and uncertainty", () => {
  const ready = async () => {
    const t = await world();
    wallet(t.w, (await setup(t.w, t.offer)).body.shell.call);
    return t;
  };

  it("not enough of the token: no preview, nothing stored", async () => {
    const { w, offer } = await ready();
    w.chain.balances.set(FRESH, 49_999n);
    const s = (await setup(w, offer, 1)).body;
    expect(s.preview).toMatchObject({ code: "funds" });
    const c = await w.dana(`/api/customer/offers/${offer}/purchases`, "POST", {
      idempotency_key: "buy-key-0003",
      units: 1,
      terms_digest: "x",
    });
    expect(c.body.code).toBe("funds");
  });

  it("caps: per purchase and outstanding, from the contract's plan", async () => {
    const { w, offer } = await ready();
    expect((await setup(w, offer, 101)).body.preview).toMatchObject({ code: "units" });
    const { c } = await buy(w, offer, 100, "buy-key-0004");
    const tx = wallet(w, c.body.purchase.call);
    await w.dana(`/api/customer/purchases/${c.body.purchase.id}/check`, "POST", {
      tx_hash: tx.transaction.hash,
    });
    w.chain.balances.set(FRESH, 10n ** 12n);
    const { c: c2 } = await buy(w, offer, 100, "buy-key-0005");
    const tx2 = wallet(w, c2.body.purchase.call);
    await w.dana(`/api/customer/purchases/${c2.body.purchase.id}/check`, "POST", {
      tx_hash: tx2.transaction.hash,
    });
    expect((await setup(w, offer, 1)).body.preview).toMatchObject({ code: "outstanding" });
  });

  it("stale terms: a review from before the sequence moved is refused with the new preview to review", async () => {
    const { w, offer } = await ready();
    const s = (await setup(w, offer, 5)).body;
    // Another device buys first (sequence 1 used).
    const other = (await setup(w, offer, 1)).body.preview.call;
    wallet(w, other);
    const c = await w.dana(`/api/customer/offers/${offer}/purchases`, "POST", {
      idempotency_key: "buy-key-0006",
      units: 5,
      terms_digest: s.preview.terms_digest,
    });
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("terms_changed");
    expect(c.body.detail.preview.purchase_seq).toBe(2);
  });

  it("a lost wallet answer: the readback never confirms; this purchase's own transaction does", async () => {
    const { w, offer } = await ready();
    const { c } = await buy(w, offer, 3, "buy-key-0007");
    const id = c.body.purchase.id as string;
    await w.dana(`/api/customer/purchases/${id}/requested`, "POST", {});
    const tx = wallet(w, c.body.purchase.call); // it landed; the wallet's answer never arrived
    const blind = await w.dana(`/api/customer/purchases/${id}/check`, "POST", {});
    expect(blind.body.resolution).toMatchObject({
      kind: "unknown",
      purchase_seq_now: 1,
      free_now: "3",
    });
    expect(blind.body.resolution.message).toMatch(/can't be shown to be this one/);
    expect(blind.body.purchase.state).toBe("unknown");
    // A used sequence can't be set aside, and no second purchase is offered while this is open.
    expect((await w.dana(`/api/customer/purchases/${id}/abandon`, "POST")).body.code).toBe(
      "purchase_requested",
    );
    expect((await setup(w, offer, 1)).body.open.id).toBe(id);
    const again = await buy(w, offer, 1, "buy-key-0008");
    expect(again.c.body.code).toBe("purchase_open");
    // The transaction hash (e.g. from the wallet's history) resolves it.
    const ok = await w.dana(`/api/customer/purchases/${id}/check`, "POST", {
      tx_hash: tx.transaction.hash,
    });
    expect(ok.body.resolution.kind).toBe("confirmed");
  });

  it("returned whole: another purchase took the sequence; this one's own transaction shows the return", async () => {
    const { w, offer } = await ready();
    const { c } = await buy(w, offer, 2, "buy-key-0009");
    wallet(w, (await setup(w, offer, 1)).body.preview.call); // another device, same sequence, first
    const balance = w.chain.balances.get(FRESH);
    const tx = wallet(w, c.body.purchase.call);
    expect(w.chain.balances.get(FRESH)).toBe(balance); // the token returned it all
    const r = await w.dana(`/api/customer/purchases/${c.body.purchase.id}/check`, "POST", {
      tx_hash: tx.transaction.hash,
    });
    expect(r.body.resolution).toEqual({
      kind: "returned",
      amount: "100000",
      reason: "purchase sequence is not the next one",
    });
  });

  it("a hash for some OTHER transaction never resolves this purchase", async () => {
    const { w, offer } = await ready();
    const { c } = await buy(w, offer, 2, "buy-key-0010");
    const unrelated = wallet(w, (await setup(w, offer, 1)).body.preview.call);
    const r = await w.dana(`/api/customer/purchases/${c.body.purchase.id}/check`, "POST", {
      tx_hash: unrelated.transaction.hash,
    });
    expect(r.body.resolution.kind).toBe("unknown");
  });

  it("a requested purchase is never set aside or replaced; only a preparation the wallet never saw is", async () => {
    const { w, offer } = await ready();
    const { c } = await buy(w, offer, 2, "buy-key-0011");
    const id = c.body.purchase.id as string;
    await w.dana(`/api/customer/purchases/${id}/requested`, "POST", {});
    const unseen = await w.dana(`/api/customer/purchases/${id}/check`, "POST", {});
    expect(unseen.body.resolution.message).toMatch(/isn't recorded yet/);
    expect((await w.dana(`/api/customer/purchases/${id}/abandon`, "POST")).body.code).toBe(
      "purchase_requested",
    );
    expect((await buy(w, offer, 2, "buy-key-0012")).c.body.code).toBe("purchase_open");
    // A fresh preparation the wallet was never asked for can be set aside.
    const t = await ready();
    const p = await buy(t.w, t.offer, 2, "buy-key-0016");
    const aside = await t.w.dana(`/api/customer/purchases/${p.c.body.purchase.id}/abandon`, "POST");
    expect(aside.body.purchase.state).toBe("set_aside");
    expect((await buy(t.w, t.offer, 2, "buy-key-0017")).c.status).toBe(201);
  });

  it("a replaced registration closes a requested purchase as not accepted (the contract refuses it)", async () => {
    const { w, offer } = await ready();
    const { c } = await buy(w, offer, 2, "buy-key-0018");
    const id = c.body.purchase.id as string;
    await w.dana(`/api/customer/purchases/${id}/requested`, "POST", {});
    // Unregistered and a new shell (as the contract test does): a new reg_id, sequence 0.
    w.chain.ents.delete(FRESH);
    wallet(w, (await setup(w, offer)).body.shell.call);
    const r = await w.dana(`/api/customer/purchases/${id}/check`, "POST", {});
    expect(r.body.resolution.kind).toBe("not_accepted");
    // ...and indeed the old request is returned by the contract if it ever executes.
    const late = wallet(w, c.body.purchase.call);
    const logs = (late.receipts_outcome as Json[]).find((x) => x.outcome.executor_id === BUSINESS)
      ?.outcome.logs;
    expect(JSON.stringify(logs)).toContain("registration changed since this purchase was prepared");
  });

  it("an older contract without get_purchase_terms: purchase unavailable (an upgrade), no quote applied", async () => {
    const { w, offer } = await ready();
    w.chain.purchaseTerms = false;
    const s = (await setup(w, offer, 1)).body;
    expect(s.terms).toBeNull();
    expect(s.steps).toContain("contract_upgrade");
    expect(s.shell.quote).toBeNull();
    expect(s.preview).toMatchObject({ code: "contract_upgrade" });
  });

  it("a returned payment whose token resolution failed is never reported as returned", async () => {
    const { w, offer } = await ready();
    const { c } = await buy(w, offer, 2, "buy-key-0019");
    wallet(w, (await setup(w, offer, 1)).body.preview.call); // takes the sequence first
    w.chain.failResolution = true;
    const tx = wallet(w, c.body.purchase.call);
    const r = await w.dana(`/api/customer/purchases/${c.body.purchase.id}/check`, "POST", {
      tx_hash: tx.transaction.hash,
    });
    expect(r.body.resolution.kind).toBe("unknown");
  });

  it("malformed token answers refuse the read; an unknown symbol or scale is never guessed", async () => {
    const { w, offer } = await ready();
    w.chain.token = { ...w.chain.token, decimals: 99 };
    expect((await setup(w, offer, 1)).body.code).toBe("token_malformed");
  });

  it("the business not registered with its token: an owner action, nothing to send", async () => {
    const { w, offer } = await ready();
    w.chain.tokenRegistered.delete(BUSINESS);
    const s = (await setup(w, offer, 1)).body;
    expect(s.steps).toContain("business_token_storage");
    expect(s.preview).toMatchObject({ code: "business_token_storage" });
  });

  it("not registered with the token: the exact storage_deposit is offered (tokens are still the customer's own)", async () => {
    const { w, offer } = await ready();
    w.chain.tokenRegistered.delete(FRESH);
    const s = (await setup(w, offer, 1)).body;
    expect(s.token_storage.call).toEqual({
      receiverId: TOKEN,
      methodName: "storage_deposit",
      args: { account_id: FRESH, registration_only: true },
      gas: "30000000000000",
      deposit: "1250000000000000000000",
    });
    wallet(w, s.token_storage.call);
    expect((await setup(w, offer, 1)).body.token.customer_registered).toBe(true);
  });
});

describe("003web concurrency, identity, restart and ownership", () => {
  it("two tabs at once: one intent is stored, the other finds it", async () => {
    const { w, offer } = await world();
    wallet(w, (await setup(w, offer)).body.shell.call);
    const s = (await setup(w, offer, 4)).body;
    const make = (k: string) =>
      w.dana(`/api/customer/offers/${offer}/purchases`, "POST", {
        idempotency_key: k,
        units: 4,
        terms_digest: s.preview.terms_digest,
      });
    const [a, b] = await Promise.all([make("tab-a-key-01"), make("tab-b-key-01")]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a.body.code, b.body.code]).toContain("purchase_open");
  });

  it("another person can't see or act on this customer's purchase", async () => {
    const { w, offer } = await world();
    wallet(w, (await setup(w, offer)).body.shell.call);
    const { c } = await buy(w, offer, 1, "buy-key-0013");
    const id = c.body.purchase.id as string;
    expect((await w.cara(`/api/customer/purchases/${id}/check`, "POST", {})).status).toBe(404);
    expect((await w.cara("/api/customer/purchases")).body.purchases).toEqual([]);
  });

  it("restart: a new process on the same records keeps the unanswered purchase and resolves it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "purchase-"));
    cleanups.push(() =>
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    );
    const { w, offer } = await world({ dbPath: join(dir, "records.db") });
    wallet(w, (await setup(w, offer)).body.shell.call);
    const { c } = await buy(w, offer, 7, "buy-key-0014");
    const tx = wallet(w, c.body.purchase.call);
    const original = w.state.store;
    cleanups.unshift(() => original.db.close());
    const store = new Store(openDb(join(dir, "records.db")));
    cleanups.unshift(() => store.db.close());
    w.state.store = store;
    w.state.app = w.make(store);
    const list = (await w.dana(`/api/customer/purchases?offer=${offer}`)).body.purchases as Json[];
    expect(list.map((p) => [p.id, p.state])).toEqual([[c.body.purchase.id, "prepared"]]);
    const r = await w.dana(`/api/customer/purchases/${c.body.purchase.id}/check`, "POST", {
      tx_hash: tx.transaction.hash,
    });
    expect(r.body.resolution.kind).toBe("confirmed");
  });

  it("after the business is sold, the same customer keeps buying and their units stay", async () => {
    const { w, offer } = await world();
    wallet(w, (await setup(w, offer)).body.shell.call);
    const { c } = await buy(w, offer, 5, "buy-key-0015");
    wallet(w, c.body.purchase.call);
    w.chain.afterSale(); // a new owner; the contract, plan and entitlement are unchanged
    const s = (await setup(w, offer, 5)).body;
    expect(s.entitlement).toMatchObject({ free: "5", purchase_seq: 1 });
    expect(s.preview).toMatchObject({ purchase_seq: 2, amount: "250000" });
  });
});
