# Recover when checking import access fails

**Why:** Tony's approachable studio and seamless handover need clear recovery instead of a
request appearing to run forever. Astra reproduced a completed404 followed by a failed access
check leaving the real WorkspaceController in `sending`, `saving`, or `loading` indefinitely.
Read reports/2026-11-03_004a2-003h-independent-review.md.

## What the person sees and does

After a workspace action is refused and its access recheck cannot finish, show a short truthful
message and an explicit retry/check-access action. Preserve valid unsaved input for recovery,
but do not claim it saved or that access definitely ended. Make the retained view's uncertainty
clear and prevent actions from racing an unresolved access check. No automatic retry loop.
On confirmed404 clear everything as004a2 does. On valid current read restore safe actions; on
changed control epoch reset drafts and retire older requests. No permanently disabled saving
button or loading report after the underlying promises settled.

## Underneath

Distinguish `stillMine` results: current, access-ended, retired and unavailable. Settle every
caller (details, dependency, inspection/recovery and report) consistently. Scope fencing and
same-epoch draft/recovery invariants remain. A current retry must not let old promises restore
private state or overwrite input. Preserve the original inspection request key for recovery;
do not silently create a second inspection. Do not broaden server access rules.

## Done when

Controller tests exercise404 then503/network rejection on all four action types, successful
explicit recheck,404 recheck, changed epoch and older answer after revalidation. Verify the
actual page wiring and report exactly what remains for Astra browser repeat. Run check/build,
local bounded commit and report. No other product/server/contract changes unless required for
this recovery path. Then proceed003h1.

Priority P1/S-M.004a2's original access-loss browser reproduction now passes; M4 stays open.
