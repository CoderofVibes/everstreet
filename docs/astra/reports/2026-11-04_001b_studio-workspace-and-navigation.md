# 001b report: studio workspace and navigation

Claude, 2026-11-04. Job: [001b](../jobs/2026-11-04_001b_studio-workspace-and-navigation.md).
Commit `2b9f53c`, after 003s1 (`cabd516`, report `23832d6`). Not pushed. No endpoint, authority
rule, stored record or package changed. Design note:
[STUDIO_WORKSPACE.md](../../design/STUDIO_WORKSPACE.md).

## What changed for a person

- **Phone and narrow windows (1000 px and below):**
  - **The bar.** A compact bar with the wordmark and a **Menu** toggle, which carries the unread
    Inbox count. The task starts right below the bar and the acting-context row, instead of under
    about 340 px of links.
  - **The menu.** It holds the grouped links (at least 44 px each, Handovers included). Opening
    moves focus to the first link, Escape returns focus to the toggle, and navigating closes it.
    Closed links are out of the tab order.
  - **Unchanged:** the environment strip and preview strip stay; the desktop rail stays
    (Handovers added under "Buy and hand over").
- **Studio, shaping vs operating:**
  - Preview, Proposal, Brief, Checks and Versions keep the editor beside the canvas.
  - Builds, Service and Continuity take the whole canvas. **Show the editor** brings it back, and
    says "(unsaved)" when edits are pending.
  - The editor is only hidden: the unsent conversation text, its outbox and the unsaved brief
    survive. The header keeps the save state and Save.
- **Service, three tasks:**
  - **Try:** trials, budget, your requests.
  - **Evaluate and release:** release checks, checks and release, latest check.
  - **Customer access:** the offer setup.
  
  All of them stay mounted. A summary line shows the active version, whether running products is
  available here, and the budget. Task buttons flag "needs a check", "running", "check running"
  or "needs attention" (an unanswered offer create, unconfirmed access or a pending retire), so
  switching tasks never hides unresolved work. Offer readiness is a summary with the first next
  step, and every row sits under details.
- **Real status instead of "Prototype":**
  - **The chip** reads Released build, Built, not released, Prototype only, or Status unknown.
  - **The status strip** shows brief revision or unsaved changes; build and its source revision;
    checks; release (its revision, and "the brief has changed since" when it has); customer offer;
    and a link to Sale and handover. Every item goes to its existing view or Service task.
  - **The step rail** shows Build, Test, Release and Customers from the same records.
  - **The header's next step** comes from the brief's to-dos, then the records.
  - **The release note** says a release doesn't show a live provider, wallet or network.
- **Direct entry points:**
  - the desk's product rows link to **Releases** and **Customer access**;
  - the buyer's applied receipt lists their products with **Customer access** links;
  - `/build/:id?view=service&task=…` deep links work, because the router now ignores the query
    when matching (this also fixed the old `/build?business=` link, which matched no route).

## Underneath

- `web/src/studioStatus.ts` holds the pure `projectStatus` projection over existing records:
  the studio view, `GET .../releases`, and the business's offers for this product.
- **Reads:** on mount, on each tab change and after a save; one read each, no polling. A failed
  read means "unknown".
- **New pieces:**
  - `StudioBody` (three regions; the editor is rendered and hidden);
  - `studioLayout` and `OPERATE_TABS`;
  - `serviceAttention` and `offerNeedsAttention`;
  - the global `[hidden]` CSS rule, needed because `.ps-side` and `.card` styles would otherwise
    override the attribute.
- **No new endpoint, no customer data in the browser, no storage changes.**
- **Unchanged:** the previous continuity fixes (Service mounted once opened, the conversation
  outbox, drafts, offer recovery) and their tests.

## Checks

- `npm run check`: Biome and `tsc` clean, **772 tests in 67 files** (762/64 at 003s1).
- `npm run web:build`: built. The bundle scan found no preview key, signer or label setter.
- **New tests:**
  - `web/test/studioStatus.test.ts` (6): brief only and build unavailable; failed check never
    releasable; active release with a newer unsaved brief; unknown records; unchecked vs ready.
  - `web/test/studioLayout.test.tsx` (4): shaping and operating layout; the editor still rendered
    (hidden) with its content on operating views; each task's attention; the offer attention
    rule.
  - `server/test/studio-preview.test.ts` (1): the preview's three projects give the right status
    from their real records, and other people can't read them.
- **Mutants**, one at a time, each restored, with the diff inspected before running. All 4 were
  killed:
  1. a failed check reads as releasable;
  2. a newer brief is ignored on the release;
  3. the editor is unmounted instead of hidden;
  4. unconfirmed access doesn't flag Customer access.

## Preview for Astra

```
npm run web:build
npx tsx scripts/preview-studio.ts       # site 127.0.0.1:8816, controls :8817
```

The listeners weren't launched this session, and none is running. The URLs are printed at
start; act as Ava.
- Released, with a newer brief: `/build/<released>`. The chip reads "Released build", and the
  strip says the brief has changed since.
- Failed release check: `/build/<failed>`.
- Brief only, in another business, with building unavailable: `/build/<draft>`.
- `?view=service&task=customers`.
- `/desk/<business>`: the Releases and Customer access links.

**Controls:** `GET /`, `POST /lose/offer|retire|…`, `POST /provider/fail`. The amber strip labels
it synthetic.

**Worth checking at 390 px:** the Menu (keyboard and Escape) and the editor toggle on Service.

## Not done / limits

- **Not browser-verified here:** the 1440/1280/390 layouts, 200 % zoom, the menu's keyboard and
  focus behaviour, and touch targets. The tests are logical and structural; no DOM test
  environment is installed, and none was added.
- **Builds.** The Builds tab still unmounts when left, as before. Its jobs are server-side and
  reload.
- **Narrow screens.** The editor still comes above the canvas on shaping tabs.
- **Handover status.** There is no aggregate handover status in the studio; it links to Sale and
  handover.
- **Milestones.** This doesn't complete M1 or M2. All six milestones stay open.
