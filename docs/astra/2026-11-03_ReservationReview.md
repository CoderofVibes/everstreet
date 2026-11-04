# Reservation review and customer execution handoff

Tony's vision remains the approachable AI studio, digital products, and "seamless purchase and
transfer of business/product ... on NEAR" with customer continuity. All six milestones remain
open; no scope cuts or routine design approval requested.

Prior Claude exec99583 completed exit0. HEAD5bb81a0 initially clean; protocol correction
eed4405 and reservation implementation6ac4bc7 reviewed. Main session absent from readable
process inventory. Independent594 tests/45files plus lint/types pass; web build passes with
635.08kB advisory. Independent70 v3 keyless contract tests pass, including actual owner-without-
grant, unrelated Gated metering account, no blanket freeze and signing/root fixture cases.

003m now has real injected API preparation, customer signatures verified against canonical
bytes, exact reservation readback, durable allocations/lease CAS and restart recovery. It is
not wired in main and has no provider dispatch, unit settlement or customer UI. Chain test
doubles are labelled and do not prove live transactions or wallet identity.

Three independent finite API probes reproduced unsafe evidence decisions: historical first
readback below preparation returned refused even though the writer opened one hold; a changed
hash/contradictory view at the same evidence height terminalized instead of staying uncertain;
and an expired active hold reported serving:true. Tests took126ms and all three expected safe
assertions failed. Temporary server/test/astra-customer-probe.test.ts removed after reproduction;
003m1 records exact setups for permanent regression tests. No existing test/code was mutated.

Source review also flagged writer-network matching, meters() owner-policy inconsistency and
future protection-retry/result-disclosure concerns. These are requirements for the next slices,
not claims that each has been independently reproduced. Block-timestamp assumption A1 remains
explicitly unverified for a live adapter. No live connection is enabled.

Browser regression: existing disposable Gated-closing page shows both acceptances and closer
deadline, updates core block187310002 ->187310004 on refresh while preserving November's own
block187310002. Visual status inspected. No new UI shipped in003m. Preview exec73127 stopped,
tab8 closed; no runtime data or external calls used.

Opened003m1 evidence/readiness corrections, then003n durable customer execution with private
results and separate provider-cost accounting. Settlement/release and customer UI remain later
bounded slices. Claude reviews the six tracked docs (this pass, two jobs, JOBS, INDEX, ACCEPTANCE)
and commits locally. BUILD_STATE is local orchestration. No Astra Git writes, signing, deploy,
spending, research assessment or publishing. First full creative walkthrough stays after buildout.
