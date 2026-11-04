// Job 002e (Astra's AppStudioReview reproduction, now a regression): a lost generation answer
// must never become a second paid build. The Generations controller drives the REAL builds API
// (in-memory store, real Builds/BuildWorker) with a SCRIPTED build provider (no model, no spend).
// What this proves: one exact request and key are kept apart from the draft; recovery re-sends
// that same request (the server returns the job it made); typed-ahead text survives; a reload
// (session storage) recovers it; a definite refusal ends it; another scope never sees it.

import { describe, expect, it } from "vitest";
import { everstreetApi } from "../../server/src/app.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../../server/src/build.ts";
import { Builds, BuildWorker } from "../../server/src/builds.ts";
import { openDb } from "../../server/src/db.ts";
import { Store } from "../../server/src/store.ts";
import { QUOTE_BUNDLE } from "../../server/test/app-fixtures.ts";
import { ApiError } from "../src/api.ts";
import type { GenerationRequest } from "../src/appApi.ts";
import { type GenerationPort, Generations } from "../src/appGenerate.ts";

class Scripted implements BuildProvider {
  readonly id = "scripted-test";
  calls = 0;
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
    return (async function* () {
      yield { type: "output", artifact: QUOTE_BUNDLE } as BuildEvent;
      yield { type: "usage_final", inputTokens: 100, outputTokens: 100 } as BuildEvent;
    })();
  }
}

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const BUDGET = {
  max_input_tokens: 10_000,
  max_output_tokens: 2_000,
  max_seconds: 60,
  max_cost_cents: 10,
};
let n = 0;
const newKey = () => `app-test-key-${String(++n).padStart(6, "0")}`;

async function setup() {
  const provider = new Scripted();
  const store = new Store(openDb(":memory:"));
  const builds = new Builds(store.db, store, provider, { operatorCeilingCents: 100_000 });
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    buildProvider: provider,
    builds,
  });
  const s = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ava Chen" }),
  });
  const cookie = (s.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const go = async (path: string, method = "GET", body?: unknown) => {
    const r = await app.request(path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // biome-ignore lint/suspicious/noExplicitAny: test reads response fields
    const b = (await r.json()) as Record<string, any>;
    if (r.status >= 400) throw new ApiError(r.status, b.error ?? "failed", b.code);
    return b;
  };
  const p = await go("/api/product-projects", "POST", {
    idea: "A plan estimator for a fictional API",
    foundation: "saas_workflow",
  });
  await go(`/api/businesses/${p.project.business_id}/build-budget`, "PUT", { limit_cents: 100 });
  let lose = 0;
  let refuse = false;
  /** The next n progress reads fail: a network failure (status 0) or that HTTP status. */
  const readFail = { n: 0, status: 0 };
  const port: GenerationPort = {
    generate: async (r: GenerationRequest) => {
      if (refuse) throw new ApiError(409, "Not enough AI budget");
      const answer = await go(`/api/product-projects/${r.project_id}/builds`, "POST", {
        idempotency_key: r.key,
        revision: r.revision,
        intent: "app",
        instructions: r.instructions,
        budget: r.budget,
      });
      if (lose > 0) {
        lose--;
        throw new TypeError("Synthetic lost committed response");
      }
      return answer as never;
    },
    build: async (id) => {
      if (readFail.n > 0) {
        readFail.n--;
        throw readFail.status
          ? new ApiError(readFail.status, "No such build")
          : new TypeError("network");
      }
      return (await go(`/api/builds/${id}`)) as never;
    },
    cancelBuild: async (id) => (await go(`/api/builds/${id}/cancel`, "POST")) as never,
  };
  const worker = new BuildWorker(builds, provider, { id: "b1" });
  const base = { project_id: p.project.id as string, revision: 1, base_job: null, budget: BUDGET };
  const jobs = () =>
    store.db.prepare("SELECT COUNT(*) AS n FROM build_jobs").get() as { n: number };
  return {
    provider,
    port,
    worker,
    base,
    jobs,
    loseNext: () => {
      lose = 1;
    },
    refuseNext: (v: boolean) => {
      refuse = v;
    },
    failReads: (n: number, status = 0) => {
      readFail.n = n;
      readFail.status = status;
    },
  };
}

describe("002e generation requests survive a lost answer (one paid build)", () => {
  it("lost committed answer -> recover re-sends the same key -> one job, one provider call", async () => {
    const w = await setup();
    const storage = new MemoryStorage();
    const g = new Generations(w.port, { scope: "ava:p:0", storage, newKey });
    g.setDraft("A plan estimator");
    w.loseNext();
    await g.submit(w.base);
    expect(g.getState()).toMatchObject({ unanswered: true, job: null });
    const key = g.getState().pending?.key;
    // Typing ahead never changes the request in flight.
    g.setDraft("Next: a dark theme");
    await w.worker.runNext(); // the first (committed) build finishes meanwhile
    await g.submit(w.base); // "Recover my request"
    expect(g.getState()).toMatchObject({
      pending: null,
      unanswered: false,
      draft: "Next: a dark theme",
    });
    expect(g.getState().job?.state).toBe("succeeded");
    expect(w.jobs().n).toBe(1);
    expect(w.provider.calls).toBe(1);
    expect(storage.m.size).toBe(0);
    expect(key).toMatch(/^app-test-key-/);
  });

  it("a reload (new controller, same scope and storage) recovers the same request; another scope doesn't see it", async () => {
    const w = await setup();
    const storage = new MemoryStorage();
    const first = new Generations(w.port, { scope: "ava:p:0", storage, newKey });
    first.setDraft("A plan estimator");
    w.loseNext();
    await first.submit(w.base);
    const key = first.getState().pending?.key;
    const reloaded = new Generations(w.port, { scope: "ava:p:0", storage, newKey });
    expect(reloaded.getState()).toMatchObject({
      unanswered: true,
      pending: { key, instructions: "A plan estimator" },
    });
    expect(
      new Generations(w.port, { scope: "ben:p:0", storage, newKey }).getState().pending,
    ).toBeNull();
    expect(
      new Generations(w.port, { scope: "ava:p:1", storage, newKey }).getState().pending,
    ).toBeNull();
    await reloaded.submit(w.base);
    expect(w.jobs().n).toBe(1);
    await w.worker.runNext();
    expect(w.provider.calls).toBe(1);
  });

  it("a definite refusal ends the request; nothing started; the words return to the draft", async () => {
    const w = await setup();
    const storage = new MemoryStorage();
    const g = new Generations(w.port, { scope: "ava:p:0", storage, newKey });
    g.setDraft("A plan estimator");
    w.refuseNext(true);
    await g.submit(w.base);
    expect(g.getState()).toMatchObject({
      pending: null,
      unanswered: false,
      draft: "A plan estimator",
      notice: "Not enough AI budget",
    });
    expect(w.jobs().n).toBe(0);
    expect(storage.m.size).toBe(0);
  });
});

// Job 002e1 (Astra's AppStudioReview follow-up on 0da94e6): an ACKNOWLEDGED generation must stay
// recoverable through a reload until a terminal readback; progress stays reachable after read
// failures; access loss clears it; another scope never sees it.
describe("002e1 an acknowledged generation survives a reload until its outcome is read", () => {
  it("queued job -> reload -> the same job is recovered, read to its end, then forgotten", async () => {
    const w = await setup();
    const storage = new MemoryStorage();
    const g = new Generations(w.port, { scope: "ava:p:0", storage, newKey });
    g.setDraft("A plan estimator");
    await g.submit(w.base);
    const id = g.getState().job?.id;
    expect(g.getState().job?.state).toBe("queued");
    const reloaded = new Generations(w.port, { scope: "ava:p:0", storage, newKey });
    expect(reloaded.getState().job?.id).toBe(id);
    expect(
      new Generations(w.port, { scope: "ben:p:0", storage, newKey }).getState().job,
    ).toBeNull();
    await reloaded.refresh();
    expect(reloaded.getState().job).toMatchObject({ id, state: "queued" });
    expect(storage.m.size).toBe(1);
    // It can't start another paid generation while this one is live.
    reloaded.setDraft("Something else");
    await reloaded.submit(w.base);
    expect(w.jobs().n).toBe(1);
    await w.worker.runNext();
    await reloaded.refresh();
    expect(reloaded.getState().job).toMatchObject({ id, state: "succeeded" });
    expect(storage.m.size).toBe(0);
    expect(
      new Generations(w.port, { scope: "ava:p:0", storage, newKey }).getState().job,
    ).toBeNull();
    expect(w.provider.calls).toBe(1);
  });

  it("failed progress reads keep the job and say so; checking again recovers; a 404 forgets it", async () => {
    const w = await setup();
    const storage = new MemoryStorage();
    const g = new Generations(w.port, { scope: "ava:p:0", storage, newKey });
    g.setDraft("A plan estimator");
    await g.submit(w.base);
    const id = g.getState().job?.id;
    w.failReads(3);
    for (let i = 0; i < 3; i++) await g.refresh();
    expect(g.getState()).toMatchObject({ job: { id }, readFailed: true });
    expect(storage.m.size).toBe(1);
    await g.refresh(); // "Check progress"
    expect(g.getState()).toMatchObject({ job: { id, state: "queued" }, readFailed: false });
    w.failReads(1, 404);
    await g.refresh();
    expect(g.getState().job).toBeNull();
    expect(g.getState().notice).toMatch(/no longer available/);
    expect(storage.m.size).toBe(0);
  });
});
