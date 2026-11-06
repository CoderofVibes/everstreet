# Attack review: business-v3 (`contracts/business-v3/src/lib.rs`)

Reviewer: Claude (Fable 5.1), 2026-11-06. Brief: `reports/2026-11-06_attack-review-brief.md`.
Read: `lib.rs` (3134 lines), `BUSINESS_V3_CORE.md`, `BUSINESS_V3_SALE.md`, `AUTHORITY.md`,
`Cargo.toml`, and near-sdk 5.29.1 source for `is_promise_success`, `testing_env!`, the
`#[private]` wrapper and the `ext` builder's gas weight. Nothing else. The repository was not
edited.

Proof tests: `<scratch>/contracts/business-v3/src/attack_tests.rs`, built with
`cargo test -p business-v3 --lib attack_tests` in WSL (`CARGO_TARGET_DIR=$HOME/everstreet-attack-target`).
In my copy of `lib.rs` the single line `mod tests;` was replaced by `mod attack_tests;` so the
repository's own tests are neither read nor compiled. A `should_panic` test that passes means
the contract **refused** the attack; a plain test that passes asserts exactly what the attack
achieved (or did not).

Findings are appended one at a time, in the order they were found.

---

## Findings

### 1. Former owner, as storage sponsor, deletes customers' unbought shells after the sale

- **Severity**: Low (hardening; no money moves wrongly, but a power survives the sale)
- **Role**: Former owner (or any shell sponsor)
- **Steps**:
  1. Owner A calls `sponsor_shell(customer, plan)` for sign-ups (the normal way a business
     onboards customers); the customer has not bought yet.
  2. A sells the business to B (`propose_sale`, buyer funds, both `accept_sale`; owner is B,
     generation 2).
  3. A calls `unregister(customer, plan)` with 1 yoctoNEAR.
- **What should happen**: after the sale A has no power over the business or its customers
  (promise 3).
- **What happens**: the shell is deleted and A receives the storage deposit. The customer's
  prepared purchase (`ft_transfer_call` naming that `reg_id`) is returned whole with
  "registration changed". B cannot prevent it and has no view that lists sponsored shells.
  The same ability lets any sponsor race a customer's first purchase (test
  `sponsor_yanks_shell_under_an_in_flight_purchase`): the purchase comes back, no funds are lost.
- **Proof**: `finding_former_owner_sponsor_deletes_customer_shell_after_sale` and
  `sponsor_yanks_shell_under_an_in_flight_purchase` in `attack_tests.rs`: passed (the deletion
  succeeds; the purchase is returned).
- **Location**: `unregister`, lib.rs 1581-1597; the rule is line 1586
  (`e.storage_payer.is(&caller) && e.purchased == 0 && !e.ever_keyed`).
- **Suggested change**: let a sponsor reclaim only while it is still the owner or a
  current-generation operator, or only after an idle period; or make the deposit transferable to
  the customer so an unbought shell has nothing for a former sponsor to take.

### 2. A customer's key install locks the sponsor's storage deposit for good

- **Severity**: Low
- **Role**: Customer (Sybil sign-ups against a business that sponsors shells)
- **Steps**:
  1. The business sponsors a shell for `cust` (cost (811 + len) bytes, about 0.0085 NEAR).
  2. `cust` calls `install_key(plan, 0, pk, 1, 1)` with 1 yoctoNEAR and never buys.
  3. The sponsor calls `unregister(cust, plan)`.
- **What should happen**: a shell with nothing in it should be reclaimable by whoever paid.
- **What happens**: `E_NOT_CUSTOMER`. `ever_keyed` makes the shell the customer's alone; only
  the customer can ever unregister it, and the customer has no reason to. Each Sybil account
  costs the attacker 1 yoctoNEAR plus gas and costs the business about 0.0085 NEAR, permanently.
- **Proof**: `finding_customer_key_locks_sponsor_deposit`: passed (reclaim refused).
- **Location**: `install_key` lib.rs 1490-1509 (`e.ever_keyed = true`, line 1506) with
  `unregister` line 1586.
- **Suggested change**: a key on a shell that never bought should not block the sponsor
  (`ever_keyed` matters only once `purchased > 0`), or document the sponsoring policy as
  "sponsor only after payment".

### 3. Eight accounts fill every payout slot: owner withdrawals, party claims and other customers' refunds stall

- **Severity**: Low (transient denial; clears as callbacks land, about one block each)
- **Role**: Customer (Sybil), or one customer across 8 plans
- **Steps**:
  1. 8 accounts each sponsor a shell and buy 2 units (200 tokens each, refundable).
  2. Each calls `refund_units(plan, 1)` twice (the per-entitlement cap is 2, line 1784).
  3. Owner calls `withdraw_profit`; another customer calls `refund_units`; the former owner calls
     `claim_party(2)` for sale proceeds.
- **What should happen**: party payouts are capped so slots stay free for customers; the design
  note says at least 12 of 16 slots are always open to customers.
- **What happens**: all 16 slots are in flight and every payout, customer or party, gets
  `E_BUSY`. The party cap keeps parties from crowding customers, but nothing keeps customers
  (collectively) from crowding everyone. The attacker's money comes back, so the attack costs
  only gas and can be repeated every block.
- **Proof**: `finding_sybil_customers_fill_every_payout_slot`: passed (owner and honest
  customer refused; one callback frees one slot and the honest refund then goes through).
- **Location**: `free_slot` 2988-2992, `party_slot` 2995-3009, `refund_units` 1784.
- **Suggested change**: reserve a few slots for party payouts (mirror of the existing party cap)
  or raise `PAYOUT_SLOTS`; the design already calls this an integration gate.

### 4. `new` accepts the business account as its own closer, or as its owner

- **Severity**: Low (hardening; deployment-time only)
- **Role**: Deployer mistake, or a founder who wants a Gated business that can never close
- **Steps**: `new(name, owner, asset, rules, Some(<business account>))` or
  `new(name, <business account>, asset, rules, None)`.
- **What should happen**: refused, as `closer == owner` and `closer == asset` are.
- **What happens**: accepted. The business account keeps no keys, so a closer equal to it can
  never call `close_sale`: every Gated sale ends in `abort_close`, with the buyer's escrow locked
  for the close window first. An owner equal to the business can never act at all.
- **Proof**: `note_new_accepts_the_business_as_its_own_closer`: passed (both constructions
  accepted).
- **Location**: `new`, lib.rs 1229-1231.
- **Suggested change**: also require `owner`, `asset` and `closer` to differ from
  `env::current_account_id()`.

### 5. Uses signed after a key is revoked still settle until the grace deadline

- **Severity**: Note (documented in the code; worth stating to customers)
- **Role**: Operator holding a leaked customer key
- **Steps**: hold open; customer `revoke_key`; operator submits a use signed after the
  revocation, before `settle_until_ms`.
- **What happens**: `"charged"`. The contract cannot tell when a use was signed; revocation only
  stops serving (`serve_until = min(serve_until, now)`). Exposure is bounded by the hold's
  units (at most 10) and the grace (at most 1 h).
- **Proof**: `note_operator_settles_uses_signed_after_revocation_within_grace`: passed.
- **Location**: `revoke_slot` 1551-1558; `settle_hold` 1702 checks only `settle_until_ms`.

### 6. No customer can open a hold while a Gated sale is closing (up to 24 h)

- **Severity**: Note (agreed in the terms; a customer-visible effect of a sale)
- **Role**: Seller and a colluding buyer, or just an absent closer
- **Steps**: Gated business; both accept with `close_window_ms` = 24 h; the closer does nothing.
- **What happens**: every `open_hold` is `E_CLOSING` for the window; refunds and settlement of
  existing holds still work. Promise 4 says a sale changes nothing about holds; new holds are the
  exception, by design (MANAGED_HANDOVER 16.1 per the code comment).
- **Proof**: `note_no_new_holds_while_closing`: passed (hold refused, refund accepted).
- **Location**: `open_hold` 1637-1638.

### 7. A Gated close may land after the offer's `expires_at`

- **Severity**: Note
- **Role**: Closer
- **Steps**: both accept a minute before `expires_at`; the closer finalizes hours later, inside
  the close window.
- **What happens**: closes. `close_sale` checks the close deadline, not the offer expiry. Both
  parties accepted, so this is consistent, but a client that shows "offer expired" would be wrong.
- **Proof**: `note_gated_close_lands_after_offer_expiry`: passed.
- **Location**: `close_sale` 2231-2268 (no `expires_at_ms` check).

### 8. A callback that runs out of gas leaves a payout in flight forever

- **Severity**: Note (not reproducible in the unit host; needs a gas measurement in sandbox)
- **Role**: The network
- **Steps**: any payout; `on_payout` fails for a reason other than the transfer's outcome (out
  of gas, or a panic inside it).
- **What should happen**: promise 8: a failed payout becomes a claim.
- **What happens**: the slot stays `SLOT_IN_FLIGHT`, the amount stays in `pending_total`, the
  beneficiary's `pending_refs` stays raised, and no method can ever resolve it (`claim_stranded`
  needs `SLOT_STRANDED`). If the token transfer had succeeded, `held` also overstates the real
  balance. `CALLBACK_GAS` is a static 10 TGas; the generated `ext` call keeps the default unused
  gas weight of 1, so in practice the callback also receives the caller's unused gas, which makes
  this unlikely when callers attach normal gas. `on_payout` itself never allocates and has no
  input-dependent loops, so a panic inside it needs a broken invariant.
- **Proof**: none possible in the unit host (gas is not metered). Reasoned from lib.rs 126-127,
  `transfer` 3048-3057, `on_payout` 1885-1943 and near-sdk-macros `ext.rs` (default
  `GasWeight`).
- **Suggested change**: measure `on_payout` in the sandbox and set `CALLBACK_GAS` with margin
  (20-30 TGas); consider a "mark stranded after N days" path for a slot whose callback never ran,
  since the design already lists missing callbacks as a reconciliation gate.

### 9. `#[private]` is enforced only in the wasm export wrapper

- **Severity**: Note
- **Role**: Outsider calling `on_payout`
- **What happens**: on chain, near-sdk's generated wrapper panics "Method on_payout is private"
  before the body runs; the Rust method itself has no check, so unit tests cannot exercise the
  refusal, and a test that calls `on_payout` directly proves nothing about who may call it.
  Verified by reading `near-sdk-macros-5.29.1/src/core_impl/code_generator/impl_item_method_info.rs`.
- **Location**: `on_payout` 1884.

### 10. The seller may name itself as a successor operator

- **Severity**: Note (consent is in the digest; the risk is in the client, not the contract)
- **Role**: Seller
- **Steps**: `propose_sale` with `grants = [(seller, METERING)]`; buyer funds and accepts; seller
  accepts.
- **What happens**: closes; the former owner holds METERING at generation 2 and opens holds on
  the buyer's customers. A digest computed without that grant is refused (`E_TERMS`), so the buyer
  cannot accept it unknowingly at the contract level; a wallet that shows only price and buyer
  would let them.
- **Proof**: `note_seller_names_itself_as_successor_operator`: passed.
- **Location**: `validate_terms` 2709-2715 (no restriction on who a grant names), `finalize`
  2823-2825.

### 11. After a second sale, releasing the middle owner's record refunds the first seller

- **Severity**: Note (by design, BUSINESS_V3_SALE.md 2.1: "never to the caller")
- **Role**: Former owner B after A -> B -> C
- **Steps**: B collects proceeds, then `release_party_slot`.
- **What happens**: B's record (created by A's `propose_sale`, `payer = A`) is deleted and its
  deposit is sent to A, not B. Nobody loses what they paid; B simply never paid.
- **Proof**: `note_second_sale_record_release_refunds_the_original_payer`: passed.
- **Location**: `release_party_slot` 1977-1979, `ensure_party` 2788-2793.

---

## Tried and refused

One line each: the attack, then the function and error that stops it. Every line is a passing
test in `attack_tests.rs` / `attack_tests2.rs` (92 tests, 0 failures).

**Buyer**
- Accept without funding: `accept_sale` `E_UNFUNDED`.
- Fund less than the price, a wrong price in the message, from another account, a second time, or after expiry: `fund_deal` returns the whole amount, nothing changes.
- Fund or buy through a contract other than the configured token: `ft_on_transfer` `E_ASSET`.
- Unfund, cancel or revise after the close; collect an escrow-return claim after the close: `live_deal` `E_NO_DEAL`; `claim` `E_FUNDS`.
- Accept the old version or the old digest after a revision: `accept_sale` `E_VERSION` / `E_TERMS`.
- Accept as a third party: `accept_sale` `E_NOT_PARTY`. Revise as the buyer: `require_owner` `E_NOT_OWNER`.
- Release the buyer record during the deal, with escrow owed, or with a payout in flight: `release_party_slot` `E_DEAL_PINNED` / `E_CLAIM` / `E_PENDING_REFS`.
- Be the closer or the seller: `validate_terms` `E_ARGS`.

**Seller**
- Withdraw below the floor after own acceptance: `withdraw_profit` `E_FLOOR`.
- Drain `available` while only the buyer has accepted, then accept to close: `accept_sale` `E_FLOOR`; escrow stays the buyer's.
- Withdraw customer money or escrow: `withdraw_profit` `E_RESERVED` (`available` is the only source).
- Open a hold with a forged signature, as owner: `open_hold` `E_SIG`.
- Appoint, revoke, create a plan or set the manifest during a live deal: `require_no_deal` `E_DEAL_PENDING`.
- Point funded escrow at another buyer: `revise` `E_FUNDED_BUYER`.
- Lower the price to close on the buyer's standing acceptance: `revise` returns the escrow to the buyer's claim and clears both acceptances.
- Revise at the same price: escrow stays, the buyer's acceptance is cleared, the buyer can still `unfund_deal`.
- Cancel after funding: `terminate` credits the buyer, the seller gets nothing.
- Withdraw, revise or cancel while a Gated sale is closing: `E_CLOSING`.
- Close a Gated sale without the closer: `close_sale` `E_NOT_CLOSER`.
- Direct terms with a close window; Gated terms without a METERING grant: `validate_terms` `E_ARGS`.

**Former owner and operator**
- Withdraw, appoint, revoke, propose, set manifest after the sale: `require_owner` `E_NOT_OWNER`.
- Open or settle a hold after the sale (owner or generation-1 operator): `require_metering` `E_NOT_OPERATOR`; the successor grant works with the same customer signature.
- Collect a profit claim with nothing owed: `claim` `E_FUNDS`; the proceeds claim pays exactly once.
- A withdrawal in flight at the close that then fails: `unref` credits the former owner, not the buyer; `available` stays the buyer's.
- After A -> B -> C, both A and B: `require_owner` `E_NOT_OWNER`; A's proceeds claim is untouched by the second sale.

**Operator**
- Withdraw or appoint: `require_owner` `E_NOT_OWNER`.
- Refund or install a key on a customer's record: `own_entitlement` `E_NOT_CUSTOMER`.
- Meter with SUPPORT only: `require_metering` `E_NOT_OPERATOR`.
- Inflate the signed units, move a use to another slot, submit A's HoldAuth for B: `ed25519_verify` `E_SIG`.
- Replay a closed HoldAuth: `open_hold` `E_HOLD_SEQ_USED`; after `skip_hold_seq`: `E_HOLD_SEQ`.
- Two fingerprints in one slot: `settle_hold` `E_CONFLICT`; a slot outside the hold: `E_SLOT`; the same use twice: `"already"`, charged once.
- Use a revoked key's epoch: `open_hold` `E_KEY`. Exceed a key's daily cap: `E_DAILY_CAP`.
- Hold past the plan TTL: `E_TTL`; ending in under 60 s: `E_EXPIRED`. Settle after the grace deadline: `E_EXPIRED`.
- Release for another registration: `release_hold_for` `E_REGISTRATION`. Hold on a paused customer: `E_PAUSED`.
- Release early: allowed, and the uncharged units go back to the customer (not to `available`).

**Customer**
- Refund twice or claim twice: `refund_units` `E_UNITS`, `claim_customer` `E_FUNDS`; a replayed or foreign callback is `payout_mismatch` with no change.
- A third payout in flight: `E_PENDING_REFS`. Unregister with a refund in flight: `E_PENDING_REFS`.
- Install a small-order key: `use_key` `E_KEY_INVALID`; through a purchase: the purchase is returned.
- Wrong amount, wrong sequence, over the cap, or a replayed purchase: `validate_buy` returns the amount.

**Outsider**
- Deliver tokens: `E_ASSET`. Release a hold before its deadline: `E_NOT_OPERATOR` (after it: allowed, units return to the customer).
- Expire a live offer or abort a close before its deadline: `E_NOT_EXPIRED`.
- Close a Gated sale: `E_NOT_CLOSER`. Replay an old order on a new deal: `E_NO_DEAL`; an old digest or closing sequence in a new order: `E_TERMS` / `E_CLOSE_SEQ`; issued before closing: `E_ISSUED_BEFORE`; older than 20 min: `E_ISSUE_AGE`.
- Unregister another's shell: `E_NOT_CUSTOMER`. Re-send a payout that is not stranded: `claim_stranded` `E_STATE`.
- Owner releases its own record: `E_OWNER`.
- Call `on_payout`: refused on chain by the `#[private]` wrapper (finding 9; not testable here).

**The network**
- Every payout kind failing (refund, profit, escrow return, sale proceeds): becomes the right record's claim in the right category (`unref`, `claim_category`); `pending_total` returns to 0 and I1' holds.
- Buyer unfunds in the same block before the seller's acceptance: the seller's acceptance records, it does not close. Seller's acceptance lands first: closed; the later unfund is `E_NO_DEAL`.
- A third owner payout in flight: `party_slot` `E_PARTY_CAP`.
- The entitlement record is byte-for-byte unchanged by a close (view compared before and after), and the hold's existing signatures settle under the successor operator.
- I1' (`held` = sum of the six buckets) holds after a full life cycle: purchase, holds, settlement, withdrawal, funding, close.

**Not reachable without corrupting state** (so not tried): a stranded slot (`SLOT_STRANDED`), a record deleted while a payout references it, `pending_refs_underflow`.

**Not covered by this review**: gas (finding 8), the real token's receipt order and balances, on-chain storage cost, the wasm export wrapper, and the deployment (keys on the account).

---

## Summary

| Severity | Count | Findings |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 0 | |
| Low | 4 | 1 (former sponsor deletes unbought shells after the sale), 2 (a key install locks the sponsor's deposit), 3 (Sybil customers fill all 16 payout slots), 4 (`new` accepts the business as closer or owner) |
| Note | 7 | 5, 6, 7, 8 (callback gas), 9, 10, 11 |

Every promise in the brief held against every attack tried: escrow only ever moved to the
seller through a close both parties accepted, or back to the buyer; the price was paid as a
claim exactly once; the former owner and operators were refused everywhere that matters;
customer records were untouched by a sale and their signatures kept working under the successor;
no unit was charged without a valid customer signature; the owner never reached customer money or
escrow; every failed payout became the right claim. The money accounting (one invariant, checked
arithmetic, no division) gave nothing.

**The one change first**: tighten the sponsor rule in `unregister` (lib.rs 1586) so a sponsor can
reclaim an unbought shell only while it is the current owner or a current-generation operator,
and regardless of whether the customer installed a key. That removes the one power that survives
a sale (finding 1), stops the Sybil deposit lock (finding 2), and is a one-line condition with no
storage change. Right after it, measure `on_payout` in the sandbox and give `CALLBACK_GAS` a
margin (finding 8): it is the only path I found where money could stay stuck with no method to
free it.


---

## Status (builder, Nov 6)

Each finding was checked against the contract before any change. Findings 1–4 are fixed in
`contracts/business-v3/src/lib.rs`, with the rules recorded in `docs/design/BUSINESS_V3_CORE.md`:
- 1 and 2: `unregister` lets the customer, or for an unbought shell someone else paid for, the
  current owner or a current-generation METERING operator; the deposit still goes to the payer.
- 3: customer payouts are capped at 14 of the 16 slots (`customer_slot`).
- 4: `new` refuses the business's own account as owner, token or closer.

Notes 7 and 10 changed the sale pages (no expiry warning while closing; a seller kept as operator
is marked). Note 8 (callback gas) is the next check, on a local sandbox. The other notes are
design facts, listed as open in `docs/SAFETY_CASE.md`.

The proof tests now live in the repository as `contracts/business-v3/src/attack_tests.rs` and
`attack_tests2.rs`. The five that proved findings 1–4 are turned around to show the fix (marked
FIXED); `tests.rs` adds `ar1`–`ar4`. The contract suite passes: 195 tests.
