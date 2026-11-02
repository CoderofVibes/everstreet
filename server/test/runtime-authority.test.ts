// Job 002c1: Astra's reproductions 1, 4 and 5 as regressions. A late answer never reaches
// someone who lost control while it ran (including owner-away-and-back and same-key replays),
// though the request is finished, accounted and kept as a business record. A recorded paid
// request is recovered by its key after release or model changes, never re-run. An overlong
// value is never shortened into a clean, fulfilled result.

import { describe, expect, it } from "vitest";
import { CLEAN, correct, gate, reply, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

const DOC =
  "FICTIONAL EXAMPLE\nINVOICE SH-1042\nStackline Hosting Ltd\n2026-10-14\nTotal USD 412.50";

async function heldWorld() {
  const g = gate();
  const provider = new ScriptedRuntime(async (req) => {
    await g.opened;
    return correct(req);
  });
  const w = runtimeWorld(provider);
  const f = await w.founder();
  const ben = await w.join("Ben Okafor");
  const post = (who = f.ava, key = "authority-key-01", text = DOC) =>
    who(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: key,
      artifact_job: f.job,
      text,
    });
  const started = async () => {
    while (provider.calls.length === 0) await new Promise((r) => setTimeout(r, 1));
  };
  const row = () =>
    w.store.db.prepare("SELECT * FROM runtime_invocations").get() as Record<string, unknown>;
  return { w, f, ben, g, provider, post, started, row };
}

const privateFields = (body: Record<string, unknown>) =>
  JSON.stringify(body).includes("Stackline Hosting Ltd");

describe("authority after the final await", () => {
  it("a former owner gets no late private answer; the work is finished, accounted and kept", async () => {
    const t = await heldWorld();
    const pending = t.post();
    await t.started();
    t.w.transfer(t.f.business, t.f.ava.id, t.ben.id);
    t.g.open();
    const r = await pending;
    expect(r.status).toBe(404);
    expect(privateFields(r.body)).toBe(false);
    expect(t.row()).toMatchObject({
      state: "completed",
      outcome: "extracted",
      usage_state: "final",
    });
    expect(Number(t.row().charged_microcents)).toBeGreaterThan(0);
    // The record belongs to the business: its current owner can read it.
    const id = String(t.row().id);
    expect((await t.ben(`/api/runtime/invocations/${id}`)).status).toBe(200);
    expect((await t.f.ava(`/api/runtime/invocations/${id}`)).status).toBe(404);
  });

  it("owner away and back during the request: the answer still isn't returned", async () => {
    const t = await heldWorld();
    const pending = t.post();
    await t.started();
    t.w.transfer(t.f.business, t.f.ava.id, t.ben.id);
    t.w.transfer(t.f.business, t.ben.id, t.f.ava.id);
    t.g.open();
    const r = await pending;
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Control of this business changed/);
    expect(privateFields(r.body)).toBe(false);
    expect(t.row()).toMatchObject({ state: "completed" });
  });

  it("a same-key replay waiting on the request is fenced the same way", async () => {
    const t = await heldWorld();
    const first = t.post();
    await t.started();
    const replay = t.post();
    t.w.transfer(t.f.business, t.f.ava.id, t.ben.id);
    t.g.open();
    const [a, b] = await Promise.all([first, replay]);
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(privateFields(a.body) || privateFields(b.body)).toBe(false);
    expect(t.provider.calls).toHaveLength(1);
  });

  it("with no change of control, the answer is returned as before", async () => {
    const t = await heldWorld();
    const pending = t.post();
    await t.started();
    t.g.open();
    const r = await pending;
    expect(r.status).toBe(201);
    expect(r.body.invocation.outcome).toBe("extracted");
  });
});

describe("recovering a recorded paid request by its key", () => {
  it("after another release is activated, the same request returns the original record", async () => {
    const provider = new ScriptedRuntime(correct);
    const w = runtimeWorld(provider);
    const f = await w.founder();
    await w.release(f);
    const body = { idempotency_key: "release-retry-01", release: true, text: DOC };
    const path = `/api/product-projects/${f.project}/runtime/invocations`;
    const first = await f.ava(path, "POST", body);
    expect(first.status).toBe(201);
    const calls = provider.calls.length;
    const v2 = await w.build(f.ava, f.project);
    await w.release(f, v2);
    const callsAfterChecks = provider.calls.length;
    const again = await f.ava(path, "POST", body);
    expect(again.status).toBe(200);
    expect(again.body.invocation).toMatchObject({
      id: first.body.invocation.id,
      artifact_job: f.job,
    });
    expect(provider.calls.length).toBe(callsAfterChecks);
    expect(callsAfterChecks - calls).toBeGreaterThan(0); // only the second check's cases ran
    // A genuinely different request under that key is still a conflict.
    expect((await f.ava(path, "POST", { ...body, text: `${DOC} edited` })).status).toBe(409);
  });

  it("after a model change, or with the runtime gone, the recorded request is still returned", async () => {
    const provider = new ScriptedRuntime(correct);
    const w = runtimeWorld(provider);
    const f = await w.founder();
    await w.release(f);
    const body = { idempotency_key: "release-retry-02", release: true, text: DOC };
    const path = `/api/product-projects/${f.project}/runtime/invocations`;
    const first = await f.ava(path, "POST", body);
    provider.model = "replacement-model";
    const again = await f.ava(path, "POST", body);
    expect([again.status, again.body.invocation.id]).toEqual([200, first.body.invocation.id]);
    // The availability check doesn't hide a recorded request either.
    (w.runtime as unknown as { provider: null }).provider = null;
    const gone = await f.ava(path, "POST", body);
    expect([gone.status, gone.body.invocation.id]).toEqual([200, first.body.invocation.id]);
  });
});

describe("overlong values", () => {
  it("are never shortened into a clean, fulfilled result", async () => {
    const w = runtimeWorld(
      new ScriptedRuntime(async () => reply({ ...CLEAN, vendor: "V".repeat(2101) })),
    );
    const f = await w.founder();
    const r = await f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "overlong-key-01",
      artifact_job: f.job,
      text: DOC,
    });
    expect(r.body.invocation).toMatchObject({ outcome: "invalid", fulfilled: false });
    expect(r.body.invocation.result.fields).toEqual([]);
    expect(r.body.invocation.result.problems.join()).toMatch(/2101 characters.*not shortened/);
  });

  it("commentary is bounded and visibly marked, the values untouched", async () => {
    const w = runtimeWorld(
      new ScriptedRuntime(async () => {
        const a = reply(CLEAN);
        const first = (a.output as { fields: { note: string }[] }).fields[0];
        if (first) first.note = "n".repeat(500);
        return a;
      }),
    );
    const f = await w.founder();
    const r = await f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "overlong-key-02",
      artifact_job: f.job,
      text: DOC,
    });
    const inv = r.body.invocation;
    expect(inv).toMatchObject({ outcome: "extracted", fulfilled: true });
    expect(inv.result.fields[0].note).toHaveLength(300);
    expect(inv.result.fields[0].note.endsWith("…")).toBe(true);
    expect(inv.result.fields[0].value).toBe("Stackline Hosting Ltd");
    expect(inv.input_note).toMatch(
      /pasted text itself isn't stored.*kept as one of the business's records/,
    );
  });
});
