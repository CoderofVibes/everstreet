I found no critical defect in the paid-dispatch core. The serious problems are in the release gate, ownership after a sale, retention, and idempotent retry. This is a static review only: I ran nothing, and I edited, committed and called nothing. Where I say "proven" below, that comes from reading the code.

## High

**H1. A trivial or empty suite can unlock a release.** This is a source defect.
- **Where:** `evaluations.ts:129-171` (`parseCases` only needs 1 case); `evaluations.ts:456-464` (any 400 from `runtime.start` counts as `not_sent`); `evaluations.ts:221-224` (`not_sent` passes if it was expected); `evaluations.ts:518` (`passed === total`); `releases.ts:70-77`.
- **Reproduce:**
  1. POST test-cases `{cases:[{id:"x",name:"x",input:"",expect:{outcomes:["not_sent"]}}], base_version:null}`.
  2. POST evaluations. The empty text is refused with a 400 and the case scores pass. The run is complete at 1/1 and `release_ready`.
  3. POST releases. It activates, and **the model was never called**.
- **Same hole, other forms:** `outcomes:["extracted","incomplete","refused","invalid"]` with no fields passes any answer, including an `invalid` one.
- **Why it matters:** the job says to keep "an independent curated set as the release check". Nothing in the gate requires the curated suite, at least one paid case, or an `extracted` expectation.
- **Why tests miss it:** `runtime-releases.test.ts` only ever adopts the curated suite.

**H2. Nothing fences ownership after a sale, so the buyer sees the seller's runtime results.** The behaviour is proven; whether it's acceptable is a privacy policy call.
- **Where:**
  - `invocations.ts:631-636`: `owned()` only checks the *current* owner. `owner_id` and `owner_generation` are stored at `:450-451` but never read anywhere.
  - `:643-649`: `list` returns the last 50 regardless of who ran them.
  - `:509-516` and `:530-540`: `finish` writes the result after the `await` with no check of who owns the business now.
  - `deals.ts:847-893`: closing a sale touches nothing in the runtime. It even resets `value_settings` with the comment "the seller's own work… were theirs". `runtime_budgets` is not reset, so the buyer inherits the seller's spending limit.
- **Reproduce:**
  1. The seller runs a trial on a real-looking invoice.
  2. The sale closes.
  3. The buyer opens GET `/api/product-projects/:id/runtime` or `/api/runtime/invocations/:id` and sees the extracted fields.
- **In-flight variant:** a seller request that is still running when the sale closes finishes afterwards, lands in the buyer's history, and is charged to the budget the buyer now holds.
- **Evaluations are fine here:** a run cut across a sale stops at its next case with a 404.
- **Why tests miss it:** the only transfer test (`runtime-releases.test.ts:348-376`) covers activation.

**H3. "The pasted text is not kept" overstates what is retained.** Source defect plus a scope gap.
- **Where:** `invocations.ts:597` stores the validated output indefinitely; `:675` shows the claim in the UI note. `extract.ts:48,55,148,173` allows up to 30 fields × 2,000 characters, plus 300-character notes and 10 issues of 300 characters.
- **Problem:** a model's values, notes and issues can echo the document, or most of it if a text field is broad. There is no expiry and no delete.
- **Reproduce:** use a spec with a text field such as "description". The model returns the body verbatim, and it is stored and served.
- **Why tests miss it:** the test at `runtime-invocations.test.ts:57-68` uses a scripted fixed reply that never echoes the input. A real model would at least echo `invoice_number`.

## Medium

**M1. An identical retry can get a 409 instead of the original paid record.** Source defect.
- **Where:** `invocations.ts:344-360`. The active release and config are resolved *before* the idempotency lookup at `:381`, and the fingerprint at `:366-368` uses the *current* release id.
- **Reproduce:**
  1. POST `{key:K, release:true}`. It pins R1 and is running, or its response is lost.
  2. The owner activates R2 or rolls back.
  3. The client retries the identical body with K and gets 409 "already used for a different request".
- **After a restart with a changed config:** the retry gets 409 "model changed" and never sees the `unknown` record. That is exactly the lost-response case idempotency exists for.
- **Why tests miss it:** the pinning test (`runtime-releases.test.ts:270-298`) uses different keys.

**M2. The curated suite probably can't pass with a faithful live model.** This is a hypothesis about model behaviour.
- **Where:** the inputs say "Juniper Print Supply (fictional)" and "Northwind Clay (fictional)" (`evaluations.ts:46`, `:95`), but the expected values omit "(fictional)" (`:50`, `:98`).
- **Why it conflicts:** the prompt says "as text exactly as you read it" (`runtime.ts:117`), and `same()` compares trimmed text exactly (`evaluations.ts:203`). The likely result is that `clean` and `embedded_instructions` fail. That makes the release gate unreachable live, and pushes founders to edit the expected answers.
- **Why tests miss it:** the scripted `correct()` returns the expected strings (`runtime-releases.test.ts:38,51`).

**M3. Unknown-cost holds are permanent, over-broad, and come out of a shared lifetime ceiling.** Part scope gap, part hypothesis about how 4xx responses are billed.
- **Every non-200 becomes "unknown":** `runtime.ts:245-246` turns any non-200 from `/v1/messages` into null usage. That includes 400, 401, 413, 429 and 529 rejections.
- **Restart can't tell free from paid:** `dispatched_at` is set at reservation (`invocations.ts:461`), before the free `count_tokens` call. So `recover()` (`:171-185`) holds money even for requests that never reached the paid call.
- **The ceiling is shared and lifetime:** it is an all-time sum across every business (`:415-420`), and one business's budget can equal the whole ceiling (`:305-307`).
- **Reproduce:** cancel repeatedly right after dispatch, or hit a 429 streak. Each leaves a permanent worst-case hold, about 8¢ on Sonnet. Roughly ceiling ÷ 8 of these blocks every business on the platform.
- **Missing pieces:** reconciliation is listed as out of scope in §10, but a per-business share of the ceiling is not.

**M4. Budget arithmetic overstates spend.**
- **Where:** each row's charge is rounded up to whole cents (`invocations.ts:583`), and a partial row counts both its hold and its charge (`:270-272`, `:409-410`).
- **Effect:** a Haiku request costing about 0.02¢ counts as 1¢. It's conservative, not unsafe, but "available" is inaccurate.

## Low

- `huge_amount` accepts `invalid` for *any* reason, because `score()` skips field comparison when the outcome isn't extracted or incomplete (`evaluations.ts:115`, `:244`). A model that returns bad dates passes it. The run view also has no separate count of invalid answers, though the design says schema validity is shown separately (§6).
- An unparseable or cut-off answer (`bad_answer`, `runtime.ts:278-296`) scores as `error`, not as a schema or quality failure.
- When nothing is configured, `configNow()` returns null, and that shows up as "model changed" (`invocations.ts:157`, `:354-358`; `evaluations.ts:514`). The reason given is misleading.
- `finish` trusts the provider's `final` flag and doesn't check usage against the reservation (`invocations.ts:568-585`). Only `AnthropicRuntime` enforces the bounds.
- A `not_sent` failure with null usage records "Sent, but no usage" and keeps the hold (`invocations.ts:524-529`, `:582`).
- Text values are silently truncated to 2,000 characters and still count as `extracted` (`extract.ts:173`).
- The doc says the curated suite covers every case in the job's table (`MANAGED_RUNTIME.md:110`), but the over-limit and cancelled cases are missing.
- `eval_fixtures` has no delete trigger (`db.ts:383`); only updates are blocked.
- The runtime identity embeds the *build* `configVersion` (`runtime.ts:156`). A build-only config change makes every release stale.

## What I checked and found sound

- **Budget, concurrency and reservation races:** `BEGIN IMMEDIATE` on synchronous SQLite in one process (`store.ts:131`).
- **Restart:** a running request is never re-run.
- **Cancel during `count_tokens`:** it frees the hold correctly.
- **Activation provenance:** owner epoch of the artifact, the run bound to its job and digest, and currency of validator, config and fixtures.
- **Pinning and rollback:** both recheck currency.
- **Stored records:** the input text is absent from rows and events.
- **Access:** every read path is owner-only.

## Limits

- I read the sources, the three focused tests and part of `runtime-world.ts`.
- I did not read the web UI, the build budget code, or anything that would assume more than one server process.
- I didn't verify the API's behaviour for `output_config.format` with `anyOf`, `thinking: between_tools`, or how non-200 responses are billed.

There was no Write or ExitPlanMode tool in this session, so the findings are here and no plan file was written.
