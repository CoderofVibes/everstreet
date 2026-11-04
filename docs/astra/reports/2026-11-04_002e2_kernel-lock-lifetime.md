# 002e2 Kernel-lock lifetime: report

Job: `docs/astra/jobs/2026-11-04_002e2_kernel-lock-lifetime.md`.

Commit: `00c7aeb` (code, harness, test and design doc). Astra's dispatch files were committed
first in `63eb5d3`.

Status: **in review**. Real host and engine conformance remain **open**. Nothing ran as root,
and nothing was set up, downloaded or booted.

## What was wrong

Astra was right, and my 002e1 comments were wrong. With `flock -n -o … host-launch.mjs`, the
lock lived in a separate flock parent. Killing only that parent freed the lock while the launcher
child kept running, and a second entrant acquired it. My claims that the holder lives as long as
the launcher, and that every leftover is necessarily orphaned, were false for that form. Case 1
of the new harness reproduces the failure on the same util-linux 2.41.3.

## The correction

- **The lock is held by the critical process itself.** `launch` opens the existing lock file on
  fd 9 (it never creates it) and takes `flock -n 9`. It then `exec`s the launcher: same PID, fd 9
  kept. The holder is the critical process for exactly its lifetime, and the kernel releases the
  lock however that process ends. A contender gets busy (75) at once.
- **The launcher checks it holds the lock.** `host-launch.mjs` refuses to run unless fd 9 is the
  lifecycle lock file.
- **VM descendants never get the lock.** The jailer, which daemonizes Firecracker, starts through
  `sh -c 'exec 9>&-; exec "$@"'`. Short helpers (`id`, `setpriv`, `rmdir`, each with a timeout)
  do keep fd 9. That can only delay release, never release early.
- **Pending entrants, uninstall, reinstall:**
  - After acquiring, `launch` refuses (69) unless the inode it holds is still the current lock
    file and `installed.json` exists.
  - `setup.sh uninstall` takes the same lock on fd 9 in its own shell (no separate holder). It
    removes what the manifest recorded, then unlinks the manifest, `installed.json` and the lock
    file while still holding the lock.
  - Install creates the lock file once.
  - Together, these mean an entrant that opened the file before an uninstall, or before a
    reinstall made a new inode, refuses rather than entering on a stale inode. A failed uninstall
    keeps its records and the lock file, and its shell's exit releases the lock.
- **Orphans, stated correctly.** While a preflight holds the lock, no launcher is alive. An `es-*`
  leftover belongs to an ended launcher, though its VM may still be running; preflight kills it
  and confirms.
- **Corrected text:** comments in `launch`, `host-launch.mjs`, `setup.sh` and `conformance.mjs`;
  the Lifecycle exclusion section of `docs/design/EXECUTABLE_PRODUCTS.md`.

## Evidence: real processes, unprivileged (NOT engine conformance)

**`scripts/worker-host/lock-primitive-harness.sh`** uses:
- the real `launch`, through non-root-only test hooks (`EVERSTREET_LOCK_TEST`; ignored as root,
  and sudo resets the environment anyway);
- the real `setup.sh uninstall`, in a fake root;
- a harmless stand-in supervisor (`lock-test-supervisor.sh`: writes its PID, maybe starts a
  `sleep` "daemon", then `exec sleep`);
- one `mktemp` directory and an outer `timeout 120`.

Every PID it starts is killed on exit, and only if it is still one of ours.

**How it ran:**
- WSL state before: `Ubuntu Stopped`.
- Run as uid 1000: `timeout 120 sh scripts/worker-host/lock-primitive-harness.sh`, twice. The
  second run was after a cosmetic fix to the cleanup's error noise, and it also checked for
  leftovers.
- `wsl --terminate Ubuntu` afterwards. State after: `Ubuntu Stopped`.
- No other distribution or process was touched. There was no sudo, package, ACL, netns, cgroup,
  systemd, download, generated code or VM.

**Second run, verbatim:**

```
flock: flock from util-linux 2.41.3; kernel: 6.18.54.1-microsoft-standard-WSL2; uid: 1000
ok    OLD -o pattern violates the invariant: flock parent killed, critical child alive, a second entrant acquired
ok    the lock holder is the critical process itself (same PID 803; no separate holder)
ok    a second entrant is refused (75, busy) while the critical process lives
ok    SIGKILL of the critical process released the lock (a new entrant was admitted)
ok    a normally ended critical process releases the lock
ok    wrapper failure (no lock file): 69, no critical process started, no lock taken
ok    critical child failure (rc=1, after admission) is reported as its own exit status and releases the lock
ok    hazard shown: a daemon that INHERITS fd 9 keeps the lock after its supervisor is killed
ok    a daemon started with fd 9 closed (host-launch's jailer form) does NOT keep the lock; it remains an orphan for cleanup
ok    uninstall is refused while a critical process holds the lock; nothing removed
ok    uninstall proceeds once the lock is free and unlinks the lock file while holding it
ok    after uninstall an entrant is refused (69, not installed) and starts nothing
ok    an entrant that opened the lock file before uninstall unlinked it refuses on the stale inode (69)
ok    an entrant holding the pre-reinstall inode refuses (69)
ok    a fresh entrant after reinstall is admitted
ok    an interrupted teardown fails, keeps its record and the lock file, and leaves no lock held
ok    repeating the interrupted uninstall completes it
lock-primitive-harness: 0 failure(s); real flock(2) and real processes, unprivileged; NOT engine conformance
harness exit=0
leftover harness processes: none
leftover temp dirs: none
```

The first run had the same 17 ok lines and 0 failures. Its cleanup printed harmless
`cannot open /proc/<pid>/cmdline` messages for processes that had already exited; that is now
silenced.

**What this run does NOT show:**
- the root path through sudo;
- `host-launch.mjs` itself (it needs `/opt` and is stood in for);
- real Firecracker/jailer daemonization;
- conformance.

## Other verification

- **`server/test/worker-lock.test.ts`:** the 002e1 source-shape assertions (which pinned the
  flawed `-o` form) are removed. The test now runs the primitive harness on Linux with flock and
  is **skipped on Windows**, so it is not evidence in this repo's Windows check.
- **`conformance.mjs`:** new **case 11** for the real host. It SIGKILLs only the outer sudo, not
  its group. While the launcher still runs, a preflight must not be admitted, and the case records
  whether that branch was actually exercised (sudo's pty hangup may end the launcher first).
  **Not run.**
- **`node scripts/worker-host/conformance.mjs --self-test`:** all evidence rules hold. It made no
  launcher or host call.
- **`setup-harness.sh`** (Git Bash, fake root, shims only): **all 7 checks pass**, with 74 shim
  calls. Its flock shim models the lock as held or free. The dangling-symlink case is still
  skipped (NTFS).
- **`npm run check`:** lint and types are clean. 1159 passed and 1 skipped (1160) across 123
  files (122 passed, 1 skipped). That is 1161 before, minus the 2 old source-shape tests, plus the
  1 Linux-only test.
- **`npm run web:build`:** 871.93 kB (gzip 239.17 kB), unchanged.

## Still open

- **Real host:**
  - Tony's approval;
  - setup;
  - conformance, including cases 9, 10 and 11;
  - the root path through sudo.
- **Milestones:** all six remain open, as do 003v, 003w, 004b, 005c, 005d and 006a. I did not
  start 003v.
