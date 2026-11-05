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

// ---------- 002f1 (correction 2): what the guest memory case may claim ----------
//
// The intended property: the untrusted cgroup's allocations are capped at its bound (the kernel
// reads back exactly 160 MiB, swap 0), exceeding it ends the step within a bounded time, and the
// next step still runs (recovery). Two different claims can follow, and are reported apart:
//   - "oom_kill": the kernel's OOM killer ended the step (memory.events oom_kill rose; the step
//     was killed by SIGKILL that was NOT the supervisor's timer);
//   - "held_at_ceiling_then_timed_out": the kernel held the step at its bound (memory.events max
//     rose; peak within the bound) until the supervisor's 5 s timer stopped it.
// A timeout alone, missing/nonfinite/over-bound/mismatched evidence, or a step that passed never
// counts. No budget is raised to make a message match.

export const GUEST_MEMORY_MAX = 167772160;

const finite = (v) => typeof v === "number" && Number.isFinite(v);

export function memoryClaim(o, job, id, nextId, expectedMax = GUEST_MEMORY_MAX) {
  const reasons = [];
  const r = completeReport(o, job);
  if (!r) return { holds: false, kind: null, reasons: ["no complete report for this job"] };
  const max = r.limits?.memory_max;
  if (!finite(max)) reasons.push("the memory bound wasn't read back");
  else if (max !== expectedMax) reasons.push(`the bound read back as ${max}, not ${expectedMax}`);
  if (r.limits?.swap_max !== 0) reasons.push("swap wasn't read back as 0");
  const peak = r.usage?.untrusted_memory_peak_bytes;
  if (!finite(peak) || peak <= 0) reasons.push("no finite memory peak");
  else if (finite(max) && peak > max) reasons.push(`the peak ${peak} exceeds the bound ${max}`);
  const c = r.cases.find((x) => x.id === id);
  const ev = c?.memory_events;
  const evOk = ev && ["max", "oom", "oom_kill"].every((k) => finite(ev[k]) && ev[k] >= 0);
  if (!c) reasons.push("the memory case is missing");
  else if (c.passed === true) reasons.push("the memory case completed: nothing was bounded");
  if (!evOk) reasons.push("no finite kernel memory events for the case");
  let kind = null;
  if (c && c.passed === false && evOk) {
    if (ev.oom_kill >= 1 && /killed by signal SIGKILL/.test(c.detail ?? "")) kind = "oom_kill";
    else if (ev.max >= 1 && /longer than 5 seconds/.test(c.detail ?? ""))
      kind = "held_at_ceiling_then_timed_out";
    else reasons.push("no kernel evidence that the limit acted (a timeout alone proves nothing)");
  }
  if (!observed(o, job, nextId)) reasons.push("the next case didn't run to its expected value");
  return { holds: reasons.length === 0 && kind !== null, kind, reasons };
}

/** Negative controls for memoryClaim. Returns the failed expectations (empty: the rule holds). */
export function memorySelfTest() {
  const job = { check_id: "m", attempt: 1, digest: "d", ids: ["grow", "ok"] };
  const ok = { id: "ok", passed: true, detail: "" };
  const oomCase = { id: "grow", passed: false, detail: "killed by signal SIGKILL", memory_events: { max: 3, oom: 1, oom_kill: 1 } };
  const heldCase = { id: "grow", passed: false, detail: "Took longer than 5 seconds and was stopped", memory_events: { max: 40, oom: 0, oom_kill: 0 } };
  const rep = (grow, extra = {}) => ({
    report: {
      check_id: "m",
      attempt: 1,
      digest: "d",
      cases: [grow, ok],
      usage: { untrusted_memory_peak_bytes: 160 * 1048576 },
      limits: { memory_max: GUEST_MEMORY_MAX, swap_max: 0 },
      ...extra,
    },
  });
  const problems = [];
  const want = (name, o, holds, kind = null) => {
    const r = memoryClaim(o, job, "grow", "ok");
    if (r.holds !== holds || (holds && r.kind !== kind))
      problems.push(`${name}: expected holds=${holds}${holds ? ` kind=${kind}` : ""}, got ${JSON.stringify(r)}`);
  };
  want("oom kill with evidence", rep(oomCase), true, "oom_kill");
  want("held at ceiling then timed out", rep(heldCase), true, "held_at_ceiling_then_timed_out");
  want("timeout alone (no max event)", rep({ ...heldCase, memory_events: { max: 0, oom: 0, oom_kill: 0 } }), false);
  want("SIGKILL without oom_kill", rep({ ...oomCase, memory_events: { max: 3, oom: 0, oom_kill: 0 } }), false);
  want("missing events", rep({ ...oomCase, memory_events: null }), false);
  want("nonfinite events", rep({ ...oomCase, memory_events: { max: 3, oom: 1, oom_kill: Number.NaN } }), false);
  want("negative events", rep({ ...oomCase, memory_events: { max: 3, oom: 1, oom_kill: -1 } }), false);
  want("missing bound", rep(oomCase, { limits: undefined }), false);
  want("mismatched bound", rep(oomCase, { limits: { memory_max: 2 * GUEST_MEMORY_MAX, swap_max: 0 } }), false);
  want("bound 'max'", rep(oomCase, { limits: { memory_max: "max", swap_max: 0 } }), false);
  want("swap allowed", rep(oomCase, { limits: { memory_max: GUEST_MEMORY_MAX, swap_max: 1048576 } }), false);
  want("missing peak", rep(oomCase, { usage: { untrusted_memory_peak_bytes: null } }), false);
  want("infinite peak", rep(oomCase, { usage: { untrusted_memory_peak_bytes: Number.POSITIVE_INFINITY } }), false);
  want("peak over the bound", rep(oomCase, { usage: { untrusted_memory_peak_bytes: GUEST_MEMORY_MAX + 1 } }), false);
  want("the step passed", rep({ ...oomCase, passed: true }), false);
  want("next case failed", { report: { ...rep(oomCase).report, cases: [oomCase, { ...ok, passed: false }] } }, false);
  want("another job", rep(oomCase, { digest: "x" }), false);
  want("no report", {}, false);
  return problems;
}

// ---------- 002f1 (correction 3): the test-only orphan procedure's pure rules ----------

/** The exact launcher command line (`launch` execs into it while holding the lifecycle lock). */
export const LAUNCHER_CMDLINE = ["/opt/everstreet-worker/node/bin/node", "/opt/everstreet-worker/host-launch.mjs", "run"];
export const JAIL_ID = /^es-[0-9a-f]{12}-[0-9]{1,6}$/;

/**
 * The pids holding a FLOCK on the file with this inode, from /proc/locks text. Each line reads
 * `N: FLOCK  ADVISORY  WRITE PID MAJ:MIN:INODE START END`; `->` lines are waiters, not holders.
 */
export function flockHolders(procLocks, inode) {
  const out = [];
  for (const line of String(procLocks).split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6 || f[1] === "->" || f[1] !== "FLOCK") continue;
    const pid = Number(f[4]);
    const ino = f[5]?.split(":")[2];
    if (Number.isSafeInteger(pid) && pid > 1 && ino === String(inode)) out.push(pid);
  }
  return [...new Set(out)];
}

/** /proc/<pid>/cmdline (NUL-separated) is exactly the launcher's `run`. */
export const isLauncherRun = (cmdline) => {
  const a = String(cmdline).split("\0").filter((x) => x !== "");
  return a.length === LAUNCHER_CMDLINE.length && a.every((x, i) => x === LAUNCHER_CMDLINE[i]);
};

/** A Firecracker started by the jailer for exactly this jail (`--id <jail>` in its arguments). */
export const isVmFor = (cmdline, jail) => {
  const a = String(cmdline).split("\0").filter((x) => x !== "");
  const i = a.indexOf("--id");
  return JAIL_ID.test(jail) && i >= 0 && a[i + 1] === jail && /firecracker$/.test(a[0] ?? "");
};
