// Job 003n1: execution freshness, post-await retention, private diagnostics, delivery versus
// validation, input/result cleanup. Reproductions of Astra's three findings at 461dfa3 first.
// Real app; the chain is the labelled fixture double, the extractor the scripted double, the
// protection the labelled synthetic seam. Every producer is finite.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProtectedContext } from "../src/customerUse.ts";
import { openDb } from "../src/db.ts";
import { RuntimeFailure } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import {
  type CustomerWorld,
  customerWorld,
  type Json,
  SyntheticProtection,
} from "./customer-world.ts";
import { INVOICE_SPEC } from "./runtime-world.ts";

const PROBE_INPUT = "Fictional invoice 412 USD";
const DAY = 86_400_000;

async function reservedWith(w: CustomerWorld, input = PROBE_INPUT, key = "astra-exec-0001") {
  const offer = await w.offer();
  const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: key,
    input,
  });
  expect(p.status).toBe(201);
  const c = await w.cara(
    `/api/customer/uses/${p.body.use.id}/confirm`,
    "POST",
    w.signed(p.body.use.envelope),
  );
  expect(c.body.use.state).toBe("reserved");
  return p.body.use.id as string;
}

async function world(extra: Parameters<typeof customerWorld>[0] = {}) {
  const protection = new SyntheticProtection();
  const w = await customerWorld({ ...extra, customer: { protection, ...extra.customer } });
  return { w, protection };
}

const rows = (w: CustomerWorld, sql: string, ...a: string[]) =>
  w.state.store.db.prepare(sql).all(...a) as Json[];

describe("003n1 reproductions (Astra, 461dfa3)", () => {
  it("1: the same final block a day later is not fresh: no provider call", async () => {
    const { w } = await world();
    const id = await reservedWith(w);
    const calls = w.provider.calls.length;
    w.clock.now += DAY;
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect([r.status, r.body.code]).toEqual([503, "evidence_too_old"]);
    expect(w.provider.calls.length).toBe(calls);
    expect(
      rows(w, "SELECT * FROM runtime_invocations WHERE purpose = 'customer_use'"),
    ).toHaveLength(0);
  });

  it("2: a result loaded across its retention deadline is not returned", async () => {
    const { w, protection } = await world();
    const id = await reservedWith(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const load = protection.load.bind(protection);
    protection.load = async (ref: string, ctx: ProtectedContext) => {
      const bytes = await load(ref, ctx);
      w.clock.now += 366 * DAY; // the deadline passes while the load is awaited
      return bytes;
    };
    const r = await w.cara(`/api/customer/uses/${id}/result`);
    expect([r.status, r.body.code]).toEqual([409, "result_expired"]);
    expect(JSON.stringify(r.body)).not.toContain("not_a_document");
  });

  it("3: a provider failure's text never reaches the business's records", async () => {
    const { w } = await world();
    const id = await reservedWith(w);
    w.provider.script = async () => {
      throw new RuntimeFailure("PROBE_PRIVATE_CUSTOMER_DOCUMENT_412", "provider_error", null);
    };
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(r.body.use.execution).toMatchObject({ state: "unknown", failure: "provider_error" });
    const dump = JSON.stringify([
      rows(w, "SELECT * FROM runtime_invocations WHERE purpose = 'customer_use'"),
      rows(w, "SELECT * FROM runtime_usage"),
      rows(w, "SELECT * FROM customer_request_events"),
      rows(w, "SELECT * FROM customer_executions"),
      r.body,
    ]);
    expect(dump).not.toContain("PROBE_PRIVATE");
    // The class and the exact cost state stay useful.
    const inv = rows(
      w,
      "SELECT * FROM runtime_invocations WHERE purpose = 'customer_use'",
    )[0] as Json;
    expect(inv).toMatchObject({ failure_class: "provider_error", usage_state: "unknown" });
    expect(inv.failure_detail).toMatch(/^The AI provider/);
  });
});

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const customerRows = (w: CustomerWorld) =>
  rows(w, "SELECT * FROM runtime_invocations WHERE purpose = 'customer_use'");

describe("003n1 admission freshness and the deadline at dispatch", () => {
  it("a block ahead of the local clock beyond the skew fails closed", async () => {
    const { w } = await world();
    const id = await reservedWith(w);
    const calls = w.provider.calls.length;
    w.clock.now -= 60_000; // the local clock is a minute behind NEAR's
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect([r.status, r.body.code]).toEqual([503, "clock_uncertain"]);
    expect(w.provider.calls.length).toBe(calls);
  });

  it("an old block also can't prepare: deadlines would be computed from stale time", async () => {
    const { w } = await world();
    const offer = await w.offer();
    w.clock.now += 200_000;
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "fresh-key-0001",
      input: PROBE_INPUT,
    });
    expect([p.status, p.body.code]).toEqual([503, "evidence_too_old"]);
  });

  it("the time left counts from the later of the two clocks, and is checked at dispatch", async () => {
    const { w } = await world();
    const id = await reservedWith(w);
    const calls = w.provider.calls.length;
    // Block time leaves ~199 s; the local clock, 90 s later, leaves ~109 s: below 60 + 60 s.
    w.chain.tick(400_000n);
    w.clock.now = Number(w.chain.ts) + 90_000;
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect([r.status, r.body.code]).toEqual([409, "not_enough_time"]);
    // Time passing during the read is counted at the dispatch itself.
    const v = await world();
    const vid = await reservedWith(v.w);
    // At the read the block leaves ~219 s; 100 s pass during it (still a fresh block): ~119 s.
    v.w.chain.tick(380_000n);
    v.w.clock.now = Number(v.w.chain.ts);
    v.w.reader.duringRead = () => {
      v.w.clock.now += 100_000;
    };
    const s = await v.w.cara(`/api/customer/uses/${vid}/execute`, "POST", {});
    expect([s.status, s.body.code]).toEqual([409, "not_enough_time"]);
    expect(v.w.provider.calls.length).toBe(calls);
    expect(customerRows(w).length + customerRows(v.w).length).toBe(0);
  });

  it("a model change or an artifact swap during or before the dispatch refuses with zero calls", async () => {
    const { w } = await world();
    const id = await reservedWith(w);
    const calls = w.provider.calls.length;
    const model = w.provider.model;
    w.reader.duringRead = () => {
      w.provider.model = "another-model";
    };
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect([r.status, r.body.code]).toEqual([409, "release_needs_recheck"]);
    w.provider.model = model;
    // Synthetic corruption: the release re-pointed at another checked build (another digest).
    const other = await w.rw.build(w.f.ava, w.f.project, {
      ...INVOICE_SPEC,
      name: "Invoice reader 2",
    });
    w.state.store.db
      .prepare("UPDATE runtime_releases SET artifact_job = ? WHERE id = ?")
      .run(other, w.release);
    const s = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect([s.status, s.body.code]).toEqual([409, "artifact_changed"]);
    expect(w.provider.calls.length).toBe(calls);
    expect(customerRows(w)).toHaveLength(0);
  });
});

describe("003n1 retention after awaits", () => {
  it("is exact at the deadline, and a result deleted or replaced during the load isn't returned", async () => {
    const { w, protection } = await world();
    const id = await reservedWith(w, INVOICE);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const until = Number(
      rows(w, "SELECT retention_until_ms FROM customer_executions")[0]?.retention_until_ms,
    );
    w.clock.now = until - 1;
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    w.clock.now = until;
    expect((await w.cara(`/api/customer/uses/${id}/result`)).body.code).toBe("result_expired");
    w.clock.now = until - 1;
    const load = protection.load.bind(protection);
    protection.load = async (ref: string, ctx: ProtectedContext) => {
      const bytes = await load(ref, ctx);
      // Synthetic: the result is deleted while the load is awaited.
      w.state.store.db
        .prepare("UPDATE customer_executions SET result_state = 'deleted', result_ref = NULL")
        .run();
      return bytes;
    };
    const r = await w.cara(`/api/customer/uses/${id}/result`);
    expect([r.status, r.body.code]).toEqual([409, "result_expired"]);
    expect(JSON.stringify(r.body)).not.toContain("Stackline");
  });
});

describe("003n1 delivery is separate from validation", () => {
  it("a result that couldn't be protected is validated but not delivered, not eligible, and never re-run", async () => {
    const { w, protection } = await world();
    const id = await reservedWith(w, INVOICE);
    protection.failProtect = 1; // the result's protection fails
    const r = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(r.body.use.execution).toMatchObject({
      validated: true,
      delivered: false,
      fulfilled: false,
      settlement_eligible: false,
      result: "unavailable",
    });
    const calls = w.provider.calls.length;
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(w.provider.calls.length).toBe(calls);
    const ok = await world();
    const okId = await reservedWith(ok.w, INVOICE);
    const done = await ok.w.cara(`/api/customer/uses/${okId}/execute`, "POST", {});
    expect(done.body.use.execution).toMatchObject({
      validated: true,
      delivered: true,
      fulfilled: true,
      settlement_eligible: true,
    });
    // A refusal by the model is delivered (the customer may read it) but never eligible.
    const no = await world();
    const noId = await reservedWith(no.w, PROBE_INPUT);
    const refused = await no.w.cara(`/api/customer/uses/${noId}/execute`, "POST", {});
    expect(refused.body.use.execution).toMatchObject({
      validated: false,
      delivered: true,
      settlement_eligible: false,
    });
  });

  it("a crash between finishing and protecting leaves it undelivered and ineligible after restart, never re-run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "customer-deliver-"));
    const open: Store[] = [];
    let release = () => {};
    let stuck: Promise<unknown> = Promise.resolve();
    try {
      const { w, protection } = await world({ dbPath: join(dir, "app.db") });
      open.push(w.state.store);
      const id = await reservedWith(w, INVOICE);
      const gate = protection.holdResults();
      release = gate.open;
      stuck = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      await gate.entered; // the record is finished; the result's protection never comes back
      const store = new Store(openDb(join(dir, "app.db")));
      open.push(store);
      w.state.store = store;
      w.state.app = w.make(store);
      const s = (await w.cara(`/api/customer/uses/${id}`)).body.use.execution;
      expect(s).toMatchObject({
        state: "completed",
        validated: true,
        delivered: false,
        settlement_eligible: false,
        // 003o1: still undecided until the delivery timeout; never delivered, never eligible.
        result: "pending",
        delivery: "pending",
      });
      const calls = w.provider.calls.length;
      await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      expect(w.provider.calls.length).toBe(calls);
    } finally {
      release();
      await stuck.catch(() => {});
      for (const s of open)
        try {
          s.db.close();
        } catch {
          // already closed
        }
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe("003n1 input and result cleanup", () => {
  it("deletes inputs that can't be needed, keeps those that can, and never claims a failed deletion", async () => {
    const { w, protection } = await world();
    // A cancelled preparation: its input can go.
    const offer = await w.offer();
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "clean-key-0001",
      input: INVOICE,
    });
    await w.cara(`/api/customer/uses/${p.body.use.id}/cancel`, "POST");
    expect(await w.service().expireInputs(5)).toEqual({ deleted: 1, failed: 0 });
    expect((await w.cara(`/api/customer/uses/${p.body.use.id}`)).body.use.input.retained).toBe(
      false,
    );
    // A reserved request that may still run keeps its input, until its serving time passes.
    const v = await world();
    const id = await reservedWith(v.w, INVOICE);
    expect(await v.w.service().expireInputs(5)).toEqual({ deleted: 0, failed: 0 });
    const serveUntil = Number(
      rows(v.w, "SELECT serve_until_ms FROM customer_requests")[0]?.serve_until_ms,
    );
    v.w.clock.now = serveUntil;
    v.protection.failDelete = 1;
    expect(await v.w.service().expireInputs(5)).toEqual({ deleted: 0, failed: 1 });
    expect(rows(v.w, "SELECT input_ref FROM customer_requests")[0]?.input_ref).not.toBeNull();
    expect(await v.w.service().expireInputs(5)).toEqual({ deleted: 1, failed: 0 });
    expect(v.protection.kept.size).toBe(0);
    // Executed and finished: nothing is ever re-run, so its input goes; the result stays.
    const x = await world();
    const xid = await reservedWith(x.w, INVOICE);
    await x.w.cara(`/api/customer/uses/${xid}/execute`, "POST", {});
    expect(await x.w.service().expireInputs(5)).toEqual({ deleted: 1, failed: 0 });
    expect(
      [...x.protection.kinds.entries()]
        .filter(([ref]) => x.protection.kept.has(ref))
        .map(([, k]) => k),
    ).toEqual(["result"]);
    expect((await x.w.cara(`/api/customer/uses/${xid}/result`)).status).toBe(200);
    expect(id).toBeTruthy();
    expect(protection.deleted).toHaveLength(1);
  });

  it("result cleanup counts failures, keeps the reference, and skips another scheme", async () => {
    const { w, protection } = await world();
    const id = await reservedWith(w, INVOICE);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    w.clock.now += 31 * DAY;
    protection.failDelete = 1;
    expect(await w.service().expireResults(5)).toEqual({ deleted: 0, failed: 1 });
    expect(rows(w, "SELECT result_state FROM customer_executions")[0]?.result_state).toBe("stored");
    w.state.store.db
      .prepare("UPDATE customer_executions SET result_scheme = 'another-scheme'")
      .run();
    expect(await w.service().expireResults(5)).toEqual({ deleted: 0, failed: 0 });
    w.state.store.db
      .prepare("UPDATE customer_executions SET result_scheme = ?")
      .run(protection.scheme);
    expect(await w.service().expireResults(5)).toEqual({ deleted: 1, failed: 0 });
    expect((await w.cara(`/api/customer/uses/${id}/result`)).body.code).toBe("result_expired");
  });
});

describe("003n1 owner trials keep their semantics", () => {
  it("an owner trial's failure keeps the provider's explanation for the owner", async () => {
    const { w } = await world();
    w.provider.script = async () => {
      throw new RuntimeFailure("Owner-visible provider explanation", "provider_error", null);
    };
    const r = await w.owner(`/api/product-projects/${w.f.project}/runtime/invocations`, "POST", {
      idempotency_key: "trial-key-0001",
      release: true,
      text: "Fictional note",
    });
    expect(r.body.invocation.failure).toEqual({
      class: "provider_error",
      detail: "Owner-visible provider explanation",
    });
  });
});
