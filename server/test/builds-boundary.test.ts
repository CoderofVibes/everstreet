// Job 002a1: regressions for the four build-boundary failures Astra reproduced against 002a,
// and the stream concerns raised with them. Each "#n" test replays the reported sequence.
// Every provider is a scripted keyless double; nothing calls a real model.

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../src/build.ts";
import { Builds, BuildWorker, type WorkerOptions } from "../src/builds.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

type Script = (req: BuildRequest, signal: AbortSignal) => AsyncIterable<BuildEvent>;

class Scripted implements BuildProvider {
  calls = 0;
  aborted = 0;
  available = true;
  model = "scripted-model";
  prices: { inputCentsPerMillionTokens: number; outputCentsPerMillionTokens: number } | null = {
    inputCentsPerMillionTokens: 300,
    outputCentsPerMillionTokens: 1500,
  };
  constructor(
    public script: Script,
    readonly id = "original-test",
  ) {}
  identity() {
    return { id: this.id, model: this.model, version: "1" };
  }
  availability() {
    return { available: this.available, provider: this.id, reason: "Scripted test provider" };
  }
  pricing() {
    return this.prices;
  }
  start(req: BuildRequest, signal: AbortSignal) {
    this.calls++;
    signal.addEventListener("abort", () => this.aborted++, { once: true });
    return this.script(req, signal);
  }
}

const never = () => new Promise<void>(() => {});

function resolvers() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const SPEC = {
  kind: "extraction_spec",
  schema_version: 1,
  name: "Invoice reader",
  input: { kind: "document_text", max_chars: 20000 },
  fields: [
    { key: "vendor", label: "Vendor", type: "text", required: true },
    { key: "total", label: "Total", type: "number", required: true },
    { key: "due_date", label: "Due date", type: "date", required: false },
  ],
  instructions: "Read the invoice and return the fields.",
  examples: [
    {
      input: "Fictional ACME Ltd invoice, total 120.50, due 2026-12-01",
      output: { vendor: "ACME Ltd", total: 120.5, due_date: "2026-12-01" },
    },
  ],
};

// 10,000 in + 2,000 out at 300/1,500 cents per million tokens: 6 cents worst case.
const BUDGET = {
  max_input_tokens: 10_000,
  max_output_tokens: 2_000,
  max_seconds: 60,
  max_cost_cents: 10,
};

async function world(provider: Scripted, maxProgressEvents = 200) {
  const store = new Store(openDb(":memory:"));
  const clock = { t: Date.parse("2026-11-02T12:00:00.000Z") };
  const builds = new Builds(store.db, store, provider, { now: () => clock.t, maxProgressEvents });
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    buildProvider: provider,
    builds,
  });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
      });
      // biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const me = (await res.json()) as { person: { id: string } };
    return Object.assign(as(cookie), { id: me.person.id });
  };
  const ava = await join("Ava Chen");
  const p = (
    await ava("/api/product-projects", "POST", {
      idea: "Turn fictional supplier invoices into clean rows",
      foundation: "ai_api",
    })
  ).body;
  await ava(`/api/businesses/${p.project.business_id}/build-budget`, "PUT", { limit_cents: 100 });
  const request = async (key = "build-key-0001") =>
    (
      await ava(`/api/product-projects/${p.project.id}/builds`, "POST", {
        idempotency_key: key,
        revision: 1,
        budget: BUDGET,
      })
    ).body;
  const worker = (
    id: string,
    options: WorkerOptions = {},
    using: Builds = builds,
    with_ = provider,
  ) => new BuildWorker(using, with_, { id, msPerSecond: 1, ...options });
  const row = (id: string) =>
    store.db.prepare("SELECT * FROM build_jobs WHERE id = ?").get(id) as Record<string, unknown>;
  const types = (id: string) =>
    (
      store.db.prepare("SELECT type FROM build_events WHERE job_id = ? ORDER BY seq").all(id) as {
        type: string;
      }[]
    ).map((e) => e.type);
  const artifacts = () =>
    (store.db.prepare("SELECT COUNT(*) AS n FROM build_artifacts").get() as { n: number }).n;
  return {
    store,
    clock,
    builds,
    ava,
    join,
    business: p.project.business_id as string,
    request,
    worker,
    row,
    types,
    artifacts,
  };
}

describe("002a1 #1: partial usage is not a complete bill", () => {
  it("keeps the reservation when cancelled after a provisional usage report", async () => {
    const reached = resolvers();
    const provider = new Scripted(async function* () {
      yield { type: "usage", inputTokens: 100, outputTokens: 0 };
      reached.resolve();
      await never();
    });
    const w = await world(provider);
    const { job } = await w.request();
    const running = w.worker("w1").runNext();
    await reached.promise;
    await w.ava(`/api/builds/${job.id}/cancel`, "POST");
    await running;
    const done = (await w.ava(`/api/builds/${job.id}`)).body.job;
    expect(done).toMatchObject({
      state: "cancelled",
      usage_state: "partial",
      charged_microcents: 30_000,
      charged_cents: 1,
      reserved_cents: 6,
      retry_needs_ack: true,
    });
  });

  it("keeps the reservation after an error or timeout with partial usage", async () => {
    const failing = new Scripted(async function* () {
      yield { type: "usage", inputTokens: 100, outputTokens: 0 };
      throw new Error("connection reset");
    });
    const a = await world(failing);
    const ja = (await a.request()).job;
    await a.worker("w1").runNext();
    expect(a.row(ja.id)).toMatchObject({
      state: "failed",
      failure_code: "provider_error",
      reserved_cents: 6,
      usage_final: 0,
    });

    const slow = new Scripted(async function* () {
      yield { type: "usage", inputTokens: 100, outputTokens: 0 };
      await never();
    });
    const b = await world(slow);
    const jb = (await b.request()).job;
    await b.worker("w1").runNext(); // 60 budget seconds at 1 ms each
    expect(b.row(jb.id)).toMatchObject({
      state: "failed",
      failure_code: "timeout",
      reserved_cents: 6,
    });
  });

  it("does not treat a stream that ends without a final receipt as complete, even on success", async () => {
    const provider = new Scripted(async function* () {
      yield { type: "usage", inputTokens: 4000, outputTokens: 1000 };
      yield { type: "output", artifact: SPEC };
    });
    const w = await world(provider);
    const { job } = await w.request();
    await w.worker("w1").runNext();
    const done = (await w.ava(`/api/builds/${job.id}`)).body.job;
    expect(done).toMatchObject({ state: "succeeded", usage_state: "partial", reserved_cents: 6 });
  });

  it("counts duplicate final receipts once and keeps the higher figure on a mismatch", async () => {
    const provider = new Scripted(async function* () {
      yield { type: "usage_final", inputTokens: 4000, outputTokens: 1000 };
      yield { type: "usage_final", inputTokens: 4000, outputTokens: 1000 };
      yield { type: "usage_final", inputTokens: 3000, outputTokens: 1200 };
      yield { type: "usage", inputTokens: 999, outputTokens: 999 };
      yield { type: "output", artifact: SPEC };
    });
    const w = await world(provider);
    const { job } = await w.request();
    await w.worker("w1").runNext();
    const done = (await w.ava(`/api/builds/${job.id}`)).body.job;
    // max(4000, 3000) in, max(1000, 1200) out; the late delta after the receipt is ignored.
    expect(done).toMatchObject({
      state: "succeeded",
      usage_state: "final",
      input_tokens: 4000,
      output_tokens: 1200,
      charged_microcents: 4000 * 300 + 1200 * 1500,
      reserved_cents: 0,
    });
    expect(w.types(job.id)).toEqual(
      expect.arrayContaining(["usage_duplicate", "usage_mismatch", "usage_after_final"]),
    );
    const actual = w.store.db
      .prepare("SELECT SUM(cents) AS c FROM build_usage WHERE job_id = ? AND kind = 'actual'")
      .get(job.id) as { c: number };
    expect(actual.c).toBe(done.charged_cents);
  });

  it("lets a late receipt and artifact from a superseded worker change nothing", async () => {
    const gate = resolvers();
    const reached = resolvers();
    const provider = new Scripted(async function* () {
      reached.resolve();
      await gate.promise;
      yield { type: "usage_final", inputTokens: 100, outputTokens: 100 };
      yield { type: "output", artifact: SPEC };
    });
    const w = await world(provider);
    const { job } = await w.request();
    const old = w.worker("old").runNext();
    await reached.promise;
    w.clock.t += 31_000;
    w.worker("other").recover();
    gate.resolve();
    await old;
    expect(w.row(job.id)).toMatchObject({
      state: "needs_reconciliation",
      usage_final: 0,
      input_tokens: 0,
      reserved_cents: 6,
      artifact_digest: null,
    });
    expect(w.artifacts()).toBe(0);
  });
});

describe("002a1 #2: usage over the limits stops the attempt", () => {
  it("refuses a valid artifact after usage over the limits, and records the spend", async () => {
    const provider = new Scripted(async function* () {
      yield { type: "usage", inputTokens: 10_001, outputTokens: 2_001 };
      yield { type: "output", artifact: SPEC };
      yield { type: "usage_final", inputTokens: 10_001, outputTokens: 2_001 };
    });
    const w = await world(provider);
    const { job } = await w.request();
    await w.worker("w1").runNext();
    const done = (await w.ava(`/api/builds/${job.id}`)).body.job;
    expect(done).toMatchObject({
      state: "failed",
      failure: { code: "limit_exceeded" },
      charged_microcents: 10_001 * 300 + 2_001 * 1500,
      charged_cents: 7,
      usage_state: "partial",
      reserved_cents: 6,
      artifact_digest: null,
    });
    expect(provider.aborted).toBe(1);
    expect(w.artifacts()).toBe(0);
    expect(w.types(job.id)).not.toContain("output_received");
  });

  it("refuses output already received when the final receipt is over the limits", async () => {
    const provider = new Scripted(async function* () {
      yield { type: "output", artifact: SPEC };
      yield { type: "usage_final", inputTokens: 9_000, outputTokens: 2_500 };
    });
    const w = await world(provider);
    const { job } = await w.request();
    await w.worker("w1").runNext();
    expect(w.row(job.id)).toMatchObject({
      state: "failed",
      failure_code: "limit_exceeded",
      usage_final: 1,
      reserved_cents: 0,
      artifact_digest: null,
    });
    expect(w.artifacts()).toBe(0);
  });

  it("stops on usage that is not a valid token count", async () => {
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 60, "100", null]) {
      const provider = new Scripted(async function* () {
        yield { type: "usage", inputTokens: bad as number, outputTokens: 0 };
        yield { type: "output", artifact: SPEC };
      });
      const w = await world(provider);
      const { job } = await w.request();
      await w.worker("w1").runNext();
      expect(w.row(job.id), String(bad)).toMatchObject({
        state: "failed",
        failure_code: "invalid_usage",
        reserved_cents: 6,
        artifact_digest: null,
      });
    }
  });

  it("refuses providers with prices that are not whole non-negative cents", async () => {
    for (const price of [-1, 0.5, Number.POSITIVE_INFINITY, 2 ** 60]) {
      const provider = new Scripted(async function* () {});
      provider.prices = { inputCentsPerMillionTokens: price, outputCentsPerMillionTokens: 1500 };
      const w = await world(provider);
      const res = await w.request();
      expect(res.error, String(price)).toMatch(/not valid whole cents/);
      expect(provider.calls).toBe(0);
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM build_jobs").get()).toEqual({ n: 0 });
    }
  });
});

describe("002a1 #3: a job is pinned to its provider configuration", () => {
  it("does not dispatch a queued job through a differently configured provider", async () => {
    const original = new Scripted(async function* () {});
    const w = await world(original);
    const { job } = await w.request();
    const different = new Scripted(async function* () {
      yield { type: "output", artifact: SPEC };
    }, "different-test");
    const restarted = new Builds(w.store.db, w.store, different, { now: () => w.clock.t });
    await w.worker("w2", {}, restarted, different).runNext();
    expect(different.calls).toBe(0);
    expect(w.row(job.id)).toMatchObject({
      state: "failed",
      failure_code: "provider_changed",
      dispatched_at: null,
      reserved_cents: 0,
    });
  });

  it("treats a changed model or price under the same id as a different configuration", async () => {
    for (const change of ["model", "price"] as const) {
      const provider = new Scripted(async function* () {
        yield { type: "output", artifact: SPEC };
      });
      const w = await world(provider);
      const { job } = await w.request();
      if (change === "model") provider.model = "another-model";
      else provider.prices = { inputCentsPerMillionTokens: 301, outputCentsPerMillionTokens: 1500 };
      await w.worker("w1").runNext();
      expect(provider.calls, change).toBe(0);
      expect(w.row(job.id).failure_code, change).toBe("provider_changed");
      // The same request again is still the same job; a new key is a new request.
      const again = await w.ava(`/api/product-projects/${job.project_id}/builds`, "POST", {
        idempotency_key: "build-key-0001",
        revision: 1,
        budget: BUDGET,
      });
      expect(again.body).toMatchObject({ created: false, job: { id: job.id } });
    }
  });

  it("does not dispatch while the provider is unavailable", async () => {
    const provider = new Scripted(async function* () {});
    const w = await world(provider);
    const { job } = await w.request();
    provider.available = false;
    await w.worker("w1").runNext();
    expect(provider.calls).toBe(0);
    expect(w.row(job.id)).toMatchObject({
      state: "failed",
      failure_code: "provider_unavailable",
      reserved_cents: 0,
    });
  });
});

describe("002a1 #4: an expired claim has no authority", () => {
  it("does not dispatch a claim whose lease lapsed, and requeues it", async () => {
    const provider = new Scripted(async function* () {
      yield { type: "output", artifact: SPEC };
      yield { type: "usage_final", inputTokens: 10, outputTokens: 10 };
    });
    const w = await world(provider);
    const { job } = await w.request();
    const worker = w.worker("w1", { leaseMs: 30_000 });
    const claimed = worker.claim();
    expect(claimed?.job.id).toBe(job.id);
    w.clock.t += 31_000; // no recovery call in between
    await worker.run(claimed?.job as never, claimed?.attempt as number);
    expect(provider.calls).toBe(0);
    expect(w.row(job.id)).toMatchObject({ state: "queued", dispatched_at: null });
    // Run normally afterwards, exactly once.
    await w.worker("w2").runNext();
    expect(provider.calls).toBe(1);
    expect(w.row(job.id)).toMatchObject({ state: "succeeded", attempt: 2 });
  });

  it("holds work whose lease lapsed after dispatch, without any other worker's recovery", async () => {
    const gate = resolvers();
    const reached = resolvers();
    const provider = new Scripted(async function* () {
      reached.resolve();
      await gate.promise;
      yield { type: "output", artifact: SPEC };
    });
    const w = await world(provider);
    const { job } = await w.request();
    const running = w.worker("w1", { leaseMs: 30_000 }).runNext();
    await reached.promise;
    w.clock.t += 31_000;
    gate.resolve();
    await running;
    expect(w.row(job.id)).toMatchObject({
      state: "needs_reconciliation",
      failure_code: "outcome_unknown",
      artifact_digest: null,
    });
    expect(w.artifacts()).toBe(0);
  });
});

describe("002a1: quiet providers and flooding streams", () => {
  it("notices a change of owner during a silent call and fences the job", async () => {
    const reached = resolvers();
    // biome-ignore lint/correctness/useYield: a provider that never says anything
    const provider = new Scripted(async function* () {
      reached.resolve();
      await never();
    });
    const w = await world(provider);
    const ben = await w.join("Ben Okafor");
    const { job } = await w.request();
    const running = w.worker("w1", { heartbeatMs: 5 }).runNext();
    await reached.promise;
    w.store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(ben.id, w.business);
    await running;
    expect(w.row(job.id)).toMatchObject({
      state: "needs_reconciliation",
      failure_code: "ownership_changed",
    });
    expect(provider.aborted).toBe(1);
  });

  it("notices a cancel recorded by another process during a silent call", async () => {
    const reached = resolvers();
    // biome-ignore lint/correctness/useYield: a provider that never says anything
    const provider = new Scripted(async function* () {
      reached.resolve();
      await never();
    });
    const w = await world(provider);
    const { job } = await w.request();
    const running = w.worker("w1", { heartbeatMs: 5 }).runNext();
    await reached.promise;
    w.store.db
      .prepare("UPDATE build_jobs SET cancel_requested_at = ? WHERE id = ?")
      .run(new Date().toISOString(), job.id);
    await running;
    expect(w.row(job.id)).toMatchObject({ state: "cancelled", reserved_cents: 6 });
  });

  it("stops a flooding stream, bounds what it stores and keeps the usage it reported", async () => {
    const provider = new Scripted(async function* () {
      yield { type: "usage", inputTokens: 10, outputTokens: 10 };
      for (let i = 0; ; i++) {
        yield { type: "progress", message: `step ${i}` };
        yield { type: "something_else" } as unknown as BuildEvent;
      }
    });
    const w = await world(provider, 5);
    const { job } = await w.request();
    await w.worker("w1", { maxStreamEvents: 300 }).runNext();
    expect(w.row(job.id)).toMatchObject({
      state: "failed",
      failure_code: "stream_limit",
      input_tokens: 10,
      reserved_cents: 6,
    });
    const t = w.types(job.id);
    expect(t.filter((x) => x === "progress")).toHaveLength(5);
    expect(t.filter((x) => x === "ignored")).toHaveLength(5);
    expect(t.length).toBeLessThan(25);
  });

  it("lets a cancel through while a provider streams without pausing", async () => {
    const provider = new Scripted(async function* () {
      for (let i = 0; ; i++) yield { type: "progress", message: `step ${i}` };
    });
    const w = await world(provider, 5);
    const { job } = await w.request();
    const running = w.worker("w1", { maxStreamEvents: 10_000_000 }).runNext();
    setTimeout(() => {
      void w.ava(`/api/builds/${job.id}/cancel`, "POST");
    }, 5);
    await running;
    expect(w.row(job.id).state).toBe("cancelled");
  });

  it("rejects a second artifact at once and reads nothing after it", async () => {
    let readPastSecond = false;
    const provider = new Scripted(async function* () {
      yield { type: "output", artifact: SPEC };
      yield { type: "output", artifact: SPEC };
      readPastSecond = true;
      yield { type: "usage_final", inputTokens: 1, outputTokens: 1 };
    });
    const w = await world(provider);
    const { job } = await w.request();
    await w.worker("w1").runNext();
    expect(w.row(job.id)).toMatchObject({ state: "failed", failure_code: "invalid_output" });
    expect(readPastSecond).toBe(false);
    expect(w.artifacts()).toBe(0);
  });

  it("rejects an oversized artifact without keeping it", async () => {
    const provider = new Scripted(async function* () {
      yield { type: "output", artifact: "x".repeat(70 * 1024) };
    });
    const w = await world(provider);
    const { job } = await w.request();
    await w.worker("w1").runNext();
    expect(w.row(job.id)).toMatchObject({ state: "failed", failure_code: "invalid_output" });
    expect(w.types(job.id)).not.toContain("output_received");
  });
});
