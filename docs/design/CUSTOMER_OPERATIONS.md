# Customer operating performance (job 003t)

Claude, 2026-11-04. Authority: [003t](../astra/jobs/2026-11-04_003t_customer-operating-performance.md).
It adds a "Digital operations" section to the owner's existing books
(`GET /api/businesses/:id/books`, owner-fenced). The legacy books, seeded history, imports and
buyer disclosure are unchanged. This document was written before the code.

## One authoritative aggregation

`customerOperations(db, businessId, months)` (`server/src/operations.ts`) is the only
calculation. It reads persistent local records and serializes counts and exact sums only: no
customer identity, document, result, reference or raw diagnostic.

**Bounds.** At most 24 UTC months. Every query is bounded by `business_id` and by the period's
first instant.

## Usage: a request cohort, with its current outcome

**The cohort.** A customer use belongs to the UTC month its request was created
(`customer_requests.created_at`, written once and never updated). Its month never moves. Its
**outcome is its current recorded status**, so a cohort's split can change as outcomes resolve
(labelled "as of now"). A retry, a lost reply or a re-read never creates another request:
requests are idempotent per person and key, so nothing is counted twice.

**Status buckets.** Exclusive; together they add up to the requests:

| Bucket | From the records |
|---|---|
| Charged | Settlement `charged` (exact contract readback) |
| Returned | Settlement `returned` |
| Settling | Settlement `requested`/`unknown`: an outcome not yet known; never counted as charged |
| Needs attention | Request conflict, request `unresolved`, or settlement `conflict`/`unresolved` |
| Reserved, not settled | Reserved, no settlement yet (not run, or its delivery is still undecided) |
| Awaiting reservation | `reserve_requested`/`reserve_unknown` |
| Never reserved | Prepared, cancelled, expired or refused |

**Execution facts.** These are separate and overlap the buckets above:
- **ran:** an execution exists;
- **usable result:** the same rule as charging eligibility, i.e. delivered, extracted, and the
  invocation completed with an extraction;
- **not usable:** final, but not eligible;
- **undecided:** still running, or a completed run whose delivery is undecided;
- **unknown:** the invocation's outcome is unknown.

**No settled value.** It isn't computed. The exact per-request contract evidence would need a
validated snapshot of the unit price and asset per hold. Charged counts are units, not money. No
revenue, cash or profit figure comes from customer uses, and nothing is mixed with v2 earned
revenue.

## Runtime cost by purpose

`runtime_invocations` is grouped by the UTC month of `created_at` (written once) and by
`purpose`:

| Group | Purposes |
|---|---|
| **Serving customers** | `customer_use` |
| **Founder trials and checks** | `trial`, `release` (an owner trial on the released version) and `evaluation` |

**Exactness.**
- Sums are exact `charged_microcents` (millionths of a cent), returned by SQLite as decimal
  **text** and carried as strings. Nothing is rounded per call or converted to a JavaScript
  number before display.
- Calls whose usage is `partial`/`unknown` are counted apart, with their reserved cents. They are
  never treated as zero cost.

**Build spend** stays its own ledger (`spend.build`).

**Labels.** These are computed costs from reported tokens at declared prices, not invoices or
proof of payment.

## Periods

Months are UTC. The current month is marked "so far". A month with no records reads as an actual
zero, because these are this app's own complete records, not a remote read. A business with no
customer offer and no request reads "not started", with a next step in the studio.

## Ownership

- The books route already checks control before and after its reads.
- After an actual acquisition reconciliation, the buyer sees the same business history, because
  requests and invocations keep their `business_id`. The former owner gets 404.
- Customers keep their own records.
- The buyer evidence room doesn't receive this section. Making it available to buyers is the next
  gate.

## Browser

- The **Digital operations** card in Books holds:
  - totals;
  - a usage chart (stacked status counts per month, one keyboard stop per month with every
    figure);
  - a cost chart (serving customers vs founder trials and checks, with unknown-cost markers);
  - a source table;
  - links to Customer access, Ownership and continuity, and Sale and handover.
- The page sequences its loads, and clears its data when access is lost.

As built:
- the desk is keyed by who is acting and which business, so a switch unmounts it and a late
  answer for the previous view lands nowhere;
- a 401/403/404 on reload drops every figure;
- costs are formatted from the exact string with BigInt (`web/src/operations.ts`); chart
  heights use a float, but the text and table are always exact.

## Preview

`npx tsx scripts/preview-operations.ts` (site on :8820, controls on :8821, 127.0.0.1 only) builds
on the acquisition preview and is labelled synthetic on every page.
- Fictional customers' uses are recorded this month through the app's own routes. Nothing is
  backdated: earlier months are recorded zeros.
- The maintenance worker runs a pass only when a control asks.
- The sale applies only through the app's reconciliation.
- `server/test/operations-preview.test.ts` drives it through the site's fetch.
