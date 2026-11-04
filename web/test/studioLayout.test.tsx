// Job 001b: state continuity across the studio's task-aware layout. Operating views (builds,
// service, continuity) take the canvas, but the editor (conversation outbox, unsaved brief, save
// bar) is still rendered, only hidden, so nothing typed or pending is lost. Service tasks and the
// offer setup report what needs attention, so changing task never hides it. Static render, no
// effects, no network.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { offerNeedsAttention } from "../src/pages/CustomerOffers.tsx";
import {
  OPERATE_TABS,
  StudioBody,
  studioLayout,
  viewFromSearch,
} from "../src/pages/ProductStudio.tsx";
import { serviceAttention } from "../src/pages/Service.tsx";
import { splitLocation } from "../src/router.tsx";

const body = (editorShown: boolean) =>
  renderToStaticMarkup(
    <StudioBody
      editorShown={editorShown}
      editor={<textarea defaultValue="an unsent thought" data-testid="outbox" />}
      canvas={<section>canvas</section>}
    />,
  );

describe("001b the studio layout keeps the editor mounted", () => {
  it("shaping tabs show the editor; operating tabs hide it unless asked", () => {
    for (const t of ["preview", "proposal", "brief", "checks", "versions"] as const)
      expect(studioLayout(t, false)).toEqual({ operate: false, editorShown: true });
    for (const t of OPERATE_TABS) {
      expect(studioLayout(t, false)).toEqual({ operate: true, editorShown: false });
      expect(studioLayout(t, true)).toEqual({ operate: true, editorShown: true });
    }
  });

  it("on an operating view the editor is still rendered (hidden), with its content", () => {
    const shaping = body(true);
    const operating = body(false);
    for (const html of [shaping, operating]) {
      expect(html).toContain("an unsent thought");
      expect(html).toContain('id="ps-side"');
      expect(html).toContain("canvas");
    }
    expect(shaping).not.toMatch(/<aside[^>]*hidden/);
    expect(operating).toMatch(/<aside[^>]*hidden/);
    expect(operating).toContain('class="ps-body operate"');
  });
});

describe("001b1 query-only navigation and the narrow-screen editor", () => {
  it("a link's path is what routes match; its query selects the view and task", () => {
    expect(splitLocation("/build/p1?view=service&task=customers")).toEqual({
      path: "/build/p1",
      search: "?view=service&task=customers",
    });
    expect(splitLocation("/build/p1")).toEqual({ path: "/build/p1", search: "" });
    expect(splitLocation("/build/p1?view=builds#top")).toEqual({
      path: "/build/p1",
      search: "?view=builds",
    });
    expect(splitLocation("?view=service")).toEqual({ path: "/", search: "?view=service" });
    expect(viewFromSearch("?view=service&task=customers")).toEqual({
      tab: "service",
      task: "customers",
    });
    expect(viewFromSearch("?view=service&task=evaluate")).toEqual({
      tab: "service",
      task: "evaluate",
    });
    // Back to the plain URL: the default view; the Service task is left as it was.
    expect(viewFromSearch("")).toEqual({ tab: "preview", task: null });
    expect(viewFromSearch("?view=nonsense&task=nope")).toEqual({ tab: "preview", task: null });
  });

  it("asking for the editor marks the body so narrow screens show it; it stays rendered either way", () => {
    const closed = renderToStaticMarkup(
      <StudioBody editorShown editor={<i>draft</i>} canvas={<b>canvas</b>} />,
    );
    const open = renderToStaticMarkup(
      <StudioBody editorShown editorOpen editor={<i>draft</i>} canvas={<b>canvas</b>} />,
    );
    expect(closed).toContain('class="ps-body"');
    expect(open).toContain('class="ps-body editor-open"');
    for (const html of [closed, open]) expect(html).toContain("draft");
  });
});

describe("001b nothing pending hides behind a task switch", () => {
  it("each task reports its own unresolved work", () => {
    expect(
      serviceAttention({ lost: 0, running: false, checkRunning: false, offers: false }),
    ).toEqual({ try: null, evaluate: null, customers: null });
    expect(
      serviceAttention({ lost: 1, running: true, checkRunning: false, offers: false }).try,
    ).toBe("needs a check");
    expect(
      serviceAttention({ lost: 0, running: true, checkRunning: false, offers: false }).try,
    ).toBe("running");
    expect(
      serviceAttention({ lost: 0, running: false, checkRunning: true, offers: false }).evaluate,
    ).toBe("check running");
    expect(
      serviceAttention({ lost: 0, running: false, checkRunning: false, offers: true }).customers,
    ).toBe("needs attention");
  });

  it("an unanswered offer create, unconfirmed access or a pending retire needs attention", () => {
    const quiet = { unanswered: null, access: "confirmed", confirmRetire: null };
    expect(offerNeedsAttention(quiet)).toBe(false);
    expect(offerNeedsAttention({ ...quiet, unanswered: { plan_id: 1, retention_days: 30 } })).toBe(
      true,
    );
    expect(offerNeedsAttention({ ...quiet, access: "unconfirmed" })).toBe(true);
    expect(offerNeedsAttention({ ...quiet, confirmRetire: "o1" })).toBe(true);
  });
});
