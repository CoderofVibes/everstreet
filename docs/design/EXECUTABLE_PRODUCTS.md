# Executable products: generated web app bundles, isolated checks, preview (job 002e)

Claude, 2026-11-04. Authority: [002e](../astra/jobs/2026-11-04_002e_executable-product-path.md).

Inputs:
- [WorkerHostCapabilities](../astra/2026-11-04_WorkerHostCapabilities.md): the observed host;
- [WorkerSetupReview](../astra/2026-11-04_WorkerSetupReview.md): Astra's requirements;
- `BUILD_RUNTIME.md` §8–9, which this replaces for executable products.

**Status words used here:**
- **implemented and tested:** with labelled doubles;
- **implemented, never run on a real engine:** the adapter, launcher and guest;
- **proposed host setup:** not performed.

No engine has been installed or booted. Isolation is **unverified** until the conformance suite
(§7) runs on an authorized host.

## 1. What a founder gets

1. **"Generate a web app" in Studio.** It is a build job with intent `app` that returns
   `web_app_bundle/1`: a small, versioned file bundle for a browser-only app (for example a
   fictional quote calculator). It uses the same budgets, cancel, retry, fencing and recovery as
   every build (BUILD_RUNTIME §3–5). No provider configured means "not connected", with no spend.
2. **Validation on the platform.** Every returned bundle is parsed, rebuilt from checked parts,
   statically checked and hashed (§2). Nothing in it executes on the platform host.
3. **"Run checks in an isolated worker".** This is a separate, deterministic, unpaid job against
   that exact digest (§3–4). It reports Passed, Failed, Unavailable (no verified engine), Unknown
   (outcome lost) or Cancelled. A generation is never re-run because a check needs a retry.
4. **Preview.** A sandboxed opaque-origin iframe served from a capability URL (§6), labelled with
   its check state. The preview runs the app's own code in the founder's browser. That is the
   browser's sandbox, not the worker's, and its limits are stated (§6).
5. **Versions.** Every succeeded `app` job is an immutable version. The project's *current app
   version* is an append-only pointer.
   - **Request a change:** a new `app` job carries the current bundle and the founder's words.
   - **Compare:** a file-level and line-level diff of two versions.
   - **Restore:** move the pointer back to an older version; nothing is rewritten.
   - **Interrupted builds** recover through the existing build recovery.

The words stay distinct throughout:

| Word | Means |
|---|---|
| Generated | a bundle passed platform validation |
| Checks passed | the isolated worker ran the fixed recipe on that digest and every case passed, with the engine identity recorded |
| Preview | it runs in your browser |
| Released | not part of this job: releasing a web app to customers is later work, and existing extraction releases are untouched |

## 2. `web_app_bundle/1` (`server/src/appBundle.ts`)

An explicit JSON file list, never an archive:

```
{ kind: "web_app_bundle", schema_version: 1, name, description,
  files: [{ path, text }],                       // media type comes from the extension, never the model
  checks: [{ id, label, module, export, input, expect }] }   // declarative cases for the recipe
```

- **Paths:**
  - lowercase `^[a-z0-9][a-z0-9_-]{0,39}(/[a-z0-9][a-z0-9_-]{0,39}){0,2}\.(html|js|css|json)$`;
  - so: no absolute paths, `..`, backslashes, drive letters, links, devices, case collisions or
    hidden files;
  - unique;
  - `index.html` is required;
  - at most 24 files.
- **Text:**
  - well-formed (no lone surrogates);
  - NFC;
  - no BOM, NUL or C0 controls except tab, LF and CR;
  - at most 64 KiB per file and 256 KiB in total (UTF-8);
  - the canonical JSON at most 320 KiB.
- **Static references (not execution):**
  - `src`/`href` in HTML and `import`/`from` specifiers in JS must be relative paths to files in
    the bundle;
  - no scheme, `//` or absolute path, so no external scripts, styles, images or fetch targets;
  - inline event handlers (`on…=`) and `javascript:` are refused;
  - CSP enforces the same at runtime (§6). The static check is an early refusal, not the
    boundary.
- **Checks:**
  - 1–20 cases;
  - `module` is a `.js` file in the bundle and `export` an identifier;
  - `input` and `expect` are JSON values of at most 4 KiB each.
  - The recipe calls the export with the input and compares the result for deep JSON equality.
- **Digest:** SHA-256 of the canonical JSON (sorted keys). Provenance is stored as with
  `extraction_spec/1`.

## 3. Build contract change (`build.ts`, `builds.ts`)

- **Intent `app`.** `intent ∈ {build, propose, app}`. The intent fixes `outputSchema`
  (`app → web_app_bundle/1`) and is already in the request fingerprint, so the expected kind is
  part of the request identity.
- **Validation.** The returned kind is validated by the intent's own validator; any other kind
  fails `invalid_output`.
- **Size.** The artifact bound for `app` is 320 KiB; other intents stay at 64 KiB.
- **Change requests.** A change request carries `base_job` (a succeeded `app` job of the same
  project). Its bundle goes to the provider as data.
- **Storage.** Generation records (build jobs and artifacts) and execution records (`app_checks`)
  are separate tables.

## 4. Isolated checks: orchestration (`server/src/appChecks.ts`)

`app_checks` (one row per request):
- **Identity:** project, business, artifact job, digest, recipe id `web_app_checks/1`, owner id
  and generation (the epoch), requester, idempotency key and fingerprint.
- **Lifecycle fields:** engine identity at dispatch, state, attempt, lease, `dispatched_at`,
  deadline, result (bounded JSON), measured usage where the engine reports it, failure code and
  timestamps.

```
queued ─claim─► running ─preflight fail─► unavailable        (nothing ran)
                   │ dispatch recorded
                   ├─report valid, bound, all pass─► passed
                   ├─report valid, a case fails ──► failed
                   ├─engine error / bad report ───► failed (worker_error | invalid_report)
                   ├─cancel / deadline ───────────► cancelled | failed(timeout)
                   └─restart after dispatch ──────► unknown (never re-run automatically)
```

- **Fences.** Every write requires the same attempt and lease and a live state. The owner epoch
  is rechecked before dispatch and before the result is applied. A changed owner makes the check
  `cancelled (ownership_changed)`, and the late output is dropped.
- **Binding.** The report must name the job id, attempt, digest and recipe it was asked for.
  Anything else is `invalid_report`, as are a duplicate report, partial output or an oversize
  output.
- **Concurrency.** One worker; one running check across the platform.
- **Cost.** No model and no spend. A retry is a new request and never touches the generation job.
- **Restart.** Not dispatched goes back to queued. Dispatched becomes `unknown`.

## 5. The engine: Firecracker microVM with its jailer

### Engine and identities

Pinned, recorded in the job's engine identity, and verified at setup and in every preflight:

| Component | Version | Source |
|---|---|---|
| Firecracker and jailer | v1.17.0, x86_64 | release `firecracker-v1.17.0-x86_64.tgz`, checked against its `.sha256.txt` from the same release page. Assets confirmed on the official release page 2026-11-04; the binaries' names inside the archive are confirmed at setup, not assumed. |
| Guest kernel and base root filesystem | a pinned key | the official Firecracker CI artifacts bucket (getting-started guide) |
| Guest Node.js runtime | v24 LTS, a pinned exact version | official `linux-x64` tarball checked against its `SHASUMS256.txt` |

- **Lock file.** The setup writes `worker.lock.json` with every file's SHA-256. The reviewer
  approves that lock file. The adapter refuses any file whose digest differs.
- **Why Node in the guest is acceptable.** The boundary is the VM, not the runtime.

### Topology on this machine

The platform server is Node on Windows. It never runs generated code. The worker side is a
dedicated WSL2 distribution or the existing Ubuntu, used only through a root-owned launcher:

```
platform (Windows Node) ──spawn fixed argv──► wsl.exe -d <distro> -u everstreet-runner --
    sudo -n /opt/everstreet-worker/bin/launch {preflight|run|cleanup}
        stdin : length-limited job JSON (id, attempt, digest, recipe, canonical bundle)
        stdout: length-limited report JSON
```

- **Fixed command line.** The model never chooses any of it, and the platform passes only the
  verb.
- **Narrow sudo.** One root-owned script for three fixed verbs. No other sudo, no
  world-writable `/dev/kvm`, and no change to Tony's account or to `.wslconfig`.

### What `launch run` does

1. Read stdin up to 400 KiB and validate the job JSON.
2. Write the canonical bundle to a raw, length-prefixed **input drive** (read-only), and make an
   empty 1 MiB raw **output drive**. Nothing is mounted on the host.
3. Hard-link the pinned kernel and root filesystem (read-only) and both drives into a fresh jail.
4. Start the jailer with:
   - `--id es-<job>-<attempt>`, `--exec-file` the pinned Firecracker,
     `--uid/--gid everstreet-vm`;
   - `--cgroup-version=2 --parent-cgroup everstreet-worker`, with explicit
     `--cgroup memory.max=…`, `pids.max=…` and `cpu.max=…`, so the fail-open path never applies;
   - `--new-pid-ns --netns /var/run/netns/everstreet-none` (an empty network namespace) and
     `--resource-limit fsize=…`;
   - `--daemonize`;
   - Firecracker started with `--api-sock`.
5. **Before any input**, verify the live Firecracker pid's `/proc/<pid>/cgroup` path and the
   limit files. Mismatch: kill, clean up, report `limits_unverified`.
6. Over the API socket, configure:
   - boot source (`init=/opt/everstreet/init`, read-only root);
   - machine config (vCPUs, memory);
   - the three drives;
   - **no network interface**;
   then `InstanceStart`.
7. Wall-clock deadline: kill the Firecracker pid group.
8. The guest writes its report to the output drive and powers off. Read at most 64 KiB, strip
   the length prefix and print it.
9. A `trap` always removes the jail directory and the cgroup.
10. `launch cleanup <id>` removes a leftover from a crash. It runs from preflight for any stale
    `es-*`.

### Guest

- **`/opt/everstreet/init`.** Mounts `proc`, `sys` and a size-limited `tmpfs`. Reads the input
  drive, writes the files into the tmpfs, runs `/opt/everstreet/check.mjs` under the pinned Node
  with `--max-old-space-size` and a per-case timeout, writes the length-prefixed report to the
  output drive, and powers off.
- **The guest is the sandbox.** No network device, no host share, no secrets.
- **Recipe `web_app_checks/1`:**
  1. every `.js` file loads as an ES module;
  2. each declared case calls its export and compares the result;
  3. the report records per-case pass or fail with a bounded detail, plus engine and recipe
     identity.

### Proposed limits (Astra's request: small, explicit, measured)

Not yet measured:

| Limit | Value |
|---|---|
| guest | 1 vCPU, 256 MiB |
| cgroup | `memory.max` 384 MiB (guest plus VMM overhead); `pids.max` 64; `cpu.max` `100000 100000` (one CPU) |
| wall clock | 60 s |
| writable files | `fsize` 2 MiB; output drive 1 MiB; report 64 KiB |

The measured peak memory (`memory.peak`) is recorded in the report when available.

### Host output and resources

- **Host output.** The adapter parses at most 64 KiB, validates names, counts, types and the
  binding, and never lets anything the worker wrote choose a host path.
- **Backend limits are not browser limits.** These bound the worker. They do nothing for the
  preview (§6).

## 6. Preview boundary

- **Capability token.** `POST /api/product-projects/:id/app-versions/:job/preview` (owner only)
  returns a 256-bit token. Its SHA-256 is stored with the digest, the owner epoch, the viewer and
  an expiry of 30 minutes.
- **Serving.** `GET /preview/app/:token/<path>` serves files by the token alone. It ignores
  cookies and sets none. A changed owner epoch, an expired token or an unknown path gives 404.
- **Response headers:**
  - `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src <this token's path prefix>; style-src <prefix>; img-src <prefix> data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors <platform origin>`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Cross-Origin-Resource-Policy: same-origin`
  - `Cache-Control: no-store`
- **Studio iframe.** `sandbox="allow-scripts"`: no `allow-same-origin`, popups, top navigation,
  forms, modals or downloads. The document's origin is opaque, so it can't read platform cookies
  or storage. Its subresource requests are cross-site, so `SameSite=Lax` session cookies are not
  sent.
- **Messages.** Only `{everstreet_preview: 1, type: "ready" | "height", height?}` from that
  iframe's `contentWindow`, with origin `"null"` and a bounded number. Anything else is ignored.
  The parent sends nothing.
- **Browser resource risk.** A preview can spin a CPU core or allocate memory in the founder's
  browser tab. Mitigations:
  - it loads only on request;
  - it has a visible Stop, which removes the iframe;
  - Studio stays usable.

  This is not a quota. Backend limits do not apply here.
- **Decision for review.** A preview may be opened for any *validated* bundle, labelled with its
  check state ("Checks not run: isolated worker unavailable"). The browser sandbox, not the
  worker, is the preview's boundary. The alternative is to gate preview on Passed checks, which
  would make preview impossible on this machine until the engine exists. Astra or Tony may
  choose that.

## 7. Conformance suite (`scripts/worker-host/conformance.sh`, run only on an authorized host)

Each case runs through the real launcher and records its result into `conformance-<date>.json`
with the engine and lock identities:
1. **Benign app:** the quote calculator, all cases pass.
2. **Canary host file:** a synthetic file under the host's job dir, plus another job's input
   drive, unreadable from the guest. The report says "not found".
3. **Network:** connecting to `10.0.2.2`, `169.254.169.254` or a public IP fails (no NIC).
4. **Memory:** allocation past 256 MiB is stopped (the guest out-of-memory killer or the cgroup),
   and the host stays responsive.
5. **Processes:** a fork bomb stops at `pids.max`, and the host keeps a free pid budget.
6. **Output abuse:** writing past the output drive or the report limit yields `invalid_report`.
7. **Time:** an infinite loop is killed at the deadline, with the jail and cgroup gone.
8. **Cancel and orphan:** kill the launcher mid-run; `cleanup` and preflight leave no `es-*`
   process, jail or cgroup.
9. **Fail-open trap:** remove the parent cgroup; preflight refuses (`limits_unverified`), and
   no VM starts.

Until this runs: **isolation unverified**. Tests in this repository prove orchestration with a
labelled **test double**. A double's "passed" is stored with engine id `test-double` and is shown
as "Test double: not an isolation check".

## 8. Proposed host setup (needs Tony's explicit yes; not performed)

`scripts/worker-host/setup.sh` (reviewable; nothing runs it automatically):
- **Packages:** `apt-get install` of `curl`, `e2fsprogs`, `squashfs-tools` and `iproute2`, listed
  exactly.
- **Accounts:** creates `everstreet-runner` (spawned from Windows) and `everstreet-vm` (Firecracker
  drops to it), both without login shells.
- **KVM access:** `setfacl -m u:everstreet-vm:rw /dev/kvm`, for that user only, re-applied by a
  boot unit. Tony's account and the `kvm` group are unchanged.
- **cgroup:** creates the cgroup v2 parent `everstreet-worker` with `+cpu +memory +pids` in its
  `subtree_control`.
- **Network:** creates the empty namespace `everstreet-none`.
- **Downloads:** the pinned artifacts, each verified against its official checksum. Writes
  `worker.lock.json`.
- **Install:** `/opt/everstreet-worker` (root-owned, `0755`): bin, guest and lock.
- **sudoers:** one line in a drop-in file, checked with `visudo -c`:
  `everstreet-runner ALL=(root) NOPASSWD: /opt/everstreet-worker/bin/launch`. The launcher accepts
  only `preflight`, `run` or `cleanup <id>`.

`teardown.sh` reverses every step. `verify.sh` runs preflight, then conformance.

Host decisions needed: run setup in the existing Ubuntu or a dedicated distro (recommended:
dedicated); approve the package list and the sudoers line; approve the downloads.

## 9. Not in this job

- **Customer release of web apps:** the extraction runtime and its releases are unchanged.
- **Dependencies or npm packages:** no package install in jobs, and none in bundles.
- **Backends** for generated apps.
- **Live model generation** without a configured budget.
- **Engine conformance proof:** pending until the host setup above is approved and run.
