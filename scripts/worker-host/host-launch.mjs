// Job 002e, HOST LAUNCHER (root, under the pinned host Node in /opt/everstreet-worker/node).
// Invoked only as `/opt/everstreet-worker/bin/launch {preflight|run|cleanup <id>}` through one
// sudoers line. It accepts a bounded job on stdin, never a path, flag or command from the
// caller. NEVER RUN in this repository's tests: it needs the reviewed host setup (setup.sh) and
// is unverified until scripts/worker-host/conformance.mjs passes on that host.
// Design: docs/design/EXECUTABLE_PRODUCTS.md §5. Revised after Astra's WorkerImplementationReview:
// - (002e1) mutual exclusion is a kernel flock(2) held by the `launch` wrapper for this whole
//   process (and by `setup.sh uninstall`): a contender is told busy at once; the kernel releases
//   the lock when this process ends, however it ends, so there is no stale lock to take over,
//   and any es-* leftover a preflight finds belongs to an ended launcher, an orphan;
// - cleanup confirms the job's cgroup is empty before removing anything; otherwise it keeps the
//   jail as evidence and fails (the platform then admits no more work until a preflight cleans);
// - one validated identity (UUID check id, attempt 1..999999) is shared by run, cleanup and the
//   platform's adapter; stdin is bounded and deadlined; hashes are streamed; subprocesses bounded;
// - SIGTERM/SIGINT/SIGHUP during a run clean up before exiting; after a SIGKILLed launcher, the
//   next preflight cleans what it left.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chownSync,
  createReadStream,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { decodeFrame, encodeFrame } from "./guest/wire.mjs";

const ROOT = "/opt/everstreet-worker";
const LOCK = JSON.parse(readFileSync(join(ROOT, "worker.lock.json"), "utf8"));
const L = LOCK.limits;
const FC = join(ROOT, "bin/firecracker");
const JAILER = join(ROOT, "bin/jailer");
const KERNEL = join(ROOT, "guest/vmlinux");
const IMAGE = join(ROOT, "guest/guest.ext4");
const STATE = "/var/lib/everstreet-worker";
const JAIL_BASE = "/srv/everstreet-jail";
const CG_PARENT = "/sys/fs/cgroup/everstreet-worker";
const NETNS = "/var/run/netns/everstreet-none";
const VM_USER = "everstreet-vm";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^es-[0-9a-f]{12}-[0-9]{1,6}$/;
const MAX_HASH_BYTES = 2 * 1024 * 1024 * 1024;

class CleanupFailed extends Error {}

/** The one jail id for a job; the platform's adapter derives it the same way. */
export const jailId = (checkId, attempt) => `es-${checkId.replace(/-/g, "").slice(0, 12)}-${attempt}`;

const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run1 = (cmd, args) => execFileSync(cmd, args, { timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
const uidOf = (name) => Number(run1("id", ["-u", name]).toString().trim());

/** Streamed SHA-256 with a byte bound: never the whole file in memory. */
function sha(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    let n = 0;
    createReadStream(path, { highWaterMark: 1 << 20 })
      .on("data", (d) => {
        n += d.length;
        if (n > MAX_HASH_BYTES) reject(new Error(`${path} is larger than expected`));
        h.update(d);
      })
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

const installed = () =>
  existsSync(join(STATE, "installed.json")) ? JSON.parse(readFileSync(join(STATE, "installed.json"), "utf8")) : null;

async function engineIdentity() {
  const i = installed();
  return {
    engine: "firecracker",
    firecracker: LOCK.firecracker.version,
    firecracker_sha256: i.firecracker_sha256,
    kernel_sha256: LOCK.kernel.sha256,
    guest_image_sha256: i.guest_image_sha256,
    lock_sha256: await sha(join(ROOT, "worker.lock.json")),
    recipe: LOCK.recipe,
  };
}

async function readinessProblems() {
  const i = installed();
  if (!i) return ["not installed"];
  const p = [];
  if ((await sha(FC)) !== i.firecracker_sha256) p.push("firecracker binary changed");
  if ((await sha(JAILER)) !== i.jailer_sha256) p.push("jailer binary changed");
  if ((await sha(KERNEL)) !== LOCK.kernel.sha256) p.push("guest kernel changed");
  if ((await sha(IMAGE)) !== i.guest_image_sha256) p.push("guest image changed");
  try {
    run1("setpriv", [`--reuid=${uidOf(VM_USER)}`, "--init-groups", "test", "-r", "/dev/kvm", "-a", "-w", "/dev/kvm"]);
  } catch {
    p.push(`/dev/kvm is not readable and writable by ${VM_USER}`);
  }
  // The jailer's cgroup-v2 fail-open trap: the parent must exist with its controllers.
  try {
    const ctl = readFileSync(join(CG_PARENT, "cgroup.subtree_control"), "utf8").split(/\s+/);
    for (const c of ["cpu", "memory", "pids"]) if (!ctl.includes(c)) p.push(`cgroup parent lacks ${c}`);
  } catch {
    p.push("cgroup parent everstreet-worker is missing");
  }
  if (!existsSync(NETNS)) p.push("network namespace everstreet-none is missing");
  return p;
}

// ---------- the single-run lock ----------

// 002e1: mutual exclusion is the KERNEL's: the `launch` wrapper runs this whole process under
// flock(2) on lifecycle.flock (also taken by `setup.sh uninstall`), released by the kernel when
// this process ends. While this process runs, no other lifecycle operation is live, so every
// es-* jail or cgroup found by a preflight is an orphan by construction. No file-based takeover.

/**
 * Kills everything in a job's cgroup and confirms it is empty; only then removes the cgroup and
 * the jail. Unconfirmed: throws, leaving both as evidence.
 */
async function cleanup(id) {
  if (!ID.test(id)) throw new CleanupFailed(`invalid id ${id}`);
  const cg = join(CG_PARENT, id);
  if (existsSync(cg)) {
    try {
      writeFileSync(join(cg, "cgroup.kill"), "1");
    } catch (e) {
      throw new CleanupFailed(`cgroup.kill failed for ${id}: ${e.message}`);
    }
    const deadline = Date.now() + 5000;
    while (readFileSync(join(cg, "cgroup.procs"), "utf8").trim()) {
      if (Date.now() > deadline) throw new CleanupFailed(`processes survived in ${id}`);
      await sleep(50);
    }
    try {
      run1("rmdir", [cg]);
    } catch (e) {
      throw new CleanupFailed(`cgroup ${id} could not be removed: ${e.message}`);
    }
  }
  rmSync(join(JAIL_BASE, "firecracker", id), { recursive: true, force: true });
}

/** Leftover jails/cgroups with no live run: proven orphans, cleaned with confirmation. */
async function cleanOrphans(liveId) {
  const left = new Set();
  for (const d of existsSync(CG_PARENT) ? readdirSync(CG_PARENT) : []) if (ID.test(d)) left.add(d);
  const jails = join(JAIL_BASE, "firecracker");
  for (const d of existsSync(jails) ? readdirSync(jails) : []) if (ID.test(d)) left.add(d);
  left.delete(liveId ?? "");
  for (const id of left) await cleanup(id);
  return [...left];
}

async function preflight() {
  // Under the kernel lock (see above): anything left is an orphan of a launcher that has ended.
  let removed = [];
  try {
    removed = await cleanOrphans(null);
  } catch (e) {
    // Unconfirmed: the evidence stays on disk and preflight is not ok, so nothing is admitted.
    return out({ ok: false, cleanup_failed: true, reason: e.message, removed });
  }
  const problems = await readinessProblems();
  return out(problems.length ? { ok: false, reason: problems.join("; "), removed } : { ok: true, engine: await engineIdentity(), removed });
}

function readStdin(max, ms) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    const timer = setTimeout(() => {
      process.stdin.destroy();
      reject(new Error("job not received in time"));
    }, ms);
    process.stdin.on("data", (d) => {
      n += d.length;
      if (n > max) {
        clearTimeout(timer);
        process.stdin.destroy(); // stop consuming; nothing more is buffered
        reject(new Error("job too large"));
      } else parts.push(d);
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(parts));
    });
  });
}

function api(sock, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      { socketPath: sock, path, method: "PUT", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
      (res) => {
        res.resume();
        res.on("end", () => ((res.statusCode ?? 500) < 300 ? resolve() : reject(new Error(`${path}: ${res.statusCode}`))));
      },
    );
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error(`${path}: timeout`)));
    req.end(data);
  });
}

async function run() {
  let job;
  try {
    job = JSON.parse((await readStdin(L.input_drive_max, 10_000)).toString("utf8"));
  } catch (e) {
    return out({ error: "invalid_job", detail: e.message });
  }
  if (
    typeof job.check_id !== "string" ||
    !UUID.test(job.check_id) ||
    !Number.isInteger(job.attempt) ||
    job.attempt < 1 ||
    job.attempt > 999_999 ||
    !/^[0-9a-f]{64}$/.test(job.digest) ||
    job.recipe !== LOCK.recipe ||
    typeof job.bundle !== "string"
  )
    return out({ error: "invalid_job" });
  const id = jailId(job.check_id, job.attempt);
  // Leftovers from an ended launcher must be cleaned by a preflight first; a run never does it.
  const leftovers = (existsSync(CG_PARENT) ? readdirSync(CG_PARENT) : []).filter((d) => ID.test(d));
  if (leftovers.length) return out({ error: "unavailable", detail: "a previous run wasn't cleaned up; preflight first" });
  const problems = await readinessProblems();
  if (problems.length) return out({ error: "unavailable", detail: problems.join("; ") });
  const engine = await engineIdentity();
  let finished = false;
  const onSignal = async () => {
    if (finished) return;
    finished = true;
    try {
      await cleanup(id);
    } catch {
      // unconfirmed: the next preflight (after this process and its lock are gone) retries
    }
    process.exit(130);
  };
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, onSignal);
  const root = join(JAIL_BASE, "firecracker", id, "root");
  let result;
  try {
    result = await runInJail(job, id, root, engine);
  } catch (e) {
    result = { error: "worker_error", detail: String(e?.message ?? e).slice(0, 200) };
  }
  finished = true;
  try {
    await cleanup(id);
  } catch (e) {
    // Unconfirmed cleanup: the lock and jail stay; the platform admits nothing until a
    // preflight proves the orphan and cleans it.
    return out({ error: "cleanup_failed", detail: e.message });
  }
  out(result);
}

async function runInJail(job, id, root, engine) {
  mkdirSync(join(root, "run"), { recursive: true });
  linkSync(KERNEL, join(root, "vmlinux"));
  linkSync(IMAGE, join(root, "guest.ext4"));
  const input = encodeFrame({ ...job, engine }, L.input_drive_max);
  const padded = Buffer.alloc(Math.ceil(input.length / 512) * 512);
  input.copy(padded);
  writeFileSync(join(root, "input.img"), padded, { mode: 0o400 });
  writeFileSync(join(root, "output.img"), Buffer.alloc(L.output_drive_bytes), { mode: 0o600 });
  const vm = uidOf(VM_USER);
  for (const f of ["input.img", "output.img"]) chownSync(join(root, f), vm, vm);

  const cg = L.host_vmm_cgroup;
  const jailer = spawn(
    JAILER,
    [
      "--id", id,
      "--exec-file", FC,
      "--uid", String(vm),
      "--gid", String(vm),
      "--chroot-base-dir", JAIL_BASE,
      "--cgroup-version", "2",
      "--parent-cgroup", "everstreet-worker",
      "--cgroup", `memory.max=${cg["memory.max"]}`,
      "--cgroup", `pids.max=${cg["pids.max"]}`,
      "--cgroup", `cpu.max=${cg["cpu.max"]}`,
      "--netns", NETNS,
      "--new-pid-ns",
      "--resource-limit", `fsize=${L.host_vmm_rlimit.fsize}`,
      "--daemonize",
      "--",
      "--api-sock", "/run/fc.sock",
    ],
    { stdio: "ignore" },
  );
  await Promise.race([new Promise((r) => jailer.on("exit", r)), sleep(10_000).then(() => jailer.kill("SIGKILL"))]);

  // Verify placement and limits BEFORE the VM is given anything to run.
  const cgDir = join(CG_PARENT, id);
  let pids = "";
  for (let i = 0; i < 40 && !pids; i++) {
    await sleep(50);
    pids = existsSync(join(cgDir, "cgroup.procs")) ? readFileSync(join(cgDir, "cgroup.procs"), "utf8").trim() : "";
  }
  const limitsOk =
    pids &&
    readFileSync(join(cgDir, "memory.max"), "utf8").trim() === cg["memory.max"] &&
    readFileSync(join(cgDir, "pids.max"), "utf8").trim() === cg["pids.max"] &&
    readFileSync(join(cgDir, "cpu.max"), "utf8").trim() === cg["cpu.max"];
  if (!limitsOk) return { error: "limits_unverified" };
  const sock = join(root, "run/fc.sock");
  for (let i = 0; i < 40 && !existsSync(sock); i++) await sleep(50);
  await api(sock, "/boot-source", {
    kernel_image_path: "vmlinux",
    boot_args: "console=ttyS0 reboot=k panic=1 pci=off ro init=/opt/everstreet/init",
  });
  await api(sock, "/machine-config", { vcpu_count: L.vm.vcpus, mem_size_mib: L.vm.mem_mib });
  await api(sock, "/drives/rootfs", { drive_id: "rootfs", path_on_host: "guest.ext4", is_root_device: true, is_read_only: true });
  await api(sock, "/drives/input", { drive_id: "input", path_on_host: "input.img", is_root_device: false, is_read_only: true });
  await api(sock, "/drives/output", { drive_id: "output", path_on_host: "output.img", is_root_device: false, is_read_only: false });
  // No network interface is ever configured.
  await api(sock, "/actions", { action_type: "InstanceStart" });

  const deadline = Date.now() + L.vm_wall_seconds * 1000;
  while (readFileSync(join(cgDir, "cgroup.procs"), "utf8").trim()) {
    if (Date.now() > deadline) return { error: "timeout" }; // cleanup kills the group
    await sleep(200);
  }
  let peak = null;
  try {
    peak = Number(readFileSync(join(cgDir, "memory.peak"), "utf8").trim());
  } catch {}
  try {
    return { report: decodeFrame(readFileSync(join(root, "output.img")), L.report_max), host: { vmm_memory_peak_bytes: peak } };
  } catch (e) {
    return { error: "invalid_report", detail: String(e.message).slice(0, 200) };
  }
}

const verb = process.argv[2];
const main =
  verb === "preflight"
    ? preflight()
    : verb === "run"
      ? run()
      : verb === "cleanup" && ID.test(process.argv[3] ?? "")
        ? (async () => {
            // Under the kernel lock: the job named can't be live (its launcher would hold it).
            try {
              await cleanup(process.argv[3]);
              out({ ok: true });
            } catch (e) {
              out({ ok: false, cleanup_failed: true, reason: e.message });
              process.exitCode = 1;
            }
          })()
        : (async () => {
            out({ error: "usage" });
            process.exitCode = 2;
          })();
main.catch((e) => {
  out({ error: "worker_error", detail: String(e?.message ?? e).slice(0, 200) });
  process.exitCode = 1;
});
