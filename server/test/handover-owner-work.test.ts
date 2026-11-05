// Job 003wf3 (MANAGED_HANDOVER.md §10.3 S-7, S-17, S-18; §14.1 boundaries 3, 4, 7): the seller's
// own work across a managed Gated handover, through the configured composition in one process
// (handoverWorld.ts). Evaluations run on the composition's runtime over the synthetic model; builds
// are requested through the composition's routes and run by a BuildWorker over the SAME store with
// the same production build provider configuration (the composition is never started, so its own
// worker doesn't run: the claim and the dispatch are driven here, deterministically). The ownership
// change is the real one: the coordinator's close, reconciled through V3Intents. Fictional data.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parseAiConfig } from "../src/ai-config.ts";
import { AnthropicProvider, httpsTransport } from "../src/anthropic.ts";
import { Builds, BuildWorker } from "../src/builds.ts";
import type { Json } from "./customer-world.ts";
import { BUYER, type HandoverWorld, handoverWorld } from "./handoverWorld.ts";
import { FICTIONAL_KEY, FOUNDER } from "./lifecycleWorld.ts";

const worlds: HandoverWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.cleanup();
});
const world = async () => {
  const w = await handoverWorld();
  worlds.push(w);
  return w;
};
const sellerAccepts = async (w: HandoverWorld) => {
  const c = await w.act(w.seller, FOUNDER, "accept");
  expect(c.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closing" });
};
async function passUntil(w: HandoverWorld, done: (state: string) => boolean, max = 40) {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    const r = await w.coordinator.pass();
    seen.push(r[w.biz] as string);
    if (r[w.biz] === "busy") await new Promise((d) => setTimeout(d, 100));
    if (done(String(w.handoverRow()?.state))) return seen;
  }
  throw new Error(`still ${w.handoverRow()?.state} after ${max} passes: ${seen.join(", ")}`);
}
const until = async (cond: () => boolean, what: string, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !cond()) await new Promise((r) => setTimeout(r, 50));
  expect(cond(), what).toBe(true);
};

/** The composition's build provider configuration, for a worker over the same store. */
function workerFor(w: HandoverWorld) {
  const aiFile = String((w.b.config.model as Json).ai_config_file);
  const ai = parseAiConfig(readFileSync(aiFile, "utf8"), FICTIONAL_KEY);
  if (!ai.ok) throw new Error(ai.reason);
  const provider = new AnthropicProvider(
    ai.config,
    httpsTransport(ai.apiKey, { fetchImpl: w.b.model.fetch() }),
  );
  const store = w.composed.store;
  const builds = new Builds(store.db, store, provider, {
    operatorCeilingCents: ai.config.operatorCeilingCents,
  });
  return new BuildWorker(builds, provider, { id: "test-worker", leaseMs: 3_000, heartbeatMs: 200 });
}
let n = 0;
const requestBuild = (w: HandoverWorld) =>
  w.seller(`/api/product-projects/${w.b.w.f.project}/builds`, "POST", {
    idempotency_key: `handover-build-${String(++n).padStart(4, "0")}`,
    revision: 1,
    budget: {
      max_input_tokens: 10_000,
      max_output_tokens: 2_000,
      max_seconds: 60,
      max_cost_cents: 10,
    },
  });
const job = (w: HandoverWorld, id: string) =>
  w.rows(
    "SELECT state, failure_code, dispatched_at, usage_state, usage_final, charged_microcents, artifact_digest FROM build_jobs WHERE id = ?",
    id,
  )[0] as Json;

describe("003wf3 S-18: builds across the handover", () => {
  it("claimed but not dispatched when the gate closes: requeued unsent; not claimed while gated; requests and retries refused; fenced (cancelled) once the business changed hands; nothing ever reaches the provider", async () => {
    const w = await world();
    const worker = workerFor(w);
    const r = await requestBuild(w);
    expect([201, 202], JSON.stringify(r.body).slice(0, 300)).toContain(r.status);
    const id = r.body.job.id as string;
    const claimed = worker.claim();
    expect(claimed?.job.id).toBe(id);
    // A second build, cancelled before the closing: retrying it is a new request.
    const other = await requestBuild(w);
    const otherId = other.body.job.id as string;
    expect((await w.seller(`/api/builds/${otherId}/cancel`, "POST", {})).status).toBe(200);
    expect(job(w, otherId).state).toBe("cancelled");
    await w.toBuyerAccepted();
    await sellerAccepts(w);
    // The dispatch point: the gate is checked in the dispatch transaction, after the claim.
    await worker.run(claimed?.job as never, claimed?.attempt as number);
    expect(job(w, id)).toMatchObject({ state: "queued", dispatched_at: null });
    expect(
      w.rows("SELECT type FROM build_events WHERE job_id = ?", id).map((e) => e.type),
    ).toContain("requeued");
    expect(worker.claim()).toBeNull(); // a gated business's queued jobs aren't claimed
    const again = await requestBuild(w);
    expect([again.status, again.body.code]).toEqual([409, "handover_in_progress"]);
    const retry = await w.seller(`/api/builds/${otherId}/retry`, "POST", {
      idempotency_key: "handover-build-retry-0001",
    });
    expect([retry.status, retry.body.code]).toEqual([409, "handover_in_progress"]);
    // Queued, undispatched builds don't block the close (§14.1 boundary 7).
    await passUntil(w, (s) => s === "released_to_buyer");
    // After the close the seller's job is fenced at the next claim: never sent, never applied.
    expect(worker.claim()).toBeNull();
    expect(job(w, id)).toMatchObject({ state: "cancelled", failure_code: "ownership_changed" });
    expect(w.b.model.calls.builds).toBe(0);
  }, 90_000);

  it("already dispatched when the gate closes: the close isn't blocked; after the business changed hands the build is fenced, its late answer is never applied, and its usage stays unknown until a receipt", async () => {
    const w = await world();
    const worker = workerFor(w);
    const r = await requestBuild(w);
    const id = r.body.job.id as string;
    const held = w.b.model.holdNextMessage();
    const claimed = worker.claim();
    const running = worker.run(claimed?.job as never, claimed?.attempt as number);
    await held.entered;
    expect(job(w, id).dispatched_at).not.toBeNull();
    await w.toBuyerAccepted();
    await sellerAccepts(w);
    await passUntil(w, (s) => s === "released_to_buyer");
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
    // The worker's heartbeat sees the owner changed: fenced, and the attempt is aborted.
    await until(() => job(w, id).state === "needs_reconciliation", "the dispatched build fenced");
    held.open(); // the provider's answer arrives late, to an aborted attempt
    await running;
    expect(job(w, id)).toMatchObject({
      state: "needs_reconciliation",
      failure_code: "ownership_changed",
      usage_final: 0,
      artifact_digest: null,
    });
    expect(String(job(w, id).usage_state)).not.toBe("final");
    expect(w.b.model.calls.builds).toBe(1);
    // The buyer can't release or use it: no artifact exists for that job.
    const rel = await w.buyer(`/api/product-projects/${w.b.w.f.project}/releases`, "POST", {
      artifact_job: id,
      eval_run: "none",
    });
    expect(rel.status).toBeGreaterThanOrEqual(400);
  }, 90_000);
});

describe("003wf3 S-17: an evaluation run across the handover", () => {
  it("a case already dispatched blocks readiness until it ends; the next case is refused at its dispatch; the run ends stopped; then the close", async () => {
    const w = await world();
    const artifact = (
      w.rows("SELECT artifact_job FROM runtime_releases WHERE state = 'active'")[0] as Json
    ).artifact_job as string;
    await w.toBuyerAccepted();
    const before = w.b.model.calls.messages;
    const evalInvocations = () =>
      w.rows("SELECT 1 FROM runtime_invocations WHERE purpose = 'evaluation'").length;
    const invBefore = evalInvocations();
    const held = w.b.model.holdNextMessage();
    const started = await w.seller(`/api/product-projects/${w.b.w.f.project}/evaluations`, "POST", {
      artifact_job: artifact,
    });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    const runId = started.body.run.id as string;
    await held.entered; // case 1 is at the provider
    await sellerAccepts(w);
    const r1 = await w.coordinator.pass();
    expect(r1[w.biz]).toBe("not_ready:owner_work_running");
    expect(w.rows("SELECT 1 FROM close_orders")).toHaveLength(0);
    held.open();
    const run = () => w.rows("SELECT state, results FROM eval_runs WHERE id = ?", runId)[0] as Json;
    await until(() => run().state !== "running", "the run ending");
    expect(run().state).toBe("stopped");
    const results = JSON.parse(String(run().results)) as Json[];
    expect(results[0]?.raw.state).toBe("completed");
    expect(results.slice(1).every((c) => c.raw.state === "not_run")).toBe(true);
    expect(String(results[1]?.raw.failure)).toMatch(/is closing .*changes are paused/);
    expect(w.b.model.calls.messages - before).toBe(1); // only the case already dispatched
    expect(evalInvocations() - invBefore).toBe(1);
    await passUntil(w, (s) => s === "released_to_buyer");
    // A new run by the seller is refused after the close (no longer the owner).
    const late = await w.seller(`/api/product-projects/${w.b.w.f.project}/evaluations`, "POST", {
      artifact_job: artifact,
    });
    expect(late.status).toBeGreaterThanOrEqual(400);
  }, 90_000);
});
