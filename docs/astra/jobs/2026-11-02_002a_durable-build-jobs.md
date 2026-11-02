# M2a: durable build jobs with truthful progress and recovery

**Why (Tony's words):** "I want you to drive the development of that build with Claude as
your builder. Work with Claude for as long as you need to develop that part of the platform."

## What the person sees and does

Lay the durable foundation for real AI building. A founder sees builds tied to immutable
project revisions, with understandable progress, recorded usage, cancellation and failures.
Refresh preserves the job. A provider that is not configured is clearly unavailable; the
normal UI must never offer a disguised scripted build. Scripted providers belong only in tests.

This is the first bounded slice of job 002, not completion of M2. Next slices will implement
AI-assisted briefing, a validated declarative document-to-data product and its managed runtime,
real provider integration, evaluations and releases. Arbitrary code support remains a separate
isolation requirement; do not let lack of a container block safe declarative product work.

## Underneath

Read the existing build boundary, products, database and `BUILD_RUNTIME.md`. Implement the
minimum coherent records/service/API/worker/UI for build jobs and append-only sequenced events.
Tie a request to the actual revision snapshot and hash; a provider needs its validated content,
not just opaque IDs. Keep build-time usage separate from customer runtime usage.

Required invariants:

- Every endpoint resolves current business ownership, including lists, events, cancellation
  and retry. Capture requester and owner generation/version for worker authorization. A worker
  must recheck ownership before claiming and before applying output. Old-owner jobs cannot
  publish or silently spend under a new owner; cancel/fence them on observed ownership change.
  Document that chain-to-database reconciliation is a remaining M3 dependency.
- Idempotency keys are unique per project, and their immutable request fingerprint includes
  revision, budget and intent. Exact duplicates return the existing job. Reusing a key for a
  different request is 409, including simultaneous requests. Bound and validate every input.
- Claim jobs atomically; use attempt/lease fencing so a cancelled or stale worker cannot write
  success after another worker/recovery takes over. Cancellation must persist and be idempotent,
  abort active work and preserve usage already incurred. Bound concurrency and elapsed time.
- Reserve budgets atomically before dispatch. Include token/output limits where applicable.
  Reject unavailable or unpriced providers; unknown usage is unknown, not zero. Do not claim a
  hard monetary cap from an estimate or post-hoc stream observation. Define the adapter contract
  needed to bound provider cost before a request and preserve unresolved reservations.
- **Do not automatically rerun an ambiguous paid provider call on restart.** Persist dispatch
  intent/attempt before invoking; distinguish safe not-started work from dispatched/unknown
  outcome. Recover or fail with an explicit reconciliation state; retries need new recorded
  authorization/reservation when duplication cannot be excluded. A cancelled request can still
  have incurred cost. Tests must prove stale workers and restarts cannot blindly double dispatch.
- Model text or an asserted digest is never a successful build. For this slice, accept only a
  bounded structured artifact that the platform can parse, canonicalize, hash and validate with
  deterministic checks. No generated shell/JS execution, package install, URL fetching, eval
  or arbitrary output paths. If no supported artifact exists yet, finish with an honest
  unsupported-output error, never a fake success. Keep artifact provenance/version explicit.
- Events are bounded plain data; omit secrets and redact provider errors. Output from a provider
  is untrusted content, not permission to call tools. No customer cookies or platform authority
  are passed to the provider. Avoid unbounded polling and event payloads.

Revise `BUILD_RUNTIME.md` to match these constraints before relying on its proposal:
WSL alone is not a secure container boundary; different host names alone are not the full
preview security design; automatic paid retries and allowing old-owner jobs to finish with
authority are not accepted. Production identity is still a separate dependency.

## Done when

Keyless tests cover duplicate/conflicting requests, owner isolation, concurrent claims,
cancellation during events, stale attempts, timeout, restart before/after dispatch, budget
reservation/release/unknown-cost cases, malformed output, validated success, and ownership
change. Normal no-provider mode remains honest and does not dispatch. The studio can show
persisted state/events and cancel/retry only when safe. Run `npm run check` and `npm run
web:build`, report evidence and limitations, make local commits, update JOBS and a report.
Do not mark parent job 002 or M2 complete. Stop for Astra review after this slice.

## Not in this job

No live API calls or credentials, billing changes, new paid service, public hosting, NEAR
transactions, contract edits, generated-code execution or production-auth claim. Existing
API credit is authorized for a later bounded configured integration; credentials are not
needed for this slice. Do not read secrets or Tony's runtime database. Tests use isolated state.

## Priority and size

P0 / M-L. Implement after 001a, one code writer. Follow the repo's Claude review/commit rules.
