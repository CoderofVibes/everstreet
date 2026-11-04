# 001f2 Home read boundaries: report

Builder: Claude (Opus 5.5, high), sole writer. Job: `jobs/2026-11-04_001f2_home-read-boundaries.md`.

## Cause (source, confirming Astra's browser reproduction)

The cause was the same in three places, with an outage problem in two more:
- **Home "Continue building":** `productsApi.list().then(setMine)` ran on every account change,
  with no account or sequence guard. Home isn't remounted on a switch (`App.tsx` renders `<Home />`
  unkeyed), so Ava's late answer replaced Bea's cards.
- **Build "Your product projects":** the same pattern (`setProjects`).
- **The composer's "Business it belongs to":** the same pattern (`api.projects().then(setOwned)`).
  Ava's business names could appear in Bea's select, and the selected business id stayed across a
  switch.
- **Outages:**
  - Home turned a failed discover into `[]`, which read as "No software products are published
    yet".
  - The composer turned a failed foundations read into `[]`, so no product types were shown,
    while the hidden default (AI API) could still be submitted.

## Fix

- **One shared controller, `web/src/actorRead.ts`** (`ActorRead` and `useActorRead`), built on
  the existing sequenced `latestLoader`:
  - Every answer is bound to the account that asked.
  - A switch or sign-out drops what was shown at once. The render right after the switch already
    shows nothing, because `stateFor` checks the account before `setActor` runs.
  - A late success or failure for anyone else changes nothing.
  - Retry re-reads for the same account. Unmount closes; a later mount reads afresh.
  - 401, 403 and 404 drop the data.
  - Home, Build and the composer's businesses all use it.
- **`usePublicRead`:** a sequenced public read with a retry, used for discover, needs and
  product types.
- **Home (`web/src/homeView.ts` `catalogView`):**
  - The catalog has separate loading, failed-with-Try-again, ready-empty and list states. Data
    already confirmed stays shown if a later retry fails.
  - The featured stage uses only real data; with none, it shows the static "what works today"
    panel.
  - "Continue building" shows loading, then the account's own projects or a failure with a
    retry. It is hidden for signed-out visitors and for accounts with no projects.
  - A needs failure shows a short notice with a retry instead of vanishing silently.
- **Composer (`composerReady`):**
  - Nothing can be started until the product types have been read, and only a shown, chosen
    type is accepted. Loading and failure say so, and failure has Try again.
  - Idea, working name and choice stay in place through recovery; the component isn't
    remounted.
  - The selected business belongs to the account that picked it. Another account starts from
    the link's business (labelled "The business from your link", never another account's
    name) or a new private business.
  - If the owned-business read fails, it says only a new business is listed and offers a retry.
- **No server changes.** Project and business ownership checks are exactly as before.

## Verification

- `web/test/actorRead.test.ts` (13 tests). Held answers are released in a chosen order, with a
  hard request cap per test and no timers:
  - A→B with A's late success: B shows only B's projects;
  - A's projects are hidden at once on a switch, before the next answer;
  - A→signed out;
  - A's late failure doesn't mark B as failed;
  - quick A→B→A: only the newest read counts;
  - the same account doesn't read twice;
  - failure, then retry, then recovery;
  - a retry for A answered after a switch to B is dropped;
  - unmount: no changes, no retry; remount reads afresh;
  - a 401 drops the data;
  - the catalog failure state and kept data;
  - composer gating (failed, loading, offered, not offered).
- `server/test/home-read-preview.test.ts` (3 tests, through the real app's fetch, at most 40
  requests, short hold ceiling):
  - Ava's held project list is Ava's own and is delivered after Bea's list, which contains only
    Tutor Portal;
  - an unreleased hold ends by itself at the ceiling;
  - a discover or foundations failure is a labelled 503 once, then the real answer.
- **Mutants**, each run alone with a time ceiling, all killed:
  1. `stateFor` ignores the account: 4 tests fail;
  2. a switch doesn't close the old read and answers aren't account-checked: 4 fail;
  3. a failed catalog reads as empty: 1 fails;
  4. the composer can submit while types are loading: 1 fails;
  5. retry after unmount: 1 fails.
- `npm run check`: lint and types clean, **1023 tests / 101 files passed**.
- `npm run web:build`: passed (819.99 kB bundle; same size advisory as before).

## Preview for Astra's repeat (fictional, in memory; not started or left running by me)

```
npm run web:build
npx tsx scripts/preview-home.ts     # site 127.0.0.1:8836, controls :8837; Ctrl+C ends it
```

This is the publication preview (Ava, Bea with Tutor Portal, Dee) behind
`scripts/lib/readFaults.ts`. The faults only delay a real answer or fail one read once. A hold
ends after 90 s at the latest; there is a 2,000-request ceiling.

The race:
1. As Ava on Home, `POST :8837/hold/projects`, then reload.
2. Switch to Bea.
3. `POST :8837/release`. Bea's Continue building must show only Tutor Portal.

The outage: `POST :8837/fail/discover`, `.../fail/foundations`, `.../fail/needs` or
`.../fail/projects`, then reload Home or `/build`. Type an idea and pick a product type, then use
Try again.

## Limitations

- **No browser:** Astra's repeat on 8836 is the browser gate for the real-UI race after the fix,
  outage and retry with a typed idea, and the keyboard and phone layout of the new notices.
- **Hook-level tests:** the React hooks themselves (`useActorRead`, `usePublicRead`) are thin
  wrappers. The behaviour is tested on the controller and the view rules, not by rendering with
  effects (the repo has no DOM test environment).
- **Typed text across a switch:** typed but unsubmitted text (idea, name) stays when the account
  changes. It is local typing, not server data. The business choice and lists do reset.
- **Composer error message:** a server error shown in the composer is not cleared by an account
  switch. It never contains another account's data; it is the create call's own refusal.
- **Out of scope, left alone:** Activity's silent catch, and other pages' private reads, are
  outside this job. Pages keyed by person in `App.tsx` already remount on a switch.
- **Astra's concurrent files:** they appeared during this pass and were left unstaged:
  `docs/astra/INDEX.md`, `2026-11-04_CustomerCompositionReview.md`,
  `customer-before-001j-*.jpg` and `jobs/2026-11-04_001j_customer-product-composition.md`.
- **Scope:** 001g1, 003u2, 001h and 001i were not started. All six milestones remain open. No
  provider, RPC, wallet, signing, deploy, push or spending. Searches used tracked-file `git grep`
  and the scoped search tool on named paths only.
