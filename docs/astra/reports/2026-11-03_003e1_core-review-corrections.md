# 003e1 report: business-v3 core review corrections

Claude, 2026-11-02/03. Job: [003e1](../jobs/2026-11-02_003e1_core-review-corrections.md). The
work started November 2; the build was paused, then resumed and finished November 3.

All evidence is from the keyless unit VM. Synthetic ed25519 keys come from fixed seeds. Ownership
changes are **injected** with `#[cfg(test)] test_set_owner`, which is not a sale. There was no
deployment build, sandbox, testnet, signing or chain call.

## Commits

| Commit | What |
|---|---|
| `a0d3716` | Contract corrections (`lib.rs`, `Cargo.toml`, `Cargo.lock`) |
| `f2def66` | Tests: the weak-key reproduction, regressions for each item, wider random sequences |
| `c1dfebf` | Design note `docs/design/BUSINESS_V3_CORE.md`: 003e1 decisions and limits |
| this commit | This report and the JOBS row |

`a0d3716` changes view types, so its old tests compile again only with `f2def66`.

**Not changed:** v1, v2, scripts, config, server and web.

**Dependencies:**

- `ed25519-dalek =2.2.0` (`default-features = false`) becomes a normal dependency, used only to decode use-keys.
- `curve25519-dalek =4.1.3` is a dev-dependency for test inputs.
- Both were already locked. The lockfile change is one dependency edge, with no new packages or versions.

## 1. Pinned verification experiment (done first)

**Host source.** `near-sdk 5.29.1` uses `near-vm-runner 0.37.4` as its unit host.

- That runner's `VMLogic::ed25519_verify` (`src/logic/logic.rs:1815`) decodes the key with `ed25519_dalek::VerifyingKey::from_bytes` and calls the plain `Verifier::verify`.
- In ed25519-dalek 2.2.0, that is `raw_verify` (`verifying.rs:557-565`). Only `verify_strict` (`:357-372`) rejects small-order keys or R values.
- `from_bytes` only decompresses the point.

**Probe**, run against the unfixed contract through the real unit host, with no assumptions in the test:

```
PROBE identity: install_key accepted = true
PROBE identity: host accepted a forged HoldAuth after 1 tries; open_hold = Ok("opened")
PROBE identity: 10 candidate uses tried; settle_hold = Ok([10 × "charged"]); consumed = 10
PROBE zero: install_key accepted = true
PROBE zero: host accepted a forged HoldAuth after 1 tries; open_hold = Ok("opened")
PROBE zero: 15 candidate uses tried; settle_hold = Ok([10 × "charged"]); consumed = 10
```

**The reviewer's hypothesis reproduces in the pinned unit host.** With the identity key (`01 00…`)
or the all-zero key installed, an operator opened a hold and charged all 10 units. No customer
signed anything: each signature was (R of small order, s = 0).

- For the identity key, a single forged signature verifies for every message.
- For the zero key, each of the four small-order R values works with probability ¼, because `k = H(R‖A‖M)` depends on R. Varying the fingerprint finds one within a few tries.

This is a proven authorization bypass in the unit host, not just a usability problem with invalid
keys. **Not proved:** that the deployed protocol's host verifies the same way. The finding is
pinned to this unit host.

**Fix.** `use_key()` decodes with the same crate and version as the host verifier and refuses keys
that don't decode or report `is_weak()`. It applies to `install_key` (`E_KEY_INVALID`) and to
installs inside a purchase (the purchase is returned).

**Regression tests:**

- `the_pinned_host_accepts_forgeries_under_weak_keys` pins the host behaviour. If a future pin verifies strictly, this test fails and should be revisited.
- `a_weak_key_in_a_record_would_let_an_operator_charge_without_the_customer` writes the key into a record directly, because install now refuses it, and shows all 10 units charged after 11 and 16 host checks.
- `weak_and_undecodable_keys_are_refused_on_both_install_paths` covers curve25519-dalek's own `EIGHT_TORSION` points, a non-canonical identity, an identity with the sign bit set, and an undecodable y. A real key still installs on both paths.

There is no hand-rolled cryptography or encoding blacklist. The test also asserts that every
refused key is one the decoder rejects or reports as weak.

## 2. Deadlines

- `new` requires a hold-TTL ceiling of 60 s to 1 h and a grace ceiling of at most 1 h. Plans are bounded by the rules.
- `open_hold` computes `now + 60 s`, `now + TTL` and `serve_until + grace` with checked additions before any change.
- `get_rules` exposes the ceilings.

Tests:

- **Refused at `new`:** TTL of 59,999 ms, 3,600,001 ms or u64::MAX; grace of 3,600,001 ms or u64::MAX; zero.
- **Accepted at `new`:** exactly 60 s and exactly 1 h / 1 h.
- **Plans:** the same bounds.
- **`open_hold` boundaries:**
  - `serve_until` of now + 60 s opens; one ms less gives E_EXPIRED.
  - Exactly the TTL opens; one ms more, or u64::MAX, gives E_TTL without overflow.
  - Settling works exactly at `settle_until` and gives E_EXPIRED one ms later.
  - A stranger's release is refused at the deadline and allowed one ms after.

## 3. Readback

- **`get_entitlement`** now shows the active hold's key slot and epoch and its opening time. It shows each slot's charged fingerprint (or null), and every key's public record: state, epoch, public key, policy, UTC day and units held that day.
- **`check_use(customer, plan, reg_id, hold_seq, slot, fingerprint)`** answers `charged`, `conflict`, `unused`, `closed` (with `slot_used` and the root), `unknown_hold`, `other_registration`, `no_entitlement` or `invalid`.
- **Closed roots:** `closed_hold_root` is public, so a client recomputes the root from its own uses. A changed fingerprint gives a different root.
- **`already`:** `open_hold` returns `already` only if the submitted signature verifies. Zero, foreign, malformed or empty signatures give E_SIG. Settle's `already` already verified every use first.

Tests: `readback_identifies_exactly_which_use_was_charged` (matching, conflicting, unused, closed,
re-registration, no entitlement) and `already_vouches_only_for_a_valid_signature`.

## 4. Books

Period counters:

- `customer_returns`: refunds and customer claims actually paid.
- `owner_withdrawals`: profit and party claims actually paid.
- `paid_on_retry`: the part of those two paid through a claim or a stranded retry.
- `purchases_in` and `earned`.
- Fixed-size `saturated` bit flags.

A payout is booked by what the money is, when it actually leaves. Views report each counter as
`{amount, exact}`, and a saturated counter is a lower bound. The view field `refunded` is renamed
`units_retired_to_refund` and documented as units retired, not money returned.

Tests:

- A refund fails, its claim fails, the second claim succeeds, then a duplicate callback: `customer_returns` is 10P exactly once.
- A failed withdrawal paid by claim lands in `owner_withdrawals` 5P, with `paid_on_retry` 15P.
- Month rollover (s13b).
- A gross flow over u128 gives `purchases_in {MAX, exact: false}`, while the other counters stay exact.
- In s05b, a failed refund later paid as a claim now appears as a customer return. Before this job it was booked only to `claims_paid`.

Bucket invariants hold throughout.

## 5. Capacity

- Party payouts (profit withdrawals and party claims, including retries and stranded ones) are capped at 2 per party and 4 across the business (`E_PARTY_CAP`), checked before any change.
- So at least 12 of the 16 slots stay open for customers. `E_BUSY` now means every slot holds a legitimate payout.

`s13_bounded_payouts`:

- The founder is capped at 2. A failed withdrawal plus `claim_party` stays within the cap.
- After injected owner changes, the buyer gets its own 2, and a third owner is refused at the business-wide 4.
- Six customers then fill the other 12 slots, and only then does a seventh customer see E_BUSY.
- Freed slots are reused with higher ids.
- Old-beneficiary claims stay with the former owner (s07, s13).

**Remaining limits, stated rather than solved:**

- Many Sybil customer accounts can still fill the customer slots.
- A missing callback holds its slot until reconciliation, which is a later job.
- One party's in-flight payouts can delay another party's claim, within the business-wide 4.

## 6. Other fixes

- **Re-grants:** `appoint_operator` always needs ≥ 1 yoctoNEAR. A re-grant with 0 gives E_DEPOSIT, with 1 it succeeds (delta 0), and a new operator with 1 gives E_STORAGE.
- **Revoked operators:** `revoke_operator` keeps the freed storage in the contract. It doesn't refund someone else's stake to the revoker.
- **Month lookups:** `get_period` never panics. Months 0, 202600, 202613, 196912 and 1,000,001 are `invalid`; overwritten months are `not_retained`; empty months are `no_activity`.
- **Identity counters:** registration and payout ids are checked before any change, giving `E_OVERFLOW: … ids` with nothing changed.
- **Stranded retries** are `detached`. With the founder's record deleted (corruption) and then recreated by injected ownership, a re-sent payout's failure leaves it stranded with no claim on the new record. Its success touches no counter and books an owner withdrawal paid on retry.
- **Pending counts:** a count already at zero is reported (`pending_refs_underflow` event), not hidden by saturating. The callback still completes.
- **Reachability:** stranded payouts are reachable only from already-corrupt state (P1–P2) or a re-sent stranded payout that fails again. They are not an ordinary theft path.

## Commands and results (WSL Ubuntu)

```
cd /mnt/c/Dev/Everstreet/contracts
CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --lib     → ok. 38 passed; 0 failed
CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v2 --lib     → ok. 27 passed (v2 unchanged)
CARGO_TARGET_DIR=$HOME/everstreet-target cargo clippy -p business-v3 --all-targets   → 0 warnings (after touching lib.rs)
npm run check (repo root)   → Test Files 31 passed; Tests 349 passed
```

`cargo check -p business-v3 --lib` on its own is refused by near-sdk's build guard (not wasm, no
unit-testing feature). The library is compiled through the test target.

**Mutation checks.** Each mutant was applied, run, then reverted:

| Mutant | Failing test |
|---|---|
| Weak-key refusal off | `weak_and_undecodable_keys_are_refused_on_both_install_paths` |
| Business-wide party cap +100 | `s13_bounded_payouts` |
| `detached` ignored | `a_resent_stranded_payout_never_touches_a_recreated_record` |
| `already` without verifying | `already_vouches_only_for_a_valid_signature` |

**Unit-VM borsh sizes (not on-chain):** Entitlement 762 B, PayoutSlot 112 B (+1, `detached`),
PartyRecord 99 B, Period 85 B (+1, `saturated`), Plan 45 B. `new()` pre-allocates 5,934 B
including the root.

**Random sequences:**

- The original test: 3 seeds × 400 steps, plan 1. Successes by operation: `[102, 56, 9, 10, 43, 81, 118, 99, 43, 16, 9, 113]`.
- New: 3 seeds × 400 steps across two prices (P and 3P+7), key revocation and reinstall at new epochs, injected owner changes with and without operator re-grants, operator re-appointment, and stale callbacks up to 4 ids back. Successes by operation: `[66, 27, 5, 7, 17, 41, 84, 74, 8, 9, 3, 22, 14, 74, 79]`.
- Settles are a small share of the new test's successes (12), because most attempts find the hold already closed or released. The original test covers settlement heavily.

All 26 prior scenarios still pass. s13 was rewritten for the party caps, and its earlier assertion
(16 owner withdrawals, then E_BUSY) is intentionally gone. s14's sizes were updated.

## Left for integration (not proved here)

- Gas, including `ed25519_verify` per use, the key decode at install, and callback worst cases (the source review's G1).
- The real FT receipt order and physical balances (G4).
- Detached native storage refunds.
- Receipt rollback for underfunded W1 calls (G3).
- `#[init]` front-running (G2).
- Callback reconciliation.
- Whether the deployed host verifies like the pinned unit host.
- The live 100/20/80 journey.
- Deals, close, manifest, gateway and journal.

Revocation is limited too:

- A revoked key's already-active hold can still settle uses signed during its grace period.
- Revocation blocks only new holds.
- The daily cap is per UTC day, not a rolling 24 hours.

The 003g sale-core candidate was not read or used. M3 stays open, and nothing is integrated.
