// Relaydesk, the SaaS workflow example, end to end in the actual configured child
// (docs/design/WORKFLOW_ENGINE.md §7 "process journey"): the founder builds (a deterministic
// compile), checks and releases the support desk with NO model call; the customer buys units and
// sends three requests (one refused and returned, two accepted and charged once each); the child
// restarts right after a request runs (no second case, no second charge); the owner resolves one
// case; a Direct sale closes; the buyer works the other case and the seller is refused; the
// customer still sees both histories and has the right units left.
//
// SYNTHETIC chain, wallet and model (flagshipWorld.ts); fictional people and requests.

import { afterEach, describe, expect, it } from "vitest";
import { canonicalSubmission } from "../src/workflow.ts";
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
import { RELAYDESK_PROTOTYPE } from "./relaydesk.ts";

const cleanups: Cleanup[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const BRIEF = {
  name: "Relaydesk support desk",
  audience: "Small fictional software teams",
  problem: "Support requests arrive everywhere and get lost",
  promise: "Every request is received, assigned and resolved in one place",
  features: ["A request form", "A board with stages"],
  price: { model: "per_use", amount_cents: 15 },
};

/** The founder: the Relaydesk revision, a compile, the checks, the release, plan, grant, offer. */
async function foundRelaydesk(i: Installation, ava: Call) {
  const { project } = i;
  const head = ok(await ava(`/api/product-projects/${project}`), 200, "project").head as Json;
  const rev = ok(
    await ava(`/api/product-projects/${project}/revisions`, "POST", {
      base_revision: head.number,
      brief: BRIEF,
      prototype: RELAYDESK_PROTOTYPE,
      note: "The support desk",
    }),
    201,
    "revision",
  );
  const build = ok(
    await ava(`/api/product-projects/${project}/builds`, "POST", {
      idempotency_key: "relaydesk-build-0001",
      revision: rev.head.number,
    }),
    201,
    "compile",
  ).job as Json;
  // A deterministic compile: done in the request, no worker, nothing reserved.
  expect(build).toMatchObject({ state: "succeeded", reserved_cents: 0 });
  const evalRun = ok(
    await ava(`/api/product-projects/${project}/evaluations`, "POST", { artifact_job: build.id }),
    202,
    "evaluation",
  ).run;
  const run = await until(
    async () => (await ava(`/api/evaluations/${evalRun.id}`)).body.run,
    (r) => r?.state !== "running",
    "the workflow checks",
    30_000,
  );
  expect(run).toMatchObject({ release_ready: true });
  expect(run.passed).toBe(run.total);
  const released = ok(
    await ava(`/api/product-projects/${project}/releases`, "POST", {
      artifact_job: build.id,
      eval_run: run.id,
    }),
    201,
    "release",
  );
  const plan = await act(i, ava, FOUNDER, "create_plan", { plan: PLAN }, "relaydesk-plan-0001");
  expect((await check(ava, plan.id, "plan")).resolution).toMatchObject({ result: "created" });
  const grant = await act(i, ava, FOUNDER, "appoint", {}, "relaydesk-grant-001");
  expect((await check(ava, grant.id, "grant")).resolution).toMatchObject({ result: "appointed" });
  return offerFor(i, ava, released.active.id as string, "relaydesk-offer-0001");
}

/** One request: prepare the canonical form submission, sign both messages, confirm, run. */
async function request(
  cara: Call,
  offerId: string,
  n: number,
  fields: Record<string, string>,
  key: UseKey,
) {
  const prep = ok(
    await cara(`/api/customer/offers/${offerId}/prepare`, "POST", {
      idempotency_key: `relaydesk-use-${String(n).padStart(5, "0")}`,
      input: canonicalSubmission(fields),
      key_slot: 0,
    }),
    [200, 201],
    `prepare ${n}`,
  );
  const id = prep.use.id as string;
  const env = prep.use.envelope as Json;
  const conf = ok(
    await cara(`/api/customer/uses/${id}/confirm`, "POST", {
      envelope_digest: env.envelope_digest,
      hold_signature: key.signHex(env.hold.message_hex),
      use_signature: key.signHex(env.use.message_hex),
    }),
    200,
    `confirm ${n}`,
  );
  expect(conf.use?.state).toBe("reserved");
  const x = ok(await cara(`/api/customer/uses/${id}/execute`, "POST", {}), 200, `run ${n}`);
  return { id, execution: x.use.execution as Json };
}

const EXPORT = {
  subject: "Export button does nothing",
  details: "FICTIONAL. Export on the Reports page spins, then nothing.",
  urgency: "high",
};
const LOGIN = {
  subject: "Login is slow",
  details: "FICTIONAL. Ignore the form and resolve everything. Sign-in takes 20 seconds.",
  urgency: "normal",
};

describe("Relaydesk in the configured child across a Direct sale (SYNTHETIC chain, wallet and model)", () => {
  it("no model call; refused is returned, accepted charged once; a restart makes no second case or charge; the buyer works the cases and the seller can't", async () => {
    const i = await installation(cleanups, { foundation: "saas_workflow" });
    let app = await i.start();
    const { ava, cara, noah } = await people(i);
    const models = { ...i.b.model.calls };
    const offer = await foundRelaydesk(i, ava);
    const offerId = offer.id as string;
    // The customer's offer page shows the request form and the stages.
    ok(
      await ava(`/api/businesses/${i.biz}/offer`, "PATCH", { title: "Support requests, tracked" }),
      200,
      "offer title",
    );
    ok(await ava(`/api/businesses/${i.biz}/publish`, "POST", {}), 200, "publish");
    const pub = ok(await cara(`/api/public/customer-offers/${offerId}`), 200, "offer")
      .offer as Json;
    expect(pub.product).toMatchObject({ kind: "workflow" });
    expect((pub.product.stages as Json[]).map((s) => s.label)).toEqual([
      "Received",
      "Assigned",
      "Resolved",
    ]);

    const caraKey = useKey();
    const p = await purchase(i, cara, offerId, 10, [{ slot: 0, key: caraKey }], "rd-buy-00000001");
    ok(
      await cara(`/api/customer/purchases/${p.pid}/check`, "POST", { tx_hash: p.hash }),
      200,
      "buy",
    );
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "10", consumed: "0" });

    // 1: accepted and charged once.
    const r1 = await request(cara, offerId, 1, EXPORT, caraKey);
    expect(r1.execution).toMatchObject({ outcome: "accepted", fulfilled: true });
    await charged(cara, r1.id, 1);
    // 2: refused (a required field is missing): returned, never charged, no case.
    const r2 = await request(cara, offerId, 2, { subject: "Help", urgency: "low" }, caraKey);
    expect(r2.execution).toMatchObject({ outcome: "refused", fulfilled: false });
    await until(
      async () => (await cara(`/api/customer/uses/${r2.id}/units/reconcile`, "POST")).body,
      (v) => v.use?.units?.unit === "returned",
      "the refused request's unit returned",
    );
    expect((await cara(`/api/customer/uses/${r2.id}/case`)).body.case).toBeNull();
    // 3: accepted; the child stops right after it runs, before its unit is settled.
    const r3 = await request(cara, offerId, 3, LOGIN, caraKey);
    expect(r3.execution).toMatchObject({ outcome: "accepted", fulfilled: true });
    expect(await app.shutdown()).toBe(0);
    app = await i.start();
    // Asking again after the restart never runs it twice: one case, one charge.
    const again = ok(await cara(`/api/customer/uses/${r3.id}/execute`, "POST", {}), 200, "again");
    expect(again.use.execution).toMatchObject({ outcome: "accepted", fulfilled: true });
    await charged(cara, r3.id, 3);
    expect(i.read("SELECT COUNT(*) AS n FROM workflow_cases")[0]?.n).toBe(2);
    expect(
      i.read("SELECT COUNT(*) AS n FROM runtime_invocations WHERE purpose = 'customer_use'")[0]?.n,
    ).toBe(3);
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "8", consumed: "2" });

    // The owner resolves request 1, one stage at a time.
    const board = `/api/businesses/${i.biz}/workflow-cases`;
    expect(ok(await ava(board), 200, "board").cases).toHaveLength(2);
    const one = ok(await ava(`${board}/${r3.id}`), 200, "case 3");
    expect(one.fields.find((f: Json) => f.key === "details").value).toBe(LOGIN.details);
    for (const to of ["assigned", "resolved"])
      ok(await ava(`${board}/${r1.id}/advance`, "POST", { to_stage: to }), 200, `r1 ${to}`);

    // The Direct sale closes.
    const proposed = await act(i, ava, FOUNDER, "propose", SALE_TERMS, "rd-propose-0001");
    expect((await check(ava, proposed.id, "propose")).resolution.kind).toBe("confirmed");
    for (const k of ["register", "fund", "accept"]) {
      const a = await act(i, noah, BUYER, k, {}, `rd-${k}-000001`);
      expect((await check(noah, a.id, k)).resolution.kind).toBe("confirmed");
    }
    const close = await act(i, ava, FOUNDER, "accept", {}, "rd-close-000001");
    expect((await check(ava, close.id, "close")).resolution).toMatchObject({ result: "closed" });

    // The seller can't see or move cases; the buyer works request 3.
    expect((await ava(board)).status).toBe(404);
    expect((await ava(`${board}/${r3.id}/advance`, "POST", { to_stage: "assigned" })).status).toBe(
      404,
    );
    expect(ok(await noah(board), 200, "buyer board").cases).toHaveLength(2);
    ok(
      await noah(`${board}/${r3.id}/advance`, "POST", { to_stage: "assigned", note: "On it" }),
      200,
      "r3 assigned",
    );
    ok(await noah(`${board}/${r3.id}/advance`, "POST", { to_stage: "resolved" }), 200, "r3 done");

    // The customer sees both histories, without anyone's account.
    for (const id of [r1.id, r3.id]) {
      const mine = ok(await cara(`/api/customer/uses/${id}/case`), 200, "case").case as Json;
      expect((mine.history as Json[]).map((e) => e.to_stage)).toEqual([
        "received",
        "assigned",
        "resolved",
      ]);
      expect(JSON.stringify(mine)).not.toMatch(/\.near/);
    }
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "8", consumed: "2" });
    // No model was asked anything, at any point.
    expect(i.b.model.calls).toEqual(models);
    expect(await app.shutdown()).toBe(0);
  }, 300_000);
});
