# Evidence to review before accepting the actual worker

002f is active as sole Claude exec24602. Tony approved the exact dedicated-host proposal;
this note adds no host, budget, permission or roadmap scope. Previous pass progressed with003v
acceptance and002f dispatch. This pass verified the live process and reviewed the launcher,
guest init, conformance suite/helpers and EXECUTABLE_PRODUCTS section7 without changing them.

## Observed setup baseline

Independent read-only snapshot before installation:17.81 GiB free RAM,74.05 GiB free disk,
no VmmemWSL working memory, EverstreetWorker target absent, and only the existing Ubuntu distro
registered and stopped. Claude committed the8 handoff paths in3d23839 and has started the
approved dedicated installation command. Installation success is not yet observed.

## Do not infer more than the actual cases prove

- Inspect raw bound reports, successful benign execution and the observed resource fields.
  A setup success, parser self-test, unavailable engine, missing probe or timeout does not
  demonstrate isolation. The conformance helpers correctly require a complete report naming
  the exact job, attempt, digest and case set.
- The current conformance case11 (killing only the outer sudo) records `exercised:false` if
  the critical launcher does not remain alive. Its aggregate pass can still be true in that
  branch. Read this field explicitly and report that branch unexercised; do not call the
  real sudo/launcher lifetime scenario proven merely because the summary prints PASS.
  The earlier unprivileged primitive harness is separate evidence with a narrower scope.
- EXECUTABLE_PRODUCTS section7 includes the missing-parent-cgroup fail-closed test. The
  conformance.mjs footer explicitly leaves that test to a root/manual step. The automatic
  suite alone therefore does not cover it. Within Tony's approved new-distro-only synthetic
  tests, verify the exact safe setup/restore procedure before doing that step, or record it
  as unverified. Never disturb another distro's or another workload's cgroup.
- Separate the five-second case deadline, sixty-second VM bound, host VMM cgroup limit and
  harness outer deadline. A failure at one layer does not prove every other layer was exercised.
  The launcher reads back memory/pids/CPU limits before InstanceStart; inspect actual outcomes.
- Match downloaded artifacts and installed executable/image digests to the reviewed lock and
  manifest. Copying scripts or filling a lock field is not proof the running engine matches.
- Inspect all owned leftovers: jails, job cgroups/processes, temporary conformance canaries and
  staging, along with final disk/memory measurements. Stop the dedicated distro when idle.
  Preserve the approved resource ceiling and failure evidence; no automatic unregister.

No new failure has been alleged from source alone. These are concrete acceptance checks for
the actual run, not permission to repeat a passing suite indefinitely or expand the45-minute
attempt. If host prerequisites or resources prevent execution, preserve that evidence and
advance001k/003w and other independent roadmap work without calling M2 complete.

## Installation observations during the active run

The dedicated distro is now registered and running; the existing Ubuntu remained stopped at
the independent inventory check. Read-only inspection of /etc/wsl.conf confirms systemd on,
Windows-drive automount/mountFsTab off, Windows interop and Windows PATH append off. The mount
query showed the normal read-only /usr/lib/wsl/drivers share, no Windows drive mount. /dev/kvm
exists as a character device with mode660; this alone does not prove VM execution.

Installed Node reports v24.22.2. Independent SHA256 readings:

- Kernel:50048e55ab43115ef4798830cc8a8cde675f1d4d925b2450dcdb96ca5f77e0c1, matching the filled lock.
- Firecracker:99ad0f5cd0514a88aad0e9ae8cfdb3cc3b4ab9d190e1194602406c786b5de7a5.
- Jailer:65ef226e96f0ceda55ba643f445801ef2cc0ea667ef67cad8ac4f406c9c8434f.

The two binary hashes match installed.json. That manifest lists guest-image hash
e249386a3fb53cef967904201317102929a3ebfa332f8fd14dea3679d38d46ab; Astra has not independently
hashed the full guest image during the active run. These observations do not substitute for
reviewing the official download verification and real conformance results.

Observed snapshots progressed from1.50 to2.42 GiB WSL working memory, with15.29 GiB free system
RAM at the latter reading and71.54 GiB free disk. Top-level files in the dedicated Windows
target total2.45 GiB; that measurement is not an accounting of every staging location. Values
are point observations, not a claim of captured peak usage. The actual suite is now running
as everstreet-runner under Claude's15-minute outer deadline. No engine acceptance yet.

Required check29685 passed lint/types and1181 tests with one Linux-only skip (125 files).
Do not rerun broad checks solely for these evidence annotations; final repository changes and
the actual conformance outcome determine the next verification step.

Astra added this note and INDEX, and updated ignored BUILD_STATE only. No scripts/config,
host settings, runtime data, keys, Git writes or research were touched by Astra. Claude owns
the approved installation and any implementation corrections.

## Actual-host corrections under review, 15:08 PT

Claude reported the first run refused the host KVM ACL after a session change. The corrected
preflight checks the host character device identity (10:232) and root read/write open instead
of requiring the jailed user to open the host node. Astra independently reviewed the pinned
[Firecracker v1.17.0 jailer source](https://raw.githubusercontent.com/firecracker-microvm/firecracker/v1.17.0/src/jailer/src/env.rs):
it enters the chroot before creating its own KVM node and assigns that node to the configured
VM identity. This supports the correction's access-path reasoning; it does not independently
prove the reported systemd ACL rewrite or successful VM execution. Other launcher confinement
checks remain in the reviewed diff.

The real uninstall/reinstall then exposed a package detection error: dpkg can report removed
packages with retained configuration. The setup diff now requires the installed status string
when the command is missing. Claude reports serialized rollback/reinstall and shim harness7/7;
those shim results remain distinct from actual engine proof. The corrected real preflight is
reported successful and the bounded suite is running again in the original24602 session.

Independent15:08 PT point snapshot: WSL working3.16 GiB, free RAM14.39 GiB, free disk71.41 GiB,
dedicated target top-level files2.54 GiB. These remain below the observed stop thresholds but
are not peak readings or complete staging accounting. No separate Astra VM/test was launched.
Final checks must cover the changed launcher/setup and fresh actual suite, including the
conditional/manual cases noted above. The original45-minute attempt budget still applies.
## First real suite outcome: partial, not accepted

Claude's actual run printed13/15 passing. A benign app executed with a bound report from
Firecracker, and canary/network/file/process/time checks passed. Case11 explicitly recorded
exercised:true with busy during the surviving launcher, resolving that conditional branch for
this run. Two gates failed: guest memory termination and proven orphan cleanup. The allocation
case reached167772160 bytes (160 MiB), then hit the five-second deadline; its following benign
case passed. This supports a measured ceiling but does not establish the expected OOM-kill
mechanism. The orphan check returned removed:[] and no leftovers, so it did not prove that a
live orphan was created and recovered. Neither failure may be relabeled a full pass simply
by relaxing expected text. Preserve the original evidence and review any correction precisely.

The fresh report's guest-image identity is178877af57dec85f160217007f5a9a0840c5c7248e136f2e5fbf9396df059b47;
the earlier installation's image hash above is historical. This is read from Claude's actual
tool result, not an independent full-image hash by Astra. Claude has begun dedicated-host
cleanup/stop. Final report/checks and resource accounting remain under review.

## Completed attempt reviewed at8c8599a / report b1acd40

24602 ended exit0; the attempt is complete, engine acceptance remains withheld. Astra inspected
the saved run2 JSON directly: actual canaries existed, probe passed in the guest, memory case
and orphan case failed as described, case11 exercised:true. Claude's manual missing-parent
test refused before starting a VM, then restored readiness. It also reproduced a boot-unit
failure three times: controller setup returns I/O error until a later manual restart. Its
cause is not yet proven. This is a new concrete repair item, not permission to retry blindly.

The saved memory log records170 samples, peak WSL3.75 GiB and minimum free RAM13.91 GiB over
15:02:49-15:09:12. This is Claude's sampled interval, not monitoring of every setup/manual step.
Independent final inventory shows both Ubuntu and Everstreet-Worker stopped with Ubuntu still
default. Free RAM16.57 GiB and WSL working1.22 GiB at that observation; do not claim immediate
zero WSL memory after termination. Claude's final disk measurement is2.6 GiB within the8 GiB
envelope. Raw cleanup observations and report show no owned jails/cgroups/Firecracker/canaries.

Final code check/build succeeded:1181 tests plus one Linux-only skip, web871.93 kB. No app/UI
code changed, so no new browser acceptance was needed for this host-only attempt. This pass
independently reviewed source and recorded evidence; it did not run a second host suite.

Next is001k Studio canvas, then003w composition, as already directed. The report's suggested
host-corrections-before001k sequence is superseded by this explicit handoff. Retain002f in
review and queue a bounded correction design for boot readiness, memory enforcement evidence,
actual orphan creation/recovery, redundant host ACL and missing VMM stress. Do not enable the
normal app's engine on the strength of13/15. A future host attempt needs an explicit reviewed
dispatch with the same local scope/resource ceilings; no automatic repeat from this pass.

