# Build runtime: from a saved revision to a checked build

Status as of job 002a (2026-11-02). Sections 1–7 describe code that exists and is covered by
keyless tests (`server/test/products.test.ts`, `server/test/builds.test.ts`); every provider
in those tests is a scripted double. Sections 8–10 are design for later slices. Job 002a's
constraints replaced several optimistic proposals in the first version of this file: WSL is
not treated as a secure boundary, separate host names are not the whole preview design,
paid calls are never retried automatically, and jobs requested by a former owner do not keep
their authority.

## 1. Processes, identity, ownership (checked)

- One Node process (`server/src/main.ts`, Hono) serves API and web app over Node's SQLite
  (`node:sqlite`, WAL). Every write transaction is `BEGIN IMMEDIATE` on one connection.
- Cookie sessions with local-preview actor switching. **Production identity is a separate,
  unresolved dependency**; nothing here claims it.
- `businesses.owner_id` is the access boundary. A closed deal rewrites it and adds a row to
  `ownership` (`server/src/deals.ts`). Builds use (owner id, count of `ownership` rows) as the
  owner epoch. **Chain-to-database reconciliation of a close remains an M3 dependency**: if
  the chain closes and the database is not updated, builds see the old owner.
- No build worker runs in `main.ts`, because no provider is configured. Normal mode reports
  "not connected" and never dispatches (tested).

## 2. Records (implemented)

| Table | Holds | Mutability |
|---|---|---|
| `product_projects`, `product_revisions` | project and immutable brief/prototype revisions (M1) | revisions: triggers abort UPDATE/DELETE |
| `build_budgets` | per-business build allowance set by the owner | owner-editable |
| `build_jobs` | revision, content hash, intent, idempotency key + fingerprint, provider, budget, pricing snapshot, requester, owner epoch, state, attempt, lease, dispatch time, cancel request, failure, reservation, charge, usage state, tokens, artifact digest | state machine below |
| `build_events` | sequenced plain-data events per job | append-only (triggers) |
| `build_artifacts` | canonical artifact, digest, size, checks, provenance | immutable (triggers) |
| `build_usage` | `ledger = 'build'`: reservation, release, actual, unknown | append-only (triggers) |

Build usage is its own ledger. Customer runtime usage (M3) will be a different ledger and is
never summed with it.

## 3. Requests and idempotency

`POST /api/product-projects/:id/builds` with `idempotency_key` (8–80 of `[A-Za-z0-9_-]`),
`revision`, `intent` (`build` only) and `budget` (input tokens ≤ 200,000, output tokens
≤ 32,000, 10–900 s, cost limit ≤ 100,000 cents). The fingerprint is a SHA-256 of revision,
revision content hash, intent, budget, provider and `retry_of`. An exact duplicate returns
the existing job (200); the same key with any difference is 409, including simultaneous
requests (the `UNIQUE (project_id, idempotency_key)` constraint backs the check). Retries are
new jobs with their own key and reservation, linked by `retry_of`.

## 4. Lifecycle, fencing and recovery

```
queued ─claim─► running ─dispatch─► (provider stream) ─► validating ─► succeeded
   │               │                       │                  │
   └─cancel─► cancelled ◄──cancel/abort────┘                  └─► failed (invalid_output)
                   failed (timeout | provider_error | no_output | revision_missing)
                   needs_reconciliation (outcome_unknown | ownership_changed after dispatch)
```

- **Claim** is one transaction: within the concurrency bound, take the oldest queued job not
  cancelled, recheck the owner epoch (stale ⇒ fence instead), set `running`, increment
  `attempt`, set lease owner and expiry.
- **Fencing.** Every worker write runs in a transaction that first requires the same attempt,
  the same lease owner and a live state, and renews the lease. A worker that lost its lease,
  was cancelled, recovered or fenced cannot write anything, including success.
- **Dispatch intent** (`dispatched_at` + `dispatched` event) is committed before the provider
  is called. The request carries the validated revision snapshot (foundation, brief,
  prototype), the limits and a `dispatchKey` of job id and attempt.
- **Restart / lapsed lease** (`BuildWorker.recover`): not dispatched ⇒ back to `queued` (or
  `cancelled` if a cancel was pending); dispatched ⇒ `needs_reconciliation` with
  `outcome_unknown`. **A possibly dispatched paid call is never re-run automatically.** A
  retry needs `acknowledge_unknown_cost: true` and a new reservation.
- **Cancellation** persists `cancel_requested_at` (idempotent), finishes a queued job at
  once, and aborts a running attempt through its `AbortSignal`; usage already reported is
  kept. **Time limit**: the attempt is aborted at `max_seconds` and fails `timeout`. A lease
  heartbeat runs while a provider is quiet.
- **Success** needs a parsed, rebuilt, canonical, hashed artifact that passes deterministic
  checks (section 6). Model text, an asserted digest, more than one output, or no output is
  a failure.

## 5. Budgets and usage

- A provider must declare prices (`pricing()`); unpriced providers are refused.
- Worst case = ceil(input limit × input price + output limit × output price) / 1,000,000
  cents. It must fit the request's cost limit, and the business's available budget (limit −
  reserved − charged) at request time, in the same transaction that inserts the job.
- This is **not a hard monetary cap**. It bounds cost only if the provider honours its
  contract: count input before sending and refuse above the limit, cap generation at the
  output limit, and report usage for every call. Reported tokens above the limits are
  recorded as a `limit_exceeded` event.
- Usage reported ⇒ the charge is recorded and the reservation released at the end. Dispatched
  without a usage report ⇒ `usage_state = unknown` and **the reservation stays held**
  ("unresolved"). Unknown is never shown as zero. Releasing an unresolved reservation needs
  provider-side records; that reconciliation step is not built yet.

## 6. Accepted artifact: `extraction_spec/1`

A declarative description of a document-to-data service: input kind and size, 1–30 typed
fields (text, number, date, boolean), instructions, up to five worked examples
(`server/src/artifacts.ts`). The platform rebuilds it from checked parts, drops unknown
properties, canonicalizes (sorted keys), hashes it (SHA-256) and checks: examples return only
declared fields with declared types; it covers every output the revision's prototype model
steps promise; at least one example. Provenance records schema, provider, job, attempt,
project, revision, content hash and validator. It is data: nothing executes it in this slice.
Running it belongs to the managed runtime (job 002c).

## 7. Ownership and transfer

- Every endpoint (list, get, events, cancel, retry, budget) resolves the business's current
  owner; anyone else gets 404.
- Jobs capture requester and owner epoch. The worker rechecks the epoch before claiming,
  before dispatching, on every provider event and immediately before applying output. A
  change fences the job: never dispatched ⇒ `cancelled (ownership_changed)` with the
  reservation released; dispatched ⇒ `needs_reconciliation (ownership_changed)`, output not
  applied, reservation held. **Former-owner jobs do not finish with authority.**
- Records move with the business; the new owner sees the history and may retry under their
  own authorization. An unresolved reservation from before the sale is visible on the
  business's build ledger and should be a disclosed transfer item.

## 8. Isolation (design; not built)

This slice executes no generated code. When arbitrary code is supported it needs an
independently tested sandbox: separate kernel or VM boundary, no host credentials or
`data/runtime`, network off by default, CPU/memory/pid/time limits, read-only base,
output copied out and hashed before use. A WSL installation or a plain container on Tony's
machine is not, by itself, adequate evidence of that. Safe declarative products (section 6)
do not need it and must not be blocked on it.

## 9. Preview origin (design; not built)

The M1 prototype renders only validated schema as text and needs no isolation. A preview that
runs generated code needs more than a different host name: an opaque-origin sandboxed iframe
(no `allow-same-origin`), a restrictive CSP, no platform cookies (they are not isolated by
port), a fixed `postMessage` schema validated on both sides, and no platform authority
reachable from it.

## 10. Next slices

- 002b: guided authoring and the first real provider adapter behind `BuildProvider` (bounded,
  priced, configured server-side; not a personal login).
- 002c: managed runtime that executes `extraction_spec/1`, evaluations, releases, runtime
  usage ledger.
- Reconciliation tooling for `needs_reconciliation` and unresolved reservations.
- M3: chain-to-database close reconciliation, production identity.
