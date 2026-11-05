// Deterministic cross-process interleaving at runtime admission, using the real services.
// A peer recovers the evaluation after its loop's read but before the case reserves a budget.
// This is an in-memory boundary probe, not an actual child-process test.
import { expect, it, vi } from "vitest";
import { Evaluations } from "../src/evaluations.ts";
import { ManagedRuntime } from "../src/invocations.ts";
import { correct, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

it("evaluation recovery before case admission prevents a new provider dispatch", async () => {
  const provider = new ScriptedRuntime(async (request) => correct(request));
  const w = runtimeWorld(provider, { runner: "expired-owner" });
  const f = await w.founder();
  const evaluations = new Evaluations(w.store.db, w.store, w.runtime);
  const peer = new ManagedRuntime(w.store.db, w.store, null, { runner: "live-peer" });
  const peerEvaluations = new Evaluations(w.store.db, w.store, peer);
  const original = w.runtime.start.bind(w.runtime);
  let recovered = 0;
  const admission = vi.spyOn(w.runtime, "start").mockImplementation((...args) => {
    recovered += peerEvaluations.recover({ isLive: () => false });
    return original(...args);
  });
  try {
    const started = evaluations.start(w.store.person(f.ava.id), f.project, {
      artifact_job: f.job,
    });
    await started.done;
    expect(recovered).toBe(1);
    expect(provider.calls).toHaveLength(0);
    expect(
      w.store.db.prepare("SELECT state FROM eval_runs WHERE id = ?").get(started.run.id),
    ).toEqual({ state: "stopped" });
  } finally {
    admission.mockRestore();
    w.store.db.close();
  }
});
