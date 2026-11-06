// Job 006a: the customer's side of a released web app. The strict parsers accept a pass offer and
// a granted pass (the shapes the server's own test produces in web-app-release.test.ts) and refuse
// a pass address that isn't a /p/<token>/ page; the answer links to the app while the pass lasts
// and says when it ended; the steps say the pass started. Fictional data.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MalformedAnswer, parseOffer, parseResult } from "../src/customerApi.ts";
import { completeResult, customerSteps } from "../src/customerView.ts";
import { CustomerResult } from "../src/pages/CustomerProduct.tsx";
import { FreeApps } from "../src/pages/PublicPage.tsx";

const TOKEN = "Q".repeat(43);
const offer = {
  offer_id: "o1",
  offer_state: "active",
  business: { name: "Lumen Parse", slug: "lumen-parse" },
  product: {
    kind: "web_app",
    name: "Lumen Parse plan estimator",
    description: "A fictional plan estimate page.",
    max_chars: 200,
    fields: [],
    stages: [],
    pass_days: 7,
    platform_limitations: "Runs only in your browser.",
    limitations: "Estimates only.",
    stand_in: true,
  },
  terms: {
    units_per_use: 1,
    unit_price: "150000",
    asset: "usdc.fakes.testnet",
    retention_days: 30,
    network: "testnet",
    contract: "biz.testnet",
    token: null,
  },
};
const grant = (over: Record<string, unknown> = {}, ends = Date.now() + 7 * 86_400_000) => ({
  outcome: "granted",
  retention_until_ms: String(Date.now() + 30 * 86_400_000),
  result: {
    outcome: "granted",
    release_id: "r1",
    digest: "a".repeat(64),
    pass_days: 7,
    starts_at: new Date(ends - 7 * 86_400_000).toISOString(),
    expires_at: new Date(ends).toISOString(),
    url: `http://localhost:4999/p/${TOKEN}/index.html`,
    ...over,
  },
});

describe("006a access passes in the browser", () => {
  it("parses a pass offer with its terms and stand-in label", () => {
    const o = parseOffer(offer);
    expect(o.product.kind).toBe("web_app");
    expect(o.product.app).toEqual({
      description: "A fictional plan estimate page.",
      pass_days: 7,
      platform_limitations: "Runs only in your browser.",
      limitations: "Estimates only.",
      stand_in: true,
    });
  });

  it("parses a granted pass, and refuses an address that isn't a pass page", () => {
    const r = parseResult(grant());
    expect(r.result.pass?.url).toBe(`http://localhost:4999/p/${TOKEN}/index.html`);
    for (const url of [
      "javascript:alert(1)",
      `http://localhost:4999/a/${TOKEN}/index.html`,
      `http://localhost:4999/p/${TOKEN}/../x.html`,
      "not a url",
    ])
      expect(() => parseResult(grant({ url }))).toThrow(MalformedAnswer);
    // A refused pass has only its reason.
    const no = parseResult({
      outcome: "refused",
      retention_until_ms: "0",
      result: { outcome: "refused", reason: "This release is free to open" },
    });
    expect(no.result.pass).toBeNull();
  });

  it("links to the app while the pass lasts; an ended pass has no link", () => {
    const live = renderToStaticMarkup(
      createElement(CustomerResult, { r: parseResult(grant()), pass: true }),
    );
    expect(live).toContain("Open the app");
    expect(live).toContain(`href="http://localhost:4999/p/${TOKEN}/index.html"`);
    expect(live).toContain('rel="noopener noreferrer"');
    const ended = renderToStaticMarkup(
      createElement(CustomerResult, {
        r: parseResult(grant({}, Date.now() - 1000)),
        pass: true,
      }),
    );
    expect(ended).toContain("Pass ended");
    expect(ended).not.toContain("Open the app");
  });

  it("a granted pass is a complete result, and the step says the pass started", () => {
    const result = parseResult(grant());
    expect(completeResult({ result })).toBe(true);
    const steps = customerSteps({
      use: null,
      result,
      check: null,
      unanswered: null,
      draft: "",
      inDoubt: null,
      offer: parseOffer(offer),
    } as never);
    expect(steps.at(-1)?.detail).toBe("Your pass has started. Open the app below.");
  });

  it("the public page opens a free app at its own site, saying what it is", () => {
    const html = renderToStaticMarkup(
      createElement(FreeApps, {
        apps: [
          {
            name: "Lumen Parse plan estimator",
            description: "A fictional plan estimate page.",
            url: "http://localhost:4999/a/AAAAAAAAAAAAAAAA/index.html",
            platform_limitations: "Runs only in your browser.",
            limitations: "Estimates only.",
            stand_in: true,
          },
        ],
      }),
    );
    expect(html).toContain("Open the app");
    expect(html).toContain("http://localhost:4999/a/AAAAAAAAAAAAAAAA/index.html");
    expect(html).toContain("Runs only in your browser. Estimates only.");
    expect(html).toContain("Stand-in release");
    expect(renderToStaticMarkup(createElement(FreeApps, { apps: [] }))).toBe("");
  });
});
