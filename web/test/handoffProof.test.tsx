// @vitest-environment jsdom
//
// The handoff proof page (Continuity Receipt, design/sale-proof/DECISION.md): the customer's next
// settled use leads; each fact carries its source with a mark and words (never colour alone);
// a missing value says so; disagreeing providers read Uncertain with the last coherent record;
// the receipt is one click away.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/router.tsx", async () => {
  const React = await import("react");
  return {
    Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) =>
      React.createElement("a", { href: to, className }, children as never),
  };
});
vi.mock("../src/session.tsx", () => ({
  useSession: () => ({ account: "buyer.near", person: { id: "p-noah", name: "Noah Brandt" } }),
}));

import { HandoffProofPage } from "../src/pages/HandoffProof.tsx";
import type { HandoffProofView } from "../src/saleApi.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

const proof = (o: Partial<HandoffProofView> = {}): HandoffProofView => ({
  business: { id: "biz-1", name: "Signalwatch" },
  network: "testnet",
  contract: "signalwatch.demo.near",
  source: "synthetic",
  block: { height: "2004", hash: "h", timestamp_ms: "1794013637691" },
  deal: {
    seq: "1",
    version: 1,
    digest: "e0e47c23a35ce6075e47ec57c8a0dd52613494b9b38360feb6bac9d410f7203b",
    seller: "delphine.near",
    buyer: "buyer.near",
    price: "180000000",
    generation_after: 2,
    at_ms: "1794013583223",
  },
  asset: "tusd.near",
  token: { symbol: "TUSD", decimals: 6 },
  viewer: { operates: true },
  continuity: {
    customer: { account: "cara.near", name: "Cara Okafor" },
    at_close: "80",
    after: "79",
    charged: 1,
    at_close_block: "1992",
    after_block: "2000",
  },
  facts: [
    {
      key: "contract",
      label: "Business contract",
      value: "signalwatch.demo.near",
      source: "everstreet",
    },
    { key: "owner", label: "Owner", value: "buyer.near", source: "synthetic", block: "2004" },
    { key: "generation", label: "Generation", value: 2, source: "synthetic", block: "2004" },
    { key: "access_keys", label: "Access keys", value: 0, source: "synthetic", block: "2004" },
    { key: "code_hash", label: "Code hash", value: null, source: "synthetic", block: null },
    { key: "next_settled_use", label: "Next settled use", value: "79", source: "synthetic" },
  ],
  rights: {
    ended: [{ what: "owner_role", account: "delphine.near", generation: 1 }],
    carried_over: { operators: [{ account: "meter.near", caps: 1 }], customers: 2, units: "186" },
    operates: { account: "buyer.near", generation: 2, moved: true },
    seller_claim: { account: "delphine.near", owed: "180000000", in_flight: "0" },
    still_possible: [],
  },
  agreement: {
    status: "agree",
    block: { height: "2004", hash: "h" },
    providers: [
      {
        name: "Provider A",
        owner: "buyer.near",
        generation: 2,
        control_seq: "5",
        block_height: "2004",
        error: null,
      },
      {
        name: "Provider B",
        owner: "buyer.near",
        generation: 2,
        control_seq: "5",
        block_height: "2004",
        error: null,
      },
    ],
    last_coherent: null,
  },
  snapshot: { block: { height: "1992", hash: "s", timestamp_ms: "1" }, code_hash: null, keys: 0 },
  ...o,
});

async function render(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(HandoffProofPage, { id: "biz-1" })));
  await act(async () => {});
  return host;
}

describe("handoff proof page", () => {
  it("leads with the customer's next settled use; every fact shows its source", async () => {
    const el = await render(proof());
    expect(el.querySelector(".proof-hero")?.textContent).toContain("Cara Okafor · customer");
    expect(el.querySelector(".proof-units")?.textContent).toContain("80");
    expect(el.querySelector(".proof-units")?.textContent).toContain("79");
    expect(el.textContent).toContain("Next use settled");
    // Sources: a mark and words, and the block in the accessible name.
    const tags = [...el.querySelectorAll(".src-tag")].map((t) => t.textContent);
    expect(tags).toContain("◇ Synthetic run, block 2004");
    expect(tags).toContain("≡ Everstreet record");
    // Unknown is never shown as zero.
    expect(el.textContent).toContain("Not recorded");
    expect(el.textContent).toContain("180 TUSD owed");
    const dl = el.querySelector<HTMLAnchorElement>("a[download]");
    expect(dl?.getAttribute("href")).toBe("/api/sales/biz-1/receipt");
    expect(el.textContent).toContain("Agree at the same block");
  });

  it("disagreeing providers: Uncertain on the comparison and on owner and generation", async () => {
    const p = proof();
    p.agreement = {
      ...p.agreement,
      status: "uncertain",
      providers: [
        p.agreement.providers[0] as HandoffProofView["agreement"]["providers"][number],
        {
          name: "Provider B",
          owner: "someone-else.testnet",
          generation: 2,
          control_seq: "5",
          block_height: "2004",
          error: null,
        },
      ],
      last_coherent: { block_height: "2001", owner: "buyer.near", generation: 2, observed_at: "x" },
    };
    const el = await render(p);
    expect(
      [...el.querySelectorAll(".pill")].filter((x) => x.textContent?.trim() === "Uncertain").length,
    ).toBe(3);
    expect(el.textContent).toContain("someone-else.testnet");
    expect(el.textContent).toMatch(/Last coherent.*buyer\.near.*block\s*2001/);
  });

  it("a former seller sees counts, not the customer; no use yet reads None yet", async () => {
    const el = await render(
      proof({
        viewer: { operates: false },
        continuity: {
          customer: null,
          at_close: null,
          after: null,
          charged: 0,
          at_close_block: "1992",
          after_block: null,
        },
        facts: [
          {
            key: "units_at_close",
            label: "Customers' units at close",
            value: "186",
            source: "synthetic",
          },
          { key: "next_settled_use", label: "Next settled use", value: null, source: "synthetic" },
        ],
      }),
    );
    expect(el.textContent).not.toContain("Cara");
    expect(el.querySelector(".proof-units")?.textContent).toContain("186units carried over");
    expect(el.textContent).toContain("No use since the close");
    expect(el.textContent).toContain("None yet");
  });

  it("no close yet: says so, with a way back", async () => {
    const el = await render({ error: "No closed sale here yet.", code: "no_close" }, 404);
    expect(el.textContent).toContain("No closed sale here yet");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("/sales/biz-1");
  });
});
