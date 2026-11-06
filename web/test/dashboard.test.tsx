// @vitest-environment jsdom
//
// Plan step 7: the owner's portfolio (design/dashboard/DECISION.md, Tony's owner pass) on the real
// sample answer of GET /api/me/dashboard for Delphine Marsh's simulated month (fictional).
// Acquisitions in process, each selectable; one chart switching portfolio and business, token
// revenue and USD compute never mixed; costs in USD; short cards opening a breakdown in a new tab.
// No narration: labels and values. Amounts exact; unknown never shown as zero.

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
  acceptance,
  nextAction,
  niceTicks,
  runwayText,
  saleSteps,
  tokenText,
  usdFromCents,
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

  it("labels the steps short, fills done ones, marks the current one, outlines the rest", () => {
    const s = saleSteps(sale);
    expect(s.map((x) => x.label)).toEqual([
      "Proposed",
      "Escrow funded",
      "Accepted",
      "Buyer accepted",
      "Ownership",
    ]);
    expect(s.map((x) => x.state)).toEqual(["done", "done", "current", "pending", "pending"]);
    // Only the current step says anything.
    expect(s.map((x) => x.detail)).toEqual(["", "", "Waiting on you", "", ""]);
  });

  it("an unfunded escrow is the current step, never shown as done", () => {
    const s = saleSteps({ ...sale, escrow: "0" });
    expect(s[1]).toMatchObject({ state: "current", detail: "Waiting on the buyer" });
  });

  it("ownership never shows as moved from here (the contract closes it)", () => {
    const s = saleSteps({ ...sale, state: "closing", seller_accepted: true, buyer_accepted: true });
    expect(s[4]).toMatchObject({ state: "current", detail: "Closing" });
  });

  it("acceptance reads 'In process' with the reason kept for its info tip", () => {
    expect(acceptance(sale)).toEqual({
      value: "In process",
      why: "Neither side has accepted yet. Nothing moves until both do.",
    });
    expect(acceptance({ ...sale, seller_accepted: true, buyer_accepted: true }).value).toBe("Both");
  });

  it("USD cents are exact", () => {
    expect(usdFromCents(6000)).toBe("$60.00");
    expect(usdFromCents(123456)).toBe("$1,234.56");
    expect(usdFromCents(null)).toBeNull();
  });
});

describe("the portfolio page", () => {
  it("says no more than it needs to", () => {
    const el = render(sample(), "Demo: simulated history (fictional)");
    expect(el.querySelector("h1")?.textContent).toBe("Portfolio");
    expect(el.textContent).toContain("Demo: simulated history (fictional)");
    // No narration lines or reassurance paragraphs.
    expect(el.textContent).not.toMatch(
      /from launch to handover|Customers keep what they paid for|Funded by the buyer|held by the contract|both sides must accept/i,
    );
  });

  it("lists acquisitions in process; each opens its steps", () => {
    const d = sample();
    const el = render(d);
    const acq = el.querySelector(".db-acq") as HTMLElement;
    expect(acq.querySelector("h2")?.textContent).toBe("Acquisitions in process");
    const row = acq.querySelector("tbody tr") as HTMLElement;
    expect(row.textContent).toContain("Signalwatch");
    expect(row.textContent).toContain("buyer.near");
    expect(row.textContent).toContain("180.00 TUSD");
    expect(row.textContent).toContain("Awaiting you");
    const toggle = acq.querySelector(".db-acq-toggle") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const detail = acq.querySelector(".db-acq-detail") as HTMLElement;
    // Escrow is the amount only; acceptance is "In process" with an info tip; expiry once.
    expect(detail.textContent).toContain("In process");
    expect(detail.querySelector(".db-info [role='tooltip']")?.textContent).toContain(
      "Nothing moves until both do",
    );
    expect(acq.textContent?.match(/Nov 21/g)?.length).toBe(1);
    expect(detail.textContent).not.toContain("180.00 TUSD");
    const steps = [...detail.querySelectorAll(".db-step")].map((s) => s.className);
    expect(steps).toEqual([
      "db-step done",
      "db-step done",
      "db-step current",
      "db-step pending",
      "db-step pending",
    ]);
    const sw = (d.businesses as Json[]).find((b) => b.name === "Signalwatch") as Json;
    expect(detail.querySelector("a.btn-primary")?.getAttribute("href")).toBe(`/sales/${sw.id}`);
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(acq.querySelector(".db-acq-detail")).toBeNull();
  });

  it("has no acquisitions section when nothing is being sold", () => {
    const d = sample();
    for (const b of d.businesses as Json[]) b.sale = null;
    expect(render(d).querySelector(".db-acq")).toBeNull();
  });

  it("summarises exactly, with source tags", () => {
    const s = render(sample()).querySelector(".db-summary")?.textContent ?? "";
    expect(s).toContain("137.00 TUSD");
    expect(s).toContain("15.12¢");
    expect(s).toContain("1,087");
    expect(s).toContain("contract");
    expect(s).toContain("runtime");
    expect(s).not.toMatch(/profit|\bnet\b/i);
  });

  it("switches the one chart between the portfolio and a single business", () => {
    const el = render(sample());
    const perf = () => el.querySelector(".db-perf") as HTMLElement;
    expect(perf().querySelector(".db-total")?.textContent).toContain("137.00 TUSD");
    press(perf(), "Ledgerline");
    expect(perf().querySelector(".db-total")?.textContent).toContain("22.00 TUSD");
    expect(perf().querySelector("svg")?.textContent).toContain("Release 2");
  });

  it("draws compute in USD on its own axis; no model means no chart", () => {
    const el = render(sample());
    const perf = () => el.querySelector(".db-perf") as HTMLElement;
    press(perf(), "Compute");
    expect(perf().querySelector(".db-total")?.textContent).toContain("15.12¢ USD");
    expect(perf().querySelector("svg")?.textContent).toContain("US cents");
    expect(perf().querySelector("svg")?.textContent).not.toContain("TUSD");
    press(perf(), "Relaydesk");
    expect(perf().textContent).toContain("No model cost");
    expect(perf().querySelector("svg")).toBeNull();
  });

  it("keeps the daily figures one click away", () => {
    const table = render(sample()).querySelector(".db-table table") as HTMLElement;
    expect(table.querySelectorAll("tbody tr").length).toBe(30);
  });

  it("breaks costs down in USD: use, testing, unbilled, tokens, operating; fees unknown", () => {
    const d = sample();
    const costs = render(d).querySelector(".db-costs") as HTMLElement;
    const t = costs.textContent ?? "";
    expect(t).toContain("Customer use");
    expect(t).toContain("Testing");
    expect(t).toContain("Unbilled");
    expect(t).toContain("Operating");
    expect(t).toContain("Not recorded");
    expect(t).not.toContain("TUSD");
    // Unbilled = Ledgerline's refused and incomplete customer use.
    const ll = (d.businesses as Json[]).find((b) => b.name === "Ledgerline") as Json;
    expect(t).toContain(usdFromMicrocents(ll.compute.unbilled_microcents) as string);
    const rows = [...costs.querySelectorAll(".db-cost-table tbody tr")].map((r) => r.textContent);
    expect(rows.find((r) => r?.startsWith("Relaydesk"))).toContain("None");
    expect(costs.querySelectorAll("meter").length).toBeGreaterThan(0);
  });

  it("cards are short and open a breakdown in a new tab", () => {
    const d = sample();
    const cards = [...render(d).querySelectorAll(".db-card")] as HTMLElement[];
    expect(cards.length).toBe(3);
    for (const [i, c] of cards.entries()) {
      const b = (d.businesses as Json[])[i] as Json;
      const a = c.querySelector("h3 a") as HTMLAnchorElement;
      expect(a.getAttribute("href")).toBe(`/portfolio/${b.id}`);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(c.querySelectorAll("svg").length).toBe(1);
      expect(c.querySelector("footer a")?.getAttribute("href")).toBe(nextAction(b).link);
      expect(c.textContent).not.toMatch(/microcents|returning|Successor rehearsal/);
    }
  });

  it("says so plainly when there is nothing yet", () => {
    const d = sample();
    d.businesses = [];
    const el = render(d);
    expect(el.textContent).toContain("No businesses yet.");
    expect(el.querySelector(".db-perf")).toBeNull();
  });
});

describe("averages", () => {
  it("rounds per-call and per-delivered averages to two places of a cent", async () => {
    const { usdAverage } = await import("../src/dashboardView.ts");
    expect(usdAverage("218181")).toBe("0.22¢");
    expect(usdAverage(150000)).toBe("0.15¢");
    expect(usdAverage(0)).toBe("0¢");
    expect(usdAverage(1_000_000)).toBe("1¢");
    expect(usdAverage(250_000_000)).toBe("$2.50");
    expect(usdAverage(null)).toBeNull();
  });
});
