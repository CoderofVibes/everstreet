// A peer can recover expired ownership while the original process is merely delayed.
// Its late continuation must not resurrect a stopped evaluation or dispatch more paid cases.
import { expect, it } from "vitest";
import { Evaluations } from "../src/evaluations.ts";
import { ManagedRuntime } from "../src/invocations.ts";
import { correct, gate, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

it("a recovered evaluation stays stopped when its old provider answer finally arrives", async () => {
  const entered = gate();
  const held = gate();
  const provider = new ScriptedRuntime(async (request) => {
    entered.open();
    await held.opened;
    return correct(request);
  });
  const w = runtimeWorld(provider, { runner: "expired-owner" });
  const f = await w.founder();
  const evaluations = new Evaluations(w.store.db, w.store, w.runtime);
  const started = evaluations.start(w.store.person(f.ava.id), f.project, { artifact_job: f.job });
  try {
    await entered.opened;
    const peer = new ManagedRuntime(w.store.db, w.store, null, { runner: "live-peer" });
    const peerEvaluations = new Evaluations(w.store.db, w.store, peer);
    expect(peer.recover({ isLive: () => false })).toBe(1);
    expect(peerEvaluations.recover({ isLive: () => false })).toBe(1);
    const stopped = w.store.db
      .prepare("SELECT state, results FROM eval_runs WHERE id = ?")
      .get(started.run.id);
    expect(stopped).toMatchObject({ state: "stopped" });
    held.open();
    await started.done;
    expect(
      w.store.db.prepare("SELECT state, results FROM eval_runs WHERE id = ?").get(started.run.id),
    ).toEqual(stopped);
    expect(provider.calls).toHaveLength(1);
  } finally {
    held.open();
    await started.done;
    w.store.db.close();
  }
});
