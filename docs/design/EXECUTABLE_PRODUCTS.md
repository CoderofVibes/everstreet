# Executable products: generated web app bundles, isolated checks, preview (job 002e)

Claude, 2026-11-04. Authority: [002e](../astra/jobs/2026-11-04_002e_executable-product-path.md).

Inputs:
- [WorkerHostCapabilities](../astra/2026-11-04_WorkerHostCapabilities.md);
- [WorkerSetupReview](../astra/2026-11-04_WorkerSetupReview.md);
- [ExecutableDesignReview](../astra/2026-11-04_ExecutableDesignReview.md). Its browser canary
  showed that an opaque-origin module preview fails under the headers first proposed here (§6).
  This revision corrects §1, §2, §5, §6, §7 and §8.

**Status words:**
- **implemented and tested:** with labelled doubles;
- **implemented, never run on a real engine:** the adapter, launcher and guest;
- **proposed host setup:** not performed.

No engine has been installed or booted. Isolation is **unverified** until the conformance suite
(§7) runs on an authorized host.

## 1. What a founder gets

1. **"Generate a web app" in Studio.** It is a build job with intent `app` that returns
   `web_app_bundle/1`: a small versioned file bundle for a browser-only, single-page app (the
   first one is a fictional print-shop quote calculator). It uses the same budgets, cancel, retry,
   fencing and recovery as every build. No provider means "not connected", with no spend.
2. **Validation on the platform.** Every bundle is parsed, rebuilt, statically checked and hashed
   (§2). Nothing in it executes on the platform host.
3. **"Run logic checks in an isolated worker".** A separate, deterministic, unpaid job against
   that exact digest (§3–5).
   - **States:** Passed, Failed, Unavailable (no verified engine: nothing ran), Unknown (outcome
     lost) or Cancelled.
   - **What it proves:** it checks the bundle's **logic modules** (§2). It is **not** a browser or
     UI check.
4. **Preview (§6).** A sandboxed iframe from a separate site and a capability URL.
   - **Ordinary Preview opens the newest version whose logic checks passed.**
   - **Unchecked versions:** a version without passed checks can be opened only through an
     explicit "Open unchecked preview" with a warning. It is never the default, and never
     presented as the product because the engine is missing.
   - **What a preview proves:** the founder sees and uses the app's real UI. A preview proves
     nothing about isolation.
5. **Versions.** Every succeeded `app` job is an immutable version. A *current version* is an
   append-only pointer.
   - **Change:** a new `app` job carries the current bundle and the founder's words.
   - **Compare:** a file and line diff.
   - **Restore:** move the pointer back; nothing is rewritten.

| Word | Means |
|---|---|
| Generated | a bundle passed platform validation |
| Logic checks passed | the isolated worker ran recipe `web_app_checks/1` on that digest; every case's value, compared by the trusted supervisor, matched; engine identity recorded |
| Preview | the app runs in your browser, sandboxed, from a separate site |
| Released | not in this job: customer release of web apps is later; extraction releases are untouched |

## 2. `web_app_bundle/1` (`server/src/appBundle.ts`)

An explicit JSON file list, never an archive:

```
{ kind: "web_app_bundle", schema_version: 1, name, description,
  files: [{ path, text }],                       // media type from the extension, never the model
  checks: [{ id, label, module, export, input, expect }] }
```

- **Paths:** lowercase `^[a-z0-9][a-z0-9_-]{0,39}(/[a-z0-9][a-z0-9_-]{0,39}){0,2}\.(html|js|css|json)$`,
  unique, with `index.html` required, at most 24 files. That excludes absolute paths, `..`,
  backslashes, links, devices, case collisions and hidden files.
- **Text:**
  - well-formed (no lone surrogates);
  - NFC;
  - no BOM, NUL or controls except tab, LF and CR;
  - 64 KiB per file, 256 KiB in total, 320 KiB for the canonical JSON.
- **Static refusals.** These are early refusals, not the boundary:
  - references in HTML `src`/`href`/`action`/`srcset`/`poster`/`data`, CSS `url()`/`@import` and
    JS `import`/`export … from` must resolve to bundle files;
  - dynamic `import()`, inline scripts, inline styles, `on…=` handlers, `javascript:`, `iframe`,
    `object`, `embed`, `base` and `meta http-equiv` are all refused.
- **Module contract.** The recipe never imports browser modules in Node:
  - **Logic modules:** a check's `module` must be a *logic module*. It exports pure functions and
    touches no DOM or browser globals at load or call time. It is imported only in the worker.
  - **UI modules:** every other `.js` file. These are *parsed* (syntax only, never executed) by
    the worker.
  - **The first supported app** splits its pricing into `quote.js` (logic, checked) and `app.js`
    (UI, parsed only).
  - **UI behaviour** is shown in Preview and reviewed there. Automated in-browser journey checks
    are not in this slice and are never claimed.
- **Digest:** SHA-256 of canonical JSON (sorted keys). Provenance is as for `extraction_spec/1`.

## 3. Build contract change (`build.ts`, `builds.ts`, `anthropic.ts`)

- **Intent:** `intent ∈ {build, propose, app}`. The intent fixes `outputSchema`
  (`app → web_app_bundle/1`) and is in the request fingerprint, along with `base_job` and
  `instructions`.
- **Validation:** each intent has its own validator; `app` accepts only `web_app_bundle`. The
  output bound for `app` is 320 KiB; others stay at 64 KiB.
- **Change requests:** `base_job` must be a succeeded `app` job of the same project, and its
  bundle reaches the provider as data.
- **Anthropic adapter:** has the `app` schema, with check values as JSON text parsed back by
  `reshapeApp`. No live call has been made.
- **Records:** generation records (`build_jobs`, `build_artifacts`) and execution records
  (`app_checks`) are separate. A check retry never touches a generation.

## 4. Logic checks: orchestration (`server/src/appChecks.ts`)

`app_checks`: one row per request.
- **Identity:** project, business, artifact job, digest, recipe, owner id and generation,
  requester, idempotency key and fingerprint.
- **Lifecycle:** engine identity at dispatch, state, attempt, lease, `dispatched_at`, deadline,
  bounded result, measured usage and failure.

```
queued ─claim─► running ─preflight fails─► unavailable          (nothing ran)
                   │ dispatch recorded
                   ├─valid bound report, all pass ► passed
                   ├─valid bound report, a fail ──► failed
                   ├─engine error / bad report ──► failed (worker_error | invalid_report)
                   ├─cancel / deadline ──────────► cancelled | failed(timeout)
                   └─restart after dispatch ─────► unknown (never re-run automatically)
```

- **Fences:** attempt, lease and live state on every write. The owner epoch is rechecked before
  dispatch and before applying. A changed owner gives `cancelled (ownership_changed)` and the
  late output is dropped.
- **Report binding:** the report must name the check id, attempt, digest, recipe and engine
  identity it was asked for. Otherwise it is `invalid_report`; so is a duplicate or a bad shape.
- **Scope:** one worker, one running check platform-wide. No model call and no spend.

## 5. Engine: Firecracker microVM with its jailer

### Pinned identities (`scripts/worker-host/worker.lock.json`)

| Component | Exact identity | Provenance |
|---|---|---|
| Firecracker and jailer | `firecracker-v1.17.0-x86_64.tgz`, sha256 `06094a1108ae9e82aa4c23a775aa92758f53f1175d422270d9d6162cb9ade558` | release v1.17.0 `.sha256.txt` (fetched 2026-11-04). Binary names inside are checked at fetch. |
| Guest kernel | `firecracker-ci/20261028-84df49062576-0/x86_64/vmlinux-6.1.188`, size 45064368, S3 ETag `a1be6c8d192c2e816fb841e49fcfd70e-6` | official CI bucket `spec.ccfc.min` (listing 2026-11-04). sha256 recorded by `fetch` for review. |
| Guest base root filesystem | `…/x86_64/ubuntu-24.04.squashfs`, size 108503040, ETag `6e31666e67adbee77a60d49d04d93aea-13` | same bucket and snapshot; sha256 recorded by `fetch` for review |
| Guest runtime | `node-v24.22.2-linux-x64.tar.xz`, sha256 `48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75` | Node.js v24.22.2 LTS "Krypton" `SHASUMS256.txt` (2026-11-04) |

- **Where the values came from.** They were read through a fetch tool on 2026-11-04.
  `setup.sh fetch` re-downloads each official checksum file and refuses any mismatch with the
  lock.
- **No sha256 for the kernel and root filesystem yet.** The CI bucket publishes none. `fetch`
  verifies the exact key, size and ETag, then prints the sha256. A reviewer records it in the
  lock before `install` will run; `install` refuses a lock with empty digests.
- **The built guest image's digest** is recorded by `install` and checked by every preflight.

### Topology

```
platform (Windows Node) ── spawn fixed argv ──► wsl.exe -d <distro> -u everstreet-runner --
    sudo -n /opt/everstreet-worker/bin/launch {preflight | run | cleanup}
        stdin: ≤ 400 KiB job JSON          stdout: ≤ 64 KiB report JSON
```

The model chooses none of this. Sudo covers one root-owned script, three verbs and nothing else.

### Host-side limits: the VMM process only

The jailer runs with:
- `--cgroup-version=2 --parent-cgroup everstreet-worker`, with explicit `--cgroup` values for
  `memory.max=402653184` (384 MiB: guest RAM plus VMM overhead), `pids.max=32` and
  `cpu.max=100000 100000`;
- `--new-pid-ns --netns /var/run/netns/everstreet-none`;
- `--resource-limit fsize=2097152`.

These bound **the host's Firecracker process tree and its files**, not anything inside the guest.
Before any input is attached, the launcher verifies:
1. the live pid's `/proc/<pid>/cgroup` path;
2. each limit file's value.

A mismatch, or a missing parent (the jailer's fail-open trap), refuses the job with
`limits_unverified`.

### Guest-side limits: enforced by the guest kernel

| Limit | Value |
|---|---|
| VM | 1 vCPU, 256 MiB RAM, no network device |
| root filesystem | read-only |
| input drive | raw, read-only |
| output drive | raw, 1 MiB, **owned by root, mode 0600** |

- **The supervisor** (`/opt/everstreet/supervisor.mjs`, root, pinned Node) creates a guest
  cgroup v2 `untrusted` with `pids.max=32`, `memory.max=160M` and `cpu.max=100000 100000`.
- **The working directory** is a separate `tmpfs` at `/work`, `size=8M,nr_inodes=512`, mounted
  `nosuid,nodev,noexec`.
- **Every untrusted step** runs as uid 1000 `app` (no capabilities, `no_new_privs`) inside that
  cgroup, with `RLIMIT_NPROC=32`, `RLIMIT_FSIZE=2M` and a 5-second per-step kill.
- **A fork bomb or tmpfs fill** stops at these guest limits. The host limits above only bound the
  VMM.

### Report integrity: untrusted code never holds the reporter's authority

- **The supervisor runs as root and owns everything that matters.** It holds the job binding
  (check id, attempt, digest, recipe), the output drive (0600 root), the per-case expected values,
  the comparisons and the engine identity it was given by the host.
- **The untrusted step can't write the output drive.** It runs as uid `app`.
- **Each case is a separate process**, `case-runner.mjs` as `app`. It imports *only* that case's
  logic module, calls the export with the input, and prints exactly one bounded JSON line: the
  returned value.
- **The supervisor reads that line itself** (at most 8 KiB, first line only) and compares it with
  `expect`. The runner never sees `expect`.
- **What a dishonest module can do:** change only the value of its own case, which is exactly the
  behaviour under test. It can't mark another case passed, forge the engine identity, or write
  the report.
- **Syntax checks** run as `app` in separate processes: `node --check` on each `.js` treated as
  an ES module. They parse and never execute.
- **Outside the threat model:** a guest-kernel privilege escalation would let code forge the
  report. The microVM still protects the host. A "passed" is evidence about honest or buggy code,
  not a proof against a guest exploit, and it never proves a later preview can't abuse browser
  resources.

### Launcher run steps

1. Validate the job.
2. Write the length-prefixed input drive and create the output drive.
3. Hard-link the pinned kernel and guest image into a fresh jail.
4. Start the jailer (`--daemonize`).
5. Verify cgroup placement and limits.
6. Configure through the API socket: boot source, machine config and drives, with no network
   interface.
7. Start the VM, with a wall deadline of 60 s that kills the pid group.
8. Read and strip the output drive's report, at most 64 KiB.
9. A `trap` always removes the jail and the cgroup. `cleanup` and every `preflight` remove stale
   `es-*` leftovers.

**One run at a time, and cleanup only of proven orphans** (after Astra's
WorkerImplementationReview):
- **The run lock.** A run takes `/var/lib/everstreet-worker/run.lock` holding its pid, process
  start time and jail id.
- **Preflight.** It answers `busy` while that process lives and touches nothing. It cleans only
  orphans: a lock whose process is gone, and `es-*` leftovers with no live run.
- **Cleanup.** It kills the job cgroup and must confirm it empty before removing it and the
  jail. If it can't confirm, it keeps both as evidence, keeps the lock and fails. The platform
  worker then admits nothing until a preflight succeeds.
- **Signals.** SIGTERM, SIGINT and SIGHUP clean up before exit. A SIGKILLed launcher leaves a
  stale lock that the next preflight proves orphaned.
- **One identity.** The check id must be a UUID, the attempt 1–999999, and the jail id
  `es-<12 hex>-<attempt>` is derived the same way by the launcher and the adapter.
- **Bounds.** Stdin is bounded and deadlined, hashes are streamed, and every subprocess has a
  timeout.

**Lifecycle exclusion** (002e2, after Astra reproduced the 002e1 form failing on Ubuntu): **the
kernel's flock(2), held by the critical process itself**.
- **Why not a file lock.** A file-based takeover lock was tried first and withdrawn. Astra
  reproduced two contenders both winning in its read-to-stat window, and a displaced owner's
  later refusal comes too late to protect its critical section.
- **Why not `flock -o` (002e1, withdrawn).** With `flock -n -o … host-launch.mjs` the lock lived
  in a SEPARATE flock parent. Killing only that parent freed the lock while the launcher child
  kept running, and a second entrant acquired it (Astra, util-linux 2.41.3; reproduced again by
  case 1 of the primitive harness). The earlier claims that the holder lives as long as the
  launcher, and that every leftover is necessarily orphaned, were false for that form.
- **What holds it now.** `launch` opens the lock file on fd 9 (it never creates it), takes
  `flock -n 9`, then `exec`s the launcher. `exec` keeps the PID and fd 9, so the holder IS the
  critical-section process for exactly its lifetime, and the kernel releases the lock when it
  ends, however it ends. A contender gets "busy" (75) at once.
- **Descendants.** The jailer, which daemonizes Firecracker, is started through
  `sh -c 'exec 9>&-; exec "$@"'`, so no VM process inherits the lock. Short helpers the launcher
  runs (`id`, `setpriv`, `rmdir`, each with a timeout) do inherit fd 9. That can only keep the
  lock held a little longer, never release it early.
- **Pending entrants, uninstall, reinstall: every entrant is fenced.** The lock file is created
  once per installation (install, before the manifest) and unlinked only by a completed uninstall
  that holds the lock. Nothing else creates it, so its inode identifies the installation.
  - **`launch`.** After acquiring, it checks that the inode it holds is still the current lock
    file, and that `installed.json` exists. Otherwise it refuses (69).
  - **`setup.sh uninstall`.** It takes the same lock on fd 9 in its own shell. After acquiring, it
    checks that the inode it holds is still the current lock file, and that the manifest exists.
    Otherwise it refuses and removes nothing. It never creates a lock file; if one is missing it
    refuses. It then removes everything recorded and unlinks the lock file WHILE still holding it.
  - **Why the uninstall fence (Astra, 002e2 review, final section).** An uninstall (U2) can open
    the file and then be delayed before locking. Meanwhile another uninstall (U1) completes, a
    reinstall makes a new inode, and a launcher holds the new lock. U2 then locks the OLD inode
    and, unfenced, removed the NEW installation while its holder lived. Harness case 6 shows the
    pre-fix `setup.sh` doing exactly that, and the fenced one refusing.
  - **Failure and repeat.** A failed uninstall keeps its records and the lock file, releases the
    lock when its shell exits, and can be repeated.
  - **Not fenced: install itself.** Install does not take the lifecycle lock. Two installs are
    excluded only by the conflict check and a non-`-p` `mkdir` of the state directory. An
    uninstall started while an install is still running is not excluded; that needs the operator
    not to overlap them (an open point for review).
- **Orphans.** While a preflight holds the lock, no launcher process is alive. Any `es-*`
  leftover belongs to an ended launcher, though its VM may still be RUNNING (fd 9 closed), and
  preflight cleans it. A run refuses to start over leftovers ("preflight first").
- **Verified with real processes (002e2):** `scripts/worker-host/lock-primitive-harness.sh`. It
  ran unprivileged on existing WSL Ubuntu (util-linux 2.41.3) through the real `launch` (non-root
  test hooks) and the real `setup.sh uninstall` (fake root), with a harmless stand-in supervisor
  and `sleep` children. It covers:
  - the old `-o` form violating the invariant;
  - two entrants;
  - SIGKILL and normal release;
  - wrapper failure versus a critical-child failure;
  - an inheriting daemon (hazard shown) versus an fd-closed daemon;
  - uninstall exclusion;
  - pending entrants after uninstall and after reinstall;
  - an interrupted and then repeated uninstall;
  - uninstall refusing without a lock file;
  - Astra's stale-uninstaller sequence: the pre-fix `setup.sh` violates the invariant, and the
    fenced one refuses and leaves the new installation and its holder untouched.

  `server/test/worker-lock.test.ts` runs it on Linux and is skipped on Windows. This is NOT
  engine conformance.
- **Pending on the real host:** the root path through sudo, and conformance cases 9 (busy during
  a run), 10 (a killed launcher leaves an orphan that is cleaned) and 11 (only the outer sudo is
  killed).

**The platform worker side** (after Astra's AppCheckLifecycleReview):
- the lease is renewed on every poll tick from claim to end;
- a cancel is checked in the transactional dispatch gate and before an outcome is applied;
- every engine call is hard-bounded whether or not it settles;
- an unconfirmed cleanup blocks claims.

**The host never mounts a guest-written filesystem.** It parses at most 64 KiB, and nothing the
worker writes chooses a host path.

## 6. Preview boundary (corrected after Astra's canary)

- **Separate site.** Studio frames `previewOrigin` (local: `http://localhost:<port>` while the
  platform is opened at `http://127.0.0.1:<port>`; production: a distinct registrable domain). A
  cross-site frame is eligible for the browser's out-of-process iframe isolation. **Whether the
  parent stays responsive is not proven.** Astra checks it with a *finite* busy canary; never an
  infinite loop on Tony's machine.
- **Capability token.** `POST /api/product-projects/:id/app-versions/:job/preview` (owner only)
  returns a 256-bit token.
  - **Stored:** only its SHA-256, with the digest, the owner epoch and an expiry of 30 minutes.
  - **Authority:** that version's files and nothing else.
  - **Checked on every request:** the token's owner epoch against the business's current one. A
    sale, expiry or another version gives 404.
- **Document** `GET /preview/app/:token/index.html`:
  - `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src <origin>/preview/app/<token>/; style-src <same>; img-src <same> data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors <platform origin>`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
  - No cookies are read for authority and none are set.
- **Subresources** (`.js`, `.css`, `.json`). An opaque-origin document fetches module scripts in
  CORS mode with `Origin: null` and no credentials. They are served with
  `Access-Control-Allow-Origin: *` (never with credentials), `Cross-Origin-Resource-Policy:
  cross-origin`, `nosniff` and `no-store`. Exposure is bounded by the token: one version's own
  files, for 30 minutes, under the current owner. Astra's canary showed this pair loads modules
  where `same-origin`/no-CORS failed. The real route is re-verified in the browser.
- **Iframe.** `sandbox="allow-scripts"`, with no `allow-same-origin`, popups, top navigation,
  forms, modals or downloads, and `referrerpolicy="no-referrer"`.
- **Navigation.** The sandbox does **not** stop the frame navigating itself, so:
  - static refusals keep the bundle's own links and forms local;
  - CSP `connect-src 'none'` blocks fetch, XHR and WebSocket;
  - single-page only: Studio counts the frame's `load` events, and any load after the first
    removes the frame with "The preview tried to open another page and was stopped". It does not
    claim the navigation never started.
- **Messages.** Only `{everstreet_preview: 1, type: "ready"}` from that frame's `contentWindow`,
  with origin `"null"`. Everything else is ignored, and the parent sends nothing.
- **Browser resources.**
  - **No quota.** Sandbox, CSP and Stop are not CPU or memory limits. A preview runs only when
    asked, and Stop removes the frame **if the page can still run**.
  - **What the logic checks don't cover.** They are no evidence the UI code is resource-safe.
  - **Making abuse unlikely.** Ordinary Preview opens checked versions, and unchecked preview is
    an explicit, warned choice.

## 7. Conformance suite (`scripts/worker-host/conformance.sh`, authorized host only)

Each case runs through the real launcher, and the results go to `conformance-<date>.json` with
the lock identity.

**Evidence rules** (after Astra's WorkerImplementationReview):
- **A probe counts only if it ran.** The report must be complete and bound, with exactly the
  declared cases, and the probe case *passed*: it returned the exact expected structured
  observation.
- **Never evidence:** an import failure, a timeout, a missing case or an unavailable engine.
- **Self-test first.** The helpers are checked against negative controls before any run.
- **The harness has its own bounds:** its own deadline, output limit and spawn-error handling.
- **Additional cases:**
  - synthetic host and other-job canary files;
  - per-file (`RLIMIT_FSIZE`) and aggregate (tmpfs) limits tested separately;
  - a busy preflight during a finite live run;
  - a real orphan proven and cleaned.
- **002e1 corrections:**
  - **Pure rules.** The evidence rules live in `conformance-lib.mjs`.
    `node conformance.mjs --self-test` runs only the negative controls and exits before any
    launcher or host call. Whole-report corruptions void every claim; a per-case corruption voids
    only that claim (Astra reproduced the old self-test failing).
  - **Canaries.** Both are real synthetic files, created and confirmed to exist under
    `/var/tmp/everstreet-conformance-*` (outside the jail base, so never orphan-scanned), and
    removed at the end.

The cases:
1. **Benign:** the quote calculator, all cases pass, plus the measured `memory.peak`.
2. **Canary:** a synthetic host canary file, and another job's drive, are not visible.
3. **Network:** `10.0.2.2`, `169.254.169.254` and a public IP all fail (no NIC).
4. **Guest memory:** a logic module allocating past 160 MiB is killed by the guest cgroup; the
   VM and host stay up.
5. **Guest processes:** a module spawning children is refused (no `child_process` beyond
   `pids.max`); the host pid budget is untouched.
6. **Guest tmpfs:** writing past 8 MiB in `/work` fails, and the report is still produced.
7. **Report forgery:** a module prints a fake whole-report envelope and tries to open
   `/dev/vdc`. The open fails with EACCES, the forged envelope is just that case's (wrong) value,
   and other cases are unaffected.
8. **Time:** a module looping forever is killed at 5 s per step, and the VM at 60 s.
9. **Host VMM limits:** a finite stress of the VMM stays under `memory.max`, and cgroup files are
   read back.
10. **Cancel and orphan:** kill the launcher mid-run; `cleanup` and preflight leave no `es-*`.
11. **Fail-open trap:** remove the parent cgroup; preflight gives `limits_unverified` and no VM
    starts.

### 7.1 First real host run (job 002f, 2026-11-04)

**Host.** The dedicated `Everstreet-Worker` WSL2 distro at `C:\Dev\EverstreetWorker`:
- Ubuntu 24.04.5 LTS, kernel 6.18.54.1-microsoft-standard-WSL2, WSL 3.0.3.0;
- systemd, cgroup v2, `/dev/kvm` present (nested virtualization);
- Windows-drive automount and interop disabled.

Tony approved this host in WorkerHostSetupProposal. Evidence is in `data/evidence/002f/`.

**Two defects were found on the real host and corrected:**
- **The KVM ACL can't be relied on.** `/dev/kvm` is tagged `uaccess` (systemd's
  `70-uaccess.rules`), so systemd-logind rewrites its ACL on every session change. That removed
  the `everstreet-vm` entry after the first run, and the readiness probe (setpriv as
  `everstreet-vm`) then refused every later run: run 1, 3/15.
  - Access never came from that ACL. The jailer creates its own `/dev/kvm` node in each chroot,
    owned by the jailed uid.
  - Readiness now checks that the host node is a real KVM device (10:232) that root can open.
    Run 2 booted every VM with the ACL entry absent.
  - Setup still adds the ACL. It is redundant and transient, and should be dropped in review.
- **Reinstall skipped a removed package.** `dpkg -s` succeeds for a removed package with
  remaining config ("deinstall ok config-files", which our uninstall leaves), so the reinstall
  skipped `acl` and failed at `setfacl`. The manifest rollback removed the partial install
  exactly. Installed now means `install ok installed`.

**Run 2 (13/15, real Firecracker VMs through sudo, `launch` and the lifecycle lock):**
- **Passed:**
  - preflight;
  - the benign app (VMM peak 120 MB);
  - host and job canaries absent, and the drives closed to the case;
  - no network;
  - guest processes bounded;
  - per-file and aggregate tmpfs bounds;
  - the bundle tree immutable;
  - report forgery contained;
  - the 5-second step limit;
  - a busy preflight during a run;
  - case 11 (outer sudo killed: exercised, busy while the launcher lived);
  - no leftovers at the end.
- **Failed: guest memory.** The bound held: the untrusted peak was exactly 167,772,160 bytes
  (`memory.max`), the VMM peaked at 267 MB, under 384 MiB, and the next case ran. But the step
  was stopped by the 5-second timer, not killed by OOM, and the case requires a kill signal.
  Whether to accept "held at the limit, then stopped" is a criterion decision for review.
- **Failed: orphan proven and cleaned. No orphan was produced.** Ubuntu's `Defaults use_pty`
  puts the launcher in sudo's pty session, so the harness's process-group kill reaches only
  sudo. The launcher finished and cleaned up normally (`removed: []`). Real-orphan cleanup is
  **unverified** on this host. The harness needs a way to kill the launcher itself.

**The fail-open trap (run by hand afterwards).** With the parent cgroup removed, preflight
refused ("cgroup parent everstreet-worker is missing") and no Firecracker started. Restarting the
boot unit restored it, and preflight was ok again.

**Third defect, open (found by that check, not corrected in 002f).** At every distro boot (three
reproduced), the unit's write of `+cpu +memory +pids` to the new cgroup's `subtree_control`
fails with `I/O error`. The unit fails, so the netns isn't created and preflight refuses ("cgroup
parent lacks cpu …"). A manual `systemctl restart everstreet-worker-host.service` two seconds
later succeeds.
- **Impact:** it fails closed, but after a restart the worker isn't ready until the unit is
  restarted.
- **Likely cause:** boot ordering against systemd's own controller setup (not proven).
- **Candidate fix (needs review):** order the unit after systemd's setup, or retry the write.

**Not run:** a full host-VMM stress (§7 case 9). Isolation is evidenced only for the cases that
passed above.

## 8. Host setup (approved for the dedicated distro; performed in 002f, see §7.1)

`scripts/worker-host/setup.sh`, run by root with each phase separate:

- **`check`.** Changes nothing. Lists what is present.
  - **Commands:** `curl`, `sha256sum`, `tar`, `xz`, `unsquashfs` (squashfs-tools), `mkfs.ext4`
    (e2fsprogs), `setfacl` (acl), `ip` (iproute2), `visudo` and `sudo`, `useradd`, `userdel`,
    `groupdel`, `install`, `ln`, `timeout`.
  - **The host:** `/dev/kvm`, cgroup2 controllers, an existing `everstreet-*` state, and the
    distro and kernel.
- **`fetch <dir>`.** Downloads only into `<dir>`. Verifies the official checksum files and the
  lock's sizes and ETags, and prints sha256 values for review. No system change.
- **`install <dir>`.** Requires a lock with every digest filled in. Each step is appended to
  `/var/lib/everstreet-worker/manifest`:
  1. `apt-get install` of only the missing packages from the `check` list, recorded by name;
  2. create `everstreet-runner` and `everstreet-vm` (no login, no home);
  3. `setfacl -m u:everstreet-vm:rw /dev/kvm`, plus a systemd unit re-applying it at boot (both
     recorded);
  4. the cgroup `everstreet-worker` with `+cpu +memory +pids`;
  5. the network namespace `everstreet-none` (created by a unit, recorded);
  6. `/opt/everstreet-worker`, root-owned, 0755, holding the binaries, the guest image built from
     the pinned root filesystem plus Node plus guest files, and the lock;
  7. `/etc/sudoers.d/everstreet-worker` (0440, checked with `visudo -cf`):
     `everstreet-runner ALL=(root) NOPASSWD: /opt/everstreet-worker/bin/launch`.
- **`uninstall`.** Reverses **only the manifest's entries**, in reverse order. It removes packages
  only if the manifest says setup installed them, and never touches pre-existing users,
  packages, ACLs or Tony's account.

**Revised after Astra's WorkerImplementationReview:**
- **Conflicts first.** `install` refuses if any target already exists: the users, the paths, the
  unit, the sudoers file, the cgroup, the netns, the ACL or the manifest. Nothing is adopted.
- **Recorded before created.** Each resource is recorded in the manifest *before* it is
  created, so a failed install is removable.
- **Safe uninstall.** It refuses while a run lock exists or a job cgroup has processes. It
  removes entries one at a time, newest first, dropping each from the manifest only once
  removed, and is safe to repeat.
- **Fake-root harness.** `setup-harness.sh` runs all of this in a temporary fake root with
  logging shims for every system command: read-only check, conflict refusal, an interrupted
  install, repeat uninstall, refusal under a run lock, and a clean full cycle. It proves
  bookkeeping only, not the real commands.
- **002e1 corrections:**
  - **Confirmed removal.** Uninstall confirms each removal: the item is absent, or no longer
    enabled or installed. Otherwise the record and everything older stays, and uninstall fails.
  - **Conflicts.** Dangling symlinks and annotated `ip netns list` output count as conflicts.
  - **Locking.** Uninstall takes the lifecycle flock. Since 002e2 it holds the lock in its own
    shell and unlinks the lock file while holding it; see Lifecycle exclusion.
  - **The harness.** It is stateful (users, ACLs, units, packages, netns). It saves its baseline
    before the install it removes, and covers installs interrupted at each privileged step, a
    retained record on a failed removal, and live and dead locks.
  - **Harness run.** It **was run** in 002e1 (Git Bash, a temporary fake root, shims only): all
    checks passed.
    - Dangling symlinks were skipped: that filesystem has none.
    - `install` was shimmed, so modes were logged rather than applied: NTFS can't hold Linux
      modes.

Decisions for Tony, after Astra's review:
- a dedicated distro (recommended) or the existing Ubuntu;
- the package list and the sudoers line;
- approving the downloads;
- the kernel and root-filesystem sha256 once `fetch` has printed them.

## 9. Not in this job

- **Releases and runtime:** customer release of web apps; backends for generated apps;
  dependencies or npm packages.
- **Checks:** automated in-browser UI journey checks.
- **Live model generation** without a configured budget.
- **Proof still outstanding:** real-engine conformance and browser verification, both pending.
