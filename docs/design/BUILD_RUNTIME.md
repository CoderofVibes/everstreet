# Build runtime: from a saved revision to a checked build

Status as of job 002b (2026-11-02). Sections 1–7 and 11–12 describe code that exists and is
covered by keyless tests (`server/test/products.test.ts`, `builds*.test.ts`,
`authoring.test.ts`, `anthropic.test.ts`); every provider in those tests is a scripted double
or the real adapter over an injected transport. No live model call has been made. Sections
8–10 are design for later slices. Job 002a's
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
- A build worker runs in `main.ts` only when the AI configuration (section 12) is complete.
  Without it, normal mode reports "not connected" and never dispatches (tested).

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
  the same lease owner, a live state **and an unexpired lease**, and only then renews it. An
  expired lease is never revived (002a1 #4): the attempt stops, and the job settles by
  dispatch state (requeued if nothing was sent, held for reconciliation otherwise) without
  waiting for another worker's recovery. A cancelled, recovered or fenced worker cannot
  write anything, including success.
- **Pinned provider** (002a1 #3). A job records the provider's non-secret identity (id,
  model, version) and price snapshot. Before dispatch the worker refuses a job whose pinned
  configuration differs from its own, or whose provider is unavailable
  (`provider_changed` / `provider_unavailable`; nothing sent, reservation released). Choosing
  another provider means a new request.
- **Dispatch intent** (`dispatched_at` + `dispatched` event) is committed before the provider
  is called. The request carries the validated revision snapshot (foundation, brief,
  prototype), the limits and a `dispatchKey` of job id and attempt.
- **Stream bounds.** At most `maxStreamEvents` events per attempt (default 1,000;
  `stream_limit` beyond), 200 stored progress events, 5 stored unknown events, a 64 KB
  artifact, one artifact (a second stops the attempt at once). The worker yields to the event
  loop every 25 events so cancels and timers run during a stream that never waits. Quiet
  heartbeats also check cancellation and ownership.
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

- A provider must declare prices (`pricing()`) as whole cents per million tokens (safe
  integers, ≤ 10,000,000); unpriced or invalid prices are refused.
- Cost is computed exactly in millionths of a cent (tokens × price) and shown as such;
  `charged_cents` rounds up for the ledger. It is computed from reported tokens at declared
  prices, not a provider invoice.
- Worst case = ceil(input limit × input price + output limit × output price) / 1,000,000
  cents. It must fit the request's cost limit, and the business's available budget (limit −
  reserved − charged) at request time, in the same transaction that inserts the job.
- This is **not a hard monetary cap**. It bounds cost only if the provider honours its
  contract: count input before sending and refuse above the limit, cap generation at the
  output limit, and report usage. Usage over the request's limits (002a1 #2) is recorded,
  stops the attempt (`limit_exceeded`) and its output is never applied, even if already
  received or valid. Usage that is not a safe, non-negative, bounded integer stops the
  attempt (`invalid_usage`).
- **Usage states** (002a1 #1): `usage` events are provisional deltas; only `usage_final`, the
  provider's receipt of the attempt's billed totals, settles usage. `final` ⇒ the reservation
  is released at the end. `partial` (deltas, no receipt) or `unknown` (nothing) after
  dispatch ⇒ **the reservation stays held** ("unresolved"), whether the attempt succeeded,
  failed, timed out or was cancelled; a retry needs explicit consent. A duplicate receipt is
  counted once; a receipt lower than reported deltas never reduces known spend; deltas after
  the receipt are ignored; a receipt arriving after the attempt lost authority is not
  recorded (the job stays unresolved). Unknown is never shown as zero. Releasing an
  unresolved reservation needs provider-side records; that reconciliation step is not built.

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

- 002c: managed runtime that executes `extraction_spec/1`, evaluations, releases, runtime
  usage ledger. Built keylessly; see `MANAGED_RUNTIME.md` (live provider run pending).
- Reconciliation tooling for `needs_reconciliation` and unresolved reservations.
- M3: chain-to-database close reconciliation, production identity.

## 11. Guided authoring (implemented, job 002b)

- **Work log.** `product_messages` holds the business's product work log: founder messages
  and the assistant's replies. It belongs to the business and moves with it on a sale; it is
  labelled as such in the studio. There is no personal-notes scope yet.
- **Proposals are build jobs.** A message creates a `propose` job against the current
  revision (same budgets, fencing, cancellation, recovery). The provider receives the
  revision snapshot and the last 12 work-log entries as data. Output is
  `product_proposal/1` (reply, summary, brief, screens, assumptions, at most 3 questions),
  rebuilt through the same validators as a founder's save; anything else fails the job.
  The proposal, the artifact and the assistant's reply are recorded in the transaction
  that marks the job succeeded.
- **Applying** (`POST …/proposals/:id/apply`) is idempotent and atomic: an applied proposal
  returns its revision; a proposal whose base is no longer the head is a 409 (nothing
  overwritten); a proposal made under a former owner epoch is a 409 for the new owner.
  The studio refuses to apply while there are unsaved edits.
- **Browser scope.** Unsaved drafts are keyed by person, project and owner epoch; the studio
  remounts when the acting person changes, so late responses for a previous person are
  dropped. The old project-only draft key is not offered to anyone.

## 12. Anthropic adapter and configuration (implemented; no live call made)

- **Configuration** (`server/src/ai-config.ts`), read once at server start:
  - `EVERSTREET_AI_CONFIG`: path to a JSON file outside the repository with
    `config_version`, `provider: "anthropic"`, `model` (`claude-sonnet-5-5` or
    `claude-haiku-5-5`), `pricing_version: "2026-11-02"`, `operator_ceiling_cents`
    (1–100,000). Secrets in this file are refused.
  - `ANTHROPIC_API_KEY`: the platform's own API key in the server's environment. Nothing
    else is searched; no personal Claude login is used for customer work; the key is never
    printed, logged, stored in events or included in identity.
- **Pinned per model** (prices and thinking as documented 2026-11-02): Sonnet 5.5 at
  200/1,000 cents per million tokens with `thinking: {type: "between_tools"}`; Haiku 5.5 at
  10/50 with `thinking: {type: "disabled"}` and prompts refused above 100,000 tokens (a higher
  price applies there); both at `output_config.effort: "medium"`. The job's pinned identity
  includes config, pricing, thinking and effort versions.
- **One attempt.** Free `count_tokens` of the exact request (prompt, schema, thinking,
  effort), refused above 95% of the input limit; then one `POST /v1/messages` with
  `output_config.format` JSON schema. No retries, tools, caching, streaming, batch or
  `inference_geo`. HTTPS to `api.anthropic.com` only, redirects refused, 512 KB and 120 s
  bounds.
- **Usage.** A final receipt only when actual usage is within the request's limits and the
  model's priced band. If nothing billable was sent (limits above the model's caps, count
  refused, unreachable or over the limit) the receipt is 0/0 and the hold is released. A
  response with cache or server-tool usage, or outside the band, is reported as "at least"
  and stays unresolved. A generation that errors or is unreachable keeps its hold.
- **Not success:** `refusal`, `max_tokens`, `model_context_window_exceeded`, `tool_use`,
  `pause_turn`, `stop_sequence`, any block other than one text block plus discarded
  `thinking`/`redacted_thinking`, unparsable JSON, a schema the platform rejects.
- **Operator ceiling.** Every dispatch checks, in the same transaction as the business
  budget, that all build-ledger holds and charges across all businesses stay under the
  operator ceiling. A business budget cannot be set above it. No ceiling ⇒ unavailable.

### Live verification plan (not run; needs Tony's go-ahead and a configured key)

1. Write the config file outside the repo with `claude-haiku-5-5` and a small ceiling (e.g.
   50 cents); set the key in the server's environment; start the server; confirm the log
   line names the model and does not print the key.
2. In the studio, set a business budget of $0.20; send the invoice idea once. Expect one
   count and one generation, a proposal, a `final` receipt whose tokens match the console's
   usage page, and the hold released.
3. Send "Also return the invoice date"; expect a second proposal on the new revision.
4. Edit and save the brief while a request runs; expect the stale-base refusal on apply.
5. Stop a request mid-flight; expect "unknown"/held, and a retry that asks for consent.
6. Compare the computed cost with the Anthropic console for the same requests; record any
   difference before raising limits. Do not run unattended until these match.
