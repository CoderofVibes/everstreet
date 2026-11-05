// Job 002f1 (correction 3): a TEST-ONLY root procedure for conformance case 10. Never installed by
// setup.sh, never granted in sudoers, never part of production. On a DISPATCHED host step only,
// as root:   /opt/everstreet-worker/node/bin/node test-orphan.mjs <jail-id>
// It identifies the exact synthetic job's launcher (the one process holding the lifecycle flock,
// running exactly `host-launch.mjs run`) and confirms that job's VM is live, kills ONLY that pid,
// waits (bounded) for it to end, and confirms the VM remains: a real orphan for preflight to prove
// and clean. No pgrep-by-name kill, no wildcard, no other pid. Prints one JSON line; exit 0 only
// when an orphan was really produced.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { flockHolders, isLauncherRun, isVmFor, JAIL_ID } from "./conformance-lib.mjs";

const LOCK = "/var/lib/everstreet-worker/lifecycle.flock";
const jail = process.argv[2] ?? "";
const done = (o, code) => {
  console.log(JSON.stringify(o));
  process.exit(code);
};
if (process.getuid?.() !== 0) done({ ok: false, reason: "run as root (test-only procedure)" }, 2);
if (!JAIL_ID.test(jail)) done({ ok: false, reason: "a jail id es-<12 hex>-<attempt> is required" }, 2);
const cmd = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "latin1");
  } catch {
    return null;
  }
};
const vms = () =>
  readdirSync("/proc")
    .filter((d) => /^[0-9]+$/.test(d))
    .map(Number)
    .filter((pid) => isVmFor(cmd(pid) ?? "", jail));

const holders = flockHolders(readFileSync("/proc/locks", "utf8"), statSync(LOCK).ino);
if (holders.length !== 1) done({ ok: false, reason: "not exactly one lock holder", holders }, 1);
const launcher = holders[0];
if (!isLauncherRun(cmd(launcher) ?? "")) done({ ok: false, reason: "the lock holder isn't the launcher's run", launcher }, 1);
const before = vms();
if (before.length !== 1) done({ ok: false, reason: "this job's VM isn't live (or isn't unique)", launcher, vms: before }, 1);
process.kill(launcher, "SIGKILL");
const end = Date.now() + 5000;
while (cmd(launcher) !== null && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
const gone = cmd(launcher) === null;
const after = vms();
done(
  { ok: gone && after.length === 1, launcher, killed: gone, vm_before: before, vm_after: after, jail },
  gone && after.length === 1 ? 0 : 1,
);
