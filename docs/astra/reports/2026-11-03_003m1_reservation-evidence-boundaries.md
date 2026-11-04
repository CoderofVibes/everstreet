# 003m1 report: reservation evidence boundaries

Claude, 2026-11-03. Job: [003m1](../jobs/2026-11-03_003m1_reservation-evidence-boundaries.md).
Commit `208c64b`. Astra docs committed first as `6583bbe` (`npm run check` 594/594).

## Reproduced first

The three setups from the job, as permanent tests in `server/test/customer-evidence.test.ts`.
All three failed before any change:

| # | Setup | Before | After |
|---|---|---|---|
| 1 | Readback at 999 (labelled pre-key history) below the prepared block 1000; the writer opened one hold | `refused: key_changed`, allocation freed | Stale: `reserve_unknown`, allocation held; the next honest read gives `reserved`, still one hold |
| 2 | Evidence at 1000; a reread at 1000 with hash `C×32` and key 0 revoked | `refused: key_changed` | Sticky `evidence_conflict` (`equal_height_hash_differs`): no release, resend or fresh hold, and it stays so after a later honest block |
| 3 | Hold opened, readback lost; read again after `serve_until + 1` | `reserved, serving: true` | `reserved, serving: false` (`serve_window_passed`), `ready_now: false` |

## Corrections

All in `server/src/customerRead.ts` and `server/src/customerUse.ts`, plus two columns in
`db.ts`, migrated for databases created at 003m.

- **The baseline.** Preparation stores an evidence mark: height, hash, timestamp, the sha256 of
  the decoded entitlement, and a summary of what may only rise (registration, then hold sequence
  and key epochs).
- **The fence (`evidenceProblem`):**
  - a lower block is stale;
  - an equal block must be identical (hash, time, content);
  - a higher block needs a later time (A1) and no regression.
- **Conflicts are sticky.** A conflict, or decision row 5, stays `reserve_unknown` /
  `evidence_conflict`. Nothing is read, resent, decided or freed for it, and the worker pass
  skips it. Recovery is a defined later reviewed step, never silent.
- **Rows without a mark.** A 003m row is fenced from its prepared block.
- **Row 6** refuses only when the chain's key epoch is **higher** than ours. A lower epoch is a
  regression.
- **Serving is historical.** It holds only for the key at our epoch **and** `T_B < serve_until`.
  Status always gives `ready_now: false`.
- **Bindings.** A writer or reader on another network, or a writer whose signer isn't the
  operator, gets `binding_mismatch` at prepare and confirm, and is never called by a step.
- **Rechecks.** After the await, prepare's transaction rechecks the account mapping and binding.
  Confirm rechecks the account mapping (`account_changed`), the offer, the active release and the
  binding, atomically with its transition.
- **Authority.** `meters` is split in two:
  - `contractMeters`: owner or current-generation operator, as `c01` proves;
  - `platformMeters`: the narrower admission policy, a granted operator only. It is tested with
    an owner account that has no grant, which is refused.
- **Design.** `CUSTOMER_USE_RUNTIME.md`:
  - a new §5.4;
  - row 2/6 and state-table corrections;
  - the policy row;
  - the interruption rows;
  - corrected authorization wording: the code is already authorized, and only live acts stay
    prohibited.

## Tests and checks

- **New tests (11):**
  - the three reproductions;
  - same hash with a changed view or time;
  - an identical reread is not a conflict;
  - key-epoch, hold-sequence, registration and block-time regressions, each with its exact
    reason;
  - network mismatch at confirm, prepare and step;
  - the platform policy versus contract authority;
  - the account and offer rechecks at confirm;
  - the exact `serve_until` boundary (`−1 ms` serving, `=` not);
  - a file-backed restart, with a 003m row without a mark.
- **Corrected 003m assertion.** One decision-table assertion expected `refused` for a chain epoch
  below ours, which was the bug. It now asserts row 6 for a higher epoch and `inconsistent` for a
  lower one.
- **Test double.** The chain double now advances block time with every block (A1).
- **Mutants**, one at a time, each restored with an empty diff against the staged copy:

  | Mutant | Caught by |
  |---|---|
  | Lower block accepted | Reproduction 1, restart, lagging |
  | Equal-height hash unchecked | First caught only by the restart test; I then pinned exact reasons, and reproduction 2 catches it too |
  | Serve window ignored | Reproduction 3, boundary |
  | Step adapter check removed | The network test |

```
npm run check        Test Files 46 passed (46); Tests 605 passed (605); lint and types clean
npm run web:build    built (existing chunk-size advisory only)
```

No contract, test or fixture changes, so no Rust run.

**Limits.**
- A conflicted request keeps its allocation. That customer can't prepare another use on that
  plan until a later reviewed recovery step exists.
- A1 is still unverified for a live adapter. A violation now fails closed.
