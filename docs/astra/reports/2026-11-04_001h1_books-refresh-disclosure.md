# 001h1 Books refresh disclosure: report

Builder: Claude (Opus 5.5, high), sole writer. Job: `jobs/2026-11-04_001h1_books-refresh-disclosure.md`.

## Reproduced first (previous code)

`web/test/booksRefresh.test.tsx` first rendered the actual `BooksPanel` in the state the previous
`useBooks` held after Astra's sequence: six-month data kept, `period` 12, and
`loadError "Request failed (503)"`. **It failed:** the panel showed no notice that the 12 months
couldn't be loaded, and no Try again. Its only "last 6 months" text was the AI spend line.

Cause, as Astra found:
- `useBooks` kept data on a failed read and set `loadError`.
- Both renderers showed the error only when there was no data.
- The selector showed the requested period while the figures showed the returned one.

## Fix (no finance rewrite)

- **`web/src/booksRead.ts` `BooksRead`:** the production shared read, which `useBooks` now wraps.
  - It keeps `requested` (the selector), `data` (last success, whose `period_months` is the
    figures' own period), `status` and `error`.
  - `readAt` is the device-side time of the last success, and is always labelled "on this
    device". No timestamp is invented.
  - Only the newest request lands. 401/403/404 drop data and `readAt` (003t, kept). `close()` on
    unmount drops late answers.
  - `retry()` re-asks the requested period only; it never resubmits a cost.
- **`booksNotice`** (one sentence for every state):
  - Loading another period: "Loading the last 12 months. Until then the figures below are the
    last 6 months (read at HH:MM on this device)."
  - That load failed: "The last 12 months couldn't be loaded: …. The figures below are still the
    last 6 months (…), not the last 12 months." With Try again.
  - A same-period refresh failed: "Couldn't refresh the books: …. Showing the figures last read
    for the last N months (…)." With Try again.
  - Nothing loaded yet and it failed: an error, "Nothing is shown as zero", Try again.
  - Access lost: "The books can't be shown: …", no retry.
  - A success clears it.
  - Announced with `role="status"` (loading) or `role="alert"` (failure).
- **`BooksNotice`** is rendered in:
  - **Performance** (`BooksPanel`), above the figures, and as the whole card when there are none;
  - the **Overview** (`OverviewFigures`, extracted from `DigitalWorkspace`), in every state;
  - the **legacy desk** (`DeskBooks`, the same `BooksPanel`).

  The add-cost form state lives in `BooksPanel`, which stays mounted across a retry, so a draft
  cost is kept.
- **Preview:** `workspacePreview` wraps its site so the next books read, for any period, fails
  once with a labelled 503 or 404. A 2,000-request ceiling applies. Control:
  `POST :8851/fail/books/503|404`.

## Verification

- **`web/test/booksRefresh.test.tsx`** (6 tests). It drives the actual `BooksRead` through the
  page's `booksHandle`, with held answers and a request cap, and renders the actual `BooksPanel`
  and `OverviewFigures`:
  - **Astra's sequence:** 6 succeeds, then 12 pending (labelled), then 503 (warning and retry in
    both Performance and Overview; the selector still on 12), then retry asks 12, then success
    (12 shown, warning gone). Exactly 3 requests.
  - a same-period refresh failure is labelled as last read;
  - a first-load failure is an error, never `$0`, in the legacy panel too;
  - out-of-order answers: 12 then 3 requested, the 3 answer first and the 12 answer late; only 3
    lands;
  - 401, 403 and 404 each drop all figures and the read time, with no retry offered, as rendered
    in the Overview;
  - a closed page ignores a late answer.
- **`server/test/workspace-preview.test.ts`** (+1 test): through the preview site, 6 succeeds,
  then a one-shot 503 on a 12-month read. Other reads are untouched, the next 12-month read
  returns `period_months` 12, and a one-shot 404 follows. The state counter is consistent.
- **Mutants**, each run alone with a time ceiling, all killed:
  1. no notice for a failed read that still has figures (the original behaviour);
  2. older answers allowed to land;
  3. figures kept on access loss;
  4. the notice removed from Performance.
- `npm run check`: lint and types clean, **1076 tests / 109 files passed**.
- `npm run web:build`: passed (835.28 kB bundle; same size advisory as before).

## Preview for Astra (fictional, in memory; not started or left running by me)

```
npm run web:build
npx tsx scripts/preview-workspace.ts      # site 127.0.0.1:8850, controls :8851; Ctrl+C ends it
```

As Ava:
1. Open Performance.
2. `POST :8851/fail/books/503`, then choose "Last 12 months". Both Performance and the Overview
   should say the 12 months couldn't be loaded and that the figures are still the last 6.
3. Try again recovers 12.

`POST :8851/fail/books/404` removes the figures in both views.

## Limitations and unverified gates

- **No browser tool here.** Not checked in a browser:
  - the notices' placement and announcement in a screen reader;
  - phone fit at 390;
  - a cost draft surviving a retry in the actual page (it isn't remounted, but this is not
    browser-verified).
- **Overview's recorded-operations branch** renders `BooksNotice` the same way. The test renders
  the Overview through its no-product and refused branches, not the recorded branch, whose
  fixture would need a full operations projection.
- **Not in this job:**
  - whole-owner-loss (a sale while open);
  - zoom and reduced motion;
  - live integrations.

  001h stays in review for its broader gates.
- **Astra's concurrent files:** they appeared during this pass and were left unstaged:
  `docs/astra/INDEX.md`, `2026-11-04_ExecutableProductPlan.md` and
  `jobs/2026-11-04_002e_executable-product-path.md`.
- **Scope:** 001i and later jobs were not started. All six milestones remain open. No provider,
  RPC, wallet, signing, deploy, push or spending. Searches used `git grep` with explicit paths
  and the scoped search tool on named files only.
