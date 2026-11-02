# 002c independent review

Astra, Nov 2, approximately 13:03 Pacific. Reviewed through `8efd51e`.
No live provider, chain call or real runtime database. The probes below use the actual API
and runtime with in-memory SQLite and explicit scripted providers. Browser assets were built
from the committed implementation and frozen in memory for the QA server.

## Checks that passed

- Independent `npm run check` at12:57: lint/types and all280 tests pass.
- Independent `npm run web:build`: passes; 530kB bundle advisory remains.
- Service with no provider says running is unavailable; no fake output is substituted.
- Scripted service results render declared fields, missing optional values, exact computed
  usage, artifact/model/validator identities and per-request history.

## Corrections required before accepting the keyless slice

### 1. Former owner receives a private response after ownership changes

`server/src/app.ts` POST runtime/invocations authorizes at start, awaits `done`, then calls
`runtime.view(final)` with no final authorization check. Actual reproduction:

1. `runtimeWorld(new ScriptedRuntime(...))`; create founder/project/artifact.
2. Start a trial with a gated provider; wait until the provider is called.
3. Change the business owner to another fictional person in the isolated database.
4. Release the provider gate and inspect the original HTTP response.

Observed: original POST returns201 with outcome extracted and six private fields. A subsequent
GET of that same invocation by the old owner returns404. This is the same final-await gap
already corrected for buyer evidence in003p. Finish and account for the invocation, but fence
the response by the request's authority/owner generation after the final await. Include the
same-key in-flight replay route, and an ownership-away-and-back case.

### 2. An empty-only suite releases a product without processing a document

Save a founder suite with exactly one case: input empty, expected outcome `not_sent`.
Start evaluations through actual `Evaluations.start`, await its completion, then POST releases.
Observed: `release_ready:true`, activation201, provider calls0.

This contradicts002c's requirement to retain an independent curated set as the release check.
Versioned custom tests are valuable, but must supplement rather than replace required release
coverage. Define and enforce the first invoice family's independent required suite/policy.
Founder removal/weakening, accepting every outcome, or saving model output as its own expected
answer cannot erase it. Inapplicable required fields must have an honest blocked state.
Bind policy identity and required fixtures to evaluation and release provenance. Tests-only
quality claims remain limited to the named cases; this is not general accuracy proof.

### 3. Leaving Service loses the pending request and allows an accidental paid repeat

Browser on isolated port8801 with a ten-second scripted extractor:

1. Open Service, click Clean invoice, then Run.
2. Select Preview, then Service while the response is pending.
3. The input is empty and processing state is gone; history shows the original running request.
4. Refill the same sample and Run to recover it.

Observed: two history entries at13:00:16 and13:00:27; total computed usage$0.003000 rather than
one$0.001500 request. The first panel's eventual response is lost. `ServiceView` owns its
`attempt` ref and is unmounted by the tab switch. The same root cause was corrected for the
Assistant in002b2; apply the scoped request-continuity principle here too.

Preserve input, selected immutable version and attempt identity across studio tab changes;
recover running/unknown requests without creating another paid invocation; make a new paid run
an explicit action after recovery. Fence state by actor/project/owner generation. Handle stale
loads and late mutations, clear private state on access loss, keep polling bounded and visibility
aware, and present an honest cancellation/recovery control. Test response loss as well as panel
navigation. Reusing the mutable word `release` should not accidentally switch the pinned target.

Internal screenshot: `C:/Users/antho/.codex/visualizations/2026/11/02/01a19d2e-29f9-7722-8592-187bac300246/m2c-panel-duplicate.jpg`.
This is test evidence, not a live-model demonstration.

## Product follow-through

The new curated/sample invoices still feature craft suppliers. Change the new flagship samples
to fictional digital businesses (hosting, developer tools, AI automation, API services), preserving
the test conditions and exact expected values. Existing historical class fixtures can remain.
Do not let old pottery vocabulary shape the new studio's first usable product.

Read-only Claude adversarial review81985 finished successfully, session
040f07d2-8fc1-43ba-9a89-f321e46811d3. Saved in002c-source-review.md. Its source claims are
not execution evidence. Astra subsequently reproduced two additional findings:

### 4. Same paid request cannot be recovered after changing the active release

Create passing checks, activate, POST a release invocation with keyK, activate another release
record, then repeat the exact same POST body/keyK. Result: first201, retry409 (different request),
one provider call. `release:true` is resolved to the current release before the old idempotency
record is checked. Recover the original pinned request before resolving today's release/model;
still reject a genuinely different request under the same key. An unavailable current provider
must not hide an already-recorded unknown/completed request.

### 5. Overlong output is silently changed into a clean result

The actual API, with a scripted response containing vendor value of2101 characters, returns
`outcome:extracted`, `fulfilled:true`, saved vendor length2000, problems empty. Reject or clearly
mark a non-success result when a declared value exceeds the supported bound; never silently
truncate a customer result and charge it as fulfilled. Probe notes/issues separately and make
truncation policy explicit. Keep any retained output bounded.

### Disposition of other source-review points

- Its H2 (buyer sees historical business runtime records) is **not automatically a defect**:
  PLATFORM_VISION says runtime records belong to the business. Preserve that continuity;
  label business data versus personal material and do not newly redact operational history
  without a product decision. The former-owner late-response defect above is separate.
- Clarify copy: raw pasted input is not retained by default, but extracted values/notes/results
  are retained as business records and may contain source content; explicitly saved test cases
  retain their inputs. Do not imply a privacy guarantee that output storage cannot provide.
- Avoid ambiguity in fictional vendor strings: mark the overall example fictional outside the
  literal vendor field, or document an exact normalization rule. Real-model pass remains unproven.
- Unknown costs must stay conservative; do not invent free HTTP-error billing or release holds
  on guesswork. A supported reconciliation workflow and operating budget lifecycle remain open.
  Existing whole-cent admission is conservative accounting, distinct from exact cost display;
 003f must use the microcent totals. Do not broaden this fix into new spending policy silently.
- Lower-level usage invariants merit explicit tests, but distinguish the supported adapter's
  contract from hypothetical future misbehaving providers. Mandatory suite should not score an
  unrelated invalid answer as proof that unsafe numeric input was handled correctly.

No fullM2 acceptance or live-run claim.
