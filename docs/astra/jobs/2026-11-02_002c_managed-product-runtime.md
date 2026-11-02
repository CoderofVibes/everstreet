# M2c: run, evaluate and release the first generated digital product

**Why (Tony's words):** "a good solution for building within a platform that will then
showcase their product"

## What the person sees and does

The founder takes the generated document-to-data specification and tries the actual service.
They paste fictional invoice text, receive validated structured fields and inspect a clear
request record: version, result, status, elapsed time and model usage. They can save test cases,
run them, see failures and revise the product. A selected passing version can be released
locally to the managed customer runtime, while newer studio changes stay drafts.

Make the preview feel like a usable product: example input, submit/progress/result, copy JSON,
plain explanation of missing fields and request history. Sample-input buttons populate the
form; they never substitute a canned result for actual processing. When the provider is
unavailable the action says so. Do not label an inert schema renderer as a working runtime.

An update creates a separate candidate. The founder compares its test results, chooses it for
release or keeps the prior version. Rollback points new requests to a previously checked
artifact; an in-flight request remains pinned to the version it started with.

## Underneath

Use the trusted platform to interpret a validated extraction specification as data. Never
eval generated JavaScript or run arbitrary shell/npm packages. This is a real managed product
family, with an intentionally narrower execution boundary than arbitrary application code.
Preserve future isolated-code support as a separate milestone, not a claim made by this one.

- Immutable artifact identity includes canonical schema digest, model configuration and
  deterministic check provenance. Requested fields support explicit missing/null results;
  reject invalid dates, nonfinite numbers, unknown fields and invalid required values. Do not
  discard wrong fields then present the remainder as a clean successful extraction.
- The runtime model call has a separate ledger and budget from the AI that builds the product.
  Pin model/pricing version, bound input/output/time/concurrency, record provider-reported
  tokens with fractional-cost precision, and preserve unknown outcomes for reconciliation.
  A release and an invocation cannot select arbitrary URLs, tools, credentials or models.
- Persist invocation state, idempotency fingerprint, selected artifact/release, requester,
  output reference, failure class and usage. Same-key/same-input returns the same result;
  different input is a conflict. Timeout/restart must not silently run a second paid request.
- Treat document content as untrusted data. It cannot override the extraction schema, make
  network requests, change release settings or access another tenant. Avoid echoing secrets
  or documents into operational logs; default to minimal retained input with a documented
  retention policy. A private result is authorized on every request, including direct URLs.
- Evaluations use founder-approved/curated fixtures separate from generation examples.
  Record expected vs actual per field and distinguish schema validity from task quality.
  Include missing fields, multiple invoices, malformed dates, contradictory totals, unrelated
  text and prompt injection within the sample document. A model's self-score is not a pass.
- Release activation is an owner/generation-checked transaction bound to an artifact and
  required evaluations. Pending old-owner builds cannot activate after transfer. Separate
  candidate, checked, active and retired/rolled-back states; no release from provider prose.
- Runtime service identity belongs to the business. Hook customer admission and usage
  settlement through an explicit interface for M3 entitlements; owner-only private trials
  can work before commerce is connected. No anonymous unlimited paid model endpoint.
- Keep the managed UI declarative and scoped. Any future untrusted HTML/JS preview requires
  tested origin/cookie/CSP/sandbox boundaries beyond this trusted renderer.

## Done when

One generated product actually extracts the promised fields using the configured live
provider in a separately recorded bounded run. Keyless tests additionally prove isolation,
schema failures, retained unknown costs, duplicate invocation, cancellation/restart, evaluation
provenance, release pinning/rollback and stale-owner rejection. The browser shows actual
request/results and release state, with no fake model output in normal application mode.
`npm run check` and web build pass. Report remaining commerce and production dependencies.

If live credentials are not yet configured, finish and verify the complete adapter/runtime
with injected test transports, report the live gate as pending, and continue independent work.
Do not mark M2 or the platform complete until the missing evidence is captured.

## Not in this job

No new service purchase, public deployment, mainnet, Git push, production identity claim or
arbitrary generated code execution. No PDF parsing/OCR, multi-file code import or custom
external integrations unless separately scoped. Pasted text is accurately labelled.

## Priority and size

P0 / L. After the durable job and provider foundations; integrate with M3's customer ledger.
