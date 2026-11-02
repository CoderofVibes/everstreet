Status: I've read the third review and checked the remaining NEAR facts (async receipts, callbacks, transaction recovery, unit-test promise mocking). The addendum follows.

# 003d addendum 4: restore boundaries, permanent unknown charges, first job

This is read-only design for Astra's review. I wrote no files, ran no commands, made no git writes, sent no transactions and used no credentials. Nothing here has been executed. It amends the consolidated candidate (`2026-11-02_003d-consolidated-candidate.md`). Anything not mentioned here stands.

**Summary of the change:** serving authority moves onto the chain, and the gateway's records move into a forward-only journal. Where facts can't be re-established after a restore, the affected service becomes temporarily unavailable rather than guessing.

## 1. What changes, in one paragraph

The review's counterexample works against the candidate because the *active release* lived only in the runtime's restorable database. The fix moves the only serving-critical administrative fact onto the chain: a per-business **service manifest pointer**, set by the owner with a transaction. The runtime may serve a business only from the manifest the chain currently names, after a fresh anchor in the current process epoch. If it can't load that manifest's artifacts, the business is shown as **temporarily unavailable**; it is never served from an older release. Customer invocation records move out of the restorable database into a forward-only journal. When the journal itself can't be trusted, holds opened before the break become **indeterminate**: no admission, no re-run, released early. Separately, a batch with an unknown outcome no longer blocks the next hold. Once a hold is seen closed on chain, its slots can never be charged again, so the uncertainty only affects reporting.

## 2. Durability domains and who is authoritative

| Domain | Contents | Rule |
|---|---|---|
| **C**: NEAR contract state | Entitlements, holds, `last_hold`, units and money, owner and generation, `service_manifest` pointer, deal | Authoritative. Read only through anchored or monotonic observations. |
| **A**: artifact store | Release artifacts, manifest documents, service contracts, evaluation records, delivered outputs | Content-addressed (`sha256`), write-once. An entry is valid only if its bytes hash to its key. A restore may *lose* entries but can't change them. |
| **J**: invocation and authority journal | Admissions (with the signed UseAuth), dispatch intents, provider outcomes, deliveries, settlement batches, hold records, close attempts, freeze and drain records | Append-only and hash-chained per business. **Forward-only**: never restored to an earlier point except as a declared lineage break (§3.4). |
| **D**: working database (SQLite) | Indexes and projections of A, J and C; studio drafts; sessions | Restorable. Never authoritative for serving, charging or authority. Rebuilt forward from J and C. |

**Production requirement:** A and J live in a different failure and backup domain from D, with versioning and deletion protection.

**In the local preview all four sit on one disk.** Restoring that disk restores A, J and D together. So any restore in local preview is treated as a **declared lineage break**. The preview must not claim this separation.

## 3. Exact recovery protocol

### 3.1 The manifest pointer on chain (new contract state)

```rust
service_manifest: [u8; 32], manifest_seq: u64      // in Business; set in new() to the founder's first manifest, or zero meaning "none"
#[payable] fn set_manifest(&mut self, digest: [u8; 32], expected_seq: u64)
  // owner only, 1 yocto; refused while a deal is live (E_DEAL_PENDING);
  // requires expected_seq == manifest_seq; then manifest_seq += 1; control_seq += 1; event
```

- `ControlView` gains `service_manifest` and `manifest_seq`.
- The deal digest binds `(service_manifest, manifest_seq)`. `required_service_manifest` is now *derived* from the chain, not asserted by the runtime.
- `close_sale` check 7 becomes: `order.service_manifest == self.service_manifest == live.required_service_manifest`.

**The manifest document** (stored in A, canonical JSON, no secrets) contains:
- per product and plan: the release ID and artifact digest;
- the provider binding as an **immutable vault-entry version** (`binding_id`, `version`, provider, model, pricing version);
- the metering account and gateway route.

Rotating a provider secret creates a new vault version, which means a new manifest and a new `set_manifest`. A seller therefore can't swap the secret behind an unchanged manifest.

**Releasing (UI):**
1. The runtime writes the artifacts and the manifest document to A and confirms they hash correctly.
2. The owner signs `set_manifest`.
3. The runtime observes the new `manifest_seq` (monotonic) and switches routing. In-flight invocations stay pinned to the release they started on (002c).

**Outside-UI `set_manifest`** to a digest that isn't in A pauses that business's service (§3.2). The owner can do this; customers can still refund.

### 3.2 Serving gate (customer path; replaces "customer paths unaffected")

A business B may serve in process epoch `e` only if all of the following hold:

- **SG1** an anchor A1 (the `observe_control` transaction at FINAL) has been made in epoch `e`;
- **SG2** the locally loaded manifest digest equals the anchored `service_manifest`, and every artifact it references is present in A with a matching hash;
- **SG3** after the anchor, later views are applied only when `manifest_seq` increases, and routing switches on that increase.

If SG1 fails, B is unavailable: "verifying service". If SG2 fails, B is unavailable: "release can't be restored". Entitlements, refunds and claims remain available on chain. No "uninterrupted" claim is made for the gap.

**Cost:** one anchor transaction per business per process epoch, made lazily on the first request. While the RPC is down, nothing new is served.

### 3.3 Invocation, outbox and settlement records

**Write order, each step durable in J before the next action:**

| Step | J record | Action that follows |
|---|---|---|
| 1 | `admitted{use_id, fp, UseAuth sig, release, deliver_by}` | Dispatch is allowed |
| 2 | `dispatch_intent{use_id, attempt, provider_request_key = H(use_id)}` | Provider call |
| 3 | `outcome{delivered(output_digest) \| failed(class) \| usage}` | The output body is in A *before* the delivery is recorded |
| 4 | `batch{batch_id, items, tx bytes, hash, ref_block}` | Broadcast |
| 5 | `hold_observed{seq, closed, last_hold summary}` | Batch resolution (§4) |

D holds projections only.

**Recovery cases:**

| Case | Detection | Recovery | What becomes unavailable |
|---|---|---|---|
| R0: restart, nothing restored | — | Re-project D from J; SG1–SG2; a `dispatch_intent` without an outcome becomes `unknown`. Ask the provider by `provider_request_key` if it supports lookup; otherwise, after `deliver_by`, `failed_unknown_cost` (customer not charged; cost kept unresolved as in 002a1). **Never re-run.** | Admin and serving until anchored |
| R1: D restored, J intact | D's recorded J head is behind J's actual head | Replay J forward into D; then R0 | Same |
| R2: lineage break | Declared by the operator; **or** D's recorded J head is ahead of J; **or** the chain shows a charged slot, or an active or last hold, that J doesn't know | `lineage_id += 1` (stored in J and D). Every hold whose J record predates the break, or that J doesn't know but the chain shows active, is **indeterminate**: no admission; the gateway calls `release_hold` (operator); slots never re-run. A slot charged on chain without a J record becomes `charged_record_lost` (shown; goodwill remedy is business policy, not enforced). Uncharged slots without a record can't be charged at all, because the customer's signature is gone. | The affected customer until the indeterminate hold is released and seen closed (≤ one round-trip, or `settle_until` if the release fails); output for lost records |
| R3: J rolled back without declaration and without detection | — | **Outside the model.** Worst case: a customer's exact retry into a hold whose admission record was lost gets re-run once (duplicate paid provider work, still **charged at most once** by the contract). | — |

**Admission rule (added): AR1.** A use may be admitted only into a hold whose `hold_opened` J record has the current `lineage_id`, and which is confirmed active on chain. A retry for any other hold gets 409 `hold_closed` / `indeterminate_slot`, or 410 if pruned.

### 3.4 Close attempts across a restore (the review's counterexample)

Assumptions: backup taken at t0 (release R1, manifest M1; no use u yet). At t1 the owner sets M2 on chain (R2). At t2 use u is delivered in hold h, slot s; whether it was charged doesn't matter. At t3 the deal enters Closing and a close order (M2) is signed and sent. At t4 the runtime is restored to t0. At t5 the close lands.

| Step | Result |
|---|---|
| Restart | Epoch e+1; admin **and serving** quarantined for every business |
| Lineage | Local preview: restore ⇒ declared break. Production: J intact ⇒ R1 replay restores u, h and the attempt. J rolled back ⇒ detected (chain shows hold h active or charged slots unknown to J) ⇒ R2. |
| A1 anchor | Shows Closed (t5 landed), owner = buyer, `service_manifest = M2`. If not yet landed: still Closing, M2. |
| SG2 | Local manifest is M1, chain says M2 ⇒ load M2 from A. If present, serve R2. **If missing, B is unavailable**, and the buyer's transfer view shows "release artifacts missing". **R1 is never served.** |
| Use u | J intact: re-projected; a retry returns the stored output from A. R2: hold h indeterminate and released; a retry of (h, s) gets 409; if s was charged on chain, `charged_record_lost`. Never re-run. |
| Close attempt | Already landed ⇒ O1 transition to the buyer. Still Closing ⇒ the old attempt is `superseded`; a new attempt needs F1 (re-freeze and re-drain in the current epoch) and SG2 to pass (M2 loaded). The contract re-checks M2. If the old attempt lands late, it closes with identical fields or fails `E_STATE`. |

**What the closer handshake still guarantees.** Serving authority is now enforced by the contract (the manifest pointer, frozen while a deal is live), so the closer is no longer what makes serving safe. It still provides two things:
- **Liveness evidence:** SG2 passed, meaning the artifacts are present, and the metering grant is ready.
- **Draining off-chain non-serving administration:** studio and build jobs, under 002a's owner-epoch fencing.

Removing the closer later is a possible simplification. It is not proposed here.

## 4. Permanently unknown charges, next-hold admission, bounded storage

**G2 is replaced by G2′.** The gateway may sign `open_hold` for `h+1` once hold h is **seen closed at FINAL**: `hold_seq ≥ h` and h is not active. It does *not* have to wait for h's batches to resolve.

*Why this is safe:* `settle_hold` only accepts the active hold whose sequence matches. A late batch transaction for h fails `E_HOLD_CLOSED`, so a closed hold can never be charged again.

**Resolution comes from the same read that proves closure.** The read that shows h closed also returns `last_hold`, unless someone else has opened *and closed* a later hold in between. Each batch item is resolved from that read using the earlier table (bit and root ⇒ `charged`; bit clear ⇒ `uncharged_final`).

**Named states and recovery paths:**

| State | Cause | Customer sees | Next hold | Recovery |
|---|---|---|---|---|
| `closure_unconfirmed` | No FINAL read available (RPC down) | "Service temporarily unavailable; your units are safe and refundable on chain" | Blocked (opening a hold needs the chain anyway) | Automatic when a read succeeds |
| `resolved` | Read showed `last_hold.seq == h`, or the active hold == h | Per-use charged / not charged | Allowed | — |
| `charge_count_only` | `last_hold.seq > h`, but `consumed` snapshots allow exact counting: the J record of `consumed` when h opened, plus the counts of later holds visible in the same read | "k of these n uses were charged; which ones can't be determined" | Allowed | Final |
| `charge_unknown_final` | `last_hold.seq > h`, no exact count, and the transaction status for the batch hash is unavailable (no archival node within reach) | "Charge record for these uses is unavailable; your on-chain unit balance is authoritative" | Allowed | Retry the archival lookup by hash while it is useful; otherwise final. Kept as a business record. Never shown as "uncharged" or "charged". |

**Storage, stated separately:**
- **Contract (bounded):** per entitlement, the current hold (≤ `N_SLOTS` fingerprints) and one `ClosedHold` summary; per business, fixed rings and slots. No per-use history in state. Events live in receipt outcomes and are retained by archival nodes, not by the contract.
- **Gateway (stronger, off chain):** J keeps full per-use records for the retention window R, plus permanent records for `charged_record_lost`, `charge_count_only` and `charge_unknown_final`. Those are bounded by the number of incidents. They are business records and transfer with the business.

## 5. Contract-enforced guarantees vs required trust

| Enforced by the contract (v3) | Required trust (not enforced) |
|---|---|
| Units bought at a fixed plan price; U1–U5; P1–P5; I1 | Delivery, output quality, release compatibility, provider and model identity behind a vault version |
| Charges only with customer-signed HoldAuth and UseAuth; one fingerprint per (hold, slot); no charge into a closed hold | The runtime serves only the anchored chain manifest (SG1–SG3) and never re-runs a dispatched use |
| Refunds and claims available to customers at all times; callbacks never allocate storage | A and J are forward-only in production; lineage breaks are declared or detected (§3.3) |
| Serving manifest pointer changes only by the owner, frozen while a deal is live; the close order must match it | Honest RPC outcomes (freshness comes from the anchor transaction; honesty is assumed) |
| Floor, successor grants, close order fields (from the candidate) | Custody of the closer, metering and observer keys; browser code holding use-keys; full key custody in local preview |
| Physical balance ≥ `held − pending_total` at any single block | The provider-lookup capability that resolves unknown dispatches; otherwise `failed_unknown_cost` |

## 6. Compatibility with deployed v2 (explicit)

- **v3 is a new crate:** `contracts/business-v3`, its own wasm and global hash by code hash, published later only on Tony's explicit yes.
- **v1/v2 stay as they are:** crates, `config/testnet.json` entries, Juniper and all evidence. No migration, redeploy or state conversion.
- **v2 customers stay on v2** under the legacy "operator-trusted credit, observed revocation" label. Moving to v3 would be a new, customer-initiated purchase on a new business account. Nothing moves automatically.
- **Server:** v3 gets a separate `Chain` client and FakeChain. The v2 interfaces and tests are unchanged.
- **Workspace:** adding the crate to `contracts/Cargo.toml` is the only shared-file edit.

## 7. Primary NEAR sources (checked 2026-11-02)

| Claim | Status | URL |
|---|---|---|
| A cross-contract call executes 1–2 blocks after the calling function; the callback is a separate receipt that can fail on its own if it lacks gas | Verified | https://docs.near.org/smart-contracts/anatomy/crosscontract |
| A callback always runs but can fail; only its own changes revert; it is not retried | Verified | https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-failures |
| A failed receipt rolls back only that receipt; earlier receipts stay committed; callbacks are separate receipts | Verified | https://docs.near.org/integrations/transaction-lifecycle and https://docs.near.org/protocol/transactions/transaction-execution |
| `wait_until` levels; FINAL; finality ≠ success | Verified | https://docs.near.org/integrations/blocks-and-finality |
| `UNKNOWN_TRANSACTION` only with `wait_until: NONE`; `NOT_OBSERVED` ⇒ resend the same signed bytes | Verified | https://docs.near.org/api/rpc/transactions |
| A later attempt's expired hash or consumed nonce doesn't prove the original never executed; resend the same signed bytes | Verified | https://docs.near.org/integrations/create-transactions |
| Validity measured in blocks (~14.4 h at 86,400 blocks) | Verified | https://docs.near.org/integrations/transaction-lifecycle |
| Non-archival nodes garbage-collect after 5 epochs (~1.5 days) | Verified | https://docs.near.org/protocol/network/epoch |
| Storage 10¹⁹ yocto per byte | Verified | https://docs.near.org/protocol/storage/storage-staking |
| Charge the measured `storage_usage` delta | Verified | https://docs.near.org/smart-contracts/security/storage |
| Max 1 PGas per transaction (from protocol 83) | Verified | https://docs.near.org/smart-contracts/anatomy/collections |
| Function-call keys: one receiver, no deposit | Verified | https://docs.near.org/protocol/accounts-contracts/access-keys |
| `ed25519_verify` signature (near-sdk 5.30.0) | Verified | https://docs.rs/near-sdk/latest/near_sdk/env/fn.ed25519_verify.html |
| `testing_env!` can take `promise_results` as its 5th argument (near-sdk 5.30.0) | Verified | https://docs.rs/near-sdk/latest/near_sdk/macro.testing_env.html |
| Both of the above exist in the pinned **5.29.1**; mocked `storage_usage` tracks real byte changes; block timestamps don't decrease | **Inferred**; the first job confirms or refutes |
| Gas for `ed25519_verify` and per method; real per-record bytes | **Unmeasured** | — |

## 8. First implementation job (scope: entitlement, storage and claims core only)

**Name.** "M3 v3-S1: business-v3 entitlement, storage and claims core (keyless unit tests)." Accepting this job does **not** accept the managed close, the freeze, the closer, the manifest pointer, the gateway, the journal or any recovery guarantee.

### Files

New `contracts/business-v3/{Cargo.toml, src/lib.rs, src/tests.rs}`, plus the workspace member line in `contracts/Cargo.toml`. Dev-dependency for creating test signatures: an ed25519 signing crate, chosen by Claude as package owner.

**Not touched:** `contracts/business`, `contracts/business-v2`, `scripts/`, `config/`, `server/`, `web/`. No wasm build for deployment, no sandbox, no testnet.

### Data

From the consolidated candidate §2.1, with `N_SLOTS = 10` and `ClosedHold.used`:

- `Business { name, asset, rules{min_reserve, hold_caps}, owner, generation, operators (≤8, METERING|SUPPORT caps), plans (≤32; Plan as v1 §3 without service-contract routing logic), entitlements, party: LookupMap<FixedAccount, PartyRecord>, payout_slots: LookupMap<u8, PayoutSlot> (16 pre-allocated), periods: LookupMap<u8, Period> (24 pre-allocated), reg_seq, held, ent_free_value, ent_held_value, available, pending_total, claims_total }`
- **Excluded from this job:** deals, `control_seq`, freeze, closer, `service_manifest`.

### Methods

| Group | Methods |
|---|---|
| Setup | `new(name, owner, asset, rules)` (pre-allocation and founder PartyRecord); `create_plan(PlanInput)` payable (measured); `appoint_operator` / `revoke_operator` (owner, 1 yocto) |
| Entitlement | `sponsor_shell(customer, plan_id)` payable; `ft_on_transfer` with `buy{plan_id, units, purchase_seq, install?}`; `install_key`; `revoke_key`; `skip_hold_seq`; `set_paused`; `unregister` |
| Holds | `open_hold(customer, plan_id, auth, sig)`; `settle_hold(customer, plan_id, hold_seq, uses, close)`; `release_hold(customer, plan_id, hold_seq)` |
| Money out | `refund_units`; `claim_customer(plan_id)`; `withdraw_profit`; `claim_party`; `claim_stranded(slot)`; `release_party_slot`; `#[private] on_payout(slot_id, copy)` |
| Views | `get_entitlement`; `get_treasury`; `get_pending`; `get_party`; `get_period(yyyymm)`; `get_plan` |
| Test-only (`#[cfg(test)]`, labelled "injected" in the report) | `test_set_owner(acct, generation)` (stands in for a sale) |

The founder's PartyRecord exists from `new`; a buyer's record is created by `test_set_owner` until deals exist.

### Invariants checked after every call

`I1`, `U1`–`U5`, `P1`–`P5`, plus:

- **S0:** `storage_usage` delta ≤ 0 for every method except `new`, `create_plan`, `appoint_operator`, `sponsor_shell` and `install_key`-on-Shell (which W1-charges the measured delta).
- **S1:** `ft_on_transfer` and `on_payout` have storage delta = 0.

### Scenarios (keyless, `VMContextBuilder` and `testing_env!` with `promise_results`)

P = 50,000 base units; plan `max_hold_units = 10`.

1. **100/20/80 happy path.** Customer `sponsor_shell` (self-paid) → `buy{100, seq 1, install slot 0}` → HoldAuth(h1, 10) opened by METERING → `settle_hold(h1, slots 0–9, close)` → HoldAuth(h2, 10) → settle 10, close.
   Expect: `free 80, consumed 20, purchased 100, available 20P, ent_free_value 80P, held 100P`; `last_hold {seq 2, used 0x3FF, charged 10}`.
2. **Duplicate same fingerprint** within h2 before closing → `Already`, `charged` unchanged. Re-settling h1 after it closed → `E_HOLD_CLOSED`. Final state as in 1.
3. **Altered fingerprint** for slot 3 of h2 → `E_CONFLICT`; batch reverted; state identical to before.
4. **UseAuth signed for h1 submitted into h2** → `E_SIG`. Expired HoldAuth (`serve_until < now + 60 s`) → refused. `open_hold` with no auth, while paused, or over the daily cap → refused.
5. **Withdraw vs reserve:** with h3 open (10 units), `refund_units(81)` → `E_UNITS`. `refund_units(70)` → slot InFlight. Callback success → `refunded 70, free 0, held −70P`. Same with callback failure → `ent.claim += 70P`, then `claim_customer(plan)` succeeds.
6. **Ownership change mid-hold (injected):** h3 open; `test_set_owner(buyer, gen 2)` re-grants METERING; settle 4 then close → `consumed 24, free 76`. The former owner's `withdraw_profit` → `E_NOT_OWNER`.
7. **The review's party-slot schedule:** founder withdraws 10P (`pending_refs 1`) → `test_set_owner(buyer)` → founder `release_party_slot` → `E_PENDING_REFS` → callback failure → founder `claim 10P` → `claim_party` succeeds → release succeeds. `available` never increases.
8. **Stranded (corrupted on purpose):** delete a record while its slot is InFlight; callback failure → Stranded, no panic; `claim_stranded` resends through the same slot.
9. **Sponsor can't take authority:** sponsor calls `install_key` → `E_NOT_CUSTOMER`. Customer installs via `buy`; `storage_payer` stays the sponsor.
10. **Re-registration:** `unregister`, then `sponsor_shell` in the same block → new `reg_id`; old HoldAuth and UseAuth → `E_SIG`.
11. **Purchase replay:** `purchase_seq 1` again, or a wrong amount → `PromiseOrValue::Value(amount)` and no state change.
12. **Expiry:** h4 left open past `settle_until`; a stranger calls `release_hold` → units back to `free`; a later settle → `E_HOLD_CLOSED`.
13. **Bounds:** 17th concurrent payout → `E_BUSY`; a third pending refund on one entitlement → `E_PENDING_REFS`; callbacks across a month change and a 25th month rewrite the ring in place (S1).
14. **Report:** borsh byte sizes for Entitlement, PayoutSlot, PartyRecord and Period, plus total pre-allocated bytes. Labelled as unit-VM figures, not measured on chain.

### Done when

All scenarios pass under `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --lib` in WSL. `cargo test -p business-v2` (the existing 27 tests) is unchanged and still passes. The report states what is proved: contract logic and invariants in the unit VM. It also states what is not:

- the real FT receipt schedule and the physical-balance bound (sandbox, later);
- gas, including `ed25519_verify`;
- on-chain storage cost;
- deals, close, manifest pointer, gateway, journal, runtime recovery;
- any testnet evidence.

### Not in this job

No v2 change, deploy, global publish, signing, testnet transaction, server or web integration, or claim in the UI.

---

Stopping here. No implementation is authorized by this run. The job above is a proposal for Astra to review and, if accepted, to open as a job.
