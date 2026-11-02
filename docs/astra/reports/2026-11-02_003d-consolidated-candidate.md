# 003d revision 3: consolidated transfer protocol, amending revision 2

This is read-only design reasoning for Astra to review. I changed no files, ran no commands, sent no transactions and opened no secrets or runtime data. Nothing here has been executed. Section 6 marks each fact as verified (I read it in a primary source today), inferred, an unmeasured bound, or an unavoidable trust assumption.

This document is the single candidate. It **supersedes** everything in v1 §5 and §9.1–9.2, and the gateway, payout and recovery parts of revision 2. The business-facing scope from v1 still applies by reference: plans and service contracts (§4), deal terms and the Accepting restrictions (§8), freeze meaning, successor grants (§10), and privacy wording as corrected in revision 2 §G.

**Rules removed and replaced everywhere:**

| Removed | Replaced by |
|---|---|
| Per-key nonces, nonce windows, nonce watermarks | Hold/slot identity |
| `not_after` on uses | The use's validity is its hold's lifetime |
| The `attestor` key and readiness signatures | A `close_sale` order sent by the closer account |
| Registry rotation of the attestor | Fixed `closer_account` |
| Transitions T0–T6 | §4 |
| The `orphaned` slot state | `Stranded` (§2.3), defined as unreachable |
| `pending_refunds` | `pending_refs` |

---

## 1. Initial engineering bounds (configurable, validated, not product policy)

| Bound | Where it is set | Initial value | What it trades off |
|---|---|---|---|
| `N_SLOTS` (array size per hold) | build constant | 10 | Bytes per entitlement and settlement gas vs uses per hold |
| `plan.max_hold_units` | plan, ≤ `N_SLOTS` and ≤ `rules.hold_caps.units` | 10 | Customer's lockup exposure vs how often a hold must be opened |
| `plan.hold_ttl_ms`, `plan.settle_grace_ms`, `plan.deliver_within_ms` | plan, within rule ceilings | 30 min, 10 min, 60 s | How long units stay locked vs settlement slack |
| Key `max_units_per_day` | customer, within plan ceiling | chosen by the customer | Exposure from a stolen key |
| Active holds per entitlement | design | 1 | Simplicity and bytes vs concurrency across devices |
| `PAYOUT_SLOTS` | build constant | 16 | Concurrent refunds vs pre-funded bytes |
| `PERIOD_RING` | build constant | 24 months | On-chain history vs bytes |
| `MAX_ISSUE_AGE_MS` | rule | 20 min | How long a leaked close order stays usable vs slack for retrying |

**Latency.** The first use in each hold waits for `open_hold` to reach FINAL. Finality is about 1.2 s (verified), plus submission time. With one active hold, a second device either waits or the gateway closes the current hold and opens one under the other device's key. Allowing one hold per key instead would cost about `4 × hold bytes` per entitlement.

---

## 2. Contract mechanisms (amended; complete)

### 2.1 Records

```rust
reg_seq: u64                                                   // monotonic; never reused
pub struct FixedAccount { len: u8, bytes: [u8; 64] }           // padded: rewrites never change size

pub struct Entitlement {                                       // key (customer, plan_id)
    reg_id: u64, status: u8 /*Shell|Active*/,
    free: u64, consumed: u64, refunded: u64, purchased: u64,
    purchase_seq: u32, hold_seq: u32,
    hold: Hold, last_hold: ClosedHold, keys: [KeySlot; 4],
    claim: u128, pending_refs: u8 /* ≤ 2 */, paused: bool,
    storage_payer: FixedAccount, storage_paid: u128,
}
pub struct KeySlot { state: u8 /*Empty|Active|Revoked*/, epoch: u32, pk: [u8; 32],
                     max_hold_units: u8, max_units_per_day: u16, day: u32, held_today: u16 }
pub struct Hold { active: bool, seq: u32, key_slot: u8, key_epoch: u32, pk: [u8; 32], units: u8,
                  opened_at_ms: u64, serve_until_ms: u64, settle_until_ms: u64,
                  used: u16, charged: u8, slots: [[u8; 32]; N_SLOTS] }
pub struct ClosedHold { seq: u32, used: u16, charged: u8, slots_root: [u8; 32] }   // NEW: `used` bitmap

pub struct PartyRecord { claim: u128, pending_refs: u16, payer: FixedAccount, deposit: u128 }
pub enum SlotState { Free, InFlight, Stranded }
pub struct PayoutSlot { state: SlotState, kind: u8 /*Refund|CustomerClaim|PartyClaim|Profit*/,
                        amount: u128, started_at_ms: u64,
                        to: FixedAccount, plan_id: u32, reg_id: u64 /* 0 = party */ }
```

The signed messages are unchanged from revision 2, `HoldAuth` and `UseAuth`, both over `sha256(borsh(tuple))`, with the hold/slot binding.

### 2.2 Entitlement and hold transitions

Methods, guards and effects are as in revision 2 §A.3, with two amendments:

- Closing a hold now records `last_hold = {seq, used, charged, root}`.
- The bounds in §1 replace the fixed 10.

On-chain hold state per entitlement:

```
Idle(k) ──open_hold(auth.hold_seq = k+1)──► Active(k+1) ──settle_hold*──► Active(k+1)
Idle(k) ──skip_hold_seq──► Idle(k+1)        Active(k+1) ──settle_hold(close) | release_hold──► Idle(k+1), last_hold := summary
```

**Invariants:**

- **U1:** `purchased = free + H + consumed + refunded`, where `H = units − charged` if the hold is active, otherwise 0.
- **U2:** `popcount(used) == charged ≤ units ≤ max_hold_units ≤ N_SLOTS`.
- **U3:** each charged slot carries exactly one fingerprint, signed under that hold's key epoch.
- **U4:** a use is chargeable only into its own active hold, and only while `now ≤ settle_until`.
- **U5:** units are locked only through a customer-signed `HoldAuth`, until at most `serve_until + settle_grace`. The per-key daily cap applies.

### 2.3 Payout slots and beneficiary lifetime (fixes review2 point 1)

**Starting a payout** (`refund_units`, `claim_customer(plan_id)`, `claim_party()`, `withdraw_profit`). All in one call:

- the beneficiary record must exist, otherwise **the initiating method panics**; callbacks never check this;
- for a customer, `pending_refs < 2`;
- find a slot in `Free` state, otherwise `E_BUSY`;
- `record.pending_refs += 1`; slot becomes `InFlight`; `pending_total += a`;
- move the money out of its source bucket: free units, a claim, or available;
- `ft_transfer`, then `on_payout(slot_id, copy)`.

**Callback `on_payout`** (`#[private]`, never panics on expected outcomes):

| Slot | Promise result | Effect (W2 rewrites only) |
|---|---|---|
| Not InFlight, or differs from `copy` | any | Log `payout_mismatch`; return |
| InFlight, record present | success | `held −= a`; `pending_total −= a`; `pending_refs −= 1`; book in the period ring; slot → Free |
| InFlight, record present | failure | `record.claim += a`; `claims_total += a`; `pending_total −= a`; `pending_refs −= 1`; slot → Free |
| InFlight, record **absent** (unreachable under P1–P2) | either | Success: as above, without touching any record. Failure: slot → **Stranded**, amount stays in `pending_total`. |

**`claim_stranded(slot)`**, 1 yocto, caller must be the slot's `to` account: Stranded → InFlight, re-sending through the same slot. Success frees it; failure returns it to Stranded. Nothing is allocated.

**Deletion guards:**

- `unregister` requires `free = 0`, no active hold, `claim = 0`, `pending_refs = 0`.
- `release_party_slot()` requires `claim = 0`, `pending_refs = 0`, the caller is not the owner, and the caller is not the seller or buyer of the live deal. It refunds the deposit to `payer`.

**Invariants:**

- **P1:** for every record r, `r.pending_refs = #{InFlight slots whose beneficiary is r}`.
- **P2:** a record is deleted only when `pending_refs = 0` and `claim = 0`. Together with P1, every InFlight slot's record exists when its callback runs, so Stranded can't be reached without breaking an invariant. Tests reach it only by deliberately corrupting state.
- **P3:** callbacks perform only W2 rewrites.
- **P4:** `pending_total = Σ amount over InFlight and Stranded slots`.
- **P5:** every account that is or was an owner has a PartyRecord until it releases it. Records are created at `new` (founder) and at `propose_sale` for seller and buyer if missing, paid by the proposer. `withdraw_profit` asserts the record exists, and an owner can never release theirs.

**The review's schedule, replayed:**

1. Seller withdraws: seller `pending_refs = 1`.
2. The sale closes.
3. Seller calls `release_party_slot`: refused with `E_PENDING_REFS`.
4. The transfer fails: seller `claim += a`, `pending_refs = 0`.
5. Seller calls `claim_party` and it succeeds.
6. Now `release_party_slot` succeeds.

The money never touches `available` (I4 from v1 still holds).

### 2.4 Close order (fixes review2 point 3, contract side)

```rust
pub struct CloseOrder { business: AccountId, deal_seq: u64, version: u32, digest: [u8; 32],
    expected_generation: u32, freeze_epoch: u64, closing_control_seq: u64,
    service_manifest: [u8; 32], drained_admin_seq: u64, attempt: u32, issued_at_ms: u64 }
```

`close_sale(order)` checks, in this order:

1. Predecessor is `rules.closer_account`.
2. `order.business` is the current account.
3. A live deal exists in `Closing`, with `order.deal_seq` and `order.version` equal to the live deal's.
4. `order.freeze_epoch` equals both `live.freeze_epoch` and `self.freeze_epoch`; `order.closing_control_seq` equals `live.closing_control_seq` (recorded on entering Closing).
5. `order.expected_generation` equals `live.expected_generation` and `self.generation`; `self.owner` is the live seller.
6. `order.digest` equals both the stored digest and a fresh recomputation.
7. `order.service_manifest` equals `live.required_service_manifest`.
8. **Issue time:**
   - `order.issued_at_ms ≤ now_ms`, otherwise **`E_ISSUED_FUTURE`**;
   - then `now_ms − issued_at_ms ≤ MAX_ISSUE_AGE_MS` (no underflow possible after the first check);
   - and `order.issued_at_ms ≥ live.closing_started_ms`.
9. `now_ms < live.deadline_ms`.
10. `available ≥ floor` and `escrow == price`.

Then `finalize` as in v1; `control_seq += 1`; an outcome-ring entry is written, with `attempt` and `drained_admin_seq` in the event.

**`observe_control()`** is a non-payable change method. It writes nothing and returns `ControlView`, as defined in revision 2 §E. Anyone may call it.

The ordering by `control_seq` and invariants D1–D3 are unchanged from revision 2 §E.

---

## 3. Gateway, consolidated (fixes review2 point 2)

### 3.1 Identities (the only ones the gateway uses)

| Object | Identity |
|---|---|
| Entitlement | `(business, plan_id, customer, reg_id)` |
| Key | `(reg_id, key_slot, key_epoch)` |
| Hold | `(reg_id, hold_seq)` |
| Use | `(reg_id, hold_seq, slot)`, bound to `fingerprint` |
| Chain batch | `batch_id`; at most one signed-or-sent batch per hold |

### 3.2 Tables

```
gw_holds  PK(business, plan_id, customer, reg_id, hold_seq)
  key_slot, key_epoch, units, serve_until_ms, settle_until_ms, auth_bytes,
  state: authorized | opening | open | closing | closed | not_opened,
  open_tx{bytes,hash,ref_block}, closed{used,charged,root}
gw_uses   PK(business, plan_id, customer, reg_id, hold_seq, slot)
  fingerprint, release_id, admitted_chain_ms, deliver_by_ms, output_ref, failure, receipt,
  service: admitted | dispatched | delivered | failed | unknown,
  charge:  unsettled | in_batch(batch_id) | charged | uncharged_final | conflict_other_fp
gw_batches PK(batch_id)  hold PK, kind: settle | settle_close | release, items[(slot, fp)],
  tx{bytes,hash,ref_block,ref_ts}, state: prepared | signed | sent | resolved, error?
gw_retention PK(business, plan_id, customer, reg_id)  pruned_through_hold_seq
```

### 3.3 Chain clock and deadlines

`chain_now` is the timestamp of the latest observed final block, plus local monotonic time elapsed since that observation. If that observation is older than 30 s, it is refreshed before admission. σ is the skew margin (default 10 s). τ is the inclusion-and-finality budget for a transaction (default 30 s).

| Deadline | Rule |
|---|---|
| Signed `serve_until` in a HoldAuth | `chain_now + hold_ttl − τ − σ`, so it still satisfies the contract's `≤ now + ttl` and `≥ now + 60 s` when executed |
| Admission | Only if `chain_now + deliver_within + σ ≤ serve_until` |
| Provider deadline | `deliver_by = admitted_chain_ms + deliver_within` (so ≤ `serve_until − σ`). A result after `deliver_by` makes the use `failed(late)`; it is never charged |
| Last batch sent | `settle_until − τ − σ`. Afterwards no settle batch is sent; a `release` may be |
| Missed settlement | The use stays `delivered` with charge `uncharged_final` once the hold is read back closed. The business absorbs the loss |

### 3.4 Request flow

1. The client reads its entitlement: `reg_id`, key epoch, active hold and its free slots, or `next = hold_seq + 1`.
2. **No usable hold.** The client signs `HoldAuth(next, units, serve_until)` and sends `POST /holds`.
   - A `gw_holds` row is inserted as `authorized`.
   - The gateway signs `open_hold`, persisting the bytes, hash and reference block **before** broadcasting (`opening`), then sends.
   - Read-back after FINAL, or on recovery:
     - active hold with this sequence → `open`;
     - `hold_seq ≥ seq`, not active, and `last_hold.seq == seq` → `open` then `closed` (record the summary);
     - `hold_seq < seq` and the auth can still execute → rebroadcast the same bytes. A re-signed `open_hold` with the same auth is also safe: the contract returns `Already`;
     - the sequence was skipped, or the auth can no longer pass its `serve_until` guard → `not_opened`.
3. **A use.** The client takes a free slot of the open hold, signs `UseAuth(slot, fp)` and sends `POST /uses` with the input. Admission is one `BEGIN IMMEDIATE` transaction:
   - the hold is `open` (confirmed FINAL);
   - the deadline rule passes;
   - the signature verifies against the hold's key epoch;
   - INSERT on the use PK. Same PK and same fingerprint returns the stored row. Same PK with a different fingerprint returns **409 `slot_conflict`**.
4. Dispatch, deliver and fail follow the 002c invocation rules (pinned release, dispatch intent committed before the call, no automatic re-run of a paid call). An `unknown` provider outcome must resolve before `deliver_by`, otherwise the use becomes `failed`.

### 3.5 Settlement outbox and read-back after an unknown outcome

**Gateway invariants:**

- **G1:** at most one batch per hold in `signed` or `sent`.
- **G2:** the gateway signs no `open_hold` for `h+1` until hold h is `closed` (read back) and all of h's batches are `resolved`.
- **G3:** a batch's items are uses whose service state is `delivered` and whose charge is `unsettled`. They move to `in_batch` in the same transaction that creates the batch.

**Resolution never assumes a charge.** After FINAL, a transport error, or a restart, the gateway reads `get_entitlement` at one block:

| Chain state for this hold | For each item (slot, fp) |
|---|---|
| Active, `seq == h` | `slots[slot] == fp` and bit set → `charged`. Bit set with a different fp → `conflict_other_fp`. Bit clear → `unsettled` again (re-batch if before the deadline) |
| Not active, `last_hold.seq == h` (guaranteed by G2) | Bit set in `last_hold.used` → `charged`, after checking `last_hold.slots_root` against the gateway's fingerprints for every used slot. If the root doesn't match → `ledger_divergence` alarm, and those uses stay `conflict_other_fp`, not `charged`. Bit clear → `uncharged_final` |
| `last_hold.seq > h` (G2 broken, e.g. another operator under a new owner) | Secondary path: transaction status by hash (`tx`, FINAL) gives the per-slot return value. Outcomes older than the node GC horizon need an archival RPC. If both are unavailable → `charge_state_unavailable`, shown to the customer; never `charged` |

Replacement transactions are safe without proving the original never executed. NEAR's docs warn that a later attempt's expired block hash or consumed nonce **does not prove** the original never ran. Our settle effects are idempotent per (hold, slot, fp), and close-after-close fails, so a late original can't charge twice. Wherever possible, the gateway rebroadcasts the same signed bytes while their reference block is still valid, as the docs recommend.

A conflict in a batch (`E_CONFLICT(slot)`) reverts the whole batch. The gateway reads back, marks that slot `conflict_other_fp`, and re-batches the rest.

### 3.6 Retention and replays of closed holds

- Rows are kept until the hold is `closed`, every batch is `resolved`, and `R = max(plan output retention, 7 days)` has passed. Then the gateway deletes them and advances `pruned_through_hold_seq`.
- A request whose `hold_seq ≤ pruned_through_hold_seq` gets **410 `outside_retry_window`**: not run, not chargeable.
- A request for a hold that is closed but still retained: exact PK and fingerprint returns the stored row; a different fingerprint gets 409; a new slot gets 409 `hold_closed`.
- The chain can only ever be read back for the **current and most recent closed** hold. That is enough because of G2 and retention ordering.

### 3.7 What the customer sees, per use

| Gateway state | Shown | Guarantee stated |
|---|---|---|
| admitted, dispatched | "Working" | "Charged at most once, only for this exact request" |
| unknown (provider) | "Confirming result" | "Not charged unless delivered by HH:MM" |
| delivered, unsettled or in a batch | "Delivered — charge pending" | "1 unit reserved in your hold" |
| delivered, charged | "Delivered — 1 unit used" | on-chain fact: hold h, slot s |
| delivered, uncharged_final | "Delivered — not charged" | on-chain fact: hold closed without that slot |
| failed | "Failed — not charged" | — |
| conflict_other_fp | "A different request signed for this slot was charged" | shows both fingerprints; contact support |
| charge_state_unavailable | "Charge status unavailable" | "Your unit balance on chain is authoritative" |

Delivery and quality remain runtime assertions. Receipts are evidence for disputes, not proof of service.

---

## 4. Runtime authority and issuing the close (fixes review2 points 3 and 4)

### 4.1 Durable state

```
runtime_boot(boot_epoch, write_seq)                 -- single row
authority(business_id, owner, generation, control_seq, freeze_state, freeze_deal_seq,
          freeze_epoch, freeze_cs, anchored_epoch, drain_id, drain_epoch, drained_admin_seq)
admin_ops(id, business_id, kind, admitted_generation, state, ...)
closer_attempts(business_id, deal_seq, freeze_epoch, attempt, state, proc_epoch, drain_id,
                order_json, signer_pk, nonce, ref_block_hash, ref_block_ts, tx_bytes, tx_hash, outcome)
  UNIQUE(business_id, deal_seq, freeze_epoch, attempt)
  UNIQUE(business_id, deal_seq, freeze_epoch) WHERE state IN ('intent','signed','sent')
```

### 4.2 Process epoch and rollback detection

- **Start:** `BEGIN IMMEDIATE`; `boot_epoch += 1`; the process keeps `proc_epoch` and `seen_write_seq`.
- **Every authority transaction** (anchoring, freeze, drain, attempt transitions, ownership): first read `runtime_boot`.
  - `boot_epoch > proc_epoch`: another replica started. Reload caches; `proc_epoch = boot_epoch`. All anchoring must be redone, because rows anchored in other epochs fail the fence.
  - `boot_epoch < proc_epoch`, or `write_seq < seen_write_seq`: **rollback detected**. Halt admin and closer work, raise an alarm, and require a restart.
  - Otherwise `write_seq += 1` and `seen_write_seq = write_seq`.
- **Operations:** restores happen only with every runtime process stopped. The restore tool refuses while a runtime lock is held. A rollback to a snapshot whose `write_seq` is at least every value a live process has seen can't be detected by this check; operating the runtime that way is outside the model (§5).

### 4.3 The admin fence, inside the actual admin commit transaction

```sql
SELECT 1 FROM runtime_boot r JOIN authority a ON a.business_id = :b
 WHERE r.boot_epoch = :proc_epoch AND a.anchored_epoch = :proc_epoch
   AND a.freeze_state = 'none' AND a.owner = :actor AND a.generation = :op.admitted_generation
```

No row means the op is fenced, using 002a's semantics.

### 4.4 Anchoring, freeze, drain and observation

| # | Trigger | Transaction effect |
|---|---|---|
| A1 | First admin request for B in this `proc_epoch` (lazy, at most one in flight per business), or the closer path needs it | Send `observe_control()` from the observer function-call key; wait for FINAL; take the returned `ControlView` (`v`). On a timeout, B stays quarantined. |
| A2 | `v` arrives | If `v.control_seq ≥ authority.control_seq`, apply it (owner, generation, cs). `v.live_deal` in Closing → **F1**. Otherwise `freeze_state = none`. Then `anchored_epoch = proc_epoch`. |
| F1 | Closing observed, by anchor or by a later view with a higher cs | `freeze_state = frozen(seq, epoch, cs)`, **and in the same transaction** drain every non-terminal `admin_ops` row for B, including rows a restore brought back: not dispatched → cancelled; dispatched or applying → fenced. Set `drain_id`, `drain_epoch = proc_epoch`, `drained_admin_seq = max(id)`. Compute the manifest. |
| O1 | View with cs > `freeze_cs` and generation increased | Ownership transition per 003b; freeze cleared; buyer gets admin (anchored at the current epoch, since this read is a fresh observation newer than the anchor) |
| O2 | View with cs > `freeze_cs`, same generation, deal not Closing | Unfreeze (D1–D3 mean the deal ended without closing) |
| O3 | View with cs ≤ stored | Ignored |

**Safety argument.**

- *Freshness:* a transaction is executed by the network after it is sent, so its FINAL outcome reflects every transition that was final before the send. This assumes the RPC reports outcomes honestly.
- *A close or abort after the anchor:* `close_sale` can only come from the closer, and the closer issues only under C1 below, which requires a freeze and drain **in the current epoch**. So if the anchor showed no Closing, the deal can't close before the runtime freezes. If the deal enters Closing outside the UI after the anchor, seller admin before the freeze shows up in the manifest, and a mismatch blocks the close. An abort only clears a freeze, and clearing requires cs > `freeze_cs`.
- *Restored ops:* F1 drains them in the epoch that issues the close.
- *Fence:* it is evaluated inside the commit transaction against the database row, with rollback detection.

### 4.5 Closer attempt state machine

| From | Event | Preconditions (one transaction) | To |
|---|---|---|---|
| — | Create attempt n | Authority frozen for (seq, epoch) with `anchored_epoch = drain_epoch = proc_epoch`; manifest == deal's required manifest; no active attempt; `chain_now < deadline − τ` | `intent` (order without `issued_at`) |
| intent | Sign | Same preconditions still hold; fetch the latest final block B; `issued_at_ms = B.timestamp`; sign with reference block B; persist bytes and hash **before** sending | `signed` |
| intent | Process restart (`proc_epoch` differs) | No bytes ever existed | `abandoned` (no chain effect is possible) |
| signed | Broadcast | — | `sent` |
| signed or sent | Transport error or `NOT_OBSERVED` | Reference block still valid | Rebroadcast the **same bytes**; stays `sent` |
| signed or sent | Observation with cs > `freeze_cs` and generation increased | — | `resolved_closed` (whichever attempt landed) |
| signed or sent | Observation with cs > `freeze_cs`, same generation, not Closing | — | `resolved_not_closed` |
| signed or sent | FINAL failure, error E | — | `failed(E)` |
| signed or sent (earlier epoch) | New epoch anchors and still sees Closing | F1 re-drained in this epoch | `superseded` (still resolved by observation); a new attempt is allowed |
| failed(E) | E is retryable: `E_ISSUE_AGE`, `E_ISSUED_FUTURE`, or the transaction `Expired` | Create-attempt preconditions again | New attempt n+1 |
| failed(E) | E is not retryable: `E_MANIFEST`, `E_TERMS`, `E_GENERATION`, `E_STATE`, `E_FLOOR`, `E_NOT_CLOSER` | — | Terminal. Show "closing cannot complete: E". The deal aborts at its deadline unless resolved. |

- **No wedge:** only one attempt can be active, but an attempt from a dead epoch becomes `superseded`, and an `intent` with no bytes is abandoned.
- **No blind reissue:** each new attempt re-checks the manifest after a drain in the current epoch, and the contract checks it again (check 7).
- **A late landing of a superseded attempt is safe:** it carries identical deal fields and either closes the deal (the runtime is frozen, so that's correct) or fails with `E_STATE` or `E_ISSUE_AGE`.
- `issued_at = reference block timestamp` keeps `issued_at ≤ execution time`, *if* block timestamps don't decrease (inferred, §6). If that ever fails, check 8 rejects with `E_ISSUED_FUTURE`, which is retryable. Safety isn't affected.

### 4.6 Account and key layout

- **Metering account:** one function-call key per business, receiver = that business, methods `[open_hold, settle_hold, release_hold]`. A function-call key has a single receiver and can't attach a deposit (verified).
- **Observer:** a function-call key per business, method `[observe_control]`, with a gas allowance.
- **Closer account:** a separate account with one function-call key per business, method `[close_sale]`.

So a stolen metering key can't close a deal. An account can hold any number of keys, limited only by storage (verified). Each key has its own nonce, so per-business keys avoid nonce contention between businesses. Gas keys with parallel nonce lanes exist (verified); using them is optional.

---

## 5. Safety and availability, listed separately

**Safety (holds under the stated trust):**

- No charge without a customer-signed HoldAuth and UseAuth.
- At most one charge per (hold, slot), and only for the signed fingerprint.
- No altered replay accepted.
- No callback allocates storage.
- No beneficiary claim lost.
- Every not-yet-debited payout is covered by the token balance.
- No managed close without a freeze and drain in the current epoch.
- No seller admin after a close.
- Rollback is detected below the latest `write_seq` any live process has seen.

**Availability costs and failure modes:**

| Failure | Effect on availability |
|---|---|
| RPC outage | No new holds and no admin. Uses inside already-open holds continue. |
| Every process start or replica restart | One `observe_control` transaction per business before admin resumes |
| Closer failure | Abort at deadline; escrow becomes the buyer's claim |
| Gateway outage past `settle_until` | Revenue lost; the customer isn't charged |
| All payout slots busy | `E_BUSY` until callbacks run (about 2–3 blocks) |
| Single active hold | Devices serialize |
| A callback that never runs | Its slot stays InFlight: one less concurrent payout and a visible pending obligation |

**Outside the model, stated explicitly:**

- A dishonest RPC that fabricates FINAL outcomes. Light-client proof verification would remove this; out of scope.
- A database rolled back under a running process to a snapshot at or above every `write_seq` that process has seen.
- A compromised runtime: revision 2 §G lists exactly what it can and can't do; unchanged.

---

## 6. Sources and evidence labels

**Verified today against primary sources:**

- Function-call keys: one receiver, optional method list and gas allowance, no deposits. https://docs.near.org/protocol/accounts-contracts/access-keys#function-call-keys
- Any number of keys per account, limited by storage. https://docs.near.org/integrations/accounts
- `tx` with `wait_until`. `UNKNOWN_TRANSACTION` is returned only when `wait_until` is `NONE`; otherwise the call times out. `NOT_OBSERVED` means resend the same signed transaction. https://docs.near.org/api/rpc/transactions
- **"Resend the same signed bytes while their reference block remains valid… an expired block hash or consumed nonce on a later attempt does not prove that the original transaction never executed."** https://docs.near.org/integrations/create-transactions
- Validity is measured in blocks (86,400 blocks ≈ 14.4 h); an old reference block gives `Expired`. https://docs.near.org/integrations/transaction-lifecycle
- Non-archival nodes garbage-collect after 5 epochs (about 1.5 days). https://docs.near.org/protocol/network/epoch
- Views accept a `block_id` for a consistent snapshot. https://docs.near.org/api/rpc/contracts
- Callbacks run even if the call fails, can themselves fail, and are not retried. https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-failures
- Storage costs 10¹⁹ yocto/byte. https://docs.near.org/protocol/storage/storage-staking
- Max 1 PGas per transaction from protocol 83. https://docs.near.org/smart-contracts/anatomy/collections
- Block time about 600 ms, finality about 1.2 s. https://docs.near.org/integrations/blocks-and-finality
- `env::ed25519_verify` signature (documented at near-sdk 5.30.0). https://docs.rs/near-sdk/latest/near_sdk/env/fn.ed25519_verify.html

**Inferred (not stated in the docs I read):**

- That `ed25519_verify` exists in the pinned near-sdk **5.29.1**. Compiling will confirm it.
- That block timestamps never decrease.
- That a contract can't read another account's access keys: the environment page lists no such function.
- That an outcome from `observe_control` executes no earlier than when it was sent: follows from the transaction lifecycle.
- That same-length `LookupMap` rewrites leave `storage_usage` unchanged.
- That the unit-test VM can inject promise results and track `storage_usage`.

**Unmeasured bounds:** entitlement bytes (about 1 KB at `N_SLOTS = 10`), PartyRecord and PayoutSlot bytes, gas for `settle_hold` at N verifications, gas for `open_hold`, `observe_control`, `close_sale` and the callback.

**Unavoidable trust:** RPC honesty; custody of the closer, metering and observer keys; the runtime's statements about delivery and manifest; the integrity of browser code holding use-keys; full platform custody of keys in local preview.

---

## 7. Test matrix for the amended mechanisms

Unchanged rows from revision 2 (N1–N11, N13, N15–N23) are kept, with every nonce or `not_after` wording replaced by hold/slot.

| # | Scenario | Tier | Expected |
|---|---|---|---|
| M1 | The review's party-slot schedule: withdraw → ownership change → release → callback fails → claim → release | U | Release refused with `E_PENDING_REFS`; claim lands; release succeeds afterwards; storage delta ≤ 0 in the callback |
| M2 | A customer refund is in flight; the customer tries `unregister` | U | `E_PENDING_REFS` |
| M3 | Corrupted state (record deleted while a slot is InFlight); callback fails | U | Slot Stranded, no panic, `pending_total` unchanged; `claim_stranded` by the beneficiary resends through the same slot |
| M4 | `pending_refs` cap of 2, then the 17th global payout | U | `E_BUSY`; P1 holds after every callback |
| M5 | Callback success and failure across a month boundary, and on a 25th month | U | Period ring slot rewritten; storage delta = 0 |
| M6 | Close readback: batch outcome unknown, hold since closed | T | `charged` exactly for bits in `last_hold.used` with matching root; others `uncharged_final`; root mismatch → divergence alarm, nothing marked charged |
| M7 | Batch outcome unknown, hold still active | T | Per-slot read-back; clear bits re-batched; never double-charged |
| M8 | G2: open next hold while a batch is unresolved | T | Refused by the gateway |
| M9 | Admission at the edge: `chain_now + deliver_within + σ > serve_until` | T | 422 `hold_ending`; client gets a new hold |
| M10 | Retry of a pruned hold, a closed but retained hold, a different fingerprint | T | 410; stored row; 409 |
| M11 | Crash after an attempt row reaches `intent`, before signing | T | Restart → abandoned → re-anchor → F1 → new attempt; one close |
| M12 | Crash after `signed` is persisted, before sending | T | Restart → anchor shows Closing → old attempt `superseded`, rebroadcast optional → new attempt; whichever lands closes; the other `E_STATE` |
| M13 | Close order with `issued_at` in the future / older than the max age / from the wrong closer / wrong epoch, cs or generation | U | `E_ISSUED_FUTURE` / `E_ISSUE_AGE` / `E_NOT_CLOSER` / `E_GENERATION` (or field-specific error); no state change |
| M14 | Manifest changed between attempts | T, U | No new attempt (mismatch); the contract refuses a stale manifest |
| M15 | Another replica starts while an admin commit is in progress | T | Fence fails (epoch); re-anchor; then succeeds |
| M16 | Same-process database swap to an older snapshot | T | `write_seq` regression detected; admin and closer halted |
| M17 | Anchor shows no Closing; deal enters Closing outside the UI; seller admin; runtime observes later | T | Freeze, drain, manifest mismatch → no close attempt; abort at deadline |
| M18 | Anchor timeout or stale view during quarantine | T | Admin stays quarantined |

---

## 8. First implementation slice (narrowly testable)

### S1‴: the v3 contract's storage, claims and payout core

**Scope:** Rust unit tests only, in a new crate. No holds, deals, gateway or runtime.

**Includes:**
- `new`, which pre-allocates `PAYOUT_SLOTS`, the `PERIOD_RING` and the founder's PartyRecord;
- `sponsor_shell`; `ft_on_transfer` purchase, with or without key installation; `install_key` and `revoke_key` with epochs;
- `refund_units`, `claim_customer(plan_id)`, `claim_party`, `withdraw_profit`;
- `on_payout` with all four rows of the callback table; `claim_stranded`;
- `unregister`, `release_party_slot`;
- views: `get_entitlement`, `get_treasury`, `get_pending`, `get_party`;
- the `Hold` and `ClosedHold` layouts present but inactive, so the record size is final.

**State setup:** any state that S1‴ can't reach through its own public methods (a non-zero `available`, a change of owner) is set through a test-only helper inside the crate. The report must label it as injected.

**Acceptance (exactly what this proves):**
- M1–M5; revision 2's N5–N7, N12 and N13 for the included methods;
- I1, U1 (with no hold), and P1–P5 checked after every call;
- storage delta ≤ 0 for every non-W1 method, using the unit-test VM's `storage_usage`;
- a report of serialized byte sizes.

**Explicitly not proved by this slice:**
- real FT receipt ordering and the physical-balance bound (sandbox; S4);
- gas figures;
- measured on-chain storage costs;
- holds and settlement (S2), deals and `close_sale` (S3), gateway (S6), runtime authority and closer (S7);
- any testnet evidence.

I'm stopping here for Astra's review. No implementation should start until this revision is accepted.
