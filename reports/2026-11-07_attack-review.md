# Attack review: business-v3, asset-key, spend-allowance (November 7, 2026)

Cold review from the brief `reports/2026-11-07_attack-review-brief.md`, by a reviewer who read only the
three contracts (test-stripped copies), the two test doubles, the two design notes, `AUTHORITY.md`,
`feedRegistry.ts` and `evm.ts`. Proof tests live in the scratch copy, not in the repository:

- `<scratch>/attack/contracts/business-v3/src/attack_tests.rs` (39 tests)
- `<scratch>/attack/contracts/asset-key/src/attack_tests.rs` (9 tests)
- `<scratch>/attack/contracts/spend-allowance/src/attack_tests.rs` (12 tests)

Run from WSL in the scratch copy with
`CARGO_TARGET_DIR=$HOME/everstreet-attack-target cargo test -p <crate> --lib attack_tests`.
All 60 tests pass as written: a test named `*_finding_*` passes because the attack it performs
succeeds; every other test passes because the contract refuses the attack.

Severity scale (from the brief): Critical (money or control taken), High (a promise broken in a
reachable way), Medium (a promise weakened, or funds stuck), Low (hardening), Note (worth knowing).

Two things the unit host cannot show, checked in the near-sdk-macros 5.29.1 source instead:
`#[private]` ("Method X is private") and `#[init]` ("The contract has already been initialized")
are enforced by the generated extern wrappers, not by the Rust method bodies (snapshots
`private_method.snap`, `simple_init.snap`). Every callback in the three contracts carries
`#[private]`; every `new` carries `#[init]` without `ignore_state`.

## Findings

### 1. The owner can hand the external registry to any EVM address, and a seller can pre-sign that hand-over and race the buyer at the close

- **Severity**: High (borders Critical: control of the external asset is taken after the seller has been paid; it needs the seller to win a nonce race on the EVM chain, which the seller times).
- **Contract and role**: asset-key; Seller (the current owner, before the close).
- **Steps**:
  1. While still owner, the seller calls `request(SetController { to: <any 20-byte address, e.g. its own EOA>, from_generation: 1 }, tx { nonce: N })` for the gen-1 address's next nonce N, and again for N+1, N+2, ... Nothing binds `to` to a business address or `nonce` to the chain; each call is signed from path `gen-1`.
  2. The seller keeps the signed transactions off chain and accepts the sale second (Direct mode), or waits for `close_sale`.
  3. The moment the close lands, the seller broadcasts `setController(<EOA>)` at nonce N. The buyer's own `SetController { to: gen-2 address, from_generation: 1 }` is also at nonce N from the same address: whichever lands first wins, and the seller chose the moment. If the seller wins, the registry's controller is an address no generation of the business can ever sign for.
  4. The same stockpile works for `publish(<anything>)` from gen-1 at nonces N.. until the buyer's move lands.
- **What should happen**: promise 9: after a close the former owner can't move the external role, and the buyer can take it without the seller's help.
- **What happens**: the companion signs any `to` and any `nonce` for the current owner; a signature obtained before the close is a valid transaction after it. The buyer has no way to verify, before accepting, that no such signature exists (the companion's event log shows requests, but the seller can also request them in the same block as its acceptance).
- **Proof**: `k03_finding_owner_can_hand_the_registry_to_any_address_and_stockpile_nonces` (asset-key, passed: four `sign` requests for `to = 0xdede...` at nonces 5, 6, 7, 1000000, each from path gen-1, each payload the keccak of a transaction whose calldata names the attacker's address).
- **Location**: `asset-key/src/lib.rs` `on_control` 295-336 (`SetController` accepts any `to`; `tx.nonce` is caller-chosen), `request` 233-270 (no nonce discipline), `call_data` 116-120.
- **Fix suggested**: constrain `SetController.to` to a business-derived address: take `to_generation: u32` (≤ current generation + 1) instead of an address and, in the same promise chain as `get_control`, ask the signer's `derived_public_key(path_for(to_generation), <this account>)` view, then derive the address (`keccak(pubkey)[12..]`) inside the contract. Then the registry can never leave the business's own generation addresses; a stockpiled `publish` can still delay the buyer by one nonce race per signature, which a per-generation "one signature per nonce, nonces strictly increasing" rule in the companion would bound.

### 2. A payment, withdrawal or signature authorised by a stale `get_control` read lands after the close

- **Severity**: Medium (a promise weakened: "the old grant pays nothing" and "the former owner can't publish" hold only after a two-block window; the amount is bounded by the budget's caps for `pay`, and by the whole free budget for `withdraw`).
- **Contract and role**: spend-allowance and asset-key; Seller (as owner and/or as the budget's agent).
- **Steps** (spend-allowance): block N: the seller's agent calls `pay(supplier, amount, invoice)` (reserved) and the seller calls `withdraw(all available)`; block N+1: the business executes `get_control` (owner = seller, generation 1) and, later in the same block or the next, the close lands; block N+2: `on_pay` and `on_withdraw` run with the stale view and send the transfers. The buyer who checked the budget's balance at the close sees it leave afterwards. The same window lets asset-key's `on_control` sign for the former owner (`k04`).
- **What should happen**: once control has moved, nothing the former owner started should move money or sign.
- **What happens**: the authority check and the action are in different receipts; the callback has only the view it was handed and does not (cannot) re-check. The contracts are explicit about this ("at the moment of each call"), but the window is real and the seller controls the timing in Direct mode.
- **Proof**: `s06_finding_a_payment_started_before_the_close_lands_after_it` (spend-allowance, passed: the stale view pays the supplier and transfers 9,900 to the seller), `k04_finding_the_callback_trusts_the_view_it_is_handed` (asset-key, passed). A unit test can only hand the callback the stale view; the two-block gap itself is the chain's.
- **Location**: `spend-allowance/src/lib.rs` `on_pay` 435-448, `on_withdraw` 321-344; `asset-key/src/lib.rs` `on_control` 289-305.
- **Mitigation**: have the buyer's acceptance require (off chain, in the terms) that the budget be withdrawn to zero and the external role moved before the close, or add a `control_seq` fence: companions record the `control_seq` they read and the business exposes it in the token-transfer path... neither closes the gap on chain. The honest fix is documentary: state the window in `AUTHORITY.md` and have the handover checklist drain the budget before the close.

### 3. A repeated `approve` pays the same invoice twice and corrupts the budget's books

- **Severity**: High (promise 10 "each invoice once" and "within caps" broken; reachable by an ordinary wallet retry of the owner's `approve`).
- **Contract and role**: spend-allowance; Owner (or the owner's wallet retrying; a supplier colluding with a careless owner).
- **Steps**:
  1. Agent: `pay(supplier, 600, inv)` with 600 above `review_above` -> `awaiting_approval`, `reserved = 600`.
  2. Owner: `approve(inv)` twice in one block (or before the first callback runs). Both pass the pre-check `state == AwaitingApproval`, because the state only changes in the callback.
  3. `on_approve` runs twice. Neither re-checks the state: both call `send`, so two `ft_transfer(supplier, 600)` go out.
  4. First `on_sent`: `reserved 600 -> 0`, `balance -> 9400`, Paid. Second `on_sent`: `reserved -= 600` underflows and the callback panics (overflow checks are on in the release profile too), so `balance` stays 9400 while the token has moved 1200; `spent_in_period` counted 600 once, so the period cap was exceeded by 600.
- **What should happen**: the second approve is refused (`E_STATE`), or at least the second callback does nothing.
- **What happens**: the invoice is paid twice; `balance` overstates the real token balance by the invoice amount for good (nothing can correct it); if other reservations were live, `reserved` is instead understated and some later `on_sent` panics, leaving that payment stuck in `Sending`.
- **Proof**: `s03_finding_a_repeated_approve_pays_the_invoice_twice_and_breaks_the_books` (spend-allowance, passed).
- **Location**: `spend-allowance/src/lib.rs` `approve` 260-279 (no state change before the cross-contract call), `on_approve` 282-300 (no state re-check), `on_sent` 451-471.
- **Fix suggested**: in `approve`, move the payment to a new `Approving` state before calling `control()` (the pattern `pay`, `withdraw` and `claim` already use), and in `on_approve` require that state; a refusal returns it to `AwaitingApproval`.

### 4. The budget's agent can freeze the whole budget with reviewable invoices; the owner has no way to reject them

- **Severity**: Medium (funds stuck: the owner cannot withdraw or reuse the reserved money; promise 10 weakened because the review threshold is the one cap the agent is not trusted past).
- **Contract and role**: spend-allowance; Agent.
- **Steps**:
  1. `pay(supplier, 1000, inv)` with 1000 > `review_above`: above the threshold the per-payment cap does not apply, only `per_period` and the free budget. The invoice sits in `AwaitingApproval` with 1000 reserved.
  2. Each period, repeat with a new digest until `available() == 0` (ten days in the test).
  3. Owner: `withdraw(1)` -> `E_AVAILABLE`. There is no `reject`/`cancel`; a new `grant` resets `spent_in_period` but not `reserved`.
- **What should happen**: the owner can refuse an invoice it will not approve and get its budget back.
- **What happens**: the money stays reserved until the owner pays the supplier (approving) or until control moves (then `on_approve` refuses with `E_GRANT_ENDED` and releases). The supplier may be the agent's accomplice.
- **Proof**: `s04_finding_agent_freezes_the_budget_with_one_reviewable_invoice` (spend-allowance, passed).
- **Location**: `spend-allowance/src/lib.rs` `pay` 389-419 (reserve for review), no method releases `AwaitingApproval`.
- **Fix suggested**: an owner-only `reject(invoice)` (checked against `get_control` like `approve`) that calls `refuse`, and/or an expiry on awaiting invoices after which anyone may refuse them.

### 5. Every invoice grows the budget contract's storage and nobody pays for it

- **Severity**: Medium (the agent can exhaust the contract's NEAR balance and brick it: once storage staking fails, every state-writing method fails, including the owner's `withdraw`).
- **Contract and role**: spend-allowance; Agent.
- **Steps**: `pay` with amount 1 to an allowed supplier, a new 64-hex digest each time. Each payment record stays forever (Paid, Refused and Claim states included). Measured: ten invoices grow storage by 3,090 bytes (about 309 bytes, 0.003 NEAR, each) with 0 yoctoNEAR attached. A grant with `per_period = 10^9` units allows a billion 1-unit invoices per period.
- **What should happen**: growth is paid by the caller (as business-v3 does for every growing method), or records are bounded/pruned.
- **What happens**: `pay` is not payable and charges nothing; the contract's own balance pays.
- **Proof**: `s09_finding_every_invoice_grows_storage_that_nobody_pays_for` (spend-allowance, passed; prints the measured growth).
- **Location**: `spend-allowance/src/lib.rs` `pay` 417 and 420 (`payments.insert`), `refuse` 536.
- **Fix suggested**: charge the measured growth to the agent (as `sponsor_shell` does), or cap the number of open records per grant and let the owner prune settled ones.

### 6. A failed signer receipt leaves the caller's deposit stuck in the companion

- **Severity**: Medium (funds stuck; small per request, but with no recovery method at all).
- **Contract and role**: asset-key; the Network (a signer that times out or runs out of gas), affecting the Owner.
- **Steps**: `request` with the signer's fee attached; `on_control` forwards the whole deposit on the `sign` call (`k08` checks it rides on that receipt); the signer receipt fails. The protocol refunds that deposit to the sign receipt's predecessor, which is the asset-key account; `on_signed` panics `E_SIGN` and creates no transfer. No method withdraws NEAR from the companion.
- **What should happen**: the deposit returns to the caller on any failure, as it does on a refusal.
- **What happens**: it stays in the companion.
- **Proof**: `k08_finding_a_failed_signature_keeps_the_deposit_in_the_companion` (asset-key, passed: no refund receipt on failure).
- **Location**: `asset-key/src/lib.rs` `on_control` 319-334, `on_signed` 348-350.
- **Fix suggested**: `on_signed` takes the deposit as an argument and, on failure, transfers it back to the caller (also an argument) instead of panicking; or add an owner-gated sweep. Related Note 13 on `SIGN_GAS`.

### 7. Anyone can reserve the budget for two blocks at a time

- **Severity**: Low (griefing; recoverable, costs the attacker gas).
- **Contract and role**: spend-allowance; Outsider.
- **Steps**: `withdraw(available())` from any account: the amount is reserved before the owner check, so `available()` is 0 until `on_withdraw` refuses two blocks later. A stream of such calls keeps the agent's `pay` failing with `E_BUDGET`.
- **Proof**: `s08_finding_anyone_can_reserve_the_budget_for_two_blocks` (spend-allowance, passed).
- **Location**: `spend-allowance/src/lib.rs` `withdraw` 303-318.
- **Fix suggested**: a cheap pre-filter (`predecessor == grant.granted_by` or a recorded last-known owner), keeping the authoritative check in the callback.

### 8. A refused invoice can never be retried, and an oversized period bricks `pay`

- **Severity**: Low.
- **Contract and role**: spend-allowance; the Network (a transient `E_CONTROL_UNREAD`) and the Owner (misconfiguration).
- **Steps**: (a) `pay` -> `on_pay` with the business unreadable -> `Refused`; the same digest is now `E_REPLAY` forever, so a legitimate invoice refused by a transient fault can only be paid under a new digest. (b) `grant(... period_ms: u64::MAX ...)` passes validation; `roll_period` then overflows on `period_start_ms + period_ms` and every `pay` panics until the owner grants again.
- **Proof**: `s12_note_refused_invoices_can_never_be_retried_and_a_huge_period_bricks_pay` (spend-allowance, passed).
- **Location**: `spend-allowance/src/lib.rs` `pay` 380-383, `roll_period` 518-524, `grant` 213-216.

### 9. Note: a revoked use-key still settles uses until the hold's settle deadline

- **Severity**: Note (documented behaviour; the bound is worth stating to customers).
- **Contract and role**: business-v3; Operator with a compromised device key.
- **Steps**: hold of 5 units open; the customer revokes the key; uses signed after the revocation are indistinguishable on chain and all 5 units are charged for up to `settle_grace_ms` (at most an hour) after serving stopped.
- **Proof**: `a80_note_revoked_key_still_settles_uses_until_the_settle_deadline` (business-v3, passed).
- **Location**: `business-v3/src/lib.rs` `revoke_slot` 1556-1563, `settle_hold` 1712 (checks only `settle_until_ms`).

### 10. Note: the seller may name itself as a kept operator

- **Severity**: Note.
- The grants in the terms may include the seller (or anyone) with METERING at the next generation; the buyer agrees to it by accepting the digest. The UI must show grants prominently. `a81_note_seller_can_name_itself_as_a_kept_operator` (business-v3, passed). Location `validate_terms` 2720-2732 (no check against the seller).

### 11. Note: the seller's storage deposit for the buyer's party record waits on the buyer

- **Severity**: Note (about 0.2 NEAR per new buyer; the seller cannot reclaim it).
- `propose_sale` creates the buyer's record at the seller's cost; after a cancel only the buyer can `release_party_slot`. `a82_note_buyer_record_deposit_is_the_sellers_and_stays_until_the_buyer_releases` (business-v3, passed). Location `ensure_party` 2794-2806, `release_party_slot` 1977-1990.

### 12. Note: the closer is the founder's choice for the life of the business

- **Severity**: Note.
- In Gated mode the closer is fixed at `new` (only `!= owner, asset, me` is checked), is bound into every digest, and survives every sale: a buyer of a Gated business inherits a closer the founder picked, and a founder may pick a second account of its own. Between both acceptances and the close (up to 24 hours plus the abort), no new holds can open and nothing is withdrawn; if the closer never acts, anyone aborts after the deadline and escrow returns. Location `new` 1234-1236, `validate_terms` 2727-2731, `open_hold` 1647-1648.

### 13. Note: the companion's fixed gas may not fit the production signer

- **Severity**: Note (not provable here).
- `SIGN_GAS` is 50 Tgas and `CONTROL_GAS` 10 Tgas. NEAR's MPC `sign` yields and resumes and is commonly called with far more gas; `get_control` on business-v3 serialises the whole root state plus the deal digest. If either is short on the real network, every request fails, and with finding 6 every failure keeps the deposit. Measure on testnet before relying on the companion. Location `asset-key/src/lib.rs` 30-33.

### 14. Note: `get_control` failures permanently refuse the invoice they were paying

- Covered under finding 8(a); listed so the "network" role has its line.

## Tried and refused

One line each; the function that stops it. Test names are in the scratch suites.

### business-v3

- A fake token calling `ft_on_transfer` (buy or fund): `ft_on_transfer` predecessor check `E_ASSET`, nothing changes (a01).
- A callback for a free slot or a wrong payout id: `on_payout` logs `payout_mismatch`, changes nothing (a02, a40, a70).
- Outsider proposing, appointing, creating plans, withdrawing, setting the manifest, revoking: `require_owner` `E_NOT_OWNER` (a03).
- Outsider claiming party money or releasing a record without one: `claim`/`release_party_slot` `E_NO_RECORD` (a03).
- Outsider opening or settling holds: `require_metering` `E_NOT_OPERATOR` (a04); refunding, claiming, installing or revoking keys, pausing, unregistering another's record: `own_entitlement` `E_NOT_CUSTOMER` (a04).
- Outsider releasing an active hold before its settle deadline: `release_hold` `E_NOT_OPERATOR`; after it anyone may and units return uncharged (a05).
- Outsider expiring, aborting, cancelling, unfunding, accepting, closing or re-sending a stranded payout: `expire` `E_NOT_EXPIRED`, `abort_close` `E_STATE`, `cancel` `E_NOT_PARTY`, `unfund` `E_NOT_BUYER`, `accept_sale` `E_NOT_PARTY`, `close_sale` `E_NOT_CLOSER`, `claim_stranded` `E_STATE`/`E_NOT_BENEFICIARY` (a06, a72).
- Buyer accepting unfunded: `accept_sale` `E_UNFUNDED`; funding less, more, from another account, a wrong version, a wrong deal number or a stale `expected_control_seq`: `fund_deal` returns the whole amount (a10).
- Buyer funding twice: `fund_deal` "already funded" returns it; buyer unfunding, cancelling or claiming escrow after the close: `live_deal` `E_NO_DEAL`, `claim` `E_FUNDS`; new owner withdrawing the price: `withdraw_profit` `E_RESERVED` (a11).
- Buyer accepting an old version after a revision: `accept_sale` `E_VERSION`; funding the new version at the old price returned (a12).
- Buyer unfunds after accepting, then the seller's acceptance: only records, cannot close (`accept_sale` requires both; `finalize` requires `escrow == price`) (a13).
- Buyer releasing its pinned record: `release_party_slot` `E_DEAL_PINNED`; proposing to the token, closer, business or owner: `validate_terms` `E_ARGS` (a14).
- Seller cancelling after the buyer funded and accepted: escrow becomes the buyer's claim, never available (`terminate`, `withdraw_profit` `E_RESERVED`) (a20).
- Seller changing the buyer while funded: `revise` `E_FUNDED_BUYER`; revising, cancelling or withdrawing while Closing: `E_CLOSING`; appointing while a deal is live: `require_no_deal` `E_DEAL_PENDING`; buyer unfunding while Closing: `E_CLOSING` (a21).
- Seller withdrawing below the accepted floor: `withdraw_profit` `E_FLOOR` (a22); draining before accepting, then accepting: `accept_sale` `E_FLOOR`, and the buyer can still unfund (a23).
- Seller (owner) withdrawing customer money: only `available` is withdrawable (`E_RESERVED`); forging a hold with its own key: `open_hold` `E_SIG`; installing a key into a customer's record: `own_entitlement` `E_NOT_CUSTOMER` (a24).
- Seller proposing twice or changing control during a live deal: `require_no_deal` `E_DEAL_PENDING` (a25).
- Seller accepting twice: `accept_sale` `E_ALREADY_ACCEPTED`; collecting the price twice: `claim` `E_FUNDS` (a26).
- Former owner and old-generation operators after the close: `require_metering`/`require_owner` refuse every metering and owner method; deleting customer shells: `unregister` `E_NOT_CUSTOMER` (a30, a31). Only the agreed grants operate at the new generation.
- SUPPORT-only operator metering: `E_NOT_OPERATOR`; METERING operator appointing, proposing, withdrawing, refunding, installing keys: refused; charging an unsigned or forged use: `settle_hold` `E_SIG`; more uses than units: `E_BATCH`; a slot outside the hold: `E_SLOT`; a hold larger than signed: `E_SIG` (a32).
- Replaying a signed hold on another plan or customer: `E_SIG`; a use twice: "already" (no charge); a use moved to another slot: `E_SIG`; a different fingerprint in a charged slot: `E_CONFLICT`; a use from hold 1 into hold 2: `E_SIG`; a used hold sequence: `E_HOLD_SEQ_USED`; an old key epoch: `E_KEY`; an old registration's signature after re-registering: `E_SIG` (a33).
- Customer refunding twice: `refund_units` `E_UNITS`; claiming twice: `claim_customer` `E_FUNDS`; a failed refund becomes exactly one claim; a repeated callback changes nothing (a40).
- Customer spending or refunding another customer's units: `E_SIG`, `E_UNITS`, `E_NOT_CUSTOMER` (a41).
- Buying with the wrong amount, zero or overflowing units, a wrong sequence, over the purchase or outstanding cap, an unknown plan, a malformed message, a two-key message, without a shell, or with a small-order key: `validate_buy` returns the whole amount (a42).
- Installing a weak or malformed key, a bad slot, a hold size above the plan: `install_key` `E_KEY_INVALID`/`E_ARGS`; unregistering with free units: `E_UNITS` (a43).
- Fifteen customers' refunds at once: `customer_slot` `E_BUSY` at the 15th, two slots kept for parties (a44).
- Hold above the key's or plan's size: `E_UNITS`; over the key's daily cap: `E_DAILY_CAP`; too short or too long a serve window: `E_EXPIRED`/`E_TTL` (a45).
- A sale with invalid grants (bad caps, duplicates, more than 4), zero price, out-of-range expiry or close window: `validate_terms` `E_ARGS` (a51).
- Gated close by the seller, buyer or an outsider: `E_NOT_CLOSER`; a tampered order: `E_CLOSE_SEQ`, `E_TERMS`, `E_ISSUED_FUTURE`, `E_ISSUED_BEFORE`, `E_MANIFEST`; a new hold while closing: `E_CLOSING`; abort before the deadline: `E_NOT_EXPIRED` (a60); a close at the deadline: `E_DEADLINE`, and the abort returns escrow (a61).
- A failed party payout returns to the same category of the same party; releasing a record with a payout in flight or a claim: `E_PENDING_REFS`/`E_CLAIM` (a70); a guarded claim with a stale amount or payout sequence: `E_REVIEWED`; category 3: `E_ARGS` (a71).
- A detached stranded retry never credits a recreated record (a72). A third owner payout at once: `party_slot` `E_PARTY_CAP`; a failed withdrawal never returns to `available` (a73).
- The sale leaves the entitlement byte-for-byte equal, plan prices immutable, and the refund at the plan price works at the new generation (a50).
- No method adds an access key or deploys code (grep of all three sources).

### asset-key

- Anyone may `request`, but a non-owner is refused in `on_control` (`E_NOT_OWNER`) with the deposit returned and nothing signed (k01).
- The former owner after the close: `E_NOT_OWNER` for publish and set-controller; the buyer moves the role from gen-1 and publishes from gen-2 (k02).
- `from_generation` above the current or zero: `E_GENERATION` (k05).
- Malformed digest or address: `call_data` `E_INPUT` before any cross-contract call; gas above the cap or zero: `E_GAS`; fee above the cap or tip above fee: `E_FEE`; no deposit: `E_DEPOSIT`; the hashed transaction equals a hand-assembled EIP-1559 vector; calldata uses fixed selectors and exact widths; the sign request carries only payload, path and domain 0 (k06).
- Business unreadable: `E_CONTROL_UNREAD`, deposit returned, nothing signed (k07).

### spend-allowance

- A fake token: `ft_on_transfer` `E_TOKEN`; a transfer without "fund": returned whole (s01).
- Non-agent paying: `E_NOT_AGENT`; unlisted supplier (the agent itself included): `E_SUPPLIER`; above the per-payment cap but not above review, the gap up to the threshold, zero: `E_CAP`; bad digest: `E_INPUT`; replayed invoice: `E_REPLAY`; the period cap: `E_PERIOD_CAP`, released next period (s02).
- A grant read under the old generation pays nothing after the close: `on_pay` `E_GRANT_ENDED` releases the reservation; former owner granting, approving, withdrawing: `E_NOT_OWNER`; an awaiting invoice from the old generation can't be approved into the new grant: `E_GRANT_ENDED` (s05).
- Supplier claiming twice: `E_NO_CLAIM`; another supplier's claim: `E_NO_CLAIM`; a failed retry restores the claim once; a paid or refused invoice can't be resubmitted: `E_REPLAY` (s07).
- Outsider approving: `on_approve` `E_NOT_OWNER` (state unchanged); outsider granting: `on_grant` `E_NOT_OWNER`; claiming: `E_NO_CLAIM`; approving a missing invoice: `E_NO_PAYMENT`; grant input bounds: `E_INPUT` (s10).
- An approval pays exactly that invoice's supplier and amount; a sending invoice can't be approved again from the entry point: `E_STATE` (s11).

## Summary

- Critical: 0
- High: 2 (finding 1, asset-key arbitrary `setController` target + nonce stockpile; finding 3, spend-allowance double `approve`)
- Medium: 4 (findings 2, 4, 5, 6)
- Low: 2 (findings 7, 8)
- Notes: 6 (findings 9-14)

business-v3 itself held every promise I could reach: 39 attack tests, every attack refused, the
buckets and claims exact after each one. Both High findings are in the companions.

**The one change I would make first**: in asset-key, stop accepting an arbitrary address in
`SetController`. Take a target generation instead, resolve its address through the signer's
`derived_public_key` view in the same promise chain as `get_control`, and sign only
`setController(<that address>)`. Until then a seller can be paid and still keep the external asset
by broadcasting a pre-signed hand-over at the close, which is exactly what promise 9 says cannot
happen. Second, the two-line fix in spend-allowance (`Approving` state before the control call).
