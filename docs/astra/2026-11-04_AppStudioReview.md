# Executable Studio recovery review

Tony's mandate remains an approachable AI studio with a working canvas, recoverable progress,
versions and customer continuity across NEAR acquisition. This is an in-progress review of
002e while sole Claude session67893 continues. Revalidate against the finished implementation;
no second writer and no app files changed by Astra.

## Reproduced: lost generation response produces a second build

A finite inline Node probe used the actual web appApi.generate, everstreetApi, in-memory Store,
Builds and BuildWorker. The provider was explicitly scripted and returned the reviewed fictional
API estimator bundle. No server listener, model call, generated-code execution or spending.

1. Create Ava's fictional API-estimator project and synthetic business budget through the API.
2. Call appApi.generate with the same parameters as AppView. Transport sends the actual route
   request, then deliberately drops its successful committed response.
3. Run the scripted build worker once, representing the first build finishing before retry.
4. Repeat appApi.generate with the identical project, revision, instructions, base and budget.
5. Run the scripted worker once more.

Observed two distinct successful job submissions and two scripted provider calls:
`7e245add-ae80-4f99-b1df-fd2053dd80c1` and `2d5feb81-df91-4fee-a931-8889d68d0076`.
The first client error was `Synthetic lost committed response`. Real model calls: zero.
appApi.generate creates a fresh idempotency key inside every call. AppView keeps no unresolved
request when submission rejects, so Generate is available again with a new key. This is client
retry identity loss; it is not evidence that the server's same-key idempotency is broken.

Required correction: retain one exact unresolved request and key, separate from the editable
draft, recover that same request after a lost reply, and do not resubmit a paid generation as a
fresh request merely to recover it. Preserve recovery through tab switching/reload, while
fencing actor/project/owner epoch. Include actual route/controller evidence for one provider
attempt across lost response, typed-ahead draft, tab switch and reload.

## Source findings to cover in the completed UI

- ProductStudio mounts AppView only while tab=app. Leaving the tab drops its draft, generation
  identity and recovery state. The existing Service panel immediately below already preserves
  pending work across tabs. Apply equivalent lifecycle protection to Web app. Draft text is
  editable during Generate, but successful submission unconditionally clears it; preserve
  newer typed text when the original answer arrives.
- The local BUDGET constant fixes a 100-cent ceiling, but this view currently offers no review
  of that limit or budget controls. It also exposes no generation cancel action, despite the
  job's explicit budget/cancel/recovery requirement. Integrate the existing bounded build
  controls and visible progress rather than requiring the founder to discover another tab.
- AppVersionsView contains detailed check results, failures and can_cancel, yet AppView only
  renders version summary pills. The failure text says "See which case or file failed below"
  without rendering those case/file results. Complete useful check details/cancellation and
  explain logic checks versus manual browser checks in ordinary language.
- load() has no response ordering and the error branch replaces the whole view without Retry.
  Prevent stale reads from overwriting a newer selected version, make transient failures
  retryable, and clear private state on definite access loss. Recheck this with the parent
  scope fence; a keyed component alone does not order concurrent reads within the same scope.
- PreviewFrame holds its load count in a ref but is not keyed by preview URL. Opening another
  version in the same frame can be mistaken for self-navigation on its second load. Reset by
  an explicit preview identity while preserving detection within each preview. Verify in the
  browser, including replacing a stopped or failed preview.
- Preserve the approved canvas-led studio composition. The current source adds another
  card-based tab; actual finished desktop/phone screenshots and interaction review are still
  required before making a visual judgment. A file diff is useful supporting evidence, but a
  novice should be able to understand the requested change and use the resulting product.

These are finishing criteria for002e, not a replacement for the full roadmap. Worker host
follow-up in WorkerImplementationReview also remains required before setup/acceptance.

## Changes and verification

Astra added this pass and its INDEX row, and updated BUILD_STATE. No implementation, Git,
host, research or external changes. The finite reproduction exited0 after reporting the two
jobs. Required fullcheck result is recorded in BUILD_STATE; later Claude edits may supersede
this in-progress snapshot. The preceding goal turn was a verified wait on live67893.

## Browser pass on c0a3c00; finishing commit0da94e6 reviewed separately

Finite disposable preview26715, tab50, loopback8858, built865.02kB UI. Scripted generation,
real API, no engine. Ava's two fictional Lumen Parse versions were made by the preview fixture.

- Run logic checks reached "Isolated worker unavailable / Nothing ran"; Preview required the
  explicit unchecked choice. Actual modules and CSS rendered in Studio. Version2 at1000k
  Priority returned$364.50. No real isolation or AI-generation claim.
- Opening version1 while version2 was open produced "The preview tried to open another page
  and was stopped." This confirms the missing preview identity finding on c0a3c00.
- Typed "Keep this draft: explain the API volume discount.", switched Brief -> Web app:
  textarea returned empty. This confirms the tab-unmount draft finding on c0a3c00.
- Keyboard Enter on Make this the current version selected version1 without deleting version2.
  Compare showed the actual40->45 rate line. Fresh version1 preview at1000k Priority returned
  $409.50, preserving the original behavior. At390 without Compare documentwidth375 fits.
- Compare at390 expanded documentwidth to477. Its app-diff/pre and app-versions width were
 420.18, right454.84; the pre had overflow:auto but its enclosing grid/card still grew. Closing
 Compare restored375. Screenshots app-studio-compare-phone-2026-11-04.jpg and
 app-studio-restored-phone-2026-11-04.jpg. Constrain grid/card minimum widths and keep long
 code scrolling within its own region; recheck keyboard and390/1280/1440.

Preview26715 intentionally stopped (Ctrl+C exit1); tab50 closed and viewport reset.

Claude then completed0da94e6 while this browser pass used the earlier built UI. Source review
shows same-key Generations, mounted AppView, preview URL key, budget/check details and ordered
reads now present. Tests exercise actual API lost-answer/reload recovery meaningfully. Do NOT
report the preceding browser failures as independently reproduced on0da94e6; repeat corrected
flows. The comparison CSS containment was not changed in that commit and needs correction.

One new finite pure-controller probe on0da94e6: generate answers with a fictional queued job;
new Generations instance with the same scope/storage simulates reload. Before reload job=
fictional-queued-job/queued, storedEntries=0; afterward job=null,pending=null. Acknowledged
in-progress jobs lose their recovery identity on reload because remember(null) runs at creation
acknowledgement. Retain/recover the known job through terminal readback, and keep a reachable
refresh action after polling limits/failures. This probe used a port double, not an actual API
or browser; no second real generation was attempted.

Independent85462 on933bfdb passed lint/types1148tests120files and870.72kB web build.67893 then
exited0; exact-session CIM process query empty.002e remains review, with002e1 finishing work.

## Independent0da94e6 browser repeat while002e1 runs

83213/tab51, finite240second synthetic preview on8858, existing870.72kB built UI. Typed the
same draft, switched Brief -> Web app: the exact draft survived. Opened uncheckedversion2,
then explicitly replaced it with uncheckedversion1: frame remained running with no false
navigation-stop warning. Version1 controls at1000kPriority returned$409.50. These two earlier
browser failures are corrected by0da94e6. Screenshot app-studio-preview-switch-2026-11-04.jpg.
No generation/host/model/NEAR execution.83213stopped/tab51closed.002e1 reload/phone/worker
corrections remain active; do not equate this narrow repeat with full Studio acceptance.
