// Job 001c: the digital desk's rules. Never "all caught up" while work exists; founder work and
// system work are told apart; several products are a choice, not an arbitrary pick; a brief is
// never a release; every link targets an existing route or a desk anchor.

import { describe, expect, it } from "vitest";
import type { DeskProduct, DeskWorkItem } from "../src/api4.ts";
import {
  deskStatusLine,
  PRODUCT_STATUS_LABEL,
  productFacts,
  studioAction,
  workHref,
} from "../src/digitalDesk.ts";

const product = (o: Partial<DeskProduct> = {}): DeskProduct => ({
  project_id: "p1",
  name: "Invoice Reader",
  foundation_label: "AI API",
  revision: 3,
  updated_at: "2026-11-04T10:00:00.000Z",
  release: { state: "active", activated_at: "2026-11-03T10:00:00.000Z" },
  offers: { active: 1, retired: 0 },
  offer: { id: "o1", plan_id: 1, unit_price: "1000000", asset: "usdc.fixture.near" },
  status: "offered",
  ...o,
});
const item = (o: Partial<DeskWorkItem>): DeskWorkItem => ({
  key: "k",
  who: "you",
  count: 1,
  label: "x",
  link: { to: "inquiries" },
  ...o,
});

describe("001c status line", () => {
  it("never claims nothing is open while work exists, and separates system work", () => {
    expect(deskStatusLine({ work: [] })).toBe("Nothing is waiting right now.");
    expect(deskStatusLine({ work: [item({ who: "system", count: 2 })] })).toBe(
      "Nothing needs you right now · 2 waiting on the system.",
    );
    expect(
      deskStatusLine({
        work: [item({ count: 1 }), item({ count: 2 }), item({ who: "system", count: 3 })],
      }),
    ).toBe("3 things need you · 3 waiting on the system.");
    expect(deskStatusLine({ work: [item({ count: 1 })] })).toBe("1 thing needs you.");
    for (const w of [[item({})], [item({ who: "system" })]])
      expect(deskStatusLine({ work: w })).not.toMatch(/caught up/i);
  });
});

describe("001c links and choices", () => {
  it("each work item leads to an existing route or an anchor on the desk", () => {
    expect(workHref(item({ link: { to: "customers", project: "p1" } }), "b1")).toBe(
      "/build/p1?view=service&task=customers",
    );
    expect(workHref(item({ link: { to: "studio", project: "p2" } }), "b1")).toBe("/build/p2");
    expect(workHref(item({ link: { to: "continuity" } }), "b1")).toBe("/desk/b1/continuity");
    expect(workHref(item({ link: { to: "inquiries" } }), "b1")).toBe("#desk-inquiries");
    expect(workHref(item({ link: { to: "checklist" } }), "b1")).toBe("#desk-checklist");
  });

  it("one product opens its studio; several are a choice; none starts one", () => {
    expect(studioAction({ products: { total: 1, shown: [product()] } }, "b1")).toEqual({
      label: "Open product studio",
      to: "/build/p1",
      anchor: false,
    });
    expect(
      studioAction(
        { products: { total: 2, shown: [product(), product({ project_id: "p2" })] } },
        "b1",
      ),
    ).toEqual({ label: "Choose a product", to: "#desk-products", anchor: true });
    expect(studioAction({ products: { total: 0, shown: [] } }, "b1").to).toBe("/build?business=b1");
  });
});

describe("001c product facts", () => {
  it("counts releases and offers from the products, and says when only the newest were read", () => {
    const brief = product({
      project_id: "p2",
      release: { state: "none" },
      offers: { active: 0, retired: 0 },
      offer: null,
      status: "brief_only",
    });
    expect(productFacts({ products: { total: 2, shown: [product(), brief] } })).toBe(
      "2 products · 1 released · 1 offered to customers",
    );
    expect(productFacts({ products: { total: 14, shown: [brief] } })).toBe(
      "14 products (newest 1 read) · 0 released · 0 offered to customers",
    );
    expect(productFacts({ products: { total: 0, shown: [] } })).toBe("No product yet");
    expect(PRODUCT_STATUS_LABEL.brief_only).toBe("Saved brief, no release yet");
    expect(PRODUCT_STATUS_LABEL.released).not.toMatch(/customers can/i);
  });
});
