// @vitest-environment jsdom
// Job 003wf3: the sale page's managed-handover panel and next actions for a Gated sale, rendered
// from setup shapes the server returns (MANAGED_HANDOVER.md §8, §16.8 D4, Astra's aftercare).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HandoverPanel } from "../src/pages/SaleRoom.tsx";
import type { SaleHandover, SaleSetup } from "../src/saleApi.ts";
import { saleNext } from "../src/saleFlow.ts";

const text = (h: SaleHandover) => {
  const s = { handover: h } as unknown as SaleSetup;
  return (
    new DOMParser().parseFromString(
      renderToStaticMarkup(createElement(HandoverPanel, { s })),
      "text/html",
    ).body.textContent ?? ""
  );
};
const base: SaleHandover = {
  id: "h1",
  state: "gated",
  deal_seq: "1",
  version: 1,
  closing_started_ms: "1793872000000",
  deadline_ms: "1793873800000",
  waiting_for: "not_ready:customers_executions_running",
  checked_at_ms: 1,
  attention_reason: null,
  outcome: null,
  orders: [],
  service: null,
};

describe("003wf3 the handover panel says what is happening, in plain words", () => {
  it("while checking: customer uses finishing, the deadline with its zone, no internal code", () => {
    const t = text(base);
    expect(t).toContain("Handover: Checking the handover");
    expect(t).toContain(
      "Customer uses already in progress are finishing and settling. New uses are paused.",
    );
    expect(t).toMatch(/Close deadline.*UTC/);
    expect(t).not.toContain("not_ready");
  });

  it("an order sent but not answered is described from its own transaction, never as failed", () => {
    const t = text({
      ...base,
      state: "outcome_unknown",
      waiting_for: "order_outstanding",
      orders: [
        {
          n: 1,
          issued_at_ms: "1793872100000",
          attempt: { state: "signed", code: null, tx_hash: "HASH1" },
        },
      ],
    });
    expect(t).toContain("its answer didn't arrive, so it's confirmed from the contract");
    expect(t).toContain("sent; its outcome is read from its own transaction");
    expect(t).not.toMatch(/failed/i);
  });

  it("after the close, administration and customer service are separate facts (D4)", () => {
    const paused = text({
      ...base,
      state: "released_to_buyer",
      waiting_for: null,
      service: {
        eligible: false,
        reasons: ["runtime_unavailable: no provider", "metering_not_appointed"],
        note: "",
      },
    });
    expect(paused).toContain("Handed over to the buyer");
    expect(paused).toContain(
      "Customer service: paused: the product can't run on this server now; the platform's metering account isn't appointed for the new owner.",
    );
    const ok = text({
      ...base,
      state: "released_to_buyer",
      waiting_for: null,
      service: { eligible: true, reasons: [], note: "" },
    });
    expect(ok).toContain("eligible");
    expect(ok).toContain("A customer's next use is what proves it.");
    expect(ok).not.toMatch(/customers (are )?served/i);
  });

  it("attention keeps the business paused and says why plainly", () => {
    const t = text({ ...base, state: "attention", attention_reason: "authority_advanced" });
    expect(t).toContain("Needs attention");
    expect(t).toContain("nothing was changed and the business stays paused until they do");
  });
});

describe("003wf3 next actions for a Gated sale", () => {
  const setup = (over: Record<string, unknown>) =>
    ({
      status: "ready",
      setup: {
        open: [],
        intents: [],
        outcomes: [],
        party: null,
        payouts: [],
        token: { registered: true },
        capability: { supported: true, reason: null },
        roles: {
          seller: true,
          buyer: false,
          former_seller: false,
          new_owner: false,
          chain_owner: true,
          claimant: false,
        },
        local_owner: true,
        business: { id: "biz-1", name: "Biz" },
        platform_operator: "meter.testnet",
        metering_appointed: true,
        block: { height: "10", hash: "h", timestamp_ms: "1000" },
        control: { close_mode: "gated", closer: "closer.testnet", live_deal: null },
        ...over,
      },
    }) as never;
  const deal = (over: Record<string, unknown>) => ({
    seq: "1",
    version: 1,
    state: "accepting",
    expires_at_ms: "999999999",
    deadline_ms: "0",
    seller_accepted: false,
    buyer_accepted: true,
    escrow: "250",
    price: "250",
    ...over,
  });

  it("the acceptance that starts a Gated closing says so; while closing nothing is offered; after the deadline, ending it", () => {
    const accept = saleNext(
      setup({ control: { close_mode: "gated", closer: "c.testnet", live_deal: deal({}) } }),
    );
    expect(accept).toMatchObject({
      action: "accept",
      label: "Accept version 1 and start the closing",
    });
    const closing = saleNext(
      setup({
        control: {
          close_mode: "gated",
          closer: "c.testnet",
          live_deal: deal({ state: "closing", deadline_ms: "5000" }),
        },
      }),
    );
    expect(closing).toMatchObject({ action: "none" });
    expect((closing as { why: string }).why).toContain("Everstreet is checking the handover");
    const late = saleNext(
      setup({
        block: { height: "11", hash: "h", timestamp_ms: "6000" },
        control: {
          close_mode: "gated",
          closer: "c.testnet",
          live_deal: deal({ state: "closing", deadline_ms: "5000" }),
        },
      }),
    );
    expect(late).toMatchObject({ action: "abort", label: "End the closing" });
  });

  it("aftercare: the new owner's primary action is the business", () => {
    const n = saleNext(
      setup({
        roles: {
          seller: true,
          buyer: false,
          former_seller: false,
          new_owner: true,
          chain_owner: true,
          claimant: false,
        },
      }),
    );
    expect(n).toMatchObject({
      action: "operate",
      label: "Open your business",
      href: "/desk/biz-1",
    });
  });
});
