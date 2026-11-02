# Adversarial follow-up to the M3 review: v2 credit, sale-close and revocation assumptions

Read-only review for Astra, 2026-11-02. No edits, commands, transactions or agents. I read `docs/astra/2026-11-02_FoundationReview.md`, `contracts/business-v2/src/{lib.rs,tests.rs}`, the names of the tests in `contracts/business-v2/tests/sandbox.rs`, `server/src/{deals.ts,payments.ts,chain.ts}`, and `services/openseat/src/{service.ts,worker.ts,authority.ts,command.ts}`.

**Labels used below.** **[V]** means I verified it in the code at the cited line. **[P]** means it is a proposal. Nothing here has been run.

**I'm withdrawing my earlier conclusion.** v2 cannot honestly carry the 100-use, 20-used, 80-retained journey. The contract lets the business take money from customers' credit without their consent, has no way to stop a usage charge being applied twice, does not protect the treasury between the two acceptances, and has a race between customer withdrawals and usage. A v3 contract is required for the flagship journey. v2 businesses should keep only orders and plain prepaid credit, labelled as trusting the operator.

---

## 1. What v2 guarantees, and where it falls short

| Question | v2 behaviour [V] | Verdict |
|---|---|---|
| Can the owner or a `fulfillment` operator spend another customer's prepaid credit without that customer authorizing it? | `use_credit(customer, amount, memo)` (`lib.rs:385-401`) checks only the 1-yocto deposit, the caller's owner-or-`fulfillment` status (`:389`, via `:709-714` → `operator_check` `:643-655`) and `amount ≤ credit` (`:390-391`). There is no customer signature, policy, cap or rate limit. The money moves to `available` (`:394`), and the owner can then withdraw it above the reserve (`withdraw_profit` `:405-416`). Everstreet appoints every helper with `["support","fulfillment"]` (`server/src/payments.ts:502`), so every helper can drain any customer. | **Yes. This is a gap.** |
| Can the same logical usage be charged twice? | `use_credit` has no idempotency key. The memo is only emitted in the event (`:399`), never stored or checked. Two signed transactions with the same memo both succeed. NEAR's nonce stops only a resend of the *same signed bytes*. A repeated prepay is not recognised either (`:307-314`); only orders are (`:286-289`). Nothing in `server/` calls `use_credit` today (the `Chain` interface `chain.ts:89-201` has no such call). | **Yes. This is a gap.** |
| Can either party change available funds or customer liabilities after both have accepted the digest? | No such window exists. The call that brings the second matching acceptance runs `finalize` in the same execution (`:576-578`). | **Guaranteed.** |
| …and between the first and the second acceptance? | `accept_sale` (`:558-581`) and the digest (`:766-782`) do not cover the treasury. If the buyer accepts first, the seller can still call `withdraw_profit` (`:405-416`), or charge customers' credit (`use_credit`) and then withdraw it, and only then accept. The buyer's acceptance stays valid because only a revision (`:549-550`) or the buyer pulling their hold (`:614`) clears it. "Buyer accepts last" is only an ordering in the UI: a seller transaction can still land between the buyer's last read and their acceptance. | **Gap. Displaying the treasury is not enforcing it.** |
| Are customer liabilities covered at close? | Credit, unearned orders, pending payouts, deal holds and proceeds are separate buckets that must add up to what the business holds, checked after every change (`:753-758`). The sandbox checks the token balance against these books (`sandbox.rs:84-87`). The *coverage* is enforced. The *amount* can be lowered by the business charging customers without consent (row 1). | **Coverage: yes. Consent: no.** |
| What happens to a payout that was in flight at close? | If the seller's `withdraw_profit` transfer fails after the close, `on_payout` puts the money back in `available` (`:464`), which the buyer now controls. | **Edge case. The seller loses it.** |
| Does a customer withdrawal race off-chain usage reservations? | `withdraw_credit` (`:372-383`) can take any credit. The contract knows nothing about off-chain reservations. If uses are served and then the credit is withdrawn, the later charge fails `E_FUNDS` (`:391`). A live balance check before serving cannot close this race, because the withdrawal can land between the check and the charge. | **Yes. This is a gap.** |
| Is the former owner revoked on the contract? | `finalize` changes the owner, increments the generation and removes every operator (`:793-801`). Every owner or operator method checks at execution time (`:703-714`), so refusal starts in the block of the closing acceptance (test `tests.rs:247-274`; testnet evidence for v2 sales in `DECISIONS.md:210-213`). | **Guaranteed and immediate.** |
| Do workers keep running across a sale? | All grants are removed (`:798-801`) and there is no retained operating plan (`DECISIONS.md:214-217`). The settlement or metering worker stops until the buyer appoints a new one. | **Gap.** |
| Is the former owner revoked off chain (OpenSeat)? | The command is checked first (`service.ts:456-458`, read at final finality `authority.ts:42`) and run later (`:471`). A command checked before the close can execute after it. The generation compare (`:465`) uses the same possibly stale read. The worker's `op_id` includes a fresh random id on every drain (`worker.ts:30`), so replays are stopped only by the job's own done flag (`service.ts:550`). | **Not immediate.** At best: refused after the close is observed as final, plus one action already in flight. |
| Does the platform record of ownership follow the chain everywhere? | `Deals.settle` runs only from `accept` or `view` of that deal (`deals.ts:574`, `:828`). It checks "already closed" (`:600`) before an `await` (`:601`) and only then opens the transaction (`:607`), so two concurrent calls can both settle. A browser refresh reconciles only that one deal row, not runtime leases, queued jobs or other sessions. | **Gap.** |
| Can Everstreet itself still sign for the former owner? | In the local preview, the server generates people's full-access keys and stores them (`chain.ts:343-355`, `payments.ts:105-110`, the `secret` column in `db.ts:88-92`). The contract still refuses the former owner's account, but "only the buyer can act" is only as strong as Everstreet's custody of those keys. | **Has to be disclosed.** |
| Does the business account have enough storage? | It is funded with 0.3 NEAR (`chain.ts:364`). Orders, credits, periods and deals grow without limit, and the payer never covers the storage. | **Gap.** v3 must keep per-customer state to a fixed size. |

---

## 2. Smallest coherent design that proves 100 / 20 / 80 [P]

### Contract: a new crate `contracts/business-v3`

v2 stays untouched. A v3 business would be a new keyless account in a later, explicitly planned deployment. Tony's existing demo is never touched.

**Per-customer record, fixed size** (no maps that grow per use):

```
Customer { credit, policy: Option<Policy>, hold: Option<Hold>,
           purchase_seq, hold_seq, refund_seq, spent_today, day }
Policy   { max_hold, max_per_day, hold_ttl_ms }      // set only by the customer
Hold     { seq, amount, opened_at_ms, expires_at_ms }
```

New bucket `usage_holds`. The invariant becomes:

`held = credit + usage_holds + unearned + available + pending + deal_holds + proceeds`

**Customer authorization**
- Through the token: `ft_transfer_call(…, {"prepay":{"seq":n,"policy":{…}}})`. The `sender_id` attested by the token contract is the customer.
- Directly: `set_policy(Option<Policy>)`, customer-only, 1 yocto. `None` stops new holds.
- With no policy in place, nothing can be charged.

**Paying once**
- A prepay with `seq ≠ purchase_seq + 1` is returned in full, the same way a duplicate order is today.

**Charging usage idempotently, keyed by sequence number**

| Method | Who | Effect |
|---|---|---|
| `open_hold(customer, seq, amount)` | Owner or `metering` operator | Requires a policy, no open hold, `seq = hold_seq + 1`, `amount ≤ max_hold`, `spent_today + amount ≤ max_per_day` and `amount ≤ credit`. Moves the amount from credit to the hold. If `seq` is at or below the last one used, it does nothing and reports "already". |
| `settle_hold(customer, seq, used, receipts_root)` | Owner or `metering` operator | Settles once only. `used ≤ amount`. The used part becomes `available`, `earned` and `credit_used`; the rest goes back to credit. `receipts_root` is a 32-byte hash. |
| `roll_hold(customer, seq, used, root, next_amount)` | Owner or `metering` operator | Settles and opens the next hold in one call, so service doesn't stall between holds. |
| `expire_hold(customer)` | Anyone, after `expires_at` | Returns the whole hold to credit. |

`use_credit` is removed.

**Refunds**
- Unused credit: `withdraw_credit` is unchanged, but it can only take credit that is not held.
- A failed use: simply leave it out of `used`.
- After settlement: `credit_back(customer, seq, amount)`, owner or `support`, moves money from `available` back to credit, deduplicated by `refund_seq`.

**The consumption/withdrawal race goes away**
- The gateway serves only against a hold it has seen confirmed on chain at final finality.
- A withdrawal and an `open_hold` are ordered on chain: if the withdrawal lands first, `open_hold` fails `E_FUNDS` and nothing is served; if the hold lands first, the withdrawal is limited to the rest of the credit.

**Customer data stays off chain**
- On chain there are only amounts, sequence numbers and the receipts root.
- The root covers salted per-use receipts that the gateway stores off chain. The customer can prove what was recorded for them.
- Documents, prompts, outputs and names never go on chain.
- Customer accounts and amounts *are* public, so offer customers a separate account per business.

**The sale**
- The deal adds `available_floor` and `operators_after: Vec<(AccountId, caps)>`, both covered by the digest.
- While a deal is open and funded, `withdraw_profit` cannot take `available` below the highest such floor.
- `finalize` requires `available ≥ floor`; otherwise the closing call fails with `E_TREASURY`.
- In the same execution, it installs `operators_after` under the new generation, so the metering worker carries over with no gap.
- If a seller's profit payout fails after a generation change, the money goes to that seller's claimable proceeds instead of `available`.

**The journey on v3**
1. The customer sends one transaction: prepay 100·P with `seq 1` and a policy of `{max_hold: 10·P, max_per_day: 50·P, ttl: 1h}`.
2. The gateway holds 10·P, serves 10 uses, rolls to the next hold, serves 10 more and settles. Now credit is 80·P and `credit_used` is 20·P.
3. The sale closes with the gateway operator in `operators_after`.
4. The gateway opens hold `seq 3` and keeps serving. At any point when no hold is open, the customer can withdraw exactly 80·P.

### Gateway (Everstreet server)

- **Customer access:** customer API keys are stored as hashes and keyed by business, product and customer, never by the owner. They don't change with the generation.
- **Serving:** reserve one use under the customer's `use_id`, which must be unique. Run the call through the job-002 runtime. If it succeeds, commit the use and add its receipt. If it fails, release the reservation. Serve only within a confirmed hold, and stop serving `margin` before the hold expires.
- **Signing:** the gateway's NEAR key belongs to the platform. It never goes to the sandbox, the browser or logs. Every hold or settle transaction goes through an outbox (sign, store, send), but because v3's sequence numbers make the calls idempotent, an unknown outcome is resolved by reading `get_customer` rather than by blind retries. This follows the FoundationReview rule (`:35`).

---

## 3. The strongest honest guarantees, and how to enforce them

**On the treasury at close (v3, enforced by the contract)**
- At close: `available ≥` the floor in the accepted digest.
- Every customer's credit, holds and unearned orders are backed one-for-one.
- No owner withdrawal goes below the floor while a funded deal is open.
- No customer is charged beyond the policy they authorized, either per hold or per day.

What the contract does **not** guarantee: that the uses charged were actually delivered. The owner can over-charge up to the customer's daily cap. The receipts root lets the customer prove off chain that they were over-charged; the contract does not judge it.

**On control revocation**
- **Contract:** immediate and enforced, from the closing block (`lib.rs:703-714`, `:793-801`). The guarantee is about the account. In the local preview it is limited by Everstreet holding people's keys.
- **Everstreet services:** not immediate, and not something polling can make immediate. The strongest honest claim is that the former owner is refused from the first commit after Everstreet observes the close as final, with at most one action in flight. It is enforced by:
  1. putting every action that moves money or authority on chain;
  2. for off-chain privileged actions (releases, configuration, queued jobs), checking the generation inside the commit transaction against a fresh chain read, and failing closed if the read errors or is stale beyond N seconds;
  3. when a close is observed, cancelling old-generation jobs and leases ("historical records transfer, execution instructions don't", FoundationReview `:36-37`);
  4. running a reconciler over every chain-backed business, at startup and on an interval, not only on deal views.

**On uninterrupted customer service**
- It holds only where serving never depends on the seller: the gateway operator carries over through `operators_after`, and the provider credential belongs to the business, or the buyer's credential was attached and verified before the close and is switched on by the reconciler.
- If the service runs on a credential the seller supplied, it either keeps using the seller's credential until the close is observed (which must be disclosed) or pauses. That must be called "paused", never "uninterrupted".
- Existing model API credit may fund bounded product work later. No new paid service is authorized.

---

## 4. Regression tests and implementation slices

**Evidence tiers:**
- **Keyless unit:** `cargo test` with `VMContextBuilder`, or server/OpenSeat tests against test doubles.
- **Local sandbox:** a near-workspaces local chain with a real FT, like `sandbox.rs`. It runs in WSL. This is a local chain, not a security sandbox.
- **Testnet:** needs a separately planned and authorized deployment. **No testnet evidence is proposed here.**

### S0: Characterise today's behaviour (keyless; test-only changes, the v2 wasm doesn't change)

New tests in `contracts/business-v2/src/tests.rs`:
- `fulfillment_helper_drains_any_customer_credit`
- `same_memo_charges_twice`
- `prepay_retry_credits_twice`
- `seller_withdraws_after_buyer_accepts_then_closes`
- `seller_charges_credit_between_acceptances`
- `withdrawal_after_serving_makes_use_credit_fail_E_FUNDS`
- `failed_profit_payout_after_close_lands_in_buyer_available`
- `former_owner_and_old_helper_use_credit_refused`

Elsewhere:
- OpenSeat: a test-double authority whose `operatorCheck` resolves and then calls `sell()` before `run`. The command executes, which proves the check-then-act gap.
- Server: two concurrent `Deals.view` calls after a close produce two `ownership` rows. An `accept` whose response was lost reports `E_STATE` even though the deal closed.

Acceptance: these tests pass and assert the *current* behaviour. The diff touches only test code.

### S1: v3 customer, policy and hold core (keyless unit tests)

- No policy means no hold.
- Caps per hold and per day are enforced.
- Replaying a `seq` does nothing; skipping a `seq` panics.
- Settlement happens once.
- `used ≤ amount`.
- Expiry returns the hold.
- `withdraw_credit` cannot touch held money, whichever of withdrawal or hold comes first.
- `credit_back` is deduplicated.
- The bucket invariant holds after every call.
- The full 100 → 20 → 80 sequence.

### S2: v3 sale (keyless unit tests)

- `E_TREASURY` when the floor is breached.
- A withdrawal blocked below the floor while a funded deal is open.
- `operators_after` installed in the new generation; old grants removed.
- A failed seller payout after the close goes to the seller's proceeds.
- The customer keeps 80·P and the open hold carries over.
- Former-owner calls panic.

### S3: v3 in the local sandbox

Real `ft_transfer_call` prepay with a policy, holds and settlement, a sale, and the token balance matching the books at every step. Also measure storage per customer and the business account's balance headroom.

### S4: Server chain boundary (keyless)

`Chain` and the test double gain the v3 calls. The outbox splits signing from sending. Unknown outcomes are resolved by sequence reads. The double matches the contract's rules (there are tests comparing them).

### S5: Gateway (keyless, with a deterministic provider double)

- 50 concurrent requests against 1 remaining use produce exactly one serve.
- A replayed `use_id` returns the first result.
- Uses are served only within a confirmed hold.
- No receipt data appears in contract arguments (assert on the arguments).

### S6: Authority reconciler and fencing (keyless; integrates with 002a's fenced attempts)

- A close performed in the test double with no one viewing the deal is reconciled.
- Old-generation jobs and leases are cancelled.
- A privileged action whose check happened before the close but whose commit comes after it is refused.
- RPC failure fails closed.
- The settle race (G5) and the lost-accept response are fixed.
- Credential model: business-held, seller-supplied, or pre-staged by the buyer, with a "paused" state.

### S7: Deal terms and the UI's claims

`everstreet-deal/2` carries the floor, `operators_after`, the outstanding holds and credit, and the credential handover. Each claim in the UI is labelled as enforced by the contract, enforced by Everstreet within the observation window, or disclosed only.

### S8: Deployment plan (a document only, nothing executed)

Publish the v3 global hash, create a new keyless business account, and run a bounded testnet script. It needs Tony's explicit yes and does not touch Juniper.

**Order:** S0 first; it is independent of 002a and costs nothing to keep. Then S1 → S2 → S3 for the contract, S4 → S5 for the server, and S6 alongside 002a. S7 and S8 come last.
