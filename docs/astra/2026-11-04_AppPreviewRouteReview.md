# Actual app-preview route and lifecycle correction review

Previous pass independently verified the worker's official pins; actual host/isolation gates
remain open. This pass confirmed sole Claude67893 live and reviewed new commit4764f9e.

## Actual preview boundary, not the earlier header-only canary

Finite180second/80request inline harness70204 used a fresh in-memory Store, real everstreetApi,
Builds/BuildWorker and a labelled scripted provider returning the reviewed QUOTE_BUNDLE.
Actual project/build/preview APIs generated the version and issued an explicitly unchecked
preview capability. No model, worker engine or generated host execution occurred. The simple
parent harness at127.0.0.1:8862 framed the actual localhost:8862 preview route with
sandbox="allow-scripts" and no-referrer. This was not the still-unfinished Studio composition.

Tab49 actually loaded app.js plus its estimate.js module and style.css through those routes.
The initial100k/Standard result was$17.00. Changing the input to1000 showed$112.50; changing
support toPriority showed$409.50. Both are fictional monthly rates, labelled in the app.
Computed total style was22px/600, proving the stylesheet loaded too. At390, the frame's
document/viewport widths both355px, with no internal horizontal overflow. Screenshot saved
as app-preview-route-phone-2026-11-04.jpg. This verifies the earlier header correction using
actual serving code, rather than only duplicated headers in a canary.

The exact-label select locator did not match and the AX preparation timed out; no selection
was sent by those actions. The observed#support locator succeeded. This is tool-interaction
evidence, not an app keyboard/accessibility pass. No unrelated UI approval is implied.

70204 intentionally stopped withCtrlC (exit1); tab49closed and viewportreset. No preview
listener or persistent app data remains. No host setup/download/publishing/signing occurred.

## Lifecycle source review

4764f9e moves AppCheckWorker to appCheckWorker.ts. It renews a live lease during preflight/run/
cleanup, recovers only lapsed rows, checks cancellation in the transactional dispatch gate,
and lets a cancellation recorded before outcome application win. Calls have independent
Promise deadlines, and cleanup failure blocks new claims until verified host readiness.
The added regression tests cover40seconds of advancing fictional time with renewal ticks,
the next queued job, cancel-in-preflight withzero runs, nonsettling engine, failed cleanup
and another worker's live lease. This addresses the two reported lifecycle defects in source;
independent check result is in BUILD_STATE. Do not claim actual engine enforcement from doubles.
Host preflight/cleanup must still fulfill that contract: WorkerImplementationReview is open.

Independent73790 fullcheck passed lint/types and1140tests117files.67893 remained live and
was editing guest-supervisor corrections afterward; no new builder was dispatched.

Astra changed this pass, AppCheckLifecycleReview, INDEX, screenshot and BUILD_STATE. No app/
contract/script/config edits or Git writes. GoalACTIVE/schedulePAUSED, allsixmilestones and
003v/003w/004b/005c/005d/006a retained; research remains unread and local-only.
