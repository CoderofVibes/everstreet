// Phase B (November 5 build): Checks reports what the records show for the saved revision (its
// build, evaluation, release and observed customer use) and the founder's own manual checks,
// self-reported and append-only. Fictional data; the scripted runtime; no network.

import { describe, expect, it } from "vitest";
import { correct, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

async function project() {
  const w = runtimeWorld(new ScriptedRuntime(correct));
  const f = await w.founder();
  const view = async () => (await f.ava(`/api/product-projects/${f.project}`)).body;
  return { w, f, view };
}

describe("Checks reports the saved revision's actual evidence", () => {
  it("built, then evaluated, then released: each step is stated from the records", async () => {
    const { w, f, view } = await project();
    const built = (await view()).checks;
    expect(built.build).toMatchObject({ state: "pass", detail: "Revision 1 was built." });
    expect(built.model_evaluations).toMatchObject({
      state: "unavailable",
      detail: "This revision's build hasn't been evaluated yet.",
    });
    expect(built.journey_tests.detail).toBe("Not released yet, so no customer has used it.");

    await w.release(f);
    const released = (await view()).checks;
    expect(released.model_evaluations.state).toBe("pass");
    expect(released.model_evaluations.detail).toMatch(
      /^10 of 10 named test cases passed on this revision's build\. Quality on these cases only/,
    );
    expect(released.journey_tests).toMatchObject({
      state: "todo",
      detail: "Revision 1 is released. No customer has used the released version yet.",
    });
  });

  it("a newer saved draft says it isn't built or released; customers keep the released one", async () => {
    const { w, f, view } = await project();
    await w.release(f);
    const v = await view();
    const saved = await f.ava(`/api/product-projects/${f.project}/revisions`, "POST", {
      base_revision: v.head.number,
      brief: { ...v.head.brief, name: "Invoice reader 2" },
      prototype: v.head.prototype,
    });
    expect(saved.status).toBe(201);
    const c = saved.body.checks;
    expect(c.build).toMatchObject({ state: "todo", detail: "Revision 2 hasn't been built yet." });
    expect(c.journey_tests.detail).toMatch(
      /^Released: revision 1\. This revision isn't released; customers keep the released one\./,
    );
  });
});

describe("manual checks: recorded by the founder, never an automated pass", () => {
  it("records done and problems for the saved revision; the newest counts; history stays", async () => {
    const { f, view } = await project();
    const before = (await view()).checks.manual;
    expect(before.map((m: { key: string; state: string }) => [m.key, m.state])).toEqual([
      ["audience_walkthrough", "manual"],
      ["manual_fallback", "manual"],
    ]);
    const done = await f.ava(`/api/product-projects/${f.project}/manual-checks`, "POST", {
      revision: 1,
      check_key: "audience_walkthrough",
      outcome: "done",
      note: "Walked a fictional bookkeeper through it",
    });
    expect(done.status).toBe(201);
    expect(done.body.checks.manual[0]).toMatchObject({
      state: "pass",
      recorded: {
        outcome: "done",
        by: "Ava Chen",
        note: "Walked a fictional bookkeeper through it",
      },
    });
    // Problems need a note.
    const bare = await f.ava(`/api/product-projects/${f.project}/manual-checks`, "POST", {
      revision: 1,
      check_key: "audience_walkthrough",
      outcome: "issues",
    });
    expect(bare.status).toBe(400);
    const issues = await f.ava(`/api/product-projects/${f.project}/manual-checks`, "POST", {
      revision: 1,
      check_key: "audience_walkthrough",
      outcome: "issues",
      note: "They couldn't find where to paste",
    });
    expect(issues.body.checks.manual[0]).toMatchObject({
      state: "fail",
      recorded: { outcome: "issues" },
    });
  });

  it("refuses unknown checks, missing revisions and anyone but the owner", async () => {
    const { w, f } = await project();
    const post = (body: unknown, who = f.ava) =>
      who(`/api/product-projects/${f.project}/manual-checks`, "POST", body);
    expect((await post({ revision: 1, check_key: "made_up", outcome: "done" })).status).toBe(400);
    expect(
      (await post({ revision: 9, check_key: "manual_fallback", outcome: "done" })).status,
    ).toBe(404);
    const other = await w.join("Ben Okoro");
    expect(
      (await post({ revision: 1, check_key: "manual_fallback", outcome: "done" }, other)).status,
    ).not.toBe(201);
  });

  it("the record is append-only", async () => {
    const { w, f } = await project();
    await f.ava(`/api/product-projects/${f.project}/manual-checks`, "POST", {
      revision: 1,
      check_key: "manual_fallback",
      outcome: "done",
      note: "",
    });
    expect(() =>
      w.store.db.prepare("UPDATE product_manual_checks SET outcome = 'issues'").run(),
    ).toThrow(/append-only/);
    expect(() => w.store.db.prepare("DELETE FROM product_manual_checks").run()).toThrow(
      /append-only/,
    );
  });
});
