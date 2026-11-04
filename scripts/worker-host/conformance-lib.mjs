// Job 002e1: the conformance suite's PURE evidence rules, apart from anything that touches the
// host, so they can be unit-tested (server/test/conformance-lib.test.ts) and self-tested with
// `node conformance.mjs --self-test`, which runs only selfTest() and exits before any launcher
// call. Astra's WorkerImplementationReview follow-up: the previous negative-control loop wrongly
// required q's legitimate SIGXFSZ claim to fail when only p was corrupted. Each corruption now
// tests the claims it affects, and whole-report corruptions are tested apart.

import { createHash, randomUUID } from "node:crypto";

export const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);

const INDEX = { path: "index.html", text: "<!doctype html><title>t</title>\n" };

/** A job for one logic module with declared cases; `ids` lists the cases, for the evidence rules. */
export function makeJob(logic, checks) {
  const bundle = canon({
    kind: "web_app_bundle",
    schema_version: 1,
    name: "Conformance",
    description: "",
    files: [INDEX, { path: "logic.js", text: logic }].sort((a, b) => (a.path < b.path ? -1 : 1)),
    checks: checks.map((c) => ({ label: c.id, module: "logic.js", input: null, ...c })),
  });
  return {
    check_id: randomUUID(),
    attempt: 1,
    digest: createHash("sha256").update(bundle).digest("hex"),
    recipe: "web_app_checks/1",
    bundle,
    ids: checks.map((c) => c.id),
  };
}

/** A run counts only with a complete report bound to this job and exactly its cases. */
export function completeReport(o, job) {
  const r = o?.report;
  if (!r || typeof r !== "object" || r.error) return null;
  if (r.check_id !== job.check_id || r.attempt !== job.attempt || r.digest !== job.digest) return null;
  if (!Array.isArray(r.cases)) return null;
  const ids = r.cases.map((c) => c?.id).sort();
  if (canon(ids) !== canon([...job.ids].sort())) return null;
  return r;
}

/** The probe ran and returned exactly its expected observation. */
export const observed = (o, job, id) => completeReport(o, job)?.cases.find((c) => c.id === id)?.passed === true;

/** The case ran to a definite failure with this detail (e.g. a limit killed it). */
export function failedWith(o, job, id, re) {
  const c = completeReport(o, job)?.cases.find((x) => x.id === id);
  return c?.passed === false && re.test(c.detail ?? "");
}

/**
 * Negative controls. Returns the list of failed expectations (empty: the rules hold).
 * - Whole-report corruptions (no report, an error, another job, missing or extra case) must make
 *   EVERY claim false.
 * - A per-case corruption affects only that case's claim; the other case's legitimate claim stands.
 */
export function selfTest() {
  const job = { check_id: "a", attempt: 1, digest: "d", ids: ["p", "q"] };
  const p = { id: "p", passed: true, detail: "" };
  const q = { id: "q", passed: false, detail: "killed by signal SIGXFSZ" };
  const report = (cases, extra = {}) => ({ report: { check_id: "a", attempt: 1, digest: "d", cases, ...extra } });
  const claimP = (o) => observed(o, job, "p");
  const claimQ = (o) => failedWith(o, job, "q", /SIGXFSZ/);
  const problems = [];
  const expect = (name, got, want) => {
    if (got !== want) problems.push(`${name}: expected ${want}, got ${got}`);
  };

  const good = report([p, q]);
  expect("good: p observed", claimP(good), true);
  expect("good: q failed with SIGXFSZ", claimQ(good), true);

  const whole = {
    "no object": {},
    "empty report": { report: {} },
    "engine unavailable": { error: "unavailable" },
    "another digest": report([p, q], { digest: "x" }),
    "another attempt": report([p, q], { attempt: 2 }),
    "missing case": report([p]),
    "extra case": report([p, q, { id: "z", passed: true }]),
    "report error": report([p, q], { error: "supervisor_failed" }),
  };
  for (const [name, o] of Object.entries(whole)) {
    expect(`${name}: p`, claimP(o), false);
    expect(`${name}: q`, claimQ(o), false);
  }

  const pLoadFailed = report([{ id: "p", passed: false, detail: "module_load_failed: x" }, q]);
  expect("p import failed: p", claimP(pLoadFailed), false);
  expect("p import failed: q still legitimate", claimQ(pLoadFailed), true);
  const qPassed = report([p, { id: "q", passed: true, detail: "" }]);
  expect("q passed: q", claimQ(qPassed), false);
  expect("q passed: p still legitimate", claimP(qPassed), true);
  const qOtherFailure = report([p, { id: "q", passed: false, detail: "Took longer than 5 seconds" }]);
  expect("q failed otherwise: q", claimQ(qOtherFailure), false);
  return problems;
}
