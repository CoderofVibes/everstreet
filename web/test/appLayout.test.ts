// Job 002e1: the Web app view's width containment (Astra's 390 px browser pass on c0a3c00: Compare
// made the document 477 px; closing it restored 375). Cause: `.app-view` and `.app-versions` were
// grids with an implicit `auto` column, which grows to a <pre>'s longest line. This pins the CSS
// contract that keeps code scrolling inside its own region. It can't measure pixels; Astra's
// browser repeat at 390/1280/1440 is the visual proof.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("web/src/styles.css", "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return "";
  return css.slice(at, css.indexOf("}", at));
};

describe("002e1 Web app view width containment", () => {
  it("its grids have a shrinkable column and children that may shrink", () => {
    expect(rule(".app-view")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule(".app-view")).toMatch(/min-width:\s*0/);
    expect(rule(".app-view > *")).toMatch(/min-width:\s*0/);
    expect(rule(".app-versions")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule(".app-version, .app-diff, .app-check")).toMatch(/min-width:\s*0/);
  });

  it("long code scrolls inside the comparison, bounded to its region", () => {
    const pre = rule(".app-diff pre");
    expect(pre).toMatch(/max-width:\s*100%/);
    expect(pre).toMatch(/overflow-x:\s*auto/);
  });

  it("the Studio canvas that hosts it already lets content shrink", () => {
    expect(rule(".ps-canvas")).toMatch(/min-width:\s*0/);
    expect(rule(".ps-view")).toMatch(/min-width:\s*0/);
  });
});
