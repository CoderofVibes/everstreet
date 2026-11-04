// Job 001g1: the context tools on phones. Astra's browser finding at 390 px: the focused editor
// (#ctx-first) sat under the save bar, because `.ps-savebar` stayed `position: sticky; bottom: 0`
// after `.ctx-tools` became static below the stage. These read the actual stylesheet's rules (no
// browser here; Astra's repeat is the visual gate) and the focus helper. Finite.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reveal } from "../src/pages/CanvasTools.tsx";

const css = readFileSync("web/src/styles.css", "utf8");

/** Every rule body whose selector list mentions `selector` (comments removed). */
function rulesFor(selector: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const sel = m[1] ?? "";
    if (sel.split(",").some((s) => s.includes(selector))) out.push(m[2] ?? "");
  }
  return out;
}

/** The body of the `@container canvas (max-width: 880px)` block. */
function narrowBlock(): string {
  const at = css.indexOf("@container canvas (max-width: 880px)");
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", at) + 1, i);
  }
  throw new Error("unclosed block");
}

describe("001g1 the save bar never covers the editor", () => {
  it("no rule makes the save bar sticky or fixed, at any width", () => {
    const bodies = rulesFor(".ps-savebar");
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(/position\s*:\s*(sticky|fixed)/);
  });

  it("below the stage the tools are in flow and don't scroll inside themselves", () => {
    const narrow = narrowBlock();
    expect(narrow).toMatch(/\.ctx-tools\s*\{[^}]*position\s*:\s*static/);
    expect(narrow).toMatch(/\.ctx-tools\s*\{[^}]*max-height\s*:\s*none/);
    expect(narrow).toMatch(/\.ctx-body\s*\{[^}]*overflow\s*:\s*visible/);
  });

  it("on wide screens the sticky tools card sits below the sticky site header", () => {
    const tools = rulesFor(".ctx-tools").find((b) => /position\s*:\s*sticky/.test(b));
    expect(tools).toMatch(/top\s*:\s*var\(--studio-clear-top\)/);
    const clear = [...css.matchAll(/--studio-clear-top\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
    // Desktop header ≈104 px, the compact two-row header ≈125 px.
    expect(clear.length).toBe(2);
    expect(Math.min(...clear)).toBeGreaterThanOrEqual(104);
    expect(Math.max(...clear)).toBeGreaterThanOrEqual(125);
  });

  it("focus targets in the tools and the stage keep clear of the sticky header when scrolled to", () => {
    const margins = rulesFor(".pick").find((b) => /scroll-margin-top/.test(b));
    expect(margins).toMatch(/scroll-margin-top\s*:\s*var\(--studio-clear-top\)/);
    expect(rulesFor(".ctx-tools :is(input")[0]).toMatch(/scroll-margin-top/);
  });
});

describe("001g1 moving focus also brings the element into view", () => {
  it("focuses without the browser's own jump, then scrolls only as far as needed", () => {
    const calls: string[] = [];
    const el = {
      focus: (o: { preventScroll?: boolean }) => calls.push(`focus:${o.preventScroll}`),
      scrollIntoView: (o: { block?: string }) => calls.push(`scroll:${o.block}`),
    } as unknown as HTMLElement;
    reveal(el);
    expect(calls).toEqual(["focus:true", "scroll:nearest"]);
    expect(() => reveal(null)).not.toThrow();
  });
});
