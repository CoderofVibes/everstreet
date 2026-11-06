// Job 001b: the studio's status comes from actual records. A tested active release coexists
// truthfully with a newer editable brief; failed, unchecked and unavailable states never read as
// launched; unreadable records are "unknown", not assumed.

import { describe, expect, it } from "vitest";
import type { Candidate, Releases } from "../src/runtimeApi.ts";
import { projectStatus, type StatusInput } from "../src/studioStatus.ts";

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  artifact_job: "job-aaaaaaaaaaaa",
  artifact_digest: "d".repeat(64),
  revision: 1,
  built_at: "2026-11-04T10:00:00.000Z",
  current_owner: true,
  latest_check: null,
  status: "candidate",
  ...over,
});
const rel = (over: Partial<Releases> = {}): Releases => ({
  active: null,
  releases: [],
  candidates: [],
  note: "",
  ...over,
});
const base: StatusInput = {
  head: 1,
  dirty: false,
  build: { available: true },
  businessId: "b1",
  releases: rel(),
  offers: { active: 0, retired: 0 },
};
const by = (s: ReturnType<typeof projectStatus>) =>
  Object.fromEntries(s.items.map((i) => [i.key, i]));

describe("001b status projection", () => {
  it("a brief only: prototype only, the next step is a build; building unavailable says so", () => {
    const s = projectStatus(base);
    expect(s.chip.label).toBe("Prototype only");
    expect(by(s).build).toMatchObject({ value: "No build yet", tone: "now" });
    expect(s.next?.label).toBe("Build a version");
    const off = projectStatus({ ...base, build: { available: false, reason: "No provider" } });
    expect(by(off).build).toMatchObject({ tone: "blocked" });
    expect(by(off).build?.value).toMatch(/isn't connected here: No provider/);
    // Review #19: a way forward, never a dead end.
    expect(off.next).toEqual({
      label: "Offer it as a service instead",
      target: { route: "/start" },
    });
    expect(by(off).release?.value).toBe("Not released");
    expect(off.items.some((i) => /launched|\blive\b/i.test(i.value))).toBe(false);
  });

  it("a failed check is never releasable or launched", () => {
    const failed = cand({
      latest_check: { id: "e1", passed: 3, total: 7, release_ready: false, reasons: ["2 failed"] },
      status: "candidate",
    });
    const s = projectStatus({ ...base, releases: rel({ candidates: [failed] }) });
    expect(s.chip.label).toBe("Built, not released");
    expect(by(s).evaluation).toMatchObject({ tone: "blocked" });
    expect(by(s).evaluation?.value).toMatch(/3 of 7 passed; not releasable: 2 failed/);
    expect(by(s).release).toMatchObject({ value: "Not released" });
    expect(s.next?.label).toBe("See why checks failed");
    expect(s.releaseNote).toBeNull();
  });

  it("an active release coexists with a newer, unsaved brief: neither relabels the other", () => {
    const c = cand({
      revision: 1,
      status: "active",
      latest_check: { id: "e1", passed: 7, total: 7, release_ready: true, reasons: [] },
    });
    const releases = rel({
      candidates: [c],
      active: {
        id: "r1",
        artifact_job: c.artifact_job,
        artifact_digest: c.artifact_digest,
        eval_run: "e1",
        fixture_version: 0,
        policy: "p",
        state: "active",
        rolled_back_from: null,
        activated_at: "2026-11-04T10:05:00.000Z",
        retired_at: null,
        checks_current: true,
        reasons: [],
      },
    });
    const s = projectStatus({ ...base, head: 3, dirty: true, releases });
    expect(s.chip.label).toBe("Released build");
    expect(by(s).brief?.value).toBe("Unsaved changes (would become revision 4)");
    expect(by(s).build?.value).toMatch(/from revision 1 \(the brief is now at revision 3\)/);
    expect(by(s).release?.value).toMatch(/\(revision 1\) released; the brief has changed since/);
    expect(s.releaseNote).toMatch(/doesn't show that a model provider, wallet or network/);
    expect(s.next?.label).toBe("Set up a customer offer");
    const offered = projectStatus({ ...base, releases, offers: { active: 1, retired: 0 } });
    expect(by(offered).customers?.value).toMatch(/1 active \(a local setting/);
    expect(offered.next?.label).toBe("Try the released version");
  });

  it("unreadable records are unknown, never assumed", () => {
    const s = projectStatus({ ...base, releases: "unknown", offers: "unknown" });
    expect(s.chip.label).toBe("Status unknown");
    for (const k of ["build", "evaluation", "release", "customers"])
      expect(by(s)[k]).toMatchObject({ tone: "unknown", value: "Couldn't be read just now" });
    expect(s.next).toBeNull();
  });

  it("an unchecked build points to checks; a ready check points to release", () => {
    const s = projectStatus({ ...base, releases: rel({ candidates: [cand()] }) });
    expect(s.next).toEqual({
      label: "Check the latest build",
      target: { tab: "service", task: "evaluate" },
    });
    const ready = cand({
      status: "checked",
      latest_check: { id: "e", passed: 7, total: 7, release_ready: true, reasons: [] },
    });
    expect(projectStatus({ ...base, releases: rel({ candidates: [ready] }) }).next?.label).toBe(
      "Release the checked build",
    );
  });
});
