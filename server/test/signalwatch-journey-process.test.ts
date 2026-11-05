// Signalwatch, the agent service example, end to end in the actual configured child
// (docs/design/AGENT_ANALYSIS.md §6): the founder compiles the release-notes form (no build model),
// checks it on the runtime (the synthetic model's labelled stand-in analyst answers the analysis
// request), releases and offers it; the customer buys units and sends release notes: a delivered
// analysis is charged once, a recipe is refused and returned; the child restarts; a quiet release
// is still a delivered analysis; a Direct sale closes and the buyer serves the next request.
//
// SYNTHETIC chain, wallet and model (flagshipWorld.ts); fictional people and suppliers.

import { afterEach, describe, expect, it } from "vitest";
import { canonicalSubmission } from "../src/workflow.ts";
import { SIGNALWATCH_BRIEF, SIGNALWATCH_PROTOTYPE } from "./analyst.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import {
  act,
  BUYER,
  type Call,
  type Cleanup,
  charged,
  check,
  type Installation,
  installation,
  offerFor,
  ok,
  PLAN,
  people,
  purchase,
  SALE_TERMS,
  type UseKey,
  until,
  useKey,
} from "./flagshipWorld.ts";
import { FOUNDER } from "./lifecycleWorld.ts";

const cleanups: Cleanup[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const RELIES = "We call the Ledger Export API every night and sign in with SSO.";
const REMOVAL =
  "FICTIONAL. Northbeam API v4.2 release notes\n- Added dark mode.\n- Removed the Ledger Export API endpoint /v1/export on 2026-12-01.";
const QUIET = "FICTIONAL. Northbeam v4.3 release notes\n- New colour themes.\n- Faster pages.";
const SSO =
  "FICTIONAL. Northbeam v5.0 release notes\n- SSO sign-in is being removed for the Starter plan on 2027-01-15.";

async function foundSignalwatch(i: Installation, ava: Call) {
  const { biz, project } = i;
  const head = ok(await ava(`/api/product-projects/${project}`), 200, "project").head as Json;
  const rev = ok(
    await ava(`/api/product-projects/${project}/revisions`, "POST", {
      base_revision: head.number,
      brief: SIGNALWATCH_BRIEF,
      prototype: SIGNALWATCH_PROTOTYPE,
      note: "The release-notes watcher",
    }),
    201,
    "revision",
  );
  const build = ok(
    await ava(`/api/product-projects/${project}/builds`, "POST", {
      idempotency_key: "signalwatch-build-01",
      revision: rev.head.number,
    }),
    201,
    "compile",
  ).job as Json;
  expect(build).toMatchObject({ state: "succeeded", reserved_cents: 0 });
  ok(await ava(`/api/businesses/${biz}/runtime-budget`, "PUT", { limit_cents: 100 }), 200, "rt");
  const evalRun = ok(
    await ava(`/api/product-projects/${project}/evaluations`, "POST", { artifact_job: build.id }),
    202,
    "evaluation",
  ).run;
  const run = await until(
    async () => (await ava(`/api/evaluations/${evalRun.id}`)).body.run,
    (r) => r?.state !== "running",
    "the analysis checks",
    60_000,
  );
  expect(run).toMatchObject({ release_ready: true, passed: 5, total: 5 });
  const released = ok(
    await ava(`/api/product-projects/${project}/releases`, "POST", {
      artifact_job: build.id,
      eval_run: run.id,
    }),
    201,
    "release",
  );
  const plan = await act(i, ava, FOUNDER, "create_plan", { plan: PLAN }, "signalwatch-plan-01");
  expect((await check(ava, plan.id, "plan")).resolution).toMatchObject({ result: "created" });
  const grant = await act(i, ava, FOUNDER, "appoint", {}, "signalwatch-grant-1");
  expect((await check(ava, grant.id, "grant")).resolution).toMatchObject({ result: "appointed" });
  return offerFor(i, ava, released.active.id as string, "signalwatch-offer-01");
}

async function request(who: Call, offerId: string, n: number, notes: string, key: UseKey) {
  const prep = ok(
    await who(`/api/customer/offers/${offerId}/prepare`, "POST", {
      idempotency_key: `signalwatch-use-${String(n).padStart(5, "0")}`,
      input: canonicalSubmission({ notes, relies: RELIES }),
      key_slot: 0,
    }),
    [200, 201],
    `prepare ${n}`,
  );
  const id = prep.use.id as string;
  const env = prep.use.envelope as Json;
  const conf = ok(
    await who(`/api/customer/uses/${id}/confirm`, "POST", {
      envelope_digest: env.envelope_digest,
      hold_signature: key.signHex(env.hold.message_hex),
      use_signature: key.signHex(env.use.message_hex),
    }),
    200,
    `confirm ${n}`,
  );
  expect(conf.use?.state).toBe("reserved");
  const x = ok(await who(`/api/customer/uses/${id}/execute`, "POST", {}), 200, `run ${n}`);
  return { id, execution: x.use.execution as Json };
}

describe("Signalwatch in the configured child across a Direct sale (SYNTHETIC chain, wallet and model)", () => {
  it("checks on the runtime; delivered analyses charged once, a refusal returned; a restart; the buyer serves the next request", async () => {
    const i = await installation(cleanups, { foundation: "agent_service" });
    let app = await i.start();
    const { ava, cara, noah } = await people(i);
    const offerId = (await foundSignalwatch(i, ava)).id as string;
    const caraKey = useKey();
    const p = await purchase(i, cara, offerId, 10, [{ slot: 0, key: caraKey }], "sw-buy-000000001");
    ok(
      await cara(`/api/customer/purchases/${p.pid}/check`, "POST", { tx_hash: p.hash }),
      200,
      "buy",
    );

    // 1: a delivered analysis with a flag quoting the notes, charged once.
    const r1 = await request(cara, offerId, 1, REMOVAL, caraKey);
    expect(r1.execution).toMatchObject({ outcome: "analyzed", fulfilled: true });
    await charged(cara, r1.id, 1);
    const result = ok(await cara(`/api/customer/uses/${r1.id}/result`), 200, "result").result;
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: "high",
        evidence: "Removed the Ledger Export API endpoint /v1/export on 2026-12-01.",
      }),
    ]);
    // 2: not release notes: refused and returned.
    const r2 = await request(cara, offerId, 2, "Lemon cake: butter, sugar, eggs.", caraKey);
    expect(r2.execution).toMatchObject({ outcome: "refused", fulfilled: false });
    await until(
      async () => (await cara(`/api/customer/uses/${r2.id}/units/reconcile`, "POST")).body,
      (v) => v.use?.units?.unit === "returned",
      "the refusal's unit returned",
    );
    // A restart, then 3: a quiet release is still a delivered analysis (no flags), charged once.
    expect(await app.shutdown()).toBe(0);
    app = await i.start();
    const r3 = await request(cara, offerId, 3, QUIET, caraKey);
    expect(r3.execution).toMatchObject({ outcome: "analyzed", fulfilled: true });
    await charged(cara, r3.id, 3);
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "8", consumed: "2" });

    // The Direct sale closes.
    const proposed = await act(i, ava, FOUNDER, "propose", SALE_TERMS, "sw-propose-00001");
    expect((await check(ava, proposed.id, "propose")).resolution.kind).toBe("confirmed");
    for (const k of ["register", "fund", "accept"]) {
      const a = await act(i, noah, BUYER, k, {}, `sw-${k}-0000001`);
      expect((await check(noah, a.id, k)).resolution.kind).toBe("confirmed");
    }
    const close = await act(i, ava, FOUNDER, "accept", {}, "sw-close-0000001");
    expect((await check(ava, close.id, "close")).resolution).toMatchObject({ result: "closed" });

    // 4: served under the buyer; the earlier results are still the customer's.
    const r4 = await request(cara, offerId, 4, SSO, caraKey);
    expect(r4.execution).toMatchObject({ outcome: "analyzed", fulfilled: true });
    await charged(cara, r4.id, 4);
    expect(
      ok(await cara(`/api/customer/uses/${r1.id}/result`), 200, "earlier").result.findings,
    ).toHaveLength(1);
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "7", consumed: "3" });
    // The seller no longer reaches the product's runtime records.
    expect((await ava(`/api/product-projects/${i.project}/runtime`)).status).toBe(404);
    expect(await app.shutdown()).toBe(0);
  }, 300_000);
});
