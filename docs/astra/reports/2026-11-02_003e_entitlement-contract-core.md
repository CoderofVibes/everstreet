# 003e report: business-v3 entitlement, storage and payout core (keyless unit tests)

Claude, 2026-11-02. Job: [003e](../jobs/2026-11-02_003e_entitlement-contract-core.md). Scope: the
accepted subset of the 003d candidate (consolidated §2, recovery addendum §8). **Not in this
slice:** deals, close, freeze, closer, manifest pointer, gateway, journal, recovery, v2 migration.
Nothing was deployed, built for deployment, signed with real keys or sent to a chain.

## Commits

| Commit | What |
|---|---|
| `699ad4c` | Implementation note `docs/design/BUSINESS_V3_CORE.md`: routine choices, pinned APIs, invariants, what is not proved |
| `9cf500b` | New crate `contracts/business-v3` (Cargo.toml, `src/lib.rs`), workspace member line, Cargo.lock |
| `bc9c653` | `src/tests.rs`: 26 keyless unit tests |
| this commit | This report and the JOBS row |

`9cf500b` builds on its own. Its `cargo test` needs `bc9c653`, because `lib.rs` declares the
test module.

**Not changed:** `contracts/business`, `contracts/business-v2`, `scripts/`, `config/`, `server/`,
`web/`. **Cargo.lock** gains only the new crate's entry plus feature edges on `ed25519` and
`ed25519-dalek`, which were already locked (`pkcs8`, `serde`, `zeroize`). There are no new
packages and no version changes.

## Pinned SDK

`near-sdk = "=5.29.1"`, the same pin as v2. Every API the design needs was checked in the local
registry source and then compiled:

- `env::ed25519_verify(&[u8; 64], impl AsRef<[u8]>, &[u8; 32])`
- `env::sha256_array`, `env::storage_usage`, `env::storage_byte_cost`, `env::state_write`
- `store::LookupMap::flush`, `Promise::detach`
- `near_sdk::is_promise_success`
- the five-argument `testing_env!` with promise results

The test-only dev-dependency is `ed25519-dalek = "=2.2.0"`, already in the lock. Its keys come
from fixed seeds (`[seed; 32]`), so every signature is synthetic.

## Commands and results (WSL Ubuntu)

```
wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Dev/Everstreet/contracts && CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --lib'
  test result: ok. 26 passed; 0 failed
wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Dev/Everstreet/contracts && CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v2 --lib'
  test result: ok. 27 passed; 0 failed        (v2 unchanged)
wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Dev/Everstreet/contracts && CARGO_TARGET_DIR=$HOME/everstreet-target cargo clippy -p business-v3 --all-targets'
  0 warnings
npm run check (repo root)
  Test Files 30 passed, Tests 343 passed
```

**Mutation checks.** Each mutant was applied, run, then reverted:

| Mutant | Result |
|---|---|
| The callback ignores `payout_id` | s05b fails (stale callback for a reused slot) |
| A failed payout credits `available` instead of the beneficiary's claim | 5 tests fail (s05b, s07, s08b, withdrawals, random) |
| `reg_id` dropped from the signed hold message | s10 fails (re-registration) |

## What every test call checks

The `W::call` helper runs after each successful call:

- **S0:** storage delta ≤ 0, measured in the unit VM by flushing every collection and writing the root before and after.
- **S1:** delta = 0 for `ft_on_transfer` and `on_payout`, including the returned-purchase paths.
- **I1:** `held = ent_free_value + ent_held_value + available + pending_total + claims_total`.
- **U1, U2**, for every entitlement.
- **P1**, for entitlements and party records.
- **P4**.
- Per-record sums equal the buckets.
- Free slots are fully cleared.
- Each period sits at its ring index.

W1 calls (`sponsor_shell`, `create_plan`, `appoint_operator`) instead assert that the amount
charged equals the measured growth × byte cost.

`W::refuse` asserts the error code, and that a snapshot of all state (records, slots, ring, root
counters) is identical after the panic. `catch_unwind` here only shows that the method validated
before it mutated; it is not a model of receipt rollback.

U3–U5, P2, P3 and P5 are covered by the named scenarios below, not by an after-every-call
assertion:

- **U3, U4:** the E_SIG cases, plus E_HOLD_CLOSED and E_EXPIRED.
- **U5:** E_EXPIRED, E_TTL and the daily caps.
- **P2:** E_PENDING_REFS and E_CLAIM on deletion.
- **P3:** S1 on every callback.
- **P5:** injected successor records, and E_OWNER.

## Scenarios (addendum §8, P = 50,000, plan max hold 10)

| # | Test | Result |
|---|---|---|
| 1 | `s01` | A self-paid shell; buy 100 with key slot 0; two holds of 10 fully used and closed. Ends at `free 80, consumed 20, purchased 100, available 20P, ent_free_value 80P, held 100P`, `last_hold {2, 0x3FF, 10}`, November books 100P in and 20P earned. |
| 2 | `s02` | The same use returns `already`, alone, mixed into a batch, and as a whole duplicate batch; `charged` is unchanged. Settling h1 after it closed gives E_HOLD_CLOSED. The final state is as in 1. |
| 3 | `s03` | An altered slot 3 alongside a valid new slot 5 gives `E_CONFLICT(3)` and nothing is charged. Two different uses for one new slot in one batch gives `E_CONFLICT(6)`. |
| 4 | `s04`, `s04b` | Every one of these is refused with E_SIG: a use signed for h1 submitted into h3; a moved slot; a foreign key; another customer's use; an empty or zero signature; a HoldAuth whose units were altered. Also refused: wrong key slot, epoch or sequence; a used sequence; 0 or 11 units; under 60 s left (E_EXPIRED); over the TTL (E_TTL); a non-operator; while paused. The identical HoldAuth gives `already`. The daily cap holds across releases and resets the next UTC day. `skip_hold_seq` burns a signed HoldAuth. A revoked key stops serving immediately, its already-signed use still settles before the deadline, and reinstalling moves the epoch to 3, so old-epoch signatures stay dead. Reinstalling does not reset the daily cap. |
| 5 | `s05`, `s05b`, `s05c` | With h3 open, refunds of 81, 71 or 0 give E_UNITS. Refund 70 then succeeds: `refunded 70, free 0, held 30P`, and a repeated callback is a no-op. On failure: `claim 70P`, `available` and `withdrawable` are unchanged, and `claim_customer` reuses slot 0 with payout id 2. A stale id-1 callback is ignored, and the id-2 success clears the claim. **Missing callback:** after 40 days the payout is still `in_flight` in `get_pending` with the same id, amount and start time; `pending_total` is unchanged; there is no retry, and the record can't be deleted. |
| 6 | `s06` | **Injected** owner change (`test_set_owner(buyer, 2, [meter2: METERING])`) mid-hold. The old operator is refused, including with a gen-1 grant re-added by hand. `meter2` settles 4 and closes: `consumed 24, free 76`. The founder gets E_NOT_OWNER for withdraw, appoint and plan. The buyer is held to the reserve and withdraws 19P. |
| 7 | `s07` | The founder withdraws 10P, then the injected sale happens. `release_party_slot` gives E_PENDING_REFS; after the callback fails the founder holds a 10P claim; release gives E_CLAIM; `claim_party` and its success follow; then the release succeeds. `available` stays 10P throughout, and the buyer can't release its own record (E_OWNER). |
| 8 | `s08`, `s08b` | A record deleted by hand while its payout is in flight goes Stranded on failure, with no panic and P4 intact. A stale callback is ignored. A stranger gets E_NOT_BENEFICIARY. `claim_stranded` re-sends through the same slot with a new id: it fails again (still stranded), then succeeds. Legitimate deletion with a payout in flight gives E_PENDING_REFS, and with a claim gives E_CLAIM. |
| 9 | `s09` | The sponsor can't install a key, pause or refund (E_NOT_CUSTOMER), and its token transfer is returned. The customer installs through `buy`, and `storage_payer` stays the sponsor. After a purchase only the customer can unregister; the sponsor can take back an untouched shell. A duplicate shell gives E_EXISTS. |
| 10 | `s10` | Refund all, `unregister`, and a new shell in the same block: a new `reg_id`, with the same key at epoch 1 again. Only `reg_id` differs, and the old HoldAuth and UseAuth both give E_SIG. |
| 11 | `s11` | Each of these returns the full amount with no state change: a replayed or skipped sequence; an amount 1 off either way; nothing sent; over the per-purchase cap; no such plan; no record; malformed or unknown JSON; a missing sequence; negative units; a message over 1024 bytes; an install into an occupied slot, a bad slot, a bad key or a bad policy; over the outstanding cap (free + held). Exactly at the cap is accepted. A wrong token gives E_ASSET. |
| 12 | `s12` | Before the deadline a stranger gets E_NOT_OPERATOR. After it, settling gives E_EXPIRED, the stranger's release returns 7 units to free, and further settles or releases give E_HOLD_CLOSED. |
| 13 | `s13`, `s13b` | A third pending refund gives E_PENDING_REFS. The 17th concurrent payout gives E_BUSY, and the freed slot is reused with a higher id. A callback in December is booked to December. 25 monthly purchases rewrite the ring in place: 202612 is replaced by 202812, 24 distinct tags remain, and every step has storage delta 0. |
| 14 | `s14` | Sizes below. A shell and a used, held, 64-character-payer entitlement encode to the same length. |

Further tests:

- **Administration:** owner-only plans and grants; rules ceilings; SUPPORT can't meter; revoke; re-appoint costs 0 bytes; at most 8 operators; plan price immutable.
- **Reserve versus withdrawals:** with a hold open and a refund in flight, only `available − reserve` can be withdrawn. Failed refunds and withdrawals never raise it. Only newly earned uses do.
- **Underfunded W1:** an underfunded shell or plan gives E_STORAGE. These are `should_panic` tests only, because those writes precede the charge and the receipt rollback isn't modelled.
- **Near overflow:**
  - Buying 4 × (u128::MAX/3) is returned; 3 × that, exactly MAX, is accepted; a later purchase that would overflow the treasury is returned; MAX passes through pending and back out.
  - `purchase_seq`, `hold_seq` and key epochs at u32::MAX refuse cleanly (returned, E_OVERFLOW or E_HOLD_SEQ_USED).
- **Random sequences:**
  - Four fixed seeds × 400 steps, 2 customers.
  - Operations: purchases, some with a wrong sequence or amount; holds; settles with conflicts; releases; refunds; callbacks (ok, failed and stale); claims; withdrawals; time steps.
  - Every success is checked as above; every refusal is checked for no prior mutation.
  - Successes by operation: `[102, 56, 9, 10, 43, 82, 118, 99, 41, 17, 9, 113]`.

## Defects found while building (fixed before commit)

1. **Book counters could block money.** A month's gross `purchases_in` overflowed after buy-all, refund, buy-again, which would panic a purchase, or in a callback a payout. The monthly counters now saturate; the money buckets stay checked. The near-overflow test asserts this.
2. **Reinstalling a key reset its daily cap.** It no longer does.
3. **`appoint_operator` pushed before charging.** It now charges first.

## Storage: unit-VM borsh figures, not on-chain measurements

| Record | Bytes (borsh) |
|---|---|
| Entitlement (fixed: 10 slots, 4 keys, last hold, 64-byte payer) | 762 |
| PayoutSlot | 111 |
| PartyRecord | 99 |
| Period | 84 |
| Plan | 45 |
| `new()` pre-allocation: 16 slots, 24 periods, founder record and root | 5,894 bytes of `storage_usage` (unit VM; includes its per-record overhead) |

## What this does not prove

- The real FT receipt schedule and the physical-balance bound.
- Gas, including `ed25519_verify` in a 10-use batch.
- On-chain storage cost.
- Real receipt rollback of an underfunded W1 call.
- Any deal, close, manifest, gateway, journal or recovery behaviour.
- The live 100/20/80 journey.
- Any testnet evidence.

Ownership changes are **injected** by `#[cfg(test)] test_set_owner`; that is not a sale. Missing
callbacks remain visible pending liabilities, and reconciling them is a later job. Parent
milestones 002 and 003 stay open; no M3 acceptance is claimed.

Stopping here for Astra's review.
