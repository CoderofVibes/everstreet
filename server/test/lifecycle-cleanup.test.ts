// Job 003wf1 final correction (APPLICATION_COMPOSITION §12.10, Astra's final handoff review): the
// composition's stop is bounded EXACTLY by stop_timeout_ms (a cleanup reserve held back inside
// it), awaits and reports owner stoppers as well as the runtime's own work, and leaves no timer
// of its own behind. A build is held at the model by a transport that never answers and ignores
// its abort. The production composition, in this process; only the transports are injected.

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
const STOP = 3_000;
const MAINT = {
  interval_ms: 1_000,
  batch: 5,
  pass_budget_ms: 1_000,
  op_deadline_ms: 500,
  stop_timeout_ms: STOP,
};
/**
 * Every timer created while `f` runs: each must have fired or been cleared by the time it is
 * checked (the stop leaves no timer of its own behind). Direct, not a process-wide count.
 */
function watchTimers() {
  const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  const open = new Set<unknown>();
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    const h = real.set(
      (...a: unknown[]) => {
        open.delete(h);
        fn(...a);
      },
      ms,
      ...rest,
    );
    open.add(h);
    return h;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((h: unknown) => {
    open.delete(h);
    real.clear(h as never);
  }) as typeof clearTimeout;
  return {
    open: () => open.size,
    restore: () => {
      globalThis.setTimeout = real.set;
      globalThis.clearTimeout = real.clear;
    },
  };
}
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function heldBuild() {
  const dir = mkdtempSync(join(tmpdir(), "lifecycle-cleanup-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const b = await bootstrap(dir, 1, MAINT);
  const c = composeIn(b);
  cleanups.push(() => c.stop());
  c.start();
  const call = appBrowser(c.app);
  await signInAs(call, FOUNDER, b.ava);
  const held = b.model.holdNextMessage(); // never answers by itself, ignores abort
  const r = await call(`/api/product-projects/${b.w.f.project}/builds`, "POST", {
    idempotency_key: "lifecycle-cleanup-0001",
    revision: 1,
    budget: {
      max_input_tokens: 10_000,
      max_output_tokens: 2_000,
      max_seconds: 60,
      max_cost_cents: 10,
    },
  });
  const id = r.body.job.id as string;
  await held.entered; // the build worker's generation is out
  const job = () => {
    const db = openDb(b.db);
    try {
      return db.prepare("SELECT state FROM build_jobs WHERE id = ?").get(id) as Json;
    } finally {
      db.close();
    }
  };
  return { b, c, held, job };
}

describe("003wf1 owned cleanup, exactly bounded", () => {
  it("a build held by a non-cooperating transport: stop ends within stop_timeout_ms, the build worker's stop settled, nothing left running, no timer left", async () => {
    const t = await heldBuild();
    const w = watchTimers();
    cleanups.push(() => w.restore());
    const t0 = Date.now();
    await t.c.stop();
    const took = Date.now() - t0;
    expect(took).toBeLessThanOrEqual(STOP + 100); // the reserve is inside the deadline
    expect(t.c.lastStop()).toMatchObject({ owners_running: 0, work_running: 0 });
    t.held.open(); // the provider answers only now, to nobody
    await settle(300);
    // Nothing fabricated from the late answer; the job is left for recovery as production says.
    expect(t.job().state).not.toBe("succeeded");
    expect(w.open()).toBe(0); // every timer the stop made has fired or been cleared
  }, 60_000);

  it("a build that finishes during the drain: its worker's stop wins the race and clears the losing timer", async () => {
    const t = await heldBuild();
    const w = watchTimers();
    cleanups.push(() => w.restore());
    const stopping = t.c.stop();
    await settle(100);
    t.held.open(); // the build completes while the stop is draining
    await stopping;
    expect(t.c.lastStop()).toMatchObject({ forced: false, owners_running: 0, work_running: 0 });
    expect(t.job().state).toBe("succeeded");
    expect(w.open()).toBe(0); // the drain won: its losing deadline timers were cleared
  }, 60_000);
});
