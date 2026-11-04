# 003o1 report: release identity and delivery races

Claude, 2026-11-04. Job: [003o1](../jobs/2026-11-03_003o1_release-identity-and-delivery-races.md).
Commit `4d59127`. Astra docs committed first as `a232aae` (`npm run check`: 654 tests).
Design: `CUSTOMER_USE_RUNTIME.md` §14.5.

## The contract's registration ABA: reproduced, then guarded

**Reproduced (`c05`).** It uses only the actual methods, with no state edits:
1. Registration 1's hold 1 is closed by `release_hold`.
2. The customer calls `refund_units(10)`; the `on_payout` callback succeeds.
3. The customer calls `unregister`.
4. `sponsor_shell` creates registration 2.
5. A buy with the key installed, then `open_hold` for hold 1.

A delayed `release_hold(cara, 1, 1)` then closes **registration 2's** hold 1: `hold_active`
becomes false and free goes from 9 to 10.

**The correction** is additive and undeployed: `release_hold_for(customer, plan_id, reg_id,
hold_seq)`. Unit test `c06` shows:
- the old registration is refused (`E_REGISTRATION`) with the snapshot unchanged, and a missing
  entitlement is refused (`E_ARGS`);
- a stranger before `settle_until` gets `E_NOT_OPERATOR`, and the operator succeeds;
- a replay is `E_HOLD_CLOSED`;
- after the deadline, a stranger may release only for the named registration;
- `release_hold` itself is unchanged (compatibility).

A contract mutant that drops the check fails `c06`.

**What a deployment will need.** A new business-v3 account carrying this method (born-locked).
Nothing was deployed or signed.

**The app.** The writer interface has only `releaseHoldFor`, with the request's stored `reg_id`.
A writer without it can't release; there is no unguarded path. The TypeScript double mirrors the
contract method.

## Reproductions

Both are permanent tests in `server/test/customer-unit-races.test.ts`.

1. **The delayed release against a synthetically re-created registration.** It fails when the
   double's guarded release skips the registration check (which is `release_hold`'s behaviour):
   the new hold closes. With the guard it is refused (`E_REGISTRATION`); the new hold stays open
   and the unit reads `unknown: registration_changed`.
2. **A release while the result is being protected.** It failed before the fix (`release_pending`
   was frozen). Now the reconcile leaves it `reserved_awaiting_settlement`, a customer release gets
   `409 delivery_pending`, and `releaseCalls` stays 0. Afterwards it is charged.

## Delivery decision

- **The states.** `delivery` is set by CAS: undecided, then `protecting` (before the await), then
  `delivered` (only from `protecting`), or `not_delivered` (the protection failed, the run didn't
  complete, or recovery after `deliveryTimeoutMs`, default 5 min).
- **No intent while pending.** No unit intent is recorded while the decision is pending, and
  recovery persists `not_delivered` in the intent's own transaction.
- **Late completions.** One that arrives after the decision is final is discarded, and its copy is
  deleted through the seam.

## Other corrections

- **Unit-step writes.** All of them, error and conflict paths included, are now under the lease.
  The stale-worker conflict race was reachable: a mutant restoring the unfenced write fails the
  new test.
- **`check_use` agreement.** Its slot bit must agree with the bitmap, and a closed hold's charged
  count with its bitmap. These are synthetic contradictions over contract JSON in the fixture
  test.

## Evidence

**New API tests (10):**
- the two reproductions;
- a protection failing after its wait: not delivered, released;
- a restart while protecting: pending (worker, reconcile and release all refuse), then
  `not_delivered` after the timeout and returned; the late completion is discarded and its copy
  deleted; zero settles;
- a registration replaced during settlement: unknown, nothing submitted;
- an account mapping changed: it still settles the request's own account;
- `attempts_exhausted` after five dropped settles: no sixth call;
- lost and dropped release replies: returned exactly once;
- without authority, a release at exactly `settle_until` is refused, and at `+1 ms` submitted;
- a stale worker's conflicting read after a newer worker settled: no conflict recorded.

The 003n1 crash test now reads `pending` while protection waits (correct), instead of
`unavailable`.

**Mutants**, one at a time, each restored with an empty diff:

| Mutant | Caught by |
|---|---|
| Unfenced conflict write | The stale-worker test |
| Pending delivery ignored | Two tests |
| Late protection unfenced | The restart test |
| Slot-bit agreement | The fixture test |
| Contract guard removed | `c06` |

```
WSL cargo test -p business-v3 --lib            → 73 passed (2 new)
WSL cargo clippy -p business-v3 --all-targets  → 0 warnings
npm run check        Test Files 51 passed (51); Tests 664 passed (664)
npm run web:build    built
```

**Limits.**
- `release_hold_for` exists only in the undeployed source.
- The delivery timeout is a policy. A protection still running when it expires is discarded, and
  the customer's unit returns.
