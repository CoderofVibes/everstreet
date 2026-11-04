# Customer protocol review

Tony's direction remains: "the seamless purchase and transfer of business/product to the
investor/acquirer, on NEAR" stays central, alongside the approachable AI studio and digital
business marketplace. All six milestones stay open. No new scope or release decision requested.

## Verified this pass

Previous Claude run73602 completed; HEAD e0ba6aa initially clean.003j2 code1dd2e02,
003k1 code4eb2f6a,003l fixtures/design f456c69. Independent npm run check passed566 tests in
43 files plus lint/types. Independent web build passed (635.08kB bundle advisory). Keyless
WSL business-v3 unit tests independently passed65 including actual serialized-view and customer
readback fixture tests. First attempt was sandbox denied; elevated attempt from repo root had
no Cargo.toml; corrected contracts workspace passed. Neither error was a failing contract test.

003j2 repeated in an isolated in-memory browser preview: refresh404/access503, malformed access
reply, then valid access retry. The original evidence time stays8:34:50PM, refresh re-enables,
and role=status now reads "Access confirmed. The evidence shown is unchanged, with its original
time; you can refresh again." Obsolete blocking notice disappears. Screenshot visually checked.
Preview exec80309 stopped, tab7 closed, temporary server/test wrapper removed. No live data/calls.

003k1 report/source/fixtures reviewed: exact identity precedes terminal outcomes; revised outcome
supersedes old intent; mismatched same-version identity conflicts. API evidence includes Gated
close, listing/grant/pending-room revocation, import ownership and inquiry continuity, plus DB
migration/restart and concurrent reconciliation. Inquiry continuity is not customer runtime proof.
The hypothesized apply-path CAS race was not reproduced; Claude documented why and left it.

003l fixture method outputs independently pass, but its design is not ready unchanged for
admission. require_metering retains owner authority without a grant; Gated validates any metering
account, not a platform identity. A blanket accepting freeze could stop service for30days. The
prepare/sign sequence, canonical payload, exact readback, complete closed-root history and crash
semantics need specification. Expiry and an unmatched closed root do not prove no prior charge.
Revocation and provider dispatch cannot be described as atomically observable. These are source
review findings about a proposed protocol, not failures in a shipped customer-use runtime.

## Handoff and files

- New job003l1 corrects the concrete protocol and proves authority distinctions with fixtures.
- New job003m builds durable prepare/confirm/reservation only, through injected transports and
  real API tests. Provider execution/settlement/customer UI follow independent review.
- JOBS records those jobs and003j2 browser acceptance; INDEX links this pass; ACCEPTANCE records
  independent evidence without accepting a whole milestone. Local BUILD_STATE records execution.

Claude reviews/commits the six tracked documentation files before implementation. Astra makes
no Git writes. No signs, deployment, live provider calls, spending, research assessment or public
release. The complete creative walkthrough remains after the full buildout.
