// Job 002e1: the conformance suite's pure evidence rules (scripts/worker-host/conformance-lib.mjs)
// and its host-free self-test entry. Astra reproduced the previous selfTest failing on dc7fb09:
// its negative controls required q's legitimate SIGXFSZ result to fail when only p was corrupted.
// What this proves: whole-report corruptions void every claim; a per-case corruption voids only
// that claim; `node conformance.mjs --self-test` passes and makes no launcher or host call.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  completeReport,
  failedWith,
  makeJob,
  observed,
  selfTest,
  // @ts-expect-error: a plain .mjs module shared with the host, without type declarations
} from "../../scripts/worker-host/conformance-lib.mjs";

const job = { check_id: "a", attempt: 1, digest: "d", ids: ["p", "q"] };
const p = { id: "p", passed: true, detail: "" };
const q = { id: "q", passed: false, detail: "killed by signal SIGXFSZ" };
const report = (cases: unknown[], extra = {}) => ({
  report: { check_id: "a", attempt: 1, digest: "d", cases, ...extra },
});

describe("002e1 conformance evidence rules", () => {
  it("the self-test's expectations all hold", () => {
    expect(selfTest()).toEqual([]);
  });

  it("a corrupted p voids only p's claim; q's legitimate limit observation stands", () => {
    const o = report([{ id: "p", passed: false, detail: "module_load_failed: x" }, q]);
    expect(observed(o, job, "p")).toBe(false);
    expect(failedWith(o, job, "q", /SIGXFSZ/)).toBe(true);
  });

  it("another job's report, a missing or extra case, or an engine error void every claim", () => {
    for (const o of [
      report([p, q], { digest: "x" }),
      report([p]),
      report([p, q, { id: "z", passed: true }]),
      { error: "unavailable" },
      report([p, q], { error: "supervisor_failed" }),
    ]) {
      expect(completeReport(o, job)).toBeNull();
      expect(observed(o, job, "p")).toBe(false);
      expect(failedWith(o, job, "q", /SIGXFSZ/)).toBe(false);
    }
  });

  it("jobs are bound to their own bundle digest and case list", () => {
    const j = makeJob("export const f=()=>1;\n", [{ id: "one", export: "f", expect: 1 }]);
    expect(j.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(j.ids).toEqual(["one"]);
    expect(JSON.parse(j.bundle).checks[0]).toMatchObject({ id: "one", module: "logic.js" });
  });

  it("`conformance.mjs --self-test` passes and stops before any launcher call", () => {
    const r = spawnSync(process.execPath, ["scripts/worker-host/conformance.mjs", "--self-test"], {
      encoding: "utf8",
      timeout: 15_000,
      env: { PATH: "" }, // no sudo, no launcher: a host call here would fail loudly
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no launcher or host call made");
  });
});
