// The analysis engine end to end through the real app routes (docs/design/AGENT_ANALYSIS.md):
// Signalwatch's founder saves the release-notes form, compiles it (no build model), checks it on
// the runtime (the labelled stand-in analyst answers), releases and offers it; a customer's
// delivered analysis is fulfilled; text that isn't release notes and a malformed submission are
// refused (the second before anything is sent); an answer quoting text that isn't in the notes
// is invalid and never shown. The chain is the labelled fixture double. Fictional data only.

import { describe, expect, it } from "vitest";
import { parseOffer, parseResult } from "../../web/src/customerApi.ts";
import { canonicalSubmission } from "../src/workflow.ts";
import { SIGNALWATCH_BRIEF, SIGNALWATCH_PROTOTYPE } from "./analyst.ts";
import { customerWorld, type Json, SyntheticProtection } from "./customer-world.ts";

const RELIES = "We call the Ledger Export API every night and sign in with SSO.";
const NOTES =
  "FICTIONAL. Northbeam API v4.2 release notes\n- Added dark mode.\n- Removed the Ledger Export API endpoint /v1/export on 2026-12-01.";

async function signalwatch() {
  const protection = new SyntheticProtection();
  const w = await customerWorld({
    bare: true,
    foundation: "agent_service",
    customer: { protection },
  });
  const { owner, f } = w;
  const head = (await owner(`/api/product-projects/${f.project}`)).body.head?.number ?? 1;
  const saved = await owner(`/api/product-projects/${f.project}/revisions`, "POST", {
    base_revision: head,
    brief: SIGNALWATCH_BRIEF,
    prototype: SIGNALWATCH_PROTOTYPE,
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(201);
  const builds = await owner(`/api/product-projects/${f.project}/builds`);
  expect(builds.body).toMatchObject({ engine: "analysis", availability: { available: true } });
  const build = await owner(`/api/product-projects/${f.project}/builds`, "POST", {
    idempotency_key: "signalwatch-build-0001",
    revision: head + 1,
  });
  expect(build.status, JSON.stringify(build.body)).toBe(201);
  expect(build.body.job).toMatchObject({ state: "succeeded", reserved_cents: 0 });
  // Requests run on the AI runtime, under its own budget.
  await owner(`/api/businesses/${f.business}/runtime-budget`, "PUT", { limit_cents: 100 });
  const started = await owner(`/api/product-projects/${f.project}/evaluations`, "POST", {
    artifact_job: build.body.job.id,
  });
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  let run: Json = started.body.run;
  for (let i = 0; i < 300 && run.state === "running"; i++) {
    await new Promise((ok) => setTimeout(ok, 2));
    run = (await owner(`/api/evaluations/${run.id}`)).body.run;
  }
  const released = await owner(`/api/product-projects/${f.project}/releases`, "POST", {
    artifact_job: build.body.job.id,
    eval_run: run.id,
  });
  expect(released.status, JSON.stringify(released.body)).toBe(201);
  const terms = { release_id: released.body.active.id, plan_id: 1, retention_days: 30 };
  const ins = await owner(
    `/api/businesses/${f.business}/customer-offer-inspections`,
    "POST",
    terms,
  );
  const made = await owner(`/api/businesses/${f.business}/customer-offers`, "POST", {
    ...terms,
    idempotency_key: "signalwatch-offer-0001",
    reviewed_terms: ins.body.inspection.terms_digest,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return { w, run, offer: made.body.offer.id as string };
}

async function submit(
  w: Awaited<ReturnType<typeof signalwatch>>["w"],
  offer: string,
  input: string,
  key: string,
) {
  const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: key,
    input,
  });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const id = p.body.use.id as string;
  const c = await w.cara(`/api/customer/uses/${id}/confirm`, "POST", w.signed(p.body.use.envelope));
  expect(c.body.use.state).toBe("reserved");
  const x = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
  expect(x.status, JSON.stringify(x.body)).toBe(200);
  return { id, execution: x.body.use.execution as Json };
}

describe("Signalwatch: the analysis engine through the real routes", () => {
  it("passes the analysis checks on the runtime, bound to the analysis request's version", async () => {
    const { w, run } = await signalwatch();
    expect(run).toMatchObject({ state: "complete", release_ready: true });
    expect(run.passed).toBe(5);
    const [inv] = w.state.store.db
      .prepare("SELECT validator, provider_config FROM runtime_invocations LIMIT 1")
      .all() as Json[];
    expect(inv?.validator).toBe("analysis-validator/1");
    expect(JSON.parse(inv?.provider_config).task).toBe("analysis-prompt/1");
  });

  it("a delivered analysis: flags quoting the notes, fulfilled; the offer is a form", async () => {
    const { w, offer } = await signalwatch();
    const { id, execution } = await submit(
      w,
      offer,
      canonicalSubmission({ notes: NOTES, relies: RELIES }),
      "signalwatch-use-0001",
    );
    expect(execution).toMatchObject({ state: "completed", outcome: "analyzed", fulfilled: true });
    const answer = (await w.cara(`/api/customer/uses/${id}/result`)).body;
    const r = answer.result;
    // The browser's strict parser accepts the real answer, flags and all.
    expect(parseResult(answer).result.findings).toHaveLength(1);
    expect(r.findings).toEqual([
      expect.objectContaining({
        severity: "high",
        evidence: "Removed the Ledger Export API endpoint /v1/export on 2026-12-01.",
      }),
    ]);
    await w.owner(`/api/businesses/${w.f.business}/offer`, "PATCH", { title: "Supplier watch" });
    await w.owner(`/api/businesses/${w.f.business}/publish`, "POST", {});
    const view = parseOffer((await w.cara(`/api/public/customer-offers/${offer}`)).body.offer);
    expect(view.product.kind).toBe("analysis");
    expect(view.product.fields.map((f) => [f.key, f.required])).toEqual([
      ["notes", true],
      ["relies", false],
    ]);
  });

  it("refused: text that isn't release notes is asked and refused, never fulfilled", async () => {
    const { w, offer } = await signalwatch();
    const calls = w.provider.calls.length;
    const recipe = await submit(
      w,
      offer,
      canonicalSubmission({ notes: "Lemon cake: butter, sugar, eggs.", relies: RELIES }),
      "signalwatch-use-0002",
    );
    expect(recipe.execution).toMatchObject({ outcome: "refused", fulfilled: false });
    expect(w.provider.calls.length).toBe(calls + 1);
  });

  it("refused: a malformed submission is refused before anything is sent", async () => {
    const { w, offer } = await signalwatch();
    const calls = w.provider.calls.length;
    const bad = await submit(w, offer, JSON.stringify({ relies: RELIES }), "signalwatch-use-0003");
    expect(bad.execution).toMatchObject({ outcome: "refused", fulfilled: false });
    expect(w.provider.calls.length).toBe(calls); // refused before any model call
  });

  it("an answer quoting text that isn't in the notes is invalid, never shown, never charged", async () => {
    const { w, offer } = await signalwatch();
    w.provider.script = async () => ({
      usage: { inputTokens: 1000, outputTokens: 200, final: true },
      output: {
        status: "analyzed",
        summary: "One change.",
        findings: [
          {
            title: "Export removed",
            severity: "high",
            evidence: "The Ledger Export API will be shut down tomorrow.",
            why: "You use it.",
            proposed_action: "Panic.",
          },
        ],
      },
    });
    const { execution } = await submit(
      w,
      offer,
      canonicalSubmission({ notes: NOTES, relies: RELIES }),
      "signalwatch-use-0004",
    );
    expect(execution).toMatchObject({ state: "completed", outcome: "invalid", fulfilled: false });
  });
});
