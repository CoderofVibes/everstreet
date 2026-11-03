# business-v3 sale core: corrected design (job 003g)

Claude, 2026-11-03. Authority: [003g](../astra/jobs/2026-11-03_003g_sale-core.md). It starts from
the reviewed candidate ([report](../astra/reports/2026-11-02_003g-sale-core-candidate.md)), which
is design history and is not accepted verbatim, and from the 003e1 source
([core note](BUSINESS_V3_CORE.md)).

This is contract-only and undeployed. It adds no runtime closer, chain client, UI, gateway, sandbox
or testnet. A unit-test close is not end-to-end or live acceptance.

## 1. What the slice does

- A seller (the current owner) proposes exact terms to one named buyer.
- The buyer funds escrow with the business's token. Escrow is a separate bucket.
- Both parties accept the same digest. Close moves ownership and operator authority to the buyer
  and the grants named in the terms, at the next generation.
- Customer units, keys, holds, claims and refund rights don't change at close.
- The price becomes the seller's **sale-proceeds claim**. Cancel, expire and abort return escrow
  as the buyer's **escrow-return claim**.
- No deal method sends a payout: beneficiaries collect later through the existing bounded
  `claim_party`.

There are two modes, fixed at `new` by `closer: Option<AccountId>`:

- **Direct** (`None`): the second matching acceptance closes in the same receipt.
- **Gated** (`Some(closer)`): the second acceptance enters `Closing`, and only `closer` may
  finalize, with an exact order, before a deadline. After the deadline, anyone may abort.

The contract enforces *who* may close and *what* they close. Drain, artifacts, journal and
off-chain service continuity are **not** proved by a synthetic closer.

`test_set_owner` is removed. Every ownership change in the tests goes through these methods.

## 2. Resolved corrections

### 2.1 Pinned beneficiary records

- A live deal pins the party records of its **seller** and **buyer**, and of the escrow's
  recorded funder (always the buyer: see 2.3). `release_party_slot` refuses a pinned record with
  `E_DEAL_PINNED`, in every live state (Proposed, Accepting, Closing), funded or not.
- `propose_sale` and a buyer-changing `revise_sale` create the buyer's record if it is missing.
  That is W1: measured growth, charged to the proposer, with excess refunded and
  `payer = proposer` and `deposit = cost` recorded. If the record already exists, the call needs
  only the intentional 1 yoctoNEAR.
- A revision that changes the buyer is allowed only with zero escrow (`E_FUNDED_BUYER`). The old
  buyer's record is then unpinned. A later `release_party_slot` by that account refunds its
  deposit to its recorded payer, never to the caller.
- Terminate and finalize look the records up with an explicit check. A missing pinned record
  aborts with `E_STATE`, which pins make unreachable; nothing is created on those paths. Once
  funded, cancel, expire, abort and finalize are rewrites of existing records: storage delta 0,
  measured in tests.
- The owner's record can't be released (`E_OWNER`, unchanged). After a close, the former owner
  holds the proceeds claim, so release is refused (`E_CLAIM`) until it is collected.

### 2.2 Economic categories

A party record holds three fixed claims:

| Index | Claim | Arises from |
|---|---|---|
| 0 | `profit` | A failed profit withdrawal, or a failed retry of one |
| 1 | `escrow_return` | Escrow returned to its buyer |
| 2 | `sale_proceeds` | The price credited to the seller at close |

**Payouts.** `claim_party(category)` collects exactly one category. Payout kinds:

| Kind | Category | Booked as |
|---|---|---|
| `PROFIT` | profit | `owner_withdrawals` |
| `PARTY_CLAIM` | profit | `owner_withdrawals` |
| `ESCROW_RETURN` (new) | escrow_return | `escrow_returned` (new) |
| `SALE_PROCEEDS` (new) | sale_proceeds | `sale_proceeds_paid` (new) |

**Failures.** A failed payout goes back to the **same category** of the **same beneficiary**. A
stranded re-send keeps its kind; it is detached, as in 003e1.

**Books.** Each category is booked only when money actually leaves. Escrow funding is booked as
`escrow_in` (new), never as `purchases_in`. Nothing about a sale touches `earned`,
`customer_returns` or `owner_withdrawals`. The `saturated` bit flags cover the three new counters
(bits 32, 64 and 128 of the existing `u8`). Period becomes 133 bytes and is pre-allocated, so it is
measured, not assumed.

**`paid_on_retry`** still counts profit and customer payouts paid through a claim, plus any
detached stranded re-send. Escrow returns and sale proceeds are always paid through a claim, so
they count there only when re-sent from Stranded.

**Owed versus paid.**

- Owed: party records (`get_party`: each claim by category) and `get_treasury.claims_total` and
  `escrow_total`.
- Paid: the period counters.
- In flight: `get_pending`, where each payout shows its kind.

### 2.3 Floor, expiry and revision

**The floor** (`available_floor` in the terms):

- Every acceptance, by either party, requires `available ≥ floor` (`E_FLOOR`). So does entering
  Closing (the same call), finalize and `close_sale`.
- From the seller's acceptance until the deal ends, `withdraw_profit(a)` requires
  `available − a ≥ max(floor, min_reserve)`.
- In Closing, every withdrawal is refused (`E_CLOSING`).
- With no seller acceptance yet, only `min_reserve` applies.
- If the buyer accepts first, the seller isn't committed to anything: the floor binds the seller
  only from their own acceptance, and is checked again at close.
- Customer activity never lowers `available`: purchases add to the customer buckets, settlement
  adds to `available`, and refunds, holds and releases move only customer buckets.

**Expiry.** `expires_at` is at least 60 s and at most 30 days ahead, with checked addition.
Funding at or after `expires_at` is returned in full. Accepting at or after `expires_at` is
refused (`E_EXPIRED`). `expire_sale` then lets anyone end the deal, returning escrow as the
buyer's claim.

**Revision** (seller; Proposed or Accepting only):

- It clears **both** acceptances and raises `version`.
- If escrow is held and the new price differs, the escrow is returned as the buyer's
  escrow-return claim in the same call. Nothing is stranded and nothing is re-matched.
- If the price is unchanged, escrow stays (it still equals the price), but the buyer must accept
  the new version.
- The buyer can't change while funded.

**Escrow ownership.** Escrow always goes back to `escrow_owner`, the account that funded it. It
equals the buyer by construction: only the buyer can fund, and the buyer can't change while
funded. Cancel, expire and abort can therefore never pay another account.

### 2.4 Exact sequencing

`control_seq` (u64) **rises by exactly 1 on each successful call that changes control state**:

- `create_plan`, `appoint_operator`, `revoke_operator`, `set_manifest`;
- `propose_sale`, `revise_sale`, funding (`ft_on_transfer` `fund_deal`), `unfund_deal`;
- `accept_sale`: one rise, whether it only records an acceptance, enters Closing, or finalizes in
  Direct mode;
- `cancel_sale`, `expire_sale`, `abort_close`, and `close_sale` (finalize).

Customer methods, metering, payouts and callbacks never change it.

**Entering Closing** records `closing_control_seq` as the value **after** that call's rise. Nothing
can raise `control_seq` while Closing, since all control methods are refused then. So `close_sale`
requires `order.closing_control_seq == deal.closing_control_seq == control_seq`.

**Counters checked before any mutation:** `generation` (u32), `deal_seq` (u64), `version` (u32),
`manifest_seq` (u64), `control_seq` (u64), and `escrow_total` and `held` additions. Deadline
additions are checked too (`now + window`, `now + 30 days`).

**Refusals in tests** are checked with the snapshot comparison, which detects any mutation before
the panic. In the unit VM a panic doesn't roll back. On chain the receipt does: underfunded W1
calls are `should_panic` tests only, as in 003e.

### 2.5 Measured storage

- `owner` becomes a `FixedAccount` in the root, so a close doesn't resize the root.
- `operators` becomes `[OperatorSlot; 8]`, each `{FixedAccount, caps, generation}`. Appointing
  fills a slot (W2) and needs the intentional ≥ 1 yoctoNEAR (excess refunded); revoking clears one.
  This replaces 003e1's charged `Vec` push, and the root stays one fixed size.
- `new` pre-allocates the deal slot (`LookupMap<u8, DealSlot>`, key 0, never removed) and an
  8-entry outcome ring.
- Deal accounts and grants are `FixedAccount`s, and the digest is a fixed 32 bytes. The close
  mode is a `u8` plus a `FixedAccount` closer.
- The only growth on a deal path is a missing buyer record (W1, measured and charged).
- Tests measure delta 0 for every deal transition and finalize, including with 64-character
  seller, buyer, grant and closer accounts and with operator replacement.

### 2.6 No authority bypass in success evidence

- The flagship 100/20/80 path, active-hold continuity, old-owner revocation and away-and-back all
  use `propose`, `fund`, `accept` (and `close_sale` in Gated mode).
- `test_set_owner` is deleted.
- Tests may still corrupt state directly (a removed record, a forced counter), but only where a
  fault must be injected, and each such case is labelled.

## 3. Terms, digest and close order

```text
DealTermsInput { buyer, price: U128, expires_at_ms: U64, close_window_ms: U64,
                 available_floor: U128, grants: Vec<(AccountId, u8)> (≤ 4, distinct,
                 caps ⊆ METERING|SUPPORT, ≥ 1 METERING in Gated), terms_hash: hex32 }

digest = sha256(borsh(("business-deal/v3", business, deal_seq, version, seller, buyer, asset,
          price, expires_at_ms, close_window_ms, available_floor, grants (account, caps) in
          order, terms_hash, expected_generation, service_manifest, manifest_seq, plan_count,
          min_reserve, close_mode, closer)))

CloseOrder { deal_seq, version, digest, expected_generation, closing_control_seq,
             manifest, manifest_seq, issued_at_ms }
```

**Buyer constraints:** not the owner, the business account, the asset or the closer.
`price > 0`.

**Close window:** Direct requires 0; Gated requires 10 minutes to 24 hours.

**`issued_at` in a close order:**

- not in the future (`E_ISSUED_FUTURE`);
- at most 20 minutes old (`E_ISSUE_AGE`);
- not before Closing started (`E_ISSUED_BEFORE`).

The close must also land before the deadline (`E_DEADLINE`). `close_sale` is not payable, so a
function-call key can sign it.

**Manifest pointer.** `set_manifest(hex32, expected_seq)` (owner, 1 yoctoNEAR, no live deal)
records a hash pointer. It is bound into the digest and checked again at close. A pointer is **not**
evidence that any artifact is available.

## 4. Methods and states

States: Proposed (no acceptance), Accepting (one acceptance recorded), Closing (Gated only).

| Method | Caller and deposit | Refusals (all before any change) | Effect |
|---|---|---|---|
| `propose_sale(terms)` | owner; ≥ 1 yocto, plus storage if the buyer record is missing | live deal; invalid terms; `deal_seq` or `control_seq` overflow | Pins records; Proposed; version 1 |
| `revise_sale(seq, terms)` | seller (owner, same generation) | not live; Closing; buyer change while funded; invalid terms | version + 1; acceptances cleared; escrow returned if the price changed |
| `fund_deal` (token message) | token; `sender == buyer` | any mismatch, expired, already funded or overflow: **amount returned** | escrow = price |
| `unfund_deal(seq)` | buyer; 1 yocto | Closing (`E_CLOSING`); nothing funded | Escrow → buyer's escrow-return claim; buyer acceptance cleared |
| `accept_sale(seq, version, digest)` | seller or buyer; 1 yocto | see §5 | Record; then Closing or finalize |
| `cancel_sale(seq)` | seller or buyer; 1 yocto | Closing | terminate(CANCELLED) |
| `expire_sale(seq)` | anyone | not yet expired; Closing | terminate(EXPIRED) |
| `close_sale(order)` | closer only; not payable | mode, caller, state and every order field | finalize |
| `abort_close(seq)` | anyone | not Closing; before the deadline | terminate(ABORTED) |

**While a deal is live, the owner may not:** `create_plan`, `appoint_operator`, `revoke_operator`
or `set_manifest` (`E_DEAL_PENDING`). Withdrawals follow §2.3.

**Always allowed:** customer methods, metering by current-generation operators, payouts,
callbacks and claims.

## 5. Acceptance and finalize

**`accept_sale` checks:**

- the deal is live, not Closing, and its seq and version match;
- `now < expires_at`;
- `generation == expected_generation` and `owner == seller`;
- the digest equals the live digest;
- `available ≥ floor`;
- for the buyer, `escrow == price`.

It then records the caller's acceptance. When both are present: Direct finalizes; Gated enters
Closing, with `deadline = now + window` checked and `generation + 1` checked in advance.

**finalize** (one receipt, rewrites only):

1. `escrow_total −= price`; `seller.claims[sale_proceeds] += price`; `claims_total += price`.
2. `owner = buyer`; `generation += 1`.
3. Every operator slot is cleared, then filled with the deal's grants at the new generation.
4. The outcome is written to the ring (`seq % 8`), the slot cleared and `control_seq` raised.

`held`, the customer buckets, `available` and pending payouts are unchanged.

**terminate** (cancel, expire, abort): escrow, if any, goes to the funder's escrow-return claim;
then the outcome, clearing the slot and raising `control_seq`.

## 6. Invariants checked after every successful test call

- **I1′:** `held = ent_free_value + ent_held_value + available + pending_total + claims_total +
  escrow_total`.
- **Claims:** `claims_total` = the sum of customer claims plus every party record's three claims.
- **D1:** `escrow_total == (live ? slot.escrow : 0)`; escrow is 0 or the price; `escrow_owner` is
  the buyer whenever it is non-zero.
- **D2:** every live deal's seller and buyer have party records.
- **D3:** generation changes only through finalize, by exactly 1.
- **D4:** while live, `plan_count`, the manifest and operators are unchanged.
- **D5:** with a seller acceptance, or in Closing, `available ≥ floor`.
- **D7:** `control_seq` changes exactly as in §2.4, by exactly 1 per successful control call.
- **S0, S1, P1–P4, U1, U2** as in 003e and 003e1.

## 7. Not in this slice (integration gates, each a later job)

- A real FT: escrow receipt order and physical balances.
- Gas and on-chain storage cost.
- Detached refund delivery and receipt rollback.
- The runtime closer: freeze, drain, artifacts, journal, recovery.
- A server v3 chain client and reconciler, and UI for terms and consent.
- Gateway and customer integration.
- Deployment, which needs Tony's explicit yes.

M3 stays open.
