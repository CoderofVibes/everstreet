// Job 001f1: Explore's read path. A failed feed settles into a retry (never an endless Loading);
// the Following feed belongs to the account that loaded it; the tabs move with the keyboard; a
// mixed business's list label agrees with the tab it is in. Pure rules; finite.

import { describe, expect, it } from "vitest";
import type { DigitalPublic, PublicBusiness } from "../src/api.ts";
import { marketLine } from "../src/discover.ts";
import { exploreTabKey, feedView, followingFor } from "../src/exploreView.ts";
import { initialLoad, type LoadState, latestLoader } from "../src/latestLoad.ts";

describe("001f1 the feed settles", () => {
  it("a failure with nothing loaded is a retry, not Loading; a retry that succeeds is ready", async () => {
    let s: LoadState<number> = initialLoad();
    let fail = true;
    const l = latestLoader(
      () => (fail ? Promise.reject(new Error("Network down")) : Promise.resolve(7)),
      (p) => {
        s = { ...s, ...p };
      },
    );
    expect(feedView(s)).toBe("loading");
    await l.load();
    expect(feedView(s)).toBe("failed");
    expect(s.error).toBe("Network down");
    fail = false;
    await l.load();
    expect(feedView(s)).toBe("ready");
    expect(s).toMatchObject({ data: 7, error: null });
  });

  it("an answer arriving after the page closed changes nothing", async () => {
    let s: LoadState<number> = initialLoad();
    let release: (n: number) => void = () => {};
    const l = latestLoader(
      () =>
        new Promise<number>((r) => {
          release = r;
        }),
      (p) => {
        s = { ...s, ...p };
      },
    );
    const pending = l.load();
    l.close();
    release(1);
    await pending;
    expect(feedView(s)).toBe("loading");
  });
});

describe("001f1 the Following feed belongs to one account", () => {
  const ready = { data: { feed: ["Ava's update"] }, error: null, status: "ready" as const };
  it("shown to the account that loaded it; another account, or signed out, starts from nothing", () => {
    const slot = { who: "ava", state: ready };
    expect(followingFor(slot, "ava").data).toEqual({ feed: ["Ava's update"] });
    expect(followingFor(slot, "bea")).toEqual({ data: null, error: null, status: "loading" });
    expect(followingFor(slot, null).data).toBeNull();
    expect(followingFor({ who: null, state: ready }, null).data).toBeNull();
  });
});

describe("001f1 Explore's tabs move with the keyboard", () => {
  it("arrows wrap, Home and End jump, other keys do nothing", () => {
    expect(exploreTabKey("starting", "ArrowRight")).toBe("open");
    expect(exploreTabKey("following", "ArrowRight")).toBe("starting");
    expect(exploreTabKey("starting", "ArrowLeft")).toBe("following");
    expect(exploreTabKey("needs", "Home")).toBe("starting");
    expect(exploreTabKey("open", "End")).toBe("following");
    expect(exploreTabKey("open", "Enter")).toBeNull();
  });
});

describe("001f1 a listing's label agrees with its tab", () => {
  const digital = (availability: DigitalPublic["availability"]): DigitalPublic => ({
    headline: "Clean rows from supplier invoices",
    summary: "",
    audience: "",
    capabilities: ["Reads invoice numbers"],
    products: [],
    example: null,
    availability,
    published_at: null,
  });
  const biz = (o: Partial<PublicBusiness>): PublicBusiness =>
    ({
      slug: "x",
      name: "x",
      family: "class",
      stage: "shape",
      founder: { display_name: "Ava Chen" },
      offer: { title: "Invoice clean-up session", first_free: false, price_cents: null },
      action: { kind: "interest", label: "Tell me when it opens" },
      digital: null,
      ...o,
    }) as PublicBusiness;
  const ask = { kind: "question", label: "Ask about a session" } as PublicBusiness["action"];

  it("mixed: digital not open but the offering takes requests reads open, naming which part", () => {
    const m = marketLine(biz({ digital: digital("coming_soon"), action: ask }));
    expect(m).toMatchObject({ status: "Open for customers", tone: "success" });
    expect(m.detail).toBe(
      "Invoice clean-up session takes requests now; the digital product is not open for use yet.",
    );
    // Both not open: coming soon, as in Starting now.
    expect(marketLine(biz({ digital: digital("coming_soon") })).status).toBe(
      "Not open for use yet",
    );
    // Digital open: available, whatever the offering.
    expect(marketLine(biz({ digital: digital("available") })).status).toBe("Available to use");
  });

  it("legacy taking requests at an early stage reads open, not Shaping", () => {
    expect(marketLine(biz({ action: ask })).status).toBe("Open for customers");
    expect(marketLine(biz({ action: ask, stage: "grow" })).status).toBe("Growing");
    expect(marketLine(biz({})).status).toBe("Testing interest");
  });
});
