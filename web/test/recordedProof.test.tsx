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
    expect(text).toContain("Refused (HTTP 404)");
    // The close, proved with NEAR's light-client proof against a stated header.
    expect(text).toContain("⬡ Light-client proof");
    expect(text).toMatch(/proved against the later\s+header at height 276584431/);
    expect(text).toContain("verify-light-client.ts");
    const links = [...host.querySelectorAll("a[href^='https://testnet.nearblocks.io/txns/']")];
    expect(links.length).toBeGreaterThanOrEqual(8);
  });

  it("shows each sale at the moment control changed, then the customer after the last one", () => {
    const e = ledgerlineExample();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(createElement(RecordedProof, { e: e as never })));
    const strip = host.querySelector(".handover-strip");
    expect(strip).not.toBeNull();
    const rows = strip?.querySelectorAll(".hand-list .hand-row") ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[2]?.textContent).toContain("noor-v3s3");
    expect(rows[2]?.textContent).toContain("ines-v3s4");
    expect(rows[2]?.textContent).toContain("E_NOT_OWNER");
    // Each close and each refusal links to the explorer.
    const links = [...(strip?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    // Three closes, three first refusals, and the business contract's own refusal of the third
    // sale's seller (in its row, and again with the answers at the top).
    expect(links.filter((l) => l?.startsWith("https://testnet.nearblocks.io/txns/"))).toHaveLength(
      8,
    );
    // The answers come first (Nov 8): generation 4, the business refusing the former owner, and
    // the customer's 78 · 22 · 100, before the sale rows.
    const first = strip?.querySelector(".hand-after");
    expect(first?.compareDocumentPosition(rows[0] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(first?.textContent).toContain("generation 4");
    expect(first?.textContent).toContain("refused by this business");
    expect(first?.querySelector("a")?.getAttribute("href")).toContain(
      "ZWJP4nst8L6Syx52WkyZ7fmCuHZJSoER6j5oD7f8zyb",
    );
    expect(rows[2]?.textContent).toContain("appoint_operator_guarded to this business");
    expect(rows[0]?.textContent).not.toContain("to this business");
    expect(rows[0]?.textContent).toContain("80");
    expect(rows[1]?.textContent).toContain("Not recorded in this run");
    // The card below shows the whole progression after the first sale (Nov 9): 80, 79, 78.
    const steps = [...host.querySelectorAll(".proof-steps .proof-n")].map((n) => n.textContent);
    expect(steps).toEqual(["80", "79", "78"]);
    expect(strip?.querySelector(".hand-after")?.textContent).toMatch(
      /78 unused · 22 used · 100 bought/,
    );
  });
});
