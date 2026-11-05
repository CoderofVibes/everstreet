# Next launch-path slice: owner plan and metering setup

Astra planning, November5,01:08 Pacific. **Not dispatched.** Sole active builder73022 remains on003wf3 managed handover. This records an existing parent003wf requirement; it neither adds external permissions nor narrows any milestone. Reinspect the final Gated implementation before writing the bounded job.

## Product outcome

A founder with a tested release and an already-bound digital business can set a per-use price and customer limits in plain language, review the exact immutable NEAR plan and storage deposit, approve through their own wallet, and recover the same request after a lost answer. The verified plan then feeds the existing customer-offer review. The platform's configured metering grant is a separate explicit reviewed step when missing. Customers can use the published offer only when the actual runtime, release, identity, storage and operator checks pass.

Avoid asking a first-time founder to invent a plan number. Keep the existing inspector available for independently created plans. Do not imply that creating a plan publishes the business, enables an unavailable provider, installs an isolated worker or deploys a contract.

## Source facts inspected at4a5562b

- CustomerOffers.tsx requires a Contract plan number and says the plan was already created on the business's contract.003r deliberately supplied inspection/offer creation, not a wallet plan creator.
- contracts/business-v3 create_plan is owner-only, immutable, disallowed during a live deal, and limited to32 plans. It validates price/purchase/outstanding/hold limits, inserts and flushes the plan, charges measured storage growth, updates control_seq and emits plan_created with plan_id/unit_price. It currently has no reviewed-control argument or dedicated plan-storage quote.
- PlanInput includes unit_price, max_units_per_purchase, max_units_outstanding, max_hold_units, hold_ttl_ms and settle_grace_ms. Rule maxima come from the actual contract, not guessed defaults.
- SaleActions already has a reviewed appoint_operator_guarded path for the configured platform meter. Reuse its identity/recovery patterns and exact authority checks instead of introducing another signing authority. The contract appoint method replaces the target slot's capability mask; it does not union capabilities.
- Parent003wf explicitly retains owner plan/operator setup and the fresh100/20/80/79 journey. Existing synthetic harness bootstrap creates prerequisites; that does not prove a founder-created plan.

## Requirements for the future bounded brief

1. Design the combined plan/meter/offer readiness journey with one useful next action and separately reviewed wallet effects. Read current runtime minima (execution timeout/margin/hold window) so the suggested plan can actually serve the selected product. Distinguish contract-allowed input from operationally usable configuration.
2. Supply a measured, versioned plan-storage capability/quote and contract-side reviewed-state guarantee if needed. A stale owner generation, control sequence, next plan id, live deal or rule/capability change must not silently create another immutable plan than reviewed. Claude owns contract/scripts/config work. No deployment.
3. Represent money as canonical base-unit strings with verified token metadata. Display price, currency, immutable limits, timing, attached NEAR and refund semantics. Validate all contract and runtime constraints before asking the wallet; revalidate at actual execution where the contract must enforce them.
4. Durable operation before wallet invocation, one ask, exact original transaction recovery through reload/account change/process restart. Missing answer or a similar existing plan is not proof of this transaction. Creating a second matching plan is not a recovery method. Prevent duplicate creation across tabs/processes and away-and-back ownership.
5. Confirmation must bind the exact sender/receiver/method/input, affirmative FINAL evidence, returned plan id and matching full plan contents/current binding. Do not rely only on the plan_created event's price or search for a lookalike plan.
6. For metering, review the actual current slot and exact replacement capability mask. If an existing operator has SUPPORT, naming only METERING replaces that mask; explicitly explain any removal, or preserve only deliberately reviewed capabilities. No hidden permission changes. Reuse guarded authority and durable wallet recovery.
7. Connect verified plan selection to existing offer inspection without skipping its independent release/retention/readiness review. Retain drafts after cancellation; reveal exact constraints in readable summaries and technical identifiers in details. Customer and owner privacy boundaries remain.
8. Normal-composition synthetic journey creates the plan and grant through actual encoded calls, then creates an offer and serves a customer. Missing capabilities, older contract, insufficient deposit, immutable-plan cap, stale review, active sale/gate, wallet cancellation/loss, wrong tx and restart/contention each have meaningful tests. Rust-produced fixtures and configured model stay separate evidence layers.
9. Finite browser harness at1440/1280/390 with keyboard/focus and failure/reload recovery. Preserve pending browser permissions. Required npm/check/build and Rust checks where changed; Astra independently reviews before acceptance.

## Prerequisites and retained scope

This slice starts from an already-bound contract and supported wallet configuration. Actual account creation/deployment/provider enabling belongs in the prepared external rehearsal packet and needs its separate authorization. Do not solve it by reading existing credentials or silently configuring real services.

Keep full parent003wf, complete fresh customer100/20/80/79, successor update, unresolved writer history, wider process/migration matrix, all six milestones and approved extensions. No research, live signing/deployment by Astra, external spending/push/release/submission or Day One. This is planning only while003wf3 builds.

## Source refinement — November5,04:00 Pacific

Still not dispatched; soleClaude34616 owns003wf3 continuation5. Rechecked current source while it builds:

- CustomerUse defaults serveWindowMs600000, submitMarginMs120000, executionMarginMs60000 and deliveryTimeoutMs300000. Constructor validates the server window, but an offer's contract plan can shorten it: prepare computes min(server window, plan.hold_ttl_ms), then signBy=local now+window-MIN_SERVE_MS-submitMarginMs. Contract create_plan permits MIN_SERVE_MS60000. Thus a contract-valid60second plan cannot be signed under these defaults. Inspect/create offer's readTerms currently verifies identity/existence/freshness, not this usability threshold. This is a source-derived counterexample to reproduce in the owner-plan job, not a completed failing test.
- Guided setup must derive time bounds from the actual configured execution/submit/delivery constraints and contract rules. Explain insufficient signing/execution time before asking for an immutable plan creation or enabling an offer. Independently created short plans remain inspectable with an actionable unavailable reason. Do not hide the issue by silently changing existing immutable terms or weakening runtime safety margins. Test the exact boundary and a non-default supported runtime configuration, not only the happy default.
- SaleActions appoint currently submits caps=METERING even if the same current-generation slot has SUPPORT; contract appoint replaces the mask. Existing confirmation text also says customers can be served solely because metering was appointed. Carry the explicitly reviewed previous/new capability mask into review/confirmation, and qualify service availability by separate release/runtime/budget evidence. Test SUPPORT-only and METERING|SUPPORT slots, unchanged-state review, stale generation/control and an unavailable runtime. Neither a permission grant nor an offer record alone proves a launched product.
- Contract create_plan returns a u32 plan id; its event includes only id and price. The future operation must verify exact full plan fields/created generation and transaction identity after FINAL, not infer confirmation from that limited event or a similar existing plan. Extend versioned capabilities/quotes through Claude-owned contract work without deployment.

No production files changed in this refinement. It sharpens the already retained owner-plan/operator setup requirement; all roadmap and external boundaries remain.
