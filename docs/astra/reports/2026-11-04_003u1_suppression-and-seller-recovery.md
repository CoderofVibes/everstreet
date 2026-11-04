# 003u1 report: truthful withholding and seller access recovery

Claude, 2026-11-04. Job: [003u1](../jobs/2026-11-04_003u1_suppression-and-seller-recovery.md).
Commit `44f87b9`, on top of `7425208` (Astra's six docs). Not pushed. No contract, `main.ts`,
package or remote change. The design is updated in
[DIGITAL_PERFORMANCE_EVIDENCE.md](../../design/DIGITAL_PERFORMANCE_EVIDENCE.md), "Withholding
(corrected in 003u1)", with the 003u rule kept as superseded.

## Reproduced first

`server/test/performance-disclosure.test.ts`, against the 003u code:
- **Probe 1:** `suppressPartition([1,10],11)` labelled the 10 `fewer_than_3`. It failed.
- **Probe 2:** for the complete output of `[1,1]/2`, the possible first cells among all 256
  pairs 0..15 were {1} only. It failed.

## The rule now

One gate over the **complete** projection (`disclose()`, pure).

**Counts it checks:**
- requested and the usage split;
- monthly requests;
- ran and the execution split;
- current groups and their total;
- customer calls, per month and in total;
- unknown-cost calls.

**Published differences it checks** (each is itself a group of uses):
- requested but never run;
- calls without a run;
- open work outside the window.

**No count or difference is 1 or 2:** everything is shown exactly.

**Otherwise every breakdown is withheld:**
- the split, months, execution and current work;
- customer calls and cost, per month and in total;
- unknown-cost calls.

Only the requested total stays, withheld too if it is itself 1 or 2. Customer calls are withheld
in this case as well: showing them only sometimes would say which difference was small.

**How withheld figures are shown:**
- **No size claim:** `"withheld"` claims no size anywhere, in the API, export, text, ARIA and
  table. `withheld: true` is stated.
- **Not drawn:** withheld series aren't charted. The cost chart shows only the founder's trials
  and checks, which are always exact.
- **Limits stated in the room:** this is not a guarantee of anonymity; rereading shows change;
  and withholding itself says some group is small.

## Tested against complete public outputs

- **Both probes**, plus explicit cases: `[1,10]` gives two withheld cells with the total 11 shown;
  `[1,1,0]/2` withholds everything.
- **All pairs (a, b) in 0..15:** each withheld output is shared by more than one value of a.
- **About 1,700 whole-business shapes:** charged 0–5, returned 0–4, reserved 0–3, never reserved
  0–3, with the charged uses split across two months **in every possible way**. For each distinct
  public output, no quantity of 1 or 2 is the only value consistent with it. The quantities
  checked are each count, the never-run group and each month.
- **Generator corrections, stated openly:**
  - The first version split months one fixed way, which let the test itself "know" the month.
    It now allows every split.
  - A rule that showed customer calls when safe was then caught by the test and replaced by the
    conservative one above.
- **Projection over real records** (`performance-evidence.test.ts`):
  - 4 charged and 3 returned: everything is exact and matches the owner's books;
  - 4/1/1: everything is withheld except the total of 6;
  - 1/1/1: only the total of 3 shows.

  Room/export parity, old-grant exclusion and the fences are unchanged and still pass.

## Seller page

Astra's finding: signed out, the sale page said "Sign in first". Choosing Ava changed the header,
but the error stayed until a reload. The fix:
- **Fresh page per person:** the route is keyed by actor and business (like the desk), so
  choosing a person starts a fresh page.
- **Signed out:** the page asks to sign in and reads nothing.
- **Signed in:** a sequenced loader (`web/src/latestLoad.ts`) reads the listing:
  - success clears any error;
  - a newer load wins;
  - access loss (401/403/404) drops the data;
  - any other failure keeps the last confirmed listing, says so, and offers Check again;
  - a closed loader (after a switch) ignores answers.

  It recognises both `ApiError` classes (`api.ts` and `api5.ts` have their own).
- **Unsaved listing edits** survive reloads, for example after deciding a request. A save
  replaces them. Grant choices were already per request card.
- **Tests:** `web/test/latestLoad.test.ts` (5) covers success clearing a "Sign in first", late
  answers, access loss versus retry, a closed loader, and the `api5` error class.

## Scope names

`web/src/scopes.ts` gives short names: Financials, Costs, Customer activity, Operations and what
transfers, Digital performance.
- They are used in the buyer's request list and the room banner. The seller's decision form
  keeps the full wording from the server.
- An unknown key shows as itself.
- A test checks every server category has a name.
- No scope's meaning changed.

## Checks

- `npm run check`: **874 tests in 87 files**, lint and types clean (861/84 before).
- `npm run web:build`: passes (780.20 kB, the existing size advisory).
- **Mutants**, one at a time and each restored. All 5 were killed:
  1. months published while withheld;
  2. the call total published while withheld. The first attempt overlapped with an unrestored
     M1 and was discarded; rerun alone, it was killed;
  3. per-cell withholding;
  4. success not clearing the error;
  5. "Fewer than 3" wording.

## Limits

- **Browser:** the seller page and room were not checked in a browser. Astra's pending Fenn/Ruiz
  grant and revoke browser step was not performed or substituted.
- **The evidence preview's activity** (1 returned, 1 awaiting settlement, 1 reserved, 2 never
  reserved) is small, so its digital performance tab now shows the withheld state. The fully
  shown state is covered by tests, not the preview.
- **The older `customers` scope** still uses its own per-cell "Fewer than 3" for payments and
  bookings. It was left unchanged so no old scope changes silently. Worth reviewing against the
  same complete-output standard.
- **All six milestones stay open.**
