# Distinguish scheduled maintenance from a completed pass

**Why:** A founder must know whether customer obligations will advance without another action.

003t1 correctly qualifies automatic settlement by worker health, but its report explicitly notes
that one manual runPass() publishes running for three intervals. `maintenance.ts` publishes
running at pass entry and finish regardless of whether start() scheduled another pass. Thus a
completed one-off pass makes books say units settle "by itself" even though no future work is
scheduled. This is source/report-confirmed; the approved browser preview subsequently showed
overdue after its one-off setup passes. No live service was started.

Preserve separate facts: a pass ran recently, an active holder has scheduling enabled, work is
currently in flight, and scheduling stopped/overdue/unknown. Avoid exposing private holder IDs.
Only a current, generation-fenced scheduled worker may support automatic-processing copy.
Manual-pass completion is useful evidence, not an ongoing service guarantee. Standby start/stop,
crash/takeover, stop during pass and late completion must keep002d1 fencing/fairness intact.

First add a finite reproduction: construct supervisor without start(), await runPass(), inspect
owner books/readiness; it must not promise automatic settlement. Scheduled start plus actual
pass should support qualified running, then stop removes it; pass after stop doesn't restart the
schedule. Keep one-off preview controls useful and explicit. Check migration of existing health
rows conservatively. No provider calls, new authority, actual scheduler startup in main or
financial side effects from reads. Update projection/copy/tests/design; npm check/webbuild,
local commit/report, then003u. P1/S-M; all milestones open.
