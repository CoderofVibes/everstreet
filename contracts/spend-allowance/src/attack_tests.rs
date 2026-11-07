//! Attack review of 2026-11-07 (reports/2026-11-07_attack-review.md): the reviewer's tests, written
//! against a test-stripped copy and kept here as regression tests. A `*_fixed_*` test shows an
//! attack that succeeded in the review now refused (findings 3, 4, 5, 7 and 8); a `*_documented_*`
//! test shows behaviour that is known and documented rather than fixed in the contract (finding 2);
//! every other test shows the contract refusing an attack.
//! Callbacks are called directly with simulated promise results (`#[private]` is wrapper-enforced).

// A callback's returned promise is scheduled when dropped; the tests then read the receipts.
#![allow(unused_must_use)]

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_700_000_000_000;
/// What the tests attach to every call (pay needs its storage; other methods ignore it here).
const DEPOSIT: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR

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

fn env_dep(pred: &AccountId, now_ms: u64, deposit: u128, results: Vec<PromiseResult>) {
    let ctx = VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred.clone())
        .block_timestamp(now_ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}
fn env_at(pred: &AccountId, now_ms: u64, results: Vec<PromiseResult>) {
    env_dep(pred, now_ms, DEPOSIT, results);
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

/// NEAR transfers created (storage refunds), as (receiver, yocto).
fn near_transfers() -> Vec<(String, u128)> {
    let mut out = vec![];
    for r in get_created_receipts() {
        for a in &r.actions {
            if let MockAction::Transfer { deposit, .. } = a {
                out.push((r.receiver_id.to_string(), deposit.as_yoctonear()));
            }
        }
    }
    out
}

fn calls(method: &str) -> usize {
    get_created_receipts()
        .iter()
        .flat_map(|r| r.actions.iter())
        .filter(|a| matches!(a, MockAction::FunctionCallWeight { method_name, .. } if method_name == method.as_bytes()))
        .count()
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

fn state(s: &SpendAllowance, n: u8) -> PaymentState {
    s.get_payment(inv(n)).unwrap().state
}

fn gen(owner: &AccountId, generation: u32) -> Result<ControlView, PromiseError> {
    Ok(ControlView { owner: owner.clone(), generation })
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
fn s03_fixed_a_repeated_approve_is_refused_and_the_invoice_is_paid_once() {
    let mut s = fixture();
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(600), inv(1)), PromiseOrValue::Value(v) if v == "awaiting_approval"));
    assert_eq!(alw(&s)["reserved"], "600");
    // The owner's wallet sends `approve` twice (a retry, or two keys in one block): the first moves
    // the invoice to Approving before asking the business, so the second is refused.
    env(&owner(), vec![]);
    s.approve(inv(1));
    assert_eq!(state(&s, 1), PaymentState::Approving);
    env(&owner(), vec![]);
    expect_refused("E_STATE", || s.approve(inv(1)));
    // The one callback sends one transfer.
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_approve(owner(), inv(1), gen(&owner(), 1)), PromiseOrValue::Promise(_)));
    assert_eq!(ft_transfers(), vec![(supplier().to_string(), 600)]);
    assert_eq!(state(&s, 1), PaymentState::Sending);
    // Even a duplicated callback (it can't happen now) would send nothing.
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_approve(owner(), inv(1), gen(&owner(), 1)), PromiseOrValue::Value(v) if v == "E_STATE"));
    assert!(ft_transfers().is_empty());
    // The transfer settles once; a second settlement changes nothing and never underflows.
    env(&me(), vec![PromiseResult::Successful(vec![])]);
    assert_eq!(s.on_sent(inv(1)), "paid");
    env(&me(), vec![PromiseResult::Successful(vec![])]);
    assert_eq!(s.on_sent(inv(1)), "E_STATE");
    assert_eq!(alw(&s)["reserved"], "0");
    assert_eq!(alw(&s)["balance"], "9400", "the books match the token: 600 left once");
    assert_eq!(alw(&s)["spent_in_period"], "600");
    assert_eq!(state(&s, 1), PaymentState::Paid);
}

#[test]
fn s04_fixed_the_owner_can_reject_and_anyone_can_expire_a_waiting_invoice() {
    let mut s = fixture();
    // The agent reserves the whole budget with reviewable invoices, one period at a time.
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(1000), inv(1)), PromiseOrValue::Value(v) if v == "awaiting_approval"));
    for d in 1..=9u64 {
        env_at(&agent(), T0 + d * DAY, vec![]);
        assert!(matches!(s.pay(supplier(), U128(1000), inv(d as u8 + 1)), PromiseOrValue::Value(v) if v == "awaiting_approval"));
    }
    assert_eq!(alw(&s)["available"], "0");
    assert_eq!(alw(&s)["spent_in_period"], "1000", "inv(10), counted in the current period");
    let now = T0 + 10 * DAY;
    // An outsider can neither reject nor approve (cheap filter before any call) ...
    let mallory = acc("mallory.test.near");
    env_at(&mallory, now, vec![]);
    expect_refused("E_NOT_OWNER", || s.reject(inv(10)));
    expect_refused("E_NOT_OWNER", || s.approve(inv(10)));
    // ... but may expire an invoice that has waited 7 days. inv(1) waited 10 days; inv(4) (made at
    // T0 + 3 days) exactly 7. inv(5) is a day short.
    expect_refused("E_NOT_EXPIRED", || s.expire_invoice(inv(5)));
    assert_eq!(s.expire_invoice(inv(1)), "expired");
    assert_eq!(s.expire_invoice(inv(4)), "expired");
    assert_eq!(state(&s, 1), PaymentState::Refused);
    expect_refused("E_STATE", || s.expire_invoice(inv(1)));
    assert_eq!(alw(&s)["reserved"], "8000");
    assert_eq!(alw(&s)["available"], "2000");
    // Releasing an invoice counted in an earlier period doesn't lower this period's count.
    assert_eq!(alw(&s)["spent_in_period"], "1000");
    // The owner rejects inv(10): Rejecting first, so a second reject (or an approve) is refused
    // while it is in flight; the business confirms the owner and the reservation is released.
    env_at(&owner(), now, vec![]);
    s.reject(inv(10));
    assert_eq!(state(&s, 10), PaymentState::Rejecting);
    expect_refused("E_STATE", || s.reject(inv(10)));
    expect_refused("E_STATE", || s.approve(inv(10)));
    expect_refused("E_STATE", || s.expire_invoice(inv(10)));
    env_at(&me(), now, vec![view(&owner(), 1)]);
    assert_eq!(s.on_reject(owner(), inv(10), gen(&owner(), 1)), "rejected");
    assert_eq!(state(&s, 10), PaymentState::Refused);
    assert!(get_logs().iter().any(|l| l.contains("payment_refused") && l.contains("E_REJECTED")));
    assert_eq!(alw(&s)["reserved"], "7000");
    assert_eq!(alw(&s)["spent_in_period"], "0");
    assert!(ft_transfers().is_empty());
    // A rejection the business doesn't confirm (control moved, or unreadable) waits again.
    env_at(&owner(), now, vec![]);
    s.reject(inv(9));
    env_at(&me(), now, vec![view(&buyer(), 2)]);
    assert_eq!(s.on_reject(owner(), inv(9), gen(&buyer(), 2)), "E_NOT_OWNER");
    assert_eq!(state(&s, 9), PaymentState::AwaitingApproval);
    env_at(&owner(), now, vec![]);
    s.reject(inv(9));
    env_at(&me(), now, vec![PromiseResult::Failed]);
    assert_eq!(s.on_reject(owner(), inv(9), Err(PromiseError::Failed)), "E_CONTROL_UNREAD");
    assert_eq!(state(&s, 9), PaymentState::AwaitingApproval);
    assert_eq!(alw(&s)["reserved"], "7000");
    // The released budget is the owner's to withdraw.
    env_at(&owner(), now, vec![]);
    s.withdraw(U128(3000));
    env_at(&me(), now, vec![view(&owner(), 1)]);
    assert!(matches!(s.on_withdraw(owner(), U128(3000), gen(&owner(), 1)), PromiseOrValue::Promise(_)));
    assert_eq!(ft_transfers(), vec![(owner().to_string(), 3000)]);
}

#[test]
fn s05_stale_grant_pays_nothing_after_control_moves() {
    let mut s = fixture(); // grant at generation 1
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(1)), PromiseOrValue::Promise(_)));
    // The business now answers generation 2 (a close landed).
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_pay(inv(1), gen(&buyer(), 2)), PromiseOrValue::Value(v) if v == "E_GRANT_ENDED"));
    assert!(ft_transfers().is_empty());
    assert_eq!(alw(&s)["reserved"], "0");
    assert_eq!(alw(&s)["spent_in_period"], "0");
    assert_eq!(s.get_payment(inv(1)).unwrap().state, PaymentState::Refused);
    // The former owner cannot grant again, approve, or withdraw.
    env(&me(), vec![view(&buyer(), 2)]);
    expect_refused("E_NOT_OWNER", || s.on_grant(grant_input(100, 1000, 500), gen(&buyer(), 2)));
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(600), inv(2)), PromiseOrValue::Value(v) if v == "awaiting_approval"));
    env(&owner(), vec![]);
    s.approve(inv(2));
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_approve(owner(), inv(2), gen(&buyer(), 2)), PromiseOrValue::Value(v) if v == "E_NOT_OWNER"));
    assert_eq!(state(&s, 2), PaymentState::AwaitingApproval);
    env(&owner(), vec![]);
    s.withdraw(U128(100));
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_withdraw(owner(), U128(100), gen(&buyer(), 2)), PromiseOrValue::Value(v) if v == "E_NOT_OWNER"));
    assert!(ft_transfers().is_empty());
    assert_eq!(alw(&s)["reserved"], "600"); // only the awaiting invoice
    // A former-owner grant that read a stale view is installed at the old generation and pays nothing.
    env(&me(), vec![view(&owner(), 1)]);
    s.on_grant(grant_input(100, 1000, 500), gen(&owner(), 1));
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(3)), PromiseOrValue::Promise(_)));
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_pay(inv(3), gen(&buyer(), 2)), PromiseOrValue::Value(v) if v == "E_GRANT_ENDED"));
    // The new owner grants at generation 2 and the old awaiting invoice can't be approved into it.
    env(&me(), vec![view(&buyer(), 2)]);
    s.on_grant(Grant { granted_by: buyer(), ..grant_input(100, 1000, 500) }, gen(&buyer(), 2));
    env(&buyer(), vec![]);
    s.approve(inv(2));
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_approve(buyer(), inv(2), gen(&buyer(), 2)), PromiseOrValue::Value(v) if v == "E_GRANT_ENDED"));
    assert_eq!(alw(&s)["reserved"], "0");
}

#[test]
fn s06_documented_a_payment_started_before_the_close_lands_after_it() {
    // Finding 2, not fixed in the contract (documented): pay() at block N, get_control read at N+1
    // (owner still the seller, generation 1), close lands in N+1 after that read, on_pay at N+2 with
    // the stale view: the transfer goes out. Same for withdraw(). The unit test can only hand the
    // callback the stale view; the window is the chain's.
    let mut s = fixture();
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(1)), PromiseOrValue::Promise(_)));
    env(&owner(), vec![]);
    s.withdraw(U128(9900));
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_pay(inv(1), gen(&owner(), 1)), PromiseOrValue::Promise(_)));
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_withdraw(owner(), U128(9900), gen(&owner(), 1)), PromiseOrValue::Promise(_)));
    assert_eq!(ft_transfers(), vec![(owner().to_string(), 9900)]);
}

#[test]
fn s07_supplier_cannot_claim_twice_or_claim_another_suppliers_money() {
    let mut s = fixture();
    env(&agent(), vec![]);
    s.pay(supplier(), U128(100), inv(1));
    env(&me(), vec![view(&owner(), 1)]);
    s.on_pay(inv(1), gen(&owner(), 1));
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
    // A claimed (once failed) invoice can't be resubmitted to be paid twice.
    env(&agent(), vec![]);
    expect_refused("E_REPLAY", || s.pay(supplier(), U128(100), inv(1)));
}

#[test]
fn s08_fixed_nobody_but_the_owner_can_reserve_the_budget() {
    // `withdraw` reserves only after the business confirms the owner (in the callback), so an
    // outsider's withdrawal holds nothing while it is in flight.
    let mut s = fixture();
    let mallory = acc("mallory.test.near");
    env(&mallory, vec![]);
    s.withdraw(U128(10_000));
    assert_eq!(alw(&s)["available"], "10000");
    assert_eq!(alw(&s)["reserved"], "0");
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(1), inv(1)), PromiseOrValue::Promise(_)));
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_withdraw(mallory.clone(), U128(10_000), gen(&owner(), 1)), PromiseOrValue::Value(v) if v == "E_NOT_OWNER"));
    assert_eq!(alw(&s)["available"], "9999");
    assert!(ft_transfers().is_empty());
    // The owner's withdrawal is checked again against what is free when the business answers.
    env(&owner(), vec![]);
    s.withdraw(U128(9999));
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(2)), PromiseOrValue::Promise(_)));
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_withdraw(owner(), U128(9999), gen(&owner(), 1)), PromiseOrValue::Value(v) if v == "E_AVAILABLE"));
    assert!(ft_transfers().is_empty());
    assert_eq!(alw(&s)["reserved"], "101");
    // A new owner's first withdrawal is never blocked by a filter: only the business decides.
    env(&buyer(), vec![]);
    s.withdraw(U128(9899));
    env(&me(), vec![view(&buyer(), 2)]);
    assert!(matches!(s.on_withdraw(buyer(), U128(9899), gen(&buyer(), 2)), PromiseOrValue::Promise(_)));
    assert_eq!(ft_transfers(), vec![(buyer().to_string(), 9899)]);
    assert_eq!(alw(&s)["reserved"], "10000");
    env(&me(), vec![PromiseResult::Successful(vec![])]);
    assert_eq!(s.on_withdrawn(buyer(), U128(9899)), "withdrawn");
    assert_eq!((alw(&s)["reserved"].clone(), alw(&s)["balance"].clone()), ("101".into(), "101".into()));
}

#[test]
fn s09_fixed_the_agent_pays_for_every_record_it_creates() {
    let mut s = fixture();
    let byte_cost = env::storage_byte_cost().as_yoctonear();
    // Nothing attached: refused, nothing recorded.
    env_dep(&agent(), T0, 0, vec![]);
    expect_refused("E_STORAGE", || s.pay(supplier(), U128(1), inv(99)));
    // (On chain the panic reverts the record; the unit host keeps writes made before a panic.)
    // Each invoice is charged its measured growth; the rest of the deposit is refunded.
    let mut grown = 0u64;
    for n in 1..=10u8 {
        env(&agent(), vec![]);
        let before = env::storage_usage();
        s.pay(supplier(), U128(1), inv(n));
        let bytes = env::storage_usage() - before;
        grown += bytes;
        assert!(bytes > 100 && bytes <= PAYMENT_BYTES_BOUND, "{bytes} bytes");
        assert_eq!(near_transfers(), vec![(agent().to_string(), DEPOSIT - bytes as u128 * byte_cost)]);
    }
    println!("ten invoices grew storage by {grown} bytes, all paid by the agent");
    // The longest supplier name still fits the advertised bound (`pay_deposit`).
    let long = acc(&format!("{}.test.near", "s".repeat(54)));
    env(&me(), vec![view(&owner(), 1)]);
    s.on_grant(Grant { suppliers: vec![long.clone()], ..grant_input(100, 1000, 500) }, gen(&owner(), 1));
    env(&agent(), vec![]);
    let before = env::storage_usage();
    s.pay(long, U128(1), inv(11));
    assert!(env::storage_usage() - before <= PAYMENT_BYTES_BOUND);
    assert_eq!(alw(&s)["pay_deposit"], (PAYMENT_BYTES_BOUND as u128 * byte_cost).to_string());
    // A refusal in the callback rewrites the record in place: the contract pays nothing for it.
    env(&me(), vec![PromiseResult::Failed]);
    let before = env::storage_usage();
    s.on_pay(inv(11), Err(PromiseError::Failed));
    s.payments.flush();
    assert_eq!(env::storage_usage(), before);
}

#[test]
fn s10_outsider_approve_grant_and_claim_do_nothing() {
    let mut s = fixture();
    env(&agent(), vec![]);
    s.pay(supplier(), U128(600), inv(1));
    let mallory = acc("mallory.test.near");
    env(&mallory, vec![]);
    expect_refused("E_NOT_OWNER", || s.approve(inv(1)));
    expect_refused("E_NOT_OWNER", || s.reject(inv(1)));
    expect_refused("E_NOT_EXPIRED", || s.expire_invoice(inv(1)));
    assert_eq!(state(&s, 1), PaymentState::AwaitingApproval);
    // A caller the business doesn't confirm as the owner gets nothing; the invoice waits again.
    env(&owner(), vec![]);
    s.approve(inv(1));
    env(&me(), vec![view(&owner(), 1)]);
    assert!(matches!(s.on_approve(mallory.clone(), inv(1), gen(&owner(), 1)), PromiseOrValue::Value(v) if v == "E_NOT_OWNER"));
    assert_eq!(s.get_payment(inv(1)).unwrap().state, PaymentState::AwaitingApproval);
    assert!(ft_transfers().is_empty());
    env(&mallory, vec![]);
    s.grant(mallory.clone(), vec![mallory.clone()], U128(1), U128(1), U64(DAY), U128(1));
    env(&me(), vec![view(&owner(), 1)]);
    expect_refused("E_NOT_OWNER", || s.on_grant(Grant { agent: mallory.clone(), suppliers: vec![mallory.clone()], granted_by: mallory.clone(), ..grant_input(1, 1, 1) }, gen(&owner(), 1)));
    assert_eq!(s.grant.as_ref().unwrap().agent, agent());
    env(&mallory, vec![]);
    expect_refused("E_NO_CLAIM", || s.claim());
    expect_refused("E_NO_PAYMENT", || s.approve(inv(9)));
    expect_refused("E_NO_PAYMENT", || s.reject(inv(9)));
    expect_refused("E_NO_PAYMENT", || s.expire_invoice(inv(9)));
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
    s.on_approve(owner(), inv(1), gen(&owner(), 1));
    // Only invoice 1's supplier and amount are paid by that approval.
    assert_eq!(ft_transfers(), vec![(supplier().to_string(), 600)]);
    assert_eq!(s.get_payment(inv(2)).unwrap().state, PaymentState::Sending);
    assert_eq!(s.get_payment(inv(2)).unwrap().amount.0, 100);
    // A sending invoice can't be approved again from the entry point.
    env(&owner(), vec![]);
    expect_refused("E_STATE", || s.approve(inv(1)));
}

#[test]
fn s12_fixed_a_refused_invoice_can_be_retried_and_the_period_is_bounded() {
    let mut s = fixture();
    env(&agent(), vec![]);
    s.pay(supplier(), U128(100), inv(1));
    env(&me(), vec![PromiseResult::Failed]);
    assert!(matches!(s.on_pay(inv(1), Err(PromiseError::Failed)), PromiseOrValue::Value(v) if v == "E_CONTROL_UNREAD"));
    assert_eq!(state(&s, 1), PaymentState::Refused);
    // A refused invoice may be submitted again; the new payment replaces the refused record.
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(100), inv(1)), PromiseOrValue::Promise(_)));
    assert_eq!(state(&s, 1), PaymentState::Sending);
    assert_eq!(calls("get_control"), 1);
    env(&me(), vec![view(&owner(), 1)]);
    s.on_pay(inv(1), gen(&owner(), 1));
    env(&me(), vec![PromiseResult::Successful(vec![])]);
    assert_eq!(s.on_sent(inv(1)), "paid");
    // A paid one never.
    env(&agent(), vec![]);
    expect_refused("E_REPLAY", || s.pay(supplier(), U128(100), inv(1)));
    // The period is 1 hour to 366 days.
    env(&owner(), vec![]);
    expect_refused("E_INPUT", || s.grant(agent(), vec![supplier()], U128(1), U128(1), U64(u64::MAX), U128(1)));
    expect_refused("E_INPUT", || s.grant(agent(), vec![supplier()], U128(1), U128(1), U64(MAX_PERIOD_MS + 1), U128(1)));
    expect_refused("E_INPUT", || s.grant(agent(), vec![supplier()], U128(1), U128(1), U64(MIN_PERIOD_MS - 1), U128(1)));
    s.grant(agent(), vec![supplier()], U128(1), U128(1), U64(MAX_PERIOD_MS), U128(1));
    s.grant(agent(), vec![supplier()], U128(1), U128(1), U64(MIN_PERIOD_MS), U128(1));
    // Even a period that slipped past the bound (a grant installed directly) never overflows: pay
    // works, and an amount that would overflow the period's count is a cap refusal, not a panic.
    env(&me(), vec![view(&owner(), 1)]);
    s.on_grant(Grant { period_ms: U64(u64::MAX), ..grant_input(100, 1000, 500) }, gen(&owner(), 1));
    env(&agent(), vec![]);
    assert!(matches!(s.pay(supplier(), U128(1), inv(2)), PromiseOrValue::Promise(_)));
    env(&agent(), vec![]);
    expect_refused("E_PERIOD_CAP", || s.pay(supplier(), U128(u128::MAX), inv(3)));
}
