// Job 002c: running a product. Scripted runtime provider, in-memory database; the artifact
// comes from the real build pipeline. Proves owner-only access, free pre-dispatch refusals,
// idempotency, the separate budget and ledger, exact usage, retained unknown costs,
// cancellation, timeouts and restart without re-running a paid request.

import { describe, expect, it } from "vitest";
import { EXTRACT_VALIDATOR } from "../src/extract.ts";
import { ManagedRuntime } from "../src/invocations.ts";
import { RuntimeFailure } from "../src/runtime.ts";
import { CLEAN, gate, reply, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

const DOC =
  "FICTIONAL EXAMPLE\nINVOICE SH-1042\nStackline Hosting Ltd\nDate: 2026-10-14\nTotal due: USD 412.50";

type W = ReturnType<typeof runtimeWorld>;
const invoke = (w: Awaited<ReturnType<W["founder"]>>, key: string, text = DOC, extra = {}) =>
  w.ava(`/api/product-projects/${w.project}/runtime/invocations`, "POST", {
    idempotency_key: key,
    artifact_job: w.job,
    text,
    ...extra,
  });
const ledger = (w: W) =>
  w.store.db.prepare("SELECT kind, cents, microcents FROM runtime_usage ORDER BY id").all() as {
    kind: string;
    cents: number | null;
    microcents: number | null;
  }[];

describe("running a checked version", () => {
  it("extracts validated fields and records version, status, time and exact usage", async () => {
    const w = runtimeWorld();
    const f = await w.founder();
    const r = await invoke(f, "trial-key-0001");
    expect(r.status).toBe(201);
    const inv = r.body.invocation;
    expect(inv).toMatchObject({
      state: "completed",
      outcome: "extracted",
      fulfilled: true,
      artifact_job: f.job,
      validator: EXTRACT_VALIDATOR,
      model: "scripted-runtime-model",
      usage_state: "final",
      input_tokens: 900,
      output_tokens: 120,
      // 900 × 100 + 120 × 500 millionths of a cent
      charged_microcents: 150_000,
      charged_cents: 1,
      reserved_cents: 0,
    });
    expect(inv.artifact_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.result.fields.find((x: { key: string }) => x.key === "total").value).toBe("412.50");
    expect(typeof inv.elapsed_ms).toBe("number");
    expect(ledger(w).map((l) => l.kind)).toEqual(["reservation", "actual", "release"]);
  });

  it("the pasted text is not stored anywhere", async () => {
    const w = runtimeWorld();
    const f = await w.founder();
    const secret = "INVOICE ZX-SECRET-7781 from Quill & Co";
    await invoke(f, "trial-key-0002", secret);
    const dump = JSON.stringify(
      ["runtime_invocations", "runtime_usage", "events", "build_events"].map((t) =>
        w.store.db.prepare(`SELECT * FROM ${t}`).all(),
      ),
    );
    expect(dump).not.toContain("ZX-SECRET-7781");
  });

  it("only the owner can run it or read its records, including by direct link", async () => {
    const w = runtimeWorld();
    const f = await w.founder();
    const id = (await invoke(f, "trial-key-0003")).body.invocation.id;
    const ben = await w.join("Ben Okafor");
    for (const [path, method] of [
      [`/api/runtime/invocations/${id}`, "GET"],
      [`/api/runtime/invocations/${id}/cancel`, "POST"],
      [`/api/product-projects/${f.project}/runtime`, "GET"],
    ] as const)
      expect((await ben(path, method)).status).toBe(404);
    const theirs = await ben(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "trial-key-ben1",
      artifact_job: f.job,
      text: DOC,
    });
    expect(theirs.status).toBe(404);
    expect((await w.anon(`/api/runtime/invocations/${id}`)).status).toBe(401);
  });

  it("empty and over-limit input are refused for free, with nothing reserved", async () => {
    const provider = new ScriptedRuntime();
    const w = runtimeWorld(provider);
    const f = await w.founder();
    expect((await invoke(f, "trial-key-0004", "   ")).status).toBe(400);
    const long = await invoke(f, "trial-key-0005", "x".repeat(8001));
    expect(long.status).toBe(400);
    expect(long.body.error).toMatch(/up to 8000 characters/);
    expect(provider.calls).toHaveLength(0);
    expect(ledger(w)).toEqual([]);
  });

  it("same key and text returns the same record; a different text under that key is a conflict", async () => {
    const provider = new ScriptedRuntime();
    const w = runtimeWorld(provider);
    const f = await w.founder();
    const a = await invoke(f, "trial-key-0006");
    const b = await invoke(f, "trial-key-0006");
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.invocation.id).toBe(a.body.invocation.id);
    const c = await invoke(f, "trial-key-0006", `${DOC} (edited)`);
    expect(c.status).toBe(409);
    expect(provider.calls).toHaveLength(1);
  });

  it("a duplicate sent while the first is still running doesn't run twice", async () => {
    const g = gate();
    const provider = new ScriptedRuntime(async () => {
      await g.opened;
      return reply(CLEAN);
    });
    const w = runtimeWorld(provider);
    const f = await w.founder();
    const first = invoke(f, "trial-key-0007");
    while (provider.calls.length === 0) await new Promise((r) => setTimeout(r, 1));
    const second = invoke(f, "trial-key-0007");
    g.open();
    const [a, b] = await Promise.all([first, second]);
    expect(b.body.invocation.id).toBe(a.body.invocation.id);
    expect(b.body.invocation.state).toBe("completed");
    expect(provider.calls).toHaveLength(1);
  });

  it("separate from the build ledger: its own budget, reservation and ceiling", async () => {
    const w = runtimeWorld(new ScriptedRuntime(), { ceilingCents: 5 });
    const f = await w.founder();
    // A business budget can't exceed the operator's runtime ceiling.
    const tooHigh = await f.ava(`/api/businesses/${f.business}/runtime-budget`, "PUT", {
      limit_cents: 100,
    });
    expect(tooHigh.status).toBe(400);
    await f.ava(`/api/businesses/${f.business}/runtime-budget`, "PUT", { limit_cents: 5 });
    const buildBefore = w.builds.budgetFor(f.business);
    await invoke(f, "trial-key-0008");
    expect(w.builds.budgetFor(f.business)).toEqual(buildBefore);
    // The operator ceiling (5 cents) leaves room for one more 4-cent hold, not two.
    const g = gate();
    (w.runtime.provider as ScriptedRuntime).script = async () => {
      await g.opened;
      return reply(CLEAN);
    };
    const held = invoke(f, "trial-key-0009");
    while ((w.runtime.provider as ScriptedRuntime).calls.length < 2)
      await new Promise((r) => setTimeout(r, 1));
    // Another business with room in its own budget is still stopped by the operator's ceiling.
    const ben = await w.founder("Ben Okafor");
    await ben.ava(`/api/businesses/${ben.business}/runtime-budget`, "PUT", { limit_cents: 5 });
    const over = await invoke(ben, "trial-key-0010");
    expect(over.status).toBe(409);
    expect(over.body.error).toMatch(/overall limit/);
    g.open();
    await held;
    // A business budget below one request's worst case refuses before anything is sent.
    await f.ava(`/api/businesses/${f.business}/runtime-budget`, "PUT", { limit_cents: 2 });
    expect((await invoke(f, "trial-key-0011")).body.error).toMatch(/Not enough runtime budget/);
  });

  it("at most two requests run at once per business", async () => {
    const g = gate();
    const provider = new ScriptedRuntime(async () => {
      await g.opened;
      return reply(CLEAN);
    });
    const w = runtimeWorld(provider);
    const f = await w.founder();
    const two = [invoke(f, "trial-key-0012"), invoke(f, "trial-key-0013")];
    while (provider.calls.length < 2) await new Promise((r) => setTimeout(r, 1));
    const third = await invoke(f, "trial-key-0014");
    expect(third.status).toBe(409);
    expect(third.body.error).toMatch(/At most 2/);
    g.open();
    await Promise.all(two);
  });

  it("schema failures are not success, and still record their real cost", async () => {
    const w = runtimeWorld(
      new ScriptedRuntime(async () => reply({ ...CLEAN, total: "1,234.50", iban: "X" })),
    );
    const f = await w.founder();
    const inv = (await invoke(f, "trial-key-0015")).body.invocation;
    expect(inv).toMatchObject({ state: "completed", outcome: "invalid", fulfilled: false });
    expect(inv.result.fields).toEqual([]);
    expect(inv.result.problems.join()).toMatch(/wasn't asked for/);
    expect(inv.charged_microcents).toBe(150_000);
  });

  it("a lost answer keeps its cost unknown and its reservation held", async () => {
    const w = runtimeWorld(
      new ScriptedRuntime(async () => {
        throw new RuntimeFailure("The AI provider could not be reached", "provider_error", null);
      }),
    );
    const f = await w.founder();
    const inv = (await invoke(f, "trial-key-0016")).body.invocation;
    expect(inv).toMatchObject({ state: "unknown", usage_state: "unknown", reserved_cents: 4 });
    expect(w.runtime.budgetFor(f.business)).toMatchObject({
      unresolved_cents: 4,
      reserved_cents: 4,
    });
    expect(ledger(w).map((l) => l.kind)).toEqual(["reservation", "unknown"]);
  });

  it("a free preflight refusal releases everything", async () => {
    const w = runtimeWorld(
      new ScriptedRuntime(async () => {
        throw new RuntimeFailure("Too long. Nothing was sent.", "not_sent", {
          inputTokens: 0,
          outputTokens: 0,
          final: true,
        });
      }),
    );
    const f = await w.founder();
    const inv = (await invoke(f, "trial-key-0017")).body.invocation;
    expect(inv).toMatchObject({
      state: "failed",
      usage_state: "final",
      reserved_cents: 0,
      charged_cents: 0,
    });
  });

  it("cancelling a running request stops it; without a receipt its cost stays unknown", async () => {
    const provider = new ScriptedRuntime(
      (_req, signal) =>
        new Promise((_ok, fail) =>
          signal.addEventListener("abort", () =>
            fail(new RuntimeFailure("The request was stopped", "cancelled", null)),
          ),
        ),
    );
    const w = runtimeWorld(provider);
    const f = await w.founder();
    const pending = invoke(f, "trial-key-0018");
    while (provider.calls.length === 0) await new Promise((r) => setTimeout(r, 1));
    const id = (w.store.db.prepare("SELECT id FROM runtime_invocations").get() as { id: string })
      .id;
    await f.ava(`/api/runtime/invocations/${id}/cancel`, "POST");
    const inv = (await pending).body.invocation;
    expect(inv).toMatchObject({
      state: "cancelled",
      usage_state: "unknown",
      reserved_cents: 4,
      cancel_requested: true,
    });
  });

  it("a request over the time limit is stopped and held as unknown", async () => {
    const provider = new ScriptedRuntime(
      (_req, signal) =>
        new Promise((_ok, fail) =>
          signal.addEventListener("abort", () =>
            fail(new RuntimeFailure("aborted", "cancelled", null)),
          ),
        ),
    );
    const w = runtimeWorld(provider, { timeoutMs: 20 });
    const f = await w.founder();
    const inv = (await invoke(f, "trial-key-0019")).body.invocation;
    expect(inv).toMatchObject({
      state: "unknown",
      failure: { class: "timeout" },
      reserved_cents: 4,
    });
  });

  it("after a restart a running request becomes unknown and is never re-run", async () => {
    const provider = new ScriptedRuntime(() => new Promise(() => {})); // never answers
    const w = runtimeWorld(provider);
    const f = await w.founder();
    void invoke(f, "trial-key-0020");
    while (provider.calls.length === 0) await new Promise((r) => setTimeout(r, 1));
    // A new process over the same database.
    const fresh = new ScriptedRuntime();
    const restarted = new ManagedRuntime(w.store.db, w.store, fresh, { ceilingCents: 1_000 });
    expect(restarted.recover()).toBe(1);
    const row = w.store.db.prepare("SELECT * FROM runtime_invocations").get() as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      state: "unknown",
      failure_class: "outcome_unknown",
      reserved_cents: 4,
    });
    expect(fresh.calls).toHaveLength(0);
    expect(restarted.recover()).toBe(0);
  });

  it("with no runtime provider the service says so and runs nothing", async () => {
    const w = runtimeWorld(null);
    const f = await w.founder();
    const list = (await f.ava(`/api/product-projects/${f.project}/runtime`)).body;
    expect(list.availability).toMatchObject({ available: false });
    expect(list.availability.reason).toMatch(/Nothing is simulated/);
    const r = await invoke(f, "trial-key-0021");
    expect(r.status).toBe(409);
    expect(ledger(w)).toEqual([]);
  });

  it("only a succeeded build of this project can be run", async () => {
    const w = runtimeWorld();
    const f = await w.founder();
    const other = await w.founder("Ben Okafor");
    const r = await f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "trial-key-0022",
      artifact_job: other.job,
      text: DOC,
    });
    expect(r.status).toBe(404);
  });
});
