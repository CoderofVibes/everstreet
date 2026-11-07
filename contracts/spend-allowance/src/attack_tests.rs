//! Attack review of 2026-11-07 (reports/2026-11-07_attack-review.md): the reviewer's tests, written
//! against a test-stripped copy and kept here as regression tests. A `*_finding_*` test shows an
//! attack succeeding until its fix lands; every other test shows the contract refusing one.
//! Callbacks are called directly with simulated promise results (`#[private]` is wrapper-enforced).

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_700_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn me() -> AccountId {
    acc("budget.test.near")
}
fn business() -> AccountId {
    acc("biz.test.near")
}
fn token() -> AccountId {
    acc("token.test.near")
}
fn owner() -> AccountId {
    acc("founder.test.near")
}
fn buyer() -> AccountId {
    acc("buyer.test.near")
}
fn agent() -> AccountId {
    acc("agent.test.near")
}
fn supplier() -> AccountId {
    acc("supplier.test.near")
}

fn env_at(pred: &AccountId, now_ms: u64, results: Vec<PromiseResult>) {
    let ctx = VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred.clone())
        .block_timestamp(now_ms * 1_000_000)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}
fn env(pred: &AccountId, results: Vec<PromiseResult>) {
    env_at(pred, T0, results);
}

fn view(owner: &AccountId, generation: u32) -> PromiseResult {
    PromiseResult::Successful(serde_json::json!({ "owner": owner, "generation": generation, "control_seq": "9", "operators": [], "live_deal": null }).to_string().into_bytes())
}

fn refused<F: FnOnce() -> R, R>(f: F) -> Option<String> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(_) => None,
        Err(e) => Some(e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()),
    }
}
fn expect_refused<F: FnOnce() -> R, R>(code: &str, f: F) {
    let m = refused(f).unwrap_or_else(|| panic!("expected {code}, but the call succeeded"));
    assert!(m.contains(code), "expected {code}, got: {m}");
}

fn ft_transfers() -> Vec<(String, u128)> {
    let mut out = vec![];
    for r in get_created_receipts() {
        for a in &r.actions {
            if let MockAction::FunctionCallWeight { method_name, args, .. } = a {
                if method_name == b"ft_transfer" {
                    let v: serde_json::Value = serde_json::from_slice(args).unwrap();
                    out.push((v["receiver_id"].as_str().unwrap().to_string(), v["amount"].as_str().unwrap().parse().unwrap()));
                }
            }
        }
    }
    out
}

fn grant_input(per_payment: u128, per_period: u128, review_above: u128) -> Grant {
    Grant {
        agent: agent(),
        suppliers: vec![supplier(), acc("supplier2.test.near")],
        per_payment: U128(per_payment),
        per_period: U128(per_period),
        period_ms: U64(DAY),
        review_above: U128(review_above),
        generation: 0,
        granted_by: owner(),
    }
}
const DAY: u64 = 86_400_000;

/// A funded budget with a grant at generation 1: per payment 100, per period 1000, review above 500.
fn fixture() -> SpendAllowance {
    env(&owner(), vec![]);
    let mut s = SpendAllowance::new(business(), token());
    env(&token(), vec![]);
    assert!(matches!(s.ft_on_transfer(owner(), U128(10_000), "fund".into()), PromiseOrValue::Value(U128(0))));
    env(&owner(), vec![]);
    s.grant(agent(), vec![supplier(), acc("supplier2.test.near")], U128(100), U128(1000), U64(DAY), U128(500));
    env(&me(), vec![view(&owner(), 1)]);
    assert_eq!(s.on_grant(grant_input(100, 1000, 500), Ok(ControlView { owner: owner(), generation: 1 })), "granted");
    s
}

fn inv(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

fn alw(s: &SpendAllowance) -> serde_json::Value {
    s.get_allowance()
}

// -------------------------------------------------------------------------------------

#[test]
fn s01_only_the_token_funds_and_only_with_the_fund_message() {
    let mut s = fixture();
    env(&acc("fake-token.test.near"), vec![]);
    expect_refused("E_TOKEN", || s.ft_on_transfer(owner(), U128(5), "fund".into()));
    env(&token(), vec![]);
    assert!(matches!(s.ft_on_transfer(owner(), U128(5), "buy".into()), PromiseOrValue::Value(U128(5))));
    assert_eq!(alw(&s)["balance"], "10000");
}

#[test]
fn s02_agent_cannot_pay_outside_the_grant() {
    let mut s = fixture();
    env(&acc("mallory.test.near"), vec![]);
    expect_refused("E_NOT_AGENT", || s.pay(supplier(), U128(10), inv(1)));
    env(&agent(), vec![]);
    expect_refused("E_SUPPLIER", || s.pay(acc("mallory.test.near"), U128(10), inv(1)));
    expect_refused("E_SUPPLIER", || s.pay(agent(), U128(10), inv(1)));
    expect_refused("E_CAP", || s.pay(supplier(), U128(101), inv(1))); // above per-payment, not above review
    expect_refused("E_CAP", || s.pay(supplier(), U128(500), inv(1))); // the gap up to review_above inclusive
    expect_refused("E_CAP", || s.pay(supplier(), U128(0), inv(1)));
    expect_refused("E_INPUT", || s.pay(supplier(), U128(10), "abc".into()));
    expect_refused("E_INPUT", || s.pay(supplier(), U128(10), "zz".repeat(32)));
    // Within caps: pays; the same invoice again is a replay.
    assert!(matches!(s.pay(supplier(), U128(100), inv(1)), PromiseOrValue::Promise(_)));
    expect_refused("E_REPLAY", || s.pay(supplier(), U128(100), inv(1)));
    expect_refused("E_REPLAY", || s.pay(supplier(), U128(1), inv(1)));
    // Period cap: 9 more of 100 fill it; the 11th is refused before any cross-contract call.
    for n in 2..=10 {
        env(&agent(), vec![]);
        assert!(matches!(s.pay(supplier(), U128(100), inv(n)), PromiseOrValue::Promise(_)));
    }
    env(&agent(), vec![]);
    expect_refused("E_PERIOD_CAP", || s.pay(supplier(), U128(1), inv(11)));
    assert_eq!(alw(&s)["reserved"], "1000");
    // Next period: allowed again, but never beyond the budget.
    env_at(&agent(), T0 + DAY, vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(11)), PromiseOrValue::Promise(_)));
}

#[test]
fn s03_finding_a_repeated_approve_pays_the_invoice_twice_and_breaks_the_books() {
    let mut s = fixture();
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(600), inv(1)), PromiseOrValue::Value(v) if v == "awaiting_approval"));
    assert_eq!(alw(&s)["reserved"], "600");
    // The owner's wallet sends `approve` twice (a retry, or two keys in one block). Both pass the
    // pre-check because the state only changes in the callback.
    env(&owner(), vec![]);
    s.approve(inv(1));
    env(&owner(), vec![]);
    s.approve(inv(1));
    // Both callbacks run: each sends a transfer of 600 to the supplier.
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_approve(owner(), inv(1), Ok(ControlView { owner: owner(), generation: 1 })), PromiseOrValue::Promise(_)));
    assert_eq!(ft_transfers(), vec![(supplier().to_string(), 600)]);
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_approve(owner(), inv(1), Ok(ControlView { owner: owner(), generation: 1 })), PromiseOrValue::Promise(_)), "second approve sends again");
    assert_eq!(ft_transfers(), vec![(supplier().to_string(), 600)]);
    // First transfer settles: reserved 600 -> 0, balance -> 9400, state Paid.
    env(&me(), vec![PromiseResult::Successful(vec![])]);
    assert_eq!(s.on_sent(inv(1)), "paid");
    assert_eq!(alw(&s)["reserved"], "0");
    assert_eq!(alw(&s)["balance"], "9400");
    // Second transfer settles: reserved underflows, the callback panics, balance stays 9400 while
    // the token has moved 1200. spent_in_period counted 600 once.
    env(&me(), vec![PromiseResult::Successful(vec![])]);
    let m = refused(|| s.on_sent(inv(1))).expect("underflow");
    assert!(m.contains("overflow"), "{m}");
    assert_eq!(alw(&s)["balance"], "9400", "books say 9400; the token holds 8800");
    assert_eq!(alw(&s)["spent_in_period"], "600", "the cap counted the invoice once");
}

#[test]
fn s04_finding_agent_freezes_the_budget_with_one_reviewable_invoice() {
    let mut s = fixture();
    // An invoice above the review threshold is capped only by the period cap and the budget.
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(1000), inv(1)), PromiseOrValue::Value(v) if v == "awaiting_approval"));
    assert_eq!(alw(&s)["reserved"], "1000");
    assert_eq!(alw(&s)["available"], "9000");
    // Next period: another 1000, and so on until the budget is reserved.
    for d in 1..=9u64 {
        env_at(&agent(), T0 + d * DAY, vec![]);
        assert!(matches!(s.pay(supplier(), U128(1000), inv(d as u8 + 1)), PromiseOrValue::Value(v) if v == "awaiting_approval"));
    }
    assert_eq!(alw(&s)["available"], "0");
    // The owner can neither withdraw nor reject; a fresh grant does not release reservations.
    env_at(&owner(), T0 + 10 * DAY, vec![]);
    expect_refused("E_AVAILABLE", || s.withdraw(U128(1)));
    s.grant(agent(), vec![supplier()], U128(1), U128(1), U64(DAY), U128(1));
    env_at(&me(), T0 + 10 * DAY, vec![view(&owner(), 1)]);
    s.on_grant(Grant { suppliers: vec![supplier()], per_payment: U128(1), per_period: U128(1), review_above: U128(1), ..grant_input(1, 1, 1) }, Ok(ControlView { owner: owner(), generation: 1 }));
    assert_eq!(alw(&s)["reserved"], "10000");
    assert_eq!(alw(&s)["available"], "0");
    env_at(&owner(), T0 + 10 * DAY, vec![]);
    expect_refused("E_AVAILABLE", || s.withdraw(U128(1)));
    // The only ways out: the owner approves (paying the supplier), or control moves (then the
    // approve path refuses with E_GRANT_ENDED and releases).
    env_at(&me(), T0 + 10 * DAY, vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_approve(buyer(), inv(1), Ok(ControlView { owner: buyer(), generation: 2 })), PromiseOrValue::Value(v) if v == "E_GRANT_ENDED"));
    assert_eq!(alw(&s)["reserved"], "9000");
}

#[test]
fn s05_stale_grant_pays_nothing_after_control_moves() {
    let mut s = fixture(); // grant at generation 1
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(1)), PromiseOrValue::Promise(_)));
    // The business now answers generation 2 (a close landed).
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_pay(inv(1), Ok(ControlView { owner: buyer(), generation: 2 })), PromiseOrValue::Value(v) if v == "E_GRANT_ENDED"));
    assert!(ft_transfers().is_empty());
    assert_eq!(alw(&s)["reserved"], "0");
    assert_eq!(alw(&s)["spent_in_period"], "0");
    assert_eq!(s.get_payment(inv(1)).unwrap().state, PaymentState::Refused);
    // The former owner cannot grant again, approve, or withdraw.
    env(&me(), vec![view(&buyer(), 2)]);
    expect_refused("E_NOT_OWNER", || s.on_grant(grant_input(100, 1000, 500), Ok(ControlView { owner: buyer(), generation: 2 })));
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(600), inv(2)), PromiseOrValue::Value(v) if v == "awaiting_approval"));
    env(&me(), vec![view(&buyer(), 2)]);
    expect_refused("E_NOT_OWNER", || s.on_approve(owner(), inv(2), Ok(ControlView { owner: buyer(), generation: 2 })));
    env(&owner(), vec![]);
    s.withdraw(U128(100));
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_withdraw(owner(), U128(100), Ok(ControlView { owner: buyer(), generation: 2 })), PromiseOrValue::Value(v) if v == "E_NOT_OWNER"));
    assert!(ft_transfers().is_empty());
    assert_eq!(alw(&s)["reserved"], "600"); // only the awaiting invoice
    // A former-owner grant that read a stale view is installed at the old generation and pays nothing.
    env(&me(), vec![view(&owner(), 1)]);
    s.on_grant(grant_input(100, 1000, 500), Ok(ControlView { owner: owner(), generation: 1 }));
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(3)), PromiseOrValue::Promise(_)));
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_pay(inv(3), Ok(ControlView { owner: buyer(), generation: 2 })), PromiseOrValue::Value(v) if v == "E_GRANT_ENDED"));
    // The new owner grants at generation 2 and the old awaiting invoice can't be approved into it.
    env(&me(), vec![view(&buyer(), 2)]);
    s.on_grant(Grant { granted_by: buyer(), ..grant_input(100, 1000, 500) }, Ok(ControlView { owner: buyer(), generation: 2 }));
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_approve(buyer(), inv(2), Ok(ControlView { owner: buyer(), generation: 2 })), PromiseOrValue::Value(v) if v == "E_GRANT_ENDED"));
    assert_eq!(alw(&s)["reserved"], "0");
}

#[test]
fn s06_finding_a_payment_started_before_the_close_lands_after_it() {
    // pay() at block N, get_control read at N+1 (owner still the seller, generation 1), close lands in
    // N+1 after that read, on_pay at N+2 with the stale view: the transfer goes out. Same for
    // withdraw(). The unit test can only hand the callback the stale view; the window is the chain's.
    let mut s = fixture();
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(1)), PromiseOrValue::Promise(_)));
    env(&owner(), vec![]);
    s.withdraw(U128(9900));
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_pay(inv(1), Ok(ControlView { owner: owner(), generation: 1 })), PromiseOrValue::Promise(_)));
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_withdraw(owner(), U128(9900), Ok(ControlView { owner: owner(), generation: 1 })), PromiseOrValue::Promise(_)));
    assert_eq!(ft_transfers(), vec![(owner().to_string(), 9900)]);
}

#[test]
fn s07_supplier_cannot_claim_twice_or_claim_another_suppliers_money() {
    let mut s = fixture();
    env(&agent(), vec![]);
    s.pay(supplier(), U128(100), inv(1));
    env(&me(), vec![view(&owner(), 1)]);
    s.on_pay(inv(1), Ok(ControlView { owner: owner(), generation: 1 }));
    env(&me(), vec![PromiseResult::Failed]);
    assert_eq!(s.on_sent(inv(1)), "claim");
    assert_eq!(s.get_claim(supplier()).0, 100);
    assert_eq!(alw(&s)["claims_total"], "100");
    assert_eq!(alw(&s)["available"], "9900");
    env(&acc("supplier2.test.near"), vec![]);
    expect_refused("E_NO_CLAIM", || s.claim());
    env(&supplier(), vec![]);
    s.claim();
    assert_eq!(ft_transfers(), vec![(supplier().to_string(), 100)]);
    env(&supplier(), vec![]);
    expect_refused("E_NO_CLAIM", || s.claim());
    // The retry fails again: restored once, not doubled.
    env(&me(), vec![PromiseResult::Failed]);
    assert_eq!(s.on_claimed(supplier(), U128(100)), "claim");
    assert_eq!(s.get_claim(supplier()).0, 100);
    env(&supplier(), vec![]);
    s.claim();
    env(&me(), vec![PromiseResult::Successful(vec![])]);
    assert_eq!(s.on_claimed(supplier(), U128(100)), "paid");
    assert_eq!(s.get_claim(supplier()).0, 0);
    assert_eq!(alw(&s)["balance"], "9900");
    assert_eq!(alw(&s)["claims_total"], "0");
    assert_eq!(alw(&s)["reserved"], "0");
    // A refused or paid invoice can't be resubmitted to be paid twice.
    env(&agent(), vec![]);
    expect_refused("E_REPLAY", || s.pay(supplier(), U128(100), inv(1)));
}

#[test]
fn s08_finding_anyone_can_reserve_the_budget_for_two_blocks() {
    // `withdraw` reserves before it knows who is calling. A stream of such calls keeps `available`
    // at zero, so the agent's payments are refused with E_BUDGET until each refusal lands.
    let mut s = fixture();
    env(&acc("mallory.test.near"), vec![]);
    s.withdraw(U128(10_000));
    assert_eq!(alw(&s)["available"], "0");
    env(&agent(), vec![]);
    expect_refused("E_BUDGET", || s.pay(supplier(), U128(1), inv(1)));
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_withdraw(acc("mallory.test.near"), U128(10_000), Ok(ControlView { owner: owner(), generation: 1 })), PromiseOrValue::Value(v) if v == "E_NOT_OWNER"));
    assert_eq!(alw(&s)["available"], "10000");
    assert!(ft_transfers().is_empty());
}

#[test]
fn s09_finding_every_invoice_grows_storage_that_nobody_pays_for() {
    let mut s = fixture();
    let mut grown = 0u64;
    for n in 1..=10u8 {
        env(&agent(), vec![]);
        let before = env::storage_usage();
        s.pay(supplier(), U128(1), inv(n));
        s.payments.flush();
        grown += env::storage_usage() - before;
        assert_eq!(env::attached_deposit().as_yoctonear(), 0);
    }
    assert!(grown > 1_500, "ten invoices grew storage by {grown} bytes with no deposit attached");
    println!("ten invoices grew storage by {grown} bytes");
}

#[test]
fn s10_outsider_approve_grant_and_claim_do_nothing() {
    let mut s = fixture();
    env(&agent(), vec![]);
    s.pay(supplier(), U128(600), inv(1));
    let mallory = acc("mallory.test.near");
    env(&mallory, vec![]);
    s.approve(inv(1));
    env(&me(), vec![view(&owner(), 1)]);
    expect_refused("E_NOT_OWNER", || s.on_approve(mallory.clone(), inv(1), Ok(ControlView { owner: owner(), generation: 1 })));
    assert_eq!(s.get_payment(inv(1)).unwrap().state, PaymentState::AwaitingApproval);
    assert!(ft_transfers().is_empty());
    env(&mallory, vec![]);
    s.grant(mallory.clone(), vec![mallory.clone()], U128(1), U128(1), U64(DAY), U128(1));
    env(&me(), vec![view(&owner(), 1)]);
    expect_refused("E_NOT_OWNER", || s.on_grant(Grant { agent: mallory.clone(), suppliers: vec![mallory.clone()], granted_by: mallory.clone(), ..grant_input(1, 1, 1) }, Ok(ControlView { owner: owner(), generation: 1 })));
    assert_eq!(s.grant.as_ref().unwrap().agent, agent());
    env(&mallory, vec![]);
    expect_refused("E_NO_CLAIM", || s.claim());
    expect_refused("E_NO_PAYMENT", || s.approve(inv(9)));
    // Grant input validation.
    env(&owner(), vec![]);
    expect_refused("E_INPUT", || s.grant(agent(), vec![], U128(1), U128(1), U64(DAY), U128(1)));
    expect_refused("E_INPUT", || s.grant(agent(), vec![supplier()], U128(2), U128(1), U64(DAY), U128(2)));
    expect_refused("E_INPUT", || s.grant(agent(), vec![supplier()], U128(2), U128(2), U64(DAY), U128(1)));
    expect_refused("E_INPUT", || s.grant(agent(), vec![supplier()], U128(1), U128(1), U64(59_999), U128(1)));
    expect_refused("E_INPUT", || s.grant(agent(), (0..11).map(|i| acc(&format!("s{i}.test.near"))).collect(), U128(1), U128(1), U64(DAY), U128(1)));
}

#[test]
fn s11_approval_cannot_cover_a_different_invoice_or_a_changed_amount() {
    let mut s = fixture();
    env(&agent(), vec![]);
    s.pay(supplier(), U128(600), inv(1));
    env(&agent(), vec![]);
    s.pay(acc("supplier2.test.near"), U128(100), inv(2)); // its on_pay has not run yet
    env(&owner(), vec![]);
    s.approve(inv(1));
    env(&me(), vec![view(&owner(), 1)]);
    s.on_approve(owner(), inv(1), Ok(ControlView { owner: owner(), generation: 1 }));
    // Only invoice 1's supplier and amount are paid by that approval.
    assert_eq!(ft_transfers(), vec![(supplier().to_string(), 600)]);
    assert_eq!(s.get_payment(inv(2)).unwrap().state, PaymentState::Sending);
    assert_eq!(s.get_payment(inv(2)).unwrap().amount.0, 100);
    // A sending invoice can't be approved again from the entry point.
    env(&owner(), vec![]);
    expect_refused("E_STATE", || s.approve(inv(1)));
}

#[test]
fn s12_note_refused_invoices_can_never_be_retried_and_a_huge_period_bricks_pay() {
    let mut s = fixture();
    env(&agent(), vec![]);
    s.pay(supplier(), U128(100), inv(1));
    env(&me(), vec![PromiseResult::Failed]);
    assert!(matches!(s.on_pay(inv(1), Err(PromiseError::Failed)), PromiseOrValue::Value(v) if v == "E_CONTROL_UNREAD"));
    env(&agent(), vec![]);
    expect_refused("E_REPLAY", || s.pay(supplier(), U128(100), inv(1)));
    // A grant with period_ms near u64::MAX makes roll_period overflow: every pay panics.
    env(&me(), vec![view(&owner(), 1)]);
    s.on_grant(Grant { period_ms: U64(u64::MAX), ..grant_input(100, 1000, 500) }, Ok(ControlView { owner: owner(), generation: 1 }));
    env(&agent(), vec![]);
    let m = refused(|| s.pay(supplier(), U128(1), inv(2))).expect("overflow");
    assert!(m.contains("overflow"), "{m}");
}
