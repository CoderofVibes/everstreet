# 001f1 Discovery availability: report

Builder: Claude (Opus 5.5, high), sole writer. Job: `jobs/2026-11-04_001f1_discovery-availability.md`.

## Reproduced first

`server/test/explore-availability.test.ts` uses the actual routes: an owner PUT to the
public-profile draft, then publish with `{draft_rev, review}`, then a customer GET of
`/api/public/explore` and of the storefront. Before the fix, 4 of its 5 tests failed. A published
Ledgerline with an active offer was in `starting` (1) and missing from `open` (0), matching
Astra's browser finding. Cause: `Community.explore()` split on the legacy offering's
`action.kind` alone.

## The rule (server/src/community.ts `exploreClass`)

Each published business lands in exactly one tab, and each row carries `explore: {tab, reason}`.

| Business | Tab | Reason |
|---|---|---|
| Digital section, some listed product's reviewed release has an active offer | Open | `digital_available` |
| Legacy offering takes requests (`action` question) | Open | `legacy_open` |
| Digital section with nothing open (in development, not offered, offer retired) and no open legacy offering | Starting | `digital_coming_soon` |
| Legacy only, testing interest | Starting | `legacy_interest` |

**The mixed rule:** a business with both a digital section and a legacy offering is open if
either part is open, because a customer can do something now. When both parts are open, the
digital reason is the one named. It is listed once. The legacy `action` is never changed to fit
the rule.

"Available" is the storefront's own predicate (`digitalPublic` → `availability`): the feed reads
the same `publicBusiness` record, so the tab, the list label, the storefront and the Use target
all come from the same source.

There is no separate "paused" state for a digital product. Offers are only `active` or `retired`,
and an entitlement pause blocks new holds inside the customer workspace, not the listing. So
"paused or retired" is the coming-soon case, and the Starting copy says so.

## Web

- **Explore copy:**
  - Starting now: "Not open to customers yet: ideas testing interest, and digital products that
    are still being built or aren't taking new customers."
  - Open for customers: explains the mixed rule. Both empty states say what would appear there.
  - The old "nothing can be booked yet" claim is gone.
- **List labels** (`web/src/discover.ts` `marketLine`):
  - A mixed business open only through its legacy offering reads **Open for customers**, with
    "{offering} takes requests now; the digital product is not open for use yet."
  - A legacy business taking requests at an early stage reads **Open for customers**, not
    "Shaping". Launched and Growing keep their stage label, as approved in 001f.
- **Reused consumers:** `Tile` (used by Find and a person's page) now takes its status pill from
  `marketLine`, so Find, Person, Home and Explore all show the same label. `MarketRow`,
  `FeaturedProduct` and Home's list are unchanged apart from the shared label rule.
- **Feed recovery** (`web/src/exploreView.ts`, `Explore.tsx`):
  - The feed loads through the existing `latestLoader`. A failure with nothing loaded settles
    into "Couldn't load Explore just now" with the error and **Try again**; it no longer stays on
    Loading.
  - Answers that arrive after the page has closed are dropped.
- **Following feed:**
  - It is stored with the id of the account that loaded it (`followingFor`), so another account,
    or a signed-out visitor, starts from nothing and never sees the previous account's updates.
  - Its loader closes when the account or tab changes, and it has its own retry.
  - Only Explore's read path changed; Activity's separate silent catch is untouched (out of
    scope).
- **Keyboard:**
  - The tablist is labelled "Explore".
  - Each tab has an id, `aria-controls` and roving `tabIndex`. Arrow keys, Home and End move
    selection and focus together.
  - One `role="tabpanel"` is labelled by the selected tab and is focusable.

## Other items in scope

- **Breakpoint doc:** `docs/design/UI_SYSTEM_001F.md` now says the compact header applies at
  **≤ 980 px** (the `styles.css` header block), with page padding tightening again at ≤ 760 px.
- **JOBS:**
  - The 003u and 003u1 rows no longer read as if the Fenn/Ruiz grant/revoke test were still
    waiting for permission. Tony approved it, and Astra completed grant, scope-specific
    room/export and both revocations (ApprovedEvidenceReview).
  - These gates stay open and explicit: the legacy customers scope audit, and the publication
    unpublish browser check, which was not completed there.
  - The 001f and 001e rows now describe Astra's partial browser review at `8df9f34` with the
    concrete 001f1 correction, and list the remaining gates. They no longer say "never
    browser-verified".
- **DigitalProfile:** `git grep` finds no imports. The only mentions are its own declaration,
  the 001f report and this job brief. **Not removed:** `git rm` and a plain file delete both
  need an interactive approval that this run cannot give. Nothing was retried or worked around.
  The file is still unused and harmless; deleting it is one command for the next session that
  can approve it.

## Verification

- `server/test/explore-availability.test.ts` (6 tests, actual routes plus the pure rule):
  - published with an active offer → Open once, `digital_available`; the feed row's `digital`
    equals the storefront's, its Use target is the active offer, and the public section keeps
    exactly its reviewed key allowlist (no new fields);
  - offer retired → Starting, `digital_coming_soon`; then unpublished → in neither tab;
  - a newer release with a different name → still Open under the reviewed name (the reviewed
    release's offer is still active);
  - legacy testing interest → Starting; legacy taking requests → Open;
  - mixed (digital plus a legacy offering testing interest) → Open once; with the digital offer
    retired → Starting;
  - all four rule outcomes, including mixed with only the legacy part open;
  - every published business appears in exactly one tab, with no duplicates.
- `web/test/explore-view.test.ts` (6 tests): a failed load settles to retry and then recovers to
  ready; a closed page ignores late answers; Following is scoped to the account; tab keys;
  mixed and legacy labels agree with the tab.
- **Mutants**, each run alone with a time ceiling, all killed:
  1. ignore digital availability (the original bug): 4 server tests fail;
  2. legacy-open only when there is no digital section: the rule test fails;
  3. `followingFor` ignores the account: the Following test fails;
  4. a failed load reads as Loading: the settle test fails;
  5. the mixed label ignores the open legacy part: the label test fails.
- `npm run check`: lint clean (290 files), types clean, **988 tests / 97 files passed**.
- `npm run web:build`: passed (803.98 kB bundle; same size advisory as before).
- `server/test/publication-preview.test.ts` still passes inside the check, so
  `npm run preview:publication` remains usable for Astra's repeat. No preview server was started
  or left running in this pass.

## Limitations

- **No browser:** this builder has no browser tool. Focus movement, the panel's visual state, and
  the error and retry screens are checked through pure rules and source, not in a browser.
  Astra's repeat on preview 8826 is the browser gate.
- **Mixed in actual routes:** only "digital open plus legacy interest" and "digital retired plus
  legacy interest" go through the actual routes. "Digital not open plus legacy taking requests"
  is covered by the pure rule and label tests.
- **Error injection:** there is no route-level test that injects a failure into the Explore
  request itself. The loader and view rules are tested directly.
- **Reference search:** an early `grep -r` for DigitalProfile walked the whole working tree,
  including the ignored local-only research folder. No match from it was shown or used. Later
  searches used `git grep`, which searches tracked files only.
- **Astra's concurrent files:** they appeared during this pass and were left unstaged:
  `docs/astra/INDEX.md`, `2026-11-04_LegacyDisclosureReproduction.md`,
  `jobs/2026-11-04_003u2_legacy-customer-disclosure.md` and
  `operations-chart-before-001h-2026-11-04.jpg`. They are for a later review.
- **Scope:** 001g was not started. All six milestones remain open. No provider, RPC, wallet,
  signing, deploy, push or spending.
