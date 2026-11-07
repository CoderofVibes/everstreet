// @vitest-environment jsdom
//
// The recorded testnet example in the proof layout, rendered from the committed, verified record
// (server/src/examples.ts over data/evidence/v3-direct-testnet.json): 80 at close, 79 after the
// buyer's first use, testnet sources, explorer links, the former owner's refusals.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/router.tsx", async () => {
  const React = await import("react");
  return {
    Link: ({ to, children }: { to: string; children: unknown }) =>
      React.createElement("a", { href: to }, children as never),
  };
});

import { ledgerlineExample } from "../../server/src/examples.ts";
import { RecordedProof } from "../src/pages/RecordedProof.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("recorded testnet proof", () => {
  it("leads with 80 → 79 from testnet final reads and links every transaction", () => {
    const e = ledgerlineExample();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(createElement(RecordedProof, { e: e as never })));
    const units = host.querySelector(".proof-units")?.textContent ?? "";
    expect(units).toContain("80");
    expect(units).toContain("79");
    const text = host.textContent ?? "";
    expect(text).toContain("Testnet final read");
    expect(text).toContain("Testnet receipt");
    expect(text).toContain("ledgerline-v3-3b.everstreet.testnet");
    expect(text).toContain("Refused (404)");
    // The close, proved with NEAR's light-client proof against a stated header.
    expect(text).toContain("⬡ Light-client proof");
    expect(text).toMatch(/Proved against block header .+ · height 276584431/);
    expect(text).toContain("verify-light-client.ts");
    const links = [...host.querySelectorAll("a[href^='https://testnet.nearblocks.io/txns/']")];
    expect(links.length).toBeGreaterThanOrEqual(8);
  });
});
