// Job 002e, guest, TRUSTED. Runs as root under the pinned Node, started by /opt/everstreet/init.
// It owns everything a report's meaning depends on: the job binding, the expected values, the
// comparisons, the engine identity and the output drive (/dev/vdc, root 0600). Untrusted code
// runs only in separate processes as uid 1000 inside the guest cgroup `untrusted`, and each
// process can affect only its own case's value. After every step the whole cgroup is killed,
// so nothing an untrusted step started survives into the next one. Design: EXECUTABLE_PRODUCTS §5.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chownSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeFrame, encodeFrame } from "./wire.mjs";

const INPUT = "/dev/vdb";
const OUTPUT = "/dev/vdc";
const APP = "/work/app";
const SCRATCH = "/work/scratch";
const CG = "/sys/fs/cgroup/untrusted";
const UID = 1000;
const STEP_MS = 5000;
const VALUE_MAX = 8192;
const REPORT_MAX = 65536;
const NODE = "/opt/node/bin/node";

const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);

function writeReport(report) {
  const frame = encodeFrame(report, REPORT_MAX);
  const fd = openSync(OUTPUT, "r+");
  writeSync(fd, frame, 0, frame.length, 0);
}

function setupCgroup() {
  writeFileSync("/sys/fs/cgroup/cgroup.subtree_control", "+cpu +memory +pids");
  mkdirSync(CG, { recursive: true });
  writeFileSync(join(CG, "memory.max"), "167772160");
  writeFileSync(join(CG, "memory.swap.max"), "0");
  writeFileSync(join(CG, "pids.max"), "32");
  writeFileSync(join(CG, "cpu.max"), "100000 100000");
}

/**
 * 002f1 (correction 2): the untrusted cgroup's memory bound as the kernel reads it back, and its
 * memory events (max: the limit was hit; oom / oom_kill: the OOM killer acted). Null when a file
 * is missing or not a finite number: absent evidence, never zero.
 */
function readLimits() {
  const n = (f) => {
    try {
      const v = readFileSync(join(CG, f), "utf8").trim();
      return /^[0-9]+$/.test(v) ? Number(v) : v === "max" ? "max" : null;
    } catch {
      return null;
    }
  };
  return { memory_max: n("memory.max"), swap_max: n("memory.swap.max") };
}
function memoryEvents() {
  try {
    const out = {};
    for (const line of readFileSync(join(CG, "memory.events"), "utf8").split("\n")) {
      const [k, v] = line.trim().split(/\s+/);
      if (k === "max" || k === "oom" || k === "oom_kill") out[k] = /^[0-9]+$/.test(v ?? "") ? Number(v) : null;
    }
    return "max" in out && "oom" in out && "oom_kill" in out ? out : null;
  } catch {
    return null;
  }
}
const eventsDelta = (a, b) =>
  a && b && [a, b].every((e) => Object.values(e).every(Number.isFinite))
    ? { max: b.max - a.max, oom: b.oom - a.oom, oom_kill: b.oom_kill - a.oom_kill }
    : null;

/** Raised when cleanup can't be confirmed: the job stops, failing closed. */
class Unclean extends Error {}

/**
 * Kills everything in the untrusted cgroup (cgroup v2 `cgroup.kill`) and confirms it is empty.
 * If anything survives, the whole run stops with no case results (fail closed).
 */
function killAll() {
  writeFileSync(join(CG, "cgroup.kill"), "1");
  const deadline = Date.now() + 1000;
  while (readFileSync(join(CG, "cgroup.procs"), "utf8").trim()) {
    if (Date.now() > deadline) throw new Unclean("untrusted processes survived cleanup");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}

/** One untrusted step: joins the cgroup, drops to uid 1000 with limits, bounded output. */
function untrusted(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        `echo $$ > ${CG}/cgroup.procs && exec "$@"`,
        "sh",
        "/usr/bin/prlimit",
        "--nproc=32",
        "--fsize=2097152",
        "--",
        "/usr/bin/setpriv",
        `--reuid=${UID}`,
        `--regid=${UID}`,
        "--clear-groups",
        "--no-new-privs",
        "--inh-caps=-all",
        "--bounding-set=-all",
        NODE,
        "--max-old-space-size=128",
        ...args,
      ],
      {
        cwd: SCRATCH,
        env: { PATH: "/usr/bin:/bin", HOME: SCRATCH },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let out = Buffer.alloc(0);
    let err = Buffer.alloc(0);
    let over = false;
    child.stdout.on("data", (d) => {
      if (out.length + d.length > VALUE_MAX) over = true;
      else out = Buffer.concat([out, d]);
    });
    child.stderr.on("data", (d) => {
      if (err.length < 1024) err = Buffer.concat([err, d]).subarray(0, 1024);
    });
    let unclean = null;
    // 002f1 (correction 2): a timeout is OUR timer firing, nothing else. The kernel's OOM killer
    // also sends SIGKILL, so "killed by SIGKILL" alone never means "took too long".
    let timerFired = false;
    const timer = setTimeout(() => {
      timerFired = true;
      child.kill("SIGKILL");
      try {
        killAll();
      } catch (e) {
        unclean = e;
      }
    }, STEP_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      try {
        killAll();
      } catch (e) {
        unclean = e;
      }
      if (unclean) return reject(unclean);
      resolve({
        code,
        signal,
        timedOut: timerFired,
        over,
        out: out.toString("utf8"),
        err: err.toString("utf8"),
      });
    });
    child.stdin.end(stdin ?? "");
  });
}

async function main() {
  let job;
  try {
    job = decodeFrame(readFileSync(INPUT), 409600);
  } catch (e) {
    return writeReport({ error: "input_unreadable", detail: String(e.message).slice(0, 200) });
  }
  const bind = {
    recipe: job.recipe,
    check_id: job.check_id,
    attempt: job.attempt,
    digest: job.digest,
    engine: job.engine,
  };
  if (job.recipe !== "web_app_checks/1")
    return writeReport({ ...bind, error: "unknown_recipe" });
  // The bundle arrives as the platform's canonical text; its digest must match the binding.
  const digest = createHash("sha256").update(job.bundle, "utf8").digest("hex");
  if (digest !== job.digest) return writeReport({ ...bind, error: "digest_mismatch" });
  const bundle = JSON.parse(job.bundle);

  setupCgroup();
  // Astra's BundleInputReview: the bundle tree stays ROOT-owned (dirs 0755, files 0444), so no
  // case can replace a sibling module's entry; untrusted steps may write only /work/scratch.
  mkdirSync(APP, { recursive: true, mode: 0o755 });
  // The module type for every bundle file comes from the platform, never from the bundle.
  writeFileSync("/work/package.json", JSON.stringify({ type: "module" }), { mode: 0o444 });
  for (const f of bundle.files) {
    const p = join(APP, f.path);
    mkdirSync(dirname(p), { recursive: true, mode: 0o755 });
    writeFileSync(p, f.text, { mode: 0o444 });
  }
  writeFileSync("/work/case-runner.mjs", readFileSync("/opt/everstreet/case-runner.mjs"), {
    mode: 0o444,
  });
  mkdirSync(SCRATCH, { mode: 0o700 });
  chownSync(SCRATCH, UID, UID);

  // 1. Every .js parses as an ES module (syntax only: `--check` never executes it).
  const syntax = [];
  for (const f of bundle.files.filter((x) => x.path.endsWith(".js"))) {
    const r = await untrusted(["--check", join(APP, f.path)]);
    syntax.push({
      path: f.path,
      ok: r.code === 0 && !r.timedOut,
      detail: r.code === 0 ? "" : r.err.split("\n").find((l) => /Error/.test(l))?.slice(0, 200) ?? "did not parse",
    });
  }
  // 2. Each declared case alone: only its value comes back; the comparison is ours.
  const cases = [];
  const limits = readLimits();
  for (const c of bundle.checks) {
    const before = memoryEvents();
    const r = await untrusted(
      ["/work/case-runner.mjs", c.module, c.export],
      JSON.stringify(c.input),
    );
    let passed = false;
    let detail = "";
    if (r.timedOut) detail = "Took longer than 5 seconds and was stopped";
    else if (r.over) detail = "Returned more than 8 KB";
    else if (r.signal) detail = `killed by signal ${r.signal}`;
    else if (r.code !== 0) detail = r.err.split("\n")[0]?.slice(0, 200) || `exited ${r.code}`;
    else {
      const line = r.out.split("\n")[0] ?? "";
      try {
        const value = JSON.parse(line);
        passed = canon(value) === canon(c.expect);
        if (!passed) detail = `Returned ${line.slice(0, 200)}`;
      } catch {
        detail = "Did not return a JSON value";
      }
    }
    cases.push({ id: c.id, passed, detail, memory_events: eventsDelta(before, memoryEvents()) });
  }
  let memoryPeak = null;
  try {
    memoryPeak = Number(readFileSync(join(CG, "memory.peak"), "utf8").trim());
  } catch {
    // not available on this kernel
  }
  writeReport({
    ...bind,
    syntax,
    cases,
    usage: { untrusted_memory_peak_bytes: memoryPeak },
    limits,
  });
}

try {
  await main();
} catch (e) {
  try {
    writeReport({ error: "supervisor_failed", detail: String(e?.message ?? e).slice(0, 200) });
  } catch {
    // the host reads an empty drive as invalid_report
  }
}
