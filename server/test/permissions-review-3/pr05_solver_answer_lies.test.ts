// Promise 2: a swap is never shown as done when the verifier did not spend the nonce. A SolverPort
// that answers a hash without submitting anything (a lying or broken solver).

import { describe, expect, it } from "vitest";
import type { SolverPort } from "../../src/intentsFunding.ts";
import { reviewWorld } from "./world.ts";

describe("pr05 the solver's execute answers a hash but moves nothing", () => {
  it("the stage is unknown, then expired; never swapped or delivered", async () => {
    const r = await reviewWorld();
    const honest = r.intents.solver;
    const liar: SolverPort = {
      account: honest.account,
      publicKey: honest.publicKey,
      source: "synthetic",
      sign: (d) => honest.sign(d),
      execute: async () => ({ hash: "4".repeat(44) }),
    };
    (r.intents as { solver: SolverPort }).solver = liar;
    r.remake();
    await r.deal.propose();
    const q = (await r.i.quote()).body;
    r.i.deposit();
    r.i.registerKey();
    const s = await r.i.sign(q);
    expect(s.status).toBe(200);
    expect(s.body.stage).toBe("unknown");
    expect(s.body.exec_hash).toBe("4".repeat(44));
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(0n);
    expect((await r.i.status(q.id)).body.stage).toBe("unknown");
    r.clock.now += 130_000;
    const late = (await r.i.status(q.id)).body;
    expect(["expired", "refunded"]).toContain(late.stage);
    expect(late.stage).not.toBe("swapped");
  });
});
