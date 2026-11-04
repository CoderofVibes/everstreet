// Job 001h: the operating workspace's rules and its chart series.
// - Views: ?view= names one of four, anything else is the overview; links into views and sections.
// - The one next action is the first thing that needs the founder, never a system item.
// - A released product keeps its released name; a divergent draft is labelled as a draft.
// - Astra's regression: charged/returned (and customer/founder cost, earned/costs) drew in the same
//   cobalt. Every chart's series now differ in colour AND pattern, read from the actual stylesheet
//   and from the rendered SVG; each colour has at least 3:1 contrast against the surfaces.
// Static renders and pure rules; finite.

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeskProduct, DeskWorkItem, OpsMonth } from "../src/api4.ts";
import { CHART_SERIES, SERIES, type SeriesKey } from "../src/chartSeries.ts";
import {
  deskViewFromSearch,
  deskViewHref,
  nextAction,
  productIdentity,
} from "../src/digitalDesk.ts";
import { CostChart, UsageChart } from "../src/pages/DeskOperations.tsx";
import { DigitalWorkspace } from "../src/pages/DeskWorkspace.tsx";
import { SessionProvider } from "../src/session.tsx";

const css = readFileSync("web/src/styles.css", "utf8");

describe("001h workspace views and links", () => {
  it("?view= names a view; anything else is the overview", () => {
    expect(deskViewFromSearch("?view=performance")).toBe("performance");
    expect(deskViewFromSearch("?view=products")).toBe("products");
    expect(deskViewFromSearch("?view=growth")).toBe("growth");
    expect(deskViewFromSearch("")).toBe("overview");
    expect(deskViewFromSearch("?view=nonsense")).toBe("overview");
    expect(deskViewHref("b1", "overview")).toBe("/desk/b1");
    expect(deskViewHref("b1", "growth", "desk-inquiries")).toBe(
      "/desk/b1?view=growth#desk-inquiries",
    );
  });

  const product = (o: Partial<DeskProduct> = {}): DeskProduct => ({
    project_id: "p1",
    name: "Untitled product",
    foundation_label: "AI API",
    revision: 3,
    updated_at: "2026-11-04T10:00:00.000Z",
    release: { state: "active", activated_at: "2026-11-04T09:00:00.000Z" },
    offers: { active: 1, retired: 0 },
    offer: null,
    released: { name: "Invoice reader", revision: 1 },
    status: "offered",
    ...o,
  });
  const work = (o: Partial<DeskWorkItem>): DeskWorkItem => ({
    key: "inquiries",
    who: "you",
    count: 2,
    label: "unanswered messages",
    link: { to: "inquiries" },
    ...o,
  });

  it("the next action is the first item that needs you; a system item never is", () => {
    const products = { total: 1, shown: [product()] };
    expect(nextAction({ products, work: [work({})] }, "b1")).toEqual({
      label: "2 unanswered messages",
      to: "/desk/b1?view=growth#desk-inquiries",
    });
    const system = work({ key: "system", who: "system", link: { to: "customers", project: "p1" } });
    expect(nextAction({ products, work: [system] }, "b1")).toEqual({
      label: "Open product studio",
      to: "/build/p1",
    });
    expect(nextAction({ products: { total: 0, shown: [] }, work: [] }, "b1").to).toBe(
      "/build?business=b1",
    );
  });

  it("released identity first; a divergent or newer draft is labelled, never the title", () => {
    expect(productIdentity(product())).toEqual({
      title: "Invoice reader",
      released: true,
      draft: "Draft brief (revision 3): Untitled product",
    });
    // Same name, newer brief: said plainly, still the release's name.
    expect(productIdentity(product({ name: "Invoice reader" })).draft).toBe(
      "Draft brief (revision 3) changed since this release (revision 1)",
    );
    expect(productIdentity(product({ name: "Invoice reader", revision: 1 })).draft).toBeNull();
    // No release: the brief is the name, and nothing claims a release.
    expect(
      productIdentity(
        product({ released: null, release: { state: "none" }, status: "brief_only" }),
      ),
    ).toEqual({ title: "Untitled product", released: false, draft: null });
  });
});

describe("001h the workspace keeps every view mounted, one shown", () => {
  it("overview shown by default; performance, products and growth rendered but hidden; nav marks where you are", () => {
    const desk = {
      business: {
        id: "b1",
        name: "Ledgerline Invoice Reader",
        slug: "ledgerline",
        family: "software",
        stage: "launch",
        // Unpublished: the share panel reads window.location, which a static render lacks.
        published_at: null,
      },
      offer: { title: "", price_cents: null, price_unit: "", first_free: false },
      idea: null,
      project_id: null,
      missing: [],
      action: { kind: "interest", label: "Tell me when it opens" },
      tasks: [{ id: "t1", title: "Reply to your first customer", detail: "", done_at: null }],
      inquiries: [],
    } as never;
    const digital = {
      as_of: "2026-11-04T10:00:00.000Z",
      kind: "digital",
      page: { published: true },
      products: {
        total: 1,
        shown: [
          {
            project_id: "p1",
            name: "Untitled product",
            foundation_label: "AI API",
            revision: 2,
            updated_at: "2026-11-04T10:00:00.000Z",
            release: { state: "active", activated_at: "2026-11-04T09:00:00.000Z" },
            offers: { active: 1, retired: 0 },
            offer: null,
            released: { name: "Invoice reader", revision: 1 },
            status: "offered",
          },
        ],
      },
      imports: { total: 0 },
      legacy_offering: { configured: false, title: null },
      work: [
        {
          key: "checklist",
          who: "you",
          count: 1,
          label: "open checklist items",
          link: { to: "checklist" },
        },
      ],
      current: {},
      settlement: { worker: "running", heartbeat_at: null, paused_by_authority: 0 },
    } as never;
    const html = renderToStaticMarkup(
      <SessionProvider>
        <DigitalWorkspace
          desk={desk}
          digital={digital}
          load={() => {}}
          replies={{}}
          setReplies={() => {}}
        />
      </SessionProvider>,
    );
    const panel = (v: string) =>
      new RegExp(`<section[^>]*id="desk-view-${v}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(panel("overview")).not.toMatch(/hidden/);
    for (const v of ["performance", "products", "growth"]) expect(panel(v)).toMatch(/hidden/);
    // The growth view's checklist is in the page (mounted), so its state survives switching.
    expect(html).toContain('id="desk-checklist"');
    // One primary next action: the first thing that needs you.
    expect(html).toMatch(/class="btn btn-primary ws-next"[^>]*>1 open checklist items</);
    expect(html).toMatch(/aria-current="page"[^>]*><span id="desk-nav-overview">Overview/);
    // The released name, not the draft's, names the product on the overview.
    expect(html).toContain(">Invoice reader</a>");
    // Every business link is still here.
    for (const to of [
      "/desk/b1/value",
      "/desk/b1/continuity",
      "/desk/b1/handover",
      "/desk/b1/public",
    ])
      expect(html).toContain(`href="${to}"`);
  });
});

// ---------- chart series ----------

const hex = (token: string) => {
  const m = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`${token} not defined in styles.css`);
  return m[1].toLowerCase();
};
const luminance = (h: string) => {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe("001h chart series are distinct in colour and pattern", () => {
  it("every chart's series differ in colour and in pattern", () => {
    for (const [chart, keys] of Object.entries(CHART_SERIES)) {
      const colours = keys.map((k) => hex(SERIES[k].token));
      const patterns = keys.map((k) => SERIES[k].pattern);
      expect(new Set(colours).size, chart).toBe(keys.length);
      expect(new Set(patterns).size, chart).toBe(keys.length);
    }
  });

  it("each series colour has at least 3:1 contrast against the canvas and paper, and isn't the brand alias pair", () => {
    for (const k of Object.keys(SERIES) as SeriesKey[]) {
      const c = hex(SERIES[k].token);
      expect(contrast(c, "#ffffff"), k).toBeGreaterThanOrEqual(3);
      expect(contrast(c, hex("--canvas")), k).toBeGreaterThanOrEqual(3);
      // Every legend swatch class exists and draws this series.
      expect(css).toMatch(new RegExp(`\\.sw-data-${k}\\s*\\{[^}]*${SERIES[k].token}`));
    }
  });

  const month = (o: Partial<OpsMonth> = {}): OpsMonth => ({
    yyyymm: 202611,
    label: "Nov 2026",
    so_far: false,
    usage: {
      requested: 9,
      charged: 4,
      returned: 3,
      settling: 1,
      needs_attention: 0,
      reserved_unsettled: 1,
      awaiting_reservation: 0,
      never_reserved: 0,
    },
    execution: { ran: 7, usable_result: 4, not_usable: 3, undecided: 0, unknown: 0 },
    cost: {
      customers: { microcents: "750000", calls: 5, unknown_cost_calls: 0, unknown_held_cents: 0 },
      founder: { microcents: "1200000", calls: 8, unknown_cost_calls: 0, unknown_held_cents: 0 },
    },
    ...o,
  });
  /** The fill of the rect drawn for a series in rendered SVG. */
  const fillOf = (html: string, series: string) => {
    const m = new RegExp(`<rect[^>]*data-series="${series}"[^>]*>`).exec(html);
    if (!m) throw new Error(`no ${series} rect`);
    return /fill="([^"]+)"/.exec(m[0])?.[1];
  };

  it("rendered: charged and returned are drawn differently (solid colour vs stripes)", () => {
    const html = renderToStaticMarkup(<UsageChart months={[month()]} />);
    const charged = fillOf(html, "charged");
    const returned = fillOf(html, "returned");
    expect(charged).toBe("var(--data-primary)");
    expect(returned).toMatch(/^url\(#.+-returned\)$/);
    expect(charged).not.toBe(returned);
    // The pattern it points at is defined in the same chart.
    const id = /url\(#(.+)\)/.exec(returned ?? "")?.[1];
    expect(html).toContain(`<pattern id="${id}"`);
    expect(html).not.toMatch(/fill="var\(--(mint|blue)\)"/);
  });

  it("rendered: serving customers and founder trials are drawn differently", () => {
    const html = renderToStaticMarkup(<CostChart months={[month()]} />);
    const customers = fillOf(html, "customers");
    const founder = fillOf(html, "founder");
    expect(customers).toBe("var(--data-primary)");
    expect(founder).toMatch(/^url\(#.+-founder\)$/);
    expect(html).toContain("Founder trials and release checks (dotted, right)");
  });
});
