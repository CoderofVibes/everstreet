// Job 003v: the customer lifecycle through REAL app routes with the REAL protected store
// (AES-256-GCM, a SQLite file in a temporary directory, ephemeral random test keys). Only the
// protection seam is real here: the chain is still the labelled fixture double and the extractor
// the scripted runtime double, so none of this is live NEAR or model-provider evidence. Fictional
// documents only; only these temporary artifacts are inspected. Finite.

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { CustomerUseOptions, ProtectedContext } from "../src/customerUse.ts";
import { openDb } from "../src/db.ts";
import { ProtectedStore, STORE_FILE } from "../src/protectedStore.ts";
import { Store } from "../src/store.ts";
import { type CustomerWorld, customerWorld, type Json } from "./customer-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";

const INPUT = "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const DAY = 86_400_000;

// Every cleanup runs; any failure (an unclosed handle, a directory that can't be removed) fails
// the test afterwards instead of being swallowed (Astra's review). Closers are idempotent.
const cleanups: (() => void)[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const c of cleanups.splice(0).reverse())
    try {
      c();
    } catch (e) {
      errors.push(e);
    }
  if (errors.length) throw new AggregateError(errors, "test cleanup failed");
});
const closeDb = (db: DatabaseSync) => {
  if (db.isOpen) db.close();
};
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "customer-protected-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return d;
};
const openStore = (root: string, keys: Record<string, Buffer>, active = "k1", limits = {}) => {
  const s = new ProtectedStore({ root, keys: { active, keys }, limits });
  cleanups.push(() => s.close());
  return s;
};

/** The customer world with the real store; `swap` replaces it (a restart of the adapter). */
async function realWorld(
  extra: Parameters<typeof customerWorld>[0] = {},
  limits: Record<string, number> = {},
) {
  const root = tempDir();
  const keys = { k1: randomBytes(32) };
  const customer: Partial<CustomerUseOptions> = { protection: openStore(root, keys, "k1", limits) };
  const w = await customerWorld({ ...extra, customer });
  const pristine = structuredClone(w.chain.ent() as Json);
  const store = () => customer.protection as ProtectedStore;
  const swap = (k: Record<string, Buffer>, active = "k1") => {
    store().close();
    customer.protection = openStore(root, k, active);
    w.state.app = w.make(w.state.store);
    return store();
  };
  /** Another fictional customer with its own funded entitlement (one hold at a time each). */
  const another = (name: string, account: string) => {
    const p = w.person(name);
    w.link(p.id, account);
    w.chain.ents.set(account, structuredClone(pristine));
    return p;
  };
  return { w, root, keys, store, swap, another };
}

let n = 0;
async function reserved(w: CustomerWorld, input = INPUT, who = w.cara) {
  const offer = await w.offer();
  const p = await who(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: `protected-${String(++n).padStart(4, "0")}`,
    input,
  });
  expect(p.status).toBe(201);
  const c = await who(
    `/api/customer/uses/${p.body.use.id}/confirm`,
    "POST",
    w.signed(p.body.use.envelope),
  );
  expect(c.body.use.state).toBe("reserved");
  return { id: p.body.use.id as string, offer };
}

const all = (w: CustomerWorld, sql: string, ...a: string[]) =>
  w.state.store.db.prepare(sql).all(...a) as Json[];
const objects = (root: string) => {
  const db = new DatabaseSync(join(root, STORE_FILE));
  try {
    return db
      .prepare("SELECT ref, kind, person_id, request_id, key_id FROM objects")
      .all() as Json[];
  } finally {
    db.close();
  }
};
const appDump = (w: CustomerWorld) =>
  JSON.stringify([
    all(w, "SELECT * FROM runtime_invocations WHERE purpose = 'customer_use'"),
    all(w, "SELECT * FROM customer_executions"),
    all(w, "SELECT * FROM customer_request_events"),
    all(w, "SELECT * FROM customer_requests"),
  ]);
const sync = (w: CustomerWorld) => {
  w.clock.now = Number(w.chain.ts);
};

describe("003v real protected storage through the customer routes", () => {
  it("prepare → execute → result → retention; nothing readable at rest; maintenance context from the request", async () => {
    const { w, root, keys } = await realWorld();
    const { id } = await reserved(w);
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(r.body.use.execution).toMatchObject({
      fulfilled: true,
      result: "available",
      input_source: "protected",
    });
    const got = await w.cara(`/api/customer/uses/${id}/result`);
    expect(got.status).toBe(200);
    expect(JSON.stringify(got.body.result)).toContain("Stackline Hosting Ltd");
    // At rest: the store file holds neither the document nor the key; the app holds references.
    const file = readFileSync(join(root, STORE_FILE));
    for (const needle of ["Stackline", "SH-1042", "412.50"])
      expect(file.includes(Buffer.from(needle))).toBe(false);
    expect(file.includes(keys.k1)).toBe(false);
    expect(file.includes(Buffer.from(keys.k1.toString("base64")))).toBe(false);
    expect(appDump(w)).not.toContain("Stackline");
    const objs = objects(root);
    expect(objs.map((o) => o.kind).sort()).toEqual(["input", "result"]);
    expect(new Set(objs.map((o) => o.person_id))).toEqual(new Set([w.cara.id]));
    // Retention: refused at the deadline, then deleted through the store by the batch passes.
    w.clock.now += 31 * DAY;
    expect((await w.cara(`/api/customer/uses/${id}/result`)).body.code).toBe("result_expired");
    expect(await w.service().expireResults(5)).toEqual({ deleted: 1, failed: 0 });
    expect(await w.service().expireInputs(5)).toEqual({ deleted: 1, failed: 0 });
    expect(objects(root)).toEqual([]);
    expect(await w.service().expireResults(5)).toEqual({ deleted: 0, failed: 0 }); // idempotent
    expect((await w.cara(`/api/customer/uses/${id}`)).body.use.execution.result).toBe("expired");
  });

  it("restart: the app and the store reopened with the same key serve the result; a wrong or missing key fails closed; rotation keeps it", async () => {
    const dir = tempDir();
    const { w, root, keys, swap, another } = await realWorld({ dbPath: join(dir, "app.db") });
    const dana = another("Dana Ruiz", "cdana.near");
    const original = w.state.store; // captured: the restart closes THIS handle
    cleanups.push(() => closeDb(original.db));
    const { id } = await reserved(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    // A whole restart: the original app connection is CLOSED, then a new one opens the same
    // file, and a new store instance opens the same root (swap closes the old one first).
    closeDb(original.db);
    expect(original.db.isOpen).toBe(false);
    const appStore = new Store(openDb(join(dir, "app.db")));
    cleanups.push(() => closeDb(appStore.db));
    w.state.store = appStore;
    swap({ k1: Buffer.from(keys.k1) });
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    const readiness = async () =>
      (
        (
          await w.owner(
            `/api/businesses/${w.f.business}/customer-offer-readiness?project=${w.f.project}`,
          )
        ).body.readiness.items as Json[]
      ).find((i) => i.key === "protection");
    expect((await readiness())?.state).toBe("configured");
    // The same key id with other bytes: wrong. The customer gets an honest 503, never data.
    swap({ k1: randomBytes(32) });
    const wrong = await w.cara(`/api/customer/uses/${id}/result`);
    expect([wrong.status, wrong.body.code]).toEqual([503, "result_unavailable"]);
    expect((await readiness())?.state).toBe("unavailable");
    // The key left out of the configuration: also unavailable, and nothing rewritten.
    const k2 = randomBytes(32);
    swap({ k2 }, "k2");
    expect((await w.cara(`/api/customer/uses/${id}/result`)).body.code).toBe("result_unavailable");
    // A key id, once seen, names those bytes: other bytes under "k2" are refused (no aliasing).
    swap({ k1: Buffer.from(keys.k1), k2: randomBytes(32) }, "k2");
    expect((await readiness())?.state).toBe("unavailable");
    // Rotation: k2 active for new work, k1 kept for reading the older objects.
    swap({ k1: Buffer.from(keys.k1), k2: Buffer.from(k2) }, "k2");
    expect((await readiness())?.state).toBe("configured");
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    const second = await reserved(w, `${INPUT} (second)`, dana);
    await dana(`/api/customer/uses/${second.id}/execute`, "POST", {});
    const byRequest = objects(root).map((o) => [o.request_id, o.kind, o.key_id]);
    expect(byRequest.filter((o) => o[0] === id).map((o) => o[2])).toEqual(["k1", "k1"]);
    expect(byRequest.filter((o) => o[0] === second.id).map((o) => o[2])).toEqual(["k2", "k2"]);
  });

  it("readiness discloses unreadable kept documents (missing or wrong older key) and clears on restoration", async () => {
    const { w, keys, swap } = await realWorld();
    const { id } = await reserved(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const item = async () =>
      (
        (
          await w.owner(
            `/api/businesses/${w.f.business}/customer-offer-readiness?project=${w.f.project}`,
          )
        ).body.readiness.items as Json[]
      ).find((i) => i.key === "protection") as Json;
    expect(await item()).toMatchObject({ state: "configured", next: null });
    const k2 = randomBytes(32);
    // The older key left out: new work is still protected, kept results can't be read.
    swap({ k2 }, "k2");
    const missing = await item();
    expect(missing).toMatchObject({ state: "configured" });
    expect(missing.detail).toMatch(/can't be read/);
    expect(missing.next).toMatch(/restores the older/);
    expect((await w.cara(`/api/customer/uses/${id}/result`)).body.code).toBe("result_unavailable");
    // The older key present but with other bytes, the active key valid: the same disclosure.
    swap({ k1: randomBytes(32), k2: Buffer.from(k2) }, "k2");
    const wrong = await item();
    expect(wrong.detail).toMatch(/can't be read/);
    expect(wrong.next).not.toBeNull();
    // Restored: nothing to disclose, and the result reads again.
    swap({ k1: Buffer.from(keys.k1), k2: Buffer.from(k2) }, "k2");
    expect(await item()).toMatchObject({ state: "configured", next: null });
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    // Nothing in the owner's view names a key, a key id or a reference.
    const text = JSON.stringify(await item());
    for (const secret of [keys.k1.toString("base64"), k2.toString("base64"), "k1", "k2", "ps1_"])
      expect(text).not.toContain(secret);
  });

  it("a valid reference swapped between two customers' requests is refused before plaintext", async () => {
    const { w, root, another } = await realWorld();
    const dana = another("Dana Ruiz", "cdana.near");
    const eli = another("Eli Moss", "celi.near");
    const fay = another("Fay Lund", "cfay.near");
    const a = await reserved(w, `${INPUT} A`);
    const b = await reserved(w, `${INPUT} B`, dana);
    await w.cara(`/api/customer/uses/${a.id}/execute`, "POST", {});
    await dana(`/api/customer/uses/${b.id}/execute`, "POST", {});
    const ref = (id: string) =>
      all(w, "SELECT result_ref FROM customer_executions WHERE request_id = ?", id)[0]
        ?.result_ref as string;
    const [ra, rb] = [ref(a.id), ref(b.id)];
    const set = (id: string, r: string) =>
      w.state.store.db
        .prepare("UPDATE customer_executions SET result_ref = ? WHERE request_id = ?")
        .run(r, id);
    set(a.id, rb);
    set(b.id, ra);
    for (const [id, who] of [
      [a.id, w.cara],
      [b.id, dana],
    ] as const) {
      const r = await who(`/api/customer/uses/${id}/result`);
      expect([r.status, r.body.code]).toEqual([503, "result_unavailable"]);
      expect(JSON.stringify(r.body)).not.toContain("Stackline");
    }
    // Input references swapped the same way: the protected copy is refused, nothing runs.
    const c = await reserved(w, `${INPUT} C`, eli);
    const d = await reserved(w, `${INPUT} D`, fay);
    const inRef = (id: string) =>
      all(w, "SELECT input_ref FROM customer_requests WHERE id = ?", id)[0]?.input_ref as string;
    const [ic, id_] = [inRef(c.id), inRef(d.id)];
    w.state.store.db
      .prepare("UPDATE customer_requests SET input_ref = ? WHERE id = ?")
      .run(id_, c.id);
    w.state.store.db
      .prepare("UPDATE customer_requests SET input_ref = ? WHERE id = ?")
      .run(ic, d.id);
    const calls = w.provider.calls.length;
    const x = await eli(`/api/customer/uses/${c.id}/execute`, "POST", {});
    expect([x.status, x.body.code]).toEqual([503, "input_unavailable"]);
    expect(w.provider.calls.length).toBe(calls);
    // Maintenance can't delete a swapped object either: the context comes from each request.
    set(a.id, rb); // a (due first) points at b's object
    set(b.id, rb);
    w.clock.now += 31 * DAY;
    expect(await w.service().expireResults(5)).toEqual({ deleted: 1, failed: 1 });
    const results = () => objects(root).filter((o) => o.kind === "result");
    expect(results().map((o) => o.ref)).toEqual([ra]); // b's own was deleted; a's refused
    // a's real object is referenced by nothing and can never be published: the sweep removes it.
    // The two swapped inputs are each referenced by the OTHER request: anomalies, kept.
    expect(await w.service().sweepProtected(25)).toMatchObject({ deleted: 1, anomalies: 2 });
    expect(results()).toEqual([]);
    expect(objects(root).filter((o) => o.kind === "input").length).toBeGreaterThanOrEqual(2);
  });

  it("sale: the customer reads across it; neither owner can; deletion after it uses the customer's context", async () => {
    const { w, root } = await realWorld();
    const { id } = await reserved(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const buyer = w.person("Noah Fenn");
    w.rw.transfer(w.f.business, w.f.ava.id, buyer.id);
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    expect((await buyer(`/api/customer/uses/${id}/result`)).status).toBe(404);
    expect((await w.owner(`/api/customer/uses/${id}/result`)).status).toBe(404);
    // The stored objects still name the customer, not either owner.
    expect(new Set(objects(root).map((o) => o.person_id))).toEqual(new Set([w.cara.id]));
    w.clock.now += 31 * DAY;
    expect(await w.service().deleteResult(id)).toBe("deleted");
    expect(await w.service().deleteInput(id)).toBe("deleted");
    expect(objects(root)).toEqual([]);
  });

  it("a late result copy is deleted; if that fails, the sweep removes it once its decision is final", async () => {
    const { w, root, store } = await realWorld();
    const { id } = await reserved(w);
    const s = store();
    const protect = s.protect.bind(s);
    const del = s.delete.bind(s);
    let open = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    let arrived = () => {};
    const entered = new Promise<void>((r) => {
      arrived = r;
    });
    s.protect = async (i) => {
      if (i.kind === "result") {
        arrived();
        await gate;
      }
      return protect(i);
    };
    let failDeletes = 1;
    s.delete = async (ref: string, ctx: ProtectedContext) => {
      if (failDeletes-- > 0) throw new Error("synthetic delete failure");
      return del(ref, ctx);
    };
    sync(w);
    const run = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    try {
      await entered;
      // Past the delivery timeout, recovery finalizes "not delivered".
      w.chain.tick(300_000n);
      sync(w);
      await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST");
      expect((await w.cara(`/api/customer/uses/${id}`)).body.use.execution.delivery).toBe(
        "not_delivered",
      );
    } finally {
      open();
    }
    await run;
    // The late copy was written, its deletion failed: an unreferenced result object remains.
    expect(objects(root).filter((o) => o.kind === "result")).toHaveLength(1);
    expect(all(w, "SELECT result_ref FROM customer_executions")[0]?.result_ref).toBeNull();
    const swept = await w.service().sweepProtected(25);
    expect(swept).toMatchObject({ deleted: 1, failed: 0, anomalies: 0 });
    expect(objects(root).filter((o) => o.kind === "result")).toEqual([]);
    expect(objects(root).filter((o) => o.kind === "input")).toHaveLength(1); // still referenced
  });

  it("the publication gap: an unreferenced copy stays while publishable, then goes; the published one stays", async () => {
    const { w, root, store } = await realWorld();
    const s = store();
    const protect = s.protect.bind(s);
    // The first input write lands, then the caller sees a failure (a crash before publication).
    let lose = 1;
    s.protect = async (i) => {
      const ref = await protect(i);
      if (i.kind === "input" && lose-- > 0) throw new Error("synthetic lost reply");
      return ref;
    };
    const offer = await w.offer();
    const body = { idempotency_key: "protected-gap-0001", input: INPUT };
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", body);
    expect(p.body.use.input.retained).toBe(false);
    const id = p.body.use.id as string;
    expect(objects(root)).toHaveLength(1); // stored, never published
    // While the request can still publish an input, the sweep keeps it (a slow writer is safe).
    expect(await w.service().sweepProtected(25)).toMatchObject({ deleted: 0, kept: 1 });
    // The same-key retry publishes a new copy: the first can never be published now.
    const retry = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", body);
    expect(retry.body.use.input.retained).toBe(true);
    expect(objects(root)).toHaveLength(2);
    expect(await w.service().sweepProtected(25)).toMatchObject({ deleted: 1, kept: 1 });
    const left = objects(root);
    expect(left.map((o) => o.ref)).toEqual([
      all(w, "SELECT input_ref FROM customer_requests WHERE id = ?", id)[0]?.input_ref,
    ]);
    // A cancelled request closes the window too: its stored input is then only for retention.
    expect((await w.cara(`/api/customer/uses/${id}/cancel`, "POST")).status).toBe(200);
    expect(await w.service().sweepProtected(25)).toMatchObject({ deleted: 0, kept: 1 });
    expect(await w.service().expireInputs(5)).toEqual({ deleted: 1, failed: 0 });
    expect(objects(root)).toEqual([]);
  });

  it("a failed retention deletion is counted and kept, then succeeds on retry", async () => {
    const { w, root, store } = await realWorld();
    const { id } = await reserved(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const s = store();
    const del = s.delete.bind(s);
    let fail = 1;
    s.delete = async (ref: string, ctx: ProtectedContext) => {
      if (fail-- > 0) throw new Error("synthetic delete failure");
      return del(ref, ctx);
    };
    w.clock.now += 31 * DAY;
    expect(await w.service().deleteResult(id)).toBe("failed");
    expect(all(w, "SELECT result_state FROM customer_executions")[0]?.result_state).toBe("stored");
    expect(objects(root).filter((o) => o.kind === "result")).toHaveLength(1);
    expect(await w.service().deleteResult(id)).toBe("deleted");
    expect(objects(root).filter((o) => o.kind === "result")).toEqual([]);
  });

  it("a full store fails the result's protection: not delivered, one provider call, nothing retried by storage", async () => {
    const { w } = await realWorld({}, { objects: 1 }); // room for the input only
    const { id } = await reserved(w);
    const calls = w.provider.calls.length;
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(r.body.use.execution).toMatchObject({ delivery: "not_delivered", fulfilled: false });
    const again = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(again.body.use.execution.delivery).toBe("not_delivered");
    expect(w.provider.calls.length - calls).toBe(1);
  });
});

describe("003v maintenance with the real store", () => {
  it("the supervisor's orphan phase deletes a closed-window copy and keeps referenced ones", async () => {
    const root = tempDir();
    const real = openStore(root, { k1: randomBytes(32) });
    const t = await maintenanceWorld({ customer: { protection: real } });
    const id = await t.reserve(t.w.cara, "protected-maint-0001");
    await t.execute(t.w.cara, id);
    // A copy for this request that can never be published (its input is already published).
    const stray = await real.protect({
      person_id: t.w.cara.id,
      request_id: id,
      kind: "input",
      bytes: Buffer.from("Fictional stray copy"),
    });
    expect(objects(root)).toHaveLength(3);
    const report = await t.supervisor().runPass();
    expect(report.counts["orphans:deleted"]).toBe(1);
    const left = objects(root);
    expect(left.map((o) => o.ref)).not.toContain(stray);
    // The result is retained and referenced; the finished request's published input is the input
    // phase's to delete (its 003n1 rule), not the sweep's.
    const resultRef = t.w.state.store.db
      .prepare("SELECT result_ref FROM customer_executions WHERE request_id = ?")
      .get(id) as { result_ref: string };
    expect(left.map((o) => o.ref)).toContain(resultRef.result_ref);
  });
});
