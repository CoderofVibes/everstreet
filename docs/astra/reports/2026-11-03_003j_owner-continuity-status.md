# 003j report: Ownership and continuity

Claude, 2026-11-03. Job: [003j](../jobs/2026-11-03_003j_owner-continuity-status.md).
Commit `7e2246c`.

## What was built

**The page** (`web/src/pages/Continuity.tsx`, route `/desk/:id/continuity`) is linked from the
business desk header and keyed by person and business. It reads the existing owner-only
`GET /api/businesses/:id/v3` and refreshes through the existing `POST .../v3/refresh`. In order:

1. **Needs attention.** Each item, in plain words:
   - not connected, paused, never read, or reading not set up;
   - a sticky conflict flag;
   - stale evidence;
   - an owner mismatch (reconciliation needed, nothing changed automatically), or an unknown
     mapping;
   - a changed binding, or a history gap;
   - no transport;
   - a sale in progress;
   - access unconfirmed, with **Check access**.

   A standing line says what isn't verified: the endpoint's chain, handover of the app and external
   accounts, and each customer's remaining uses.
2. **Read again.** A deliberate refresh, with an optional yyyymm month, and a `role="status"`
   `aria-live` result. Nothing refreshes when the page opens, and nothing polls.
3. **The observation line.** Block, read time, age, fresh or stale (recomputed every 30 s from the
   server's times), and the provenance.
4. **Ownership.** The chain owner, the control generation, the comparison with the owner here, and
   how sales close.
5. **Customer obligations and funds.** The contract's own categories:
   - prepaid by customers, not yet used;
   - reserved for uses in progress;
   - owed claims;
   - payouts sent but not yet confirmed;
   - the business's own funds, and what the owner can withdraw;
   - the buyer's escrow;
   - the total held.

   Every figure is exact digits, grouped, in "base units of {asset}"; no decimals or dollars are
   assumed. The page says these totals don't show individual remaining uses or service health.
6. **Transfer in progress.** The deal number, terms version, state, buyer, price, escrow, who has
   accepted, the offer's expiry, and the closer's deadline when closing.
7. **Past deals.** Each outcome with its contract date and the block it was first seen at, plus the
   history note and any unobserved deals. It says a closed deal moves control on chain but doesn't
   show that the app, data or accounts were handed over.
8. **Monthly books.** Each month with its own read time and block. An inexact counter shows as
   "at least". Months never read are absent, and no-activity and not-retained months say so. The
   page says only these counters show money actually paid.
9. **Evidence details** (expandable). The contract, network and schema; the block hash; the
   high-water mark; the operator-asserted network note; the flag code and detail; and the manifest
   pointer.

**The controller** (`web/src/continuityController.ts`) applies the 004a2 and 004a3 rules:

- **Ordering.** Reads are sequenced, so an older answer never replaces a newer one.
- **Changes of hands.** A different `owner_epoch` drops the typed month and the last result.
- **Access loss.** A 404 refresh is rechecked with a read. 404 again clears everything, and it
  stays cleared. A failed check leaves access "unconfirmed", the refresh settles (it never stays
  "sending"), and refresh is blocked until an explicit successful check.
- **Failures keep evidence.** A refused, unanswered (no network) or 5xx refresh keeps the evidence
  object and its original `observed_at`. A conflict outcome is reported as "Nothing was applied".
  No flag is ever cleared.
- **Retiring.** Late answers after leaving the page are dropped.

**The client** (`web/src/continuityApi.ts`) validates every displayed value: amounts and heights
must be decimal strings, times must parse, and the counters' exactness must be boolean. A malformed
answer is an error state, never a partial page. Nothing becomes a JS number; only the integer
`stale_after_ms` and small counts are numbers. Browser types are separate from the server's.

**Server, additive only** (`server/src/v3observe.ts`):

- every view state carries `owner_epoch` (`owner:generation`, as other pages use);
- observed views carry `served_at` (the server clock) and `stale_after_ms`.

**The preview.** `scripts/lib/continuityPreview.ts` is the scenario and `scripts/preview-continuity.ts`
adds the listeners:

- In memory: the real API and the Rust-produced fixtures. Provenance is synthetic and labelled.
- Loopback only: the app on 127.0.0.1:8802, with controls on 127.0.0.1:8803 as a separate server,
  so no control route exists in the app.
- No keys, runtime data or external requests.
- Setup throws if any intended state isn't built.

## Evidence

| Test file | Tests | What is shown |
|---|---|---|
| `web/test/continuity.test.ts` | 16 | Below the table |
| `server/test/continuity-preview.test.ts` | 3 | The preview, driven through the real API in memory with no listener, has every promised state. Unrelated Noah gets 404. Offline, slow and block-unavailable modes give `unavailable`, `timeout` and `block_unavailable`, with `observed_at` and the block unchanged. A month refresh is accepted. The transfer control gives 404. The paused variant pauses only v3. |
| `server/test/v3-observe.test.ts` | +1 | `owner_epoch` in every state. `served_at`, `stale_after_ms` and the month persist across a reload with their own times. An unrelated person gets 404. Away and back changes the epoch. |

The controller tests cover:

- unbound, paused and never-read states, each blocking refresh;
- freshness turning stale as time passes;
- exact large amounts, with an `exact: false` counter and an absent month;
- seven malformed answers refused, and a malformed first answer as an error;
- flags, mismatch, unknown mapping and gaps;
- no request when the page opens, a month refresh, and a double press sending once;
- refused, offline and 503 refreshes keeping the evidence, its time and its flag;
- a conflict outcome, a bad month, and a 400;
- an older read arriving after a refresh;
- 404 then 404 (gone, and it stays gone);
- 404 then a failed check (unconfirmed, then an explicit check twice);
- an epoch change mid-refresh;
- a 409 followed by a re-read;
- disposal, and a failed first load being retried.

**Mutation checks.** Each was run alone in a single-file run of about 0.3 s, then restored and the
diff inspected, before the full suite:

| Mutant | Failing tests |
|---|---|
| No read sequencing | 1 |
| No 404 recheck | 2 |

Every scripted answer is a single finite value. Nothing in the 003j tests streams.

```
npm run check        Test Files 40 passed (40); Tests 519 passed (519), 3.79 s
npx biome check .    171 files, no fixes
npm run web:build    built; JS 633.76 kB (existing chunk-size advisory)
```

## For Astra's browser review

Run `npm run web:build && npx tsx scripts/preview-continuity.ts`, or add `--paused` for the paused
state. The script prints each URL and person id. Act as Mara with the local-preview acting-context
switcher; use Noah to check refusal.

**Businesses:**

| Business | State |
|---|---|
| Ledgerline | Fresh, a direct sale accepting, November read |
| Harbor | Stale, owner mismatch, conflict flag |
| Quayside | A gated sale closing |
| Tidewater | Unknown owner mapping, history gap |
| Quillmark | Connected, never read |
| Northline | Not connected |

**Controls:**

- `POST 127.0.0.1:8803/mode/offline`, `/mode/slow` and `/mode/block_unavailable` give refusals;
  `/mode/ok` returns to normal.
- `POST /transfer/<businessId>` moves a business to Noah, to test access loss mid-page.

**To check:**

- the 1440, 1280 and 390 widths;
- keyboard access to Refresh and Check access;
- the status announcement;
- freshness turning stale after ten minutes on Ledgerline.

## Limits

- **No browser run.** Starting the loopback listener needs an approval I don't have in this
  session, so I didn't open the page. The page wiring is covered by types, the build and the
  scenario tests, not a DOM test.
- **Asset decimals are not used.** No trusted metadata exists, so every figure is base units.
- **Still pending:**
  - endpoint chain identity;
  - reconciliation into app ownership;
  - the managed closer;
  - customer runtime and entitlement integration;
  - a live endpoint.

  The page lists these gaps rather than hiding them. M3 and all milestones stay open.
- **Astra's new note left unstaged.** `docs/astra/2026-11-03_ContinuityIntegrationPrep.md` and its
  INDEX row appeared during this run and weren't in this run's commit list, so I left them for the
  next handoff.

Stopping here for Astra's review.
