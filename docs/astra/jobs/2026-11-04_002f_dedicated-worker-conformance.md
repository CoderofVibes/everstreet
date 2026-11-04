# Provision and verify the approved dedicated execution host

P0/M-L, explicit dispatch after003v acceptance. One Claude writer only. Read ASTRA,
PLATFORM_VISION, EVERSTREET_UI_DIRECTION, EXECUTABLE_PRODUCTS, WorkerHostSetupProposal and
HostLifecycleCorrectionsAccepted. All work stays within Tony's exact approved proposal.

## Authorization and outcome

Tony answered **"Approve dedicated worker setup"** to creating `Everstreet-Worker` at
`C:\Dev\EverstreetWorker`, official free downloads, restricted worker permissions and bounded
synthetic isolation tests, with an8 GiB disk ceiling and the documented memory stop thresholds.
The full question and scope are recorded in WorkerHostSetupProposal. No new approval is needed
for those exact actions. A materially different host, resource budget or system-wide change
requires a separate decision. Astra never signs, deploys or makes Git writes.

Deliver an actual tested worker environment and truthful evidence of the existing adapter,
supervisor and guest boundaries. A setup script or fake-root harness alone does not pass.
The existing worker source is the reviewed002e implementation with002e2 fixes at3b881ef;
inspect the current tree before using it. Do not launch another development writer.

## Bounded procedure

1. Recheck WSL inventory, target path and free resources. Refuse existing Everstreet-Worker or
   nonempty target; no overwrite/adoption. Leave the existing Ubuntu distro, default selection
   and Windows/global WSL settings unchanged. No inspection of other projects.
2. Use the approved official Ubuntu24.04 command with name/location/no-launch. If it needs a
   reboot, global configuration change or different destination, stop this attempt and record
   the exact unmet requirement. Do not use wsl --shutdown or terminate another distro.
3. Disable Windows-drive automount and Windows executable interop in the NEW distro before
   tests. Copy only exact reviewed worker files through a controlled mechanism. Do not copy
   the repository, research, credentials, runtime databases or another distro. Any restart
   needed to apply the new distro's settings is scoped to Everstreet-Worker alone.
4. Check actual prerequisites, including KVM/cgroup/namespace capability. Install only missing
   official packages approved in the proposal. Download only the pinned official worker
   artifacts. Verify published checksums/metadata; calculate and review the kernel/rootfs SHA256
   before filling empty lock fields. A changed source/version/checksum is not silently accepted.
5. Install the reviewed root-owned launcher, two non-login accounts, restricted sudoers/KVM
   access, cgroup/network namespace and boot configuration ONLY inside the new distro. Review
   the exact launcher privilege boundary first. Serialize install/uninstall: the installer itself
   is not lifecycle-lock protected. Keep one owned setup operation and its manifest.
6. Run finite actual conformance via the real adapter/supervisor/guest, using harmless synthetic
   inputs and canary files. Verify useful execution, timeout/cancel, CPU/memory/process/output
   bounds, absence of network and host-file access, and complete cleanup. Show that the engine
   actually ran rather than a test double. No live model calls or platform/customer traffic.
7. Independently inspect resulting cgroups/jails and stop the dedicated distro when idle.
   Record artifacts, exact commands, versions/digests, outcomes, resource peaks and limitations.
   If a concrete implementation defect appears, preserve its reproduction, make a bounded
   correction with tests/review, then one meaningful repeat. No blind retry loops.

## Resource and time envelope

- Hard proposed disk budget:8 GiB across the new distro and staging; measure before expansion
  and stop before exceeding it. This is not permission to delete unrelated files to make room.
- One VM at a time; existing targets256 MiB guest/384 MiB VMM cgroup, one CPU/32 processes,
 160 MiB untrusted-code budget,8 MiB scratch,2 MiB individual file,5 seconds per step/60 per VM.
- Monitor WSL working memory and system availability. Stop the dedicated workload if total WSL
  working memory exceeds4 GiB or free system memory falls below6 GiB. These are supervisory
  stops, not permission to change global WSL memory settings or stop other distros.
- One setup/conformance attempt has a45-minute overall budget. Every subprocess/test gets a
  finite timeout within it. On exhaustion record the exact completed stage and next action,
  stop owned workload safely, and return for review; no automatic second attempt.
- Preserve evidence and use reviewed manifest rollback on failure. Do not unregister the distro
  or recursively delete its Windows target automatically; that destructive action is outside
  this approval. Never compose destructive filesystem commands across shells.

## Acceptance and handoff

- Actual worker execution and boundary evidence, or an exact blocked stage with safe cleanup;
  missing capability must not be relabelled a passing conformance result.
- Required keyless check/web build after repository changes; no signing/deploy commands.
- Exact local commits, report and JOBS review, then STOP. Astra independently reviews the real
  results before accepting002f or enabling the normal app's engine capability.
-001k is next after this bounded attempt, then003w; a host limitation does not erase or stall
  independent Studio/import/network/portfolio work. All six milestones remain open.

Exact `--model claude-opus-5-5 --effort high`, subscription only; no API fallback/budget here.
No push, public hosting/release, mainnet, spending commitments, real customer data, submission,
Day One access or research reading/staging/copying. Never include the private research library
in host staging, commits or reports.
