# 003u2 Legacy customer disclosure: report

Builder: Claude (Opus 5.5, high), sole writer.
- Job: `jobs/2026-11-04_003u2_legacy-customer-disclosure.md`.
- Design note: `docs/design/LEGACY_CUSTOMER_EVIDENCE.md` (threat model, rule, limits).

## Reproduced through the real routes (on the previous code)

The `server/test/legacy-customers.test.ts` route tests use a legacy business, a private listing,
a buyer team with a customers-only grant, and four fictional stored payment rows for one
customer (3 delivered, 1 refunded). They were run against the committed `acquire.ts` from before
this job. 4 of the 5 route tests failed:
- Refunded read `"Fewer than 3"` beside Paid orders 4 and Delivered 3.
- The source claimed "records of NEAR testnet payments" and "OpenSeat (connected service)".
- There was no withheld flag or limits.

The test of the earlier per-cell rule shows the bounded oracle pins Astra's refund to `[1]`.

A note on the process: the temporary restore of the old file worked, but the backup copy to
`/tmp` was refused (outside the working directory). The fix was therefore re-applied by hand
after the run. It is the same change, and its tests pass again.

## Fix

- **`server/src/legacyCustomers.ts`** (pure). It computes every published count and every
  difference that is itself a group:
  - orders neither delivered nor refunded;
  - customers with exactly one order;
  - orders beyond the first;
  - orders beyond the second for repeat customers;
  - bookings minus orders.
  If any is 1 or 2, all six counts are "Withheld" together, zeros included. Otherwise all are
  exact, with zero as zero.
- **`Acquisitions.customers()`** uses it. It is the single projection for the room and the
  export, so they stay identical.
  - The rows keep their meanings. "Bookings through OpenSeat" is now "Bookings".
  - Upcoming sessions (the schedule) stay shown.
  - It adds `withheld` and `limits`.
  - The note no longer says "so nobody can be singled out".
  - The source states what the stored records establish (`legacySource`).
- **Room UI (`AcquireRoom.tsx`):**
  - When withheld, one notice explains that the counts are withheld together and that Withheld
    says nothing about which figure or how large.
  - A "What this protection doesn't do" disclosure lists the limits: being withheld itself says
    some group is small; there's no anonymity against outside knowledge; granted monthly money
    can imply order counts.
  - The export carries the same fields.
- **Unchanged:** category, consent label ("Customer activity in aggregate (no names)"), scope
  versions, grant, revoke, expiry, role and owner fences, digital performance evidence, and the
  other scopes.

## Verification

- `server/test/legacy-customers.test.ts` (8 tests):
  - **Routes:**
    - Astra's case is all withheld, with room equal to export and upcoming sessions still shown;
    - the provenance wording, with limits including the financial-scope inference;
    - a large world (6 customers, 9 orders, 6 delivered, 3 refunded, 3 repeat, 0 bookings) is
      exact in room and export;
    - no records gives zeros with the no-records source;
    - after revocation the room is 403 with no customer data.
  - **Oracle:**
    - all 369,075 worlds, a count asserted against a hard bound;
    - each test has a 60 s ceiling; the whole file runs in about 0.9 s;
    - the previous rule pins Astra's refund to {1};
    - the new rule pins no modelled group (customers, orders, delivered, refunded, paid, kept,
      paid+kept, repeat, single, extra orders, bookings) to {1, 2} in any output.
  - **Boundaries:** 0 and 3 shown; a published 2; derived-only groups (paid+kept = 2, singles =
    1, orders beyond the second = 1, bookings without orders = 1); bookings 1; and zeros inside
    a withheld summary are withheld too.
- `server/test/evidence-preview.test.ts` adds 1 test: the preview's customers-only team, pending
  then granted. The small shape is withheld identically in room and export, the large shape is
  exact, and no rows gives zeros. A financials-only team gets no customers section.
- **Mutants**, each run alone with a time ceiling:
  - dropping paid+kept from the rule: killed;
  - dropping single-order customers: killed;
  - showing the orders total when it isn't itself small (003u1 style): killed, 3 tests;
  - zeros shown inside a withheld summary: at first it **survived**. It pins no group to 1 or 2,
    so the oracle rightly doesn't flag it, but it breaks the all-or-nothing rule. A boundary
    case was added, and it is now killed.
  - dropping "orders beyond the first": **equivalent** (if it is 1 or 2, repeat customers must
    be 1 or 2, which already withholds). The line is kept as documentation.
- `npm run check`: lint and types clean, **1037 tests / 103 files passed**.
- `npm run web:build`: passed (820.62 kB bundle; same size advisory as before).

## Preview for Astra (fictional, in memory; not started or left running by me)

`npx tsx scripts/preview-evidence.ts` (8824/8825):
- A new team, Marsh Partners (act as Cole Marsh (buyer)), has a pending customers-only request.
- Ava grants it at `/desk/<business>/sale`. Then open the printed room URL.
- `POST :8825/legacy-payments/small|large|none` replaces the fictional stored payment rows.
  It starts as small: Astra's 4 orders, 3 delivered, 1 refunded.
- Then download the export and compare.
- Fenn and Ruiz are unchanged.

## Proof versus pending

- **Proven here:** the rule and the shared room/export projection, on fictional stored rows,
  through the real routes; the bounded oracle; and the existing fences (full suite).
- **Pending Astra's browser review:** the room's customers tab at 1440 and 390, including the
  withheld notice, the limits disclosure and the export download.
- **Not covered:**
  - live chain payments or a connected booking service (none configured; the wording no longer
    claims either);
  - modelled groups beyond those listed. Per-customer order distributions such as "customers
    with exactly 2 orders" aren't separately guarded, beyond the "orders beyond the second"
    difference. In the oracle's bounded worlds, its 3-order cap would make such checks report
    false pins.
  - inference across scopes: the financials scope can still imply counts; documented and told
    to the buyer, not removed.
- **Scope:** 001h, 001i, 001j and 004b were not started. All six milestones remain open. No
  provider, RPC, wallet, signing, deploy, push or spending. Searches used tracked-file `git grep`
  on named paths; the dispatch denies shell `grep`, and it was not used for searching.
