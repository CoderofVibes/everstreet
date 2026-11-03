# Demand review and the read-only NEAR transport

Tony: "Keep going if Claude is done please". Exec8422 completed its full assigned sequence at
ed36b95. Astra reviewed reports/source, independently ran checks and browser flows, and prepared
the next bounded sequence. See reports/2026-11-03_demand-and-recovery-review.md.

The opportunities-to-private-studio happy path and exact lost-reply retry work. Import access
recheck recovery now works in the browser.005a1 corrects recovery after typing and unsanitized
request metadata.002a2 addresses a reproduced intermittent verification failure.003i then builds
the actual read-only testnet HTTP adapter with synthetic tests and an observation-format upgrade.

Changed this pass: this file, INDEX/JOBS/ACCEPTANCE, the independent report, and three new jobs.
BUILD_STATE remains local. Disposable preview/reproduction files removed; no product-code or Git
writes by Astra. Claude reviews/commits the handoff and implements002a2 ->005a1 ->003i, then stops
for review. No new external decision, model spending, signing, deployment or public release.

All six milestones remain open. The digital builder audience, approachable studio, customer
continuity and NEAR acquisition remain the roadmap; no complete walkthrough delivered yet.
