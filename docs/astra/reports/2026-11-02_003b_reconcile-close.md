# Job 003b report: a sale reconciles once, including a lost response

Claude, 2026-11-02. Job: [003b](../jobs/2026-11-02_003b_reconcile-close.md). Includes the fixes
for Astra's [early review](2026-11-02_003b-early-review.md).

## Evidence kind

**Unit evidence only.** Every result below comes from `npm run check` against the real
`everstreetApi`, an in-memory SQLite database, OpenSeat with test authority and the in-memory
`FakeChain` (extended as `GatedChain` in `server/test/deal-world.ts`). Timing is forced with
gates and read-failure counters, never real delays. **No testnet evidence**: no transaction,
signing, deployment, network call or reconciliation against Tony's database. The v2 contract
is unchanged; gate-1 evidence is unchanged.

## What the person sees

- **Lost response, sale closed:** Everstreet reads the contract and shows the sale closed. It
  is never reported as failed.
- **Lost response, contract unreadable:** "Waiting to confirm your acceptance. Your acceptance
  was sent but its result couldn't be confirmed yet. Nothing else is needed from you; check
  again shortly. Don't fund again." with **Check again**. This comes from a recorded step, so
  it survives a reload while the contract stays unreadable. Only the person who sent it sees
  it. The page offers no Fund, Accept, Cancel or Change-terms actions while it is shown. (Fund
  and Accept already needed a readable contract.)
- **Lost before it arrived:** "The contract shows your acceptance wasn't recorded, so nothing
  changed. You can accept again." (409)
- **Contract closed, Everstreet behind** (for example, a lagging read of control): "The contract
  shows a close Everstreet hasn't followed yet" with **Check again**.
- **Close that can't be applied:** "Needs reconciling" with the reason. It is recorded once per
  distinct reason and never applied automatically.
- **Retry or second tab:** checks the contract first. If the sale already closed, Everstreet
  follows it; if this acceptance is already recorded, nothing is sent again.
- **Step labels:** "Acceptance sent; no answer yet" (submitted), "Seller/Buyer accepted"
  ("Confirmed by reading the contract" when recovered), "Sale closed on NEAR" (reconciled) and
  "Needs reconciling" are separate steps.
- **Duplicate history in old data:** a notice that the records were kept as they are, not
  repaired.

## Underneath (`server/src/deals.ts`, `server/src/db.ts`)

`reconcile(deal, closeTx)` follows a close only when all of these hold:
- the contract shows *this* deal closed;
- the recorded version row's digest equals the chain digest, and the chain version equals the
  local version;
- the buyer and seller accounts match;
- control is at exactly `expected_generation + 1`, with the buyer as owner.

A lower generation is **pending** (a lagging read). A higher generation, or a different owner,
means **needed** ("Control changed again on the contract after this sale"). Owner equality alone
is never enough, so an old deal cannot regain authority when the same buyer owns the business
again later.

The decision is made inside `BEGIN IMMEDIATE`: a compare-and-set
`UPDATE deals … WHERE id = ? AND status <> 'closed'` runs first, and a caller that changes no
row rolls back and reports **already**. A monotonic check follows: the local owner must still be
the seller, and no ownership entry at or above the target generation may exist. Otherwise
Everstreet rolls back with "already records a newer owner". All the writes commit together:

- owner, ownership entry (generation = target), team revocation, listing close;
- access requests, value settings, other open deals, booking-service transfer item;
- `business.sold` event, `closed` step.

Any failure rolls all of them back. `accept` no longer writes a `closed` step itself.

`accept` after an exception records `accept_unconfirmed`, tries `reconcile`, then reads the deal
back. If the contract still can't be read, it returns the normal view, which **derives**
`confirmation` from the recorded step and its own final read. So a close that the final view
observes and reconciles is reported as closed, not uncertain (Astra's early-review finding).
Funds are never sent again automatically.

`reconcileOpen(limit)` is a bounded, read-only, keyless pass (1–50) over open deals with
acceptance steps. It is round-robin with a cursor that wraps around, so deals that stay pending
or unresolved can't starve the next one. The cursor is in memory; the durable state is the deal
steps. **No background worker is wired**; nothing calls it yet outside tests.

Migration: `openDb` installs `UNIQUE INDEX ownership_once_per_deal ON ownership(deal_id) WHERE
deal_id IS NOT NULL` only when `ownershipConflicts(db)` is empty. Existing duplicates are never
deleted; they are reported (`ownershipConflicts`, plus `history_conflict` on the deal view) and
the index is skipped.

## Tests (`server/test/reconcile-close.test.ts`, 17; converted gaps in `characterize-close.test.ts`)

| Done-when item | Test |
|---|---|
| 003a gap: lost response refused on retry | `characterize-close`: confirmed from contract, retry sends nothing |
| 003a gap: duplicate settlement from concurrent views | `characterize-close`: two gated reads settle once |
| concurrent acceptance and view | acceptance held at its control read while a view reaches the same point: one transition, no "needs reconciling" |
| duplicate reconciliation after restart | two fresh `Deals` instances race over one DB: `["already","applied"]`, then the original app applies nothing |
| loss before chain close | dropped request → 409 "wasn't recorded", deal open, accept again closes once |
| loss after chain close | unreadable → `confirmation: unknown`, deal open, 0 ownership; later view closes, `acceptSale` not called again, one `funded` step |
| unknown readback | Astra's exact timing (two failed deal reads, final view succeeds) → closed, `confirmation: null`; unknown survives a reload while unreadable, only for the sender, `chain: null` |
| confirmed close needing local reconciliation (distinct from unknown) | readable Closed + lagging control → `reconciliation: pending`, `confirmation: null`; recovers |
| wrong digest/version | chain version 7 → `needed` on each view, step recorded once, nothing applied |
| stale generation | lagging control → pending; newer local ownership entry → needed, nothing overwritten |
| later sale to the same buyer | chain generation 4, same buyer owner → needed, old deal not applied |
| rollback on mid-write failure | trigger aborts the `business.sold` insert → 500, deal open, owner and listing unchanged, 0 rows; after dropping it, applied once |
| repeat replay | 3 views + 2 accepts → 1 ownership, 1 event, 1 closed step |
| customer records unchanged | payments, bookings, inquiries counts identical |
| bounded reconciler | applies once, second pass empty, sends nothing; a permanently stuck deal doesn't starve the next (limit 1, three passes) |
| migration | clean DB gets the index; a DB with duplicates keeps both rows, no index, conflict reported |

Mutation check: with the `AND status <> 'closed'` guard removed, the restart-race test fails.
The generation check still blocked the duplicate write, but it reported a false "needs
reconciling". The guard was restored.

`deals.test.ts`: the old expectation (re-accepting after close → 409) now expects 200, closed,
generation 2, one `closed` step and one ownership entry.

## Checks

- `npm run check`: lint, typecheck, 18 files / 184 tests passed.
- `npm run web:build`: passed, 55 modules (chunk-size advisory only).

## Not done / limits

- It does not solve the offchain check/commit race (the OpenSeat characterization gap stays
  pinned), and it does not implement the managed freeze protocol. `docs/AUTHORITY.md` now
  separates the **atomic close** (contract) from **observed-finality reconciliation**
  (idempotent and monotonic, can lag, unit-proven only).
- There is no background reconciler process, and the reconcile cursor isn't durable.
- No browser check of the new Deal page notices; Astra's browser pass is needed.
- The Astra review and pass docs on disk (RecoveryReview, 003b-early-review, 003d candidates,
  002b2 job and panel reviews, INDEX, ACCEPTANCE, ContinuousDevelopment) are not committed by
  me in this job.
