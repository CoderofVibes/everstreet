// Job 003wf1 (Astra's ConfiguredLifecycleHandoffReview item 2): the configured BUILD adapter. A
// founder's build through the normal route, run by the composition's own build worker on the
// real AnthropicProvider over synthetic model HTTP: accounting, budget refusal, cancellation, the
// build's configured time limit, and two compositions sharing one database while a build is live.
// In this process (each composition's state observable); fictional data, ephemeral keys.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Json } from "./customer-world.ts";
import { appBrowser, bootstrap, composeIn, FOUNDER, signInAs } from "./lifecycleWorld.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const MAINT = {
  interval_ms: 1_000,
  batch: 5,
  pass_budget_ms: 3_000,
  op_deadline_ms: 2_000,
  stop_timeout_ms: 3_000,
};
const until = async (cond: () => boolean | Promise<boolean>, what: string, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

async function installation() {
  const dir = mkdtempSync(join(tmpdir(), "lifecycle-builds-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const b = await bootstrap(dir, 1, MAINT);
  const job = (id: string) => {
    const db = openDb(b.db);
    try {
      return db
        .prepare(
          "SELECT state, failure_code, usage_state, usage_final, input_tokens, output_tokens, charged_microcents, lease_owner FROM build_jobs WHERE id = ?",
        )
        .get(id) as Json;
    } finally {
      db.close();
    }
  };
  const process = () => {
    const c = composeIn(b);
    cleanups.push(() => c.stop());
    c.start();
    return c;
  };
  let n = 0;
  const build = (call: ReturnType<typeof appBrowser>, seconds = 60) =>
    call(`/api/product-projects/${b.w.f.project}/builds`, "POST", {
      idempotency_key: `lifecycle-build-${String(++n).padStart(4, "0")}`,
      revision: 1,
      budget: {
        max_input_tokens: 10_000,
        max_output_tokens: 2_000,
        max_seconds: seconds,
        max_cost_cents: 10,
      },
    });
  const founder = async (c: ReturnType<typeof process>) => {
    const call = appBrowser(c.app);
    await signInAs(call, FOUNDER, b.ava);
    return call;
  };
  return { ...b, job, process, build, founder };
}

describe("003wf1 the configured build adapter", () => {
  it("a build runs on the real provider through the composition's worker; its usage is accounted exactly", async () => {
    const t = await installation();
    const a = t.process();
    const call = await t.founder(a);
    const r = await t.build(call);
    expect([201, 202], JSON.stringify(r.body).slice(0, 200)).toContain(r.status);
    const id = r.body.job.id as string;
    await until(() => t.job(id)?.state === "succeeded", "the build succeeding");
    // haiku: 10 and 50 cents per million tokens: 1500 in + 800 out = 55,000 microcents.
    expect(t.job(id)).toMatchObject({
      usage_final: 1,
      input_tokens: 1500,
      output_tokens: 800,
      charged_microcents: 55_000,
    });
    expect(t.model.calls.builds).toBe(1);
  }, 60_000);

  it("over the business's budget: refused at admission, nothing sent to the provider", async () => {
    const t = await installation();
    const a = t.process();
    const call = await t.founder(a);
    expect(
      (await call(`/api/businesses/${t.w.f.business}/build-budget`, "PUT", { limit_cents: 0 }))
        .status,
    ).toBe(200);
    const before = { ...t.model.calls };
    const r = await t.build(call);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Not enough AI budget/);
    expect(t.model.calls).toEqual(before);
  }, 60_000);

  it("cancelled while its generation is out: production's outcome, never resent", async () => {
    const t = await installation();
    const a = t.process();
    const call = await t.founder(a);
    const held = t.model.holdNextMessage();
    const id = (await t.build(call)).body.job.id as string;
    await held.entered;
    const sent = t.model.calls.messages;
    expect((await call(`/api/builds/${id}/cancel`, "POST", {})).status).toBeLessThan(300);
    await until(() => t.job(id)?.state === "cancelled", "the build cancelled");
    held.open();
    await new Promise((r) => setTimeout(r, 2_500)); // a worker poll
    expect(t.job(id)).toMatchObject({ state: "cancelled", failure_code: "cancelled" });
    expect(t.model.calls.messages).toBe(sent);
  }, 60_000);

  it("its configured time limit (10 s) stops a generation that never answers", async () => {
    const t = await installation();
    const a = t.process();
    const call = await t.founder(a);
    const held = t.model.holdNextMessage();
    const id = (await t.build(call, 10)).body.job.id as string;
    await held.entered;
    await until(() => t.job(id)?.state === "failed", "the build timing out", 20_000);
    expect(t.job(id)).toMatchObject({ state: "failed", failure_code: "timeout" });
    held.open();
  }, 60_000);

  it("a peer starting during a live build leaves it alone; it completes", async () => {
    const t = await installation();
    const a = t.process();
    const call = await t.founder(a);
    const held = t.model.holdNextMessage();
    const id = (await t.build(call)).body.job.id as string;
    await held.entered;
    const owner = t.job(id)?.lease_owner;
    t.process(); // B starts (its build worker recovers only lapsed leases)
    await new Promise((r) => setTimeout(r, 2_500)); // a poll of B's worker
    expect(t.job(id)).toMatchObject({ state: "running", lease_owner: owner });
    held.open();
    await until(() => t.job(id)?.state === "succeeded", "A's build completing");
  }, 60_000);

  it("its process stops during a live build: the survivor recovers it after the lease lapses, never resent", async () => {
    const t = await installation();
    const a = t.process();
    const call = await t.founder(a);
    const held = t.model.holdNextMessage();
    const id = (await t.build(call)).body.job.id as string;
    await held.entered;
    t.process(); // B stays alive
    await a.stop();
    held.open(); // A's provider answers late, to nobody (the fence)
    const sent = t.model.calls.messages;
    await until(() => t.job(id)?.state !== "running", "B recovering A's build", 50_000);
    const j = t.job(id);
    expect(j.state).not.toBe("succeeded"); // nothing fabricated from a late answer
    expect(t.model.calls.messages).toBe(sent);
    // Production's rule for a dispatched build whose worker is gone: held for reconciliation.
    expect(j).toMatchObject({
      state: "needs_reconciliation",
      failure_code: "outcome_unknown",
      lease_owner: null,
    });
  }, 90_000);
});
