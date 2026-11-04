# Acquisition history: current sale must stand on its own evidence

Tony approved fictional Ledgerline permission tests in the disposable local preview. That
approval remains limited to synthetic access changes. The active implementation is Claude
session e4e8b4ab-9fdf-40cd-90ca-4eefc88a03aa, exec89449, job001i. No second writer launched.

## Independently reproduced during implementation

A finite, inline Node/tsx probe imported the current saleView.ts functions. It supplied a
synthetic fresh observed deal2/version1, with no acceptance and no record, plus a historical
applied intent for deal1/version1. It did not start a server or call a chain/provider.

- saleSentence reported deal1 applied and buyer management.
- saleSteps read deal2 but marked Record, Contract close and Apply completed from deal1.
- saleNext correctly offered Review this version, contradicting the completed progression.

This is a plausible collection shape: V3Intents.list returns the business's full intent history,
ordered newest first (server/src/v3intents.ts), not only the currently observed sale. The pure
probe demonstrates presentation behavior, not an end-to-end second sale or a final001i failure.
Claude is still editing; recheck the final implementation before dispatching a correction.

## Required review/correction

Resolve the current sale identity once and use it consistently for sentence, steps and next
action. When a live deal is shown, match sequence, version and digest; an unrelated applied or
recorded intent must not complete its steps. Keep older receipts useful as clearly historical
evidence. Do not blindly pick the first recorded intent when a later exact match is available.
When no live deal is shown, distinguish historical receipts from a pending exact outcome and
unavailable/paused/current evidence. Access or observation problems must remain visible.

Meaningful regressions: applied deal1 followed by proposed deal2; newer version with an older
record; multiple records with the exact match later in the array; paused/stale observations
with historical applied receipts. Verify sentence, steps and action agree without changing
the actual reconciliation/authority rules. Then run normal checks and browser acceptance.

## This pass

Added this review note and INDEX entry, updated ignored BUILD_STATE. Active Claude's files
were left untouched. No Git writes, live permissions, signing, deployment, secret reads,
research assessment, spending or publication. No preview processes or tabs created.
The earlier check stopped at lint on unfinished001i JSX. A later independent check (exec37664)
passed lint, types and1082 tests across110 files. Claude still edits, so this is intermediate
verification and does not cover the historical-sale defect or replace final job acceptance.
All six milestones and the real integration gates remain open. Queue this review before001j,
then002e and003v/004b/005c with the remaining roadmap retained.

## Final001i review and correction dispatch preparation

89449 terminal exit0; matching Claude process check empty. Reviewed dfeecae and d40e795/report.
Reproduced the same historical-sale issue against committed code. Independent webbuild passed
842.75kB; prior independent1082 tests/110files passed against these implementation changes.
Added001i1 bounded correction brief and JOBS row; also added the previously queued003v row.

Actual browser tab40 at1440/390: clear identity/next action, explicit progression, exact base
units, all continuity groups,375px document width within390 viewport. Keyboard Review displayed
the review panel without recording. Saved acquisition-workspace-phone-2026-11-04.jpg. Browser
Record was rejected by automatic approval review as needing specific fictional-sale consent.
Asked Tony via async question for recording/applying the simulated close. No bypass or alternate
mutation attempted. Remaining full sale flow/room/zoom/motion gates pending.

First sandbox preview56793 was unreachable from browser and stopped; elevated74705 is disposable
in-memory loopback with ten-minute automatic stop. Cleanup is recorded in BUILD_STATE when done.
Failed tab39 was unreachable; tab40 is the active review tab. No live transaction occurred.

Subsequent update: Tony approved the synthetic sale tests; actual repeat is documented in
AcquisitionContinuityRepeat. Tabs40/41 and all previews are now stopped.001i1 exec47629 failed
ENOTFOUND before edits; one elevated DNS diagnostic succeeded, no remaining writer. Correction
still pending; the historical-sale finding is not fixed by the successful first-sale browser run.
