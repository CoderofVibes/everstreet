# Keep the execution lock for the entire live critical section

P0/S-M, explicit dispatch after002e1 report5611841. Same Claude session, sole writer,
exact Opus5.5/high subscription. Read WorkerImplementationReview's final two sections and
real-primitive reproduction before editing. Studio a4a12c9 recovery/phone fixes are accepted;
preserve them. This job resolves the host-lifetime defect, not a whole M2 acceptance gate.

## Reproduced failure

On Ubuntu util-linux2.41.3, `flock -n -o -E 75 TEMP_LOCK sh -c 'echo $$ > PIDFILE;
exec sleep 8' sh PIDFILE` holds the lock in its separate flock parent. A second entrant is
initially refused with75. Killing only that recorded flock PID leaves the sleep child alive,
yet a second flock immediately succeeds. Astra independently ran this in a20-second envelope
with one disposable temp directory; cleanup completed and WSL was no longer running afterward.
No worker host was installed or run. See the review for exact output.

Current host-launch assumes free lock means all existing es-* resources are orphans. That is
false when its Node supervisor remains alive after the separate lock holder dies. The existing
string-pattern tests pin the faulty `-o` invocation; they are not concurrency evidence.

## Required correction and acceptance

- Use a kernel lock whose descriptor lifetime covers the actual critical-section process;
  ensure daemonized VM descendants cannot retain it after that supervisor has died. Validate
  the complete launch chain, not just normal return or whole-process-group termination.
- All run, preflight, cleanup and uninstall paths must share mutual exclusion. Define how
  uninstall disables entry and deals with pending entrants before lock-path removal; avoid
  releasing/unlinking/recreating lock inodes while another admitted process can still use one.
  Include reinstall and interrupted uninstall in the reasoning and tests.
- Build and run a finite unprivileged Linux primitive harness using temporary files and harmless
  child processes, with known PID cleanup and an outer timeout. This is authorized on existing
  Ubuntu; no package install, sudo, root setup, kernel/ACL/netns/cgroup/systemd mutation, generated
  code, downloads or VM engine launch. Inspect running WSL state before/after. Do not terminate
  unrelated processes or distributions. Mark the actual test's scope separately from engine
  conformance. Source-shape assertions alone cannot meet acceptance.
- Test two entrants; wrapper failure separately from critical child failure; SIGKILL; child
  inheritance; confirmed release; lifecycle/uninstall exclusion and interrupted teardown. The
  reproduced old case should fail under the invariant and the replacement should pass.
- Preserve fake-root setup rollback/conflict coverage, update its assumptions if necessary,
  rerun that shim-only harness and pure conformance --self-test. Correct design/report comments
  claiming the separate holder always lives as long as Node. Keep real host conformance open.
- Run npm run check and web build; explicit-path local commits, report/JOBS in review, then STOP
  for Astra review. Do not dispatch003v yourself. No expensive repeated broad tests without cause.

Review and locally commit pending Astra docs/screenshots first with the required check, using
only explicitly named paths provided in dispatch. No research access or staging, Git push,
public release, spending/API calls, real data, signing/deployment, mainnet, submission or Day One.
Preserve all six milestones and003v/003w/004b/005c/005d/006a. No duplicate writer.
