REVIEWED WITH REQUIRED CORRECTIONS, November 3: see jobs/2026-11-03_003g_sale-core.md for the sole implementation authority. The original proposal below is preserved as design history, not accepted verbatim. Saved at Tony's requested pause November 2 from read-only Claude output.

# 003g proposal: a modeled sale and close in the business-v3 contract (no files changed)

This proposal replaces `test_set_owner` with a real sale and close state machine inside the contract. The live gateway, the runtime that would sign a close, and deployment all stay deferred.

I read Astra's 003e review, the 003e1 job, the current `contracts/business-v3/src/lib.rs` (the committed 003e source, before the 003e1 corrections), the 003e report with its implementation note, and my consolidated candidate and recovery addendum. I wrote no files and ran no commands. Everything below is source analysis; nothing in it has been executed.

## 1. Unresolved flaws in the existing candidate

1. **The managed-close proof depends on parts that don't exist yet.** It needs the closer account, the forward-only journal, the artifact store and the per-epoch anchoring. None can be built or tested without keys. A contract slice can enforce *who* may complete a close. It can't enforce what that closer checked first, and must not imply it does.
2. **The plan list was hashed by walking every plan** (up to 32). Plans are immutable and v3 can stop new plans while a deal is live, so binding `plan_count` is exact and cheaper.
3. **`freeze_epoch` duplicates `control_seq`.** A deal enters Closing once, and `control_seq` only increases, so `closing_control_seq` identifies the freeze uniquely.
4. **Deal storage was paid by a deposit and refunded later**, which needs detached refunds whose failures aren't observed (an integration gate). A single deal record pre-allocated at `new` never grows or shrinks, so the deal path needs no refunds.
5. **The candidate let some administration continue while a deal was open** (operator revocation during Accepting). The simpler rule: no owner administration at all while a deal is live, except profit withdrawals that keep `available` at or above the agreed floor.
6. **Funding, unfunding, cancelling and closing were left to send payouts.** Each payout competes for slots and, after 003e1, for the capped number of party payouts. Instead, escrow returns and seller proceeds become party claims. Deal methods never create a token transfer. The beneficiary later collects with `claim_party`. The only remaining risk is that collection is delayed, not that money is lost.
7. **Unresolved, carried forward as integration gates:**
   - deriving `issued_at` from the reference block depends on block timestamps never decreasing, which is unverified;
   - detached storage refunds;
   - gas, including ed25519 verification;
   - receipt rollback of an underfunded storage-paid call;
   - 003e's `already` reply to `open_hold`, which skips signature verification (being fixed in 003e1).
8. **The current code has no sale at all.** `test_set_owner` is test-only. `get_control` returns only `(owner, generation)`. The core's balance check (I1) has no escrow term.

## 2. Recommendation: one contract, two close modes, chosen at `new`

| Mode | How a close completes | Honest claim |
|---|---|---|
| **`Direct`** | The second matching acceptance closes the sale in the same receipt (atomic, like v2) | On chain: atomic transfer, former owner revoked immediately. Off chain: refused once the close is observed (003b). Nothing is claimed about the runtime. |
| **`Gated { closer }`** | The second matching acceptance moves the deal to `Closing`. Only `closer` can complete it with `close_sale(order)` before a deadline; after that anyone can abort it. | The contract enforces that **only the configured closer can complete a close**, and only with an order matching the live deal and manifest. Whether the closer drained administration and holds the artifacts is a **trust assumption**, not implemented or proved in this slice. |

**Why both, and why now.** Both share about 90% of the code. Gated adds one state and two methods. Keeping it in the contract preserves the strong goal. Direct is the smaller honest design available today. The server must not present a pre-check as the gate: in `Gated` mode only the closer account can close, and in `Direct` mode no server check stands between acceptance and close.

The flagship managed business should use `Gated` once the runtime closer exists. Until then, any deployment would be `Direct`, and that deployment is not part of this slice.

---

## 3. Contract changes

### 3.1 New fixed state (pre-allocated at `new`; all deal transitions rewrite in place)

```rust
pub enum CloseMode { Direct, Gated { closer: AccountId } }            // in Rules; fixed at new
pub const CLOSE_WINDOW_MIN_MS: u64 = 600_000;        // 10 min
pub const CLOSE_WINDOW_MAX_MS: u64 = 86_400_000;     // 24 h
pub const MAX_ISSUE_AGE_MS: u64 = 1_200_000;         // 20 min
pub const MAX_GRANTS: usize = 4;
pub const OUTCOME_RING: u8 = 8;

// in Business (new fields)
control_seq: u64,                 // +1 on every control-state mutation (list in §3.4)
service_manifest: [u8; 32], manifest_seq: u64,
deal_seq: u64,
escrow_total: u128,
deal: LookupMap<u8, DealSlot>,    // exactly one entry, key 0, written at new with live = false
outcomes: LookupMap<u8, DealOutcome>, // 8 entries written at new

pub struct GrantSlot { account: FixedAccount, caps: u8 }               // caps 0 = empty
pub struct DealSlot {                                                   // fixed size (~650 B, unmeasured)
    live: bool, state: u8 /* PROPOSED=0 ACCEPTING=1 CLOSING=2 */,
    seq: u64, version: u32,
    seller: FixedAccount, buyer: FixedAccount,
    price: u128, expires_at_ms: u64, close_window_ms: u64, available_floor: u128,
    grants: [GrantSlot; MAX_GRANTS], terms_hash: [u8; 32],
    expected_generation: u32, manifest: [u8; 32], manifest_seq: u64, plan_count: u32,
    seller_accepted: [u8; 32], seller_has: bool, buyer_accepted: [u8; 32], buyer_has: bool,
    escrow: u128,
    closing_started_ms: u64, deadline_ms: u64, closing_control_seq: u64, proposed_control_seq: u64,
}
pub struct DealOutcome { seq: u64, version: u32, digest: [u8; 32], status: u8 /* CLOSED|CANCELLED|EXPIRED|ABORTED */,
                         generation_after: u32, control_seq: u64, at_ms: u64,
                         seller: FixedAccount, buyer: FixedAccount, price: u128 }
```

### 3.2 Inputs, digest and close order

```rust
pub struct DealTermsInput { buyer: AccountId, price: U128, expires_at_ms: U64, close_window_ms: U64,
    available_floor: U128, grants: Vec<(AccountId, u8)>, terms_hash: String /* hex32 */ }

digest = sha256(borsh((
  "business-deal/v3", current_account, deal.seq, deal.version, seller, buyer, asset, price,
  expires_at_ms, close_window_ms, available_floor, grants[4], terms_hash, expected_generation,
  service_manifest, manifest_seq, plan_count, rules.min_reserve, close_mode)))

pub struct CloseOrder { deal_seq: U64, version: u32, digest: String, expected_generation: u32,
    closing_control_seq: U64, manifest: String, manifest_seq: U64,
    issued_at_ms: U64, attempt: u32, drained_admin_seq: U64 /* recorded, not checked: trusted */ }
```

**Validation of `DealTermsInput`:**

- `buyer` is not the owner, not the business account and not the asset.
- `price > 0`.
- `now + 60 s ≤ expires_at_ms ≤ now + 30 days`, with checked addition.
- `Direct`: `close_window_ms == 0`. `Gated`: `close_window_ms` lies in [10 min, 24 h].
- At most 4 grants, with distinct accounts and caps a subset of METERING|SUPPORT.
- `terms_hash` is valid 32-byte hex.

**`Gated` validation:** the grants must include at least one METERING account. The contract can't check that it is the managed metering account; that is a trust and UI rule.

### 3.3 Methods

Every method recomputes the digest from live state wherever a digest is compared.

| Method | Caller and deposit | Guards (all checked before any mutation) | Effect |
|---|---|---|---|
| `set_manifest(digest, expected_seq)` | owner, 1 yocto | no live deal (`E_DEAL_PENDING`); `expected_seq == manifest_seq` | Set the pointer; `manifest_seq += 1`; `control_seq += 1` |
| `propose_sale(terms) -> U64` | owner, payable | no live deal; terms valid; `deal_seq + 1` doesn't overflow | Create the buyer's PartyRecord if missing (W1, charged to the measured growth, payer = proposer); fill the slot: `live = true`, `PROPOSED`, `seq = ++deal_seq`, version 1, `expected_generation = generation`, manifest pointer, `plan_count`; `proposed_control_seq = ++control_seq` |
| `revise_sale(deal_seq, terms)` | seller (still the owner at the same generation), 1 yocto | live; `PROPOSED` or `ACCEPTING`; terms valid; the buyer **can't change** while escrow > 0 (`E_FUNDED_BUYER`) | `version += 1`; acceptances cleared; state `PROPOSED`; `control_seq += 1`. Escrow stays but is valid only if it equals the new price. |
| `ft_on_transfer` with `fund_deal{deal_seq, version, price}` | token; `sender_id` must be the buyer | Otherwise the **whole amount is returned**: live; `PROPOSED`/`ACCEPTING`; seq and version match; `price == amount == deal.price`; `escrow == 0`; no overflow | `escrow = amount`; `escrow_total += amount`; `held += amount`; `control_seq += 1` |
| `unfund_deal(deal_seq)` | buyer, 1 yocto | live; `PROPOSED`/`ACCEPTING`; escrow > 0 | escrow → `party[buyer].claim`; `claims_total += e`; `escrow_total −= e`; buyer acceptance cleared (state falls back to `PROPOSED` or seller-only `ACCEPTING`); `control_seq += 1` |
| `accept_sale(deal_seq, version, digest)` | seller or buyer, 1 yocto | live; `PROPOSED`/`ACCEPTING`; seq and version match; `now < expires_at`; `generation == expected` and `owner == seller`; digest matches; `available ≥ floor` (`E_FLOOR`); for the buyer, `escrow == price` (`E_UNFUNDED`) | Record that party's acceptance; `control_seq += 1`. **Both present and equal**: `Direct` → `finalize`; `Gated` → `CLOSING` with `closing_started_ms = now`, `deadline_ms = now + window`, `closing_control_seq = control_seq` |
| `cancel_sale(deal_seq)` | seller or buyer, 1 yocto | live; `PROPOSED`/`ACCEPTING` (in `CLOSING`: `E_CLOSING`) | `terminate(CANCELLED)` |
| `expire_sale(deal_seq)` | anyone | live; `PROPOSED`/`ACCEPTING`; `now ≥ expires_at` | `terminate(EXPIRED)` |
| `close_sale(order)` | `Gated` closer only, **not payable** (so a function-call key can sign it) | See the checks below | `finalize` |
| `abort_close(deal_seq)` | anyone | live; `CLOSING`; `now ≥ deadline_ms` | `terminate(ABORTED)` |

**`close_sale` checks, in order:**

1. The mode is `Gated` and the predecessor is the closer.
2. A live deal in `CLOSING` whose seq and version match the order.
3. `order.expected_generation == deal.expected_generation == generation`, and `owner == seller`.
4. `order.closing_control_seq == deal.closing_control_seq`.
5. `order.digest` matches the live digest.
6. `order.manifest == service_manifest == deal.manifest`, and `manifest_seq` matches.
7. `issued_at ≤ now` (otherwise `E_ISSUED_FUTURE`); then `now − issued_at ≤ MAX_ISSUE_AGE_MS`; and `issued_at ≥ closing_started_ms`.
8. `now < deadline_ms`.
9. `available ≥ floor` and `escrow == price`.

**`terminate(status)`:** escrow → `party[buyer].claim` (W2); `escrow_total = 0`; outcome written to ring slot `seq % 8`; `slot.live = false` and fields zeroed in place; `control_seq += 1`. No promise is created.

**`finalize`, in one receipt:**

1. `escrow_total −= price`; `party[seller].claim += price`; `claims_total += price`.
2. `owner = buyer`; `generation += 1` (checked).
3. `operators` = the deal's grants at the new generation. The vector is rebuilt; it costs nothing because the root bytes for those grants were already charged when they were appointed — see the storage note below.
4. Outcome `CLOSED` with `generation_after`.
5. Slot cleared; `control_seq += 1`.
6. Event `sale_finalized`.

`held`, the customer buckets, `available` and pending payouts are all unchanged.

**Storage note on operators.** The operator list is part of the root state, and its size depends on its length and on account-name lengths. To keep `finalize` from growing storage, `new` pre-allocates the operator list as `[GrantSlot; MAX_OPERATORS]` with fixed-width accounts. That is a W2 refactor of 003e's `Vec`. `appoint_operator` then fills a slot (W2) and needs only the intentional 1-yocto deposit from 003e1. **This is a required change in this slice.**

**Owner methods while a deal is live** (`E_DEAL_PENDING` unless noted):

| Method | `PROPOSED` / `ACCEPTING` | `CLOSING` |
|---|---|---|
| `create_plan`, `appoint_operator`, `revoke_operator`, `set_manifest` | refused | refused |
| `withdraw_profit(a)` | allowed only if a seller acceptance exists and `available − a ≥ max(floor, min_reserve)`, else `E_FLOOR` / `E_RESERVED`; with no acceptance yet, only `min_reserve` applies | `E_CLOSING` |

All customer methods, metering by operators of the current generation, payout callbacks and claims work in every state.

### 3.4 `control_seq` and views

`control_seq` increases by one on: `create_plan`, appoint and revoke, `set_manifest`, propose, revise, fund, unfund, accept, entering Closing, cancel, expire, abort, finalize.

| View | Returns |
|---|---|
| `get_control() -> ControlView` | `{ owner, generation, control_seq, close_mode, service_manifest, manifest_seq, live_deal: Option<DealView{seq, version, state, digest, buyer, seller, price, floor, escrow, grants, expires_at, deadline, closing_control_seq, accepted_by}> }` |
| `get_deal_outcomes()` | The 8-entry ring |

`test_set_owner` is **deleted**. 003e's s06 and s07 are re-expressed through a real `Direct` close (§5).

### 3.5 Invariants (checked after every successful call, as in the 003e harness)

- **I1′:** `held = ent_free_value + ent_held_value + available + pending_total + claims_total + escrow_total`.
- **D1:** `escrow_total == (slot.live ? slot.escrow : 0)`, and at most one live deal.
- **D2:** a deal enters `CLOSING` at most once and leaves only by `finalize` (`close_sale`) or `ABORTED`.
- **D3:** `generation` changes only in `finalize`, by exactly +1.
- **D4:** while a deal is live, `plan_count`, the manifest pointer, the operators and the rules are unchanged.
- **D5:** while `ACCEPTING` with a seller acceptance, or `CLOSING`, `available ≥ floor`. It holds because only owner withdrawals reduce `available` (and they are gated). Customer purchases, refunds, holds, releases and settlements change only the customer buckets, or increase `available`.
- **D6:** after `finalize`: `owner == buyer`, `generation == expected + 1`, every operator equals one of the deal's grants at the new generation, the seller's claim grew by `price`, and nothing else changed.
- **D7:** `control_seq` strictly increases on the listed mutations and on nothing else.
- **D8:** every deal transition and `finalize` has storage delta 0. `propose_sale` grows storage only by the buyer's record, when missing, charged at the measured cost. `new` pre-allocates the deal slot, the outcome ring and the operator slots.
- **P1–P5, U1–U5, S0, S1** from 003e stay unchanged.

---

## 4. Effects on each party across the sale

| Item | Before close | At close | After close |
|---|---|---|---|
| Customer units, holds, claims | Unaffected by the deal | Unchanged | Same `reg_id`, keys and HoldAuth rules |
| Settling an open hold | Operator of generation g | Old grants stop counting | Settled by a successor METERING grant or the new owner. Revenue goes to the business's `available`, now controlled by the buyer (disclosed). If nobody settles, anyone can release after `settle_until`. |
| Seller's profit payout in flight | Pending, out of `available` | Not counted toward the floor | Success: `held` falls. Failure: becomes the seller's claim. Missing callback: stays pending and visible; the seller's record can't be released. |
| Escrow | `escrow_total` | Becomes the seller's claim | Collected with `claim_party` (subject to 003e1's party payout cap) |
| Buyer | Funds and can unfund until `CLOSING` | — | Owner; withdrawals subject to `min_reserve` |
| Former owner | — | Revoked in the same receipt | `E_NOT_OWNER` on every owner method; old operator grants fail the generation check |

---

## 5. Adversarial test matrix (keyless unit tests)

P = 50,000, plan max hold 10. "Both" means the test runs in `Direct` and in `Gated` (closer = `closer.test`, acting by hand, which models no runtime). Every success is checked by the 003e harness plus D1–D8. Every refusal asserts the error code and an unchanged state snapshot.

| # | Scenario | Mode | Expected |
|---|---|---|---|
| G1 | **100/20/80 across an actual close.** Buy 100 (key slot 0); h1 and h2 each 10 used and closed. Propose (price 20M, floor 0.5M, grants [meter2: METERING]); buyer funds; both accept (and `close_sale` in Gated). Then meter2 opens h3 with the customer's **unchanged key**, settles 4 and closes. | Both | At close: `free 80, consumed 20, purchased 100`, owner = buyer, generation 2, `party[founder].claim = 20M`, escrow 0. After: `consumed 24, free 76`; the founder's old operator gets `E_NOT_OPERATOR`; the founder gets `E_NOT_OWNER` for withdraw, plan, manifest and appoint |
| G2 | Hold h3 opened at gen 1 by the old operator, still open across the close | Both | The old operator's `settle_hold` gets `E_NOT_OPERATOR`; meter2 settles h3; or, with no successor, a stranger releases after `settle_until` and the units return to free |
| G3 | **Failed seller payout.** Founder withdraws 0.3M before any acceptance; close; callback fails | Both | `party[founder].claim += 0.3M`; `available` unchanged; `release_party_slot` refused (`E_CLAIM`) until claimed |
| G4 | **Missing callback.** As G3, but the callback never runs; 40 days pass | Both | The payout stays in flight and listed; `pending_total` unchanged; the founder can't release; the buyer's `available` is unaffected; I1′ holds |
| G5 | **Buyer withdrawal.** Fund → unfund (`ACCEPTING`) → claim → callback success; re-fund; accept. In `CLOSING`: unfund gets `E_CLOSING`. A second funding while funded is returned in full | Both | Escrow → claim → paid; buyer acceptance cleared on unfund; the duplicate funding returns the amount with state unchanged |
| G6 | Funding with the wrong price, version, seq, sender, or after expiry | Both | Full amount returned; state unchanged |
| G7 | **Stale or replayed acceptance.** Accept v1; seller revises to v2; buyer re-sends the v1 accept | Both | `E_VERSION` / `E_TERMS`; acceptances cleared after the revision |
| G8 | **Replayed close.** `close_sale` twice; an order for an older version, wrong `closing_control_seq`, wrong digest or wrong manifest; `issued_at = now + 1`; `issued_at = now − 20 min − 1`; `issued_at < closing_started`; after the deadline; from a non-closer; in Direct mode | Gated | Second call `E_NO_DEAL`; then `E_VERSION`, `E_CLOSE_SEQ`, `E_TERMS`, `E_MANIFEST`, `E_ISSUED_FUTURE`, `E_ISSUE_AGE`, `E_ISSUED_BEFORE`, `E_DEADLINE`, `E_NOT_CLOSER`, `E_MODE` |
| G9 | **Abort.** `CLOSING` reaches the deadline; abort; a late `close_sale` | Gated | `ABORTED`; escrow → buyer claim; outcome recorded; the late close gets `E_NO_DEAL`; the seller's administration is available again |
| G10 | **Away and back.** Founder → buyer (gen 2); buyer proposes to the founder; close (gen 3) | Both | The founder owns at gen 3; the gen-1 operator stays dead even if listed; deal-1 accept or close replays get `E_NO_DEAL`; outcomes 1 and 2 are both in the ring; claims stay with their fixed beneficiaries |
| G11 | **Customer effects on the floor.** During `ACCEPTING`/`CLOSING`: purchases, refund 70, open and settle holds, release, re-register | Both | `available` never decreases; floor checks pass; D5 holds; acceptances stay valid (customers aren't in the digest) |
| G12 | **Seller drains before accepting.** Withdraw so `available < floor`; then accept | Both | `E_FLOOR` |
| G13 | **Seller withdraws after accepting.** Withdraw to exactly the floor (allowed); then 1 more | Both | First allowed; second `E_FLOOR`; in `CLOSING`, `E_CLOSING` |
| G14 | Administration while a deal is live: create plan, appoint, revoke, `set_manifest` | Both | `E_DEAL_PENDING`; digest unchanged |
| G15 | **Manifest binding.** `set_manifest` before proposing, then propose; and a manifest value changed by a direct state write in the test (to model tampering) before close | Both | The digest includes the manifest pointer; tampering gives `E_TERMS` / `E_MANIFEST` at close |
| G16 | **Re-registration during a deal.** Customer refunds all, unregisters and re-registers mid-deal | Both | New `reg_id`; the deal proceeds; old signatures `E_SIG` |
| G17 | **Storage exhaustion.** Propose with less than the measured cost of a missing buyer record; then a buyer who already has a record | Both | `E_STORAGE` (`should_panic`, rollback not modelled); with an existing record, propose needs no deposit; every later deal transition has delta 0 |
| G18 | 9 deals over time (cancel, expire and close mixed) | Both | Outcome ring wraps at 8 in place; storage delta 0 |
| G19 | **Direct-mode atomicity.** Buyer accepts last | Direct | One call: owner, generation, grants and claim all change, with no intermediate state |
| G20 | Accept with an expired offer, or after a generation change made through another deal | Both | `E_EXPIRED` / `E_GENERATION` |
| G21 | **Party records.** Buyer record created at propose with payer = founder; founder record reused when the founder buys the business back | Both | Measured charge once; no second charge; `release_party_slot` refunds the recorded payer |
| G22 | Random sequences (003e harness extended): deal operations interleaved with customer, payout and callback operations, 4 seeds × 400 steps, two close modes | Both | All invariants after every success; refusals don't mutate |
| G23 | **Mutants**, each expected to fail at least one test: (a) finalize credits escrow to `available`; (b) generation check missing in accept; (c) old operators kept at finalize; (d) withdrawal floor ignored during `ACCEPTING`; (e) `issued_at` future check removed | Both | Each mutant fails at least one of G1–G13 |

---

## 6. Sources and evidence labels

- **Pinned SDK behaviour** comes from 003e's compiled implementation note (`docs/design/BUSINESS_V3_CORE.md`, `near-sdk =5.29.1`): `ed25519_verify`, `storage_usage`, `flush`, `Promise::detach`, `is_promise_success`, the five-argument `testing_env!`. Not inferred from the latest docs.

**Network facts, from primary sources (fetched or checked 2026-11-02):**

| Fact | Source | How the design uses it |
|---|---|---|
| A failed receipt rolls back all its actions | https://docs.near.org/protocol/transactions/transaction-execution | `finalize` is all-or-nothing within the accepting or closing receipt |
| Promises run in later receipts; a callback runs but can fail on its own | https://docs.near.org/smart-contracts/anatomy/crosscontract, https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-failures | Deal methods create no promises; payouts keep 003e's handling |
| Function-call keys can't attach deposits | https://docs.near.org/protocol/accounts-contracts/access-keys#function-call-keys | `close_sale` is not payable |
| Block timestamp is an approximate UNIX time | https://docs.near.org/smart-contracts/anatomy/environment | All deadlines use it |
| A signed transaction stays valid for `transaction_validity_period` blocks (~14.4 h at 86,400) | https://docs.near.org/integrations/transaction-lifecycle | A signed accept or close can arrive late, so seq, version, generation and `issued_at` are checked |
| Storage price 10¹⁹ yocto/byte | https://docs.near.org/protocol/storage/storage-staking | Pre-allocation cost |

**Unmeasured:** the pre-allocated bytes (deal slot about 650 B, outcome ring about 1.7 KB, fixed operator slots), gas for `finalize` and `close_sale`, and on-chain storage cost.

**Inferred, and safe if wrong:** that block timestamps never decrease. This only matters for a future closer that derives `issued_at`; this slice doesn't depend on it.

**Trust, not enforced:** what the closer checks before calling `close_sale` (drain, artifacts, service actually served); off-chain revocation in `Direct` mode; that successor METERING accounts are the managed runtime's.

## 7. Scope, order and what must be integrated later

**Job name:** "003g Modeled sale and close in business-v3 (contract-only, keyless)."

**Order.** It starts after 003e1 lands, because it relies on 003e1's payout capacity, book categories and deposit corrections. Before writing code, its first step re-reads the then-current source.

**Allowed changes:** business-v3 source and tests, its design note, the job and report. Not allowed: v1 and v2 (they stay byte-identical, and their tests must still pass), scripts, config, server, web, deployment builds.

**Done when:**

- G1–G23 pass alongside 003e's and 003e1's tests, with v2 unchanged;
- clippy is clean;
- the report lists exact commands and results, and states the mode labels and limits from §2.

**Integration gates left open, each its own job:**

1. Sandbox with a real FT: escrow funding receipts, the physical-balance bound, and real callback and detached-refund behaviour.
2. Gas and storage measured on Wasm.
3. The runtime closer: freeze, drain, artifacts, journal, anchoring, attempt recovery — the addendum's design, still unaccepted.
4. A server v3 `Chain` client, with 003b's reconciler ordering observations by `control_seq`.
5. UI for terms, consent and mode labels.
6. Gateway and customer integration.
7. Any deployment, which needs Tony's explicit yes.

v2 and Juniper stay as they are, with no migration.

This proposal doesn't authorize any edit. It stops here for Astra's review.
