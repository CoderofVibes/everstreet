# 002e Executable product path: report

Claude, 2026-11-04. Job: [002e](../jobs/2026-11-04_002e_executable-product-path.md).
Design: `docs/design/EXECUTABLE_PRODUCTS.md` (`9360d8c`, corrected in `257b0c7` after Astra's ExecutableDesignReview, updated in `dc7fb09`).

## Commits

| Commit | Content |
|---|---|
| `aae0e70` | Astra's five files |
| `9360d8c`, `257b0c7` | design and its correction |
| `0c52870` | `web_app_bundle/1` and the `app` build intent; Anthropic adapter schema (no live call); `build_jobs` migration keeps every column |
| `5e26b6d` | worker-host artifacts and guest supervisor; Astra's BundleInputReview (`__proto__`, root-owned tree, digital example) |
| `4764f9e` | check orchestration, the real WSL/Firecracker adapter, versions and preview; Astra's AppCheckLifecycleReview |
| `dc7fb09` | worker host revised after Astra's WorkerImplementationReview |
| `c0a3c00` | Studio Web app view and `scripts/preview-app.ts` |
| `0da94e6` | Studio finishing after Astra's AppStudioReview |

## What exists

- **Generation.**
  - The `app` intent asks for `web_app_bundle/1`. That bundle is a validated, canonical, hashed explicit file list: paths, text normalisation, sizes, static out-of-bundle and inline-code refusals, reserved names, and declarative cases for logic modules.
  - Generation stays a budgeted, recoverable build job. A lost answer is recovered with the same key, never a second paid build.
- **Logic checks.**
  - `app_checks` holds execution records, kept apart from generation.
  - The worker renews its lease, honours cancels in the dispatch gate and before an outcome is applied, hard-bounds every engine call, blocks claims after an unconfirmed cleanup, and recovers dispatched work as `unknown` (never re-run).
  - Reports are bound to the check, attempt, digest, recipe, engine, and the exact case and file sets.
- **Engine adapter** (`server/src/workerEngine.ts`). A fixed argv into a configured WSL distro, so only the verb varies. It runs a root-owned launcher that starts a jailed Firecracker microVM:
  - explicit host cgroup values, verified before input;
  - no NIC, raw drives only;
  - a single-run lock, with cleanup of proven orphans only.

  The guest is a root supervisor plus per-case uid-1000 processes in a guest cgroup, with a 0600 output drive. **Never run.** It is built only when a distro is named.
- **Versions.** Immutable `app` jobs. The current version is an append-only pointer, so restore rewrites nothing. Studio has file and line compare.
- **Preview.**
  - Token-only (hash stored), bound to one version and the owner epoch, 30 minutes.
  - The document is CSP-sandboxed; subresources are CORS `*` with CORP cross-origin, and no cookies.
  - Served from a separate site, in a `sandbox="allow-scripts"` frame with one validated message; a second load stops it.
  - Ordinary preview needs a real engine's pass. Unchecked is only an explicit, warned choice. A test double's pass never counts.
- **Studio "Web app" tab.**
  - generate or change, with a visible and adjustable spend limit, progress, cancel and recovery;
  - versions with check states in words, check details (cases, files, failure, cancel) and a "logic, not screens" note;
  - compare, make current, preview and stop;
  - it stays mounted across tabs and is fenced by person, project and owner epoch.
- **Host setup, proposed and not performed** (`scripts/worker-host`). Exact pins: Firecracker v1.17.0 sha256 `06094a11…`, Node v24.22.2 sha256 `48cc0e21…`, CI kernel 6.1.188 and Ubuntu 24.04 by key, size and ETag. `setup.sh` runs `check`, `fetch` (reviewer pins the kernel and rootfs sha256), `install` and `uninstall`:
  - conflicts are refused first;
  - each resource is recorded before it is created;
  - rollback touches only the manifest;
  - one sudoers line;
  - no change to Tony's account or `.wslconfig`.

  `setup-harness.sh` (a fake root) and `conformance.mjs` (finite, with negative-controlled evidence rules) are also included.

## Observed evidence

- **Tests.** `npm run check` gave 1148 tests in 120 files, with lint and types clean. `npm run web:build` passed at 870.72 kB, with the existing advisory.
- **Real API and controllers, with labelled doubles:**
  - bundle refusals, including `__proto__`;
  - app intent kind and identity, the base version, size bounds and the migration;
  - check lifecycle: no engine, failed preflight, binding/engine/case-set refusals, an owner change mid-run, cancel and deadline, restart;
  - Astra's two lifecycle reproductions: a run longer than the lease, and cancel during preflight with zero runs;
  - a never-settling adapter, an unconfirmed cleanup that blocks, and another worker's live lease;
  - preview gating, headers, token scope, expiry and a sale;
  - a lost generation answer with one job and one provider call; reload; another scope; a refusal;
  - the preview scenario;
  - the drive frame and adapter argv.
- **Mutants.** About 15 were killed across the slices (each listed in its commit's tests).
- **Astra's own browser evidence** (AppPreviewRouteReview). The real preview route loads app.js, estimate.js and the CSS in the opaque sandboxed frame. The estimator gives $17.00, then $112.50, then $409.50, and fits at 390px.

## Pending: not claimed

- **Real-engine isolation: unverified.** No engine, image or VM has been installed or booted. Host setup needs Tony's explicit approval after Astra's review. Then `setup.sh check`, `fetch`, then the reviewer fills the kernel and rootfs sha256, then `install`, then `conformance.mjs`.
- **`setup-harness.sh` not run.** Running it in this session needed approval. It touches only a temporary directory: `sh scripts/worker-host/setup-harness.sh`.
- **Browser review of the finished Studio view** (I had no browser tool): `npm run web:build`, then `npx tsx scripts/preview-app.ts`, then `http://127.0.0.1:8858/build/<id>?view=app`. Check:
  - 1440, 1280 and 390, and the canvas-led composition;
  - unchecked preview, Stop, and a second version;
  - compare and restore;
  - generation recovery;
  - parent responsiveness only with a **finite** busy canary.
- **No automated in-browser UI journey checks.** Logic checks cover logic modules only, and are worded so.
- **Not in this job:** customer release of web apps (006a), `main.ts` wiring (003w), and live model generation (no budget configured).
- **Still open:** M2 and all six milestones. Next: 003v, 003w, 004b, 005c, 005d and 006a, with the roadmap kept.
