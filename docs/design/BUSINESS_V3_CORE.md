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
| Period ring | Index = (year × 12 + month) mod 24. Writing a new month overwrites that index in place with a zeroed, re-tagged entry. `get_period(yyyymm)` returns it only if the tag matches. |
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
| W1 charge order | `appoint_operator` computes the new entry's encoded size and charges it before changing anything. `sponsor_shell` and `create_plan` must write before they can measure, so an underfunded call panics after the write; the runtime reverts the receipt, and the unit tests only assert the refusal. `install_key` is not W1 here: the key slots are inside the fixed-size record, so installing on a shell is a same-size rewrite (delta 0). |
| Holds | One active hold per entitlement. A hold needs at least 60 s left to serve and at most the plan's TTL; `settle_until = serve_until + plan.settle_grace`. Revoking the hold's key stops serving now (`serve_until = min(serve_until, now)`), but uses already signed still settle until `settle_until`. Operators may release any time; anyone may once `settle_until` has passed. The daily cap counts units *held* per key slot per UTC day, and reinstalling a key does not reset it. |
| Payout bounds | At most 2 payouts in flight per entitlement (`E_PENDING_REFS`); 16 slots overall (`E_BUSY`). Party records have no per-record bound beyond the 16 slots. |
| Books | Monthly counters (`purchases_in`, `earned`, `refunds_paid`, `claims_paid`, `owner_withdrawals`) saturate. They are reporting totals, and a month's gross flow can exceed u128 (buy everything, refund, buy again); they must never block money moving. The money buckets themselves use checked arithmetic. |
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

Real FT receipt ordering and the physical balance bound; gas, including `ed25519_verify`;
on-chain storage cost (byte sizes are unit-VM borsh figures); deals, close, gateway and
recovery; and any testnet behaviour.
