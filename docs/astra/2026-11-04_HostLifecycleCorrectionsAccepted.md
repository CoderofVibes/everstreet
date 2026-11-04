# Host lifecycle corrections accepted within their tested scope

Astra accepts the bounded002e2 correction at3b881ef (report9170277), allowing003v to proceed.
This is acceptance of the reviewed process/lock and stale-uninstaller corrections. It is not
acceptance of a provisioned worker, actual Node/Firecracker isolation, full002e or M2.

## Independent evidence

- Repeated Astra's original stale-uninstaller probe against the corrected actual setup.sh with
  an unprivileged fake root, a flock barrier and a harmless live holder of the new lock.
  U2 now exits1 and removes nothing; the new directory and manifest survive, and the new holder
  remains alive. After its exit, a fresh uninstall succeeds. Exact temporary root removal is
  asserted. The20-second bounded command completed in5.69seconds, exit0.
- Independently ran the reviewed lock-primitive-harness.sh on Ubuntu, uid1000, util-linux2.41.3,
  under timeout150 (exec74135). Exit0, zero failures. Actual kernel/process checks cover the
  old separate-holder failure, same-process exclusion and exit, inheritance, shared uninstall
  exclusion, stale launcher and stale uninstaller refusal, and retry after interrupted teardown.
  The optional OLD setup.sh negative-control case was skipped in this independent harness run;
  Astra's earlier independent reproduction and this repeat provide the before/after evidence.
- The harness uses a harmless shell/sleep supervisor in place of host-launch.mjs. Actual Node
  descriptor behavior, root/sudo entry and Firecracker/jailer remain unverified host gates.
- Exec39663 finished exit0 at9170277. Exact-session process check found no remaining writer.
  After the independent probes, WSL running-distribution inventory was empty, matching its
  prior state. No other distribution was terminated by Astra. No preview remains.

## Remaining installation constraint

The report explicitly identifies that install does not take the lifecycle lock. Installation
and uninstallation must not overlap. Preserve this limitation in the real-host setup review;
do not claim generalized concurrent provisioning safety. Host installation and conformance
still require a concrete reviewed setup decision. No provisioning, downloads, root operations,
VMs, model calls, signing or NEAR actions were performed in these independent checks.

Next:003v protected customer storage, then001k executable Studio composition and003w application
integration, with004b/005c/005d/006a and all six milestone gates retained. Astra changed this pass,
INDEX,JOBS and ignored BUILD_STATE; earlier003v caller-review paths remain for Claude's review
and local commit. Stable full-check outcome is recorded in BUILD_STATE.
