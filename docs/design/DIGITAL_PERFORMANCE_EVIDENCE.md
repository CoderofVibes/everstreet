# Digital performance evidence for an acquirer (job 003u)

Claude, 2026-11-04. Authority: [003u](../astra/jobs/2026-11-04_003u_scoped-digital-performance.md).
Written before the code.

## The new scope

**A new, dedicated category: `digital_performance`.** Its text:

> Digital service performance in aggregate: customer uses by month and outcome, usable results,
> work still open, and the runtime cost of serving customers apart from the founder's own tests
> (no customer names, documents or results)

**Scope wording version 4.** It adds this category and changes nothing about the others.
- `financials`, `costs`, `customers` and `operations` keep their exact wording and coverage.
- Nothing is migrated.
- An existing grant, a pending request, or a request made under wording 1–3 can't contain the
  new key.
- The room serves the section only when the grant includes `digital_performance` **and** its
  `scope_version >= 4`. A tampered or hypothetical older row shows nothing.

**Explicit both ways:**
- **Request:** the buyer must tick it. The request form's default stays financials and
  operations.
- **Grant:** the seller grants only what was asked, so it can't be added at decision time.
- **Narrowing:** granting it is the owner's deliberate choice; narrowing can remove it.

## One aggregation, one allowlist

`performanceEvidence(db, businessId, asOf)` (`server/src/performanceEvidence.ts`):
- **Source:** it calls 003t/003t1's `customerOperations` once, for a fixed 12 UTC-month window,
  as of one instant. It never counts anything itself.
- **Allowlist:** it builds a fresh object field by field. It never passes `CustomerOperations`
  through. There are no project ids, offer ids, links, worker health, holder ids, customer ids,
  documents, results or protection references.

**What it contains:**
- `as_of`, the period (from, to, months, UTC buckets) and `state` (not_started / recorded).
- Usage by request cohort (UTC month requested, outcome as of now):
  - the period total;
  - the period split into charged, returned, awaiting settlement, needs attention, reserved and
    not settled, and never reserved;
  - a monthly series of requested totals.
- Execution: ran, usable result, not usable, and other (undecided plus unknown).
- Current open work (all time up to `as_of`): needs attention, awaiting settlement, reserved
  and not settled, awaiting reservation. Customers' unsigned preparations are not business
  evidence and are left out.
- Runtime cost (UTC month of each call):
  - **serving customers:** exact microcents text, calls, unknown-cost calls and their held
    cents, per month and for the period;
  - **founder trials and checks:** the same fields, never suppressed (the founder's own
    activity).
- Basis texts, the suppression rule and the limits.

**No money value** comes from uses. These figures are not revenue, cash, profit, a valuation,
testnet verification or proof of real provider execution.

## Withholding (corrected in 003u1)

**Why the 003u rule was replaced.** Astra's two probes showed it was wrong.
- **A false label.** A secondary-suppressed 10 was labelled "fewer than 3".
- **Exact recovery.** The deterministic suppression pattern, the published total and the zeros
  together identified small cells exactly. For `[1,1]/2`, only one input of the 256 pairs 0..15
  matched.

**The rule now: decided for the whole projection** (`disclose()` in `performanceEvidence.ts`).
1. **The gate.** It collects every count that would be published: requested, the usage split,
   monthly requests, ran, the execution split, current groups and total, monthly and total
   customer calls, and unknown-cost calls. It adds every published difference that is itself a
   group of uses: requested but never run, calls without a run, and open work outside the window.
2. **Nothing is 1 or 2:** everything is published exactly. Zeros are recorded facts.
3. **Anything is 1 or 2:** every breakdown is **withheld**. That covers the usage split, monthly
   series, execution, current work, customer calls and customer cost, per month and in total,
   plus unknown-cost calls. Only the requested total remains, and it too is withheld if it is 1
   or 2. Customer calls are withheld too: showing them only sometimes would itself say which
   difference was small.
4. **No size claim.** `"withheld"` claims no size, in the data, the text, the ARIA labels and the
   table alike. The room says "Withheld". `withheld: true` says breakdowns were withheld. Charts
   of withheld series are not drawn.
5. **Founder trials and checks** are the seller's own activity and are always exact.

**Tested against complete outputs** (`server/test/performance-disclosure.test.ts`):
- **Astra's two probes.**
- **Every pair** (a, b) in 0..15: each withheld output is shared by more than one first cell.
- **A family of about 1,700 whole-business shapes:** charged, returned, reserved and never
  reserved, split across months in every way. For every distinct public output, no quantity of
  1 or 2 (any count, the never-run group, either month) is the only value consistent with it.
- **Generator fixes:** while writing it, the generator had to allow every month split. A fixed
  split made the test itself "know" the answer.

**Limits (in the room):**
- This lowers the risk of singling out a customer. It is not a guarantee of anonymity.
- Reading again later shows how figures moved.
- The fact that breakdowns are withheld says some group is small.

**Migration.** There is nothing to migrate: the projection is computed on each read. The marker
changed from `"fewer_than_3"` to `"withheld"` (API, room and export).

## Suppression as first built in 003u (superseded)

A count of 1 or 2 shows as **"Fewer than 3"** (`"fewer_than_3"` in the data). Zero is shown: it is
a recorded fact and singles nobody out.

**Partitions.** Every published group of counts that adds up to a published total is protected
as a whole:
- the usage split, against requested;
- the monthly requested series, against requested;
- the execution split, against ran;
- the current-work groups, against their total;
- monthly customer calls, against period customer calls.

**The rule for each partition:**
1. **Primary:** suppress any cell of 1–2.
2. **Secondary:** if exactly one cell is suppressed, also suppress the smallest other non-zero
   cell. If there is none, suppress the total. No single small value can be recovered by
   subtraction.
3. **Total:** a total of 1–2 is suppressed, together with every non-zero cell.

**Costs follow their calls.** A month whose customer calls are suppressed has its customer cost
suppressed. The period's customer cost is suppressed when the period's customer calls are, and
so are the unknown-cost held cents when their count is.

**Coarsening.** The monthly table gives requested totals only, not the outcome split per month.
That avoids a two-way table whose margins could be differenced. The owner's own books keep the
full split.

**One fixed window.** There are no period choices, which removes differencing between windows.

**Known residual limits (stated in the room):**
- Reading again later shows how figures moved in between (time differencing).
- Execution and usage are separate partitions, so close relationships (charged ≈ usable) give
  rough bounds.
- Combined costs of two or more suppressed months can be inferred.

## Access fence

- **The gate:** the section is read inside the existing `withGrant`, which checks membership,
  role, grant status, expiry, version and owner before and after the reads and returns nothing
  if anything changed.
- **Shared allowlist:** room and export share `scopeRoom`, so the export is the same allowlist.
- **Audit:** room-open logging and limits are unchanged. Nothing private is logged.
- **Sales:** a reconciled sale already revokes grants and withdraws pending requests (003k1).
- **Browser:** the room's existing evidence view is per actor, per room and per load. A refused
  reload clears everything; "unchecked" offers Check again.

## Room

A **Digital performance** tab holds:
- the as-of time and window;
- tiles;
- a monthly uses chart, with "Fewer than 3" drawn as a hatched marker, never as a value;
- a monthly cost chart: serving customers next to founder tests;
- an accessible table;
- basis, suppression and limits.

It distinguishes three cases:
- **not in this grant:** the tab is disabled and says so, and the team can ask in a new request;
- **granted with nothing recorded:** "No customer uses or runtime calls recorded";
- **recorded zeros.**

There are no links to the owner's pages and no actions.
