// Promise 8: Everstreet never shows a state the chain contradicts, e.g. a swap as done that the
// verifier did not spend. Where does the "swapped" stage come from: the solver's own answer, or
// the verifier's record?
import { describe, expect, it } from "vitest";
import type { SolverPort } from "../../src/intentsFunding.ts";
import { BUYER, nearKey, reviewWorld } from "./world.ts";

describe("pr16: the swapped stage against the verifier's own record", () => {
  it("a success answer the verifier doesn't corroborate is not shown as swapped", async () => {
    const w = await reviewWorld();
    // A solver whose RPC answers "success" for a transaction the verifier never executed (a
    // misreporting endpoint, a reorg, a forged answer): same key, same account, nothing applied.
    const real = w.intents.solver;
    const lying: SolverPort = {
      account: real.account,
      publicKey: real.publicKey,
      source: "synthetic",
      sign: (d) => real.sign(d),
      execute: async () => ({ hash: "11111111111111111111111111111111111111111111" }),
    };
    w.w.state.app = w.w.make(w.w.state.store, undefined, {
      companions: { bindings: [], evm: null },
      intents: {
        bindings: [
          {
            business_id: w.biz,
            network: "testnet",
            account: w.BUSINESS,
            asset: "tusd.near",
            verifier: "intents.synthetic.near",
            offers: [
              {
                token: "talt.synthetic.near",
                symbol: "tALT",
                decimals: 6,
                rate_num: "5",
                rate_den: "4",
              },
            ],
          },
        ],
        solver: lying,
      },
    });
    await w.proposeAndRegister();
    const q = await w.quote(w.noah);
    expect(q.status).toBe(200);
    const key = nearKey();
    w.registerKey(BUYER, key.publicKey);
    w.deposit(q.body.give.amount);
    const r = await w.signIntent(w.noah, q.body.id, {
      public_key: key.publicKey,
      signature: w.signQuote(key, q.body),
    });
    expect(r.status).toBe(200);
    // The verifier spent nothing: the buyer's nonce is unused and their deposit is still inside.
    expect(w.intents.verifier.nonces.size).toBe(0);
    expect(w.intents.verifier.inside.get(BUYER)?.get("nep141:talt.synthetic.near")).toBe(
      BigInt(q.body.give.amount),
    );
    // So no read may show the swap as done.
    const done = ["swapped", "delivered", "funded"];
    const status = await w.noah(`/api/intents/${q.body.id}`);
    expect(done, JSON.stringify(status.body)).not.toContain(status.body.stage);
    const panel = await w.noah(`/api/sales/${w.biz}/intents`);
    expect(done, JSON.stringify(panel.body.funding)).not.toContain(panel.body.funding.stage);
  });
});
