# Keep studio status synchronized and the working area visible

**Why (Tony's words):** the platform should feel like a future digital-builder workspace,
and should be approachable for people who do not know developer tools.

## Verified and found at5fd563b

Astra browser: customer-access deep link opens the right task. Active released revision1 stays
separate from saved brief2 and unsaved3. Hidden editor preserves name draft; Service Try input
survives Customer access and back. Saving creates brief3 without changing release1. Failed-check
project correctly says2/10, not releasable, Built not released. Mobile Menu opens with focus on
Home, Escape closes and returns focus to Menu. Synthetic preview strip is visibly explicit.

Two concrete corrections:

1. Retire the active offer from Service -> Customer access (two-click action). Its list changes
   to Retired and its readiness count drops, but the global status still says "Customer offer
   1 active" and the Customers step says Offer active. Switching Service tasks leaves it stale.
   Saving an unrelated brief revision refreshes it correctly. Summary reads are tied to global
   tab/save rather than the mutations they summarize. Wire bounded, sequenced refreshes on actual
   offer/release/evaluation/build transitions. No optimistic invented result and no busy polling.
   Late status reads must not overwrite newer state or reappear after actor/project/access loss.
2. At390x844 the global Menu is compact, but the new six status cards stack from about420px to
   the bottom of the screen; the studio tasks/canvas are still entirely below the first screen.
   Desktop also has status cards, eight steps, eight tabs and three Service tasks above the work.
   Condense this hierarchy. Keep a short current-task/version/release summary, with detailed
   progress behind a clear disclosure. Avoid repeating the same route as cards, steps and tabs.
   Keep unsaved/pending/error indicators visible; hide detail rather than compressing text to
   unreadable sizes. At390px the chosen task and its first useful control should appear on the
   first screen where practical even with the explicit preview strip. Desktop working canvas
   should take the majority of the usable height. No loss of access to any existing task.

## Source follow-up

router.tsx now matches pathname but stores only pathname; queryParam is read at mount. Verify
same-project query-only navigation and browser Back/Forward, including deep links to different
Service tasks. If they don't update the selected task, correct location tracking without
remounting the whole studio and losing drafts/pending work. Initial deep links already work.

## Done when

Reproduce retirement stale-summary before fixing; tests cover create/retire/release/check state
refresh races, unsuccessful changes, access loss and unchanged record provenance. Browser repeat
should show immediate settled status without saving unrelated data. Preserve typed-ahead and
unsaved work while switching tasks and toggling condensed detail. Keep Menu keyboard behavior.
Use a semantic, accessible disclosure for details and usable1440/1280/390 layout. No CSS-mirroring
tests needed; meaningful state tests and npm run check/web:build pass. Report/local commit then002d.

P0/M. No contract/scripts/config changes except needed isolated preview work by Claude; no live
integration, signing/deploy, spending, public release/push, research access, submission or Day One.
