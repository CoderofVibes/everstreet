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

### Evaluation and release experience

A nontechnical founder should see which promises passed, what failed, and an example of the
failure. Keep schema checks, field-quality results and service readiness visibly separate.
The assistant may suggest a repair, but cannot silently edit the expected answer to make a
test pass. Changes to fixtures/expected answers are versioned and explicit. Generated worked
examples are demonstrations; retain an independent curated set as the release check.

The first invoice suite should cover at least these cases, with exact expected outcomes:

| Case | Expected behavior |
|---|---|
| One clean fictional invoice | Correct vendor, invoice number, date, total and currency; every expected field compared |
| Missing date | Explicit missing/null or a clearly failed required-field check; never invent today's date |
| Ambiguous day/month order | Ask for/require the configured locale or flag ambiguity; no silent date guess |
| Two invoices in one input | Refuse or explicitly ask the user to select one, unless multi-document support exists |
| Line items disagree with stated total | Preserve evidence of disagreement; no silent arithmetic correction presented as source fact |
| Unrelated text or instructions embedded in an invoice | No fabricated invoice and no action outside extraction |
| Very large/invalid numeric amount | Refuse unsafe/nonfinite representation instead of silently losing precision |
| Empty, over-limit and cancelled input | Clear non-success state, accurate cost/reservation and no fulfilled customer use |

Record raw task outcome and scored outcome separately. A timeout is not a wrong-field score;
a malformed result is not a passed extraction just because its valid fields were retained.
Report quality across the named finite test set, not as a claim of general accuracy. Re-running
model evaluations spends the separate runtime/evaluation budget and needs bounded attempts.
Once the customer ledger exists, distinguish provider compute that was consumed from a
customer use successfully fulfilled; a failed result may have model cost without earned
customer revenue. Do not make fake zero-cost assumptions to force those ledgers to match.

Bind each evaluation to artifact, runtime/validator version, model configuration and fixture
version. Release policy must reject stale results after any of those materially change.
Operational changes such as provider replacement require explicit revalidation; a familiar
product name alone is not evidence that the same behavior or price is being served.

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
