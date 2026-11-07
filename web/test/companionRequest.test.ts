// The browser re-derives a companion request from what the companions showed before the wallet
// sees it: a changed receiver, method, destination, source generation or grant term is caught.

import { describe, expect, it } from "vitest";
import { expectedCompanionCall } from "../src/pages/CompanionRequest.tsx";
import type { CompanionPrepared, CompanionView } from "../src/saleApi.ts";

const view: CompanionView = {
  control: { owner: "buyer.near", generation: 2 },
  you_own_it: true,
  asset: {
    account: "feed.near",
    registry: "0x5e",
    chain_id: "11155111",
    chain: "synthetic EVM chain",
    source: "synthetic",
    controller: "0xaaa",
    controller_generation: 1,
    addresses: [
      { generation: 1, address: "0xaaa" },
      { generation: 2, address: "0xbbb" },
    ],
    move: null,
  },
  allowance: {
    account: "budget.near",
    grant: {
      agent: "agent.near",
      suppliers: ["larchmere.near"],
      per_payment: "2000000",
      per_period: "60000000",
      period_ms: "604800000",
      review_above: "5000000",
      generation: 1,
    },
    balance: "1",
    reserved: "0",
    available: "1",
    spent_in_period: "0",
    claims_total: "0",
    period_start_ms: "0",
    active: false,
    awaiting: [],
    recent: [],
  },
};

const move = (args: Record<string, unknown>, receiverId = "feed.near"): CompanionPrepared => ({
  id: "x",
  kind: "feed_move",
  review: {},
  call: { receiverId, methodName: "request", args, gas: "1", deposit: "1" },
});

describe("companion requests are re-derived in the browser", () => {
  it("accepts exactly the move to your generation's address from the controller's generation", () => {
    const ok = move({
      action: { kind: "set_controller", to: "0xBBB", from_generation: 1 },
      tx: {},
    });
    expect(expectedCompanionCall(ok, view, {})).toBeNull();
  });
  it("catches a changed destination, source, receiver or kind", () => {
    expect(
      expectedCompanionCall(
        move({ action: { kind: "set_controller", to: "0xccc", from_generation: 1 } }),
        view,
        {},
      ),
    ).toBe("not to your address");
    expect(
      expectedCompanionCall(
        move({ action: { kind: "set_controller", to: "0xbbb", from_generation: 2 } }),
        view,
        {},
      ),
    ).toBe("not from the current controller");
    expect(
      expectedCompanionCall(
        move({ action: { kind: "set_controller", to: "0xbbb", from_generation: 1 } }, "evil.near"),
        view,
        {},
      ),
    ).toBe("not the companion's request");
    expect(
      expectedCompanionCall(move({ action: { kind: "publish", digest: "00" } }), view, {}),
    ).toBe("not a controller move");
  });
  it("a grant must repeat the shown terms exactly", () => {
    const g = view.allowance?.grant as NonNullable<
      NonNullable<CompanionView["allowance"]>["grant"]
    >;
    const grant = (over: Record<string, unknown>): CompanionPrepared => ({
      id: "g",
      kind: "allowance_grant",
      review: {},
      call: {
        receiverId: "budget.near",
        methodName: "grant",
        args: { ...g, ...over },
        gas: "1",
        deposit: "0",
      },
    });
    expect(expectedCompanionCall(grant({}), view, {})).toBeNull();
    expect(expectedCompanionCall(grant({ per_payment: "9000000" }), view, {})).toBe(
      "the per_payment changed",
    );
    expect(expectedCompanionCall(grant({ agent: "other.near" }), view, {})).toBe(
      "the agent changed",
    );
    expect(expectedCompanionCall(grant({ suppliers: ["x.near"] }), view, {})).toBe(
      "the suppliers changed",
    );
  });
});
