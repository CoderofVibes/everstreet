# Jobs for Claude

Astra opens a job when Tony wants something built that Astra hands off: anything large, anything
touching `contracts/`, `scripts/`, `config/` or NEAR, or anything Astra would rather not change
itself. One file per job in `docs/astra/jobs/`; one row here. Claude moves the status to `taken`
when it starts and `done` (with the commit) when it lands.

| Date | Job | Status | Notes |
|---|---|---|---|
| 2026-11-03 | [004a3 Import recheck recovery](jobs/2026-11-03_004a3_import-recheck-recovery.md) | open | P1/S-M; independently reproduced completed404 + failed recheck leaving sending/saving/loading indefinitely; after004a2 browser access-loss pass |
| 2026-11-03 | [003h1 Observation coverage and coherence](jobs/2026-11-03_003h1_observation-coverage-and-coherence.md) | open | P1/M; no-period then same-block period produces false sticky conflict; equal-sequence owner change accepted; bounded correction before reconciliation |
| 2026-11-03 | [005a Demand into studio](jobs/2026-11-03_005a_demand-to-studio.md) | open | P1/M-L; published digital requests become private editable projects with provenance and exact retry; extend existing needs, no automatic contact/build/publishing; after003h1 |
| 2026-11-03 | [004a2 Import access invalidation](jobs/2026-11-03_004a2_import-access-invalidation.md) | review | P1/M; `f1d682a`, report in `reports/2026-11-03_004a2_import-access-invalidation.md`; 385 tests, web build passed; Astra browser inspection/save/report access-loss repeat passed;004a3 failed-recheck recovery remains; original defect was cached private state after inspection404; scoped invalidation and late-answer fencing;004a1 draft/recovery repeat passes |
| 2026-11-03 | [003h V3 observation foundation](jobs/2026-11-03_003h_v3-observation-foundation.md) | review | P1/M-L; `8041156` note, `8d4bda8` fixtures, `2e4d317` reader/service/API/tests, report in `reports/2026-11-03_003h_v3-observation-foundation.md`; 401 tests, v3 64 unit tests, clippy clean, web build passed; API tests on Rust unit-produced JSON only, no transport implementation, live read or UI; Astra reproduced false period-coverage conflict and equal-sequence owner change;003h1 required; flags sticky with no clearing path; no reconciliation, closer or M3 acceptance; strict read-only v3 decoder, pinned-block observations and durable monotonic projection; owner-only API with injected bindings |
| 2026-11-03 | [004a1 Import draft continuity](jobs/2026-11-03_004a1_import-draft-continuity.md) | review | P1/M; `65c4a56`, report in `reports/2026-11-03_004a1_import-draft-continuity.md`; 373 tests, web build passed; browser repeat pending; Astra reproduced product/dependency draft loss across tabs; request-order/recovery and keyboard corrections; see004a browser review |
| 2026-11-03 | [003g Sale core](jobs/2026-11-03_003g_sale-core.md) | review | P0/L; `03de48d` design, `ed453b9` contract, `a7e6176` tests, report in `reports/2026-11-03_003g_sale-core.md`; v3 63 / v2 27 unit tests, clippy clean, root check 373; unit evidence only, not live or end-to-end; actual contract sale/close in keyless tests; reviewed candidate with required record pins, payment categories, floor/expiry and storage corrections; after004a1; no integration or M3 acceptance |
| 2026-11-02 | [002c3 Recovery capacity](jobs/2026-11-02_002c3_recovery-capacity-and-capability-copy.md) | done | P1/S; `1733995`, report in `reports/2026-11-02_002c3_recovery-capacity-and-capability-copy.md`; 346 tests, web build passed; browser repeat pending; independently reproduced unresolved request eviction at capacity; truthful Home/Build capability copy |
| 2026-11-02 | [003f2 Zero observation source](jobs/2026-11-02_003f2_zero-observation-source.md) | done | P1/S; `a58c13a`, report in `reports/2026-11-02_003f2_zero-observation-source.md`; 349 tests, web build passed; browser repeat pending; observed zero loses source badge in owner table; preserve buyer provenance too |
| 2026-11-02 | [003e1 Core review corrections](jobs/2026-11-02_003e1_core-review-corrections.md) | review | P0/M; `a0d3716` contract, `f2def66` tests, `c1dfebf` note, report in `reports/2026-11-03_003e1_core-review-corrections.md`; weak-key forgery REPRODUCED in pinned unit host and fixed with the host's own decoder; v3 38 / v2 27 unit tests, clippy clean, root check 349; unit/injected evidence only; bounded deadlines, exact readback, claim categories, source overflow flags, payout capacity; weak-key hypothesis requires pinned reproduction first |
| 2026-11-02 | [004a Existing product intake](jobs/2026-11-02_004a_existing-product-intake.md) | review | P1/M-L; `109fa40` server, `f5b9fed` UI, report in `reports/2026-11-03_004a_existing-product-intake.md`; 361 tests (12 new API), web build passed; browser 1440/1280/390 review pending; nothing verified, no remote connectors; genuine supplied-manifest inspection, persistent private import and dependency readiness; external connectors later; M4 open |
| 2026-11-02 | [002c2 Recover while drafting](jobs/2026-11-02_002c2_runtime-recovery-draft.md) | done | P0/S; `2c38d57`, report in `reports/2026-11-02_002c2_runtime-recovery-draft.md`; 320 tests, web build passed; browser repeat pending; browser recovery disappears when typed-ahead text differs; same-text retry is independently verified |
| 2026-11-02 | [003f1 Financial review corrections](jobs/2026-11-02_003f1_financial-review-corrections.md) | done | P0/M–L; `c5f52fd` server, `ad99167` UI, report in `reports/2026-11-02_003f1_financial-review-corrections.md`; 343 tests, web build passed; browser 1280/1440/390 repeat pending; five independent server reproductions, mobile table overflow and source-reviewed precision/provenance issues |
| 2026-11-02 | [003e Entitlement contract core](jobs/2026-11-02_003e_entitlement-contract-core.md) | review | P0/L; `699ad4c` note, `9cf500b` crate, `bc9c653` tests, report in `reports/2026-11-02_003e_entitlement-contract-core.md`; business-v3 26 / v2 27 unit tests, clippy clean, root check 343; keyless unit VM only, injected ownership, missing callbacks stay pending; awaiting Astra review; no managed-close/recovery acceptance or v2 migration; M3 open |
| 2026-11-02 | [002c1 Runtime review corrections](jobs/2026-11-02_002c1_runtime-review-corrections.md) | done | P0; `3732fef` server, `50a002c` Service continuity/UI, report in `reports/2026-11-02_002c1_runtime-corrections.md`; 295 tests, web build passed; browser repeat and live gate pending; Astra reproduced late former-owner disclosure, empty-only release bypass, and lost pending request across Service tabs; see independent review |
| 2026-11-02 | [001 Studio foundation](jobs/2026-11-02_001_studio-foundation.md) | done | P0; `0e82986` server, `07d666e` web, report in `reports/2026-11-02_001_studio-foundation.md`; awaiting Astra's browser review |
| 2026-11-02 | [001a Studio review fixes](jobs/2026-11-02_001a_studio-review-fixes.md) | done | P0; `45fc476`, report in `reports/2026-11-02_001a_studio-review-fixes.md`; both corrections passed Astra's browser review (ContinuousDevelopment); other M1 gates still open; Astra reproduced stale history details and 1280px overflow; before 002a |
| 2026-11-02 | [002 AI build runtime](jobs/2026-11-02_002_ai-build-runtime.md) | open | P0; subdivide after 001; real generation, isolated execution, recovery |
| 2026-11-02 | [002a Durable build jobs](jobs/2026-11-02_002a_durable-build-jobs.md) | done | P0; `c0e93ef` server, `108bdb3` web, report in `reports/2026-11-02_002a_durable-build-jobs.md`; corrected by 002a1; durable foundation accepted by Astra for 002b (ACCEPTANCE); parent 002 open; first bounded M2 slice, recovery and budget invariants; no live provider calls |
| 2026-11-02 | [003 Digital business continuity](jobs/2026-11-02_003_digital-business-continuity.md) | open | P0; digital entitlements, finance and NEAR acquisition continuity |
| 2026-11-02 | [002b Guided AI authoring](jobs/2026-11-02_002b_guided-ai-authoring.md) | done | P0; `e491dcc` server, `a6340f4` adapter fixes (Astra early review), `233d2bf` studio, `1c5c28f` runtime doc; report in `reports/2026-11-02_002b_guided-ai-authoring.md`; 158 tests; no live calls; Astra independently passed check (158) and web build 11:41 PT; browser review found 002b1 defects; parent 002 open |
| 2026-11-02 | [002c Managed product runtime](jobs/2026-11-02_002c_managed-product-runtime.md) | review | P0; keyless capability built: `76e0120`, `dab0782`, `76a9a62`, `a1ce4e9` plus restart fix with report `reports/2026-11-02_002c_managed-runtime.md`; 280 tests, web build passed; injected transports only; live provider run and browser review pending; M2 open; actual extraction, evaluations, releases and runtime accounting |
| 2026-11-02 | [002a1 Build boundary corrections](jobs/2026-11-02_002a1_build-boundary-corrections.md) | done | P0; `03e29cb`, report in `reports/2026-11-02_002a1_build-boundary-corrections.md`; Astra reran all four reproductions successfully and 112-test check passed 11:08 PT; event pagination and cost labels moved to 002b; four reproduced 002a failures: partial usage, over-limit success, provider identity, expired lease |
| 2026-11-02 | [003a Characterize credit and close](jobs/2026-11-02_003a_characterize-credit-and-close.md) | done | P0; `c825bf9` tests only, report in `reports/2026-11-02_003a_characterize-credit-and-close.md`; Rust 27 / TS 112 passed (TS rerun independently by Astra); characterization, not M3 acceptance; M3 open; after 002a1; tests and report only, no v2 behavior change |
| 2026-11-02 | [003f Operating financials](jobs/2026-11-02_003f_operating-financials.md) | review | P0; `2b6dd69` server semantics, `197a749` charts/views, report in `reports/2026-11-02_003f_operating-financials.md`; 319 tests, web build passed; browser review pending; M3 ledger reconciliation pending; correct sources/missing data and useful financial charts; independent of live model credentials |
| 2026-11-02 | [003b Reconcile a close once](jobs/2026-11-02_003b_reconcile-close.md) | done | P0; `edbf920`, report in `reports/2026-11-02_003b_reconcile-close.md`; 184 tests, web build passed; unit evidence only (in-memory chain), no testnet; includes Astra early-review fixes; browser pass pending; 003a reproduced duplicates and lost-response gap; monotonic idempotent app reconciliation |
| 2026-11-02 | [003p Evidence access](jobs/2026-11-02_003p_evidence-access.md) | done | P0; `066bce5`, report in `reports/2026-11-02_003p_evidence-access.md`; 233 tests, web build passed; unit evidence only, browser identity-switch review pending; Astra reproduced in-flight revocation failures on room/export/try; disclosure scopes and browser fencing |
| 2026-11-02 | [003d Digital transfer design](jobs/2026-11-02_003d_digital-transfer-design.md) | open | P0; concrete v3 protocol before code; read-only Claude design review active, see BUILD_STATE |
| 2026-11-02 | [002b1 Conversation browser corrections](jobs/2026-11-02_002b1_conversation-review.md) | done | P0; `18494d9`, plus `ff78c63` long work-log paging (Astra follow-up review); report in `reports/2026-11-02_002b1_conversation-review.md`; 167 tests, web build passed; Astra browser repeat pending; typed-ahead loss, founder style collision, applied proposal copy; Astra independent browser reproduction |
| 2026-11-02 | [002b2 Panel continuity](jobs/2026-11-02_002b2_panel-state.md) | done | P0/S; `0573248`, report in `reports/2026-11-02_002b2_panel-state.md`; 237 tests, web build passed; browser repeat pending; after current003b/003p pass, before002c; independent panel-switch loss in reports/2026-11-02_002b-panel-review.md |

## Job file format

`docs/astra/jobs/<YYYY-MM-DD>_<slug>.md`:

```markdown
# <Short name>

**Why (Tony's words):** "<quote from the session>"

## What the person sees and does
<the screens, the steps, the words on them>

## Underneath
<data, server, contract or NEAR work; files you checked>

## Done when
<what Tony can try to see it working>

## Not in this job
<what to leave out>

## Priority and size
<order among open jobs; S / M / L>
```

