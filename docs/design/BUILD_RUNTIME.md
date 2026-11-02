# Build runtime: from a saved revision to a tested build

Design for job 002 (M2, "real AI creation and isolated execution"), written with the M1 code
that it builds on. Section 1 is checked in the code as of job 001; everything after it is a
proposal for Astra and Tony to review before any of it is built. Nothing here claims a
capability that does not run yet.

## 1. What exists after M1 (checked in code)

- **Process model.** One Node process (`server/src/main.ts`, Hono) serves the API and the
  built web app. Storage is Node's built-in SQLite (`node:sqlite`, WAL, `busy_timeout`
  5000 ms) in `data/runtime/everstreet.db`. There is no job queue and no worker pool; the only
  background work is OpenSeat's waitlist tick (`setInterval`, in-process).
- **Identity.** Cookie sessions (`es_session`, `httpOnly`, `SameSite=Lax`). Local preview lets
  anyone at the computer switch between fictional people; that is not production identity.
- **Ownership.** `businesses.owner_id` is the access boundary. A closed deal rewrites it
  (`server/src/deals.ts`) and records the change in `ownership`; deal hand-over items are
  tracked in `transfer_items`.
- **Product projects** (`server/src/products.ts`, tables in `server/src/db.ts`):
  - `product_projects`: id, `business_id`, foundation (`ai_api`, `saas_workflow`,
    `agent_service`, `client_portal`), the founder's original idea, creator, timestamps.
  - `product_revisions`: (project, number) primary key, validated brief JSON, validated
    prototype JSON, `content_hash` (SHA-256 of the canonical brief + prototype), note,
    `restored_from`, author. SQLite triggers abort any UPDATE or DELETE, so revisions are
    immutable at the storage layer. A restore is a new revision.
  - Saves carry `base_revision`; a save from anything but the current head is refused with
    409 and nothing is written. Saving identical content creates no revision.
  - Every read and write resolves the project through its business's *current* owner, so a
    project follows the business through a sale and the former owner gets 404.
  - Events `product_project_created` and `product_revision_saved` go to `events`.
- **Prototype.** A schema (`schema: 1`) of up to six screens: `form` (typed fields), `list`
  (entries from a form, optional stages as a board) and `model` (the result shape a model
  step would return). The server rebuilds it from checked parts: keys match
  `^[a-z][a-z0-9_]{0,39}$`, labels are length-limited plain text, unknown properties are
  dropped, sources must point at a form. The web app renders it as text; there is no code,
  markup, URL or credential in it, and the model step says no model is connected.
- **Build boundary** (`server/src/build.ts`): `BuildProvider { id; availability(); start(request,
  signal): AsyncIterable<BuildEvent> }`, `BuildRequest` (project, business, revision,
  content hash, idempotency key, budget) and the `BuildEvent` union. `everstreetApi` takes an
  optional `buildProvider`; none is configured, so every studio view reports
  `{ available: false, reason: "Generated builds are not connected…" }`. `start` is never
  called in M1.

## 2. Records to add in M2

All keyed to the project (and through it to the business); brand-neutral names.

| Table | Purpose | Notes |
|---|---|---|
| `build_jobs` | One requested build of one revision | `state`, `provider`, `revision`, `content_hash`, `idempotency_key` (unique per project), `budget` JSON, `requested_by`, `attempt`, `heartbeat_at`, `cancel_requested_at`, `error`, usage totals |
| `build_events` | Append-only log per job | (`job_id`, `seq`) key; the UI's progress view reads only this |
| `build_artifacts` | Output of a job | `digest` (SHA-256 of a file manifest), size, storage path outside `web/` and the repo, `validated_at` |
| `evaluations` | Results per artifact | `kind` = deterministic / model / manual, suite, case, outcome, evidence; unknowns stay rows with `unknown` |
| `releases` | What customers may use | per-project number, revision, artifact digest, check summary, approved by, `state` (`candidate`, `live`, `withdrawn`) |
| `usage_entries` | Money and compute | `ledger` = `build` or `runtime` (see 7), job or request id, tokens, seconds, cost cents, source (`provider_reported` / `estimated`) |

Same immutability rule as revisions for events, artifacts, evaluations and usage: append
only, corrections are new rows.

## 3. Job lifecycle

```
queued ─► running ─► validating ─► succeeded
   │         │            │
   └─────────┴────────────┴──► failed (retryable | final)   ──► cancelled
```

- **Request.** The client sends `{ revision, idempotency_key }`. The server checks owner,
  that the revision exists, provider availability and budget, then inserts the job. The same
  key returns the same job, so a double click or retried request never starts two builds.
- **Run.** A worker claims a queued job inside `BEGIN IMMEDIATE` (single writer), sets
  `running` and a heartbeat, and consumes the provider's event stream into `build_events`.
- **Success is not a model reply.** `succeeded` requires an artifact whose manifest digest is
  stored, that passes structural validation, and whose deterministic checks ran. Provider
  text alone ends at `failed` with the reason.
- **Restart recovery.** On boot, `running`/`validating` jobs whose heartbeat is older than
  the timeout become `queued` again if `attempt < max_attempts`, else `failed (retryable)`.
  Because jobs are keyed to an immutable revision and content hash, a rerun builds the same
  input.
- **Failures** keep the provider's reason and whether a retry may help; a retry is a new
  attempt on the same job, not a new job.

## 4. Provider boundary

- Providers implement `BuildProvider`. They receive the revision content and the budget, and
  return proposed files and usage. They never execute code, never receive platform secrets,
  the session cookie, NEAR keys or another business's data.
- **Authentication.** Customer-facing and build-time model calls use a supported API account
  configured on the server (environment variable or OS secret store), never a person's
  Claude Code or claude.ai login. Tony's note: our development may use the Claude Code
  subscription; customers' work must have its own provider configuration and accounting.
- **Availability** is computed, not assumed: no credential, no confirmed budget, or no
  isolation runtime ⇒ `available: false` with the reason in plain words. That is the state
  today.
- **Tests** inject deterministic doubles (scripted events, fixed artifacts) and are labelled
  as such. A live run is reported separately with its date, provider and usage.

## 5. Isolation

Generated code runs only in an isolated worker, never in the platform process.

| Option | Isolation | Needs | Fit |
|---|---|---|---|
| Child process with Node's permission model | Weak: same user, same machine | nothing | Not acceptable for generated code |
| Container (Docker, or a WSL distro dedicated to builds) | Separate fs and network namespace; CPU, memory, pids and time limits; read-only base image; no network by default | Docker or WSL on Tony's machine, to be verified | Recommended for local M2 |
| Hosted sandbox / microVM service | Strong, managed | A new account and spend | Needs Tony's explicit yes |

Rules whichever runs: the worker mounts only the job's input and output directories; no
host credentials, no `data/runtime`, no `.near-credentials`; network off unless a job's
budget allows a named allowlist; hard wall-clock and memory limits; output copied out and
hashed before anything reads it.

**Preview origin.** Browsers do not isolate cookies by port, so a preview on another port of
`localhost` would still receive `es_session`. A running preview must be served from a
different host name (for example `127.0.0.1` vs `localhost`, or a dedicated preview domain)
or inside an `<iframe sandbox="allow-scripts">` without `allow-same-origin` (opaque origin),
with a restrictive CSP and `postMessage` limited to a fixed message schema. The M1
schema-rendered prototype needs none of this because it runs no generated code.

## 6. Release identity

A release is the tuple (project, revision number, revision `content_hash`, artifact
`digest`, evaluation summary), numbered per project and immutable once `live`. M1 already
shows the revision fingerprint in Versions. M3 attaches customer entitlements to a release
line (not to a person), so a buyer inherits them with the business.

## 7. Cancellation and usage

- **Cancel** sets `cancel_requested_at`, aborts the provider's `AbortSignal` and stops the
  container. Cancelling twice is a no-op; a cancelled job keeps its partial events and usage.
- **Two ledgers.** `build` usage is the AI that builds the product, charged to the business
  that requested it. `runtime` usage is the product's own model calls for its customers (M3,
  tied to entitlements, e.g. the 100/20/80 journey). They are never mixed in one total.
- **Budgets** are checked before start (estimate) and enforced during the stream (abort at
  the limit, recorded as `failed: budget`). The studio shows the estimate before starting and
  usage while running. No automatic top-up.

## 8. Transfer behaviour

- Projects, revisions, jobs, artifacts, evaluations, releases and usage all hang off the
  business, and access is checked against `businesses.owner_id` at request time, so a closed
  deal moves them and cuts the former owner off (covered by a test in
  `server/test/products.test.ts`).
- Jobs running at close: proposed behaviour is to let them finish under the business; their
  results belong to the new owner, and `requested_by` is kept for audit only.
- The platform's provider credential is not a business asset, so nothing to rotate. Anything
  the founder connected from outside (their own API keys, hosting, domains, repositories) is a
  separate `transfer_items` entry and is not called transferred until verified.

## 9. Open before M2 starts

1. Which provider account and model the platform uses for builds, its budget cap, and
   confirmation that no automatic top-up is enabled (Tony).
2. Whether Docker or a dedicated WSL distro is available for build containers on Tony's
   machine (check, don't assume).
3. Preview host name for running builds (local: `127.0.0.1` vs `localhost` is enough).
4. Split of job 002 into slices; suggested order: job records and lifecycle with a scripted
   double → isolated runner → live provider behind availability → evaluations → releases.
