# 002e1 Executable review corrections: report

Claude, 2026-11-04. Job: [002e1](../jobs/2026-11-04_002e1_executable-review-corrections.md).

## Commits

| Commit | Content |
|---|---|
| `fe37405` | Astra's 15 files |
| `a4a12c9` | Studio: acknowledged-job reload, phone compare, preview controls |
| `00408f8` | worker: conformance self-test, canaries, rollback, harness |
| `1cd34e4` | worker: exclusion by kernel flock (file lock withdrawn after Astra's two-winner reproduction) |

## Studio

Astra's AppStudioRecoveryAccepted (browser, `a4a12c9`) accepts the narrow recovery and layout corrections.

- **Acknowledged generation survives a reload.**
  - **Reproduced first.** On the real builds API, both new tests failed on `0da94e6`.
  - **Fix.** The kept record is the unanswered request *or* the acknowledged job. It is forgotten only after a terminal readback or a definite 404.
  - **After a reload,** a recovered job is read first and blocks a new paid generation.
  - **Failed reads** keep it and say so, and "Check progress" stays reachable after the poll limit.
  - **Other scopes** never see it.
  - The same-key lost-answer recovery is unchanged: one job, one provider call.
- **Phone compare.** Implicit `auto` grid tracks grew to the `<pre>`'s longest line. The grids now have `minmax(0, 1fr)` columns and children with `min-width: 0`, and the `<pre>` is bounded to its region. A CSS contract test pins this. Astra measured 375px at 390, with code scrolling internally.
- **Preview controls** (`scripts/preview-app.ts`, `:8859`), each driven in a scenario test:
  - `POST /generation/lose`: the server acts, then its answer is lost;
  - `/reads/fail/<n ≤ 20>`;
  - `/generation/complete`: a queued scripted generation completes only on request.

## Worker host (still never run on a real host)

- **Conformance self-test.** Astra's reproduction is fixed.
  - The evidence rules moved to `conformance-lib.mjs`. Whole-report corruptions void every claim; a per-case corruption voids only its own.
  - `node scripts/worker-host/conformance.mjs --self-test` passes and exits before any launcher or host call. It is also run in a unit test with an empty PATH.
- **Canaries.** Real synthetic files, confirmed to exist before the claim, under `/var/tmp/everstreet-conformance-*`. That is outside the jail base, so they are never orphan-scanned, and they are removed at the end.
- **Exclusion: the kernel's flock(2).**
  - **What failed.** My first file-based takeover lock (`00408f8`) let two contenders both win in its read-to-stat window (Astra's reproduction). It is withdrawn.
  - **Now.** Every launcher verb runs under `flock -n -o -E 75 lifecycle.flock`: busy at once, not inherited by Firecracker, released by the kernel when the launcher ends, however it ends. `setup.sh uninstall` holds the same lock.
  - **Orphans.** While the lock is held, every leftover belongs to an ended launcher. A run refuses leftovers.
  - **Orphan case.** Conformance kills a launcher's whole process group.
- **Rollback.**
  - Uninstall confirms each removal: absent, or no longer enabled or installed. Otherwise it keeps the record and fails.
  - Dangling symlinks and annotated `ip netns list` names (`name (id: N)`) are conflicts.
  - Each resource is recorded before it is created.
- **Fake-root harness: RUN** (`sh scripts/worker-host/setup-harness.sh`, Git Bash, a temporary directory removed on exit, shims for every system command, 74 shim calls logged). All checks pass:
  1. `check` is read-only;
  2. conflicts are refused before any change: path, user, annotated netns. **Dangling symlink: skipped** (`ln -s` makes copies here);
  3. installs interrupted at `useradd`, `setfacl`, `systemctl` and `visudo` are removed exactly, and a repeat uninstall is safe;
  4. a full install places every file and enables the unit;
  5. an unconfirmed removal keeps its record and fails;
  6. uninstall refuses while the lock is held and proceeds once it is free;
  7. the full cycle leaves the fake root exactly at its pre-install baseline (Astra's subshell-baseline bug is fixed).

  **Mutants killed:** confirmation removed, netns whole-line match, uninstall lock removed.

  **Limits:** `install` is shimmed, so modes are logged rather than applied (NTFS can't hold Linux modes). Standard host directories are pre-created, as on any Ubuntu host. **No real package, user, ACL, netns, cgroup, systemd, fetch or VM.**

## Checks

- **Full run.** `npm run check` gave 1161 tests in 123 files, with lint and types clean. `npm run web:build` passed at 871.93 kB, with the existing advisory.
- **New tests:**
  - `web/test/appGenerate.test.ts` (5);
  - `web/test/appLayout.test.ts` (3);
  - `server/test/app-preview.test.ts` (+1);
  - `server/test/conformance-lib.test.ts` (5);
  - `server/test/worker-lock.test.ts` (2, a contract test).

## Pending: not claimed

- **Real host.** Engine isolation, kernel-lock exclusion (conformance 9 and 10), real file modes and real setup commands are all **unverified**. They need Tony's explicit host approval after Astra's review.
- **Studio browser.** Desktop 1280/1440, zoom and reduced motion are still Astra's gates.
- **Not started:** live model generation and full M2. All six milestones stay open, with 003v, 003w, 004b, 005c, 005d and 006a next per Astra.
