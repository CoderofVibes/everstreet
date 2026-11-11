// @vitest-environment jsdom
//
// The static site (web/src/proofSite.tsx): the app's own pages, answering from files. The proof
// pages read the committed testnet evidence (STATIC_READS); every other read is answered from the
// committed recording of the demo (data/tour/recording.json), as whoever walked that route, and
// from nothing else: an unrecorded read is "not in this tour" and nothing can be written. The
// guide's stops must all be routes the recording holds, or a visitor would be led to an empty page.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tourData } from "../../scripts/lib/tourData.ts";
import { STATIC_READS } from "../src/proofSite.tsx";
import { Router } from "../src/router.tsx";
import { Guide } from "../src/tour/Guide.tsx";
import { answer, type TourData, viewerFor } from "../src/tour/replay.ts";
import { STEPS, STOPS_USED, stepAt, stepRoute, tourProblems } from "../src/tour/steps.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const data: TourData = {
  recorded_at: "2026-11-11T00:00:00.000Z",
  commit: "test",
  viewers: {
    delphine: {
      routes: ["/", "/portfolio", "/build/p1"],
      reads: { "/api/me": { person: { display_name: "Delphine Marsh" } }, "/api/x?days=30": [1] },
    },
    cara: { routes: ["/", "/use/o1"], reads: { "/api/me": { person: { display_name: "Cara" } } } },
  },
  stops: { studio: "/build/p1", portfolio: "/portfolio", customer: "/use/o1" },
};

describe("the replay", () => {
  it("answers a recorded read with its recorded body, as the viewer who made it", () => {
    expect(answer(data, "delphine", "GET", "/api/x?days=30")).toEqual({ status: 200, body: [1] });
    expect(answer(data, "cara", "GET", "/api/me").body).toEqual({
      person: { display_name: "Cara" },
    });
  });

  it("answers nothing it did not record: another query, another viewer's read, no viewer", () => {
    for (const [who, target] of [
      ["delphine", "/api/x?days=7"],
      ["delphine", "/api/x"],
      ["cara", "/api/x?days=30"],
      [null, "/api/me"],
      ["delphine", "constructor"],
    ] as const) {
      const a = answer(data, who, "GET", target);
      expect(a.status, target).toBe(404);
      expect((a.body as { code: string }).code).toBe("static");
    }
  });

  it("refuses every write", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const a = answer(data, "delphine", m, "/api/me");
      expect(a.status, m).toBe(403);
      expect((a.body as { code: string }).code).toBe("recording");
    }
  });

  it("picks who views a route: the one asked for, else whoever is viewing, else who walked it", () => {
    expect(viewerFor(data, "/", "cara")).toBe("cara");
    expect(viewerFor(data, "/", "cara", "delphine")).toBe("delphine");
    expect(viewerFor(data, "/portfolio", "cara")).toBe("delphine");
    expect(viewerFor(data, "/use/o1", "delphine")).toBe("cara");
    expect(viewerFor(data, "/use/o1", null, "delphine")).toBe("cara");
    expect(viewerFor(data, "/", null)).toBe("delphine");
    expect(viewerFor(data, "/nowhere", "delphine")).toBeNull();
  });
});

describe("the static site's reads", () => {
  it("keeps the proof pages on the committed evidence files", () => {
    expect(STATIC_READS).toEqual({
      "/api/examples/ledgerline": "/data/ledgerline.json",
      "/api/public/attacks": "/data/attacks.json",
    });
  });

  it("answers an unrecorded read with 404 and a write with 403, never a call to a server", async () => {
    const r = await fetch("/api/me/dashboard");
    expect(r.status).toBe(404);
    expect(((await r.json()) as { code: string }).code).toBe("static");
    const w = await fetch("/api/projects", { method: "POST", body: "{}" });
    expect(w.status).toBe(403);
    expect(((await w.json()) as { code: string }).code).toBe("recording");
  });
});

// Nov 11 (Anthony): a guide that walks a judge through what Everstreet is, then the proof.
describe("the guided tour", () => {
  it("goes Everstreet, build, run, then handoff proof, recorded sale, attacks, agents", () => {
    expect(STEPS.map((s) => s.label)).toEqual([
      "Everstreet",
      "Build",
      "Run",
      "Handoff proof",
      "Recorded sale",
      "Attacks",
      "Agents",
    ]);
    expect(STEPS.map((s) => s.to ?? `stop:${s.stop}`)).toEqual([
      "/",
      "stop:studio",
      "stop:portfolio",
      "/proof/ledgerline",
      "/example/ledgerline?tab=acquire",
      "/attacks",
      "stop:agents",
    ]);
  });

  it("says where each stop's data comes from, and keeps each step to a few lines", () => {
    expect(STEPS.filter((s) => s.source === "testnet").map((s) => s.id)).toEqual([
      "handoff",
      "sale",
    ]);
    expect(STEPS.find((s) => s.id === "attacks")?.source).toBe("tests");
    for (const s of STEPS) {
      expect(s.body.length, s.id).toBe(1);
      expect((s.body[0] as string).length, s.id).toBeLessThan(320);
      for (const l of s.links ?? [])
        expect(l.href, l.label).toMatch(
          /^https:\/\/testnet\.nearblocks\.io\/txns\/[1-9A-HJ-NP-Za-km-z]{43,44}$/,
        );
    }
  });

  it("finds every stop and side door in the committed recording, walked by its viewer", () => {
    const committed = tourData();
    expect(tourProblems(committed)).toEqual([]);
    for (const stop of STOPS_USED) expect(committed.stops[stop], stop).toMatch(/^\//);
    const routes = STEPS.map((s) => stepRoute(s, committed.stops));
    expect(new Set(routes).size).toBe(STEPS.length);
    routes.forEach((r, i) => {
      expect(stepAt(r.split("?")[0] as string, committed.stops)).toBe(i);
    });
    expect(stepAt("/somewhere-else", committed.stops)).toBe(-1);
  });

  it("reports a stop the recording does not hold", () => {
    expect(tourProblems({ ...data, stops: { ...data.stops, studio: "/build/gone" } })).toContain(
      "step build: /build/gone was not walked by delphine",
    );
    expect(tourProblems({ ...data, stops: {} }).length).toBeGreaterThan(0);
  });

  it("shows the first stop, and Next opens the next stop's page as its viewer", () => {
    const visit = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() =>
      root?.render(
        createElement(Router, null, createElement(Guide, { data, viewer: "delphine", visit })),
      ),
    );
    const button = (name: RegExp) =>
      [...host.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
    expect(host.textContent).toContain("Step 1 of 7");
    expect(host.textContent).toContain("Viewing as Delphine Marsh");
    expect(host.querySelectorAll(".tour-rail button").length).toBe(7);
    expect(button(/^Back$/)?.disabled).toBe(true);
    act(() => button(/A customer's side/)?.click());
    expect(visit).toHaveBeenLastCalledWith("/use/o1", "cara");
    act(() => button(/Next: Build/)?.click());
    expect(visit).toHaveBeenLastCalledWith("/build/p1", "delphine");
  });
});
