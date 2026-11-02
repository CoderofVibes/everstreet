# Job 003a report: characterization of credit and close boundaries

Builder: Claude. Date: 2026-11-02. Job: `docs/astra/jobs/2026-11-02_003a_characterize-credit-and-close.md`.
Commit: `c825bf9` (tests only). No v2, server or OpenSeat behaviour changed; `lib.rs` is
untouched (new Rust tests are appended to `contracts/business-v2/src/tests.rs`). M3 remains
incomplete. Everything below is from unit tests and in-memory doubles: **none of it is testnet
evidence**, and no sandbox chain, wasm build, deployment, key or transaction was used.

## Commands and results (kept separate)

| Suite | Command | Result |
|---|---|---|
| Rust, business-v2 unit (VMContextBuilder) | WSL Ubuntu, from `/mnt/c/Dev/Everstreet/contracts`: `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v2 --lib` | **27 passed** (19 existing + 8 new), 0 failed |
| TypeScript (lint, types, vitest) | `npm run check` | **112 passed** (12 files; 3 new in `server/test/characterize-close.test.ts`), lint and types clean |

The Rust toolchain was already present; nothing was installed.

## What the tests establish

"Guaranteed" means the current code enforces it in the tested path; "gap" means a test
passes by demonstrating behaviour the digital 100/20/80 journey must not rely on.

| # | Behaviour | Test | Status |
|---|---|---|---|
| 1 | An owner or `fulfillment` operator charges any customer's credit with no customer signature, policy or cap; the owner can then withdraw it above the reserve. Everstreet grants every helper `support` + `fulfillment` | `gap_a_fulfillment_operator_spends_customer_credit_without_the_customer` | Gap |
| 2 | The same memo charges twice; the memo is only logged | `gap_the_same_memo_charges_credit_twice` | Gap |
| 3 | Two prepayments are two token transfers, both credited (not a replay of one transaction) | `two_prepayments_are_two_deposits_not_a_replay` | As designed; v2 has no purchase sequence, so a client retry that re-sends tokens is a second deposit |
| 4 | Between the buyer's acceptance and the seller's, the seller withdraws profit; the digest and the buyer's acceptance stay valid and the sale closes with less available | `gap_the_seller_can_withdraw_between_the_buyers_acceptance_and_their_own` | Gap (treasury not in digest, no floor at finalize) |
| 5 | The second matching acceptance finalizes in the same call: owner, generation, grants and status change together; no intermediate state | `the_second_matching_acceptance_closes_in_the_same_call` | Guaranteed |
| 6 | A balance read reserves nothing: the customer withdraws all credit, and a charge for usage served on the strength of the earlier read fails (`E_FUNDS`) | `gap_a_balance_read_reserves_nothing_against_a_customer_withdrawal` | Gap |
| 7 | Across a sale, every unit stays in one bucket (coverage) and the former owner is refused; the new owner can still charge the customer without consent | `coverage_holds_across_a_sale_but_consent_does_not` | Coverage and old-owner refusal: guaranteed. Consent: gap |
| 8 | A seller withdrawal whose transfer fails after the close is restored to `available`, which the buyer controls; the seller's proceeds are unchanged | `gap_a_failed_profit_payout_returns_to_the_buyer_after_the_close` | Gap (seller loses it; buyer may withdraw it) |
| 9 | A lost acceptance response: chain closed (generation 2), app still open with the seller as owner. Retrying the acceptance is refused by the contract ("not open") and does not reconcile; a later read of the deal does | TS: "a lost acceptance response leaves the chain closed…" | Characterized: retry refusal ≠ failure of the first attempt; reconciliation happens only on read |
| 10 | Two concurrent reads after a close both pass the "already closed?" check, then both settle: two `ownership` rows and two `business.sold` events | TS: "gap: two concurrent reads after a close both settle…" (chain read held by a gate) | Gap (check → await → transaction) |
| 11 | OpenSeat: an operator command whose authority was read before the close executes after it, recorded under the former owner and generation 1; a command checked after the close is refused | TS: "gap: a command checked before the close runs after it…" (authority double with a gate) | Gap (check-then-act; not instantaneous revocation) |

## Reading the M3 adversarial review critically

The review's code findings match these tests (1, 2, 4, 6, 8, 10, 11) and its "guaranteed"
rows match 5 and 7. Its proposed v3 design is input only; 003a's constraints take precedence,
and several of its claims need narrowing:

- **A customer policy caps charges; it does not prove delivery.** `max_per_day` and holds
  limit how much can be taken, not whether the use happened. Any design must say that delivery
  is attested by the operator (or a separate verifier), not proven by the contract.
- **Monetary credit is not purchased units.** A balance in tokens lets a new owner devalue
  "100 uses" by raising prices. The journey needs units of an identified product under an
  immutable plan (product, plan id, unit price, units bought), or an equivalent constraint.
- **A receipt hash proves commitment to recorded data, not service.** It shows what the
  business recorded and when; it says nothing about unrecorded acts or actual quality.
- **A chain read followed by an off-chain write is not atomic.** Tests 9–11 are all this
  shape. Polling cannot give instantaneous revocation; the honest guarantee is "refused once
  the close is observed", with a bounded, stated window.
- Its sequence-number idempotency must also detect a **replay with different amount or
  terms** and return a conflict, not "already done", and keep enough outcome state to answer.
- Hold expiry must not lead to **charging the same work twice**; holds need explicit settle
  and refund terminal states and a rule for late provider completion.

## Recommended bounded slices (none started)

1. **Reconciler, server only (small).** Make `Deals.settle` idempotent inside its
   transaction: `UPDATE deals SET status='closed' … WHERE id=? AND status <> 'closed'` and
   proceed only if one row changed; add a unique index on `ownership(deal_id)` (additive).
   Treat a lost acceptance response as "unknown": re-read the deal instead of reporting
   failure. *Tradeoff:* fixes duplicates (10) and the misleading retry (9) without touching the
   contract; still observed finality, not atomicity.
2. **Fenced commit for operator services (small–medium).** OpenSeat and the build worker keep
   a durable "last observed generation" per business, updated whenever any read sees a higher
   one; a command commits only inside a transaction that re-checks it against that record and
   against the generation it was authorized under. *Tradeoff:* narrows window 11 to "until the
   close is first observed by any path"; does not remove it. State the window in the UI.
3. **v2 honesty now (small).** Where v2 prepaid credit is shown, label it "spent by the
   business for work it reports; no per-use customer approval", and stop granting helpers
   `fulfillment` by default (a server change, not a contract one). *Tradeoff:* truthful today;
   does not create the flagship guarantees.
4. **v3 contract, new crate and new account (large; design review first).** Units bound to
   product and immutable plan; customer-authorized holds with settle/refund terminal states and
   idempotent settlement keyed by (customer, sequence) with a fingerprint (conflict on
   mismatch); treasury floor (available ≥ a disclosed amount) in the digest and enforced at
   finalize; seller payouts that cannot be redirected by a post-close failure; successor
   grants explicit and digest-bound; bounded per-customer state with funded storage and
   registration limits; no unbounded historical-deal scans at finalize. v2 and the Juniper
   deployment stay as they are. *Tradeoff:* the only path to the 100/20/80 guarantees; needs
   its own test plan and a separately authorized testnet run.

## Limitations

- Unit tests and doubles only; the FakeChain mirrors v2's sale logic but is not the contract.
- Timing windows are forced with gates; real windows depend on RPC finality and polling.
- No formatter was run on the Rust test file (only the authorized test command was used).
