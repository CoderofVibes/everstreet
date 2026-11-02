# Jobs for Claude

Astra opens a job when Tony wants something built that Astra hands off: anything large, anything
touching `contracts/`, `scripts/`, `config/` or NEAR, or anything Astra would rather not change
itself. One file per job in `docs/astra/jobs/`; one row here. Claude moves the status to `taken`
when it starts and `done` (with the commit) when it lands.

| Date | Job | Status | Notes |
|---|---|---|---|
| 2026-11-02 | [001 Studio foundation](jobs/2026-11-02_001_studio-foundation.md) | done | P0; `0e82986` server, `07d666e` web, report in `reports/2026-11-02_001_studio-foundation.md`; awaiting Astra's browser review |
| 2026-11-02 | [001a Studio review fixes](jobs/2026-11-02_001a_studio-review-fixes.md) | done | P0; `45fc476`, report in `reports/2026-11-02_001a_studio-review-fixes.md`; browser acceptance pending; Astra reproduced stale history details and 1280px overflow; before 002a |
| 2026-11-02 | [002 AI build runtime](jobs/2026-11-02_002_ai-build-runtime.md) | open | P0; subdivide after 001; real generation, isolated execution, recovery |
| 2026-11-02 | [002a Durable build jobs](jobs/2026-11-02_002a_durable-build-jobs.md) | taken | P0; Claude building; first bounded M2 slice, recovery and budget invariants; no live provider calls |
| 2026-11-02 | [003 Digital business continuity](jobs/2026-11-02_003_digital-business-continuity.md) | open | P0; digital entitlements, finance and NEAR acquisition continuity |

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
