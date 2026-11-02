// Job 002c: evaluations and releases. A scripted runtime model answers each curated document
// the way a correct extractor would (or wrongly, where a test says so); artifacts come from the
// real build pipeline. Proves evaluation provenance, raw vs scored outcomes, not-applicable
// cases, stale results, release gating, pinning across rollback and stale-owner rejection.

import { describe, expect, it } from "vitest";
import { CURATED_INVOICE_SUITE } from "../src/evaluations.ts";
import { RuntimeFailure, type RuntimeRequest } from "../src/runtime.ts";
import {
  type Answer,
  gate,
  INVOICE_SPEC,
  reply,
  runtimeWorld,
  ScriptedRuntime,
} from "./runtime-world.ts";

const row = (
  vendor: string,
  num: string,
  date: string | null,
  total: string,
  currency: string,
) => ({
  vendor,
  invoice_number: num,
  invoice_date: date,
  total,
  currency,
  due_date: null,
});

/** What a correct extractor says about each curated document. */
async function correct(req: RuntimeRequest): Promise<Answer> {
  const d = req.document;
  if (d.includes("JPS-1042"))
    return reply(row("Juniper Print Supply", "JPS-1042", "2026-10-14", "412.50", "USD"));
  if (d.includes("QF-88"))
    return reply(row("Quill & Fern Stationers", "QF-88", null, "140.00", "EUR"));
  if (d.includes("HK-310"))
    return reply({}, "ambiguous", ["03/04/2026 could be 3 April or 4 March"]);
  if (d.includes("---")) return reply({}, "multiple_documents");
  if (d.includes("MF-2026-07"))
    return reply(
      row("Marten Frame Shop", "MF-2026-07", "2026-08-19", "300.00", "USD"),
      "extracted",
      ["Line items add up to 260.00, not the stated 300.00"],
    );
  if (d.includes("NC-4410"))
    return reply(row("Northwind Clay", "NC-4410", "2026-10-01", "48.00", "USD"));
  if (d.includes("OF-1"))
    return reply(row("Orbit Freight", "OF-1", "2026-10-10", "98765432109876543.21", "USD"));
  return reply({}, "not_a_document");
}

async function checked(provider = new ScriptedRuntime(correct)) {
  const w = runtimeWorld(provider);
  const f = await w.founder();
  await f.ava(`/api/businesses/${f.business}/runtime-budget`, "PUT", { limit_cents: 500 });
  expect(
    (
      await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
        source: "curated",
        base_version: null,
      })
    ).status,
  ).toBe(201);
  const run = async (job = f.job) => {
    const started = await f.ava(`/api/product-projects/${f.project}/evaluations`, "POST", {
      artifact_job: job,
    });
    expect(started.status).toBe(202);
    for (let i = 0; i < 200; i++) {
      const r = (await f.ava(`/api/evaluations/${started.body.run.id}`)).body.run;
      if (r.state !== "running") return r;
      await new Promise((ok) => setTimeout(ok, 2));
    }
    throw new Error("run did not finish");
  };
  return { w, f, provider, run };
}

describe("checking a version against curated test cases", () => {
  it("a correct extractor passes every curated case, with exact provenance", async () => {
    const { f, run } = await checked();
    const r = await run();
    expect(r).toMatchObject({
      state: "complete",
      total: CURATED_INVOICE_SUITE.length,
      passed: CURATED_INVOICE_SUITE.length,
      artifact_job: f.job,
      fixture_version: 1,
      validator: "extract-validator/1",
      release_ready: true,
    });
    expect(r.provider_config).toMatchObject({
      id: "scripted-runtime",
      model: "scripted-runtime-model",
    });
    expect(r.artifact_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(r.basis).toMatch(/these named test cases only/);
    // Raw outcome is kept apart from the score.
    const huge = r.results.find((x: { id: string }) => x.id === "huge_amount");
    expect(huge).toMatchObject({ score: "pass", raw: { state: "completed", outcome: "invalid" } });
    const empty = r.results.find((x: { id: string }) => x.id === "empty");
    expect(empty).toMatchObject({ score: "pass", raw: { outcome: "not_sent", invocation: null } });
    // Paid from the runtime budget; evaluation requests stay out of the trial history.
    expect(r.used_microcents).toBeGreaterThan(0);
    const history = (await f.ava(`/api/product-projects/${f.project}/runtime`)).body.invocations;
    expect(history).toEqual([]);
  });

  it("wrong fields fail with expected vs actual; provider errors are errors, not wrong answers", async () => {
    const provider = new ScriptedRuntime(async (req) => {
      if (req.document.includes("JPS-1042"))
        return reply(row("Juniper Print Supply", "JPS-1042", "2026-10-15", "412.50", "USD"));
      if (req.document.includes("NC-4410"))
        throw new RuntimeFailure("The AI provider could not be reached", "provider_error", null);
      if (req.document.includes("MF-2026-07"))
        // Silently "corrects" the total and reports nothing.
        return reply(row("Marten Frame Shop", "MF-2026-07", "2026-08-19", "260.00", "USD"));
      return correct(req);
    });
    const { run } = await checked(provider);
    const r = await run();
    const by = (id: string) => r.results.find((x: { id: string }) => x.id === id);
    expect(by("clean")).toMatchObject({ score: "fail" });
    expect(by("clean").fields.find((x: { key: string }) => x.key === "invoice_date")).toEqual({
      key: "invoice_date",
      expected: "2026-10-14",
      actual: "2026-10-15",
      match: false,
    });
    expect(by("embedded_instructions")).toMatchObject({
      score: "error",
      raw: { state: "unknown" },
    });
    expect(by("totals_disagree")).toMatchObject({ score: "fail" });
    expect([r.failed, r.errors]).toEqual([2, 1]);
    expect(r.release_ready).toBe(false);
  });

  it("a model's own claims aren't a pass: an invoice fabricated from unrelated text fails", async () => {
    const provider = new ScriptedRuntime(async (req) =>
      req.document.includes("Shopping list")
        ? reply(row("Saturday Class", "1", "2026-10-01", "0.00", "USD"), "extracted", [
            "All checks passed",
          ])
        : correct(req),
    );
    const { run } = await checked(provider);
    const r = await run();
    expect(r.results.find((x: { id: string }) => x.id === "unrelated_text")).toMatchObject({
      score: "fail",
      raw: { outcome: "extracted" },
    });
  });

  it("cases for fields a version doesn't have are not applicable, not run, and block release", async () => {
    const { w, f, provider, run } = await checked();
    const { invoice_number: _n, ...rest } = Object.fromEntries(
      INVOICE_SPEC.fields.map((x) => [x.key, x]),
    );
    const narrower = await w.build(f.ava, f.project, {
      ...INVOICE_SPEC,
      fields: Object.values(rest),
      examples: INVOICE_SPEC.examples.map(({ input, output: { invoice_number: _x, ...o } }) => ({
        input,
        output: o,
      })),
    });
    const calls = provider.calls.length;
    const r = await run(narrower);
    const na = r.results.filter((x: { score: string }) => x.score === "not_applicable");
    expect(na.map((x: { id: string }) => x.id).sort()).toEqual(["clean", "embedded_instructions"]);
    expect(provider.calls.length - calls).toBe(CURATED_INVOICE_SUITE.length - 2 - 1); // empty isn't sent
    expect(r.release_ready).toBe(false);
  });

  it("test cases are versioned: edits make a new version, old runs go stale, stale bases are refused", async () => {
    const { w, f, run } = await checked();
    const r = await run();
    const fixtures = (await f.ava(`/api/product-projects/${f.project}/test-cases`)).body;
    const cases = fixtures.cases.slice(0, 3);
    const stale = await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
      cases,
      base_version: 0,
    });
    expect(stale.status).toBe(409);
    const saved = await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
      cases,
      base_version: 1,
    });
    expect(saved.body.version).toBe(2);
    const again = (await f.ava(`/api/evaluations/${r.id}`)).body.run;
    expect(again).toMatchObject({ current: false, release_ready: false });
    expect(again.reasons).toContain("The test cases have changed since");
    expect(() => w.store.db.exec("UPDATE eval_fixtures SET cases = '[]'")).toThrow(/immutable/);
  });

  it("a different model makes earlier checks stale", async () => {
    const { f, provider, run } = await checked();
    const r = await run();
    provider.model = "another-model";
    const again = (await f.ava(`/api/evaluations/${r.id}`)).body.run;
    expect(again.release_ready).toBe(false);
    expect(again.reasons.join()).toMatch(/model or its prices have changed/);
  });
});

describe("releasing and rolling back", () => {
  it("only a version with current passing checks can be released", async () => {
    const provider = new ScriptedRuntime(async (req) =>
      req.document.includes("JPS-1042") ? reply({}, "not_a_document") : correct(req),
    );
    const { f, run } = await checked(provider);
    const failing = await run();
    const refused = await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: f.job,
      eval_run: failing.id,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/did not pass/);
    expect((await f.ava(`/api/product-projects/${f.project}/releases`)).body.active).toBeNull();
  });

  it("release, serve, release a newer version, roll back; requests keep the version they started on", async () => {
    const { w, f, provider, run } = await checked();
    const r1 = await run();
    const rel = await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: f.job,
      eval_run: r1.id,
    });
    expect(rel.status).toBe(201);
    expect(rel.body.active).toMatchObject({
      artifact_job: f.job,
      eval_run: r1.id,
      state: "active",
    });
    // A newer candidate with its own passing check.
    const v2 = await w.build(f.ava, f.project, {
      ...INVOICE_SPEC,
      instructions: "Read one invoice carefully.",
    });
    const r2 = await run(v2);
    expect(r2.release_ready).toBe(true);
    const candidates = (await f.ava(`/api/product-projects/${f.project}/releases`)).body.candidates;
    expect(candidates.find((c: { artifact_job: string }) => c.artifact_job === v2).status).toBe(
      "checked",
    );

    // A request on the active release (v1) is in flight when v2 is released.
    const g = gate();
    provider.script = async (req) => {
      await g.opened;
      return correct(req);
    };
    const inflight = f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "release-key-0001",
      release: true,
      text: CURATED_INVOICE_SUITE[0]?.input,
    });
    while (provider.calls.length === 0 || !provider.calls.at(-1)?.document.includes("JPS"))
      await new Promise((r) => setTimeout(r, 1));
    await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: v2,
      eval_run: r2.id,
    });
    g.open();
    const pinned = (await inflight).body.invocation;
    expect(pinned).toMatchObject({ purpose: "release", artifact_job: f.job, state: "completed" });
    provider.script = correct;
    const next = (
      await f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
        idempotency_key: "release-key-0002",
        release: true,
        text: CURATED_INVOICE_SUITE[0]?.input,
      })
    ).body.invocation;
    expect(next.artifact_job).toBe(v2);

    // Roll back to the first release: a new active row pointing at v1's checked version.
    const view = (await f.ava(`/api/product-projects/${f.project}/releases`)).body;
    const first = view.releases.find(
      (x: { artifact_job: string; state: string }) => x.artifact_job === f.job,
    );
    const back = await f.ava(
      `/api/product-projects/${f.project}/releases/${first.id}/rollback`,
      "POST",
    );
    expect(back.status).toBe(200);
    expect(back.body.active).toMatchObject({ artifact_job: f.job, rolled_back_from: first.id });
    expect(back.body.releases.filter((x: { state: string }) => x.state === "active")).toHaveLength(
      1,
    );
  });

  it("after the model changes, a release stops serving and can't be rolled back to until re-checked", async () => {
    const { w, f, provider, run } = await checked();
    const r1 = await run();
    await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: f.job,
      eval_run: r1.id,
    });
    const v2 = await w.build(f.ava, f.project, { ...INVOICE_SPEC, instructions: "Second." });
    const r2 = await run(v2);
    await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: v2,
      eval_run: r2.id,
    });
    provider.model = "replacement-model";
    const serve = await f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "release-key-0003",
      release: true,
      text: "INVOICE JPS-1042",
    });
    expect(serve.status).toBe(409);
    expect(serve.body.error).toMatch(/check it again/);
    const old = (await f.ava(`/api/product-projects/${f.project}/releases`)).body.releases.find(
      (x: { state: string }) => x.state === "retired",
    );
    const back = await f.ava(
      `/api/product-projects/${f.project}/releases/${old.id}/rollback`,
      "POST",
    );
    expect(back.status).toBe(409);
    expect(back.body.error).toMatch(/needs checking again/);
  });

  it("a version built under a previous owner can't be released after the business changes hands", async () => {
    const { w, f, run } = await checked();
    const r = await run();
    const ben = await w.join("Ben Okafor");
    // The business changes hands (as a closed sale records it).
    w.store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(ben.id, f.business);
    w.store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, 2, ?)",
      )
      .run(f.business, f.ava.id, ben.id, new Date().toISOString());
    // The former owner has no access at all now.
    expect(
      (
        await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
          artifact_job: f.job,
          eval_run: r.id,
        })
      ).status,
    ).toBe(404);
    const theirs = await ben(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: f.job,
      eval_run: r.id,
    });
    expect(theirs.status).toBe(409);
    expect(theirs.body.error).toMatch(/previous owner/);
    const view = (await ben(`/api/product-projects/${f.project}/releases`)).body;
    expect(view.candidates[0]).toMatchObject({ current_owner: false, status: "candidate" });
  });
});
