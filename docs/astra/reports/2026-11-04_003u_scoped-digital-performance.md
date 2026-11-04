# 003u report: scoped digital performance for an acquirer

Claude, 2026-11-04. Job: [003u](../jobs/2026-11-04_003u_scoped-digital-performance.md). Commit
`19d2e4d`, on top of `23c30ca` (002d2). Not pushed. No contract, `main.ts`, package, provider or
remote change. No buyer was contacted. The design was written first:
[DIGITAL_PERFORMANCE_EVIDENCE.md](../../design/DIGITAL_PERFORMANCE_EVIDENCE.md).

## Scope and grants

- **A new category, `digital_performance`.** Its wording: "Digital service performance in
  aggregate: customer uses by month and outcome, usable results, work still open, and the
  runtime cost of serving customers apart from the founder's own tests (no customer names,
  documents or results)".
- **Scope wording 4.** The earlier categories and wordings are unchanged, and nothing is
  migrated.
- **Shown only** when the grant includes the new key **and** was made at `scope_version >= 4`. A
  tampered or older row shows nothing (tested).
- **Explicit both ways:**
  - the request form's default stays financials and operations;
  - the seller can only grant or narrow what was asked, so adding it is refused (400, tested);
  - pending requests can't contain the key.

## The projection

`performanceEvidence()` calls the one aggregation, `customerOperations` (003t/003t1), once:
- **Window:** one fixed window of 12 UTC months, as of one instant.
- **Allowlist:** it builds a fresh object with exactly these fields: `as_of`, `state`, `period`,
  `usage` (total and a 6-way split), `months` (requested, customer calls and cost, founder calls
  and cost), `execution`, `current` (open work, without customers' unsigned preparations),
  `cost`, `basis`, `suppression`, `limits`.
- **Excluded:** no ids, links, worker or holder facts, documents, results or references
  (tested).
- **Exact:** costs are exact microcents text and agree with the owner's books (tested).
- **No money value** comes from uses. The "not revenue/cash/profit/valuation/testnet/provider
  proof" text is in the data and the tab.

**Suppression** (`suppressPartition`):
- **Primary:** a count of 1–2 becomes "Fewer than 3".
- **Secondary:** if exactly one cell in a partition is hidden, the smallest other non-zero cell
  is hidden too, or the total if there is none. A small total hides all its cells.
- **Partitions:** the usage split, the monthly series, execution, open work, and monthly
  customer calls.
- **Costs follow calls:** a customer cost is hidden with its calls.
- **Founder cost** is never hidden: it is the founder's own activity.
- **Tested exhaustively** over 3-cell partitions of 0–4: no single small value is recoverable
  from a published total.
- **Coarsened:** monthly rows give totals only, over one fixed window, so there is no two-way
  table and no differencing between windows.

## Access

- **The gate:** the section is read inside `withGrant`, after the other reads and before the
  post-check. Room and export share `scopeRoom`, so they carry the same allowlist (tested).
- **Ends access:** revocation, expiry and role removal **while a read is held in flight** (deal
  world's monthly-read gate) give 403 with no section, for both room and export.
- **Sales:** after the actual v3 reconciliation, the old grant shows nothing (existing
  revoke-on-sale).
- **Browser:** the room's existing per-actor, per-room, per-load view (`evidenceView.ts`). Tests
  show a refused reload clears the section, an older load's late success changes nothing, and
  another person or an unchecked load never shows it.
- **Audit:** room-open logging is unchanged, and nothing private is logged.

## Room

The new **Digital performance** tab is disabled with "· not granted" unless granted. It holds:
- the as-of time and window;
- tiles: uses requested, usable results, open work, cost serving customers beside founder cost;
- the outcome split;
- a monthly uses chart and a monthly cost chart (customers vs founder). Hidden counts are a
  hatched marker; each month is a keyboard stop with its full text;
- a table, basis, unknown cost, the suppression rule and limits.

"Nothing recorded" is a separate notice from "not granted". There are no links into the seller's
tools and no actions.

## Preview

```
npm run web:build
npx tsx scripts/preview-evidence.ts
```

- **Setup:** site on :8824, controls on :8825, 127.0.0.1 only, labelled synthetic. It is built on
  the operations preview.
- **Business:** published and listed privately through the routes.
- **Two pending requests:**
  - Fenn Holdings (Noah Fenn (buyer)) asks for financials and digital performance;
  - Ruiz Ventures (Ana Ruiz (buyer)) asks for financials only.
- **The owner decides** at `/desk/:id/sale`.
- **Test:** `server/test/evidence-preview.test.ts` drives it through the site's fetch: grant,
  scoped room, export parity, Ruiz without the section, and the actual sale ending Fenn's
  access.
- No listener was left running.

## Checks

- `npm run check`: **861 tests in 84 files**, lint and types clean (845/81 before).
- `npm run web:build`: passes (778.40 kB, the existing size advisory).
- **New tests:**
  - `performance-evidence.test.ts` (11);
  - `evidence-preview.test.ts` (1);
  - `web/test/performance.test.ts` (4).
- **Unchanged:** the existing 91 evidence and acquisition tests pass.
- **Mutants**, one at a time and each restored. All 5 were killed:
  1. scope version ignored;
  2. no secondary suppression;
  3. the owner's product ids leaked;
  4. a month's customer cost shown with hidden calls;
  5. the browser writing the raw hidden marker.

## Limits

- **Not browser-verified:** no layouts checked at 1440/1280/390, no keyboard pass and no zoom.
- **Residual inference, stated in the room:**
  - time differencing between reads;
  - rough bounds from related partitions (charged and usable);
  - the combined cost of two or more hidden months.
- **The window is fixed at 12 months.** There is no period choice, deliberately.
- **Publishing a digital business still needs the legacy page offering's title**
  (`Your offer needs a title`). The tests and preview set it through its route. Worth a separate
  job.
- **Labels:** the buyer's request list (Acquire page) shows category keys raw, e.g.
  `digital_performance`, as it already did for the others.
- **All six milestones stay open.** This is not a completion claim from fixtures.
