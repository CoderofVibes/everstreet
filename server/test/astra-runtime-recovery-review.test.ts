// Deterministic interleaving of two recovery owners at the supported liveness callback.
// Real runtime records/transactions; fictional provider, no network or browser permissions.
import { expect, it } from "vitest";
import { ManagedRuntime } from "../src/invocations.ts";
import { CLEAN, gate, reply, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

it("two recovery readers cannot settle one abandoned invocation twice", async () => {
  const entered = gate();
  const held = gate();
  const provider = new ScriptedRuntime(async () => {
    entered.open();
    await held.opened;
    return reply(CLEAN);
  });
  const w = runtimeWorld(provider, { runner: "departed-process" });
  const founder = await w.founder();
  const pending = founder.ava(
    `/api/product-projects/${founder.project}/runtime/invocations`,
    "POST",
    {
      idempotency_key: "recovery-race-0001",
      artifact_job: founder.job,
      text: "Fictional invoice from Stackline Hosting, total USD 412.50",
    },
  );
  try {
    await entered.opened;
    let settlements = 0;
    const options = {
      admission: {
        admit() {},
        settle() {
          settlements++;
        },
      },
    };
    const a = new ManagedRuntime(w.store.db, w.store, null, options);
    const b = new ManagedRuntime(w.store.db, w.store, null, options);
    a.recover({
      isLive() {
        // A already selected the running row. B finishes recovery before A takes its
        // transaction: the interleaving allowed by separate processes sharing this store.
        b.recover({ isLive: () => false });
        return false;
      },
    });
    expect(w.store.db.prepare("SELECT state FROM runtime_invocations").get()).toMatchObject({
      state: "unknown",
    });
    expect(
      w.store.db.prepare("SELECT COUNT(*) AS n FROM runtime_usage WHERE kind = 'unknown'").get(),
    ).toMatchObject({ n: 1 });
    expect(settlements).toBe(1);
  } finally {
    held.open();
    await pending;
    w.store.db.close();
  }
});
