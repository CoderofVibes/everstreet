// Job 003wf3 (MANAGED_HANDOVER.md §16.1, M-1): the sale double replays the contract's own scripted
// Gated history (fixtures/v3/gated-sale.json, produced by contracts/business-v3 tests.rs
// gated_sale_matches_server_fixture): a 30-minute close window, a hold opened while accepting, NEW
// holds refused while Closing (the operator's and the owner's own), the existing hold settled while
// Closing, close-order refusals, the close, its replay refused, proceeds paid, the successor meter
// serving; then a second deal that nobody closes, the closer refused after the deadline, anyone's
// abort, every order refused after it, the returned escrow paid and holds working again.
//
// Sale calls go through the double's own encoded-call path and must give the contract's codes,
// values, logs and byte-identical views. The customer-hold steps (open_hold, settle_hold) belong to
// the customer half of the same state (customer-world.ts FixtureChain, whose own encodings the
// customer fixtures pin): here they apply the guard the double shares with FixtureChain
// (`requireNoClosingForNewHold`) and the treasury moves they cause, and are checked against the
// contract's codes and views.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SaleChain, startFromFixture } from "./sale-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON, read field by field
type Json = Record<string, any>;
const here = dirname(fileURLToPath(import.meta.url));
const DOC = JSON.parse(
  readFileSync(join(here, "fixtures", "v3", "gated-sale.json"), "utf8"),
) as Json;
const UNIT = 10n ** 18n; // fixture_world's plan 2 unit price (E18), one-unit holds

const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

function world() {
  const balances = new Map<string, bigint>();
  const registered = new Set<string>();
  for (const a of [
    "founder.near",
    "buyer.near",
    "stranger.near",
    "meter.near",
    "meter2.near",
    DOC.business as string,
  ]) {
    balances.set(a, 10n ** 30n);
    registered.add(a);
  }
  return new SaleChain(startFromFixture(DOC), { balances, registered });
}

function viewsOf(c: SaleChain, expected: Json) {
  return {
    get_control: c.view("get_control", {}),
    get_treasury: c.view("get_treasury", {}),
    get_outcomes: c.view("get_outcomes", {}),
    get_pending: c.view("get_pending", {}),
    get_party: Object.fromEntries(
      Object.keys(expected.get_party).map((a) => [a, c.view("get_party", { account: a })]),
    ),
    get_sale_terms: Object.fromEntries(
      Object.keys(expected.get_sale_terms).map((a) => [a, c.view("get_sale_terms", { buyer: a })]),
    ),
  };
}

describe("003wf3 the sale double replays the contract's Gated history (close and abort)", () => {
  it("starts from the contract's Gated views, with its closer", () => {
    const c = world();
    expect(viewsOf(c, DOC.start)).toEqual(DOC.start);
    expect(JSON.parse(DOC.start.get_control)).toMatchObject({
      close_mode: "gated",
      closer: DOC.closer,
    });
  });

  it("replays every step: same codes, values, logs and byte-identical views", () => {
    const c = world();
    const steps = DOC.steps as Json[];
    expect(steps.length).toBeGreaterThanOrEqual(25);
    const seen = new Set<string>();
    for (const s of steps) {
      const where = `step "${s.case}"`;
      c.now = BigInt(s.now_ms);
      seen.add(s.method);
      if (s.method === "open_hold" || s.method === "settle_hold") {
        // The customer half: the shared guard, then the treasury move the contract made.
        let refused: string | null = null;
        if (s.method === "open_hold")
          try {
            c.requireNoClosingForNewHold();
          } catch (e) {
            refused = String((e as Error).message);
          }
        if (s.refused) expect(refused, where).toContain(s.refused);
        else {
          expect(refused, where).toBeNull();
          if (s.method === "open_hold") {
            expect(s.value, where).toBe("opened");
            c.customerHeld(UNIT);
          } else {
            expect(s.value, where).toEqual(["charged"]);
            c.customerCharged(UNIT);
          }
        }
        expect(viewsOf(c, s.views), where).toEqual(s.views);
        continue;
      }
      if (s.payout) c.failPayouts = s.payout.transfer_ok ? 0 : 1;
      const out = c.walletCall(s.signer, {
        receiverId: s.receiver,
        methodName: s.method,
        args: s.args,
        deposit: s.deposit,
        gas: "30000000000000",
      });
      const receipts = out.receipts_outcome as Json[];
      const first = receipts[0]?.outcome as Json;
      if (s.refused) {
        expect("Failure" in out.status, where).toBe(true);
        expect(JSON.stringify(first.status), where).toContain(s.refused);
      } else if (s.method === "ft_transfer_call") {
        const receiver = receipts.find((r) => r.outcome.executor_id === DOC.business)?.outcome;
        expect(JSON.parse(decode(receiver.status.SuccessValue)), where).toBe(s.unused);
        expect(receiver.logs, where).toEqual(s.logs);
      } else if (s.payout) {
        expect(first.logs, where).toEqual(s.logs);
        const cb = receipts.find((r) => r.id.endsWith("callback"))?.outcome;
        expect(cb.logs, where).toEqual(s.payout.logs);
        expect(JSON.parse(decode(out.status.SuccessValue)), where).toBe(s.payout.value);
      } else {
        expect(first.logs, where).toEqual(s.logs);
        const v = decode(first.status.SuccessValue);
        if (s.value === null) expect(v, where).toBe("");
        else expect(JSON.parse(v), where).toEqual(s.value);
      }
      expect(viewsOf(c, s.views), where).toEqual(s.views);
    }
    // Both Gated endings and the guard were exercised by the contract's own script.
    for (const m of ["close_sale", "abort_close", "open_hold", "settle_hold"])
      expect(seen.has(m), m).toBe(true);
    expect(steps.some((s) => s.method === "open_hold" && s.refused === "E_CLOSING")).toBe(true);
  });

  it("refuses a close or abort it doesn't model: deposits, malformed orders, the wrong caller", () => {
    const c = world();
    const call = (signer: string, methodName: string, args: unknown, deposit = "0") =>
      c.walletCall(signer, {
        receiverId: DOC.business,
        methodName,
        args: args as Json,
        deposit,
        gas: "30000000000000",
      });
    const failed = (o: Json) => JSON.stringify(o.receipts_outcome[0].outcome.status);
    const order = {
      deal_seq: "1",
      version: 1,
      digest: "00".repeat(32),
      expected_generation: 1,
      closing_control_seq: "5",
      manifest: "00".repeat(32),
      manifest_seq: "0",
      issued_at_ms: "0",
    };
    const before = JSON.stringify(viewsOf(c, DOC.start));
    expect(failed(call(DOC.closer, "close_sale", { order }, "1"))).toContain(
      "doesn't accept deposit",
    );
    expect(failed(call(DOC.closer, "close_sale", { order: { ...order, extra: 1 } }))).toContain(
      "Failed to deserialize",
    );
    expect(failed(call("founder.near", "close_sale", { order }))).toContain("E_NOT_CLOSER");
    expect(failed(call(DOC.closer, "close_sale", { order }))).toContain("E_NO_DEAL");
    expect(failed(call("stranger.near", "abort_close", { deal_seq: "1" }, "1"))).toContain(
      "doesn't accept deposit",
    );
    expect(failed(call("stranger.near", "abort_close", { deal_seq: "1" }))).toContain("E_NO_DEAL");
    expect(JSON.stringify(viewsOf(c, DOC.start))).toBe(before);
  });
});
