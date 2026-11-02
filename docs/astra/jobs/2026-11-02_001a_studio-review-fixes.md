# M1 browser review corrections

**Why (Tony's words):** "I want to pull no punches on the development of this."

## What the person sees and does

Finish the foundation with reliable history and a usable studio at laptop widths. This is
an internal correction pass, not a request for Tony to approve another design.

1. Fix VersionsView's stale-response race. In Astra's browser test: create revision 1,
   edit/save revision 2, select revision 1, restore as revision 3. The list correctly
   selects revision 3 but the detail continues showing revision 1 and says "This is the
   current revision." Source confirms an uncancelled revision fetch can overwrite the
   new head in `VersionsView`. Guard asynchronous results against changed project,
   selection and head; reset errors consistently. Verify rapid selection changes too.
2. Fix studio overflow at 1280px. With Versions open, viewport 1280 has clientWidth 1265
   and document scrollWidth 1357. The details are squeezed beyond the right edge. Reflow
   the versions list/details based on available canvas width, allow grid children to shrink,
   and wrap long content. Do not solve by clipping or hiding inaccessible controls.
3. Make check labels specific. The step currently shows a green "Test 7/7 checks" when
   only seven brief-presence rules pass; no product exists yet. Use "Brief checks" or
   similarly clear copy, and avoid implying a tested build. Home's "Prepare / Works now"
   should say the continuity checklist is available, not that runtime readiness is verified.

## Underneath

Checked: `VersionsView` in `web/src/pages/ProductStudio.tsx`, `.ps-body` and versions styles
in `web/src/styles.css`. Main implementation commits `0e82986`, `07d666e`, report `9ecea05`.
No schema change is needed. Do not modify coordinator-owned BUILD_STATE or ACCEPTANCE.

Internal screenshots (absolute local paths):
- `C:/Users/antho/.codex/visualizations/2026/11/02/01a19d2e-29f9-7722-8592-187bac300246/m1-studio-1440.jpg`
- same directory: `m1-versions-1280.jpg`, `m1-studio-mobile.jpg`.

## Done when

History detail always corresponds to the selected revision, including restoration and late
responses. Versions and Preview fit 1440/1280px and a 390px layout remains usable. Keep the
existing schema prototype / not-connected labels. Run `npm run check` and `npm run web:build`.
Report changes and actual verification; Astra performs browser acceptance if you lack browser
access. Add a meaningful race regression test if feasible with existing tooling; do not add
a test that only checks the exact implementation or claim browser verification you did not do.

## Not in this job

No generated runtime, provider calls, chain transactions, public release or Git push.

## Priority and size

P0 / S. Before 002a; leave 001 implementation status done but M1 acceptance pending review.
