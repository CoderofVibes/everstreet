# Customer operating performance

**Why (Tony's words):** "The financial performance page is plain too - no charts, graphs, or anything."
"One key function ... seamless purchase and transfer ... on NEAR."

## What the person sees and does

Bring the now-working customer runtime into the founder's operating desk. A founder can answer:
Are customers receiving usable results? How many uses completed, failed, were returned or still
need settlement? What did serving them cost, separately from building/testing the product?
After a confirmed acquisition the buyer sees the same business operating history; the former
owner cannot inspect new private performance. This is an M3/M5 vertical slice, not a new dashboard
of invented figures or a claim of live trading.

Use a concise digital-operations section in the existing books/desk with a prominent usage trend,
customer runtime cost trend, useful current totals and a source table. Reuse the established
visual system and FinanceChart conventions. Time range, UTC bucket meaning, current partial
period, exact units and observation/source labels must be clear. Give unknown settlement/cost
its own state. A missing connection is not zero. Empty businesses get a next action in Studio.
Link to Customer access and the existing maintenance/continuity views rather than duplicating
their controls. No customer document, result, identity, protected reference or raw diagnostics.

## Checked foundation and gap

- `server/src/books.ts` has corrected legacy monthly chain/seeded sources and spend(). spend
  currently groups all runtime purposes together, with trials, evaluations, released calls and
  customer uses in one total. Its note still says "until customers are connected".
- `server/src/invocations.ts` records purpose trial/evaluation/release/customer_use and actual
  reported-token cost, partial/unknown usage and reserved amount. Build cost is a separate ledger.
- `customer_requests`, `customer_executions`, `customer_settlements` hold real local lifecycle
  records and exact readback evidence. CustomerUses already separates charged/returned/unknown;
  idempotency, lease fencing and ownership reconciliation are implemented. No need to invent
  another unit ledger or change the contract for this slice.
- `web/src/pages/DeskBooks.tsx`, FinanceChart.tsx, api4.ts and financialMonth are existing surfaces.
  Preserve legacy v2 books, buyer disclosure boundaries, imports and seeded figures.

## Underneath

Write a short data/metric design first. Keep a single authoritative aggregation and serialize
only owner-safe fields. Define request cohort vs completion/settlement period explicitly; a
request crossing months must not silently move totals after retries. Use recorded timestamps,
not the latest status read time. If terminal timestamps are missing, add a forward-safe migration
or explicitly labelled historical unknown; do not fabricate precision by using mutable updated_at.

1. Aggregate customer lifecycle counts from persistent records, distinct business-owned products
   and requests. Separate requested, successfully fulfilled, unsuccessful/unknown execution,
   charged, returned and unsettled counts. Explain non-additive/current vs period metrics. No
   optimistic revenue from a provider success or an attempted settlement.
2. Split actual runtime spend by purpose (customer service vs founder trials/checks vs any other
   existing purpose) and build spend. Retain exact microcent totals and unknown-cost reservations;
   never round each call to cents before summing. No silent safe-integer overflow. Provider-token
   calculations are computed USD costs, not invoices or proof of an actual external payment.
3. If a settled-value metric is implemented, name it exactly: local requests with recorded
   contract evidence, valued using the committed unit price/asset. Validate source identity and
   avoid duplicate evidence/holds. Do not call it a complete chain ledger, cash receipt, total
   revenue, prepayment flow, historical balance or profit. Do not combine currencies/test tokens
   with USD or existing v2 earned revenue. Prefer omitting this metric with a truthful gap if the
   exact required snapshot is absent. Usage and real runtime-cost integration are mandatory.
4. Bound date ranges/queries and data volume. Protect all new API reads by current business
   ownership; clear browser data on actor/business/access loss and fence delayed responses.
   Buyer evidence must not expand automatically: reuse current disclosure scopes only if safe,
   otherwise keep this slice owner-only and record buyer evidence as the next gate.
5. Preserve history through actual app acquisition reconciliation. A former owner loses access,
   the new owner gets business totals, and customer private result/history is unchanged. No SQL
   ownership shortcut in the acceptance test. Aggregates must not disclose one customer's content.

## Done when

- A disposable scenario runs multiple real customer API uses with successful, returned and
  unknown outcomes, automatic maintenance and cost records. The desk matches those records.
  Include repeated/lost replies without duplicate usage/cost; 100/20/80 where practical with
  finite fixture ceilings, and continuation after actual app reconciliation.
- Tests cover two businesses/actors, multi-period boundary, actual zero vs unknown, distinct
  purposes, exact small costs, partial/unknown cost, retired offer history and late access loss.
  A live chain/provider is not required and must not be silently substituted by test fixtures.
- Charts have labels, units, keyboard-readable values and table alternative; 1440/1280/390 layouts
  usable. No CSS-mirroring test needed. Supply an isolated explicitly synthetic preview with
  enough real recorded API activity to review charts, owner change and customer continuity.
- npm run check/web:build pass. Report commits, metric definitions/limitations and browser work
  performed. Stop for Astra review. M3/M5 and all six milestones remain open.

P1/L after002d1. No main/live wiring, credentials, signing/deploy, transactions, new spending,
public push/release/submission, research access/assessment or Day One. No scope cuts to M4/M6.
