# Owner-plan setup: independent review evidence

November 5, 2026. Astra reviews003wf4 while sole Claude70487 prepares Phase A. Previous goal turn was progress: full independent check, actual customer-pause UI verification and next-job dispatch. This pass continues with a concrete source counterexample reproduced through existing application routes. No production changes or live transactions.

## Operational timing reproduced before design review

Source: `CustomerUses.readTerms` verifies identity, freshness, release and plan existence but currently does not establish operational usability. `prepare` chooses the smaller of configured serve window and plan hold TTL; signing time subtracts MIN_SERVE_MS (60000) and submit margin. `execute` independently needs runtime.timeoutMs plus executionMarginMs remaining on the hold.

Two finite Node/tsx runs imported the existing `customerWorld` fixture, using the real in-process API and synthetic protection/runtime/reader/writer. Each case used a new in-memory database, changed only the fixture plan TTL, called owner inspection and offer creation, then customer prepare and, where stated, confirm/execute. All databases explicitly closed; both commands exit0 in about1.4seconds. No network, real customer, real signer, production mutation, new test file or persistent test artifact. The fixture plan change is a controlled starting-state injection, not proof of create_plan contract execution.

| Configured case | Owner inspection / offer creation | Customer outcome |
|---|---|---|
| Defaults, hold60000ms | 200 / 201 | prepare409 window_too_short; zero customer request rows |
| Defaults, hold180000ms | 200 / 201 | prepare409 window_too_short; zero request rows |
| Defaults, hold180001ms | 200 / 201 | prepare201; one request row (not a usable human signing window claim) |
| Defaults, hold600000ms | 200 / 201 | prepare201; one request row |
| submit30000, serve240000, runtime timeout60000, hold90000ms | offer created | prepare409 window_too_short; no hold opened |
| Same non-default config, hold90001ms | offer created | prepare201, confirm200, execute409 not_enough_time; one hold opened |
| submit120000, serve600000, runtime timeout300000, hold240000ms | offer created | prepare201, confirm200, execute409 not_enough_time; one hold opened |

The last two cases show why only checking for a positive signing interval is insufficient: an accepted offer can reserve a customer's unit and still have no usable execution interval immediately afterward. No charge/result was claimed or requested after the refused execution. These are independent exploratory reproductions, not newly committed regression tests or a full suite pass for a future fix.

## Default late-authorization case also reproduced

A third finite experiment kept the unmodified default plan (1800000ms TTL), default600000ms serve window and default runtime. Prepare201; advance both synthetic clocks419999ms (one millisecond before the envelope's sign-by); call confirm and hold its existing FixtureWriter submission gate; advance both clocks119999ms (within the configured120000ms submit margin); release the gate. Confirm200/reserved/one hold opened, then immediate execute409 not_enough_time, with60002ms remaining and zero additional runtime invocation rows. Command exit0 in1.22seconds; in-memory DB closed. An earlier diagnostic attempt failed only because it queried the nonexistent table invocations; rerun used the actual runtime_invocations table and measured before/after counts. No product failure was inferred from that diagnostic SQL error.

Thus merely making a longer plan does not fix the accepted latest-signing path: the default serve-window cap still allows submission to consume the execution budget. This is virtual clock advancement at an existing deterministic writer barrier, not a measured real-network latency claim. Execution correctly refuses unsafe work; the design must address admission/readiness and a useful customer recovery, without weakening that refusal.

## Requirements for reviewing Phase A

The proposed compatibility function must distinguish the contract's structural validity, enough time to review/sign/submit, and enough time for actual configured execution plus margin. Account for the interval left when authorization is submitted near its permitted deadline, rather than validating only an immediate confirm. Include meaningful signing/review time in guided defaults. Do not shrink existing safety margins or silently alter immutable existing plans. Evaluate whether a plan with a supported wider window is enough, or the envelope's permitted latest signing time must also account for execution requirements; ground the decision in actual timeLeft/dispatch rules.

Reuse one compatibility policy across guided creation, existing-plan inspection/offer creation, customer prepare and execution readiness where appropriate. Runtime configuration changes can invalidate previous compatibility: a cached review cannot make an old offer permanently usable. Keep existing plan contents visible with an actionable reason; never present a published-but-unusable offer as ready. Preserve precise clock freshness, block/local-time relationship and fail-closed behavior.

Phase B needs durable regression cases for the reproduced boundaries and a supported non-default runtime, plus a late-but-permitted confirmation path proving the intended customer behavior. At each refusal assert no unwanted provider invocation, charge, additional hold or duplicate creation, and verify any already-reserved unit follows the established recovery path. Existing tests should be reused where they prove the exact claim, not replaced with assertions mirroring a new helper.

No change in Tony's scope or permissions. All six milestones, actual worker verification, fresh100/20/80/79 journey and named003wf3 limitations remain. Sole builder70487 is live; no duplicate writer. Files added this pass: this review note; INDEX linkage and BUILD_STATE checkpoint follow when safe. Claude reviews and locally commits after required checks.
