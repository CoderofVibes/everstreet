// Job 002e, HOST LAUNCHER (root, under the pinned host Node in /opt/everstreet-worker/node).
// Invoked only as `/opt/everstreet-worker/bin/launch {preflight|run|cleanup <id>}` through one
// sudoers line. It accepts a bounded job on stdin, never a path, flag or command from the
// caller. NEVER RUN in this repository's tests: it needs the reviewed host setup (setup.sh) and
// is unverified until scripts/worker-host/conformance.sh passes on that host.
// Design: docs/design/EXECUTABLE_PRODUCTS.md §5.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chownSync,
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
const ID = /^es-[0-9a-f]{12}-[0-9]{1,6}$/;

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uidOf = (name) => Number(execFileSync("id", ["-u", name]).toString().trim());

function engineIdentity() {
  const installed = JSON.parse(readFileSync(join(STATE, "installed.json"), "utf8"));
  return {
    engine: "firecracker",
    firecracker: LOCK.firecracker.version,
    firecracker_sha256: installed.firecracker_sha256,
    kernel_sha256: LOCK.kernel.sha256,
    guest_image_sha256: installed.guest_image_sha256,
    lock_sha256: sha(join(ROOT, "worker.lock.json")),
    recipe: LOCK.recipe,
  };
}

function preflightProblems() {
  const p = [];
  const installed = existsSync(join(STATE, "installed.json"))
    ? JSON.parse(readFileSync(join(STATE, "installed.json"), "utf8"))
    : null;
  if (!installed) return ["not installed"];
  if (sha(FC) !== installed.firecracker_sha256) p.push("firecracker binary changed");
  if (sha(JAILER) !== installed.jailer_sha256) p.push("jailer binary changed");
  if (sha(KERNEL) !== LOCK.kernel.sha256) p.push("guest kernel changed");
  if (sha(IMAGE) !== installed.guest_image_sha256) p.push("guest image changed");
  try {
    execFileSync("setpriv", [`--reuid=${uidOf(VM_USER)}`, "--init-groups", "test", "-r", "/dev/kvm", "-a", "-w", "/dev/kvm"]);
  } catch {
    p.push(`/dev/kvm is not readable and writable by ${VM_USER}`);
  }
  // The jailer's cgroup-v2 fail-open trap: the parent must exist with its controllers.
  try {
    const ctl = readFileSync(join(CG_PARENT, "cgroup.subtree_control"), "utf8");
    for (const c of ["cpu", "memory", "pids"]) if (!ctl.split(/\s+/).includes(c)) p.push(`cgroup parent lacks ${c}`);
  } catch {
    p.push("cgroup parent everstreet-worker is missing");
  }
  if (!existsSync(NETNS)) p.push("network namespace everstreet-none is missing");
  return p;
}

/** Removes a job's jail and cgroup; kills anything left in it. Idempotent. */
function cleanup(id) {
  if (!ID.test(id)) return;
  const cg = join(CG_PARENT, id);
  if (existsSync(cg)) {
    try {
      writeFileSync(join(cg, "cgroup.kill"), "1");
    } catch {}
    for (let i = 0; i < 50 && readFileSync(join(cg, "cgroup.procs"), "utf8").trim(); i++)
      execFileSync("sleep", ["0.1"]);
    try {
      execFileSync("rmdir", [cg]); // a cgroup directory is removed with rmdir once empty
    } catch {}
  }
  rmSync(join(JAIL_BASE, "firecracker", id), { recursive: true, force: true });
}

function cleanupStale() {
  const left = new Set();
  for (const d of existsSync(CG_PARENT) ? readdirSync(CG_PARENT) : []) if (ID.test(d)) left.add(d);
  const jails = join(JAIL_BASE, "firecracker");
  for (const d of existsSync(jails) ? readdirSync(jails) : []) if (ID.test(d)) left.add(d);
  for (const id of left) cleanup(id);
  return [...left];
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

function readStdin(max) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    process.stdin.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length > max) reject(new Error("job too large"));
    });
    process.stdin.on("end", () => resolve(buf));
  });
}

async function run() {
  const job = JSON.parse((await readStdin(L.input_drive_max)).toString("utf8"));
  if (
    typeof job.check_id !== "string" ||
    !/^[0-9a-f-]{36}$/.test(job.check_id) ||
    !Number.isSafeInteger(job.attempt) ||
    job.attempt < 1 ||
    !/^[0-9a-f]{64}$/.test(job.digest) ||
    job.recipe !== LOCK.recipe ||
    typeof job.bundle !== "string"
  )
    return out({ error: "invalid_job" });
  const problems = preflightProblems();
  if (problems.length) return out({ error: "unavailable", detail: problems.join("; ") });
  const engine = engineIdentity();
  const id = `es-${job.check_id.replace(/-/g, "").slice(0, 12)}-${job.attempt}`;
  cleanup(id);
  const root = join(JAIL_BASE, "firecracker", id, "root");
  try {
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
    await new Promise((r) => jailer.on("exit", r));

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
    if (!limitsOk) {
      cleanup(id);
      return out({ error: "limits_unverified" });
    }
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
    let timedOut = false;
    while (readFileSync(join(cgDir, "cgroup.procs"), "utf8").trim()) {
      if (Date.now() > deadline) {
        timedOut = true;
        writeFileSync(join(cgDir, "cgroup.kill"), "1");
        break;
      }
      await sleep(200);
    }
    if (timedOut) return out({ error: "timeout" });
    let peak = null;
    try {
      peak = Number(readFileSync(join(cgDir, "memory.peak"), "utf8").trim());
    } catch {}
    let report;
    try {
      report = decodeFrame(readFileSync(join(root, "output.img")), L.report_max);
    } catch (e) {
      return out({ error: "invalid_report", detail: String(e.message).slice(0, 200) });
    }
    out({ report, host: { vmm_memory_peak_bytes: peak } });
  } finally {
    cleanup(id);
  }
}

const verb = process.argv[2];
if (verb === "preflight") {
  const removed = cleanupStale();
  const problems = preflightProblems();
  out(problems.length ? { ok: false, reason: problems.join("; "), removed } : { ok: true, engine: engineIdentity(), removed });
} else if (verb === "run") {
  run().catch((e) => out({ error: "worker_error", detail: String(e?.message ?? e).slice(0, 200) }));
} else if (verb === "cleanup" && ID.test(process.argv[3] ?? "")) {
  cleanup(process.argv[3]);
  out({ ok: true });
} else {
  out({ error: "usage" });
  process.exitCode = 2;
}
