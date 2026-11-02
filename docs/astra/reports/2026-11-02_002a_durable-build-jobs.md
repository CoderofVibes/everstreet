# Job 002a report: durable build jobs

Builder: Claude. Date: 2026-11-02. Job: `docs/astra/jobs/2026-11-02_002a_durable-build-jobs.md`.
First bounded slice of job 002. Parent job 002 and M2 are **not** complete. No live provider
was called; every provider in the tests is a scripted double. No browser check was done.

## Commits (local, not pushed)

| Commit | What |
|---|---|
| `c0e93ef` | Server: schema, provider contract, artifact validator, build service and worker, API, 19 tests |
| `108bdb3` | Web: Builds tab and Build step in the studio |
| (this commit) | `docs/design/BUILD_RUNTIME.md` revised to 002a's constraints; this report |

## What exists now

- **Records** (`server/src/db.ts`): `build_budgets`, `build_jobs`, `build_events`
  (append-only), `build_artifacts` (immutable), `build_usage` (append-only, `ledger =
  'build'`). Additive `CREATE … IF NOT EXISTS`; no existing table changed.
- **Provider contract** (`server/src/build.ts`): `availability()`, `pricing()` (declared
  cents per million tokens; null is refused), `start(request, signal)` yielding only
  `progress`, `usage` and `output`. The request carries the validated revision snapshot,
  limits, `dispatchKey` and the one accepted output schema. State, success and cost are the
  platform's decisions.
- **Service and worker** (`server/src/builds.ts`): requests with idempotency fingerprints and
  budget reservation; owner-checked list/get/events/cancel/retry/budget; worker with atomic
  claim, concurrency bound, attempt + lease fencing on every write, lease heartbeat,
  dispatch intent before the call, time limit, cancellation, ownership rechecks, recovery.
- **Artifact** (`server/src/artifacts.ts`): `extraction_spec/1` parsed, rebuilt, canonicalized,
  SHA-256 hashed, size-bounded (64 KB) and checked against the revision's prototype.
- **API**: `GET|POST /api/product-projects/:id/builds`, `GET /api/builds/:id`,
  `GET /api/builds/:id/events?after=&limit=` (≤100), `POST /api/builds/:id/cancel`,
  `POST /api/builds/:id/retry`, `GET|PUT /api/businesses/:id/build-budget`.
- **Studio**: Builds tab (also the Build step). Normal mode: "No build provider is connected
  … none is simulated", the build budget, and no start control. With a priced provider: a
  start form showing the worst case reserved and that the bound depends on the provider
  honouring limits. Job list and detail: state, limits, reservation, usage (unknown shown as
  unknown), failure reason, artifact digest and checks, events. Cancel only while live; retry
  only when failed/cancelled/unreconciled, with an acknowledgement when cost may have been
  incurred. Polling 2 s growing to 15 s, at most 60 checks, only while a job is live.

## How the required invariants are covered (server/test/builds.test.ts)

| Invariant | Test |
|---|---|
| No-provider mode honest, no dispatch | "never dispatches in normal no-provider mode" (409, zero rows) |
| Unpriced provider refused | "refuses a provider without declared prices" |
| Duplicate returns job; reused key ⇒ 409, incl. simultaneous | "returns the same job for an exact duplicate…" (sequential and `Promise.all` pairs) |
| Inputs bounded and validated | "validates and bounds every input" (9 cases + budget) |
| Atomic reservation before dispatch; release; ledger | "reserves the worst case before anything runs…" |
| Owner isolation on every endpoint | "lets nobody but the business's current owner…" |
| Revision snapshot sent; validated success; usage; events; redaction | "builds a validated artifact from the revision snapshot…" |
| Model text / wrong kind / failed checks / no output / provider error never succeed | "refuses model text, malformed or unchecked output…" |
| Cancellation during events aborts provider, keeps usage, idempotent | "cancels during events…" |
| Unknown cost keeps reservation; retry needs consent and new reservation | "holds the reservation when a cancelled call's cost is unknown…" |
| Timeout | "stops at the time limit" |
| Concurrent claims within the bound | "claims atomically and within the concurrency bound" |
| Restart before dispatch requeues and runs once | "requeues work that was never sent…" (provider calls = 1, attempt 2) |
| Restart after dispatch: no re-dispatch; stale attempt writes nothing | "does not dispatch again after a restart…" |
| Lapsed lease: stale worker cannot record success | "fences a stale attempt after its lease lapses…" |
| Ownership change before claim / during run | "fences jobs requested by a former owner…", "does not apply output to a business that changed hands…" |
| Append-only records; bounded progress events | "keeps events, artifacts and usage append-only…" |

Mutation check: changing recovery to requeue dispatched work made two tests fail ("does not
dispatch again…", "fences a stale attempt…"); reverted. A real bug found by the tests and
fixed: `Authorization: Bearer <token>` leaked the token through redaction.

## Commands and results

| Command | Result |
|---|---|
| `npm run check` (final) | lint and types clean; 89 tests passed (10 files; 19 new in this slice) |
| `npm run web:build` | built (CSS 34.0 kB, JS 488.0 kB) |
| `npm run format` | applied to my files only |

## Limitations

- No live provider, so no evidence about real latency, token counting or pricing. The
  worst-case bound is only as good as a provider's adherence to the contract.
- Unresolved reservations (`usage_state = unknown`) stay held indefinitely; there is no
  reconciliation tool yet to release them against provider records.
- The worker runs in-process and is not started by `main.ts` (no provider). Multi-process
  safety rests on SQLite transactions and fencing; it was tested within one process.
- Ownership epoch is (owner id, `ownership` row count). If a chain close is not reflected in
  the database, builds can't see it: chain-to-database reconciliation is an M3 dependency.
- The artifact describes a service but nothing runs it yet (job 002c).
- Studio UI not checked in a browser by me; Astra's review is the check.
- Local-preview identity only.

## Not touched

`docs/astra/BUILD_STATE.md`, and Astra's in-progress edits made during this job
(`2026-11-02_ContinuousDevelopment.md`, `ACCEPTANCE.md`, `INDEX.md`, new 002b/002c/003f job
files and their `JOBS.md` rows) were left as they are, uncommitted.

**JOBS.md status is uncommitted.** The 002a row is marked `done` (with the commits above) in
the working tree, but the file also holds Astra's new, unreviewed rows for 002b/002c/003f,
whose job files are uncommitted. Committing it would commit those rows with dangling links,
and staging just my line needed commands this session could not run (`git show … | sed … |
git hash-object -w --stdin`, then `git update-index --cacheinfo`). It should be committed
together with Astra's 002b/002c/003f handoff when that is reviewed.
