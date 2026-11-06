// @vitest-environment jsdom
//
// Plan step 7: the founder's dashboard (design/dashboard/DECISION.md) on the real sample answer of
// GET /api/me/dashboard for Delphine Marsh's simulated month (fictional). The handover leads while
// a sale needs a decision, its pending steps outlined; one chart switches between the portfolio
// and a single business, and between token revenue and USD compute without ever mixing them;
// cards stay short. Amounts are exact; unknown is never shown as zero.

import { readFileSync } from "node:fs";
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

import {
  nextAction,
  niceTicks,
  runwayText,
  saleSteps,
  tokenText,
  usdFromMicrocents,
} from "../src/dashboardView.ts";
import { Dashboard } from "../src/pages/Dashboard.tsx";

// biome-ignore lint/suspicious/noExplicitAny: the sample answer, read field by field
type Json = Record<string, any>;
const sample = (): Json =>
  JSON.parse(readFileSync("design/dashboard/sample-dashboard.json", "utf8")) as Json;
const TUSD = { symbol: "TUSD", decimals: 6 };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
const render = (d: Json, environment?: string) => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(Dashboard, { d, environment })));
  return host;
};
const press = (el: HTMLElement, name: string) => {
  const b = [...el.querySelectorAll("button")].find((x) => x.textContent?.startsWith(name));
  if (!b) throw new Error(`no button ${name}`);
  act(() => b.click());
};

describe("dashboard amounts", () => {
  it("shows USD exactly from microcents: cents under a dollar, dollars above", () => {
    expect(usdFromMicrocents("15120000")).toBe("15.12¢");
    expect(usdFromMicrocents("240000")).toBe("0.24¢");
    expect(usdFromMicrocents("0")).toBe("0¢");
    expect(usdFromMicrocents("123456789012")).toBe("$1,234.56789012");
    expect(usdFromMicrocents("100000000")).toBe("$1.00");
    expect(usdFromMicrocents(null)).toBeNull();
    expect(usdFromMicrocents("-5")).toBeNull();
  });

  it("shows token amounts readable when the token is known, base units when not", () => {
    expect(tokenText("137000000", "tusd.near", TUSD)).toBe("137.00 TUSD");
    expect(tokenText("400000", "tusd.near", TUSD)).toBe("0.40 TUSD");
    expect(tokenText("1234567", "tusd.near", TUSD)).toBe("1.234567 TUSD");
    expect(tokenText("5", "x.near", null)).toBe("5 base units of x.near");
    expect(tokenText(null, "tusd.near", TUSD)).toBe("unknown");
  });

  it("reads runway in words; no recent use is not a number", () => {
    expect(runwayText(2702)).toBe("over a year");
    expect(runwayText(141)).toBe("about 5 months");
    expect(runwayText(12)).toBe("12 days");
    expect(runwayText(null)).toBe("no recent use to measure");
  });

  it("rounds axis ticks up to readable steps", () => {
    expect(niceTicks(9.3)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("the sale's steps", () => {
  const sale = {
    state: "proposed",
    price: "180",
    escrow: "180",
    seller_accepted: false,
    buyer_accepted: false,
  };

  it("fills done steps, marks the first open one current and outlines the rest", () => {
    const s = saleSteps(sale, "180 TUSD");
    expect(s.map((x) => x.state)).toEqual(["done", "done", "current", "pending", "pending"]);
    expect(s[2]?.detail).toBe("Waiting on you");
  });

  it("an unfunded escrow is the current step, never shown as done", () => {
    const s = saleSteps({ ...sale, escrow: "0" }, "180 TUSD");
    expect(s[1]?.state).toBe("current");
    expect(s[1]?.detail).toBe("Waiting on the buyer");
  });

  it("ownership never shows as moved from the dashboard (the contract closes it)", () => {
    const s = saleSteps(
      { ...sale, state: "closing", seller_accepted: true, buyer_accepted: true },
      "180 TUSD",
    );
    expect(s[4]).toMatchObject({ state: "current", detail: "Closing on NEAR" });
  });
});

describe("the dashboard page", () => {
  it("leads with the handover while a sale needs a decision", () => {
    const d = sample();
    const el = render(d, "Demo: simulated history (fictional)");
    expect(el.textContent).toContain("Demo: simulated history (fictional)");
    const hero = el.querySelector(".db-hero") as HTMLElement;
    expect(hero).not.toBeNull();
    // The hero comes before the performance chart in reading order.
    const perf = el.querySelector(".db-perf") as HTMLElement;
    expect(hero.compareDocumentPosition(perf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hero.textContent).toContain("Signalwatch");
    expect(hero.textContent).toContain("buyer.near");
    expect(hero.textContent).toContain("180.00 TUSD");
    expect(hero.textContent).toContain("Neither yet");
    expect(hero.textContent).toContain("386 prepaid uses");
    const sw = (d.businesses as Json[]).find((b) => b.name === "Signalwatch") as Json;
    expect(hero.querySelector("a.btn-primary")?.getAttribute("href")).toBe(`/sales/${sw.id}`);
    const steps = [...hero.querySelectorAll(".db-step")].map((s) => s.className);
    expect(steps).toEqual([
      "db-step done",
      "db-step done",
      "db-step current",
      "db-step pending",
      "db-step pending",
    ]);
  });

  it("gives the hero's room to the chart when no sale needs a decision", () => {
    const d = sample();
    for (const b of d.businesses as Json[]) b.sale = null;
    const el = render(d);
    expect(el.querySelector(".db-hero")).toBeNull();
    expect(el.querySelector(".db-main .db-perf")).not.toBeNull();
  });

  it("summarises the month exactly, with sources, and never invents network fees", () => {
    const el = render(sample());
    const s = el.querySelector(".db-summary")?.textContent ?? "";
    expect(s).toContain("137.00 TUSD");
    expect(s).toContain("15.12¢");
    expect(s).toContain("network fees not recorded");
    expect(s).toContain("Source: business contracts");
    expect(s).toContain("Source: runtime records");
    expect(s).toContain("1,087 uses");
    // Token revenue and USD are never added into one figure.
    expect(s).not.toMatch(/profit|\bnet\b/i);
  });

  it("switches the one chart between the portfolio and a single business", () => {
    const el = render(sample());
    const perf = () => el.querySelector(".db-perf") as HTMLElement;
    expect(perf().querySelector(".db-total")?.textContent).toContain("All businesses");
    expect(perf().querySelector(".db-total")?.textContent).toContain("137.00 TUSD");
    expect(perf().querySelectorAll(".db-legend li").length).toBe(4); // three + release marker
    press(perf(), "Ledgerline");
    expect(perf().querySelector(".db-total")?.textContent).toContain("22.00 TUSD");
    expect(perf().querySelector("svg")?.textContent).toContain("Release 2");
    expect(perf().textContent).toContain("Ledgerline's workspace");
    const pressed = [...perf().querySelectorAll("button[aria-pressed='true']")].map(
      (b) => b.textContent,
    );
    expect(pressed[0]).toBe("Ledgerline");
  });

  it("draws compute in USD on its own axis, and says when there is no model", () => {
    const el = render(sample());
    const perf = () => el.querySelector(".db-perf") as HTMLElement;
    press(perf(), "Compute cost");
    expect(perf().querySelector(".db-total")?.textContent).toContain("15.12¢ USD");
    expect(perf().querySelector("svg")?.textContent).toContain("US cents");
    expect(perf().querySelector("svg")?.textContent).not.toContain("TUSD");
    expect(perf().textContent).toContain("never added to token revenue");
    press(perf(), "Relaydesk");
    expect(perf().textContent).toContain("No model cost.");
    expect(perf().querySelector("svg")).toBeNull();
  });

  it("keeps the daily figures one click away, exact", () => {
    const el = render(sample());
    const table = el.querySelector(".db-table table") as HTMLElement;
    expect(table.querySelectorAll("tbody tr").length).toBe(30);
    expect(table.textContent).toContain("TUSD");
    expect(table.textContent).toContain("(so far)");
  });

  it("keeps cards short: what it does, one trend and its next action", () => {
    const d = sample();
    const el = render(d);
    const cards = [...el.querySelectorAll(".db-card")] as HTMLElement[];
    expect(cards.length).toBe(3);
    for (const [i, c] of cards.entries()) {
      const b = (d.businesses as Json[])[i] as Json;
      expect(c.querySelector("h3")?.textContent).toBe(b.name);
      expect(c.querySelectorAll("svg").length).toBe(1);
      const next = nextAction(b);
      expect(c.querySelector("footer a")?.getAttribute("href")).toBe(next.link);
      // Detail stays in the workspace, not on the card.
      expect(c.textContent).not.toMatch(/microcents|returning|Successor rehearsal/);
    }
    expect(cards[0]?.textContent).toContain("Rehearse the handover");
    expect(cards[1]?.textContent).toContain("Rehearsal passed");
    expect(cards[2]?.textContent).toContain("Handover in progress");
  });

  it("says plainly when there is nothing to show yet", () => {
    const d = sample();
    d.businesses = [];
    const el = render(d);
    expect(el.textContent).toContain("You don't control a business yet.");
    expect(el.querySelector(".db-perf")).toBeNull();
  });
});
