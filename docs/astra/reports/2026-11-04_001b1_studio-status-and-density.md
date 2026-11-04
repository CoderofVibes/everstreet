# 001b1 report: studio status and density

Claude, 2026-11-04. Job: [001b1](../jobs/2026-11-04_001b1_studio-status-and-density.md).
Commit `7953801`, on top of `a31aba5` (Astra's six docs). Not pushed. No endpoint, record or
package changed. Design note updated: [STUDIO_WORKSPACE.md](../../design/STUDIO_WORKSPACE.md),
section "Corrections in 001b1".

## Reproduced first

`web/test/studioRecords.test.ts`, over the real API, retires the active offer through the offer
setup. The panel then shows the offer retired, while the studio's status still reads "1 active".
That is Astra's finding. The same test then shows that the panel's reported change, and only
that, brings the status to "None active (earlier offers retired)". The store's API was written to
make this test pass; it did not exist before.

## Changes

1. **Status follows actual events.**
   - `StudioRecords` holds the releases and offers that the status is derived from.
   - Builds (its job list), Service (active release, candidates and checks, latest run) and the
     offer setup (offer ids and states) each report a signature of what they show after
     reloading their own records.
   - A changed signature triggers one read of both records. A panel's first report counts as its
     load, not a change, and an unsuccessful action changes no signature.
   - **Reading rules:**
     - reads are sequenced and coalesced (at most one in flight and one queued, however many
       events arrive);
     - they are dropped after unmount;
     - a 404 clears the records and stops reading;
     - other failures read "unknown".
   - Tab switches no longer read. Load and save still do. There is no polling and nothing is
     optimistic.
2. **Density.**
   - **What went:** the eight-step rail and the status cards.
   - **What replaced them:** one line under the header with **Release** and **Customer offer**,
     and a native **Progress and status** disclosure. The disclosure holds every status item, plus
     brief checks and the business page, each linking to its view. Nothing became unreachable.
   - **Still visible:** unsaved, pending and error indicators (the save state and Save, banners,
     Service task badges).
   - **The tab bar** now holds the tabs plus the editor toggle; the toggle is no longer inside the
     tablist.
   - **At 1000 px and below:**
     - the editor is opt-in for every view (kept mounted);
     - tabs scroll horizontally instead of wrapping;
     - the canvas padding is smaller;
     - so the chosen task and its first control follow the header and the one summary line.
3. **Query-only navigation.**
   - The router tracks the query as well as the path, and `popstate` updates both.
   - Routes still match the path only, so `/build/:id?view=…&task=…` from the same project, and
     Back/Forward between such links, keep the studio mounted and select the view and task
     (`viewFromSearch`).
   - A plain URL returns to Preview and leaves the Service task as it was.
   - The page doesn't scroll to the top on a same-page navigation.

## Checks

- `npm run check`: Biome and `tsc` clean, **780 tests in 68 files** (772/67 before).
- `npm run web:build`: built.
- **New tests:**
  - `web/test/studioRecords.test.ts` (6):
    - the real-API retirement reproduction and fix;
    - an unsuccessful retire gives no read and no change;
    - signatures change on check and release;
    - 20 events during a read cost one more read;
    - a late answer after close lands nowhere;
    - a 503 reads unknown, a 404 clears and stops.
  - `web/test/studioLayout.test.tsx` (+2): `splitLocation`/`viewFromSearch` for query-only and
    Back-to-plain navigation, and the editor-open class with the editor still rendered.
- **Existing tests:** the 001b layout, attention and status tests still pass.
- **Mutants**, one at a time, each restored, with the diff inspected before running. All 3 were
  killed:
  1. refresh on every report;
  2. no coalescing;
  3. the query's task ignored.

## Limits

- **Browser.** Not browser-verified here: 1440/1280/390 layouts, 200 % zoom, the disclosure and
  toggle keyboard behaviour, and Back/Forward in a real browser.
- **Builds.** The Builds view still unmounts when left. On return, its signature is compared with
  the last one seen, so a build that finished meanwhile still refreshes the status.
- **Milestones.** All six stay open.
