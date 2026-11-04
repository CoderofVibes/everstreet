// Job 001f: Discover and the storefront's rules. The stage features a real published digital
// product (an example first); each listing shows one honest line, its availability from active
// offers, never an invented number; the primary action is Use only when an offer is open; the
// example tabs move with the keyboard.

import { describe, expect, it } from "vitest";
import type { DigitalPublic, PublicBusiness } from "../src/api.ts";
import { featured, marketLine, marketOrder } from "../src/discover.ts";
import { nextTab, primaryAction } from "../src/publication.ts";

const digital = (o: Partial<DigitalPublic> = {}): DigitalPublic => ({
  headline: "Clean rows from supplier invoices",
  summary: "Upload a fictional invoice and get clean rows.",
  audience: "Bookkeepers",
  capabilities: ["Reads invoice numbers"],
  products: [
    { name: "Invoice reader", family_label: "AI API", status: "available", use_offer_id: "o1" },
  ],
  example: null,
  availability: "available",
  published_at: "2026-11-04T10:00:00.000Z",
  ...o,
});
const biz = (slug: string, o: Partial<PublicBusiness> = {}): PublicBusiness =>
  ({
    slug,
    name: slug,
    tagline: "",
    about: "",
    family: "software",
    stage: "shape",
    published_at: "2026-11-04T10:00:00.000Z",
    founder: { display_name: "Ava Chen", headline: "", bio: "" },
    idea: null,
    offer: null,
    unknown: [],
    action: { kind: "interest", label: "I'm interested" },
    interested: 0,
    digital: null,
    ...o,
  }) as PublicBusiness;

const EX = {
  product_name: "Invoice reader",
  input: "Fictional invoice NB-7",
  outputs: [{ label: "Total", value: "88.20 USD" }],
  label: "Illustrative example written by the business. Not a live run.",
};

describe("001f the stage's featured product", () => {
  it("prefers a digital profile with an example, then an open one, then any; none: null", () => {
    const legacy = biz("pottery", { family: "class", offer: { title: "Wheel" } as never });
    const soon = biz("soon", { digital: digital({ availability: "coming_soon" }) });
    const open = biz("open", { digital: digital() });
    const withExample = biz("ex", {
      digital: digital({ availability: "coming_soon", example: EX }),
    });
    expect(featured([legacy, soon, open, withExample])?.slug).toBe("ex");
    expect(featured([legacy, soon, open])?.slug).toBe("open");
    expect(featured([legacy, soon])?.slug).toBe("soon");
    expect(featured([legacy])).toBeNull();
  });
});

describe("001f each listing's honest line", () => {
  it("a digital profile: availability, headline, first capability, example marker; no numbers invented", () => {
    const m = marketLine(biz("open", { digital: digital({ example: EX }) }));
    expect(m).toMatchObject({
      status: "Available to use",
      tone: "success",
      line: "Clean rows from supplier invoices",
      detail: "Reads invoice numbers",
      example: true,
    });
    expect(m.meta).toBe("AI API · by Ava Chen");
    const soon = marketLine(biz("soon", { digital: digital({ availability: "coming_soon" }) }));
    expect(soon).toMatchObject({ status: "Not open for use yet", tone: "caution", example: false });
  });

  it("a legacy business keeps its offering, stage and price as before", () => {
    const m = marketLine(
      biz("pottery", {
        family: "class",
        stage: "launch",
        action: { kind: "book", label: "Book" } as never,
        offer: {
          title: "Wheel throwing",
          first_free: false,
          price_cents: 3500,
          price_unit: "per person",
        } as never,
      }),
    );
    expect(m.line).toBe("Wheel throwing");
    expect(m.status).toBe("Launched");
    expect(m.meta).toContain("$35");
    expect(m.example).toBe(false);
  });

  it("orders open digital products first, then coming soon, then software, then the rest", () => {
    const list = [
      biz("legacy", { family: "class" }),
      biz("soon", { digital: digital({ availability: "coming_soon" }) }),
      biz("sw"),
      biz("open", { digital: digital() }),
    ];
    expect(marketOrder(list).map((b) => b.slug)).toEqual(["open", "soon", "sw", "legacy"]);
  });
});

describe("001f storefront actions and example tabs", () => {
  it("Use only when a product has an open offer; otherwise Follow", () => {
    expect(primaryAction(digital())).toEqual({
      kind: "use",
      label: "Use Invoice reader",
      offer_id: "o1",
    });
    expect(
      primaryAction(
        digital({
          products: [
            {
              name: "Invoice reader",
              family_label: "AI API",
              status: "not_open",
              use_offer_id: null,
            },
          ],
          availability: "coming_soon",
        }),
      ),
    ).toEqual({ kind: "follow", label: "Follow for updates" });
  });

  it("arrow keys, Home and End move between the two tabs; other keys do nothing", () => {
    expect(nextTab(0, "ArrowRight", 2)).toBe(1);
    expect(nextTab(1, "ArrowRight", 2)).toBe(0);
    expect(nextTab(0, "ArrowLeft", 2)).toBe(1);
    expect(nextTab(1, "Home", 2)).toBe(0);
    expect(nextTab(0, "End", 2)).toBe(1);
    expect(nextTab(0, "Enter", 2)).toBeNull();
  });
});
