# business-v3 core: implementation note (job 003e)

Claude, 2026-11-02. This implements the accepted subset only: [003e](../astra/jobs/2026-11-02_003e_entitlement-contract-core.md),
the consolidated candidate §2 and the recovery addendum §8. The crate is new and undeployed:
`contracts/business-v3`. **Excluded:** deals, close, freeze, closer, manifest, gateway and
journal. v1 and v2 are untouched.

## Pinned SDK (checked in the local registry source, then compiled)

`near-sdk = "=5.29.1"`, the same pin as v2; nothing is upgraded. The design's APIs exist in
5.29.1:

- `env::ed25519_verify(&[u8; 64], impl AsRef<[u8]>, &[u8; 32]) -> bool`;
- `env::storage_usage`, `env::storage_byte_cost`, `env::sha256_array`,
  `near_sdk::is_promise_success`;
- `store::LookupMap::flush`;
- five-argument `testing_env!` with `promise_results` (v2's tests already use it).

The test-only dev-dependency is `ed25519-dalek = "2.2.0"`, already in `Cargo.lock`
(transitively). Its keys are derived from fixed test seeds. **Synthetic signatures only.**

## Routine choices made here

| Question | Choice |
|---|---|
| Fixed-size records | `Entitlement`, `PartyRecord`, `PayoutSlot` and `Period` hold only fixed-width fields and arrays. Accounts are stored as `FixedAccount { len, [u8; 64] }`, so every rewrite keeps the same byte length (a W2 write). Views convert to JSON-friendly types; the borsh records are never serialized as JSON. |
| Pre-allocation | `new` writes 16 payout slots (`LookupMap<u8, PayoutSlot>`), 24 period entries (`LookupMap<u8, Period>`, each tagged with its `yyyymm`) and the founder's `PartyRecord`. |
| Period ring | Index = (year × 12 + month) mod 24. Writing a new month overwrites that index in place with a zeroed, re-tagged entry. `get_period(yyyymm)` (003e1) always answers with a status: `recorded` (tag matches); `not_retained` (a later month took the entry); `no_activity`; or `invalid` (month outside 1970-01..9999-12, or month 00/13+). It never panics. |
| Measured growth (W1) | `sponsor_shell`, `create_plan` and `appoint_operator` flush the collection they write, charge `storage_usage` delta × `storage_byte_cost`, require at least that much attached, and refund the excess. `sponsor_shell` records `storage_paid`. |
| Plans | Immutable once created, including `unit_price`; there is no update method. A new price is a new plan. Every refund is `units × plan.unit_price`. |
| Purchases | `ft_on_transfer` checks that the predecessor is `asset` (otherwise it panics, so the token refunds). Everything else is **validated before any mutation**: message length ≤ 1024, JSON `{"buy":{plan_id, units, purchase_seq, install?}}`, the record exists for `(sender, plan)`, `amount == units × price` (checked multiply), `purchase_seq == ent.purchase_seq + 1`, units within the plan bounds, outstanding within the cap, and a valid install slot. Any failure returns `PromiseOrValue::Value(amount)` with no state change. |
| Signed messages | `sha256(borsh(("business-hold/v1", business, plan_id, customer, reg_id, key_slot, key_epoch, hold_seq, units, serve_until_ms)))` and `sha256(borsh(("business-use/v1", business, plan_id, customer, reg_id, key_slot, key_epoch, hold_seq, slot, fingerprint)))`, exactly as in revision 2 §A.2. Signatures are hex, 128 characters; keys are hex, 64. |
| Key authority | `install_key` needs predecessor == customer, and installing through a purchase needs the token's `sender_id`. A sponsor gets nothing. Epochs only increase (install +1, revoke +1). |
| Batch settlement | Two passes: validate every use (signature, slot range, conflicts against stored and in-batch fingerprints), then apply. `E_CONFLICT` panics before any mutation. A duplicate same fingerprint returns `Already`. |
| Daily cap | UTC day = `now_ms / 86_400_000`; `held_today` resets when the day changes. |
| Payout identity | A monotonic `payout_seq`. Each slot stores its `payout_id`, and the callback is `on_payout(slot, payout_id)`. A callback whose slot isn't InFlight with that id logs `payout_mismatch` and returns, with no state change. A reused slot therefore ignores an old callback. |
| Missing callback | Nothing resolves it on chain. The slot stays InFlight and its amount stays in `pending_total`, listed by `get_pending`. There is no retry and no guessed success. Reconciliation is a later job. |
| Ownership injection | `#[cfg(test)] test_set_owner(owner, generation, grants)`: test-only, labelled **injected**, not a sale. It sets the owner and generation, so old operator grants stop counting (operators carry a generation), records the successor's grants, and creates the new owner's `PartyRecord` if missing. |
| Superseded by 003g | `appoint_operator` is no longer W1: operators live in 8 pre-allocated fixed-width slots, and the owner is fixed-width ([sale note](BUSINESS_V3_SALE.md) §2.5). `test_set_owner` is removed. Party claims are split into three categories. |
| W1 charge order (003e1, before 003g) | `appoint_operator` computes the new entry's encoded size and charges it before changing anything. `sponsor_shell` and `create_plan` must write before they can measure, so an underfunded call panics after the write; the runtime reverts the receipt, and the unit tests only assert the refusal. `install_key` is not W1 here: the key slots are inside the fixed-size record, so installing on a shell is a same-size rewrite (delta 0). |
| Holds | One active hold per entitlement. A hold needs at least 60 s left to serve and at most the plan's TTL; `settle_until = serve_until + plan.settle_grace`. Revoking the hold's key stops serving now (`serve_until = min(serve_until, now)`), but uses already signed still settle until `settle_until`. Operators may release any time; anyone may once `settle_until` has passed. The daily cap counts units *held* per key slot per UTC day, and reinstalling a key does not reset it. |
| Payout bounds (003e1) | At most 2 payouts in flight per entitlement (`E_PENDING_REFS`). Party payouts (profit withdrawals and party claims, which include retries) are capped at 2 per party and 4 across the business, counting stranded ones (`E_PARTY_CAP`), so at least 12 of the 16 slots are always open to customers. `E_BUSY` means every slot holds a legitimate payout. This does not stop many Sybil customer accounts from filling the customer slots, or missing callbacks from holding slots forever; both remain integration and reconciliation gates. |
| Books (003e1) | Monthly counters: `purchases_in`, `earned`, `customer_returns` (refunds and customer claims actually paid), `owner_withdrawals` (profit and party claims actually paid), and `paid_on_retry` (the part of those two paid through a claim or a stranded retry). A payout is booked by its economic category when the money actually leaves, however many attempts it took. Counters saturate rather than block money; each has a bit in `saturated`, and views then show it as `{amount, exact: false}`, a lower bound and never a total. The money buckets use checked arithmetic. |
| Refunded units | `units_retired_to_refund` in the view (the record's `refunded`) counts units retired at the plan price into a refund. The money for them may still be in flight or an unpaid claim; it is not "money returned". |
| Deadlines (003e1) | Fixed ceilings: hold TTL from 60 s to 1 hour, settle grace up to 1 hour, checked at `new` and at every plan. Every deadline addition in `open_hold` is checked before any change. These are engineering bounds for this product family. They are not a promise to support arbitrarily long-running agents. `get_rules` exposes them. |
| Use-keys (003e1) | Both install paths decode the key with ed25519-dalek 2.2.0's `VerifyingKey::from_bytes`, the same decoder and version as the host verifier (near-vm-runner 0.37.4), and refuse it if it doesn't decode or `is_weak()` (small order). The host's `ed25519_verify` is the non-strict `verify`; with a small-order key, an operator could forge every HoldAuth and UseAuth, and this was reproduced in the unit host. This adds no hand-rolled cryptography and no encoding blacklist. |
| Readback (003e1) | `get_entitlement` shows the active hold's key slot and epoch, its opening time, each slot's charged fingerprint, and every key's public record (state, epoch, public key, policy, UTC day, units held that day). `check_use(customer, plan, reg_id, hold_seq, slot, fingerprint)` answers with one status: `charged`, `conflict`, `unused`, `closed` (with `slot_used` and the root), `unknown_hold`, `other_registration`, `no_entitlement` or `invalid`. A closed hold's root is `closed_hold_root(used slots in order)`, which the client recomputes. `open_hold` returns `already` only when the submitted signature verifies. |
| Stranded retries (003e1) | `claim_stranded` marks the re-sent payout `detached`: its callback never touches any record (one with the same name may have been recreated meanwhile), and a failure leaves it stranded again. A record's pending count at zero is reported (`pending_refs_underflow`), not hidden by saturating. |
| Administration (003e1) | `appoint_operator` always needs an attached deposit (≥ 1 yoctoNEAR), so a re-grant is an intentional full-access action. `revoke_operator` keeps the freed storage in the contract rather than refunding it to a revoker who may not have paid for it. Registration and payout ids are checked for overflow before any change. |
| Storage refunds | `unregister` and `release_party_slot` send the storage deposit back to whoever paid it as a detached transfer; the method returns nothing. |
| Callback storage | `ft_on_transfer`, `on_payout` and all non-W1 methods are asserted in tests to have storage delta ≤ 0 (= 0 for the receiver and callback), measured by flushing collections and writing root state in the unit VM. |

## Invariants checked

`check()` runs at the end of every money-moving method and asserts I1:

```
held = ent_free_value + ent_held_value + available + pending_total + claims_total
```

There is no escrow in this slice. The tests also check, after each step:

- U1 per entitlement: `purchased = free + (hold.active ? units − charged : 0) + consumed + refunded`;
- U2: popcount(used) == charged ≤ units ≤ max hold;
- P1: a record's `pending_refs` equals its InFlight slots;
- P4: `pending_total` equals the sum over InFlight and Stranded slots;
- S0 and S1: storage deltas.

## What this does not prove

- Real FT receipt ordering and the physical balance bound.
- Gas, including `ed25519_verify` and the key decode at install.
- On-chain storage cost: byte sizes are unit-VM borsh figures.
- Whether the deployed protocol's host verifies the same way as the pinned unit host. The weak-key reproduction is unit-host evidence only.
- Deals, close, gateway and recovery.
- Any testnet behaviour.
