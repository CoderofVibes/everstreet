# Demand-to-studio and recovery: independent review

Astra, November3, HEAD ed36b95. Exec8422 finished exit0. Git status initially clean.

## Checks

Independent full check: lint/types pass,467/468 tests pass. Existing flood test at
server/test/builds-boundary.test.ts:515 expected stream_limit but received timeout. Claude had
reported the same intermittent failure during004a3. All20 boundary tests passed in isolation.
This is unresolved test timing interference, not a clean full-suite pass;002a2 addresses it.
After the docs handoff and temporary-script cleanup, a second independent full check passed all468
tests/37 files, lint/types. The intermittent failure is still unresolved;002a2 remains necessary.
Independent web build passes with607.16kB advisory. No Rust files changed in003h1; not rerun.

## Browser evidence

Disposable in-memory Hono/API and compiled app; fictional Mara/Noah only, no runtime files.

- Opportunities shows the two posted digital requests, price limit, no-replies state and distinct
  reply/build actions. Opening review, choosing a name and creating opens the existing studio
  at revision1, prototype-labelled, with source context and undecided product pricing.
- Expanded source context shows the captured public request and date, open status and stated
  budget. AI unavailable remains honest; no model call started.
- Simulated503 AFTER committed creation: same-input Create again recovers the exact project.
  Fixture counters after one normal and one lost-reply creation: projects2, responses0.
- Reproduced weakness: editing the name while that result is unknown removes the same-request
  recovery action. Only Create project remains, which mints another key. Copy simultaneously
  promises same-request retry and says it is a new request. Restoring the old name manually
  allows recovery; this is not an approachable recovery experience.005a1 must preserve the
  original attempt independently from the draft and handle late success without losing edits.
- Review page contained horizontally at1440 (1425/1425),1280 (1265/1265),390 (375/375).
  Desktop/mobile screenshots inspected. Radio keyboard action focused a radio, but selection was
  not independently confirmed; don't count full keyboard acceptance. Internal1280 screenshot
  saved as opportunity-review-005a-1280.png in the chat visualization directory.
-004a3 browser: details save404 then access GET503 settles, shows Access not confirmed,
  disables save and preserves text. Typing remains possible. Check access succeeds, banner
  disappears and save re-enables with the newer text intact. Other action paths have24 controller
  tests independently passed earlier; not all repeated in browser this pass.

## Independently reproduced boundary gap

Real API in memory: POST /api/needs with constraints containing family software, negative
max_price_cents, extra contact field (fictional@example.invalid) and10,000-character payload
returns201. The public opportunities API returns all keys. Creating from that request returns201
and copies all keys including contact and the entire payload into project source constraints.

This inherits an unsanitized Community input but contradicts005a's bounded provenance and
not-kept-contact promise. Need constraints must be validated at input and projected through a
strict allowed-field boundary, including preexisting records. Don't trust TypeScript casts.
No real personal data was involved.005a1 covers this correction too.

## Observation review and next work

003h1 separates optional period evidence from core digest and adds contract-backed coherence
checks. All48 observation tests passed in the full run. Focused source review supports moving to
a read-only HTTP adapter, not live/integration acceptance. Existing003h-era digests need an
idempotent migration before real integration; Claude's report explicitly leaves them incompatible.

Next sequence002a2 deterministic flood verification ->005a1 recovery/input boundary ->003i
read-only testnet transport with synthetic HTTP tests and local observation migration. No live
RPC call, signing, owner reconciliation, public release or milestone completion this pass.
All six milestones remain in scope. Temporary preview process and scripts were removed.
