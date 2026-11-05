// Job 003wf1 (Astra's ConfiguredLifecycleHandoffReview item 3): shutdown across the WHOLE transport
// response lifetime. The model provider answers its headers, then holds the body (a
// non-cooperating transport that never ends the held read itself). Stop must still end the
// composition's own work: the runtime's run and its timer finish, the request is answered,
// nothing is written after the gates close, no unhandled error, no result fabricated; the
// dispatched request stays in doubt and the next composition records it unknown without
// resending it. The production composition, in this process; only the transports are injected.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import { appBrowser, bootstrap, composeIn, signInAs } from "./lifecycleWorld.ts";

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
const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

describe("003wf1 a held response BODY at stop", () => {
  it("the run, its timer and the request all end; nothing written after close; unknown, never resent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lifecycle-body-"));
    cleanups.push(() =>
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    );
    const b = await bootstrap(dir, 1, MAINT);
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    cleanups.push(() => void process.off("unhandledRejection", onUnhandled));
    const c = composeIn(b);
    cleanups.push(() => c.stop());
    c.start();
    const call = appBrowser(c.app);
    await signInAs(call, CUSTOMER, b.cara);
    const p = await call(`/api/customer/offers/${b.offer}/prepare`, "POST", {
      idempotency_key: "lifecycle-body-0001",
      input: INVOICE,
    });
    const u = p.body.use as Json;
    expect(
      (await call(`/api/customer/uses/${u.id}/confirm`, "POST", b.w.signed(u.envelope))).body.use
        .state,
    ).toBe("reserved");
    const held = b.model.holdNextBody();
    const executing = call(`/api/customer/uses/${u.id}/execute`, "POST", {});
    await held.entered; // headers received; the body is held
    const sent = b.model.calls.messages;
    const t0 = Date.now();
    await c.stop();
    expect(Date.now() - t0).toBeLessThan(MAINT.stop_timeout_ms + 1_500);
    expect((await executing).status).toBe(503);
    // The composition's own work ended: no provider request still running here.
    expect(c.lastStop()).toMatchObject({ work_running: 0 });
    held.open(); // the body arrives only now, to nobody
    await new Promise((r) => setTimeout(r, 100));
    expect(unhandled).toEqual([]);
    // Nothing fabricated: the dispatched request is still in doubt in the records.
    const db = openDb(b.db);
    const row = db
      .prepare(
        "SELECT state, output, charged_microcents FROM runtime_invocations WHERE purpose = 'customer_use'",
      )
      .get() as Json;
    db.close();
    expect(row).toEqual({ state: "running", output: null, charged_microcents: 0 });
    // The next composition (this process gone) records it unknown and never resends it.
    const next = composeIn(b);
    cleanups.push(() => next.stop());
    next.start();
    const db2 = openDb(b.db);
    const after = db2
      .prepare(
        "SELECT state, failure_class FROM runtime_invocations WHERE purpose = 'customer_use'",
      )
      .get() as Json;
    db2.close();
    expect(after).toEqual({ state: "unknown", failure_class: "outcome_unknown" });
    expect(b.model.calls.messages).toBe(sent);
    await next.stop();
  }, 60_000);
});
