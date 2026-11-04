// Job 003v: the durable protected store with REAL AES-256-GCM (node:crypto) and a REAL SQLite
// file in a temporary directory. Keys are ephemeral random test keys made here; the canaries are
// fictional. Only these temporary artifacts are inspected. No configured secret, runtime
// database, provider, wallet or chain is touched.

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import type { ProtectedContext } from "../src/customerUse.ts";
import {
  PROTECTED_SCHEME,
  ProtectedStore,
  ProtectedStoreError,
  protectedStoreFromConfig,
  STORE_FILE,
} from "../src/protectedStore.ts";

const CANARY = "Fictional canary NIGHTJAR-7731 invoice from Quillfeather Supplies";
const A: ProtectedContext = { person_id: "person-cara", request_id: "cr_a1", kind: "input" };
const B: ProtectedContext = { person_id: "person-cara", request_id: "cr_b2", kind: "input" };

const dirs: string[] = [];
const stores: ProtectedStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});
const tempRoot = () => {
  const d = mkdtempSync(join(tmpdir(), "protected-store-"));
  dirs.push(d);
  return d;
};
const key = () => randomBytes(32);
const open = (
  root: string,
  keys: Record<string, Buffer>,
  active = Object.keys(keys)[0] as string,
  limits = {},
) => {
  const s = new ProtectedStore({ root, keys: { active, keys }, limits });
  stores.push(s);
  return s;
};
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof ProtectedStoreError ? e.code : `other:${(e as Error).message}`;
  }
};
const raw = (root: string) => {
  const db = new DatabaseSync(join(root, STORE_FILE));
  return db;
};
const fileBytes = (root: string) => readFileSync(join(root, STORE_FILE));

describe("003v protected store: real authenticated encryption at rest", () => {
  it("round-trips; neither the canary nor the key appears in the stored file or rows", async () => {
    const root = tempRoot();
    const k1 = key();
    const s = open(root, { k1 });
    const ref = await s.protect({ ...A, bytes: Buffer.from(CANARY) });
    expect(ref).toMatch(/^ps1_[0-9a-f]{32}$/);
    expect((await s.load(ref, A)).toString()).toBe(CANARY);
    expect(s.scheme).toBe(PROTECTED_SCHEME);
    const file = fileBytes(root);
    expect(file.includes(Buffer.from(CANARY))).toBe(false);
    expect(file.includes(Buffer.from("NIGHTJAR"))).toBe(false);
    expect(file.includes(k1)).toBe(false);
    expect(file.includes(Buffer.from(k1.toString("hex")))).toBe(false);
    expect(file.includes(Buffer.from(k1.toString("base64")))).toBe(false);
    const db = raw(root);
    const row = db.prepare("SELECT * FROM objects").get() as Record<string, unknown>;
    db.close();
    expect(row).toMatchObject({
      ref,
      kind: "input",
      person_id: A.person_id,
      request_id: A.request_id,
      key_id: "k1",
    });
    expect((row.iv as Uint8Array).length).toBe(12);
    expect((row.tag as Uint8Array).length).toBe(16);
    expect(Buffer.from(row.ct as Uint8Array).equals(Buffer.from(CANARY))).toBe(false);
  });

  it("restart with the right key recovers; a missing or wrong key fails closed", async () => {
    const root = tempRoot();
    const k1 = key();
    const first = open(root, { k1 });
    const ref = await first.protect({ ...A, bytes: Buffer.from(CANARY) });
    first.close();
    // Reopened with the same key: readable.
    const again = open(root, { k1: Buffer.from(k1) });
    expect(again.readiness()).toEqual({ ready: true, problems: [] });
    expect((await again.load(ref, A)).toString()).toBe(CANARY);
    again.close();
    // The same id, different bytes: WRONG. Nothing is decrypted or written under it.
    const wrong = open(root, { k1: key() });
    expect(wrong.readiness()).toEqual({ ready: false, problems: ["active_key_wrong"] });
    expect(await code(wrong.load(ref, A))).toBe("wrong_key");
    expect(await code(wrong.protect({ ...B, bytes: Buffer.from("x") }))).toBe("wrong_key");
    wrong.close();
    // The key removed from the configuration: its objects are unreadable, never rewritten.
    const missing = open(root, { k2: key() });
    expect(missing.readiness()).toEqual({
      ready: true,
      problems: ["key_missing_for_stored_objects"],
    });
    expect(await code(missing.load(ref, A))).toBe("key_missing");
    missing.close();
    // Back with the right key, still intact.
    const back = open(root, { k1, k2: key() });
    expect((await back.load(ref, A)).toString()).toBe(CANARY);
  });

  it("rotation: new objects use the active key; older ones stay readable under their own id, unrewritten", async () => {
    const root = tempRoot();
    const k1 = key();
    const k2 = key();
    const s1 = open(root, { k1 });
    const old = await s1.protect({ ...A, bytes: Buffer.from("old document") });
    s1.close();
    const s2 = open(root, { k1, k2 }, "k2");
    const fresh = await s2.protect({ ...B, bytes: Buffer.from("new document") });
    expect((await s2.load(old, A)).toString()).toBe("old document");
    expect((await s2.load(fresh, B)).toString()).toBe("new document");
    const db = raw(root);
    const ids = db.prepare("SELECT ref, key_id FROM objects ORDER BY created_ms, ref").all() as {
      ref: string;
      key_id: string;
    }[];
    db.close();
    expect(Object.fromEntries(ids.map((r) => [r.ref, r.key_id]))).toEqual({
      [old]: "k1",
      [fresh]: "k2",
    });
  });

  it("refuses unsafe key configuration: none, aliased, constant, wrong size, unknown active", () => {
    const root = tempRoot();
    const k = key();
    const make =
      (keys: unknown, active = "k1") =>
      () =>
        new ProtectedStore({ root, keys: { active, keys } as never });
    expect(make(undefined)).toThrow(/keys are required/);
    expect(make({ k1: k, k2: Buffer.from(k) })).toThrow(/same key/);
    expect(make({ k1: Buffer.alloc(32) })).toThrow(/placeholder/);
    expect(make({ k1: randomBytes(16) })).toThrow(/32 bytes/);
    expect(make({ k1: k }, "k9")).toThrow(/active key id/);
    expect(make({ "K 1": k }, "K 1")).toThrow(/key id is invalid/);
    expect(
      () => new ProtectedStore({ root: "relative/dir", keys: { active: "k1", keys: { k1: k } } }),
    ).toThrow(/absolute/);
    expect(
      () =>
        new ProtectedStore({
          root: join(root, "missing"),
          keys: { active: "k1", keys: { k1: k } },
        }),
    ).toThrow(/existing directory/);
  });

  it("tampered ciphertext, tag, IV or key id, and copied envelopes, fail before any plaintext", async () => {
    const root = tempRoot();
    const s = open(root, { k1: key(), k2: key() });
    const ref = await s.protect({ ...A, bytes: Buffer.from(CANARY) });
    const other = await s.protect({ ...B, bytes: Buffer.from("another fictional document") });
    const db = raw(root);
    const get = (r: string) =>
      db.prepare("SELECT iv, tag, ct, key_id FROM objects WHERE ref = ?").get(r) as {
        iv: Uint8Array;
        tag: Uint8Array;
        ct: Uint8Array;
        key_id: string;
      };
    const original = get(ref);
    const flip = (b: Uint8Array, i = 0) => {
      const c = Buffer.from(b);
      c[i] = (c[i] as number) ^ 1;
      return c;
    };
    const set = (col: string, v: unknown) =>
      db.prepare(`UPDATE objects SET ${col} = ? WHERE ref = ?`).run(v as never, ref);
    for (const [col, v] of [
      ["ct", flip(original.ct, 5)],
      ["tag", flip(original.tag)],
      ["iv", flip(original.iv)],
      ["key_id", "k2"],
    ] as const) {
      set(col, v);
      expect(await code(s.load(ref, A))).toBe("authentication_failed");
      set(
        col,
        col === "key_id"
          ? original.key_id
          : col === "ct"
            ? original.ct
            : col === "tag"
              ? original.tag
              : original.iv,
      );
    }
    expect((await s.load(ref, A)).toString()).toBe(CANARY); // restored exactly
    // Another object's whole envelope copied under this reference: the AAD names the reference.
    // (UNIQUE(key_id, iv) refuses a duplicate IV outright, so the source row is moved, not copied.)
    const o = get(other);
    db.prepare("DELETE FROM objects WHERE ref = ?").run(other);
    db.prepare("UPDATE objects SET iv = ?, tag = ?, ct = ? WHERE ref = ?").run(
      o.iv,
      o.tag,
      o.ct,
      ref,
    );
    expect(await code(s.load(ref, A))).toBe("authentication_failed");
    db.close();
  });

  it("a swapped otherwise-valid reference is refused, even if its stored context is rewritten", async () => {
    const root = tempRoot();
    const s = open(root, { k1: key() });
    const refA = await s.protect({ ...A, bytes: Buffer.from(CANARY) });
    // The caller expects request B's input (or A's result, or another person's): refused.
    expect(await code(s.load(refA, B))).toBe("context_mismatch");
    expect(await code(s.load(refA, { ...A, kind: "result" }))).toBe("context_mismatch");
    expect(await code(s.load(refA, { ...A, person_id: "person-dana" }))).toBe("context_mismatch");
    expect(await code(s.delete(refA, B))).toBe("context_mismatch");
    expect((await s.load(refA, A)).toString()).toBe(CANARY); // the refused delete removed nothing
    // Someone with database access relabels the row as B's: the AAD still names A.
    const db = raw(root);
    db.prepare("UPDATE objects SET request_id = ? WHERE ref = ?").run(B.request_id, refA);
    db.close();
    expect(await code(s.load(refA, B))).toBe("authentication_failed");
  });

  it("bounds: plaintext, object count, total bytes and reference format", async () => {
    const root = tempRoot();
    const s = open(root, { k1: key() }, "k1", { plaintextBytes: 64, objects: 2, totalBytes: 100 });
    expect(await code(s.protect({ ...A, bytes: Buffer.alloc(65, 1) }))).toBe("too_large");
    await s.protect({ ...A, bytes: Buffer.alloc(60, 1) });
    expect(await code(s.protect({ ...B, bytes: Buffer.alloc(50, 1) }))).toBe("store_full"); // bytes
    await s.protect({ ...B, bytes: Buffer.alloc(10, 1) });
    expect(await code(s.protect({ ...B, bytes: Buffer.alloc(1, 1) }))).toBe("store_full"); // count
    for (const bad of ["", "ps1_xyz", "../etc/passwd", `ps1_${"0".repeat(31)}`, "ref-1"])
      expect(await code(s.load(bad, A))).toBe("invalid");
    expect(await code(s.load(`ps1_${"0".repeat(32)}`, A))).toBe("not_found");
    expect(await code(s.protect({ ...A, request_id: "x/../y", bytes: Buffer.from("x") }))).toBe(
      "invalid",
    );
  });

  it("concurrent and repeated writes never reuse an IV or a reference", async () => {
    const root = tempRoot();
    const s = open(root, { k1: key() });
    const refs = await Promise.all(
      Array.from({ length: 200 }, () => s.protect({ ...A, bytes: Buffer.from(CANARY) })),
    );
    expect(new Set(refs).size).toBe(200);
    const db = raw(root);
    const rows = db.prepare("SELECT hex(iv) AS iv, hex(ct) AS ct FROM objects").all() as {
      iv: string;
      ct: string;
    }[];
    db.close();
    expect(new Set(rows.map((r) => r.iv)).size).toBe(200);
    expect(new Set(rows.map((r) => r.ct)).size).toBe(200); // the same plaintext, 200 ciphertexts
  });

  it("delete is idempotent and confirmed; list exposes no ciphertext; a closed store refuses", async () => {
    const root = tempRoot();
    const s = open(root, { k1: key() });
    const ref = await s.protect({ ...A, bytes: Buffer.from(CANARY) });
    const listed = await s.list(null, 10);
    expect(listed).toEqual([{ ref, ...A, created_ms: expect.any(Number) }]);
    await s.delete(ref, A);
    await s.delete(ref, A); // already gone: deleted
    expect(await code(s.load(ref, A))).toBe("not_found");
    expect(await s.list(null, 10)).toEqual([]);
    s.close();
    expect(await code(s.protect({ ...A, bytes: Buffer.from("x") }))).toBe("unavailable");
    expect(s.readiness().ready).toBe(false);
  });

  it("configuration: one supported shape; placeholders and malformed keys are refused", () => {
    const root = tempRoot();
    expect(() =>
      protectedStoreFromConfig({
        root,
        active_key_id: "k1",
        keys: { k1: "<32 random bytes, base64>" },
      }),
    ).toThrow(/base64/);
    expect(() =>
      protectedStoreFromConfig({
        root,
        active_key_id: "k1",
        keys: { k1: Buffer.alloc(32).toString("base64") },
      }),
    ).toThrow(/placeholder/);
    expect(() => protectedStoreFromConfig({ active_key_id: "k1", keys: {} })).toThrow(/root/);
    const s = protectedStoreFromConfig({
      root,
      active_key_id: "k1",
      keys: { k1: key().toString("base64") },
    });
    stores.push(s);
    expect(s.readiness().ready).toBe(true);
  });
});

/**
 * One contender on its OWN connection in a worker thread (Node strips the module's types). It
 * waits at a start barrier OUTSIDE the admission critical section, then protects; the test hook
 * holds it for `holdMs` right after its capacity read, which exposes an unserialized admission
 * without deadlocking a serialized one. Finite: bounded barrier, bounded hold, outer deadline.
 */
const CONTENDER = `
const { workerData: d, parentPort } = require("node:worker_threads");
(async () => {
  const { ProtectedStore } = await import(d.module);
  const flag = new Int32Array(d.barrier);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const store = new ProtectedStore({
    root: d.root,
    keys: { active: "k1", keys: { k1: Buffer.from(d.key, "base64") } },
    limits: d.limits,
    afterCapacityRead: () => Atomics.wait(pause, 0, 0, d.holdMs),
  });
  Atomics.add(flag, 0, 1);
  Atomics.notify(flag, 0);
  const until = Date.now() + 5000;
  while (Atomics.load(flag, 0) < 2 && Date.now() < until) Atomics.wait(flag, 0, 1, 50);
  let out;
  try {
    const ref = await store.protect({ person_id: "person-cara", request_id: "cr_" + d.i, kind: "input", bytes: Buffer.alloc(d.size, 7) });
    out = { stored: true, ref };
  } catch (e) {
    out = { stored: false, code: e && e.code ? e.code : String(e && e.message) };
  }
  store.close();
  parentPort.postMessage(out);
})().catch((e) => parentPort.postMessage({ error: String(e && e.message) }));
`;

async function contend(root: string, k: Buffer, limits: Record<string, number>, size: number) {
  const barrier = new SharedArrayBuffer(4);
  const module = pathToFileURL(join(process.cwd(), "server/src/protectedStore.ts")).href;
  const run = (i: number) =>
    new Promise<{ stored: boolean; ref?: string; code?: string; error?: string }>((resolve) => {
      const w = new Worker(CONTENDER, {
        eval: true,
        execArgv: [],
        workerData: {
          module,
          root,
          key: k.toString("base64"),
          limits,
          size,
          i,
          barrier,
          holdMs: 150,
        },
      });
      const deadline = setTimeout(() => {
        void w.terminate();
        resolve({ stored: false, error: "deadline" });
      }, 10_000);
      w.once("message", (m) => {
        clearTimeout(deadline);
        void w.terminate().then(() => resolve(m));
      });
      w.once("error", (e) => {
        clearTimeout(deadline);
        resolve({ stored: false, error: e.message });
      });
    });
  return Promise.all([run(0), run(1)]);
}

describe("003v protected store: capacity admission is atomic across connections", () => {
  for (const [name, limits] of [
    ["object count", { objects: 1, totalBytes: 1_000 }],
    ["total bytes", { objects: 10, totalBytes: 32 }],
  ] as const)
    it(`two connections admitted at once can't exceed the ${name} ceiling`, async () => {
      const root = tempRoot();
      const k1 = key();
      open(root, { k1 }).close(); // the file and its key check exist before the contenders
      const outcomes = await contend(root, k1, limits, 24);
      expect(outcomes.filter((o) => o.error)).toEqual([]);
      expect(outcomes.filter((o) => o.stored)).toHaveLength(1);
      expect(outcomes.filter((o) => !o.stored).map((o) => o.code)).toEqual(["store_full"]);
      const db = raw(root);
      const totals = db
        .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(length(ct)), 0) AS bytes FROM objects")
        .get() as { n: number; bytes: number };
      db.close();
      expect(totals).toEqual({ n: 1, bytes: 24 });
      // The winner's object is whole and readable.
      const winner = outcomes.find((o) => o.stored) as { ref: string };
      const i = outcomes.indexOf(winner as never);
      const s = open(root, { k1 });
      expect(
        (
          await s.load(winner.ref, {
            person_id: "person-cara",
            request_id: `cr_${i}`,
            kind: "input",
          })
        ).length,
      ).toBe(24);
    });
});
