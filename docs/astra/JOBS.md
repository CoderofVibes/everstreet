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
| 2026-11-02 | [002a Durable build jobs](jobs/2026-11-02_002a_durable-build-jobs.md) | done | P0; `c0e93ef` server, `108bdb3` web, report in `reports/2026-11-02_002a_durable-build-jobs.md`; Astra review pending; parent 002 open; first bounded M2 slice, recovery and budget invariants; no live provider calls |
| 2026-11-02 | [003 Digital business continuity](jobs/2026-11-02_003_digital-business-continuity.md) | open | P0; digital entitlements, finance and NEAR acquisition continuity |
| 2026-11-02 | [002b Guided AI authoring](jobs/2026-11-02_002b_guided-ai-authoring.md) | open | P0; after 002a review; conversation, proposals and bounded provider adapter |
| 2026-11-02 | [002c Managed product runtime](jobs/2026-11-02_002c_managed-product-runtime.md) | open | P0; actual extraction, evaluations, releases and runtime accounting |
| 2026-11-02 | [002a1 Build boundary corrections](jobs/2026-11-02_002a1_build-boundary-corrections.md) | taken | P0; Claude building; four reproduced 002a failures: partial usage, over-limit success, provider identity, expired lease |
| 2026-11-02 | [003a Characterize credit and close](jobs/2026-11-02_003a_characterize-credit-and-close.md) | open | P0; after 002a1; tests and report only, no v2 behavior change |
| 2026-11-02 | [003f Operating financials](jobs/2026-11-02_003f_operating-financials.md) | open | P0; correct sources/missing data and useful financial charts; independent of live model credentials |

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
