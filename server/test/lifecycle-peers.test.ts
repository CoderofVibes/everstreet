// Job 003wf1 (Astra's ConfiguredLifecycleHandoffReview items 2 and 4): two configured compositions
// sharing ONE durable database (separate instances, presence and leases, in this process so each
// one's own state is observable): an evaluation and a build are left alone while their process
// is alive, and recovered by the survivor once their process is gone. The production
// composition, the real AnthropicRuntime/AnthropicProvider over synthetic model HTTP; fictional
// data and ephemeral keys.

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
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

async function installation() {
  const dir = mkdtempSync(join(tmpdir(), "lifecycle-peers-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const b = await bootstrap(dir, 1, MAINT);
  const read = <T = Json>(sql: string, ...args: (string | number)[]) => {
    const db = openDb(b.db);
    try {
      return db.prepare(sql).all(...args) as T[];
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
  return { ...b, read, process };
}

describe("003wf1 an evaluation and its process", () => {
  it("a peer starting while the evaluation runs leaves it alone; it completes", async () => {
    const t = await installation();
    const a = t.process();
    const call = appBrowser(a.app);
    await signInAs(call, FOUNDER, t.ava);
    const held = t.model.holdNextMessage();
    const started = await call(`/api/product-projects/${t.w.f.project}/evaluations`, "POST", {
      artifact_job: t.w.f.job,
    });
    expect(started.status).toBe(202);
    await held.entered; // A's evaluation is waiting on its first provider answer
    t.process(); // B starts: its start-up recovery runs now
    expect(t.read("SELECT state FROM eval_runs WHERE id = ?", started.body.run.id)[0]).toEqual({
      state: "running",
    });
    held.open();
    await until(
      async () =>
        (await call(`/api/evaluations/${started.body.run.id}`)).body.run.state === "complete",
      "A's evaluation completing",
    );
  }, 60_000);

  it("its process stops while a peer stays alive: the survivor stops that evaluation (bounded), nothing resent", async () => {
    const t = await installation();
    const a = t.process();
    const call = appBrowser(a.app);
    await signInAs(call, FOUNDER, t.ava);
    const held = t.model.holdNextMessage();
    const started = await call(`/api/product-projects/${t.w.f.project}/evaluations`, "POST", {
      artifact_job: t.w.f.job,
    });
    await held.entered;
    const b = t.process();
    const id = started.body.run.id as string;
    expect(t.read("SELECT state FROM eval_runs WHERE id = ?", id)[0]).toEqual({ state: "running" });
    await a.stop(); // A is gone (its presence removed); its loop was fenced, not finished
    held.open();
    const sent = t.model.calls.messages;
    // B, still alive, notices at its next presence tick (every 10 s).
    await until(
      () =>
        (t.read("SELECT state FROM eval_runs WHERE id = ?", id)[0] as Json)?.state === "stopped",
      "B stopping A's evaluation",
      15_000,
    );
    expect(b.lastStop()).toBeNull(); // B is still running
    // The in-doubt case request: recorded unknown, never resent.
    expect(
      t
        .read("SELECT state FROM runtime_invocations WHERE eval_run = ?", id)
        .map((r) => (r as Json).state),
    ).toEqual(["unknown"]);
    expect(t.model.calls.messages).toBe(sent);
  }, 60_000);
});
