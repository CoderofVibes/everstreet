# Jobs for Claude

Astra opens a job when Tony wants something built that Astra hands off: anything large, anything
touching `contracts/`, `scripts/`, `config/` or NEAR, or anything Astra would rather not change
itself. One file per job in `docs/astra/jobs/`; one row here. Claude moves the status to `taken`
when it starts and `done` (with the commit) when it lands.

| Date | Job | Status | Notes |
|---|---|---|---|
| 2026-11-02 | [001 Studio foundation](jobs/2026-11-02_001_studio-foundation.md) | done | P0; `0e82986` server, `07d666e` web, report in `reports/2026-11-02_001_studio-foundation.md`; awaiting Astra's browser review |
| 2026-11-02 | [001a Studio review fixes](jobs/2026-11-02_001a_studio-review-fixes.md) | done | P0; `45fc476`, report in `reports/2026-11-02_001a_studio-review-fixes.md`; both corrections passed Astra's browser review (ContinuousDevelopment); other M1 gates still open; Astra reproduced stale history details and 1280px overflow; before 002a |
| 2026-11-02 | [002 AI build runtime](jobs/2026-11-02_002_ai-build-runtime.md) | open | P0; subdivide after 001; real generation, isolated execution, recovery |
| 2026-11-02 | [002a Durable build jobs](jobs/2026-11-02_002a_durable-build-jobs.md) | done | P0; `c0e93ef` server, `108bdb3` web, report in `reports/2026-11-02_002a_durable-build-jobs.md`; corrected by 002a1; durable foundation accepted by Astra for 002b (ACCEPTANCE); parent 002 open; first bounded M2 slice, recovery and budget invariants; no live provider calls |
| 2026-11-02 | [003 Digital business continuity](jobs/2026-11-02_003_digital-business-continuity.md) | open | P0; digital entitlements, finance and NEAR acquisition continuity |
| 2026-11-02 | [002b Guided AI authoring](jobs/2026-11-02_002b_guided-ai-authoring.md) | done | P0; `e491dcc` server, `a6340f4` adapter fixes (Astra early review), `233d2bf` studio, `1c5c28f` runtime doc; report in `reports/2026-11-02_002b_guided-ai-authoring.md`; 158 tests; no live calls; Astra independently passed check (158) and web build 11:41 PT; browser review found 002b1 defects; parent 002 open |
| 2026-11-02 | [002c Managed product runtime](jobs/2026-11-02_002c_managed-product-runtime.md) | open | P0; actual extraction, evaluations, releases and runtime accounting |
| 2026-11-02 | [002a1 Build boundary corrections](jobs/2026-11-02_002a1_build-boundary-corrections.md) | done | P0; `03e29cb`, report in `reports/2026-11-02_002a1_build-boundary-corrections.md`; Astra reran all four reproductions successfully and 112-test check passed 11:08 PT; event pagination and cost labels moved to 002b; four reproduced 002a failures: partial usage, over-limit success, provider identity, expired lease |
| 2026-11-02 | [003a Characterize credit and close](jobs/2026-11-02_003a_characterize-credit-and-close.md) | done | P0; `c825bf9` tests only, report in `reports/2026-11-02_003a_characterize-credit-and-close.md`; Rust 27 / TS 112 passed (TS rerun independently by Astra); characterization, not M3 acceptance; M3 open; after 002a1; tests and report only, no v2 behavior change |
| 2026-11-02 | [003f Operating financials](jobs/2026-11-02_003f_operating-financials.md) | open | P0; correct sources/missing data and useful financial charts; independent of live model credentials |
| 2026-11-02 | [003b Reconcile a close once](jobs/2026-11-02_003b_reconcile-close.md) | done | P0; `edbf920`, report in `reports/2026-11-02_003b_reconcile-close.md`; 184 tests, web build passed; unit evidence only (in-memory chain), no testnet; includes Astra early-review fixes; browser pass pending; 003a reproduced duplicates and lost-response gap; monotonic idempotent app reconciliation |
| 2026-11-02 | [003p Evidence access](jobs/2026-11-02_003p_evidence-access.md) | done | P0; `066bce5`, report in `reports/2026-11-02_003p_evidence-access.md`; 233 tests, web build passed; unit evidence only, browser identity-switch review pending; Astra reproduced in-flight revocation failures on room/export/try; disclosure scopes and browser fencing |
| 2026-11-02 | [003d Digital transfer design](jobs/2026-11-02_003d_digital-transfer-design.md) | open | P0; concrete v3 protocol before code; read-only Claude design review active, see BUILD_STATE |
| 2026-11-02 | [002b1 Conversation browser corrections](jobs/2026-11-02_002b1_conversation-review.md) | done | P0; `18494d9`, plus `ff78c63` long work-log paging (Astra follow-up review); report in `reports/2026-11-02_002b1_conversation-review.md`; 167 tests, web build passed; Astra browser repeat pending; typed-ahead loss, founder style collision, applied proposal copy; Astra independent browser reproduction |

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
