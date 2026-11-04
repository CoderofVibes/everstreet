# Current sale evidence must not inherit completion from history

P0/S-M. Next bounded job after001i, before001j. Tony's central goal is seamless acquisition on
NEAR with customer continuity. A second sale must not be shown as completed by the first sale's
receipt. Read Astra's AcquisitionHistoryReview and the001i design/report.

## Reproduced on committed dfeecae

Pure presentation probe: fresh proposed deal2/version1, neither party accepted, no record;
intents contains applied deal1/version1. saleSentence says deal1 was applied; saleSteps marks
Record/Close/Apply completed, yet saleNext offers Review this version. The real list API returns
all business intents, so current-owner history is not restricted to the displayed deal.

Reproduce first with a meaningful regression, then correct the presentation. Resolve current
sale identity consistently across sentence, progression and next action. A live deal's sequence,
version and digest must match before its record can count. Historical applied records remain
historical and cannot complete a newer sale. Exact matching must not depend on array order.
Review stale/flagged/paused/unbound observations and terminal/superseded records; do not erase
unknown evidence with a historical success. Define the no-live-deal behavior explicitly in the
design, including pending outcome versus historical receipts. Preserve recovery priorities and
existing exact-intent reconciliation. Do not change the authority protocol or invent new signing.

## Acceptance

- Test prior applied deal1 with new proposed deal2; older version plus new version; mixed records
  where the exact match is not first; paused/stale evidence with historical success; terminal and
  superseded history. Sentence/steps/action must agree about the currently shown transaction.
- Drive real controller/API fixtures for reachable transitions as appropriate; label synthetic
  constructions honestly. Do not weaken assertions just to preserve an incorrect progression.
- Retain no close completion from a recorded intent alone, owner loss, customer continuity,
  scopes and request recovery. Full npm check/webbuild pass, report/local commit, stop for Astra.

## Current browser evidence and limitation

Astra inspected1440 and390 after001i. Phone body/root375 at viewport390, readable and no overflow;
identity, next action, exact terms and three continuity groups present. Keyboard Review opens
display-only review. screenshot acquisition-workspace-phone-2026-11-04.jpg.
Automatic approval review rejected Record in the browser; Tony has been asked specifically for
synthetic sale record/apply permission. Do not bypass this via API or another UI executor. That
pending browser test does not block this presentation correction or ordinary code verification.
Full sale-changing browser acceptance resumes only with that answer. Evidence-room, actual zoom,
reduced-motion and remaining001i browser gates are still pending, not accepted by this screenshot.

No live chain/provider/signing/deployment/spending/push/submission/real data/Day One/research.
Preserve all six milestones. Only this bounded correction is dispatched; do not start001j yet.

Update after dispatch: Tony explicitly approved these synthetic sale tests. Astra completed the
actual browser record/premature refusal/fixture-close/apply/seller loss/buyer takeover/customer
result and99-unit continuity repeat; see AcquisitionContinuityRepeat. The approval hold above is
resolved for this disposable test.47629 failed ENOTFOUND before editing; no correction yet.
