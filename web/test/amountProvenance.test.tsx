// @vitest-environment jsdom
//
// Amount provenance (Astra, Nov 5): a later metadata read that disagrees must never silently
// reprice what a person sees. The cached observation from the REAL server function
// (tokenMetaOf after two conflicting reads) flows through the actual consumers: TokenAmount,
// the offer parser, and the desk's economics table (which reshapes amounts itself). A disputed
// scale shows the exact base units, the asset and the reason. Fictional token; no network.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../../server/src/db.ts";
import { recordTokenMeta, tokenMetaOf } from "../../server/src/tokenMeta.ts";
import { parseOffer } from "../src/customerApi.ts";
import { DeskEconomics } from "../src/pages/DeskEconomics.tsx";
import { parseToken, TokenAmount } from "../src/TokenAmount.tsx";

const TUSD = { symbol: "TUSD", name: "Fictional test dollar", decimals: 6 };
/** The real cache after a 6-decimal read and a later 18-decimal one. */
function conflicted() {
  const db = openDb(":memory:");
  recordTokenMeta(db, "testnet", "tusd.near", TUSD, "100");
  recordTokenMeta(db, "testnet", "tusd.near", { ...TUSD, decimals: 18 }, "200");
  return tokenMetaOf(db, "testnet", "tusd.near");
}
const plain = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'");

describe("a disputed token scale", () => {
  it("TokenAmount shows the exact base units, the asset and why; never 0.00000000000015", () => {
    const t = plain(
      createElement(TokenAmount, { base: "150000", asset: "tusd.near", token: conflicted() }),
    );
    expect(t).toContain("150,000 base units of tusd.near");
    expect(t).not.toMatch(/0\.00000000000015|0\.15/);
    expect(t).toMatch(/details changed between reads/);
  });

  it("the parser keeps the dispute; consistent metadata still reads exactly (zero and large values)", () => {
    expect(parseToken(conflicted())?.disputed).toMatch(/changed between reads/);
    const ok = { symbol: "TUSD", decimals: 6 };
    expect(plain(createElement(TokenAmount, { base: "0", asset: "tusd.near", token: ok }))).toBe(
      "0 TUSD (exact: 0 base units of tusd.near)",
    );
    expect(
      plain(createElement(TokenAmount, { base: "123456789000000", asset: "tusd.near", token: ok })),
    ).toBe("123,456,789 TUSD (exact: 123,456,789,000,000 base units of tusd.near)");
  });

  it("an offer parsed from an answer with the conflicted observation renders exact units", () => {
    const offer = parseOffer({
      offer_id: "o1",
      offer_state: "active",
      business: { name: "Fictional", slug: "fictional" },
      product: { kind: "extraction", name: "Reader", max_chars: 100, fields: [] },
      terms: {
        units_per_use: 1,
        unit_price: "150000",
        asset: "tusd.near",
        retention_days: 30,
        network: "testnet",
        contract: "biz.near",
        token: conflicted(),
      },
    });
    expect(offer.terms.token?.disputed).toBeTruthy();
    const t = plain(
      createElement(TokenAmount, {
        base: offer.terms.unit_price,
        asset: offer.terms.asset,
        token: offer.terms.token,
      }),
    );
    expect(t).toContain("150,000 base units of tusd.near");
  });
});

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the desk's economics table (it reshapes amounts itself)", () => {
  it("a historical month after a later conflicting observation shows exact units, not a new scale", async () => {
    const month = (label: string, earned: string) => ({
      yyyymm: 202610,
      label,
      so_far: false,
      by_asset: {
        "tusd.near": {
          earned,
          charged_units: 1,
          pending_units: 0,
          pending_value: "0",
          prepaid_in: earned,
          prepaid_units: 1,
          returned_purchases: "0",
        },
      },
      successful_uses: 1,
      compute: { known_microcents: "0", calls: 0, unknown_cost_calls: 0 },
      cost_per_success_microcents: null,
    });
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            as_of: new Date().toISOString(),
            tokens: { "tusd.near": conflicted() },
            assets: ["tusd.near"],
            months: [month("October 2026", "150000")],
            definitions: { no_profit: "No profit is computed." },
            obligations: [
              {
                asset: "tusd.near",
                prepaid_in: "15000000",
                prepaid_units: 100,
                earned: "150000",
                earned_units: 1,
                outstanding_units: 99,
                outstanding_value: "14850000",
                note: "",
              },
            ],
            recovery: { items: [], truncated: false, note: "" },
          }),
          { status: 200 },
        ),
    );
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);
    await act(async () => root?.render(createElement(DeskEconomics, { businessId: "b1" })));
    for (let i = 0; i < 20 && !document.body.textContent?.includes("October"); i++)
      await act(async () => new Promise((r) => setTimeout(r, 5)));
    const text = document.body.textContent ?? "";
    expect(text).toContain("October 2026");
    expect(text).toContain("150,000");
    expect(text).not.toMatch(/0\.00000000000015/);
    expect(text).toMatch(/changed between reads/);
  });
});
