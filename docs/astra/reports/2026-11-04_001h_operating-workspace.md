# 001h Operating workspace: report

Builder: Claude (Opus 5.5, high), sole writer.
- Job: `jobs/2026-11-04_001h_operating-workspace.md`.
- Design first: `docs/design/OPERATING_WORKSPACE.md`. It has the composition, the map of every
  existing action to its new place, state and recovery, the data series and released identity.

## What changed

- **Workspace for digital businesses (`DeskWorkspace.tsx`).**
  - **Header:** a compact identity (family, product facts, page state) and the name.
  - **One primary next action:** the first item that needs you, else the studio action; a system
    item is never offered.
  - **Quiet business links:** Public page, Value, Ownership and continuity, Sale and handover.
  - **Local navigation:** Overview · Performance · Products · Customers and growth.
    - `?view=` links push history, and Back/Forward select the view on the mounted page.
    - An unknown view means Overview.
    - A `#section` in the link scrolls to that section.
- **The four views stay mounted, only hidden.** So the cost form, reply drafts, update text, team
  choice, selling form and loaded data survive switching.
  - **Overview:**
    - the four operations tiles and the customer uses chart first;
    - "Waiting now" (needs you / waiting on the system, with the settlement state once);
    - one line per product with its released name.
    - Books failure shows Try again; with no customer product yet, it says so plainly.
  - **Performance:** the books (period, balances, earned/costs, cash, categories, every-figure
    table), digital operations (tiles, both charts, table, basis, links) and AI spend. **Add a
    cost** opens on request (`aria-expanded`); a half-filled cost survives closing it.
  - **Products:**
    - product cards with every action;
    - New product project and Public profile;
    - Edit page and legacy offering;
    - imported products;
    - the page's legacy offering and its missing facts.
  - **Customers and growth:** checklist, responses (reply drafts kept), DeskGrowth (payments
    setup, sessions, requests, updates), share, team, selling, take the page down.
- **Books read once.** `useBooks` is lifted out of `DeskBooks` and shared by Overview and
  Performance. Reads are sequenced, and 401/403/404 drops every figure (003t, unchanged).
- **Legacy desk** (class or service): same content and layout as before. It now uses the shared
  Checklist, Responses and TakeDown parts.
- **Palette regression fixed in every chart consumer.**
  - New `--data-*` tokens, separate from brand cobalt:
    - primary: cobalt, solid;
    - returned: teal, diagonal stripes;
    - founder trials and checks: plum, dots;
    - costs you entered: slate, horizontal lines.
  - Each has an SVG pattern (`SeriesPatterns`), an outline, and a legend swatch drawing the same
    pattern. Legend text also names it (solid/striped/dotted/lined, left/right).
  - Applied to:
    - customer uses: charged vs returned;
    - runtime cost: customers vs founder;
    - the books' earned vs costs (also identical before);
    - cash in;
    - the buyer's digital performance charts: customers vs founder.
  - The other existing marks are unchanged: hatch, red, dashed, grey, "?", fictional dots.
- **Released identity.**
  - `digitalDesk` products gain `released: { name, revision }`, read from the active release's
    built artifact (the same source as `customerUse.productName`).
  - Product cards title the product by its released name, and label a divergent or newer draft:
    "Draft brief (revision N): …". With no release, the brief name is shown as a draft.
  - Nothing is renamed.
- **`Link`** gains an optional `current` prop (`aria-current="page"`). Work-item links for
  inquiries and the checklist now open `?view=growth#desk-…`; "Choose a product" opens
  `?view=products#desk-products`.

Kept as before:
- sources, units, unknown versus zero, partial months, tiny exact costs, and the split between
  customer, founder and build costs;
- fictional-history labels;
- actor/owner keying (`DeskPage` keyed by actor and business) and the sequenced desk loader;
- access-loss behaviour.

## Verification

- **`web/test/operatingWorkspace.test.tsx`** (8 tests):
  - views from `?view=` and their links;
  - the next action (needs-you first, never a system item);
  - released versus draft identity (divergent, same name newer, no release);
  - a static render of the whole workspace: Overview visible, the other three rendered but
    hidden, the checklist mounted, one primary next action, `aria-current`, the released name,
    every business link;
  - every chart's series differ in colour **and** pattern, read from `styles.css`;
  - each series colour has at least 3:1 contrast against paper and canvas, and its legend
    swatch draws it;
  - rendered `UsageChart`: charged is `var(--data-primary)`, returned a stripes pattern defined
    in the same SVG, and no `var(--mint)`/`var(--blue)` fills;
  - rendered `CostChart`: customers versus founder.
- **`server/test/digital-desk.test.ts`** (+1 test): the released name stays "Invoice reader"
  after the draft brief is renamed. The revision numbers are consistent.
- **`server/test/workspace-preview.test.ts`** (1 test):
  - the label;
  - 6 months, of which the 5 earlier have labelled fictional history and costs entered through
    the app;
  - no customer use backdated;
  - two products, released name versus draft;
  - an empty digital business.
- **`web/test/digitalDesk.test.ts`** updated for the new work-item links.
- **Mutants**, each run alone with a time ceiling, all killed:
  1. returned drawn as the primary series (the original regression);
  2. founder colour equal to primary in CSS;
  3. product titled by its draft name;
  4. a system item as the next action;
  5. the growth view unmounted when inactive;
  6. the server naming the release from the draft brief.
- `npm run check`: lint (309 files) and types clean, **1047 tests / 105 files passed**.
- `npm run web:build`: passed (829.84 kB bundle; same size advisory as before).

## Preview for Astra (fictional, in memory; not started or left running by me)

```
npm run web:build
npx tsx scripts/preview-workspace.ts      # site 127.0.0.1:8850, controls :8851; Ctrl+C ends it
```

As Ava, the URLs printed are `/desk/<business>` and its `?view=performance|products|growth`,
plus an empty digital business.

What is observed versus fixture:
- **Customer uses:** recorded this month by the app's own routes (the operations preview);
  earlier months are recorded zeros.
- **Earlier months' revenue:** fictional example history, labelled in the books.
- **Earlier months' costs:** fictional founder costs entered through the cost route.
- **Second product:** brief only.
- **The released product:** its draft brief is renamed "Ledgerline Rows (draft)" while the
  release stays "Invoice reader".
- **Controls:** `POST /maintenance/pass` and `/use`.

The existing `preview-operations.ts` is unchanged (8820/8821).

## Limitations and unverified gates (no browser tool)

- **Not browser-verified:**
  - 1440, 1280 and 390 composition and zoom;
  - grayscale reading of the patterns at actual size;
  - keyboard focus through the local navigation and charts;
  - hash scrolling to a section after a view switch;
  - the empty and unknown (failed books) states in a real browser;
  - phone overflow of the header's next action.

  Astra's review is the gate.
- **Not in the preview:** an unknown-cost "?" month and a chain-read failure. Their rendering and
  wording are the existing ones, covered by earlier unit tests.
- **The legacy desk** keeps its long single page (not redesigned in this job).
- **Live integrations are not exercised.** Charts show this app's records; no live provider,
  chain or payment integration.
- **Process note:**
  - **A broad search.** One command I ran piped a second `git grep -v` that searched every
    tracked file without a path limit. Tracked files only: git grep doesn't read ignored or
    untracked paths such as `docs/research`, `.env` or `data/runtime`. Its saved output was not
    opened, and all later searches were path-scoped.
  - **BUILD_STATE.** The harness reported Astra's ignored `docs/astra/BUILD_STATE.md` changing
    during one of my format commands. My command named only three test files, and I did not
    touch it.
- **Astra's concurrent files:** they appeared during this pass and were left unstaged:
  `docs/astra/INDEX.md`, `2026-11-04_HelperReadAuthorityReview.md`,
  `2026-11-04_OperatingNetworkPlan.md`, `jobs/2026-11-04_005b_helper-read-authority.md` and
  `jobs/2026-11-04_005c_expert-help-workflow.md`.
- **Scope:** 001i, 001j, 004b, 005b and 005c were not started. All six milestones remain open.
  No provider, RPC, wallet, signing, deploy, push or spending.
