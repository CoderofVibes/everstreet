# 002f1 worker readiness corrections: stage 1 (design and repository)

November 5, 2026, Claude, under Tony's direct build mandate. **Stage 1 only:** repository changes
and finite host-free tests. No worker host was started, installed or changed. Stage 2 (a real-host
run) needs Astra's explicit dispatch of a reviewed host step under Tony's existing
Everstreet-Worker authorization. The isolated worker engine stays disabled in the composition.

## 1. Boot readiness

**Diagnosis.** The old boot unit wrote `+cpu +memory +pids` into the new parent's
`cgroup.subtree_control` immediately. The kernel answers EIO/EINVAL there while the parent
doesn't offer a controller yet, and three real boots failed that way. A later manual restart
worked, which points to availability/ordering, not to systemd timing as such.

**Change.** The unit runs `/opt/everstreet-worker/bin/cgroup-ready` (written by `setup.sh`,
removed with `$ROOT`), with `TimeoutStartSec=60`. It:
- waits, under a finite deadline (30 s, `EVERSTREET_CGROUP_DEADLINE_S`), until the
  everstreet-worker parent's `cgroup.controllers` offers cpu, memory and pids;
- writes them, then reads `cgroup.subtree_control` back strictly;
- otherwise exits 1, naming what was missing or what was read back. The unit fails, so
  preflight fails closed.

It writes only inside everstreet-worker: never the root cgroup, another distro or WSL's global
configuration.

**Evidence (fake root, `setup-harness.sh`):**
- the unit runs the script and no longer writes controllers directly;
- missing controllers fail by the deadline, naming them;
- a readback that isn't the kernel's form (a plain file echoing `+cpu`) is refused.

**Unverified:** the success path on a real cgroup v2 parent, and boots of the worker distro.

## 2. Memory evidence

**Intended property.**
- The untrusted cgroup is capped at 160 MiB, read back exactly, with swap 0.
- Exceeding the cap ends the step within a bounded time.
- The next step still runs.

**Diagnosis of run 2.** The supervisor reported any SIGKILL as "Took longer than 5 seconds".
The kernel's OOM killer also sends SIGKILL, so run 2's "stopped after 5 seconds" may have been an
OOM kill that was mislabelled. This is a hypothesis until a host run shows the events. The failed
run stays preserved as recorded.

**Changes.**
- `guest/supervisor.mjs`:
  - a timeout is now only the supervisor's own timer;
  - each case carries its `memory_events` delta (max, oom, oom_kill), from the cgroup's
    `memory.events` read before and after;
  - the report carries the bound's readback (`limits.memory_max`, `limits.swap_max`). Missing or
    unparsable values are null, never zero.
- `conformance-lib.mjs memoryClaim`: the case holds only with a complete bound report, the
  readback exactly 167772160 and swap 0, a finite peak within the bound, finite non-negative
  events, a step that did not pass, and the next case observed. It then names its kind:
  - `oom_kill`: oom_kill rose and the step was SIGKILLed, not by the timer. **Proves:** the
    kernel's OOM killer enforced the guest cap.
  - `held_at_ceiling_then_timed_out`: `max` events rose and the timer stopped the step.
    **Proves:** the kernel held allocation at the cap and termination was bounded by time. It
    does **not** prove an OOM kill.

  A timeout alone, or SIGKILL without oom_kill, holds nothing. No budget was raised.
- Negative controls (`memorySelfTest`, run first by `conformance.mjs`, refusing to start on any
  failure), 18 cases: missing, nonfinite, negative, over-bound, mismatched or `max` evidence;
  swap allowed; the step passing; the next case failing; another job; no report.

## 3. Actual orphan

**Diagnosis.** Case 10 killed sudo's process group. Ubuntu's `use_pty` puts the launcher in
another group, so the launcher survived and run 2's `removed: []` proved nothing.

**Change.**
- `test-orphan.mjs` is TEST-ONLY and root-only. `setup.sh` never installs it and no production
  sudoers entry grants it. Given this job's jail id, it:
  1. finds the single FLOCK holder of `lifecycle.flock` by inode in `/proc/locks`;
  2. requires that holder's cmdline to be exactly `node host-launch.mjs run`;
  3. requires exactly one live Firecracker with `--id <jail>`;
  4. SIGKILLs only that pid and waits, bounded to 5 s, for it to end;
  5. confirms the VM remains.

  It never uses `pgrep` by name, wildcards or any other pid.
- Case 10 uses the procedure only when the dispatched step provides it (`EVERSTREET_TEST_ORPHAN`,
  run with `sudo -n`). It then requires preflight's `removed` to include exactly that jail, with
  no leftovers. Without it the case records `exercised: false` and does not pass.
- Case 11, the surviving-launcher busy branch, is unchanged and keeps its own `exercised` flag.
- The pure rules (`flockHolders`, `isLauncherRun`, `isVmFor`) are unit-tested against waiters,
  POSIX locks, other inodes, near-miss command lines and other jails.

**For the dispatched step:** install `test-orphan.mjs` beside the suite as root. Add a temporary
test-only sudoers line for exactly that command, and remove it after the run.

## 4. Host VMM bound

The launcher reads the VMM cgroup's `memory.max` back before each VM start. That is a readback,
not enforcement. No conformance case can pressure the VMM's own memory without changing guest
protections or host limits, so the suite now records "host VMM memory bound enforced under
pressure" as **false, exercised: false**, and the suite can't pass until a reviewed method runs.

**Proposed method (for review, not implemented):**
1. A dedicated, test-only launch variant sets the jail VMM cgroup's `memory.max` below the
   guest's configured RAM plus VMM overhead, only for that one jail.
2. A guest case touches guest memory up to its own (unchanged) guest cap.
3. Pass only if that jail's `memory.events` shows oom_kill and the launcher reports the VM ended
   by the host bound. The next normal job must run with the normal bound read back.

## 5. Redundant host KVM ACL

The pinned jailer creates the VMM's own `/dev/kvm` node inside each jail, so `setup.sh` no longer
sets an ACL on the host's `/dev/kvm` or its boot unit, and `acl` left the package list. Rollback
compatibility is kept:
- an installed old manifest's `acl` record still uninstalls through the unchanged branch, while
  `setfacl` is still present: that install also recorded the `acl` package, removed after it;
- a leftover everstreet-vm ACL is still a conflict where `getfacl` exists;
- the launcher's device and root-open preflight is unchanged.

Harness evidence: a new install makes and records no ACL, and an earlier manifest's ACL rolls
back exactly.

## Status

| Correction | Repository | Host evidence |
|---|---|---|
| 1 boot readiness | implemented, fake-root tested | pending (dispatched host step) |
| 2 memory evidence | implemented, rule + negative controls tested | pending |
| 3 actual orphan | implemented (test-only procedure), rules tested | pending; needs the temporary test-only grant |
| 4 host VMM bound | gate made explicit; method proposed | not designed for execution yet |
| 5 KVM ACL | removed with rollback kept, fake-root tested | pending (reinstall + rollback of the old manifest) |
