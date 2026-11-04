# 002f Dedicated worker conformance: report

Job: `docs/astra/jobs/2026-11-04_002f_dedicated-worker-conformance.md`.

Authority: Tony's "Approve dedicated worker setup" for the exact WorkerHostSetupProposal.

**Commits:**
- `3d23839`: Astra's eight handoff paths, committed after `npm run check` passed.
- `8c8599a`: the lock digests, two host corrections, the design §7.1 and the evidence in
  `data/evidence/002f/`.

**Status: in review. A partial real result, NOT engine acceptance.** Run 2 passed 13 of 15 real
cases; two gates failed and one boot defect is open.

## Timeline and resources (one attempt, about 13 of its 45 minutes)

| Time (PT) | Stage |
|---|---|
| 14:58 | Inventory: only `Ubuntu` (Stopped), target absent. 17.9/31.7 GiB RAM free, 75 GB disk free, no WSL VM running. WSL 3.0.3.0. |
| 14:58–14:59 | `wsl --install Ubuntu-24.04 --name Everstreet-Worker --location C:\Dev\EverstreetWorker --no-launch`: ok in 40 s. The default distro stays `Ubuntu`. |
| 14:59–15:00 | `/etc/wsl.conf`: systemd kept, `[automount] enabled=false mountFsTab=false`, `[interop] enabled=false appendWindowsPath=false`. Only `Everstreet-Worker` was terminated and restarted. Afterwards there was no `/mnt/c` and no drvfs mount. (Interop probe below.) |
| 15:00 | Ten reviewed files copied as a tar stream on stdin. Their sha256 were identical on both sides; the source is `3b881ef`. Nothing else was copied: no repository, research, keys or databases. |
| 15:01 | `setup.sh check`: only `acl` missing; cgroup2 with cpu, memory and pids; `/dev/kvm` present; no conflicts. |
| 15:01 | `setup.sh fetch`. Firecracker v1.17.0 and Node v24.22.2 matched their official checksum files and the lock. The kernel and rootfs matched the pinned size and ETag, and I **recomputed the S3 multipart ETags from the bytes (8 MiB parts): both match**. Then sha256 kernel `50048e55…77e0c1` and rootfs `568127fd…dc56d9` went into the lock. |
| 15:02 | `setup.sh install` (serialized, one operation). Preflight through `sudo -n launch` was ok. A bogus verb gave `usage`, and `sudo` for anything else asked for a password. `--self-test` was ok. |
| 15:02–15:03 | **Conformance run 1: 3/15** (KVM ACL defect, below). |
| 15:04 | The real `setup.sh uninstall` removed exactly the manifest. **Reinstall failed** (package defect, below), and the **manifest rollback removed the partial install exactly**. |
| 15:05 | Reinstall with both corrections; preflight ok. |
| 15:05–15:08 | **Conformance run 2: 13/15.** |
| 15:09–15:10 | Independent leftover inspection; the fail-open trap checked by hand (with restore); a boot defect found. Distro stopped. |

**Resources:**
- **Memory.** The supervisor sampled 170 times, every 2 s, from 15:02:49 to 15:09:12. Peak WSL
  working set 3.75 GiB (stop at 4); minimum free RAM 13.91 GiB (stop at 6). No stop was triggered.
- **Disk.** The target is 2.6 GiB (stop at 8). The distro root uses 2.4 GiB: `/opt` 884 MB and
  the downloads 185 MB.
- **Final state.** Both distros stopped, the default unchanged. No `es-*` cgroups, jails or
  Firecracker processes, and the canaries are removed.

**Interop.** It is configured off. A harmless 2-byte "MZ" stub made `/init` try a host vsock
connection that was never accepted (accept4 timeout 110), and nothing ran. No Windows drive is
mounted and no Windows path is on PATH. I can't prove more than that.

## Defects found on the real host

1. **The KVM ACL can't be relied on (corrected).**
   - **Cause.** `/dev/kvm` is tagged `uaccess` (`70-uaccess.rules:48`), so systemd-logind rewrote
     its ACL on the sudo and runuser session churn. The `everstreet-vm` entry was gone after the
     first run, and the readiness probe refused 12 runs.
   - **Why the ACL was never needed.** The jailer makes its own `/dev/kvm` in the chroot, chowned
     to the jailed uid. Astra independently confirmed this from the v1.17.0 jailer source.
   - **The fix.** Readiness now requires a real 10:232 device that root can open read-write.
   - **Proof.** Run 2 booted every VM with the ACL entry absent (count 0).
   - **Left in place.** Setup still adds the ACL; it is now redundant, and dropping it is for
     review.
2. **Reinstall skipped a removed package (corrected).**
   - **Cause.** `dpkg -s` succeeds for "deinstall ok config-files", which our uninstall leaves,
     so the reinstall skipped `acl` and failed at `setfacl`.
   - **The fix.** The package test now requires `install ok installed`, the same rule as `gone()`.
   - **Checked.** The shim harness still passes 7/7.
3. **The boot unit fails at every distro boot (open, not corrected).**
   - **Symptom.** Writing `+cpu +memory +pids` to the new cgroup's `subtree_control` gives
     `I/O error`, three boots reproduced. The netns is then not created, and preflight refuses
     until a manual `systemctl restart everstreet-worker-host.service`, which succeeds two
     seconds later.
   - **Impact.** It fails closed.
   - **Likely cause.** Boot ordering (not proven).
   - **Why not fixed here.** A fix needs a unit change, a reinstall and a reboot test. I stopped at
     the one bounded correction cycle.

## Run 2 (13/15): real Firecracker VMs through sudo, `launch`, the lifecycle lock and the jailer

Every report is bound to its job, attempt, digest and the real engine identity (Firecracker
v1.17.0, kernel `50048e55…`, lock `b2161fdf…`). The guest image digest differs per install
(`e249…` at the first install, `1788…` at the second): `mkfs.ext4 -d` isn't bit-reproducible,
so the image identity is per installation, recorded in `installed.json`.

**Passed:**
- preflight;
- the benign app (untrusted peak 11 MB, VMM peak 120 MB);
- host and job canaries `ENOENT`, `/dev/vdb` and `/dev/vdc` `EACCES`;
- network: all three targets error;
- guest processes bounded;
- per-file `EFBIG` and aggregate `ENOSPC` bounds;
- the bundle tree immutable;
- report forgery contained;
- the 5-second step limit;
- a busy preflight during a live run;
- **case 11 exercised** (outer sudo SIGKILLed; preflight busy while the launcher lived);
- no leftovers.

**Failed (kept as failures; no criterion relaxed):**
- **Guest memory.** The bound held: the untrusted peak was exactly 167,772,160 bytes, which is
  `memory.max`, the VMM peaked at 267 MB, under the 384 MiB cgroup, and the next case passed.
  But the step was ended by the 5-second timer, not an OOM kill, and the case requires a kill
  signal. Likely reclaim thrash at the limit (not proven).
  - **Decision for review:** accept "held at the limit and stopped" with the peak evidence, or
    change the guest limits (e.g. `memory.oom.group` or a `memory.high` margin) so it is killed.
- **Orphan proven and cleaned. No orphan was created.** Ubuntu's `Defaults use_pty` keeps the
  launcher out of sudo's process group, so the harness's group kill hit only sudo. The launcher
  finished and cleaned up normally (`removed: []`). Real-orphan recovery is **unverified**; the
  harness needs to kill the launcher process itself.

**Run 1 (3/15)** is kept as evidence of the KVM defect: everything after the first VM was
refused before boot, which is not a boundary result.

**Manual fail-open trap.** With the parent cgroup removed, preflight refused ("cgroup parent
everstreet-worker is missing …") and no Firecracker started. Restarting the unit restored it,
and preflight was ok.

**Not run:** a full host-VMM stress (design case 9). The limit values are read back before every
VM start.

## Repository checks

- `node --check` passes, and `conformance.mjs --self-test` passes.
- The shim setup harness passes 7/7.
- **`npm run check`:** exit 0, lint and types clean. 1181 passed and 1 skipped, across 124 passed
  and 1 skipped files; the Linux-only harness test is skipped on Windows.
- **`npm run web:build`:** 871.93 kB, unchanged.

## Left as is, and next

- **The host.** `Everstreet-Worker` stays registered and stopped, with the corrected worker
  installed (manifest at `/var/lib/everstreet-worker/manifest`). I did no unregister and no
  deletion of the Windows target.
- **Next (reviewed corrections, then one bounded repeat):**
  - the boot unit;
  - the memory criterion or limits;
  - the orphan harness;
  - dropping the ACL.
- **Then 001k, then 003w.** All six milestones remain open, as do 004b, 005c, 005d and 006a.
- **Not done:** no provider calls, spending, transactions, deployment, push, global WSL change,
  or change to the existing Ubuntu. Research was never read or copied.
- **Astra's files.** `WorkerConformanceReview` and the INDEX edit are untouched and uncommitted.
