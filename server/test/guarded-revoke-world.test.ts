// Job 003wec: the key-call double (applyKeyCall, used by the review harness and the route tests)
// against the CONTRACT's own guarded-revocation history (server/test/fixtures/v3/guarded-revoke.json,
// written by contracts/business-v3 tests.rs guarded_revoke_matches_server_fixture). Every step is
// replayed from the contract's starting entitlement: the same refusals (and nothing changed by a
// refusal), and after each step the same key slots and serving deadline. Fictional data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyKeyCall } from "../../scripts/lib/walletHarness.ts";
import type { Json } from "./customer-world.ts";

const RAW = JSON.parse(
  readFileSync(new URL("./fixtures/v3/guarded-revoke.json", import.meta.url), "utf8"),
) as Json;
/** The contract writes its entitlement and key views as JSON strings; parsed here. */
const F = {
  ...RAW,
  start: JSON.parse(RAW.start),
  steps: (RAW.steps as Json[]).map((x) => ({ ...x, keys: JSON.parse(x.keys) })),
} as Json;

describe("003wec the key-call double matches the contract's guarded revocation", () => {
  it("replays every step: refusals change nothing, successes match the contract's key slots", () => {
    const ent = structuredClone(F.start) as Json;
    const plan = { plan_id: 1, max_hold_units: 10, now_ms: BigInt(F.now_ms) };
    expect(F.steps.length).toBeGreaterThan(10);
    for (const step of F.steps as Json[]) {
      const call = { methodName: step.method, args: step.args, deposit: step.deposit };
      const before = JSON.stringify(ent);
      if (step.refused) {
        expect(() => applyKeyCall(ent, call, plan), step.case).toThrow(
          new RegExp(`^${step.refused}`),
        );
        expect(JSON.stringify(ent), `${step.case}: a refusal changed nothing`).toBe(before);
      } else {
        expect(() => applyKeyCall(ent, call, plan), step.case).not.toThrow();
      }
      expect(ent.keys, step.case).toEqual(step.keys);
      expect(ent.serve_until_ms, step.case).toBe(step.serve_until_ms);
    }
  });

  it("the contract's history shows what the guard is for", () => {
    const by = (c: string) => (F.steps as Json[]).find((s) => s.case === c) as Json;
    // The reviewed key is revoked once; its replacement then survives the old review.
    expect(by("the reviewed key").keys[1]).toMatchObject({ state: "revoked", epoch: 2 });
    expect(by("a replacement").keys[1]).toMatchObject({ state: "active", epoch: 3 });
    expect(by("the old review again")).toMatchObject({ refused: "E_STALE_REVIEW" });
    expect(by("the old review again").keys[1]).toMatchObject({ state: "active", epoch: 3 });
    // Serving stopped at the revocation (an active hold under slot 1).
    expect(F.start.hold_active).toBe(true);
    expect(by("the reviewed key").serve_until_ms).toBe(F.now_ms);
  });
});

describe("003wec the review harness's wallet applies the guarded revocation by the same rules", () => {
  it("a stale guarded request is refused and changes nothing; the reviewed one revokes; the older-contract control", async () => {
    const { harnessControl, walletHarness } = await import("../../scripts/lib/walletHarness.ts");
    const { BUSINESS, CUSTOMER } = await import("./customer-world.ts");
    const h = await walletHarness({ origin: "http://127.0.0.1:8814" });
    try {
      const send = (args: Json) =>
        h.site.request("http://127.0.0.1:8814/__harness/tx", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            receiverId: BUSINESS,
            actions: [
              {
                methodName: "revoke_key_guarded",
                args: JSON.stringify(args),
                gas: "30000000000000",
                deposit: "1",
              },
            ],
          }),
        });
      const e = h.world.chain.ent(CUSTOMER) as Json;
      const k = e.keys[0];
      const reviewed = { plan_id: 1, slot: 0, reg_id: e.reg_id, epoch: k.epoch, pk: k.public_key };
      const before = JSON.stringify(e);
      const stale = await send({ ...reviewed, epoch: k.epoch + 2 });
      expect(stale.status).toBe(400);
      expect((await stale.json()).error).toMatch(/^E_STALE_REVIEW/);
      expect(JSON.stringify(h.world.chain.ent(CUSTOMER))).toBe(before);
      expect((await send(reviewed)).status).toBe(200);
      expect(h.world.chain.ent(CUSTOMER)?.keys[0]).toMatchObject({ state: "revoked" });
      const control = harnessControl(h);
      const r = await control.request("http://127.0.0.1:8815/older-contract", { method: "POST" });
      expect(await r.json()).toEqual({ guarded_revoke: false });
      expect(h.world.chain.keyTerms).toBe(false);
    } finally {
      h.world.rw.store.db.close();
    }
  });
});
