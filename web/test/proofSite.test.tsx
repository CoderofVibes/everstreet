// @vitest-environment jsdom
//
// The static proof site (web/src/proofSite.tsx) answers every public read its pages make from a
// build-time file; a page that starts reading something new must be added there, or it would show
// "not part of this copy" once hosted.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATIC_READS } from "../src/proofSite.tsx";

const PAGES = ["RecordedProof.tsx", "AttackDocket.tsx", "Showcase.tsx"];

describe("the static proof site", () => {
  it("has a data file for every read the proof pages make", () => {
    const reads = PAGES.flatMap((f) =>
      [...readFileSync(`web/src/pages/${f}`, "utf8").matchAll(/fetch\("(\/api\/[^"]+)"\)/g)].map(
        (m) => m[1] as string,
      ),
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(STATIC_READS[r], r).toMatch(/^\/data\/[a-z]+\.json$/);
  });

  it("answers any other API read with 404, never a call to a server", async () => {
    const r = await fetch("/api/me/dashboard");
    expect(r.status).toBe(404);
    expect(((await r.json()) as { code: string }).code).toBe("static");
  });
});
