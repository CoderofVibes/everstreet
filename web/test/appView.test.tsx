// Job 002e: the Studio web app view's rules and rendered boundaries. What this proves: a test
// double's pass or an absent engine is never worded as an isolation result; the preview accepts
// only its one message from its own frame with the opaque origin; the frame is rendered with
// exactly `allow-scripts` (no same-origin, popups, forms or top navigation) and no referrer; the
// diff compares versions without inventing changes.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppVersion } from "../src/appApi.ts";
import { changedFiles, checkWords, lineDiff, previewMessage } from "../src/appView.ts";
import { AppStage, AppVersionRow, PreviewFrame } from "../src/pages/AppView.tsx";

const version = (latest: AppVersion["latest_check"]): AppVersion => ({
  job_id: "j1",
  number: 2,
  name: "Lumen Parse plan estimator",
  description: "",
  digest: "a".repeat(64),
  bytes: 1000,
  base_job: null,
  instructions: null,
  files: [{ path: "index.html", bytes: 100 }],
  checks: [],
  latest_check: latest,
  current: true,
  created_at: "",
});
const row = (v: AppVersion) =>
  renderToStaticMarkup(
    <AppVersionRow
      v={v}
      roles={{ selected: true, current: true, previewing: false }}
      onSelect={() => {}}
    />,
  );

describe("002e web app view: words", () => {
  it("a test double's pass is not isolation; an absent engine ran nothing; a real pass checks logic only", () => {
    expect(checkWords("passed", true)).toMatchObject({
      label: "Passed in a test double",
      tone: "caution",
    });
    expect(checkWords("passed", true).detail).toMatch(/not an isolation check/);
    expect(checkWords("unavailable", false).detail).toMatch(/Nothing ran/);
    expect(checkWords("passed", false).detail).toMatch(/not its screens/);
    expect(checkWords("unknown", false).detail).toMatch(/never re-run automatically/);
    expect(checkWords(null, false).label).toBe("Not checked");
    const html = row(version({ id: "c", state: "passed", test_double: true, finished_at: null }));
    expect(html).toContain("Passed in a test double");
    expect(html).not.toContain("Logic checks passed");
  });
});

describe("002e web app view: preview boundary", () => {
  it("accepts only ready from its own frame with the opaque origin", () => {
    const frame = {};
    const ok = { source: frame, origin: "null", data: { everstreet_preview: 1, type: "ready" } };
    expect(previewMessage(ok, frame)).toBe("ready");
    expect(previewMessage({ ...ok, source: {} }, frame)).toBeNull();
    expect(previewMessage({ ...ok, origin: "http://localhost:4999" }, frame)).toBeNull();
    expect(
      previewMessage({ ...ok, data: { everstreet_preview: 1, type: "navigate", url: "x" } }, frame),
    ).toBeNull();
    expect(previewMessage({ ...ok, data: "ready" }, frame)).toBeNull();
    expect(previewMessage(ok, null)).toBeNull();
  });

  it("renders the frame sandboxed to scripts only, with no referrer, labelled checked or not", () => {
    const html = renderToStaticMarkup(
      <PreviewFrame
        url="http://localhost:4999/preview/app/t/index.html"
        checked={false}
        onStop={() => {}}
      />,
    );
    expect(html).toMatch(/sandbox="allow-scripts"/);
    expect(html).not.toMatch(/allow-same-origin|allow-popups|allow-top-navigation|allow-forms/);
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
    expect(html).toContain("Unchecked");
    expect(html).toMatch(/doesn&#x27;t limit its CPU or memory/);
    expect(renderToStaticMarkup(<PreviewFrame url="x" checked onStop={() => {}} />)).toContain(
      "Logic checks passed",
    );
  });
});

describe("002e web app view: compare", () => {
  it("lists only changed, added and removed files, and diffs lines", () => {
    const from = [
      { path: "estimate.js", text: "const per = support ? 45 : 12;\nreturn x;" },
      { path: "index.html", text: "<p>a</p>" },
      { path: "old.css", text: "a{}" },
    ];
    const to = [
      { path: "estimate.js", text: "const per = support ? 40 : 12;\nreturn x;" },
      { path: "index.html", text: "<p>a</p>" },
      { path: "new.css", text: "b{}" },
    ];
    expect(changedFiles(from, to).map((f) => [f.path, f.status])).toEqual([
      ["estimate.js", "changed"],
      ["new.css", "added"],
      ["old.css", "removed"],
    ]);
    expect(lineDiff(from[0]?.text ?? "", to[0]?.text ?? "")).toEqual([
      { kind: "del", text: "const per = support ? 45 : 12;" },
      { kind: "add", text: "const per = support ? 40 : 12;" },
      { kind: "same", text: "return x;" },
    ]);
    expect(lineDiff("a\n".repeat(3000), "b\n".repeat(3000), 1000)).toBeNull();
  });
});

describe("001k web app canvas: the stage and history rows", () => {
  const ver = { ...version(null), current: false, number: 3 };
  const stage = (s: Parameters<typeof AppStage>[0]["stage"], extra = {}) =>
    renderToStaticMarkup(
      <AppStage
        stage={s}
        busy={false}
        preview={null}
        hasDraft={false}
        onPreview={() => {}}
        onOpenUnchecked={() => {}}
        onDecline={() => {}}
        onStop={() => {}}
        {...extra}
      />,
    );

  it("an unstarted version gets a purposeful placeholder with the real action, never a frame", () => {
    const html = stage({ kind: "ready", version: ver });
    expect(html).toContain("Preview version 3");
    expect(html).toContain("It isn&#x27;t running. Not checked");
    expect(html).not.toContain("<iframe");
  });

  it("the unchecked choice is explicit: warned text, an open button and Not now, still no frame", () => {
    const html = stage({ kind: "unchecked_choice", version: ver });
    expect(html).toContain('role="alert"');
    expect(html).toContain("haven&#x27;t passed in the isolated worker");
    expect(html).toContain("Open unchecked preview");
    expect(html).toContain("Not now");
    expect(html).not.toContain("<iframe");
  });

  it("no version, or no preview configured, says so and offers no preview", () => {
    expect(stage({ kind: "empty" })).toContain("No web app yet");
    expect(stage({ kind: "empty" }, { hasDraft: true })).toContain("ready in the composer");
    const off = stage({ kind: "unconfigured", version: ver });
    expect(off).toContain("Preview isn&#x27;t configured");
    expect(off).not.toContain("Preview version 3");
  });

  it("a running preview is that version's sandboxed frame", () => {
    const html = stage(
      { kind: "preview", version: ver },
      { preview: { url: "http://localhost:4999/preview/app/t/index.html", checked: false } },
    );
    expect(html).toContain('title="Web app preview, version 3"');
    expect(html).toMatch(/sandbox="allow-scripts"/);
    expect(html).toContain("Preview of version 3");
    expect(html).toContain("Unchecked");
  });

  it("a history row names its roles and selects by a pressed button", () => {
    const html = renderToStaticMarkup(
      <AppVersionRow
        v={ver}
        roles={{ selected: false, current: false, previewing: true }}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("In preview");
    expect(html).not.toContain(">Current<");
    expect(html).not.toContain(">Shown<");
  });
});
