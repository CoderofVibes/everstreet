# Job 002c report: run, evaluate and release the first generated product

Claude, 2026-11-02. Job: [002c](../jobs/2026-11-02_002c_managed-product-runtime.md).
Architecture: [`docs/design/MANAGED_RUNTIME.md`](../../design/MANAGED_RUNTIME.md).

## Status

The keyless capability is built and checked. **The live gate is pending:** no real model call
was made. Every runtime provider in the tests is either a scripted double or the real
`AnthropicRuntime` over an injected transport. M2 and the platform stay open.

| Commit | Part |
|---|---|
| `76e0120` | architecture note, extraction validator, Anthropic runtime adapter, runtime ceiling in config |
| `dab0782` | invocations, separate runtime budget and append-only `runtime_usage` ledger, routes, startup recovery |
| `76a9a62` | versioned test cases, the curated invoice suite, evaluation runs, releases and rollback |
| `a1ce4e9` | the founder's Service tab |
| (with this report) | interrupted checks are stopped at startup; report |

## What exists

**Boundary.** The artifact is interpreted as data. Its declared fields become a closed JSON
schema for one fixed platform request. The document is a JSON string value marked as
untrusted. No generated code, URL, tool, credential or model choice comes from the artifact,
the document or the answer. Input is pasted text only.

**Validation (`extract-validator/1`).** An answer has one of four outcomes:

- `extracted`;
- `incomplete`: the missing fields are explicit, never filled in;
- `refused`: the model's reason is kept (not a document, more than one document, ambiguous);
- `invalid`: unknown or duplicate keys, a calendar-invalid date, or a number that isn't a plain
  decimal or has more than 15 digits.

A partly valid answer shows no fields. Numbers stay exact decimal strings. Disagreements the
model reports are kept as evidence beside the stated values.

**Invocations and ledger.**

- Owner-only, through an `Admission` interface. `ownerOnly` is the only implementation; M3
  plugs in there.
- Free refusals before anything is reserved: empty input, over the character limit, or the
  runtime unavailable.
- One transaction checks owner, runtime budget, the operator's **separate** runtime ceiling
  (`runtime_operator_ceiling_cents`, optional; without it the runtime is unavailable) and at
  most 2 running per business, then reserves the worst case and records the dispatch.
- Same key and same request returns the same record, including while it runs. A different
  request under that key is 409.
- Exact usage in millionths of a cent.
- A lost answer, a cancellation without a receipt, or a timeout keeps the cost **unknown** and
  the hold in place.
- On restart, running requests become unknown and are **never re-run**.
- The pasted text is not stored, only its SHA-256 and length.
- `runtime_usage` is never summed with `build_usage`.

**Identities on every record:**

- artifact digest and build job;
- runtime model configuration: provider, model, config, pricing, thinking, effort and
  `runtime-prompt/1`;
- validator;
- test case version;
- release.

**Evaluations.** Test cases are founder-approved and separate from the generated worked
examples. Every change is a new immutable version (a database trigger refuses updates, and a
stale base version is a 409). The **curated invoice suite** (9 fictional cases) covers every
row of the job's table:

- clean invoice;
- missing date;
- ambiguous day/month;
- two invoices;
- line items disagreeing with the stated total (the total is kept and the disagreement must be
  reported);
- embedded instructions;
- unrelated text;
- an unsafe amount;
- empty input.

Over-limit and cancelled input are covered by the invocation tests rather than the suite.

A run binds artifact, model configuration, validator and case version. Each case runs once,
paid from the runtime budget, with no retries. A spending refusal stops the run. The raw
outcome is kept apart from the score: `pass`, `fail`, `error` (no answer to score) or
`not_applicable` (expects a field the version doesn't have; not run). A run goes stale when
the model, validator or cases change. Results are stated as covering "these named test cases
only".

**Releases.**

- Activation and rollback are owner transactions. They need a complete, current run with every
  case passing, and a version built under the current owner epoch.
- One active release per project (unique index).
- A request keeps the artifact it started on, whatever is released or rolled back meanwhile.
- A release stops serving, and can't be rolled back to, after the model or validator changes,
  until it is checked again.
- Provider output never creates a release.

**Service tab.**

- Try a released or candidate version. Sample buttons only fill the box.
- The result shows missing values explained, problems for an invalid answer and reported
  disagreements, with Copy JSON and the request record (version, digest, status, time, model,
  checks, usage or unknown, input length).
- A resend with the same text reuses its key.
- Test cases: adopt the curated suite; save a trial as a case after confirming exactly what it
  will expect; remove cases.
- Run checks with expected against actual per field, errors kept apart from failures.
- Release and roll back. Runtime budget. Request history.
- With no runtime connected the page says so and Run is disabled. Nothing is simulated.

## Evidence (keyless)

- `npm run check`: lint, types, 25 files / 280 tests passed.
- `npm run web:build`: passed, 60 modules (chunk-size advisory only).

The runtime tests:

- `runtime-extract.test.ts` (11): every validator outcome. The adapter's request shape: closed
  schema, the document only inside the user JSON and not in the system prompt, no tools. A free
  count refusal costs zero and sends no generation. Usage outside the band stays unresolved, a
  lost answer has unknown cost, a cut-off or prose answer is a bad answer, no runtime ceiling
  means unavailable, and the identity has no secret.
- `runtime-invocations.test.ts` (16):
  - exact usage and record;
  - the text is not stored anywhere;
  - owner-only including direct links (anonymous 401);
  - free refusals with an empty ledger;
  - idempotency, conflict, and a concurrent duplicate that runs once;
  - the separate ledger, the business budget, and an operator ceiling that stops a second
    business;
  - the concurrency bound;
  - an invalid answer is not success but keeps its real cost;
  - a lost answer keeps the cost unknown and the hold;
  - a free refusal releases;
  - cancellation and timeout stay unknown;
  - restart gives unknown with no re-run;
  - no provider: honest refusal;
  - another project's artifact is refused.
- `runtime-releases.test.ts` (11): a correct extractor passes all 9 curated cases with
  provenance; wrong fields fail with expected against actual; a provider error is an error; a
  fabricated invoice from unrelated text fails despite the model's own "all checks passed";
  not-applicable cases aren't run and block release; case versioning and staleness; a check
  interrupted by a restart becomes `stopped` without re-running anything; a model
  change makes checks stale; a failing check can't be released; release, serve, release a
  newer version with a request in flight (it kept its version), then roll back; after a model
  change a release stops serving and rollback is refused; a version built under a previous
  owner can't be released after a transfer.
- `web/test/serviceView.test.ts` (5): missing values explained and never filled; unknown cost
  never shown as zero; Copy JSON gives values only for readable results; a saved case expects
  exactly what was shown; samples are input only.

## Not done / pending

- **Live run.** Once Tony gives the go-ahead and the operator sets
  `runtime_operator_ceiling_cents`, one bounded run of the curated suite on `claude-haiku-5-5`
  is needed. Compare the computed cost with the console, as in `BUILD_RUNTIME.md`'s plan. Until
  then nothing shows the real model meets these cases.
- **No browser review.** The Service tab hasn't been reviewed in a browser by me; Astra's pass
  is needed.
- **Commerce (M3):** customer admission, entitlements, the customer ledger and settlement
  (fulfilled use against provider compute). There is no public endpoint.
- **Production:** identity, hosting, reconciliation tooling for unknown runtime costs, a
  retention policy beyond "text not stored", and multi-document, PDF or OCR input.
  - A check interrupted by a restart is marked `stopped` at startup. Its finished cases keep
    their results, and its unfinished request is marked unknown. It doesn't resume; the founder
    runs the check again.
- **The ambiguous-date case accepts `refused` or `incomplete`.** A configured-locale option
  isn't built.
