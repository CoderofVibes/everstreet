# Local worker host capability check

Previous goal pass made progress:001i1 accepted with actual second-sale browser evidence and001j
dispatched. This pass6420 was polled live; it remains the sole customer-composition writer.

To prepare002e's actual isolated execution engine, ran a finite read-only check of existing
Ubuntu under WSL. Beforehand, wsl --list --running showed no running distributions and Ubuntu
was stopped, version2. Started it only for this probe; no install or host configuration changes.

Observed:

- Kernel: Linux6.18.54.1-microsoft-standard-WSL2 x86_64.
- /dev/kvm exists, character device root:kvm, mode0660; current user lacks read/write access.
- command -v found no firecracker, jailer, runsc, docker or podman on that Linux PATH. This is
  a PATH observation, not an exhaustive filesystem inventory or claim nothing is installed.
- unshare and timeout are available under/usr/bin. Their presence does not prove isolation.
- /sys/fs/cgroup is cgroup2fs, and its root is not writable by this user. No delegated subtree
  was inspected, so lack of delegated resource controls has not been proven.
- No KVM ioctl, microVM boot, namespace isolation or resource-limit conformance test was run.

Before cleanup, process-name inventory showed ordinary distro services/session shells and the
probe, no build/project workload. Terminated only the Ubuntu instance started for this check;
WSL confirmed no running distributions afterward. No unrelated project files, credentials,
environment values, runtime databases or research library were opened.

## Implication for002e

The proposed Firecracker/jailer engine is not presently verified usable. It needs an explicit
worker host configuration covering binary/image identities, KVM access, restricted runner
identity, resource-controller delegation and cleanup. Do not silently grant broad access, run
generated code as host root or replace the engine with host Node/plain containers. A present
KVM device is not proof nested virtualization works. Actual finite engine evidence stays required.

Claude can build the artifact/worker/preview integration and prepare a concrete bounded local
setup plan. Any required privileged host changes must be separated and described before action;
do not stall independent implementation or declareM2 complete from protocol doubles. No new
paid service or billing commitment is authorized. All six milestones remain intact.

Changes: this pass,002e brief's environment evidence, INDEX and ignored BUILD_STATE. No app,
scripts/config/contracts or Git writes by Astra.001j's active files were left alone.

Post-doc check exited1 at lint: formatting in Claude's newly in-progress customerView.ts. Types
and tests did not run. This is intermediate moving-tree evidence; leave the file to Claude and
rerun the full check after stable001j completion, not a final customer-job failure.
