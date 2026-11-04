// Job 002e: isolated logic check orchestration, versions and preview over the REAL API and
// worker, with a TEST DOUBLE engine. The double runs nothing: it returns a scripted report, and
// its identity says `test-double`, so its "passed" is never isolation evidence (the API says so).
// What this proves: unavailable when no engine; binding/engine/case-set validation; owner fences
// and dropped late output; cancel/deadline cleanup; restart recovery without re-running; check
// retries never touch a generation; preview gating, headers, token scope and expiry.

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import {
  AppChecks,
  type CheckEngine,
  type CheckJob,
  type EngineIdentity,
} from "../src/appChecks.ts";
import { AppCheckWorker } from "../src/appCheckWorker.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../src/build.ts";
import { Builds, BuildWorker } from "../src/builds.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { QUOTE_BUNDLE, QUOTE_BUNDLE_V2 } from "./app-fixtures.ts";

class Scripted implements BuildProvider {
  readonly id = "scripted-test";
  calls = 0;
  next: unknown[] = [];
  identity() {
    return { id: this.id, model: "scripted-model", version: "1" };
  }
  availability() {
    return { available: true, provider: this.id, reason: "Scripted test provider" };
  }
  pricing() {
    return { inputCentsPerMillionTokens: 300, outputCentsPerMillionTokens: 1500 };
  }
  start(_req: BuildRequest): AsyncIterable<BuildEvent> {
    this.calls++;
    const artifact = this.next.shift();
    return (async function* () {
      yield { type: "output", artifact } as BuildEvent;
      yield { type: "usage_final", inputTokens: 100, outputTokens: 100 } as BuildEvent;
    })();
  }
}

/** TEST DOUBLE engine: scripted answers, never executes a bundle. */
class DoubleEngine implements CheckEngine {
  identity: EngineIdentity = { engine: "test-double", recipe: "web_app_checks/1" };
  ready = true;
  runs: CheckJob[] = [];
  cleaned: CheckJob[] = [];
  /** How the next run answers. */
  answer: (job: CheckJob, identity: EngineIdentity) => unknown = (job, identity) =>
    passing(job, identity);
  hold: Promise<void> | null = null;
  /** The run ignores its AbortSignal entirely (an adapter that never settles). */
  deaf = false;
  /** Called during preflight (e.g. a cancel arriving then). */
  duringPreflight: () => void = () => {};
  /** Called during a run (e.g. the clock moving past the lease). */
  duringRun: () => void = () => {};
  cleanupFails = false;
  preflights = 0;
  async preflight() {
    this.preflights++;
    this.duringPreflight();
    return this.ready
      ? { ok: true as const, identity: this.identity }
      : { ok: false as const, reason: "KVM not accessible" };
  }
  async run(job: CheckJob, signal: AbortSignal) {
    this.runs.push(job);
    this.duringRun();
    if (this.deaf) await new Promise(() => {});
    if (this.hold)
      await Promise.race([
        this.hold,
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        ),
      ]);
    return this.answer(job, this.identity);
  }
  async cleanup(job: CheckJob) {
    this.cleaned.push(job);
    if (this.cleanupFails) throw new Error("cgroup still populated");
  }
}

function passing(
  job: CheckJob,
  engine: EngineIdentity,
  edit: (r: Record<string, unknown>) => void = () => {},
) {
  const b = JSON.parse(job.bundle) as typeof QUOTE_BUNDLE;
  const report: Record<string, unknown> = {
    check_id: job.check_id,
    attempt: job.attempt,
    digest: job.digest,
    recipe: job.recipe,
    engine,
    syntax: b.files
      .filter((f) => f.path.endsWith(".js"))
      .map((f) => ({ path: f.path, ok: true, detail: "" })),
    cases: b.checks.map((c) => ({ id: c.id, passed: true, detail: "" })),
    usage: { untrusted_memory_peak_bytes: 1000 },
  };
  edit(report);
  return { report, host: { vmm_memory_peak_bytes: 2000 } };
}

const BUDGET = {
  max_input_tokens: 10_000,
  max_output_tokens: 2_000,
  max_seconds: 60,
  max_cost_cents: 10,
};
const PREVIEW = "http://localhost:4999";
const PLATFORM = "http://127.0.0.1:4999";

function world(engine: CheckEngine | null = new DoubleEngine()) {
  const provider = new Scripted();
  const clock = { t: Date.parse("2026-11-04T12:00:00.000Z") };
  const store = new Store(openDb(":memory:"));
  const builds = new Builds(store.db, store, provider, { operatorCeilingCents: 100_000 });
  const checks = new AppChecks(store.db, store, { now: () => clock.t });
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    buildProvider: provider,
    builds,
    appChecks: checks,
    previewOrigin: PREVIEW,
    platformOrigin: PLATFORM,
  });
  const raw = (path: string, init: RequestInit = {}) => app.request(path, init);
  const join = async (name: string) => {
    const res = await raw("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const id = ((await res.json()) as { person: { id: string } }).person.id;
    return Object.assign(
      async (path: string, method = "GET", body?: unknown) => {
        const r = await raw(path, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
        });
        // biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
        return { status: r.status, body: (await r.json()) as Record<string, any> };
      },
      { id, cookie },
    );
  };
  const buildWorker = new BuildWorker(builds, provider, { id: "b1" });
  const checkWorker = (id = "c1", runMs?: number) =>
    new AppCheckWorker(checks, engine, { id, pollMs: 5, runMs });
  return { store, provider, engine, checks, raw, join, buildWorker, checkWorker, clock };
}
type World = ReturnType<typeof world>;
type Actor = Awaited<ReturnType<World["join"]>>;

async function appVersion(w: World, a: Actor, bundle: unknown = QUOTE_BUNDLE, pid?: string) {
  let projectId = pid;
  if (!projectId) {
    const p = (
      await a("/api/product-projects", "POST", {
        idea: "A plan estimator for a fictional API service",
        foundation: "saas_workflow",
      })
    ).body;
    await a(`/api/businesses/${p.project.business_id}/build-budget`, "PUT", { limit_cents: 100 });
    projectId = p.project.id as string;
  }
  w.provider.next.push(bundle);
  const r = await a(`/api/product-projects/${projectId}/builds`, "POST", {
    idempotency_key: `app-key-${Math.random().toString(36).slice(2, 12)}`,
    revision: 1,
    intent: "app",
    budget: BUDGET,
  });
  await w.buildWorker.runNext();
  return { pid: projectId as string, job: r.body.job.id as string };
}

const requestCheck = (a: Actor, pid: string, job: string, key = "check-key-0001") =>
  a(`/api/product-projects/${pid}/app-versions/${job}/checks`, "POST", { idempotency_key: key });
// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;
const checkOf = async (a: Actor, pid: string, id: string) =>
  ((await a(`/api/product-projects/${pid}/app-versions`)).body.checks as Json[]).find(
    (c) => c.id === id,
  ) as Json;

function transfer(w: World, businessId: string, to: string) {
  const from = (
    w.store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(businessId) as {
      owner_id: string;
    }
  ).owner_id;
  w.store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, businessId);
  w.store.db
    .prepare("INSERT INTO ownership (business_id, from_id, to_id, at) VALUES (?, ?, ?, ?)")
    .run(businessId, from, to, new Date().toISOString());
}
const businessOf = (w: World, pid: string) =>
  (
    w.store.db.prepare("SELECT business_id FROM product_projects WHERE id = ?").get(pid) as {
      business_id: string;
    }
  ).business_id;

describe("002e logic checks: orchestration", () => {
  it("with no engine configured the check is unavailable and nothing runs", async () => {
    const w = world(null);
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const r = await requestCheck(ava, v.pid, v.job);
    expect(r.status).toBe(201);
    await w.checkWorker().runNext();
    const c = await checkOf(ava, v.pid, r.body.check.id);
    expect(c).toMatchObject({
      state: "unavailable",
      failure: { code: "engine_not_configured" },
      isolation_evidence: false,
      result: null,
    });
  });

  it("a failed preflight is unavailable too: the engine never receives the job", async () => {
    const w = world();
    const engine = w.engine as DoubleEngine;
    engine.ready = false;
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const r = await requestCheck(ava, v.pid, v.job);
    await w.checkWorker().runNext();
    expect(await checkOf(ava, v.pid, r.body.check.id)).toMatchObject({
      state: "unavailable",
      failure: { code: "engine_unavailable", detail: expect.stringMatching(/KVM not accessible/) },
    });
    expect(engine.runs).toHaveLength(0);
  });

  it("a bound, complete report passes; a double's pass is never isolation evidence; no generation re-runs", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const generations = w.provider.calls;
    const r = await requestCheck(ava, v.pid, v.job);
    await w.checkWorker().runNext();
    const c = await checkOf(ava, v.pid, r.body.check.id);
    expect(c).toMatchObject({
      state: "passed",
      isolation_evidence: false,
      engine: { engine: "test-double" },
    });
    expect(c.result.usage).toEqual({
      untrusted_memory_peak_bytes: 1000,
      vmm_memory_peak_bytes: 2000,
    });
    // A retry is a new check (new key); it never touches the generation.
    await requestCheck(ava, v.pid, v.job, "check-key-0002");
    await w.checkWorker().runNext();
    expect(w.provider.calls).toBe(generations);
    expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM build_jobs").get()).toEqual({ n: 1 });
  });

  it("refuses reports for another check, attempt, version, recipe or engine, and partial or extra results", async () => {
    const cases: [string, (r: Record<string, unknown>) => void, RegExp][] = [
      [
        "digest",
        (r) => {
          r.digest = "0".repeat(64);
        },
        /different check, attempt, version or recipe/,
      ],
      [
        "attempt",
        (r) => {
          r.attempt = 2;
        },
        /different check/,
      ],
      [
        "check",
        (r) => {
          r.check_id = "someone-else";
        },
        /different check/,
      ],
      [
        "engine",
        (r) => {
          r.engine = { engine: "firecracker", recipe: "web_app_checks/1" };
        },
        /different engine/,
      ],
      [
        "missing case",
        (r) => {
          (r.cases as unknown[]).pop();
        },
        /cases don't match/,
      ],
      [
        "extra case",
        (r) => {
          (r.cases as unknown[]).push({ id: "invented", passed: true });
        },
        /cases don't match/,
      ],
      [
        "missing syntax",
        (r) => {
          r.syntax = [];
        },
        /syntax results don't match/,
      ],
    ];
    for (const [name, edit, why] of cases) {
      const w = world();
      (w.engine as DoubleEngine).answer = (job, id) => passing(job, id, edit);
      const ava = await w.join("Ava Chen");
      const v = await appVersion(w, ava);
      const r = await requestCheck(ava, v.pid, v.job);
      await w.checkWorker().runNext();
      const c = await checkOf(ava, v.pid, r.body.check.id);
      expect(c, name).toMatchObject({
        state: "failed",
        failure: { code: "invalid_report" },
        result: null,
      });
      expect(c.failure.detail, name).toMatch(why);
    }
  });

  it("a failing case or syntax error is a failed check with its result kept", async () => {
    const w = world();
    (w.engine as DoubleEngine).answer = (job, id) =>
      passing(job, id, (r) => {
        (r.cases as { passed: boolean; detail: string }[])[1] = {
          ...(r.cases as { id: string }[])[1],
          passed: false,
          detail: "Returned 1",
        } as never;
      });
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const r = await requestCheck(ava, v.pid, v.job);
    await w.checkWorker().runNext();
    const c = await checkOf(ava, v.pid, r.body.check.id);
    expect(c).toMatchObject({ state: "failed", failure: { code: "checks_failed" } });
    expect(c.result.cases[1]).toMatchObject({ passed: false, detail: "Returned 1" });
  });

  it("a change of owner mid-run cancels it and drops the late output; the engine cleans up", async () => {
    const w = world();
    const engine = w.engine as DoubleEngine;
    let release = () => {};
    engine.hold = new Promise((r) => {
      release = r;
    });
    const ava = await w.join("Ava Chen");
    const ben = await w.join("Ben Ortiz");
    const v = await appVersion(w, ava);
    const r = await requestCheck(ava, v.pid, v.job);
    const running = w.checkWorker().runNext();
    for (let i = 0; i < 50 && engine.runs.length === 0; i++)
      await new Promise((x) => setTimeout(x, 2));
    transfer(w, businessOf(w, v.pid), ben.id);
    await running;
    release();
    const row = w.checks.row(r.body.check.id);
    expect(row).toMatchObject({
      state: "cancelled",
      failure_code: "ownership_changed",
      result: null,
    });
    expect(engine.cleaned).toHaveLength(1);
    // The former owner can't see it any more.
    expect((await ava(`/api/product-projects/${v.pid}/app-versions`)).status).toBe(404);
  });

  it("cancel and deadline stop the run and clean up", async () => {
    for (const how of ["cancel", "deadline"] as const) {
      const w = world();
      const engine = w.engine as DoubleEngine;
      engine.hold = new Promise(() => {}); // never answers on its own
      const ava = await w.join("Ava Chen");
      const v = await appVersion(w, ava);
      const r = await requestCheck(ava, v.pid, v.job);
      const running = w.checkWorker("c1", how === "deadline" ? 30 : undefined).runNext();
      for (let i = 0; i < 50 && engine.runs.length === 0; i++)
        await new Promise((x) => setTimeout(x, 2));
      if (how === "cancel") await ava(`/api/app-checks/${r.body.check.id}/cancel`, "POST");
      await running;
      expect(w.checks.row(r.body.check.id), how).toMatchObject(
        how === "cancel"
          ? { state: "cancelled", failure_code: "cancelled" }
          : { state: "failed", failure_code: "timeout" },
      );
      expect(engine.cleaned, how).toHaveLength(1);
    }
  });

  it("after a restart: not dispatched is queued again; dispatched is unknown and never re-run", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const a = (await requestCheck(ava, v.pid, v.job, "check-key-000a")).body.check.id;
    const b = (await requestCheck(ava, v.pid, v.job, "check-key-000b")).body.check.id;
    // Simulate a crash: one claimed but not sent, one sent (dispatch recorded), worker gone.
    w.store.db
      .prepare(
        "UPDATE app_checks SET state = 'running', attempt = 1, lease_owner = 'dead' WHERE id = ?",
      )
      .run(a);
    w.store.db
      .prepare(
        "UPDATE app_checks SET state = 'running', attempt = 1, lease_owner = 'dead', dispatched_at = 'x' WHERE id = ?",
      )
      .run(b);
    const fresh = w.checkWorker("c2");
    fresh.recover();
    expect(w.checks.row(a)?.state).toBe("queued");
    expect(w.checks.row(b)).toMatchObject({ state: "unknown", failure_code: "outcome_unknown" });
    await fresh.runNext();
    await fresh.runNext();
    expect((w.engine as DoubleEngine).runs.map((j) => j.check_id)).toEqual([a]);
  });

  it("the same key is the same check; the same key for another version is refused", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const v1 = await appVersion(w, ava);
    const v2 = await appVersion(w, ava, QUOTE_BUNDLE_V2, v1.pid);
    const first = await requestCheck(ava, v1.pid, v1.job);
    const again = await requestCheck(ava, v1.pid, v1.job);
    expect([first.status, again.status, again.body.check.id]).toEqual([
      201,
      200,
      first.body.check.id,
    ]);
    expect((await requestCheck(ava, v1.pid, v2.job)).status).toBe(409);
  });
});

// Astra's AppCheckLifecycleReview reproductions, now regressions, plus the boundaries around them.
describe("002e logic checks: lease, cancel and bounds", () => {
  it("a run longer than the lease still lands, and the next queued check is claimed", async () => {
    const w = world();
    const engine = w.engine as DoubleEngine;
    // 40 s of fictional time pass during the run, in 4 s steps between poll ticks (as a live run
    // would): past the 30 s lease, within the run bound. The ticks must keep renewing it.
    const start = w.clock.t;
    let done = () => {};
    engine.hold = new Promise((r) => {
      done = r;
    });
    engine.duringRun = () => {
      const tick = setInterval(() => {
        w.clock.t += 4_000;
        if (w.clock.t - start >= 40_000) {
          clearInterval(tick);
          done();
        }
      }, 4);
    };
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const a = (await requestCheck(ava, v.pid, v.job, "check-key-00a1")).body.check.id;
    const b = (await requestCheck(ava, v.pid, v.job, "check-key-00a2")).body.check.id;
    const worker = w.checkWorker();
    const first = await worker.runNext();
    expect(w.clock.t - Date.parse("2026-11-04T12:00:00.000Z")).toBeGreaterThan(30_000);
    expect(w.checks.row(first as string)?.state).toBe("passed");
    engine.duringRun = () => {};
    engine.hold = null;
    const second = await worker.runNext();
    expect([first, second].sort()).toEqual([a, b].sort());
    expect(w.checks.row(second as string)?.state).toBe("passed");
  });

  it("a cancel during preflight sends nothing: zero runs, cancelled", async () => {
    const w = world();
    const engine = w.engine as DoubleEngine;
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const id = (await requestCheck(ava, v.pid, v.job)).body.check.id;
    engine.duringPreflight = () => {
      w.checks.cancel(ava.id, id);
    };
    await w.checkWorker().runNext();
    expect(engine.runs).toHaveLength(0);
    expect(w.checks.row(id)).toMatchObject({
      state: "cancelled",
      dispatched_at: null,
      result: null,
    });
  });

  it("an adapter that never settles is bounded; cleanup runs; the next check proceeds", async () => {
    const w = world();
    const engine = w.engine as DoubleEngine;
    engine.deaf = true;
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const a = (await requestCheck(ava, v.pid, v.job, "check-key-00b1")).body.check.id;
    const worker = new AppCheckWorker(w.checks, engine, { id: "c1", pollMs: 5, runMs: 40 });
    await worker.runNext();
    expect(w.checks.row(a)).toMatchObject({ state: "failed", failure_code: "timeout" });
    expect(engine.cleaned).toHaveLength(1);
    expect(worker.blocked).toBeNull();
    engine.deaf = false;
    const b = (await requestCheck(ava, v.pid, v.job, "check-key-00b2")).body.check.id;
    expect(await worker.runNext()).toBe(b);
  });

  it("an unconfirmed cleanup blocks new claims until a preflight succeeds again", async () => {
    const w = world();
    const engine = w.engine as DoubleEngine;
    engine.deaf = true;
    engine.cleanupFails = true;
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    await requestCheck(ava, v.pid, v.job, "check-key-00c1");
    const worker = new AppCheckWorker(w.checks, engine, { id: "c1", pollMs: 5, runMs: 40 });
    await worker.runNext();
    expect(worker.blocked).toMatch(/wasn't confirmed/);
    const next = (await requestCheck(ava, v.pid, v.job, "check-key-00c2")).body.check.id;
    engine.ready = false; // the host isn't clean yet
    expect(await worker.runNext()).toBeNull();
    expect(w.checks.row(next)?.state).toBe("queued");
    engine.ready = true;
    engine.deaf = false;
    engine.cleanupFails = false;
    expect(await worker.runNext()).toBe(next);
    expect(worker.blocked).toBeNull();
  });

  it("another worker's live lease is left alone and holds the one slot; a lapsed one is recovered", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const live = (await requestCheck(ava, v.pid, v.job, "check-key-00d1")).body.check.id;
    const queued = (await requestCheck(ava, v.pid, v.job, "check-key-00d2")).body.check.id;
    const later = new Date(w.clock.t + 10_000).toISOString();
    w.store.db
      .prepare(
        "UPDATE app_checks SET state = 'running', attempt = 1, lease_owner = 'other', lease_expires_at = ?, dispatched_at = 'x' WHERE id = ?",
      )
      .run(later, live);
    const worker = w.checkWorker("c2");
    expect(await worker.runNext()).toBeNull();
    expect(w.checks.row(live)?.state).toBe("running");
    w.clock.t += 11_000; // that lease lapses: it ran (dispatched), so it's unknown, not re-run
    expect(await worker.runNext()).toBe(queued);
    expect(w.checks.row(live)).toMatchObject({ state: "unknown", failure_code: "outcome_unknown" });
    expect((w.engine as DoubleEngine).runs.map((j) => j.check_id)).toEqual([queued]);
  });
});

describe("002e versions and preview", () => {
  it("restore appends a pointer; the history is append-only", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const v1 = await appVersion(w, ava);
    const v2 = await appVersion(w, ava, QUOTE_BUNDLE_V2, v1.pid);
    let list = (await ava(`/api/product-projects/${v1.pid}/app-versions`)).body;
    expect(list.current).toBe(v2.job);
    list = (
      await ava(`/api/product-projects/${v1.pid}/app-versions/${v1.job}/current`, "POST", {
        note: "Back to v1",
      })
    ).body;
    expect(list.current).toBe(v1.job);
    expect(() => w.store.db.prepare("DELETE FROM app_versions").run()).toThrow(/append-only/);
    const files = (await ava(`/api/product-projects/${v1.pid}/app-versions/${v2.job}`)).body.bundle;
    expect(files.files.find((f: { path: string }) => f.path === "estimate.js").text).toContain(
      "? 40 : 12",
    );
  });

  it("ordinary preview needs a real engine's pass; a double's pass or none needs an explicit unchecked request", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const v = await appVersion(w, ava);
    const url = `/api/product-projects/${v.pid}/app-versions/${v.job}/preview`;
    expect((await ava(url, "POST", {})).body).toMatchObject({ code: "not_checked" });
    await requestCheck(ava, v.pid, v.job);
    await w.checkWorker().runNext(); // the double passes: still not an ordinary preview
    expect((await ava(url, "POST", {})).status).toBe(409);
    const unchecked = await ava(url, "POST", { unchecked: true });
    expect(unchecked.status).toBe(201);
    expect(unchecked.body).toMatchObject({ checked: false });
    expect(unchecked.body.url).toMatch(
      /^http:\/\/localhost:4999\/preview\/app\/[A-Za-z0-9_-]{43}\/index\.html$/,
    );
    // Gate test only: a double impersonating a verified engine identity makes it ordinary.
    (w.engine as DoubleEngine).identity = { engine: "firecracker", recipe: "web_app_checks/1" };
    await requestCheck(ava, v.pid, v.job, "check-key-0003");
    await w.checkWorker().runNext();
    expect((await ava(url, "POST", {})).body).toMatchObject({ checked: true });
  });

  it("serves the document sandboxed and subresources CORS-readable, by token only, and ends with expiry or a sale", async () => {
    const w = world();
    const ava = await w.join("Ava Chen");
    const ben = await w.join("Ben Ortiz");
    const v = await appVersion(w, ava);
    const issued = (
      await ava(`/api/product-projects/${v.pid}/app-versions/${v.job}/preview`, "POST", {
        unchecked: true,
      })
    ).body;
    const base = issued.url.replace(PREVIEW, "").replace(/index\.html$/, "");
    const doc = await w.raw(`${base}index.html`); // no cookie: the token is the authority
    expect(doc.status).toBe(200);
    const csp = doc.headers.get("content-security-policy") ?? "";
    for (const part of [
      "sandbox allow-scripts",
      "default-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      `frame-ancestors ${PLATFORM}`,
      `script-src ${PREVIEW}${base}`,
    ])
      expect(csp).toContain(part);
    expect(csp).not.toContain("allow-same-origin");
    expect(doc.headers.get("set-cookie")).toBeNull();
    expect(await doc.text()).toContain("Lumen Parse API");
    const js = await w.raw(`${base}estimate.js`);
    expect(js.headers.get("access-control-allow-origin")).toBe("*");
    expect(js.headers.get("access-control-allow-credentials")).toBeNull();
    expect(js.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(js.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(js.headers.get("x-content-type-options")).toBe("nosniff");
    for (const p of ["missing.js", "../index.html", "%2e%2e/index.html"])
      expect((await w.raw(`${base}${p}`)).status, p).toBe(404);
    expect(
      (await w.raw(`${base.replace(/[A-Za-z0-9_-]{43}/, "A".repeat(43))}index.html`)).status,
    ).toBe(404);
    // Expiry, then a sale: both end the capability.
    w.clock.t += 31 * 60 * 1000;
    expect((await w.raw(`${base}index.html`)).status).toBe(404);
    w.clock.t -= 31 * 60 * 1000;
    expect((await w.raw(`${base}index.html`)).status).toBe(200);
    transfer(w, businessOf(w, v.pid), ben.id);
    expect((await w.raw(`${base}index.html`)).status).toBe(404);
  });
});
