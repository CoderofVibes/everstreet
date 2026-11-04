# Legacy customer evidence: whole-summary disclosure (job 003u2)

Claude, 2026-11-04. Authority:
- the job: [003u2](../astra/jobs/2026-11-04_003u2_legacy-customer-disclosure.md);
- Astra's reproduction: [LegacyDisclosureReproduction](../astra/2026-11-04_LegacyDisclosureReproduction.md).

Code: `server/src/legacyCustomers.ts`, used by `Acquisitions.customers()`, the one projection
shared by the room and the export.

## What it covers

The older **customers** evidence category ("Customer activity in aggregate (no names)") is
granted to a buying team for a legacy business. It shows:
- paying customers;
- paid orders (paid, delivered, kept, refunded);
- delivered;
- refunded;
- customers with 2 or more orders;
- bookings;
- upcoming sessions (the business's schedule, not a customer count).

The digital customer-use evidence is separate (`digital_performance`,
[DIGITAL_PERFORMANCE_EVIDENCE](DIGITAL_PERFORMANCE_EVIDENCE.md)) and unchanged.

## Threat model

**The reader.** An authorized buyer team member. They read the complete summary (room or
export, which are identical) as often as the grant allows.

**Single-summary guarantee.** No listed count or defined group difference below is disclosed as
exactly 1 or 2. This does not cover every possible subgroup or repeated observations over time.
The defined differences counted are:
- orders neither delivered nor refunded;
- customers with exactly one order;
- orders beyond each customer's first;
- orders beyond the second, for repeat customers;
- bookings without an order, or orders without a booking.

**What it does not cover:**
- differences between reports at different times. Astra's two-snapshot probe publishes
  (customers3,orders9,delivered3,refunded3,repeat3,bookings0), then the same counts with orders10
  and delivered4; both pass the rule, so the reader learns exactly one new delivered order. No
  external knowledge is needed. The buyer-facing limits explicitly disclose this boundary;
- arbitrary subgroup inferences beyond the listed counts and defined differences;
- what the buyer knows from elsewhere;
- customer identity itself (the summary has no names);
- other evidence the same buyer is granted. Financials publishes exact monthly money; with a
  fixed price, order or refund counts follow from it. That is a property of the granted
  financial scope. This job doesn't remove or weaken it, and says so to the buyer.

## Rule

1. Compute every published count and every group difference above.
2. If **any** is 1 or 2, every count in the summary is "Withheld" together, zero included.
3. Otherwise every count is exact, and zero is shown as zero.

Because withholding is all-or-nothing, "Withheld" never says which figure was small, or whether
a given figure is small or large. Being withheld does say that *some* group is small; the buyer
is told so. Upcoming sessions stay shown in both cases.

**Why not coarsen cell by cell** (the rule before this job): every cell can be safe on its own
while the complete output still pins one. Astra's case: 4 orders, 3 delivered and a refund of
"Fewer than 3" leave exactly 1 refund.

## Provenance wording

The source line now says what the stored records establish:
- **Orders:** payment records Everstreet stored for the business's checkout, not re-read from
  the chain for this summary.
- **Bookings:** records stored when the booking service confirmed a place. Whether that service
  is connected now isn't shown.

It no longer says "records of NEAR testnet payments" or "OpenSeat (connected service)",
which an unconfigured fixture couldn't support.

## Unchanged

The category, its consent label, scope versions, grant, revoke, expiry, role and owner fences,
and room/export parity. No grant widening and no retroactive consent change.

## How it's tested

- **Real routes** (`server/test/legacy-customers.test.ts`): Astra's case, an all-large case,
  no records, revocation, and room/export parity.
- **A bounded feasible-set oracle** over 369,075 legacy worlds (up to 4 customers × 1–3 orders ×
  4 statuses × 0–4 bookings). No complete output pins any modelled group to 1 or 2. The previous
  rule fails the same oracle with Astra's singleton.
- **Boundary cases**, including derived-only groups and the all-or-nothing zeros.
