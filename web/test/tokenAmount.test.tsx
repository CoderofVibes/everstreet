// Review evidence and presentation (Astra, Nov 5): one honest way to show a token amount.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseToken, readable, TokenAmount } from "../src/TokenAmount.tsx";

const text = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'");

describe("TokenAmount", () => {
  it("leads with the readable amount and keeps the exact base units beside it", () => {
    expect(
      text(
        createElement(TokenAmount, {
          base: "150000",
          asset: "tusd.near",
          token: { symbol: "TUSD", decimals: 6 },
        }),
      ),
    ).toBe("0.15 TUSD (exact: 150,000 base units of tusd.near)");
  });
  it("without the token's details: exact base units and a plain statement, never a guess", () => {
    expect(
      text(createElement(TokenAmount, { base: "150000", asset: "tusd.near", token: null })),
    ).toBe("150,000 base units of tusd.near (this token's details haven't been read yet)");
  });
  it("zero, large values, unknown and long token ids", () => {
    const t = { symbol: "TUSD", decimals: 6 };
    expect(readable("0", 6)).toBe("0");
    expect(readable("340282366920938463463374607431768211455", 6)).toBe(
      "340,282,366,920,938,463,463,374,607,431,768.211455",
    );
    expect(text(createElement(TokenAmount, { base: null, asset: "x", token: t }))).toBe("unknown");
    const long = `${"a".repeat(60)}.factory.bridge.near`;
    expect(text(createElement(TokenAmount, { base: "1", asset: long, token: t }))).toContain(long);
  });
  it("parses only well-formed metadata", () => {
    expect(parseToken({ symbol: "TUSD", decimals: 6, name: "x" })).toEqual({
      symbol: "TUSD",
      decimals: 6,
    });
    expect(parseToken({ symbol: "<b>", decimals: 6 })).toBeNull();
    expect(parseToken({ symbol: "TUSD", decimals: 39 })).toBeNull();
    expect(parseToken(null)).toBeNull();
  });
});
