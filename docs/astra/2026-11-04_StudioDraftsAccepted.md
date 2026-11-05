# Studio drafts accepted; normal application integration next

001k1 is narrowly accepted at 2226246 (report 6c881d2), after independently reproducing the
route loss and three asynchronous persistence failures, then verifying the corrections.
All six platform milestones remain open. This is not acceptance of live generation or the worker.

## Actual browser evidence

Finite synthetic preview35138, IAB tab56, current web build884.02 kB. The preview is the real
application with disposable in-memory data and a scripted provider; no WSL, model or chain.

- As fictional Ava, type `App route and reload retention probe`, click main Build, reopen the
  same project card, then Web app: the text returns.
- Type a distinct `Brief route and reload retention probe` in the companion. Repeat Build and
  the same card: the brief text returns. Reload: both drafts return in their own composers.
- Inject one lost generation response. Submit the app draft; the sent words appear in the
  recovery request and leave the unsent box. Type `Typed ahead while recovery is pending`.
  Leave via Build, reopen and choose Web app: the same request is offered for recovery, the
  newer text remains separate, Generate is disabled, and the brief text is unchanged.
- Recover, reload, and read the acknowledged job. Control endpoint reports exactly one queued
  generation. Complete that scripted job: automatic polling shows version3 ready; newer text
  remains in the composer. A planned Check progress click found no button because polling had
  already completed; fresh UI inspection confirmed success. No retry or duplicate submission.
- Clear app text, reload: it stays empty. Brief text still exists separately. Clear brief text,
  reload: it also stays empty.

Internal screenshot: `001k1-restored-brief-2026-11-04.png` (restored brief text before clearing).
This is internal review evidence, not Tony's deferred complete creative walkthrough.

## Other evidence and limits

Independent finite real-controller assertions pass for a detached late job404, detached app
and brief forget calls, and active forget followed by a late400. The earlier two late-response
cases are regression-tested by Claude with real controllers. Source review confirms the actual
mount/unmount caller wiring and ProductStudio's mounted deletion guard.

Claude's final check:1220 passed+1Linux-only skipped; lint/types clean; webbuild884.02 kB JS,
72.52 kB CSS with existing chunk warning. Astra's separate final check35112 also exited0:
1220 passed+1Linux-only skipped, lint/types clean.
Actor/project/epoch separation and denied/corrupt storage are covered by controller tests;
this browser pass verified same-person route/reload/recovery, not a real ownership transfer.
No new layout was introduced by001k1. Prior001k desktop/phone/focus/current-versus-selected
evidence remains in ExecutableCanvasBrowserReview; actual zoom/reduced-motion preference
checks remain open. Neither those limits nor partial worker conformance are silently closed.

## Cleanup and handoff

Claude76082 ended exit0; exact-session CIM absent. Preview35138 intentionally stopped only
after verifying its exact node command and port ownership; terminal exit1. Tab56 closed; no
viewport override was made. No host worker, paid provider or chain activity ran.

Next dispatch003w with design-first explicit modes, verified identity, durable adapters and
the same-business 100/20/80 sale/continuity journey. Implement missing real adapters as bounded
sub-jobs; no synthetic seam may stand in for completed configured integration. Retain queued
002f1 plus004b/005c/005d/006a and the full six milestones. No external steps authorized here.

Astra changed this acceptance, INDEX, corrected the stale final sentence in Claude's report,
and the ignored BUILD_STATE checkpoint. Claude reviews and locally commits; Astra does not.
