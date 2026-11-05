# Proposed dedicated local execution host

Status: Tony approved the exact setup below on November4 with **"Approve dedicated worker setup"**.
Installation was performed under bounded job002f. Actual conformance was partial13/15; the
dedicated distro is stopped and the engine remains disabled pending002f1 corrections. See
WorkerConformanceReview and the002f report. This approval is already exercised; do not reinstall
or ask for the same setup approval again.

The approved question explicitly named the dedicated Everstreet-Worker WSL environment at
C:\Dev\EverstreetWorker, free official dependencies, restricted worker permissions, bounded
synthetic isolation tests,8 GiB disk ceiling and memory stop thresholds. Approval covers that
concrete proposal, not public hosting, provider spending, transactions or global system changes.

## Decision requested

Approve Claude creating a dedicated WSL2 instance named `Everstreet-Worker` at the new path
`C:\Dev\EverstreetWorker`, downloading the free official dependencies described below, installing
the reviewed execution worker there, and running finite synthetic isolation/conformance tests.
Astra reviews the evidence. This authorizes local system setup in that instance, not public
hosting, paid services, model-provider spend, NEAR transactions or any release.

The exact source candidate is worker scripts at3b881ef plus the reviewed follow-up documentation.
The bounded lifecycle corrections passed independent tests; actual worker isolation remains
unverified until the real conformance run. Any substantive change required by failed host tests
gets a bounded implementation/review cycle before it is exercised again.

## Why a separate instance

Existing WSL inventory contains `Ubuntu`. Leave its packages, users, settings, files and default
selection alone. Use a fresh official Ubuntu24.04 LTS instance for Everstreet's service accounts,
KVM permissions, cgroup and namespace configuration. Do not export/copy the existing distro or
inspect other projects. This still shares WSL's underlying kernel/resources; it is not a promise
of a separate physical machine or a hard total-memory limit.

The installed WSL help supports --name, --location and --no-launch. The online catalog lists
Ubuntu-24.04. Canonical documents custom instance names with24.04 in its
[instance management guidance](https://ubuntu.com/wsl/docs/stable/howto/manage-and-configure/).
Proposed initial command, NOT RUN:

```
wsl --install Ubuntu-24.04 --name Everstreet-Worker --location C:\Dev\EverstreetWorker --no-launch
```

Refuse an existing instance or nonempty target path; never overwrite/adopt either. If installation
requires a reboot, a Windows-wide configuration change or a different target, stop for that
specific decision instead of applying it implicitly. Do not change the default distro or global
WSL memory/kernel/network settings. Disable Windows-drive automount and Windows executable
interop in this dedicated instance before testing; stage only the exact reviewed worker files
through a controlled copy, not the repository, research, credentials or other project trees.

## Local changes and downloaded artifacts

- Official Ubuntu24.04 WSL base plus only the missing Ubuntu packages needed by setup.sh:
  curl/coreutils/tar/xz-utils/squashfs-tools/e2fsprogs/acl/iproute2/sudo/passwd/util-linux/systemd/
  dpkg, as applicable. Record the actual missing list before installing. No paid subscriptions.
- Pinned Firecracker/jailer1.17.0 and Node24.22.2 archives, official kernel6.1.188 and Ubuntu24.04
  guest filesystem snapshot, with URLs/checksums/size/ETags in scripts/worker-host/worker.lock.json.
  Verify official archive checksums and snapshot metadata; calculate and review kernel/rootfs
  SHA256 values before Claude fills the empty lock fields and installs. Any mismatch stops work.
- Two non-login Linux service accounts: everstreet-runner and everstreet-vm. Only the VM account
  receives the planned KVM device ACL. Create the specific Everstreet cgroup, empty network
  namespace and boot unit described in EXECUTABLE_PRODUCTS, within the new distro.
- Install root-owned worker files and a1GiB guest image under /opt/everstreet-worker; state under
  /var/lib/everstreet-worker; disposable jails under /srv/everstreet-jail.
- One restricted sudoers entry permits everstreet-runner to invoke the root-owned launch wrapper,
  which validates its three verbs. This is a real local administrative permission change and is
  why this step needs an explicit decision. It grants no general shell or platform credentials.

## Resource and verification envelope

Read-only Windows snapshot November4:31.7GiB total RAM,17.4GiB free;70.3GiB free onC:. These values
change and must be checked again before setup. Proposed disk budget:8GiB across the dedicated
instance and staging. Stop if the proposed download/expansion would exceed it; no silent increase.
The exact official base-image download size is not yet observed, so this is a ceiling, not an
assertion that installation has been measured to fit.

One check VM at a time:256MiB guest memory,384MiB VMM cgroup ceiling, one CPU,32 processes; guest
untrusted code160MiB,8MiB scratch,2MiB individual files,5seconds per step,60seconds per VM. These
are implementation targets that conformance must prove, not already verified physical limits.
WSL/kernel/filesystem cache and installer overhead are additional. Monitor host memory; stop
the dedicated test workload if total WSL working memory exceeds4GiB or free system RAM falls
below6GiB. This is a supervisory stop policy, not a global WSL hard cap. Do not stop other distros.

Run each conformance attempt under a finite outer deadline, preserve failure evidence, confirm
empty worker cgroups/jails afterward, and stop the dedicated instance when not testing. No idle
service loop, model calls or live customer traffic. Independently verify the real adapter,
supervisor, limits, no-network/no-host-file properties and cleanup before enabling app integration.

Install and uninstall must be serialized: install itself is not lifecycle-lock protected. A
single owned setup operation is required; no overlapping automation. Existing manifest rollback
records govern removal of worker resources. If setup fails, retain evidence and use reviewed
rollback; do not unregister the distro or recursively delete its Windows directory automatically.
Removing the entire new instance would be a separate explicit destructive action if needed.

## Scope and next action

No setup/download/image execution was performed in preparing this proposal. No credentials,
runtime databases, research-library content or other-project files were read. Astra changed this
proposal,INDEX and ignored BUILD_STATE only; no script/config/Git writes. After Tony's answer,
record it and dispatch a bounded Claude host job at a safe single-writer boundary. Storage,001k,
003w and the entire six-milestone roadmap continue while that decision is pending.
