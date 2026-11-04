# Worker host implementation review before setup

Reviewed committed5e26b6d while Claude67893 continues002e. No host artifact has been executed,
no privileged setup approved and no engine/isolation proof claimed. These are concrete
corrections before setup review, not an instruction to abandon the full worker/Studio path.
Previous BundleInputReview points are now addressed in source: explicit __proto__ refusal,
digital API estimator, root-owned code tree/separate scratch, guest init set-e and confirmed
guest cgroup cleanup. Actual guest enforcement still requires conformance.

## Conformance must require the operation to run

A finite Node probe evaluated only the exact boolean predicates in conformance.mjs, with
invented response objects. It did not import the launcher or execute any bundle code:

- Canary test passes with `{}` and no report: its missing detail defaults to empty, which
  does not contain `"read"`.
- Network test passes a failed module import whose detail is `module_load_failed: missing
  dependency`, since it lacks `CONNECTED`.
- Forgery test passes with only an unrelated `other` case returning2 against expected1;
  the forge case can be absent. Its printed first line also hides the drive-open result,
  so absence of OPENED in that report proves nothing about drive permission.

Require complete bound reports, exact case identities, completed probe execution and exact
structured negative observations. Missing cases, parse/import failures, timeout and unavailable
engine must never be successful isolation observations. Exercise the assertion helpers with
negative controls. Use actual synthetic host/other-job canary files: absent Windows paths and
guest /etc/shadow aren't evidence that a known host canary or sibling job was inaccessible.
No real host file is needed. The tmpfs test writes20MiB in one file while RLIMIT_FSIZE is2MiB:
prove the8MiB aggregate limit using multiple individually permitted files and separately test
the per-file limit, rather than accepting any refusal as the intended limit.

The suite's launcher promises finite execution but has no independent overall deadline on
ordinary cases, does not drain stderr and has no spawn-error handler. Give the harness its
own deadline/output bounds and verified cleanup on all paths, independent of the code whose
deadline it is testing. A failed engine must not leave the conformance suite hung.

## Host cleanup must distinguish running from stale work

host-launch.mjs cleanupStale currently collects every es-* jail/cgroup and kills it, without
a lease/age/liveness distinction. preflight invokes it. A readiness check must not kill an
active job. Establish a fixed host-side single-worker lock and a verifiable live-run identity;
refuse busy or only clean proved-orphaned jobs. Do not rely solely on one in-process JS worker.
Test a preflight during a deliberately finite running job and a real orphan separately.

cleanup suppresses cgroup.kill/rmdir failures, waits at most5seconds, then removes the jail
and reports success even if the group is populated. Confirm empty/no surviving process before
removing files; surface cleanup failure and retain evidence instead of silently admitting more
work. Handle cancellation and signals explicitly; daemonized Firecracker outlives a killed
Node wrapper unless an independent supervisor/cleanup path terminates it.

Input check_id allows any36 hex-or-hyphen characters and attempt accepts safe integers above
999999; resulting IDs can fail the cleanup ID regex. Example es-123456789abc-1000000 is refused
by cleanup although that attempt is admitted. Derive one validated identity shared by run,
cleanup and adapter; bound attempts and reject malformed UUIDs before resource creation.

## Privileged input and memory bounds

readStdin keeps concatenating input after rejecting oversize input and has no read deadline.
Stop consuming and free/refuse excess input; bound startup and all blocking subprocesses.
The sha helper reads the entire guest image into memory; setup creates a1GiB image. Stream
hashes with a finite byte bound rather than allocate that image on each preflight. Tony has
already experienced high Node RAM use; host-launch memory is outside the VMM cgroup.

## Setup ownership and rollback must match the promise

setup.sh says it preserves pre-existing host resources, but it only refuses an existing
manifest and service users. It overwrites/adopts /opt/everstreet-worker, the service/sudoers
files, /srv/everstreet-jail and existing cgroup/netns names, then records them for deletion.
Preflight every named target before any mutation; refuse conflicts or preserve/restore exact
prior state. Record enough before each mutation to recover a partially failed installation,
including a partially enabled unit/package installation. Repeated uninstall must be safe and
must not discard the manifest while resources/processes remain. Use a finite fake-root/system
command harness to verify conflicts and interrupted steps before proposing actual root setup.

The installer still prints conformance.sh although the committed executable is conformance.mjs;
align commands and installed suite location. No setup/download approval request is ready yet.

## Checkpoint

Only this review, CustomerUnknownBrowser pass, INDEX, screenshots and BUILD_STATE changed by
Astra this pass. No app/script/config/contract or Git changes. Required check recorded in the
checkpoint. The browser preview was separately stopped and cleaned up. Keep003v/003w/004b/
005c/005d/006a and the complete six milestones; research remains unread and local-only.

Independent44237 subsequently passed fullcheck: lint/types and1120tests115files. None of those
checks executed these privileged host artifacts.67893 remains live and is adding app versions.

## Subsequent pass: independent official pin verification

Previous goal pass reproduced two actual AppCheckWorker lifecycle failures, now recorded in
AppCheckLifecycleReview.67893 re-polled live; no new writer or host setup. Read-only official
metadata requests independently confirmed:

- [Firecracker official checksum](https://github.com/firecracker-microvm/firecracker/releases/download/v1.17.0/firecracker-v1.17.0-x86_64.tgz.sha256.txt):
 06094a1108ae9e82aa4c23a775aa92758f53f1175d422270d9d6162cb9ade558, matching the lock.
- [Node official checksums](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt), linux-x64.tar.xz:
 48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75, matching the lock.
- HEAD only, exact official CI snapshot20261028-84df49062576-0: vmlinux-6.1.188 content length
 45064368 and ETag a1be6c8d192c2e816fb841e49fcfd70e-6; ubuntu-24.04.squashfs content length
108503040 and ETag6e31666e67adbee77a60d49d04d93aea-13. Both match the lock.

The web fetch tool could not retrieve the checksum text; bounded PowerShell official HTTPS
GETs retrieved only those small text files in memory, and HEADs retrieved only guest metadata.
No executable/image downloaded, no file installed, no auth/account used and no system changed.
This is reference verification, not image digest verification, trust in a built guest, permission
to provision a host or conformance acceptance. Actual artifact hashing remains for the reviewed
fetch phase. Astra changed only this existing pass and BUILD_STATE in this follow-up; check
result recorded there. All existing implementation corrections and full roadmap gates remain.

## Follow-up: dc7fb09 reviewed, conformance self-test reproduced failing

67893 remains the sole live writer and has moved into the Studio app UI. No host artifact was
executed. The new strict IDs, streamed hashes, bounded stdin, surfaced cleanup failures and
complete-report predicates address substantial parts of the earlier review in source. They
are not yet runtime evidence. Before host setup, finish these concrete corrections:

1. The pure conformance selfTest fails on the committed code. Astra extracted only canon,
   completeReport, observed, failedWith and selfTest into a Node vm with a 1000ms deadline;
   output: `conformance helpers accept non-evidence; refusing to run` (exit1). The negative
   control with p's module-load failure preserves q's legitimate SIGXFSZ result, so failedWith
   for q is correctly true while the loop incorrectly requires it false. Test each corrupted
   case's own claim, and separately test whole-report identity/completeness rejection. Add a
   directly runnable pure self-test entry with no privileged launcher/host calls.
2. The second-job canary path is only a string; no actual other-job file is created. Verify a
   synthetic file exists in the intended host-side location before claiming it cannot be read.
   Do not leave that synthetic fixture liable to the ordinary orphan cleanup scanner.
3. setup-harness step5 runs `before=$( (reset_sys; snapshot) )`. A subshell does not isolate file
   changes: reset_sys deletes the actual fake installation before uninstall is tested. Save the
   clean baseline before the step4 install, then uninstall that still-existing installation.
   Test interrupted stages and retained records on removal failure; running the harness is
   still required before accepting its bookkeeping, not a comment claiming it was exercised.
4. uninstall still swallows unit/netns/ACL removal failures with `|| true`, then deletes their
   manifest entries. Confirm absence or the intended restored state; retain the record and
   fail if removal is unconfirmed. Netns conflict detection should account for `ip netns list`
   output including a namespace id suffix, and path conflict checks should reject dangling
   symlinks as well as existing targets. These are source findings, not executed root tests.
5. The run lock is acquired only by run(), after asynchronous readiness. Preflight/cleanup and
   uninstall do not share an atomic lifecycle lock. A separate run process can acquire the
   lock after a preflight's initial free observation but before its orphan scan, making a new
   live jail appear orphaned. Serialize all destructive lifecycle operations, with lock owner
   validation and a deterministic concurrent interleaving test. The existing 1.5s sleep case
   only covers a preflight arriving after a run is visibly live, not this race.

These corrections can follow the current Studio work without starting another writer. Full
002e acceptance still requires the real host and Studio journey; all six milestones remain.
Astra changed this review and BUILD_STATE only in this follow-up. Check result goes in the
checkpoint; the earlier synthetic sale/access approvals remain authorized and research unread.

##002e1 in-progress lifecycleLock: independently reproduced two winners

The extracted conformance `node scripts/worker-host/conformance.mjs --self-test` now passes
independently and exits before launcher/host calls. That fixes the earlier assertion-helper
failure only; it is not isolation conformance.

The new lifecycle-lock.mjs still violates mutual exclusion. A finite test used the actual module,
one temporary directory, simulated process liveness and an injected filesystem wrapper. No actual
worker/WSL/root resource or real process termination. Sandbox file renames returned EPERM, so the
same bounded test was rerun with approved escalation; its temporary path was verified to be an
immediate child of the temp directory with the expected prefix before recursive cleanup.

Interleaving (even two contenders, not just the comment's three-way residual):

1. Lock belongs to dead pid1. B(pid2) and A(pid3) are simulated live.
2. A's readFileSync obtains pid1's old JSON. Before returning those bytes, the injected wrapper
   calls B.acquire('run','b-live'). B takes over the orphan and succeeds.
3. A resumes with stale owner bytes, then statSync reads B's NEW inode. A moves that same inode
   aside, considers its comparison valid, deletes it, and creates A's lock.
4. Both acquire calls return ok:true/orphan pid1. Current lock belongs to A, B is still live,
   and B.release returns false. Thus a preflight could enter its destructive scan while B runs.

Exact output: bAnswer.ok=true, aAnswer.ok=true, lock.pid=3/purpose=preflight,
bStillLive=true, bCanRelease=false. The existing beforeMoveStale hook tests a later interleaving
after stat, not this read/stat window. Add this earlier window to the regression coverage.

Do not accept the documented live-lock displacement residual as harmless: detecting it when the
displaced owner releases is too late to protect its critical section. Use a proven OS locking
primitive appropriate to the Linux host, or another protocol with actual exclusive ownership
through recovery, shared with uninstall. Validate process/descriptor lifetime, crash recovery
and orphan cleanup without a race-prone unlink/recreate takeover. This is within002e1's existing
scope. No real installation or launcher execution is authorized by this finding.

## 002e1 kernel-lock follow-up: descriptor lifetime needs a real-process check

The in-progress replacement removes the reproduced file-takeover protocol. Before accepting it,
validate the process that actually owns the descriptor. `launch` currently uses `flock -n -o`:
the flock parent owns the lock; its child closes the descriptor before execing Node. The comment
that the lock lasts exactly as long as Node lives is therefore too broad. Killing only the flock
parent can release the lock while Node continues. `host-launch.mjs` then assumes any discovered
jail is an orphan, which depends on that inaccurate lifetime assumption.

This is a source-backed finding, not a new runtime reproduction. The primary
[util-linux implementation](https://raw.githubusercontent.com/util-linux/util-linux/master/sys-utils/flock.c)
forks, closes the descriptor in the child for `-o`, and waits in the parent (lines 462–479 in the
source read November 4). The source contains no parent-death coupling in that path. The actual
installed util-linux version and WSL process behavior remain unverified.

Please use a lock descriptor owned by the process executing the critical section, while ensuring
VM descendants cannot keep it alive after that supervisor ends. Test the real primitive with
finite harmless child processes and a temporary lock, without installing/running the worker:
two entrants; supervisor exit and SIGKILL; lock-wrapper exit independently of child; child spawn
and daemon inheritance; preflight/uninstall exclusion. The fake-root harness's busy-marker shim
proves branching only, not descriptor lifetime or concurrency. Do not claim those from it.

Also review the final uninstall sequence: it closes fd9 before unlinking lifecycle.flock. A
contender can open/acquire the old inode during removal. Define how entry is disabled and pending
entrants are excluded before removing that lock path; do not rely on unlinking a lock to serialize
operations. Account for reinstall too. This remains bounded host-review correction work, with no
real host provisioning, VM, generated-code execution, signing or provider call authorized here.

### Independent real-primitive reproduction (November 4)

Astra subsequently reproduced this on Ubuntu with util-linux 2.41.3, using `timeout 20 sh`,
one mktemp directory under `/tmp/everstreet-flock-review.*`, an eight-second harmless sleep
child, and the same `flock -n -o -E 75` options. No actual launcher, worker install, generated
code, network, keys or system configuration. Before the test no WSL distribution was running.
The command completed in 4.33 seconds with exit0. Exact observations:

```
flock from util-linux 2.41.3
before: busy rc=75
after holder death: original child still alive
after holder death: second contender acquired lock
```

Only the test's recorded flock PID was killed; the original sleep PID was still alive when a
second flock succeeded. The EXIT trap terminated the recorded child, removed the two named
temporary files and removed their directory. Thus this is now real primitive evidence, beyond
the source inference above. It still does not constitute real worker-host conformance. Replace
the separate holder/`-o` lifetime assumption and use this case as a meaningful regression; string
assertions requiring those options cannot establish exclusion.

## 002e2 in-progress uninstall: stale descriptor can remove a reinstallation

Astra independently exercised the actual `setup.sh uninstall` against an explicit temporary
fake root on Ubuntu (no root, package/user/ACL/netns/cgroup/unit changes). The new launch wrapper
checks its held inode after locking; `setup.sh`'s take_lock currently does not. This matters for
an uninstall already waiting before a previous uninstall/reinstall, not just a new launcher.

Deterministic interleaving:

1. Create a disposable fake installation: manifest containing one `dir` under the temp root,
   installed.json and lifecycle.flock. Start U2 through actual setup.sh with a logging/barrier
   flock shim. It pauses after setup opened fd9 but before the real `/usr/bin/flock` acquires it.
2. U1 uses actual setup.sh with ordinary PATH and removes that installation successfully.
3. Recreate the fake installation at the same paths, with a NEW lock inode. A harmless sleep
   process holds the new inode through fd8 and writes a ready marker.
4. Release U2's barrier. It locks its OLD inode, but processes the NEW manifest and deletes the
   new installation, while the new lock holder is still alive.

Exact observations:

```
stale uninstall exit=0; new lock holder still alive=yes
new installation sample directory survives=NO
new installation manifest survives=NO
```

The outer command ran in a20-second envelope and returned in3.91seconds. A final diagnostic cat
failed because the piped command's last line retained a carriage return in its filename; that
occurred AFTER the observations above, making overall exit1. The EXIT trap terminated only the
recorded test process and removed the scoped temp root. A separate exact-path check returned
`temporary-root-removed` with exit0. Do not misreport the full probe as an exit0 check.

Apply post-lock identity/installation checks to EVERY entrant, including uninstall, and cover
this U2/U1/reinstall/new-live-holder sequence with actual primitive evidence. Existing tests of
the launch wrapper's stale inode refusal do not cover a stale uninstaller. Keep failed teardown
retry semantics and exact manifest ownership. This is within002e2, not new roadmap scope. Source
was still being edited; rerun against the final implementation before acceptance.
