//! The attack review of 2026-11-06 (reports/2026-11-06_attack-review.md), written by a cold
//! reviewer that hadn't seen `tests.rs`. Each test plays one role and performs one attack; a
//! passing `should_panic` test means the contract refused it, a passing plain test asserts what
//! the attack achieved (or did not). The five tests that proved findings 1-4 are turned around
//! to show the fix (marked FIXED); everything else is as the reviewer wrote it.

// The reviewer calls payout methods for their effect and ignores the returned promise.
#![allow(unused_must_use)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const T0: u64 = 1_800_000_000_000; // 2027-01-15 ms
const PRICE: u128 = 100;
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const HOUR: u64 = 3_600_000;
const DAY: u64 = 86_400_000;

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn biz() -> AccountId {
    a("biz.test.near")
}
fn token() -> AccountId {
    a("token.test.near")
}
fn owner() -> AccountId {
    a("owner.test.near")
}
fn op() -> AccountId {
    a("op.test.near")
}
fn op2() -> AccountId {
    a("op2.test.near")
}
fn support() -> AccountId {
    a("support.test.near")
}
fn cust() -> AccountId {
    a("cust.test.near")
}
fn cust2() -> AccountId {
    a("cust2.test.near")
}
fn buyer() -> AccountId {
    a("buyer.test.near")
}
fn mallory() -> AccountId {
    a("mallory.test.near")
}
fn closer() -> AccountId {
    a("closer.test.near")
}

fn context(pred: &AccountId, deposit: u128, now_ms: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(biz())
        .signer_account_id(pred.clone())
        .predecessor_account_id(pred.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now_ms * 1_000_000)
        .account_balance(NearToken::from_near(100));
    b
}
fn set(pred: &AccountId, deposit: u128, now_ms: u64) {
    testing_env!(context(pred, deposit, now_ms).build());
}
/// The private callback's environment: predecessor is the contract, one promise result.
fn set_callback(ok: bool, now_ms: u64) {
    testing_env!(
        context(&biz(), 0, now_ms).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }]
    );
}

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}
fn pk_hex(k: &SigningKey) -> String {
    hex::encode(k.verifying_key().to_bytes())
}
fn sign(k: &SigningKey, msg: &[u8; 32]) -> String {
    hex::encode(k.sign(msg).to_bytes())
}

fn rules(min_reserve: u128) -> Rules {
    Rules { min_reserve: U128(min_reserve), max_hold_units: 10, max_hold_ttl_ms: U64(HOUR), max_settle_grace_ms: U64(HOUR) }
}
fn plan_input() -> PlanInput {
    PlanInput {
        unit_price: U128(PRICE),
        max_units_per_purchase: 100,
        max_units_outstanding: 1000,
        max_hold_units: 10,
        hold_ttl_ms: U64(HOUR),
        settle_grace_ms: U64(600_000),
    }
}

/// A business with one plan (id 1, price 100) and `op` as METERING operator.
fn new_business(closer: Option<AccountId>, min_reserve: u128) -> Business {
    set(&owner(), 0, T0);
    let mut b = Business::new("Shop".into(), owner(), token(), rules(min_reserve), closer);
    set(&owner(), ONE_NEAR, T0);
    assert_eq!(b.create_plan(plan_input()), 1);
    set(&owner(), 1, T0);
    b.appoint_operator(op(), METERING);
    b
}

/// The token delivers a purchase; returns the amount handed back (0 = accepted).
fn buy(b: &mut Business, who: &AccountId, units: u32, seq: u32, install: Option<(u8, &SigningKey)>, now: u64) -> u128 {
    let mut msg = serde_json::json!({ "buy": { "plan_id": 1, "units": units, "purchase_seq": seq } });
    if let Some((slot, k)) = install {
        msg["buy"]["install"] = serde_json::json!({ "slot": slot, "pk": pk_hex(k), "max_hold_units": 10, "max_units_per_day": 100 });
    }
    set(&token(), 0, now);
    match b.ft_on_transfer(who.clone(), U128(units as u128 * PRICE), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}

/// A customer who sponsored their own shell and bought `units` with key `k` in slot 0 (epoch 1).
fn customer(b: &mut Business, who: &AccountId, units: u32, k: &SigningKey) {
    set(who, ONE_NEAR, T0);
    b.sponsor_shell(who.clone(), 1);
    assert_eq!(buy(b, who, units, 1, Some((0, k)), T0), 0, "purchase was returned");
}

fn ent(b: &Business, who: &AccountId) -> EntitlementView {
    b.get_entitlement(who.clone(), 1).unwrap()
}

fn hold_auth(b: &Business, who: &AccountId, k: &SigningKey, hold_seq: u32, units: u8, serve_until: u64, epoch: u32) -> (HoldAuth, String) {
    let e = ent(b, who);
    let msg = hold_message(&biz(), 1, who, e.reg_id.0, 0, epoch, hold_seq, units, serve_until);
    (HoldAuth { hold_seq, units, serve_until_ms: U64(serve_until), key_slot: 0, key_epoch: epoch }, sign(k, &msg))
}

fn use_input(b: &Business, who: &AccountId, k: &SigningKey, hold_seq: u32, slot: u8, fp: [u8; 32], epoch: u32) -> UseInput {
    let e = ent(b, who);
    let msg = use_message(&biz(), 1, who, e.reg_id.0, 0, epoch, hold_seq, slot, &fp);
    UseInput { slot, fingerprint: hex::encode(fp), sig: sign(k, &msg) }
}

/// Opens a hold of `units` for `who` (as `op`) and returns its sequence.
fn open(b: &mut Business, who: &AccountId, k: &SigningKey, units: u8, now: u64) -> u32 {
    let hold_seq = ent(b, who).hold_seq + 1;
    let (auth, sig) = hold_auth(b, who, k, hold_seq, units, now + 120_000, 1);
    set(&op(), 0, now);
    assert_eq!(b.open_hold(who.clone(), 1, auth, sig), "opened");
    hold_seq
}

/// Opens a hold, charges every unit and closes it: `available` rises by units * PRICE.
fn earn(b: &mut Business, who: &AccountId, k: &SigningKey, units: u8, now: u64) {
    let hold_seq = open(b, who, k, units, now);
    let uses: Vec<UseInput> = (0..units).map(|s| use_input(b, who, k, hold_seq, s, [s + 1; 32], 1)).collect();
    set(&op(), 0, now);
    b.settle_hold(who.clone(), 1, hold_seq, uses, true);
}

fn terms(to: AccountId, price: u128, floor: u128, grants: Vec<(AccountId, u8)>, now: u64, window: u64) -> DealTermsInput {
    DealTermsInput {
        buyer: to,
        price: U128(price),
        expires_at_ms: U64(now + DAY),
        close_window_ms: U64(window),
        available_floor: U128(floor),
        grants,
        terms_hash: "11".repeat(32),
    }
}

/// The token delivers escrow; returns the amount handed back (0 = accepted).
fn fund(b: &mut Business, who: &AccountId, deal_seq: u64, version: u32, amount: u128, now: u64) -> u128 {
    let msg = serde_json::json!({ "fund_deal": { "deal_seq": deal_seq.to_string(), "version": version, "price": amount.to_string() } });
    set(&token(), 0, now);
    match b.ft_on_transfer(who.clone(), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}

fn digest(b: &Business) -> String {
    b.get_control().live_deal.expect("no live deal").digest
}
fn party(b: &Business, who: &AccountId) -> PartyView {
    b.get_party(who.clone()).expect("no party record")
}
fn pending(b: &Business) -> Vec<PendingView> {
    b.get_pending()
}

/// Direct mode: owner proposes to `buyer` with grant op2=METERING, buyer funds. Returns deal seq.
fn proposed_and_funded(b: &mut Business, price: u128, floor: u128) -> u64 {
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), price, floor, vec![(op2(), METERING)], T0, 0)).0;
    assert_eq!(fund(b, &buyer(), seq, 1, price, T0), 0, "funding was returned");
    seq
}

/// A full Direct close: buyer accepts, then seller. Returns deal seq.
fn closed_sale(b: &mut Business, price: u128, floor: u128) -> u64 {
    let seq = proposed_and_funded(b, price, floor);
    let d = digest(b);
    set(&buyer(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d.clone()), "accepted");
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "closed");
    assert_eq!(b.get_control().owner, buyer());
    assert_eq!(b.get_control().generation, 2);
    seq
}

// =====================================================================================
// Buyer
// =====================================================================================

#[test]
#[should_panic(expected = "E_UNFUNDED")]
fn buyer_accepts_without_funding() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), 5_000, 0, vec![], T0, 0)).0;
    let d = digest(&b);
    set(&buyer(), 1, T0);
    b.accept_sale(U64(seq), 1, d);
}

#[test]
fn buyer_funds_less_than_price_is_returned_whole() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), 5_000, 0, vec![], T0, 0)).0;
    // Amount below price, and a message claiming the price: both returned.
    assert_eq!(fund(&mut b, &buyer(), seq, 1, 4_999, T0), 4_999);
    let msg = serde_json::json!({ "fund_deal": { "deal_seq": "1", "version": 1, "price": "5000" } });
    set(&token(), 0, T0);
    match b.ft_on_transfer(buyer(), U128(4_999), msg.to_string()) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 4_999),
        _ => panic!(),
    }
    assert_eq!(b.get_treasury().escrow_total.0, 0);
    assert_eq!(b.get_control().live_deal.unwrap().escrow.0, 0);
}

#[test]
fn buyer_funds_from_another_account_is_returned() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), 5_000, 0, vec![], T0, 0)).0;
    assert_eq!(fund(&mut b, &mallory(), seq, 1, 5_000, T0), 5_000);
    assert_eq!(b.get_treasury().escrow_total.0, 0);
}

#[test]
fn buyer_cannot_take_escrow_back_after_close() {
    let mut b = new_business(None, 0);
    let seq = closed_sale(&mut b, 5_000, 0);
    // Escrow became the seller's proceeds claim; the buyer owns the business and has no claim.
    assert_eq!(party(&b, &owner()).sale_proceeds_claim.0, 5_000);
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 0);
    assert_eq!(b.get_treasury().escrow_total.0, 0);
    set(&buyer(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.unfund_deal(U64(seq))));
    assert!(r.is_err(), "unfund after close must be refused");
    // The buyer (now owner) can't cancel or revise either: there is no live deal.
    set(&buyer(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.cancel_sale(U64(seq))));
    assert!(r.is_err());
    set(&buyer(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.claim_party(CLAIM_ESCROW_RETURN)));
    assert!(r.is_err(), "no escrow-return claim to collect");
}

#[test]
fn buyer_funds_then_seller_revises_price_escrow_returns_to_buyer_only() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    b.accept_sale(U64(seq), 1, d);
    // Seller lowers the price to try to close on the buyer's standing acceptance.
    set(&owner(), 1, T0);
    b.revise_sale(U64(seq), terms(buyer(), 10, 0, vec![], T0, 0));
    let dv = b.get_control().live_deal.unwrap();
    assert!(!dv.buyer_accepted && !dv.seller_accepted);
    assert_eq!(dv.escrow.0, 0);
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 5_000);
    // The seller can't close alone on the new terms: the buyer has to fund and accept again.
    let d2 = dv.digest;
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 2, d2), "accepted");
    assert_eq!(b.get_control().owner, owner());
}

#[test]
fn buyer_accepts_stale_version_after_revision_is_refused() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    let d1 = digest(&b);
    set(&owner(), 1, T0);
    b.revise_sale(U64(seq), terms(buyer(), 5_000, 0, vec![(mallory(), METERING)], T0, 0));
    set(&buyer(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.accept_sale(U64(seq), 1, d1.clone())));
    assert!(r.is_err(), "E_VERSION expected");
    set(&buyer(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.accept_sale(U64(seq), 2, d1)));
    assert!(r.is_err(), "E_TERMS expected: the old digest for the new version");
}

#[test]
#[should_panic(expected = "E_ASSET")]
fn fake_token_cannot_fund_or_buy() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), 5_000, 0, vec![], T0, 0)).0;
    let msg = serde_json::json!({ "fund_deal": { "deal_seq": seq.to_string(), "version": 1, "price": "5000" } });
    set(&a("fake-token.test.near"), 0, T0);
    b.ft_on_transfer(buyer(), U128(5_000), msg.to_string());
}

// =====================================================================================
// Seller
// =====================================================================================

#[test]
#[should_panic(expected = "E_FLOOR")]
fn seller_withdraws_below_floor_after_own_acceptance() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0); // available = 1000
    let seq = proposed_and_funded(&mut b, 5_000, 800);
    let d = digest(&b);
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "accepted");
    set(&owner(), 1, T0);
    b.withdraw_profit(U128(300)); // would leave 700 < 800
}

#[test]
fn seller_drains_before_accepting_then_cannot_close_on_buyers_acceptance() {
    // Buyer accepts first; the floor doesn't bind the seller yet, so the seller drains available.
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0); // available = 1000
    let seq = proposed_and_funded(&mut b, 5_000, 800);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d.clone()), "accepted");
    set(&owner(), 1, T0);
    b.withdraw_profit(U128(1000));
    assert_eq!(b.get_treasury().available.0, 0);
    // The seller's acceptance would close the deal: refused because available < floor.
    set(&owner(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.accept_sale(U64(seq), 1, d)));
    assert!(r.is_err(), "E_FLOOR expected");
    assert_eq!(b.get_control().owner, owner());
    assert_eq!(b.get_treasury().escrow_total.0, 5_000);
}

#[test]
fn seller_cannot_withdraw_customer_money() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k); // held = 10_000, all customer money
    assert_eq!(b.get_treasury().held.0, 10_000);
    assert_eq!(b.get_treasury().withdrawable.0, 0);
    set(&owner(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.withdraw_profit(U128(1))));
    assert!(r.is_err(), "E_RESERVED expected");
    // Nor escrow: fund a deal, then try to withdraw.
    proposed_and_funded(&mut b, 5_000, 0);
    assert_eq!(b.get_treasury().held.0, 15_000);
    set(&owner(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.withdraw_profit(U128(1))));
    assert!(r.is_err(), "E_RESERVED expected: escrow isn't available");
}

#[test]
#[should_panic(expected = "E_SIG")]
fn seller_as_owner_cannot_open_hold_with_forged_signature() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (auth, _) = hold_auth(&b, &cust(), &k, 1, 10, T0 + 120_000, 1);
    let forged = sign(&key(9), &[0u8; 32]);
    set(&owner(), 0, T0);
    b.open_hold(cust(), 1, auth, forged);
}

#[test]
#[should_panic(expected = "E_DEAL_PENDING")]
fn seller_cannot_appoint_operator_during_live_deal() {
    let mut b = new_business(None, 0);
    proposed_and_funded(&mut b, 5_000, 0);
    set(&owner(), 1, T0);
    b.appoint_operator(mallory(), METERING);
}

#[test]
#[should_panic(expected = "E_DEAL_PENDING")]
fn seller_cannot_create_plan_during_live_deal() {
    let mut b = new_business(None, 0);
    proposed_and_funded(&mut b, 5_000, 0);
    set(&owner(), ONE_NEAR, T0);
    b.create_plan(plan_input());
}

#[test]
#[should_panic(expected = "E_FUNDED_BUYER")]
fn seller_cannot_redirect_funded_escrow_to_another_buyer() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    set(&owner(), ONE_NEAR, T0);
    b.revise_sale(U64(seq), terms(mallory(), 5_000, 0, vec![], T0, 0));
}

#[test]
fn seller_cancel_returns_escrow_to_buyer_not_seller() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    set(&owner(), 1, T0);
    b.cancel_sale(U64(seq));
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 5_000);
    assert_eq!(owed(&party(&b, &owner())), 0);
    assert_eq!(b.get_treasury().escrow_total.0, 0);
    assert_eq!(b.get_treasury().claims_total.0, 5_000);
    assert_eq!(b.get_treasury().withdrawable.0, 0);
}

#[test]
#[should_panic(expected = "E_CLOSING")]
fn seller_cannot_withdraw_while_gated_sale_is_closing() {
    let mut b = gated_closing();
    set(&owner(), 1, T0);
    b.withdraw_profit(U128(1));
}

#[test]
#[should_panic(expected = "E_CLOSING")]
fn seller_cannot_revise_while_gated_sale_is_closing() {
    let mut b = gated_closing();
    set(&owner(), 1, T0);
    b.revise_sale(U64(1), terms(buyer(), 1, 0, vec![(op2(), METERING)], T0, 600_000));
}

#[test]
#[should_panic(expected = "E_CLOSING")]
fn seller_cannot_cancel_while_gated_sale_is_closing() {
    let mut b = gated_closing();
    set(&owner(), 1, T0);
    b.cancel_sale(U64(1));
}

/// Gated business with a customer who earned 1000 available, deal funded and both accepted:
/// state Closing with a 10-minute window. Deal seq is 1.
fn gated_closing() -> Business {
    let mut b = new_business(Some(closer()), 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0);
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), 5_000, 500, vec![(op2(), METERING)], T0, 600_000)).0;
    assert_eq!(fund(&mut b, &buyer(), seq, 1, 5_000, T0), 0);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d.clone()), "accepted");
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "closing");
    b
}

fn close_order(b: &Business, issued_at: u64) -> CloseOrder {
    let c = b.get_control();
    let d = c.live_deal.unwrap();
    CloseOrder {
        deal_seq: d.seq,
        version: d.version,
        digest: d.digest,
        expected_generation: d.expected_generation,
        closing_control_seq: d.closing_control_seq,
        manifest: c.service_manifest,
        manifest_seq: c.manifest_seq,
        issued_at_ms: U64(issued_at),
    }
}

// =====================================================================================
// Former owner and former operator
// =====================================================================================

#[test]
fn former_owner_and_operator_have_no_power_after_close() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    closed_sale(&mut b, 5_000, 0);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + 120_000, 1);

    // Former owner: owner-only methods.
    set(&owner(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.withdraw_profit(U128(1)))).is_err());
    set(&owner(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.appoint_operator(mallory(), METERING))).is_err());
    set(&owner(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.revoke_operator(op2()))).is_err());
    set(&owner(), ONE_NEAR, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.propose_sale(terms(mallory(), 1, 0, vec![], T0, 0)))).is_err());
    set(&owner(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.set_manifest("22".repeat(32), U64(0)))).is_err());
    // Former owner: metering.
    set(&owner(), 0, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.open_hold(cust(), 1, auth.clone(), sig.clone()))).is_err());
    // Former operator (generation 1): metering.
    set(&op(), 0, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.open_hold(cust(), 1, auth.clone(), sig.clone()))).is_err());
    assert_eq!(b.get_control().operators, vec![(op2(), METERING, 2)]);
    // The successor grant works, with the same customer signature.
    set(&op2(), 0, T0);
    assert_eq!(b.open_hold(cust(), 1, auth, sig), "opened");
}

#[test]
fn former_owner_collects_price_and_nothing_else() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0); // available 1000
    closed_sale(&mut b, 5_000, 0);
    assert_eq!(party(&b, &owner()).sale_proceeds_claim.0, 5_000);
    set(&owner(), 1, T0);
    b.claim_party(CLAIM_SALE_PROCEEDS);
    let p = pending(&b);
    assert_eq!(p.len(), 1);
    assert_eq!(p[0].kind, "sale_proceeds");
    assert_eq!(p[0].amount.0, 5_000);
    set_callback(true, T0);
    assert!(b.on_payout(p[0].slot, p[0].payout_id));
    assert_eq!(owed(&party(&b, &owner())), 0);
    // available (1000) is the new owner's.
    assert_eq!(b.get_treasury().available.0, 1000);
    set(&owner(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.claim_party(CLAIM_PROFIT))).is_err());
    set(&buyer(), 1, T0);
    b.withdraw_profit(U128(1000));
}

#[test]
fn former_owner_pending_withdrawal_fails_after_close_becomes_former_owners_claim() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0);
    set(&owner(), 1, T0);
    b.withdraw_profit(U128(400));
    closed_sale(&mut b, 5_000, 0); // floor 0, available 600
    let p = pending(&b);
    assert_eq!(p.len(), 1);
    set_callback(false, T0);
    assert!(!b.on_payout(p[0].slot, p[0].payout_id));
    assert_eq!(party(&b, &owner()).profit_claim.0, 400);
    assert_eq!(owed(&party(&b, &buyer())), 0);
    assert_eq!(b.get_treasury().available.0, 600);
}

/// FIXED (finding 1): the former owner, as storage sponsor, could delete a customer's
/// never-bought shell after the sale. Paying for a shell now gives no power.
#[test]
#[should_panic(expected = "E_NOT_CUSTOMER")]
fn fixed_former_owner_sponsor_cannot_delete_customer_shell_after_sale() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    let reg = b.sponsor_shell(cust2(), 1).0;
    closed_sale(&mut b, 5_000, 0);
    assert_eq!(b.get_control().owner, buyer());
    set(&owner(), 1, T0);
    b.unregister(cust2(), 1);
    assert!(b.get_entitlement(cust2(), 1).is_none(), "shell deleted by the former owner");
    // The customer's prepared purchase for that registration is now returned whole.
    let msg = serde_json::json!({ "buy": { "plan_id": 1, "units": 5, "purchase_seq": 1, "reg_id": reg.to_string() } });
    set(&token(), 0, T0);
    match b.ft_on_transfer(cust2(), U128(500), msg.to_string()) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 500),
        _ => panic!(),
    }
}

// =====================================================================================
// Operator
// =====================================================================================

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn operator_cannot_withdraw() {
    let mut b = new_business(None, 0);
    set(&op(), 1, T0);
    b.withdraw_profit(U128(1));
}

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn operator_cannot_appoint() {
    let mut b = new_business(None, 0);
    set(&op(), 1, T0);
    b.appoint_operator(mallory(), METERING);
}

#[test]
#[should_panic(expected = "E_NOT_CUSTOMER")]
fn operator_cannot_refund_a_customer_to_itself_or_anyone() {
    let mut b = new_business(None, 0);
    customer(&mut b, &cust(), 100, &key(1));
    set(&op(), 1, T0);
    b.refund_units(1, U64(1));
}

#[test]
#[should_panic(expected = "E_NOT_CUSTOMER")]
fn operator_cannot_install_a_key_on_a_customer() {
    let mut b = new_business(None, 0);
    customer(&mut b, &cust(), 100, &key(1));
    set(&op(), 1, T0);
    b.install_key(1, 1, pk_hex(&key(9)), 10, 100);
}

#[test]
#[should_panic(expected = "E_NOT_OPERATOR")]
fn support_operator_cannot_meter() {
    let mut b = new_business(None, 0);
    set(&owner(), 1, T0);
    b.appoint_operator(support(), SUPPORT);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + 120_000, 1);
    set(&support(), 0, T0);
    b.open_hold(cust(), 1, auth, sig);
}

#[test]
#[should_panic(expected = "E_SIG")]
fn operator_inflates_signed_hold_units() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (mut auth, sig) = hold_auth(&b, &cust(), &k, 1, 2, T0 + 120_000, 1);
    auth.units = 10;
    set(&op(), 0, T0);
    b.open_hold(cust(), 1, auth, sig);
}

#[test]
#[should_panic(expected = "E_HOLD_SEQ_USED")]
fn operator_replays_a_closed_hold_auth() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + 120_000, 1);
    set(&op(), 0, T0);
    b.open_hold(cust(), 1, auth.clone(), sig.clone());
    set(&op(), 0, T0);
    b.release_hold(cust(), 1, 1);
    set(&op(), 0, T0);
    b.open_hold(cust(), 1, auth, sig);
}

#[test]
#[should_panic(expected = "E_SIG")]
fn operator_moves_a_use_to_another_slot() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    let mut u = use_input(&b, &cust(), &k, hs, 0, [7u8; 32], 1);
    u.slot = 1;
    set(&op(), 0, T0);
    b.settle_hold(cust(), 1, hs, vec![u], false);
}

#[test]
#[should_panic(expected = "E_CONFLICT")]
fn operator_charges_two_different_uses_into_one_slot() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    let u1 = use_input(&b, &cust(), &k, hs, 0, [7u8; 32], 1);
    let u2 = use_input(&b, &cust(), &k, hs, 0, [8u8; 32], 1);
    set(&op(), 0, T0);
    b.settle_hold(cust(), 1, hs, vec![u1, u2], false);
}

#[test]
fn operator_cannot_charge_more_than_the_hold_units() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 3, T0);
    // Slot 3 is outside a 3-unit hold even with a valid signature.
    let u = use_input(&b, &cust(), &k, hs, 3, [7u8; 32], 1);
    set(&op(), 0, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.settle_hold(cust(), 1, hs, vec![u], false)));
    assert!(r.is_err(), "E_SLOT expected");
    // Charging the same use twice charges once.
    let u = use_input(&b, &cust(), &k, hs, 0, [7u8; 32], 1);
    set(&op(), 0, T0);
    assert_eq!(b.settle_hold(cust(), 1, hs, vec![u.clone()], false), vec!["charged"]);
    set(&op(), 0, T0);
    assert_eq!(b.settle_hold(cust(), 1, hs, vec![u], false), vec!["already"]);
    assert_eq!(ent(&b, &cust()).consumed.0, 1);
    assert_eq!(b.get_treasury().available.0, PRICE);
}

#[test]
#[should_panic(expected = "E_SIG")]
fn operator_uses_customer_a_hold_auth_for_customer_b() {
    let mut b = new_business(None, 0);
    let ka = key(1);
    let kb = key(2);
    customer(&mut b, &cust(), 100, &ka);
    customer(&mut b, &cust2(), 100, &kb);
    // A's signature over A's message, submitted for B (B's reg_id and key differ).
    let (auth, sig) = hold_auth(&b, &cust(), &ka, 1, 5, T0 + 120_000, 1);
    set(&op(), 0, T0);
    b.open_hold(cust2(), 1, auth, sig);
}

#[test]
#[should_panic(expected = "E_KEY")]
fn operator_opens_hold_with_revoked_key_epoch() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + 120_000, 1);
    set(&cust(), 1, T0);
    b.revoke_key(1, 0);
    set(&op(), 0, T0);
    b.open_hold(cust(), 1, auth, sig);
}

/// NOTE: after the customer revokes the key, uses signed by it still settle until the grace
/// deadline; the contract can't tell when a use was signed.
#[test]
fn note_operator_settles_uses_signed_after_revocation_within_grace() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    set(&cust(), 1, T0 + 1_000);
    b.revoke_key(1, 0);
    // A use "signed" now, after revocation (a leaked key), charges.
    let u = use_input(&b, &cust(), &k, hs, 0, [7u8; 32], 1);
    set(&op(), 0, T0 + 2_000);
    assert_eq!(b.settle_hold(cust(), 1, hs, vec![u], false), vec!["charged"]);
    assert_eq!(ent(&b, &cust()).consumed.0, 1);
}

// =====================================================================================
// Customer
// =====================================================================================

#[test]
fn customer_cannot_be_refunded_twice() {
    let mut b = new_business(None, 0);
    customer(&mut b, &cust(), 10, &key(1));
    set(&cust(), 1, T0);
    b.refund_units(1, U64(4));
    let p = pending(&b);
    assert_eq!(ent(&b, &cust()).free.0, 6);
    // Transfer fails: the money becomes a claim, not free units.
    set_callback(false, T0);
    assert!(!b.on_payout(p[0].slot, p[0].payout_id));
    assert_eq!(ent(&b, &cust()).free.0, 6);
    assert_eq!(ent(&b, &cust()).claim.0, 400);
    // Replaying the callback changes nothing.
    set_callback(true, T0);
    assert!(!b.on_payout(p[0].slot, p[0].payout_id));
    assert_eq!(ent(&b, &cust()).claim.0, 400);
    assert_eq!(b.get_treasury().held.0, 1000);
    // Claim once; success; claim again is refused.
    set(&cust(), 1, T0);
    b.claim_customer(1);
    let p = pending(&b);
    set_callback(true, T0);
    assert!(b.on_payout(p[0].slot, p[0].payout_id));
    assert_eq!(ent(&b, &cust()).claim.0, 0);
    assert_eq!(b.get_treasury().held.0, 600);
    set(&cust(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.claim_customer(1))).is_err());
    set(&cust(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.refund_units(1, U64(7)))).is_err());
}

#[test]
#[should_panic(expected = "E_PENDING_REFS")]
fn customer_cannot_unregister_with_a_refund_in_flight() {
    let mut b = new_business(None, 0);
    customer(&mut b, &cust(), 10, &key(1));
    set(&cust(), 1, T0);
    b.refund_units(1, U64(10));
    set(&cust(), 1, T0);
    b.unregister(cust(), 1);
}

#[test]
#[should_panic(expected = "E_KEY_INVALID")]
fn customer_cannot_install_a_small_order_key() {
    let mut b = new_business(None, 0);
    customer(&mut b, &cust(), 10, &key(1));
    // The identity point (order 1) compressed: 0x01 then zeros.
    let mut weak = [0u8; 32];
    weak[0] = 1;
    set(&cust(), 1, T0);
    b.install_key(1, 1, hex::encode(weak), 10, 100);
}

#[test]
fn weak_key_through_purchase_is_returned() {
    let mut b = new_business(None, 0);
    set(&cust(), ONE_NEAR, T0);
    b.sponsor_shell(cust(), 1);
    let mut weak = [0u8; 32];
    weak[0] = 1;
    let msg = serde_json::json!({ "buy": { "plan_id": 1, "units": 1, "purchase_seq": 1,
        "install": { "slot": 0, "pk": hex::encode(weak), "max_hold_units": 1, "max_units_per_day": 1 } } });
    set(&token(), 0, T0);
    match b.ft_on_transfer(cust(), U128(PRICE), msg.to_string()) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, PRICE),
        _ => panic!(),
    }
}

/// FIXED (finding 2): a customer who installed a key on a sponsored shell locked the sponsor's
/// storage deposit for good. The business can now clear an unbought shell, keyed or not.
#[test]
fn fixed_customer_key_no_longer_locks_sponsor_deposit() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    b.sponsor_shell(cust(), 1);
    let paid = ent(&b, &cust()).storage_paid.0;
    assert!(paid > 0);
    set(&cust(), 1, T0);
    b.install_key(1, 0, pk_hex(&key(1)), 10, 100);
    set(&owner(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.unregister(cust(), 1)));
    assert!(r.is_ok(), "the business clears it; the deposit goes back to the payer");
    assert!(b.get_entitlement(cust(), 1).is_none());
}

/// FIXED (finding 3): eight accounts with two refunds each took all 16 payout slots. Customers
/// together now hold at most 14, so the owner's withdrawal still gets a slot.
#[test]
fn fixed_sybil_customers_cannot_fill_every_payout_slot() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0); // owner has 1000 available
    for i in 0..8u8 {
        let who = a(&format!("sybil{i}.test.near"));
        customer(&mut b, &who, 2, &key(100 + i));
        for _ in 0..2 {
            let room = pending(&b).len() < 14;
            set(&who, 1, T0);
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.refund_units(1, U64(1))));
            assert_eq!(r.is_ok(), room, "refused only once customers hold 14 slots");
        }
    }
    assert_eq!(pending(&b).len(), 14, "customers stop at 14");
    set(&owner(), 1, T0);
    b.withdraw_profit(U128(1));
    assert_eq!(pending(&b).len(), 15);
    set(&cust(), 1, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.refund_units(1, U64(1))));
    assert!(r.is_err(), "E_BUSY while 14 customer payouts are in flight");
    // One callback frees one slot and the honest refund goes through.
    let p = pending(&b);
    set_callback(true, T0);
    b.on_payout(p[0].slot, p[0].payout_id);
    set(&cust(), 1, T0);
    b.refund_units(1, U64(1));
}

#[test]
fn customer_units_keys_and_hold_survive_a_sale() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    let before = ent(&b, &cust());
    closed_sale(&mut b, 5_000, 0);
    let after = ent(&b, &cust());
    assert_eq!(before, after, "the entitlement must be byte-for-byte unchanged by the close");
    // The successor operator settles the hold with the customer's existing signatures...
    let u = use_input(&b, &cust(), &k, hs, 0, [7u8; 32], 1);
    set(&op2(), 0, T0);
    assert_eq!(b.settle_hold(cust(), 1, hs, vec![u], true), vec!["charged"]);
    // ...and the customer refunds the rest at the plan price.
    assert_eq!(ent(&b, &cust()).free.0, 99);
    set(&cust(), 1, T0);
    b.refund_units(1, U64(99));
    assert_eq!(pending(&b)[0].amount.0, 9_900);
}

// =====================================================================================
// Outsider
// =====================================================================================

#[test]
#[should_panic(expected = "E_NOT_OPERATOR")]
fn outsider_cannot_release_a_hold_before_its_deadline() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    set(&mallory(), 0, T0 + 120_000 + 600_000); // exactly the settle deadline: still guarded
    b.release_hold(cust(), 1, hs);
}

#[test]
fn outsider_can_release_a_hold_after_its_deadline_units_return_to_customer() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    assert_eq!(ent(&b, &cust()).free.0, 95);
    set(&mallory(), 0, T0 + 120_000 + 600_001);
    b.release_hold(cust(), 1, hs);
    assert_eq!(ent(&b, &cust()).free.0, 100);
    assert_eq!(b.get_treasury().available.0, 0);
}

#[test]
#[should_panic(expected = "E_NOT_EXPIRED")]
fn outsider_cannot_expire_a_live_offer() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    set(&mallory(), 0, T0 + DAY - 1);
    b.expire_sale(U64(seq));
}

#[test]
fn outsider_expires_a_stale_offer_escrow_goes_to_buyer() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    set(&mallory(), 0, T0 + DAY);
    b.expire_sale(U64(seq));
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 5_000);
    assert!(b.get_party(mallory()).is_none());
    assert_eq!(b.get_control().owner, owner());
}

#[test]
#[should_panic(expected = "E_NOT_EXPIRED")]
fn outsider_cannot_abort_a_gated_close_before_its_deadline() {
    let mut b = gated_closing();
    set(&mallory(), 0, T0 + 600_000 - 1);
    b.abort_close(U64(1));
}

#[test]
fn outsider_aborts_a_gated_close_after_deadline_escrow_goes_to_buyer() {
    let mut b = gated_closing();
    set(&mallory(), 0, T0 + 600_000);
    b.abort_close(U64(1));
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 5_000);
    assert_eq!(b.get_control().owner, owner());
    assert_eq!(b.get_control().generation, 1);
}

#[test]
#[should_panic(expected = "E_NOT_CLOSER")]
fn outsider_cannot_close_a_gated_sale() {
    let mut b = gated_closing();
    let order = close_order(&b, T0 + 1_000);
    set(&mallory(), 0, T0 + 2_000);
    b.close_sale(order);
}

#[test]
#[should_panic(expected = "E_NOT_CLOSER")]
fn seller_cannot_close_a_gated_sale_themselves() {
    let mut b = gated_closing();
    let order = close_order(&b, T0 + 1_000);
    set(&owner(), 0, T0 + 2_000);
    b.close_sale(order);
}

#[test]
fn closer_closes_gated_sale_exactly_once() {
    let mut b = gated_closing();
    let order = close_order(&b, T0 + 1_000);
    set(&closer(), 0, T0 + 2_000);
    b.close_sale(order.clone());
    assert_eq!(b.get_control().owner, buyer());
    assert_eq!(party(&b, &owner()).sale_proceeds_claim.0, 5_000);
    set(&closer(), 0, T0 + 3_000);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.close_sale(order))).is_err());
}

#[test]
#[should_panic(expected = "E_NOT_CUSTOMER")]
fn outsider_cannot_unregister_someone_elses_shell() {
    let mut b = new_business(None, 0);
    set(&cust(), ONE_NEAR, T0);
    b.sponsor_shell(cust(), 1);
    set(&mallory(), 1, T0);
    b.unregister(cust(), 1);
}

#[test]
#[should_panic(expected = "E_STATE")]
fn outsider_cannot_claim_a_slot_that_is_not_stranded() {
    let mut b = new_business(None, 0);
    customer(&mut b, &cust(), 10, &key(1));
    set(&cust(), 1, T0);
    b.refund_units(1, U64(1));
    set(&mallory(), 1, T0);
    b.claim_stranded(0);
}

#[test]
fn stale_or_foreign_callback_changes_nothing() {
    let mut b = new_business(None, 0);
    customer(&mut b, &cust(), 10, &key(1));
    set(&cust(), 1, T0);
    b.refund_units(1, U64(1));
    let p = pending(&b)[0].clone();
    let before = b.get_treasury();
    set_callback(true, T0);
    assert!(!b.on_payout(p.slot, U64(p.payout_id.0 + 1)));
    assert!(!b.on_payout(p.slot + 1, p.payout_id));
    assert!(!b.on_payout(99, p.payout_id));
    assert_eq!(b.get_treasury(), before);
    assert_eq!(pending(&b).len(), 1);
}

// =====================================================================================
// The network
// =====================================================================================

#[test]
fn every_failed_payout_kind_becomes_the_right_persons_claim() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0); // available 1000
    // Profit.
    set(&owner(), 1, T0);
    b.withdraw_profit(U128(300));
    // Escrow return: fund, cancel, claim.
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    set(&buyer(), 1, T0);
    b.cancel_sale(U64(seq));
    set(&buyer(), 1, T0);
    b.claim_party(CLAIM_ESCROW_RETURN);
    // Refund.
    set(&cust(), 1, T0);
    b.refund_units(1, U64(2));
    let p = pending(&b);
    assert_eq!(p.len(), 3);
    for s in &p {
        set_callback(false, T0);
        assert!(!b.on_payout(s.slot, s.payout_id));
    }
    assert_eq!(party(&b, &owner()).profit_claim.0, 300);
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 5_000);
    assert_eq!(ent(&b, &cust()).claim.0, 200);
    let t = b.get_treasury();
    assert_eq!(t.pending_total.0, 0);
    assert_eq!(t.claims_total.0, 5_500);
    assert_eq!(t.available.0, 700);
    assert_eq!(t.held.0, 10_000 + 5_000);
    // Sale proceeds, on a fresh deal that closes.
    closed_sale(&mut b, 5_000, 0);
    set(&owner(), 1, T0);
    b.claim_party(CLAIM_SALE_PROCEEDS);
    let p = pending(&b);
    set_callback(false, T0);
    assert!(!b.on_payout(p[0].slot, p[0].payout_id));
    assert_eq!(party(&b, &owner()).sale_proceeds_claim.0, 5_000);
    assert_eq!(party(&b, &owner()).profit_claim.0, 300);
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 5_000);
}

#[test]
#[should_panic(expected = "E_PENDING_REFS")]
fn third_refund_in_flight_is_refused() {
    let mut b = new_business(None, 0);
    customer(&mut b, &cust(), 10, &key(1));
    set(&cust(), 1, T0);
    b.refund_units(1, U64(1));
    set(&cust(), 1, T0);
    b.refund_units(1, U64(1));
    set(&cust(), 1, T0);
    b.refund_units(1, U64(1));
}

#[test]
#[should_panic(expected = "E_PARTY_CAP")]
fn third_owner_payout_in_flight_is_refused() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0);
    for _ in 0..3 {
        set(&owner(), 1, T0);
        b.withdraw_profit(U128(100));
    }
}

/// Racing in one block: the buyer's unfund lands first, then the seller's acceptance. The
/// seller's acceptance can't close on the withdrawn escrow.
#[test]
fn race_buyer_unfunds_before_sellers_closing_acceptance() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d.clone()), "accepted");
    set(&buyer(), 1, T0);
    b.unfund_deal(U64(seq));
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "accepted");
    assert_eq!(b.get_control().owner, owner());
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 5_000);
}

/// Racing in one block: the seller's acceptance lands first and closes; the buyer's unfund
/// then finds no deal. The buyer consented when they accepted.
#[test]
fn race_sellers_acceptance_lands_before_buyers_unfund() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    b.accept_sale(U64(seq), 1, d.clone());
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "closed");
    set(&buyer(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.unfund_deal(U64(seq)))).is_err());
}

/// NOTE: while a Gated sale is closing (up to 24 h), no customer can get a new hold; refunds
/// and settlement of existing holds still work.
#[test]
fn note_no_new_holds_while_closing() {
    let mut b = gated_closing();
    let k = key(1);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 2, 5, T0 + 120_000, 1);
    set(&op(), 0, T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.open_hold(cust(), 1, auth, sig)));
    assert!(r.is_err(), "E_CLOSING expected");
    set(&cust(), 1, T0);
    b.refund_units(1, U64(10));
    assert_eq!(pending(&b).len(), 1);
}

/// NOTE: a Gated close may land after the offer's `expires_at` as long as the close window
/// is open; expiry stops mattering once both have accepted.
#[test]
fn note_gated_close_lands_after_offer_expiry() {
    let mut b = new_business(Some(closer()), 0);
    set(&owner(), ONE_NEAR, T0);
    let t = DealTermsInput { expires_at_ms: U64(T0 + MIN_OFFER_MS), ..terms(buyer(), 5_000, 0, vec![(op2(), METERING)], T0, DAY) };
    let seq = b.propose_sale(t).0;
    assert_eq!(fund(&mut b, &buyer(), seq, 1, 5_000, T0), 0);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    b.accept_sale(U64(seq), 1, d.clone());
    set(&owner(), 1, T0 + MIN_OFFER_MS - 1);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "closing");
    let late = T0 + 12 * HOUR;
    let order = close_order(&b, late - 1_000);
    set(&closer(), 0, late);
    b.close_sale(order);
    assert_eq!(b.get_control().owner, buyer());
}

/// FIXED (finding 4): `new` accepted a closer equal to the business account itself, which can
/// never sign a transaction (the account keeps no keys), so every Gated sale could only abort.
#[test]
#[should_panic(expected = "E_ARGS")]
fn fixed_new_refuses_the_business_as_its_own_closer() {
    set(&owner(), 0, T0);
    Business::new("Shop".into(), owner(), token(), rules(0), Some(biz()));
}

/// FIXED (finding 4): an owner equal to the business account could never act.
#[test]
#[should_panic(expected = "E_ARGS")]
fn fixed_new_refuses_the_business_as_its_own_owner() {
    set(&owner(), 0, T0);
    Business::new("Shop".into(), biz(), token(), rules(0), None);
}

/// FIXED (finding 1): a third-party sponsor could race a customer's purchase by deleting the
/// shell first. A sponsor has no power over the shell now.
#[test]
#[should_panic(expected = "E_NOT_CUSTOMER")]
fn fixed_sponsor_cannot_yank_shell_under_an_in_flight_purchase() {
    let mut b = new_business(None, 0);
    set(&mallory(), ONE_NEAR, T0);
    b.sponsor_shell(cust(), 1);
    set(&mallory(), 1, T0);
    b.unregister(cust(), 1);
    assert_eq!(buy(&mut b, &cust(), 5, 1, None, T0), 500);
    assert_eq!(b.get_treasury().held.0, 0);
}

/// Escrow stays the buyer's through a same-price revision; the buyer is never forced to accept.
#[test]
fn same_price_revision_keeps_escrow_but_buyer_can_still_leave() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    b.accept_sale(U64(seq), 1, d);
    set(&owner(), 1, T0);
    b.revise_sale(U64(seq), terms(buyer(), 5_000, 0, vec![(mallory(), METERING)], T0, 0));
    let dv = b.get_control().live_deal.unwrap();
    assert_eq!(dv.escrow.0, 5_000);
    assert!(!dv.buyer_accepted);
    // Seller accepting alone does not close.
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 2, dv.digest), "accepted");
    assert_eq!(b.get_control().owner, owner());
    set(&buyer(), 1, T0);
    b.unfund_deal(U64(seq));
    assert_eq!(party(&b, &buyer()).escrow_return_claim.0, 5_000);
}

#[test]
fn invariant_holds_through_a_full_life_cycle() {
    let mut b = new_business(None, 50);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    earn(&mut b, &cust(), &k, 10, T0);
    set(&owner(), 1, T0);
    b.withdraw_profit(U128(900));
    let seq = proposed_and_funded(&mut b, 5_000, 100);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    b.accept_sale(U64(seq), 1, d.clone());
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "closed");
    let t = b.get_treasury();
    assert_eq!(t.held.0, t.ent_free_value.0 + t.ent_held_value.0 + t.available.0 + t.pending_total.0 + t.claims_total.0 + t.escrow_total.0);
    assert_eq!(t.available.0, 100);
    assert_eq!(t.claims_total.0, 5_000);
    assert_eq!(t.pending_total.0, 900);
    assert_eq!(t.escrow_total.0, 0);
}

fn owed(p: &PartyView) -> u128 {
    p.profit_claim.0 + p.escrow_return_claim.0 + p.sale_proceeds_claim.0
}

include!("attack_tests2.rs");
