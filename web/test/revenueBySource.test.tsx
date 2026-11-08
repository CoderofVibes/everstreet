// @vitest-environment jsdom
//
// The sale economics' "Earned revenue by source" card: independent customers, customers linked to
// the seller with their reasons, an unread registration counted apart, and what isn't checked.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RevenueBySource, type RevenueSources } from "../src/pages/UseEconomicsPage.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const render = (r: RevenueSources) => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      createElement(RevenueBySource, {
        r,
        amt: (b: string | null) => (b === null ? "unknown" : `${Number(b) / 1e6} TUSD`),
      }),
    ),
  );
  return host.textContent ?? "";
};

const base: RevenueSources = {
  independent: { customers: 2, uses: 9, revenue: "36000000" },
  linked: {
    customers: 1,
    uses: 3,
    revenue: "12000000",
    accounts: [{ account: "theo.near", uses: 3, reasons: ["registration_paid_by_seller"] }],
  },
  unchecked: { customers: 0, uses: 0, revenue: "0" },
  checked: ["owner_account", "operator", "owner_here", "team_here", "registration_paid_by_seller"],
  not_checked: ["funding_through_other_accounts", "recruited_third_parties"],
};

describe("earned revenue by source", () => {
  it("shows independent and linked revenue, each linked account with its reason", () => {
    const text = render(base);
    expect(text).toContain("36 TUSD · 2 customers · 9 uses");
    expect(text).toContain("12 TUSD · 1 customer · 3 uses");
    expect(text).toContain("theo.near");
    expect(text).toContain("registration paid by the owner's side");
    expect(text).not.toContain("Registration not read");
    // What isn't checked is one click away, never implied away.
    expect(text).toContain("money routed through other accounts");
  });

  it("says none found when nothing links a customer, and counts unread registrations apart", () => {
    const text = render({
      ...base,
      linked: { customers: 0, uses: 0, revenue: "0", accounts: [] },
      unchecked: { customers: 1, uses: 2, revenue: "8000000" },
    });
    expect(text).toContain("None found");
    expect(text).toContain("Registration not read");
    expect(text).toContain("8 TUSD · 1 customer · 2 uses");
  });
});
