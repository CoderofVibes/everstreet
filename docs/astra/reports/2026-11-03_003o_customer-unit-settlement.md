# 003o report: customer unit settlement and release

Claude, 2026-11-03. Job: [003o](../jobs/2026-11-03_003o_customer-unit-settlement.md).
Commit `1a3b1e6`. Design: `docs/design/CUSTOMER_USE_RUNTIME.md` §14. After 003n1 (`ed43afa`).

## Two kinds of evidence, kept apart

1. **The contract.** `customer_settlement_matches_server_fixture`, a new Rust unit test, runs the
   actual methods. It writes `server/test/fixtures/v3/customer-settlement.json`.
   - A one-unit hold settled with close: `["charged"]`, closed with
     `root([(0, fp)])`. The same use again is `E_HOLD_CLOSED`.
   - Settled without close: the replay is `["already"]`; release then closes it, still one charge.
   - Unused and released by the operator: the empty-list root, and the unit returned.
   - Another fingerprint first: ours is `E_CONFLICT`. Once closed, the root isn't ours.
   - Past `settle_until`: `E_EXPIRED`; anyone releases, and the unit returns.
   - Seventeen more uses give **100/20/80**. An actual sale with the platform's METERING grant
     keeps 80. The former owner gets `E_NOT_OPERATOR`, and the successor charges use 21 (21/79).

   `customer-settlement-fixture.test.ts` checks `decideSettlement` against that JSON. Two
   `check_use` answers the fixture doesn't record are derived and labelled.
2. **The app.** `customer-settlement.test.ts` runs through the real app against the
   **TypeScript test double**, which models `settle_hold`, `release_hold` and `check_use` from
   `lib.rs`. **It does not execute the contract.** Its traces are evidence about the app only.

## What exists

- **The record.** `customer_settlements`: one per reserved request, kind `charge` or `release`,
  with its own state, frozen eligibility, a lease, bounded submissions and evidence. It is
  separate from the invocation's provider cost, which is not counted again.
- **The intent:**
  - a charge only for a settlement-eligible execution (§13.7: validated and durably delivered);
  - a release for ineligible finished executions, for explicit abandonment
    (`POST /api/customer/uses/:id/release`), and once an unexecuted request's serving time
    passed;
  - nothing while running or still runnable;
  - once an intent exists, execute refuses (`unit_settling`), and a delivered use can't be
    released.
- **The step:**
  1. a lease CAS, then the binding and conflict checks;
  2. one fenced pinned read of control, entitlement and `check_use`;
  3. `decideSettlement`: the two views must agree; one-unit scope; closed holds decided only by
     the recomputed root;
  4. apply;
  5. if an action is still due, submit it once. That needs the platform's current METERING (or,
     for a release, a block past `settle_until`) and a fresh block. The intent is persisted
     before the await; the writer's answer is an event only.
- **Outcomes:**
  - `charged`, `returned`, a sticky `conflict`, or `unresolved` (root mismatch, history lost,
    registration changed);
  - charged but open: closed by release;
  - a charge past its deadline becomes a release, never a charge.
- **The allocation.** It is freed only when the hold is closed or the sequence moved on. A decided
  request no longer counts as open (found by the 20-use test: it hit the 20-open limit before the
  fix).
- **Routes:** `POST /api/customer/uses/:id/units/reconcile` and `POST .../release`; the status
  gains a `units` view (state, source block, the contract's `free`/`consumed`, retryability). A
  `settleDue(limit ≤ 25)` method serves a later worker. The writer gains `settleHold` and
  `releaseHold`, injected only.

## Tests and checks

**Contract and decision tests.** The Rust settlement fixture test, plus 6 decision tests over its
JSON.

**API tests (14):**

| Area | Covered |
|---|---|
| The full path | Reserve, execute once, settle once (`settleCalls` 1, double charged 1), then charged from a closed-root readback. The allocation is freed and the next request takes `hold_seq` 2. The result is still the customer's. A duplicate reconcile sends nothing. No signature, salt or text appears. |
| Ineligible outcomes | Unknown, refused, undeliverable and cancelled executions each give `returned`: zero settles, one release, nothing charged |
| Unexecuted | An abandoned request gives `returned`, then execute is refused. It isn't decidable while it can run, and is released once it can't. |
| Delivered | It can't be released |
| Lost answers | A lost settle reply after applying, and a dropped one, are each charged exactly once |
| Deadlines | Past `settle_until`: a release, nothing charged |
| Conflicts | Another fingerprint: conflict, no submission, allocation held |
| Unknowns | A synthetic root mismatch, and history moved on: unknown, no submission, the next request explicit |
| Revocation | A key revoked after signing: still charged (`c04`) |
| Authority | Lost authority (the after-sale contract fixture): nothing sent, retryable; a regrant gives charged |
| Binding | A writer on another network: `binding_mismatch`, not called |
| Concurrency | Competing workers submit once. A stale lease: B charges, and A's late answer is discarded. |
| Restart | A lost reply, then a file-backed restart: the same charge recovered |
| The flagship | **20 delivered uses:** exact provider ledgers, 20 charged, the double's entitlement 100/20/80. A **sale through the existing v3 intent reconciliation** (contract fixtures `direct-accepting` → `direct-closed`). The customer keeps every result, and both owners get 404. The platform fails closed until regranted, then the successor serves use 21 (21/79). |

**Mutants**, one at a time, each restored with an empty diff:

| Mutant | Caught by |
|---|---|
| Closed-root check | The fixture and API tests |
| The authority gate | The authority test |
| The eligibility gate | The ineligible-outcomes test |
| The unit lease CAS | The stale-lease test |
| The settle-deadline switch | The deadline test |

```
WSL cargo test -p business-v3 --lib            → 71 passed (1 new)
WSL cargo clippy -p business-v3 --all-targets  → 0 warnings
npm run check        Test Files 50 passed (50); Tests 654 passed (654)
npm run web:build    built
```

## Limits

- **Sticky conflicts** (evidence or slot) have no defined recovery yet, so they keep the
  allocation.
- **Not covered by an API test:**
  - an account or registration change during settlement (only the pure decision test covers
    registration);
  - `attempts_exhausted`.
- **One request at a time** per customer and plan, by design of the one-unit policy.
- **Not wired:** live signing for `settle_hold`/`release_hold`, a live reader, wallet sign-in and
  the customer UI. No worker starts.

## Session outcome

003n1 and 003o are both in review.

| Commit | What |
|---|---|
| `a3d90cf` | Astra docs |
| `ed43afa` | 003n1 |
| `f791445` | 003n1 report |
| `1a3b1e6` | 003o |

No push, live call, signing, deployment, spending or research access. No milestone is claimed.
Stopping for Astra's review before the customer UI and live wiring.
