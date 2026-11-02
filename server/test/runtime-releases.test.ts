// Jobs 002c and 002c1: checks and releases. A scripted runtime model answers each required
// document the way a correct extractor would (or wrongly, where a test says so); artifacts come
// from the real build pipeline. Proves the independent required release policy, evaluation
// provenance, raw vs scored outcomes, not-applicable cases, stale results, release gating,
// pinning across rollback and stale-owner rejection.

import { describe, expect, it } from "vitest";
import { Evaluations, RELEASE_POLICY, REQUIRED_INVOICE_CASES } from "../src/evaluations.ts";
import { EXTRACT_VALIDATOR } from "../src/extract.ts";
import { ManagedRuntime } from "../src/invocations.ts";
import { RuntimeFailure } from "../src/runtime.ts";
import {
  CLEAN,
  correct,
  gate,
  INVOICE_SPEC,
  reply,
  runtimeWorld,
  ScriptedRuntime,
} from "./runtime-world.ts";

const N = REQUIRED_INVOICE_CASES.length;
const by = (r: { results: { id: string }[] }, id: string) =>
  r.results.find((x) => x.id === id) as unknown as Record<string, unknown> & {
    fields: { key: string }[];
  };

async function setup(provider = new ScriptedRuntime(correct)) {
  const w = runtimeWorld(provider);
  const f = await w.founder();
  return { w, f, provider };
}

describe("the required release checks", () => {
  it("a correct extractor passes every required case, with exact provenance", async () => {
    const { w, f } = await setup();
    const r = await w.check(f);
    expect(r).toMatchObject({
      state: "complete",
      total: N,
      passed: N,
      artifact_job: f.job,
      fixture_version: 0,
      policy: RELEASE_POLICY,
      validator: EXTRACT_VALIDATOR,
      release_ready: true,
    });
    expect(r.results.every((x: { required: boolean }) => x.required)).toBe(true);
    expect(r.provider_config).toMatchObject({ id: "scripted-runtime" });
    expect(r.basis).toMatch(/these named test cases only/);
    expect(by(r, "req_huge_amount")).toMatchObject({ score: "pass", raw: { outcome: "invalid" } });
    expect(by(r, "req_empty")).toMatchObject({ score: "pass", raw: { outcome: "not_sent" } });
    expect(by(r, "req_over_limit")).toMatchObject({ score: "pass", raw: { outcome: "not_sent" } });
    expect(r.invalid_answers).toBe(1);
    expect(r.used_microcents).toBeGreaterThan(0);
    // Evaluation requests stay out of the trial history.
    expect((await f.ava(`/api/product-projects/${f.project}/runtime`)).body.invocations).toEqual(
      [],
    );
  });

  it("an empty-only founder suite can't release a product that never extracts anything", async () => {
    // Astra's reproduction: one founder case, empty input expecting not_sent.
    const { w, f, provider } = await setup(
      new ScriptedRuntime(async () => reply({}, "not_a_document")),
    );
    await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
      base_version: null,
      cases: [{ id: "x", name: "x", input: "", expect: { outcomes: ["not_sent"] } }],
    });
    const r = await w.check(f);
    expect(by(r, "x")).toMatchObject({ required: false, score: "pass" });
    expect(r.release_ready).toBe(false);
    expect(provider.calls.length).toBeGreaterThan(0); // the required cases were actually run
    const rel = await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: f.job,
      eval_run: r.id,
    });
    expect(rel.status).toBe(409);
  });

  it("an accept-anything founder case, or removing every founder case, can't weaken the required ones", async () => {
    const lazy = new ScriptedRuntime(async (req) =>
      req.document.includes("SH-1042") ? reply({ ...CLEAN, total: "0.00" }) : correct(req),
    );
    const { w, f } = await setup(lazy);
    await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
      base_version: null,
      cases: [
        {
          id: "anything",
          name: "Anything goes",
          input: "INVOICE SH-1042",
          expect: { outcomes: ["extracted", "incomplete", "refused", "invalid"] },
        },
      ],
    });
    const r1 = await w.check(f);
    expect(by(r1, "anything").score).toBe("pass");
    expect(by(r1, "req_clean").score).toBe("fail");
    expect(r1.release_ready).toBe(false);
    // Removing every founder case leaves the required ones in place.
    await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
      base_version: 1,
      cases: [],
    });
    const r2 = await w.check(f);
    expect(r2.total).toBe(N);
    expect(r2.release_ready).toBe(false);
    // Founders can't name a case to shadow a required one.
    const shadow = await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
      base_version: 2,
      cases: [{ id: "req_clean", name: "mine", input: "x", expect: { outcomes: ["refused"] } }],
    });
    expect(shadow.status).toBe(400);
  });

  it("required cases that don't apply to a version block release, honestly labelled", async () => {
    const { w, f, provider } = await setup();
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
    const r = await w.check(f, narrower);
    const na = r.results.filter((x: { score: string }) => x.score === "not_applicable");
    expect(na.map((x: { id: string }) => x.id).sort()).toEqual([
      "req_clean",
      "req_embedded_instructions",
    ]);
    expect(provider.calls.length - calls).toBe(N - 2 - 2); // empty and over-limit aren't sent
    expect(r.release_ready).toBe(false);
    expect(r.reasons.join()).toMatch(/required release checks don't apply.*can't be released/);
  });

  it("an unsafe-amount case passes as invalid only when the amount is the problem", async () => {
    const { w, f } = await setup(
      new ScriptedRuntime(async (req) =>
        req.document.includes("OC-1")
          ? reply({
              ...CLEAN,
              vendor: "Orbit Compute",
              invoice_number: "OC-1",
              invoice_date: "2026-13-10",
              total: "10.00",
            })
          : correct(req),
      ),
    );
    const r = await w.check(f);
    expect(by(r, "req_huge_amount")).toMatchObject({ score: "fail", raw: { outcome: "invalid" } });
    expect(String(by(r, "req_huge_amount").explanation)).toMatch(/another reason/);
  });

  it("wrong fields fail with expected vs actual; provider errors are errors, not wrong answers", async () => {
    const provider = new ScriptedRuntime(async (req) => {
      if (req.document.includes("SH-1042")) return reply({ ...CLEAN, invoice_date: "2026-10-15" });
      if (req.document.includes("NA-4410"))
        throw new RuntimeFailure("The AI provider could not be reached", "provider_error", null);
      if (req.document.includes("MA-2026-07"))
        // Silently "corrects" the total and reports nothing.
        return reply({
          ...CLEAN,
          vendor: "Marten Automation Co",
          invoice_number: "MA-2026-07",
          total: "260.00",
        });
      return correct(req);
    });
    const { w, f } = await setup(provider);
    const r = await w.check(f);
    expect(by(r, "req_clean")).toMatchObject({ score: "fail" });
    expect(by(r, "req_clean").fields.find((x) => x.key === "invoice_date")).toEqual({
      key: "invoice_date",
      expected: "2026-10-14",
      actual: "2026-10-15",
      match: false,
    });
    expect(by(r, "req_embedded_instructions")).toMatchObject({
      score: "error",
      raw: { state: "unknown" },
    });
    expect(by(r, "req_totals_disagree")).toMatchObject({ score: "fail" });
    expect([r.failed, r.errors, r.release_ready]).toEqual([2, 1, false]);
  });

  it("a model's own claims aren't a pass: an invoice fabricated from unrelated text fails", async () => {
    const { w, f } = await setup(
      new ScriptedRuntime(async (req) =>
        req.document.includes("ledgerctl")
          ? reply({ ...CLEAN, vendor: "ledgerctl" }, "extracted", ["All checks passed"])
          : correct(req),
      ),
    );
    const r = await w.check(f);
    expect(by(r, "req_unrelated_text")).toMatchObject({
      score: "fail",
      raw: { outcome: "extracted" },
    });
  });

  it("the required list is shown with its policy; founder cases are versioned and immutable", async () => {
    const { w, f } = await setup();
    const fx = (await f.ava(`/api/product-projects/${f.project}/test-cases`)).body;
    expect(fx.required).toMatchObject({ policy: RELEASE_POLICY });
    expect(fx.required.cases).toHaveLength(N);
    expect(fx.cases).toEqual([]);
    const r = await w.check(f);
    const cases = [
      { id: "mine", name: "Mine", input: "INVOICE SH-1042", expect: { outcomes: ["extracted"] } },
    ];
    expect(
      (
        await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
          cases,
          base_version: 3,
        })
      ).status,
    ).toBe(409);
    const saved = await f.ava(`/api/product-projects/${f.project}/test-cases`, "POST", {
      cases,
      base_version: null,
    });
    expect(saved.body.version).toBe(1);
    const again = (await f.ava(`/api/evaluations/${r.id}`)).body.run;
    expect(again).toMatchObject({ current: false, release_ready: false });
    expect(again.reasons).toContain("Your test cases have changed since");
    expect(() => w.store.db.exec("UPDATE eval_fixtures SET cases = '[]'")).toThrow(/immutable/);
    expect(() => w.store.db.exec("DELETE FROM eval_fixtures")).toThrow(/immutable/);
  });

  it("a check under an older policy or a different model is stale", async () => {
    const { w, f, provider } = await setup();
    const r = await w.check(f);
    w.store.db.prepare("UPDATE eval_runs SET policy = 'invoice-release/0' WHERE id = ?").run(r.id);
    const old = (await f.ava(`/api/evaluations/${r.id}`)).body.run;
    expect(old.reasons.join()).toMatch(/required release checks have changed/);
    const r2 = await w.check(f);
    provider.model = "another-model";
    const again = (await f.ava(`/api/evaluations/${r2.id}`)).body.run;
    expect(again.release_ready).toBe(false);
    expect(again.reasons.join()).toMatch(/model or its prices have changed/);
  });

  it("a check interrupted by a restart is stopped, not left blocking, and nothing is re-run", async () => {
    const provider = new ScriptedRuntime(() => new Promise(() => {})); // never answers
    const { w, f } = await setup(provider);
    await f.ava(`/api/product-projects/${f.project}/evaluations`, "POST", { artifact_job: f.job });
    while (provider.calls.length === 0) await new Promise((r) => setTimeout(r, 1));
    const fresh = new ScriptedRuntime(correct);
    const runtime = new ManagedRuntime(w.store.db, w.store, fresh, { ceilingCents: 1_000 });
    expect(runtime.recover()).toBe(1);
    expect(new Evaluations(w.store.db, w.store, runtime).recover()).toBe(1);
    expect(fresh.calls).toHaveLength(0);
  });
});

describe("releasing and rolling back", () => {
  it("release, serve, release a newer version, roll back; requests keep the version they started on", async () => {
    const { w, f, provider } = await setup();
    const { view } = await w.release(f);
    expect(view.active).toMatchObject({
      artifact_job: f.job,
      state: "active",
      policy: RELEASE_POLICY,
    });
    const v2 = await w.build(f.ava, f.project, {
      ...INVOICE_SPEC,
      instructions: "Read one invoice carefully.",
    });
    const r2 = await w.check(f, v2);
    expect(r2.release_ready).toBe(true);
    const candidates = (await f.ava(`/api/product-projects/${f.project}/releases`)).body.candidates;
    expect(candidates.find((c: { artifact_job: string }) => c.artifact_job === v2).status).toBe(
      "checked",
    );

    const g = gate();
    provider.script = async (req) => {
      await g.opened;
      return correct(req);
    };
    const before = provider.calls.length;
    const inflight = f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "release-key-0001",
      release: true,
      text: REQUIRED_INVOICE_CASES[0]?.input,
    });
    while (provider.calls.length === before) await new Promise((r) => setTimeout(r, 1));
    await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: v2,
      eval_run: r2.id,
    });
    g.open();
    expect((await inflight).body.invocation).toMatchObject({
      purpose: "release",
      artifact_job: f.job,
      state: "completed",
    });
    provider.script = correct;
    const next = (
      await f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
        idempotency_key: "release-key-0002",
        release: true,
        text: REQUIRED_INVOICE_CASES[0]?.input,
      })
    ).body.invocation;
    expect(next.artifact_job).toBe(v2);

    const all = (await f.ava(`/api/product-projects/${f.project}/releases`)).body;
    const first = all.releases.find((x: { artifact_job: string }) => x.artifact_job === f.job);
    const back = await f.ava(
      `/api/product-projects/${f.project}/releases/${first.id}/rollback`,
      "POST",
    );
    expect(back.status).toBe(200);
    expect(back.body.active).toMatchObject({ artifact_job: f.job, rolled_back_from: first.id });
  });

  it("after the model changes, a release stops serving and can't be rolled back to until re-checked", async () => {
    const { w, f, provider } = await setup();
    await w.release(f);
    const v2 = await w.build(f.ava, f.project, { ...INVOICE_SPEC, instructions: "Second." });
    await w.release(f, v2);
    provider.model = "replacement-model";
    const serve = await f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "release-key-0003",
      release: true,
      text: "INVOICE SH-1042",
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
    const { w, f } = await setup();
    const r = await w.check(f);
    const ben = await w.join("Ben Okafor");
    w.transfer(f.business, f.ava.id, ben.id);
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
  });
});
