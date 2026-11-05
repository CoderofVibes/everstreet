// Job 003wf4 (OWNER_PLAN_SETUP.md §10 M-1/M-2): the sale double's guarded plan creation against
// the CONTRACT's own scripted history (fixtures/v3/plan-setup.json, written by contracts/business-v3
// tests.rs plan_setup_matches_server_fixture). Every step is applied as the founder's wallet
// transaction to the double: the same refusals with nothing changed, the same returned id, logs and
// refund, and after each step byte-identical plan-terms and plan views. Fictional data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS, FixtureChain, type Json, TOKEN } from "./customer-world.ts";

const F = JSON.parse(
  readFileSync(new URL("./fixtures/v3/plan-setup.json", import.meta.url), "utf8"),
) as Json;
const GAS = "30000000000000";

function world() {
  const chain = new FixtureChain();
  const sale = chain.attachSale();
  return { chain, sale };
}
const send = (chain: FixtureChain, signer: string, call: Json) =>
  chain.walletCall(signer, { gas: GAS, ...call } as never) as Json;
const value = (o: Json) => {
  const v = o.status?.SuccessValue;
  return typeof v === "string" && v !== "" ? JSON.parse(Buffer.from(v, "base64").toString()) : null;
};
const failure = (o: Json) => JSON.stringify(o.status?.Failure ?? null);

describe("003wf4 the sale double's guarded plan creation matches the contract", () => {
  it("starts from the contract's own views", () => {
    const { chain } = world();
    expect(F.business).toBe(BUSINESS);
    expect(chain.answer("get_plan_terms", {})).toBe(F.start.terms);
    expect(chain.answer("get_plan", { plan_id: 1 })).toBe(F.start.plan_1);
    expect(chain.answer("get_control", {})).toBe(F.start.control);
  });

  it("replays every step: refusals change nothing; successes give the same id, logs, refund and views", () => {
    const { chain, sale } = world();
    expect((F.steps as Json[]).length).toBe(9);
    for (const step of F.steps as Json[]) {
      const before = [chain.answer("get_plan_terms", {}), chain.answer("get_control", {})];
      const refundsBefore = sale.refunds.length;
      const o = send(chain, step.signer, {
        receiverId: BUSINESS,
        methodName: "create_plan_guarded",
        args: step.args,
        deposit: step.deposit,
      });
      if (step.refused) {
        expect(failure(o), step.case).toContain(step.refused);
        expect(
          [chain.answer("get_plan_terms", {}), chain.answer("get_control", {})],
          step.case,
        ).toEqual(before);
        expect(sale.refunds.length, step.case).toBe(refundsBefore);
      } else {
        expect(o.status.Failure, step.case).toBeUndefined();
        expect(value(o), step.case).toBe(step.value);
        const call = (o.receipts_outcome as Json[]).find((r) => r.outcome.executor_id === BUSINESS);
        expect(call?.outcome.logs, step.case).toEqual(step.logs);
        const back = sale.refunds.slice(refundsBefore).reduce((n, r) => n + r.amount, 0n);
        expect(String(back), step.case).toBe(step.refund);
      }
      expect(chain.answer("get_plan_terms", {}), step.case).toBe(step.terms);
      expect(chain.answer("get_plan", { plan_id: step.args.expected_plan_id }), step.case).toBe(
        step.plan,
      );
    }
  });

  it("the contract's history shows what the guard is for", () => {
    const by = (c: string) => (F.steps as Json[]).find((s) => s.case === c) as Json;
    expect(by("the reviewed plan")).toMatchObject({ value: 2, refund: "0" });
    // The same review once more after it landed: refused, nothing created twice.
    expect(by("the same review again")).toMatchObject({ refused: "E_REVIEWED", value: null });
    expect(JSON.parse(by("the same review again").terms).plan_count).toBe(2);
    expect(by("excess attached")).toMatchObject({ value: 3, refund: "5" });
    expect(F.quote).toBe(String(90n * 10_000_000_000_000_000_000n));
  });
});

describe("003wf4 the founder's call as a wallet transaction: wrong envelopes are refused", () => {
  it("a wrong receiver, method, argument shape, deposit or signer changes nothing", () => {
    const { chain } = world();
    const good = (F.steps as Json[]).find((s) => s.case === "the reviewed plan") as Json;
    const call = {
      receiverId: BUSINESS,
      methodName: "create_plan_guarded",
      args: good.args,
      deposit: good.deposit,
    };
    const terms = chain.answer("get_plan_terms", {});
    const cases: [string, string, Json, RegExp][] = [
      // The token double has no such method: its own refusal, before any change.
      [
        "the token as receiver",
        "founder.near",
        { ...call, receiverId: TOKEN },
        /not a purchase-path call/,
      ],
      [
        "another method",
        "founder.near",
        { ...call, methodName: "create_plans_guarded" },
        /MethodNotFound/,
      ],
      [
        "an extra argument",
        "founder.near",
        { ...call, args: { ...good.args, extra: 1 } },
        /deserialize/,
      ],
      ["a numeric deposit", "founder.near", { ...call, deposit: 900 }, /Invalid deposit/],
      ["another signer", "stranger.near", call, /E_NOT_OWNER/],
      [
        "one yoctoNEAR short",
        "founder.near",
        { ...call, deposit: String(BigInt(good.deposit) - 1n) },
        /E_STORAGE/,
      ],
    ];
    for (const [name, signer, c, why] of cases) {
      const o = send(chain, signer, c);
      expect(failure(o), name).toMatch(why);
      expect(chain.answer("get_plan_terms", {}), name).toBe(terms);
    }
    // The exact reviewed call then lands, once: its receipt returns the reviewed id.
    const o = send(chain, "founder.near", call);
    expect(value(o)).toBe(2);
    expect(JSON.parse(chain.answer("get_plan", { plan_id: 2 }))).toMatchObject({
      unit_price: good.args.input.unit_price,
      created_generation: 1,
    });
    // An older contract without the capability: no guided plan (the view and the method are absent).
    const old = world();
    old.sale.planTerms = false;
    expect(() => old.chain.answer("get_plan_terms", {})).toThrow(/MethodNotFound/);
    expect(failure(send(old.chain, "founder.near", call))).toMatch(/MethodNotFound/);
  });
});
