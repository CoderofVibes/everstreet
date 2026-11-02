# Managed product runtime (job 002c)

Claude, 2026-11-02. Architecture of the slice; the status line in each section says what is
built. Companion to `BUILD_RUNTIME.md` (the AI that *builds* a product). This document is about
the product *running*: a founder's checked `extraction_spec/1` turning pasted text into fields.

## 1. Boundary

- **Interpreted, never executed.** The platform reads the artifact as data: field list,
  types, instructions. The only model call is the platform's own fixed request (section 3)
  with the artifact's field list compiled into a closed JSON schema. Nothing from the
  artifact, the document or the model output can choose a URL, tool, credential, model or
  release setting. No generated JavaScript, shell or package runs. Arbitrary-code products
  remain a separate milestone (`BUILD_RUNTIME.md` §8).
- **Pasted text only.** No PDF, OCR, files or external integrations. The UI says "pasted
  text".
- **Owner-only before M3.** Every runtime endpoint resolves the business's current owner; anyone
  else gets 404. Customer admission and usage settlement go through an explicit `Admission`
  interface whose only implementation now is `ownerOnly`. There is no anonymous endpoint.

## 2. Identities (exact, stored on every record)

| Identity | Value |
|---|---|
| Artifact | `build_artifacts.digest` (SHA-256 of the canonical spec) plus the build job id |
| Runtime model configuration | `runtime-provider` identity: provider, model, config version, pricing version, thinking/effort, prompt version |
| Validator | `EXTRACT_VALIDATOR = "extract-validator/2"` (2: overlong values are invalid, never shortened) |
| Release policy | `RELEASE_POLICY = "invoice-release/1"` and its required cases |
| Fixture set | project fixture set id plus immutable version number |
| Release | release id → (artifact digest, model configuration, validator, evaluation run) |

An evaluation or release whose stored identities differ from the current ones is **stale**. A
release whose model configuration or validator changed can't be activated or rolled back to
without a new evaluation run.

## 3. Runtime model call (`server/src/runtime.ts`)

- `RuntimeProvider` is separate from `BuildProvider`: `identity`, `pricing`, and
  `extract(request, signal)` returning `{ usage, output }` or throwing with a usage report.
- `AnthropicRuntime` reuses the existing HTTPS `Transport` (api.anthropic.com only,
  redirects refused, size and time bounds) and the configured pinned model and prices:
  1. a free `count_tokens` of the exact request, refused above the input limit;
  2. one `POST /v1/messages` with `output_config.format` = a closed JSON schema built from the
     artifact's fields.

  There are no retries, tools, caching or streaming.
- The document is put in the user message as a JSON string value under `document`, with a
  system prompt saying it is untrusted data. The output schema returns every value as a
  string or null, plus `status` (`extracted | not_a_document | multiple_documents |
  ambiguous`), per-field `note` and `issues`. Typing happens in the platform, not the model.
- **Usage:** a final receipt only inside the request's limits and the priced band. Otherwise
  "at least" (partial), and the hold stays. The same rules as the build adapter.
- **Configuration:** the existing AI config file gains an optional
  `runtime_operator_ceiling_cents`. Without it the runtime is unavailable and the UI says so.
  Without a config or key, everything is unavailable and nothing is scripted in normal mode.

## 4. Validation (`server/src/extract.ts`, pure)

`validateExtraction(spec, raw)` gives one outcome:

- `extracted`: every declared key present exactly once, no unknown keys, every non-null
  value valid for its type, every required field non-null.
- `incomplete`: well-formed, but a required field is null. The missing list is explicit; the
  platform never fills in a value (no "today" for a date).
- `refused`: the model reported `not_a_document`, `multiple_documents` or `ambiguous`, with
  its reason. No fields are presented.
- `invalid`: unknown or duplicate keys, a malformed date (calendar-checked `YYYY-MM-DD`), a
  number that isn't a plain decimal or exceeds 15 significant digits, a non-boolean, or an
  unparsable shape. **Nothing is shown as a clean result.** The valid fields of an invalid
  answer are not presented as success.

Numbers are kept as exact decimal strings (`"1234.50"`), never converted through floating
point for storage or comparison.

## 5. Invocations and the runtime ledger (`server/src/invocations.ts`)

Tables:

- `runtime_budgets`: per business, set by the owner, at most the operator's runtime ceiling.
- `runtime_invocations`: id, business, project, artifact job and digest, release (nullable),
  purpose (`trial | evaluation | release`), requester, owner id and generation, idempotency
  key, fingerprint, input SHA-256 and length, provider configuration, validator, state, failure
  class, outcome, output, problems, reserved, charged (cents and microcents), usage state,
  tokens, timestamps, elapsed ms.
- `runtime_usage`: append-only, `ledger = 'runtime'` (reservation, release, actual, unknown).
  It is never summed with `build_usage`.

Behaviour:

- **Before dispatch (free, nothing reserved):** empty input, input over the artifact's
  `max_chars` or the runtime maximum (20,000 characters), runtime unavailable, budget or
  ceiling exceeded, or more than 2 concurrent invocations per business. These are refused with
  a clear state and no fulfilled use.
- **Reserve and dispatch** happen in one transaction: owner epoch, budget, operator ceiling,
  then a `running` row with `dispatched_at` set before the provider is called.
- **Idempotency:** the same key and same fingerprint return the same record (still running, or
  final). The same key with a different input or artifact is a 409. The fingerprint is the
  SHA-256 of purpose, artifact digest, release and input hash.
- **Cancellation** aborts the in-process attempt. Usage already received is kept; without a
  receipt the cost stays **unknown** and the hold stays.
- **Restart:** `recover()` turns every `running` row into `unknown` (`outcome_unknown`). It
  never re-runs it. A paid request is never retried automatically.
- **Retention (corrected in 002c1):** the pasted text itself is not stored, only its SHA-256
  and length. The result (extracted values, notes, reported issues) **is** stored as one of the
  business's records. It can contain text from the document, and it moves with the business
  on a sale (PLATFORM_VISION: runtime records belong to the business). Saved test cases keep
  their input. Every read is authorized. Documents and outputs never go to operational logs or
  events.
- **Authority after the final await (002c1):** the HTTP answer to a request, new or a same-key
  replay, is authorized again once the result is in. A former owner gets 404, and an owner who
  went away and came back gets 409. The request is still finished, accounted and kept.
- **Idempotency first (002c1):** the fingerprint is the request as asked (purpose, the target
  "release" or the build id, the input hash, the evaluation reference). It is resolved before
  today's release, model or availability, so a retry recovers the original paid record.

## 6. Evaluations (`server/src/evaluations.ts`)

- **Release policy (002c1):** `invoice-release/1` has 10 platform-defined required cases
  (`REQUIRED_INVOICE_CASES`). They use fictional digital suppliers, with a fictional marker on
  its own line outside the vendor's name, and cover every case in the job's table except
  cancellation, which the runtime's own tests cover. They run in every check. A release needs
  every one of them present and passing. A required case that doesn't apply to a version blocks
  release with that reason.
- **Founder cases** are approved per project and supplement the required cases. They are kept
  apart from the artifact's generated worked examples, and every edit makes a new immutable
  version (no update or delete). They can't use `req_` ids, so they can't shadow, remove or
  weaken a required case. They may be empty.
- **A run** binds artifact digest, release policy, model configuration, validator and fixture
  set version. It
  runs each case as an `evaluation` invocation, sequentially, once each. It spends the runtime
  budget and never retries.
- **Per case** it records the raw outcome (invocation state, outcome, fields, failure) and the
  scored outcome separately:
  - `pass`: the expected outcome and every expected field match exactly (text trimmed; numbers
    compared as normalized decimals);
  - `fail`;
  - `error`: no answer to score, e.g. timeout, provider error or unknown. An error is not a
    wrong field.
- **Not applicable:** a case expecting a key the artifact doesn't declare can't pass. The suite
  must be edited (new version) to match.
- Schema validity (`invalid` outcomes), field quality and service readiness are shown
  separately. A model's own claims are never a score.

## 7. Releases (`server/src/releases.ts`)

States: **candidate** (a succeeded build artifact), **checked** (it has a current evaluation
run with every case passing), **active** (one release per project), **retired**.

- **Activate** is one transaction. It checks:
  - current owner and owner generation;
  - the artifact's build job was requested under the current owner epoch (a former owner's
    build can't activate after a transfer);
  - the run is complete, all cases pass, and it matches this artifact, the current model
    configuration, the current validator and the latest fixture version.

  It then retires the active release and inserts the new one.
- **Rollback** makes a previous release active again by inserting a new active row that points
  to the same artifact and run (`rolled_back_from`). It applies the same currency checks: a
  release whose run is stale needs re-evaluation first.
- **Pinning:** an invocation records its release and artifact when it starts. A rollback or
  activation during the request does not change what that request runs or reports.
- Provider prose never creates a release; only the owner's explicit activation does.

## 8. Founder UI (`web/src/pages/Service.tsx`, studio tab "Service")

- **Try:** the version selector shows candidates and the active release. It has:
  - a textarea for pasted text;
  - sample buttons that **only fill the box**;
  - Run, with progress;
  - a result table: field, value, "missing" explained, invalid problems;
  - Copy JSON;
  - a request record: version, digest, status, elapsed time, tokens and exact cost, usage
    state.
- **History:** the last 50 invocations.
- **Continuity (002c1):** the Service view stays mounted across studio tabs, keyed by person,
  project and owner epoch. A request keeps its text, target and key. After a lost answer, the
  main action re-sends the same key ("check", never new work), and a new paid request is a
  separate explicit button. Running requests started here or in another tab are shown, with Stop.
  Polling backs off, stops after a bounded number of tries and pauses while hidden. Losing access
  clears private state.
- **Checks:** the required release checks (read-only) and the founder's own cases, Run checks, and
  results showing expected against actual per field, with errors kept separate from failures.
- **Release:** the active release; candidates with their check status; Release (enabled only
  when current checks pass); and the earlier releases with Roll back.
- With no runtime provider, the page shows the configuration reason, and Run is disabled.

## 9. Tests (all keyless; the provider is either a scripted `RuntimeProvider` or the real `AnthropicRuntime` over an injected transport)

- Validator: every outcome, dates, numbers, unknown and duplicate keys, a partial-valid answer
  is not success.
- Adapter: request shape (closed schema, document as a data string, no tools), the count
  refusal costs zero, the usage band, stop reasons, the key never in errors.
- Invocations: idempotency and conflict, the budget and ceiling, the concurrency bound,
  cancellation keeps unknown cost, restart gives unknown with no re-run, owner-only access,
  the input is not stored, the ledgers stay separate.
- Evaluations: provenance, pass/fail/error separation, not-applicable cases, stale runs.
- Releases: activation needs current passing checks, a stale-owner artifact is refused,
  rollback, and pinning while a request runs.

## 10. Not in this slice

- **Live provider verification** is pending Tony's go-ahead (same plan as `BUILD_RUNTIME.md`).
- **Customer admission and settlement** wait for the M3 entitlements and ledger.
- There is no public endpoint, refresh-persistent trial input, PDF or OCR, multi-document
  support, or reconciliation tooling for unknown runtime costs.
