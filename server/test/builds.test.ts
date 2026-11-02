// Durable build jobs (job 002a). Every provider here is a scripted test double, run against
// an in-memory database; nothing calls a real model. The tests drive the invariants:
// honest no-provider mode, idempotency, budgets reserved before dispatch, owner isolation,
// atomic claims, fencing of stale attempts, cancellation, timeout, restart before and after
// dispatch (no blind re-dispatch), output validation and ownership changes.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { canonicalJson } from "../src/artifacts.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../src/build.ts";
import { Builds, BuildWorker, redact, type WorkerOptions } from "../src/builds.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

type Script = (req: BuildRequest, signal: AbortSignal) => AsyncIterable<BuildEvent>;

class Scripted implements BuildProvider {
  calls: BuildRequest[] = [];
  aborted = 0;
  priced = true;
  available = true;
  model = "scripted-model";
  inputPrice: number = 300;
  constructor(
    public script: Script = succeed(),
    readonly id = "scripted-test",
  ) {}
  identity() {
    return { id: this.id, model: this.model, version: "1" };
  }
  availability() {
    return { available: this.available, provider: this.id, reason: "Scripted test provider" };
  }
  pricing() {
    return this.priced
      ? { inputCentsPerMillionTokens: this.inputPrice, outputCentsPerMillionTokens: 1500 }
      : null;
  }
  start(req: BuildRequest, signal: AbortSignal) {
    this.calls.push(req);
    signal.addEventListener("abort", () => this.aborted++, { once: true });
    return this.script(req, signal);
  }
}

function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { opened, open };
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

function succeed(artifact: unknown = SPEC): Script {
  return async function* () {
    yield { type: "progress", message: "Drafting the fields" };
    yield { type: "output", artifact };
    yield { type: "usage_final", inputTokens: 4000, outputTokens: 1000 };
  };
}

// 10,000 in + 2,000 out at 300/1,500 cents per million tokens: 3 + 3 = 6 cents worst case.
const BUDGET = {
  max_input_tokens: 10_000,
  max_output_tokens: 2_000,
  max_seconds: 60,
  max_cost_cents: 10,
};

function world(provider: BuildProvider | null = new Scripted(), maxProgressEvents = 200) {
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
  const worker = (id: string, options: WorkerOptions = {}) =>
    new BuildWorker(builds, provider as BuildProvider, { id, msPerSecond: 1, ...options });
  return { store, builds, clock, join, anon: as(""), worker };
}

type World = ReturnType<typeof world>;
type Actor = Awaited<ReturnType<World["join"]>>;

async function project(founder: Actor, budgetCents = 100) {
  const p = (
    await founder("/api/product-projects", "POST", {
      idea: "Turn fictional supplier invoices into clean rows",
      foundation: "ai_api",
    })
  ).body;
  await founder(`/api/businesses/${p.project.business_id}/build-budget`, "PUT", {
    limit_cents: budgetCents,
  });
  return { id: p.project.id as string, business: p.project.business_id as string };
}

const request = (founder: Actor, projectId: string, key = "build-key-0001", extra = {}) =>
  founder(`/api/product-projects/${projectId}/builds`, "POST", {
    idempotency_key: key,
    revision: 1,
    budget: BUDGET,
    ...extra,
  });

const job = (w: World, id: string) =>
  w.store.db.prepare("SELECT * FROM build_jobs WHERE id = ?").get(id) as Record<string, unknown>;
const types = (w: World, id: string) =>
  (
    w.store.db.prepare("SELECT type FROM build_events WHERE job_id = ? ORDER BY seq").all(id) as {
      type: string;
    }[]
  ).map((e) => e.type);

function transfer(w: World, businessId: string, from: string, to: string) {
  w.store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, businessId);
  w.store.db
    .prepare("INSERT INTO ownership (business_id, from_id, to_id, at) VALUES (?, ?, ?, ?)")
    .run(businessId, from, to, new Date().toISOString());
}

describe("build requests", () => {
  it("never dispatches in normal no-provider mode and says why", async () => {
    const w = world(null);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const res = await request(ava, p.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not connected/);
    const list = (await ava(`/api/product-projects/${p.id}/builds`)).body;
    expect(list.availability.available).toBe(false);
    expect(list.jobs).toEqual([]);
    expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM build_jobs").get()).toEqual({ n: 0 });
  });

  it("refuses a provider without declared prices", async () => {
    const provider = new Scripted();
    provider.priced = false;
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const res = await request(ava, p.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no declared prices/);
  });

  it("returns the same job for an exact duplicate and refuses a reused key for anything else", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const first = await request(ava, p.id);
    expect(first.status).toBe(201);
    expect(first.body.job).toMatchObject({ state: "queued", revision: 1, reserved_cents: 6 });
    const again = await request(ava, p.id);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, job: { id: first.body.job.id } });
    const other = await request(ava, p.id, "build-key-0001", {
      budget: { ...BUDGET, max_seconds: 120 },
    });
    expect(other.status).toBe(409);
    expect(other.body.error).toMatch(/already used for a different build request/);

    // Simultaneous: identical pair → one job; conflicting pair → one job and one 409.
    const [a, b] = await Promise.all([
      request(ava, p.id, "build-key-0002"),
      request(ava, p.id, "build-key-0002"),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.job.id).toBe(b.body.job.id);
    const [c, d] = await Promise.all([
      request(ava, p.id, "build-key-0003"),
      request(ava, p.id, "build-key-0003", { budget: { ...BUDGET, max_cost_cents: 20 } }),
    ]);
    expect([c.status, d.status].sort()).toEqual([201, 409]);
    expect(
      w.store.db.prepare("SELECT COUNT(*) AS n FROM build_jobs WHERE project_id = ?").get(p.id),
    ).toEqual({ n: 3 });
  });

  it("validates and bounds every input", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const cases: [Record<string, unknown>, number, RegExp][] = [
      [{ idempotency_key: "short" }, 400, /idempotency_key/],
      [{ idempotency_key: "has spaces in it" }, 400, /idempotency_key/],
      [{ intent: "deploy" }, 400, /intent/],
      [{ revision: 0 }, 400, /revision/],
      [{ revision: 7 }, 404, /No such revision/],
      [{ budget: null }, 400, /limits/],
      [{ budget: { ...BUDGET, max_input_tokens: 10_000_000 } }, 400, /Input tokens/],
      [{ budget: { ...BUDGET, max_seconds: 1 } }, 400, /Seconds/],
      [{ budget: { ...BUDGET, max_cost_cents: 5 } }, 400, /could cost up to 6 cents/],
    ];
    for (const [patch, status, message] of cases) {
      const res = await ava(`/api/product-projects/${p.id}/builds`, "POST", {
        idempotency_key: "build-key-valid",
        revision: 1,
        budget: BUDGET,
        ...patch,
      });
      expect(res.status, JSON.stringify(patch)).toBe(status);
      expect(res.body.error, JSON.stringify(patch)).toMatch(message);
    }
    expect(
      (await ava(`/api/businesses/${p.business}/build-budget`, "PUT", { limit_cents: -1 })).status,
    ).toBe(400);
    expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM build_jobs").get()).toEqual({ n: 0 });
  });

  it("reserves the worst case before anything runs and releases it when nothing was sent", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const unbudgeted = (
      await ava("/api/product-projects", "POST", { idea: "An API idea", foundation: "ai_api" })
    ).body;
    const none = await request(ava, unbudgeted.project.id);
    expect(none.status).toBe(409);
    expect(none.body.error).toMatch(/Set a build budget/);

    const p = await project(ava, 10);
    const first = (await request(ava, p.id)).body.job;
    let budget = (await ava(`/api/businesses/${p.business}/build-budget`)).body;
    expect(budget).toMatchObject({ limit_cents: 10, reserved_cents: 6, available_cents: 4 });
    const second = await request(ava, p.id, "build-key-0002");
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/Not enough build budget/);

    const cancelled = (await ava(`/api/builds/${first.id}/cancel`, "POST")).body.job;
    expect(cancelled).toMatchObject({ state: "cancelled", reserved_cents: 0, usage_state: "none" });
    budget = (await ava(`/api/businesses/${p.business}/build-budget`)).body;
    expect(budget).toMatchObject({ reserved_cents: 0, available_cents: 10 });
    const ledger = w.store.db
      .prepare("SELECT kind, cents FROM build_usage WHERE job_id = ? ORDER BY id")
      .all(first.id);
    expect(ledger).toEqual([
      { kind: "reservation", cents: 6 },
      { kind: "release", cents: 6 },
    ]);
    // Cancelling again changes nothing.
    expect((await ava(`/api/builds/${first.id}/cancel`, "POST")).body.job.state).toBe("cancelled");
    expect(types(w, first.id).filter((t) => t === "cancel_requested")).toHaveLength(1);
  });

  it("lets nobody but the business's current owner see or act on its builds", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const ben = await w.join("Ben Okafor");
    const p = await project(ava);
    const j = (await request(ava, p.id)).body.job;
    for (const [path, method] of [
      [`/api/product-projects/${p.id}/builds`, "GET"],
      [`/api/builds/${j.id}`, "GET"],
      [`/api/builds/${j.id}/events`, "GET"],
      [`/api/builds/${j.id}/cancel`, "POST"],
      [`/api/builds/${j.id}/retry`, "POST"],
      [`/api/businesses/${p.business}/build-budget`, "GET"],
    ] as const)
      expect((await ben(path, method, {})).status, path).toBe(404);
    expect((await request(ben, p.id)).status).toBe(404);
    expect(
      (await ben(`/api/businesses/${p.business}/build-budget`, "PUT", { limit_cents: 999 })).status,
    ).toBe(404);
    expect((await w.anon(`/api/builds/${j.id}`)).status).toBe(401);
    expect(job(w, j.id).state).toBe("queued");
  });
});

describe("build worker", () => {
  it("builds a validated artifact from the revision snapshot, with usage and events", async () => {
    const provider = new Scripted(async function* () {
      yield { type: "progress", message: "Using api_key=sk-test-1234567890abcdef to draft" };
      yield { type: "usage", inputTokens: 1000, outputTokens: 200 };
      yield { type: "output", artifact: JSON.stringify(SPEC) };
      yield { type: "usage_final", inputTokens: 4000, outputTokens: 1000 };
    });
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const j = (await request(ava, p.id)).body.job;
    expect(await w.worker("w1").runNext()).toBe(j.id);

    expect(provider.calls).toHaveLength(1);
    const sent = provider.calls[0] as BuildRequest;
    expect(sent.content.brief.problem).toMatch(/supplier invoices/);
    expect(sent.content.prototype.screens.length).toBe(3);
    expect(sent).toMatchObject({ revision: 1, attempt: 1, outputSchema: "extraction_spec/1" });
    expect(sent.limits).toEqual({ maxInputTokens: 10_000, maxOutputTokens: 2_000, maxSeconds: 60 });

    const done = (await ava(`/api/builds/${j.id}`)).body.job;
    // The digest is of the platform's rebuilt, canonical spec, not of what the provider sent.
    const digest = createHash("sha256").update(canonicalJson(done.artifact.spec)).digest("hex");
    expect(done.artifact.spec.fields[0]).toEqual({ ...SPEC.fields[0], description: "" });
    expect(done).toMatchObject({
      state: "succeeded",
      artifact_digest: digest,
      usage_state: "final",
      input_tokens: 4000,
      output_tokens: 1000,
      charged_microcents: 2_700_000, // 4,000 × 300 + 1,000 × 1,500 = 2.7 cents exactly
      charged_cents: 3, // rounded up for the ledger
      reserved_cents: 0,
      can_cancel: false,
      can_retry: false,
    });
    expect(done.artifact.spec.fields).toHaveLength(3);
    expect(done.artifact.provenance).toMatchObject({
      revision: 1,
      attempt: 1,
      provider: { id: "scripted-test", model: "scripted-model", version: "1" },
    });
    expect(types(w, j.id)).toEqual([
      "queued",
      "claimed",
      "dispatched",
      "progress",
      "usage",
      "output_received",
      "usage_final",
      "validating",
      "checks",
      "succeeded",
    ]);
    const events = (await ava(`/api/builds/${j.id}/events?after=3&limit=1`)).body;
    expect(events.events).toHaveLength(1);
    expect(events.events[0].type).toBe("progress");
    expect(events.events[0].data.message).not.toMatch(/sk-test|1234567890/);
    expect(events.events[0].data.message).toMatch(/\[redacted\]/);
    expect(events.last_seq).toBe(10);
  });

  it("refuses model text, malformed or unchecked output, and provider failures, without success", async () => {
    const outputs: [Script, string, RegExp][] = [
      [
        succeed("Here is your API! It extracts vendor and total."),
        "invalid_output",
        /model text is not a build/,
      ],
      [succeed({ ...SPEC, kind: "shell_script" }), "invalid_output", /Unsupported artifact/],
      [
        succeed({ ...SPEC, fields: (SPEC.fields as object[]).slice(0, 2), examples: [] }),
        "invalid_output",
        /checks failed/,
      ],
      [
        async function* () {
          yield { type: "usage", inputTokens: 10, outputTokens: 0 };
        },
        "no_output",
        /without an artifact/,
      ],
      [
        // biome-ignore lint/correctness/useYield: a provider that fails before yielding
        async function* () {
          throw new Error("upstream refused: Authorization: Bearer abc.def.ghi");
        },
        "provider_error",
        /upstream refused/,
      ],
    ];
    for (const [script, code, detail] of outputs) {
      const w = world(new Scripted(script));
      const ava = await w.join("Ava Chen");
      const p = await project(ava);
      const j = (await request(ava, p.id)).body.job;
      await w.worker("w1").runNext();
      const done = (await ava(`/api/builds/${j.id}`)).body.job;
      expect(done.state, code).toBe("failed");
      expect(done.failure.code, code).toBe(code);
      expect(done.failure.detail, code).toMatch(detail);
      expect(done.failure.detail).not.toMatch(/abc\.def\.ghi/);
      expect(done.artifact_digest).toBeNull();
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM build_artifacts").get()).toEqual({
        n: 0,
      });
    }
  });

  it("cancels during events: aborts, records partial usage and keeps the reservation (002a1 #1)", async () => {
    const g = gate();
    const reached = gate();
    const provider = new Scripted(async function* () {
      yield { type: "usage", inputTokens: 2000, outputTokens: 0 };
      reached.open();
      await g.opened;
      yield { type: "output", artifact: SPEC };
    });
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const j = (await request(ava, p.id)).body.job;
    const running = w.worker("w1").runNext();
    await reached.opened;
    expect((await ava(`/api/builds/${j.id}`)).body.job.state).toBe("running");
    const cancelled = (await ava(`/api/builds/${j.id}/cancel`, "POST")).body.job;
    expect(cancelled.cancel_requested).toBe(true);
    await running;
    g.open();
    const done = (await ava(`/api/builds/${j.id}`)).body.job;
    // A provisional report is not the whole bill: the spend so far is recorded, the
    // reservation stays held, and a retry needs consent.
    expect(done).toMatchObject({
      state: "cancelled",
      usage_state: "partial",
      input_tokens: 2000,
      charged_microcents: 600_000,
      charged_cents: 1,
      reserved_cents: 6,
      retry_needs_ack: true,
      artifact_digest: null,
    });
    expect(provider.aborted).toBe(1);
    expect((await ava(`/api/businesses/${p.business}/build-budget`)).body).toMatchObject({
      reserved_cents: 6,
      charged_cents: 1,
      unresolved_cents: 6,
    });
    await ava(`/api/builds/${j.id}/cancel`, "POST");
    expect(types(w, j.id).filter((t) => t === "cancel_requested")).toHaveLength(1);
    expect(types(w, j.id).at(-1)).toBe("cancelled");
  });

  it("holds the reservation when a cancelled call's cost is unknown, and needs consent to retry", async () => {
    const g = gate();
    const reached = gate();
    const provider = new Scripted(async function* () {
      reached.open();
      await g.opened;
      yield { type: "output", artifact: SPEC };
    });
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const p = await project(ava, 12);
    const j = (await request(ava, p.id)).body.job;
    const running = w.worker("w1").runNext();
    await reached.opened;
    await ava(`/api/builds/${j.id}/cancel`, "POST");
    await running;
    const done = (await ava(`/api/builds/${j.id}`)).body.job;
    expect(done).toMatchObject({
      state: "cancelled",
      usage_state: "unknown",
      reserved_cents: 6,
      retry_needs_ack: true,
    });
    const refused = await ava(`/api/builds/${j.id}/retry`, "POST", {
      idempotency_key: "retry-key-0001",
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/may have reached the provider/);
    const retried = await ava(`/api/builds/${j.id}/retry`, "POST", {
      idempotency_key: "retry-key-0001",
      acknowledge_unknown_cost: true,
    });
    expect(retried.status).toBe(201);
    expect(retried.body.job).toMatchObject({ retry_of: j.id, state: "queued", reserved_cents: 6 });
    // Both reservations stay: the unknown one is not assumed to be zero.
    expect((await ava(`/api/businesses/${p.business}/build-budget`)).body).toMatchObject({
      reserved_cents: 12,
      unresolved_cents: 6,
      available_cents: 0,
    });
    g.open();
  });

  it("stops at the time limit", async () => {
    const provider = new Scripted(async function* (_req, signal) {
      yield { type: "progress", message: "Thinking" };
      await new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }));
    });
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const j = (
      await request(ava, p.id, "build-key-0001", { budget: { ...BUDGET, max_seconds: 10 } })
    ).body.job;
    await w.worker("w1").runNext(); // 10 budget seconds at 1 ms each
    const done = (await ava(`/api/builds/${j.id}`)).body.job;
    expect(done).toMatchObject({ state: "failed", usage_state: "unknown", reserved_cents: 6 });
    expect(done.failure.code).toBe("timeout");
  });

  it("claims atomically and within the concurrency bound", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const a = (await request(ava, p.id, "build-key-000a")).body.job;
    w.clock.t += 1;
    const b = (await request(ava, p.id, "build-key-000b")).body.job;
    const one = w.worker("w1").claim();
    expect(one?.job.id).toBe(a.id);
    expect(w.worker("w2").claim()).toBeNull(); // one running platform-wide
    const two = w.worker("w2", { maxConcurrent: 2 }).claim();
    expect(two?.job.id).toBe(b.id);
    expect(w.worker("w3", { maxConcurrent: 2 }).claim()).toBeNull();
  });
});

describe("build recovery and fencing", () => {
  it("requeues work that was never sent when the worker restarts, then runs it once", async () => {
    const provider = new Scripted();
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const j = (await request(ava, p.id)).body.job;
    expect(w.worker("old").claim()?.job.id).toBe(j.id); // claimed, then the process dies
    const fresh = w.worker("new");
    expect(fresh.recover({ orphanAll: true })).toEqual({ requeued: 1, held: 0 });
    expect(job(w, j.id)).toMatchObject({ state: "queued", dispatched_at: null });
    expect(await fresh.runNext()).toBe(j.id);
    expect(provider.calls).toHaveLength(1);
    expect(job(w, j.id)).toMatchObject({ state: "succeeded", attempt: 2 });
  });

  it("does not dispatch again after a restart once the call may have been sent", async () => {
    const g = gate();
    const reached = gate();
    const provider = new Scripted(async function* () {
      reached.open();
      await g.opened;
      yield { type: "usage", inputTokens: 100, outputTokens: 100 };
      yield { type: "output", artifact: SPEC };
    });
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const j = (await request(ava, p.id)).body.job;
    const old = w.worker("old");
    const orphaned = old.runNext(); // dispatches, then hangs: the process "dies" here
    await reached.opened;
    const fresh = w.worker("new");
    expect(fresh.recover({ orphanAll: true })).toEqual({ requeued: 0, held: 1 });
    expect(await fresh.runNext()).toBeNull();
    expect(provider.calls).toHaveLength(1);
    const held = (await ava(`/api/builds/${j.id}`)).body.job;
    expect(held).toMatchObject({
      state: "needs_reconciliation",
      usage_state: "unknown",
      reserved_cents: 6,
      can_retry: true,
      retry_needs_ack: true,
    });
    expect(held.failure.code).toBe("outcome_unknown");

    // The old attempt wakes up with a result: it is fenced and writes nothing.
    g.open();
    await orphaned;
    expect(job(w, j.id)).toMatchObject({
      state: "needs_reconciliation",
      artifact_digest: null,
      input_tokens: 0,
    });
    expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM build_artifacts").get()).toEqual({ n: 0 });
  });

  it("fences a stale attempt after its lease lapses and another worker recovers it", async () => {
    const g = gate();
    const reached = gate();
    const provider = new Scripted(async function* () {
      reached.open();
      await g.opened;
      yield { type: "output", artifact: SPEC };
    });
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const j = (await request(ava, p.id)).body.job;
    const slow = w.worker("slow", { leaseMs: 30_000 }).runNext();
    await reached.opened;
    w.clock.t += 31_000; // the slow worker's lease has lapsed
    expect(w.worker("other").recover()).toEqual({ requeued: 0, held: 1 });
    g.open();
    await slow;
    expect(job(w, j.id)).toMatchObject({ state: "needs_reconciliation", artifact_digest: null });
    expect(types(w, j.id)).not.toContain("succeeded");
  });

  it("fences jobs requested by a former owner, whether queued or running", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const ben = await w.join("Ben Okafor");
    const p = await project(ava, 100);
    const queued = (await request(ava, p.id, "build-key-000q")).body.job;
    transfer(w, p.business, ava.id, ben.id);
    // The worker notices before claiming: nothing is dispatched for the old owner.
    expect(await w.worker("w1").runNext()).toBeNull();
    expect(job(w, queued.id)).toMatchObject({
      state: "cancelled",
      failure_code: "ownership_changed",
      reserved_cents: 0,
    });
    expect((await ava(`/api/builds/${queued.id}`)).status).toBe(404);
    expect((await ben(`/api/builds/${queued.id}`)).body.job.state).toBe("cancelled");
  });

  it("does not apply output to a business that changed hands while the build ran", async () => {
    const g = gate();
    const reached = gate();
    const provider = new Scripted(async function* () {
      reached.open();
      await g.opened;
      yield { type: "usage", inputTokens: 100, outputTokens: 100 };
      yield { type: "output", artifact: SPEC };
    });
    const w = world(provider);
    const ava = await w.join("Ava Chen");
    const ben = await w.join("Ben Okafor");
    const p = await project(ava);
    const j = (await request(ava, p.id)).body.job;
    const running = w.worker("w1").runNext();
    await reached.opened;
    transfer(w, p.business, ava.id, ben.id);
    g.open();
    await running;
    expect(job(w, j.id)).toMatchObject({
      state: "needs_reconciliation",
      failure_code: "ownership_changed",
      artifact_digest: null,
    });
    expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM build_artifacts").get()).toEqual({ n: 0 });
    // The new owner sees it and may retry under their own authorization.
    const seen = (await ben(`/api/builds/${j.id}`)).body.job;
    expect(seen).toMatchObject({ state: "needs_reconciliation", can_retry: true });
  });

  it("keeps events, artifacts and usage append-only and bounds progress events", async () => {
    const provider = new Scripted(async function* () {
      for (let i = 0; i < 50; i++) yield { type: "progress", message: `step ${i}` };
      yield { type: "usage", inputTokens: 1, outputTokens: 1 };
      yield { type: "output", artifact: SPEC };
    });
    const w = world(provider, 5);
    const ava = await w.join("Ava Chen");
    const p = await project(ava);
    const j = (await request(ava, p.id)).body.job;
    await w.worker("w1").runNext();
    expect(types(w, j.id).filter((t) => t === "progress")).toHaveLength(5);
    expect(types(w, j.id).at(-1)).toBe("succeeded");
    const db = w.store.db;
    expect(() => db.prepare("UPDATE build_events SET type = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM build_usage").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM build_artifacts").run()).toThrow(/immutable/);
  });
});

describe("redaction", () => {
  it("strips credentials, control characters and length from provider text", () => {
    const out = redact(
      `key sk-ant-abcdefghijklmnop\nBearer xyz.123 password: hunter2 ed25519:${"A".repeat(40)} ${"x".repeat(400)}`,
    );
    expect(out).not.toMatch(/sk-ant|xyz\.123|hunter2|AAAA|\n/);
    expect(out.length).toBeLessThanOrEqual(300);
  });
});
