// Job 002e: `web_app_bundle/1` validation. Every refusal here is something a generated bundle
// could plausibly contain and that must never reach a worker or a preview: paths that leave the
// bundle or collide, ambiguous text, external references, sizes, malformed checks. Nothing in a
// bundle is executed by these tests or by the validator.

import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, resolveRef, validateBundle } from "../src/appBundle.ts";
import { QUOTE_BUNDLE } from "./app-fixtures.ts";

const withFiles = (files: { path: string; text: string }[]) => ({ ...QUOTE_BUNDLE, files });
const replace = (path: string, text: string) =>
  withFiles(QUOTE_BUNDLE.files.map((f) => (f.path === path ? { ...f, text } : f)));
const add = (path: string, text: string) => withFiles([...QUOTE_BUNDLE.files, { path, text }]);
const refused = (raw: unknown) => {
  const r = validateBundle(raw);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.reason;
};

describe("002e web_app_bundle/1", () => {
  it("accepts the fictional quote calculator; the digest doesn't depend on file order", () => {
    const a = validateBundle(QUOTE_BUNDLE);
    const b = validateBundle(withFiles([...QUOTE_BUNDLE.files].reverse()));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(b.digest).toBe(a.digest);
    expect(a.bundle.files.map((f) => f.path)).toEqual([
      "app.js",
      "index.html",
      "quote.js",
      "style.css",
    ]);
    // As a JSON string too (how a provider returns it).
    const c = validateBundle(JSON.stringify(QUOTE_BUNDLE));
    expect(c.ok && c.digest).toBe(a.digest);
  });

  it("refuses paths that leave the bundle, collide or aren't plain", () => {
    for (const path of [
      "../secret.js",
      "/etc/passwd.js",
      "C:/x.js",
      "a\\b.js",
      "App.js",
      ".hidden.js",
      "a/b/c/d.js",
      "x.sh",
      "x.js/",
      "con.js\u0000",
    ])
      expect(refused(add(path, "export const x = 1;\n")), path).toMatch(/path/);
    expect(refused(add("app.js", "// again\n"))).toMatch(/share the path "app.js"/);
  });

  it("refuses ambiguous text: lone surrogates, non-NFC, a BOM, control characters", () => {
    expect(refused(replace("quote.js", "const a = '\uD800';\n"))).toMatch(/lone surrogate/);
    expect(refused(replace("quote.js", "const café = 1;\n".normalize("NFD")))).toMatch(/NFC/);
    expect(refused(replace("quote.js", "\uFEFFexport const a = 1;\n"))).toMatch(/byte-order mark/);
    expect(refused(replace("quote.js", "const a = 1;\u0007\n"))).toMatch(/control characters/);
  });

  it("refuses external or out-of-bundle references, inline code and embedding", () => {
    expect(
      refused(replace("index.html", '<script src="https://cdn.example/x.js"></script>')),
    ).toMatch(/leaves the bundle/);
    expect(
      refused(replace("index.html", '<link rel="stylesheet" href="//cdn.example/x.css">')),
    ).toMatch(/leaves the bundle/);
    expect(refused(replace("index.html", '<script src="missing.js"></script>'))).toMatch(
      /isn't in the bundle/,
    );
    expect(refused(replace("index.html", '<button onclick="alert(1)">x</button>'))).toMatch(
      /inline event handlers/,
    );
    expect(refused(replace("index.html", "<script>alert(1)</script>"))).toMatch(/inline scripts/);
    expect(refused(replace("index.html", '<p style="color:red">x</p>'))).toMatch(/inline styles/);
    expect(refused(replace("index.html", '<iframe src="index.html"></iframe>'))).toMatch(/iframe/);
    expect(refused(replace("index.html", '<a href="javascript:alert(1)">x</a>'))).toMatch(
      /javascript:/,
    );
    expect(refused(replace("app.js", 'import x from "https://cdn.example/x.js";\n'))).toMatch(
      /leaves the bundle/,
    );
    expect(refused(replace("app.js", 'import "../../etc/x.js";\n'))).toMatch(/leaves the bundle/);
    expect(refused(replace("app.js", 'const m = await import("./quote.js");\n'))).toMatch(
      /dynamic import/,
    );
    expect(
      refused(replace("style.css", "body { background: url(https://x.example/a.png); }")),
    ).toMatch(/leaves the bundle/);
    expect(refused(withFiles(QUOTE_BUNDLE.files.filter((f) => f.path !== "index.html")))).toMatch(
      /index.html is missing/,
    );
  });

  it("bounds sizes, counts and checks", () => {
    expect(refused(replace("quote.js", "x".repeat(MAX_FILE_BYTES + 1)))).toMatch(
      /larger than 64 KB/,
    );
    const many = Array.from({ length: 25 }, (_, i) => ({ path: `f${i}.css`, text: "a{}" }));
    expect(refused(withFiles(many))).toMatch(/1 to 24 files/);
    const big = Array.from({ length: 5 }, (_, i) => ({
      path: `big${i}.css`,
      text: "a".repeat(60_000),
    }));
    expect(refused(withFiles([...QUOTE_BUNDLE.files, ...big]))).toMatch(/256 KB together/);
    expect(refused({ ...QUOTE_BUNDLE, checks: [] })).toMatch(/1 to 20 cases/);
    expect(
      refused({ ...QUOTE_BUNDLE, checks: [{ ...QUOTE_BUNDLE.checks[0], module: "nope.js" }] }),
    ).toMatch(/module must be a .js file/);
    expect(
      refused({ ...QUOTE_BUNDLE, checks: [{ ...QUOTE_BUNDLE.checks[0], export: "a b" }] }),
    ).toMatch(/export/);
    expect(
      refused({
        ...QUOTE_BUNDLE,
        checks: [{ ...QUOTE_BUNDLE.checks[0], input: "x".repeat(5000) }],
      }),
    ).toMatch(/4 KB/);
    expect(refused({ ...QUOTE_BUNDLE, kind: "extraction_spec" })).toMatch(/only web_app_bundle\/1/);
    expect(refused("Here is your app!")).toMatch(/model text is not a build/);
  });

  it("resolves references only inside the bundle", () => {
    expect(resolveRef("index.html", "./app.js")).toBe("app.js");
    expect(resolveRef("lib/a.js", "../quote.js")).toBe("quote.js");
    expect(resolveRef("index.html", "../x.js")).toBeNull();
    expect(resolveRef("index.html", "data:text/javascript,1")).toBeNull();
    expect(resolveRef("index.html", "app.js?v=1")).toBeNull();
  });
});
