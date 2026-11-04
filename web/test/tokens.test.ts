// Job 001f: the approved luminous palette, measured. Reads the actual :root tokens from
// web/src/styles.css and checks WCAG 2 contrast for every text/background pairing the system
// uses: 4.5:1 for text, 3:1 for large text and UI edges. Changing a token so a pairing fails
// fails this test.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("web/src/styles.css", "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const tokens = new Map<string, string>();
for (const m of root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
  tokens.set(m[1] as string, (m[2] as string).toUpperCase());

const hex = (name: string) => {
  const v = tokens.get(name);
  if (!v) throw new Error(`token --${name} is not a hex value in :root`);
  return v;
};
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("001f approved palette", () => {
  it("uses the approved candidates", () => {
    expect(hex("canvas")).toBe("#F4F6FB");
    expect(hex("surface")).toBe("#FFFFFF");
    expect(hex("ink")).toBe("#17243C");
    expect(hex("cobalt")).toBe("#3155D9");
    expect(hex("warm")).toBe("#F3C49D");
  });

  const text: [string, string][] = [
    ["text", "surface"],
    ["text", "canvas"],
    ["text-2", "surface"],
    ["text-2", "canvas"],
    ["text-3", "surface"],
    ["text-3", "canvas"],
    ["cobalt-ink", "surface"],
    ["cobalt-ink", "canvas"],
    ["cobalt-ink", "cobalt-soft"],
    ["on-cobalt", "cobalt"],
    ["on-cobalt", "cobalt-hover"],
    ["on-ink", "ink"],
    ["on-ink-2", "ink"],
    ["accent-on-ink", "ink"],
    ["success", "success-soft"],
    ["success", "surface"],
    ["warm-ink", "warm-soft"],
    ["ink", "warm"],
    ["amber", "amber-soft"],
    ["error", "error-soft"],
  ];
  for (const [fg, bg] of text)
    it(`text --${fg} on --${bg} meets 4.5:1`, () => {
      expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
    });

  it("the action colour and focus ring are distinguishable from the canvas (3:1)", () => {
    expect(contrast(hex("cobalt"), hex("canvas"))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex("focus"), hex("surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(hex("line-strong"), hex("surface"))).toBeGreaterThanOrEqual(1.5);
  });
});
