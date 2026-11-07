// Promise 1: the solver's key never leaves the server: no response, no stored error, no label. The
// synthetic solver's private key is exported here only to search for it.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr16 the solver's key", () => {
  it("appears in no response, no stored error and no echo of the configuration", async () => {
    const r = await reviewWorld();
    const solver = r.intents.solver as unknown as { key: import("node:crypto").KeyObject };
    const secret = solver.key.export({ format: "der", type: "pkcs8" }).subarray(-32);
    const needles = [
      secret.toString("base64"),
      secret.toString("hex"),
      secret.toString("base64url"),
      // The key file form NEAR tools write.
      "private_key",
      "secret_key",
    ];
    const seen: string[] = [];
    const see = (x: unknown) => seen.push(JSON.stringify(x));

    await r.deal.propose();
    see(await r.i.panel());
    const q = (await r.i.quote()).body;
    see(q);
    see(await r.i.status(q.id));
    // A refusal path whose text comes from the verifier: the solver's key is not registered there.
    r.intents.verifier.keys.delete(r.intents.solver.account);
    r.i.deposit();
    r.i.registerKey();
    see(await r.i.sign(q));
    see(await r.i.status(q.id));
    see(await r.i.panel());
    // The honest fill, and a lost answer, on a fresh quote.
    r.intents.verifier.keys.set(r.intents.solver.account, new Set([r.intents.solver.publicKey]));
    const q2 = (await r.i.quote()).body;
    r.i.deposit();
    r.intents.solver.loseNext = true;
    see(await r.i.sign(q2));
    see(await r.i.status(q2.id));
    see(await r.anon("/api/env"));
    see(await r.ava("/api/env"));
    // Everything stored about fundings.
    see(r.w.state.store.db.prepare("SELECT * FROM intent_fundings").all());

    const all = seen.join("\n");
    for (const n of needles) expect(all, `found ${n.slice(0, 12)}…`).not.toContain(n);
    // The solver is named by account and source only.
    for (const s of seen) {
      const j = JSON.parse(s) as { body?: { solver?: unknown } };
      const sol =
        (j.body as { solver?: unknown } | undefined)?.solver ?? (j as { solver?: unknown }).solver;
      if (sol) expect(Object.keys(sol as object).sort()).toEqual(["account", "source"]);
    }
  });
});
