//! Unit tests for v2's money rules: only the accepted token, an order paid once, customer money
//! stays the customer's until delivered, refunds by the published rules, payouts that settle or
//! come back, monthly books, and a sale paid in the token that leaves customers untouched.

use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const T0: u64 = 1_793_577_600_000; // 2026-11-02T00:00:00Z

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, yocto: u128, at_ms: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id("juniper.biz.near"))
        .predecessor_account_id(id(who))
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .block_timestamp(at_ms * 1_000_000);
    b
}

fn as_(who: &str) {
    testing_env!(ctx(who, 1, T0).build());
}

fn at(who: &str, ms: u64) {
    testing_env!(ctx(who, 1, ms).build());
}

/// Runs the payout callback as the contract itself, with the transfer succeeding or failing.
fn callback(b: &mut Business, payout: Payout, ok: bool) -> bool {
    let result = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    testing_env!(
        ctx("juniper.biz.near", 0, T0).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
    b.on_payout(payout)
}

fn rules() -> Rules {
    Rules { customer_cancel_refund: true, credit_refundable: true, min_reserve: U128(10) }
}

fn business() -> Business {
    as_("mara.near");
    Business::new("juniper".into(), id("mara.near"), id("tusd.near"), rules())
}

fn pay(b: &mut Business, from: &str, amount: u128, msg: serde_json::Value) -> U128 {
    as_("tusd.near");
    match b.ft_on_transfer(id(from), U128(amount), msg.to_string()) {
        PromiseOrValue::Value(v) => v,
        PromiseOrValue::Promise(_) => panic!("unexpected promise"),
    }
}

fn order(b: &mut Business, oid: &str, from: &str, amount: u128, cancel_before: u64) -> U128 {
    pay(b, from, amount, serde_json::json!({ "order": { "order_id": oid, "offer": "linocut-nov-14", "cancel_before_ms": cancel_before.to_string() } }))
}

#[test]
fn period_is_the_utc_month() {
    assert_eq!(period_of(T0), 202611);
    assert_eq!(period_of(1_709_164_800_000), 202402); // 2024-02-29
    assert_eq!(period_of(0), 197001);
}

#[test]
#[should_panic(expected = "E_ASSET")]
fn only_the_accepted_token_can_pay() {
    let mut b = business();
    as_("other-token.near");
    let _ = b.ft_on_transfer(id("sam.near"), U128(35), r#"{"prepay":{}}"#.into());
}

#[test]
#[should_panic(expected = "E_MSG")]
fn a_payment_must_say_what_it_is_for() {
    let mut b = business();
    pay(&mut b, "sam.near", 35, serde_json::json!({ "tip": {} }));
}

#[test]
fn an_order_is_paid_once_and_held_for_the_customer() {
    let mut b = business();
    assert_eq!(order(&mut b, "o-1", "sam.near", 35_000_000, T0 + 86_400_000).0, 0);
    // The same order id again: the token gets the whole amount back.
    assert_eq!(order(&mut b, "o-1", "sam.near", 35_000_000, T0 + 86_400_000).0, 35_000_000);
    let t = b.get_treasury();
    assert_eq!((t.held.0, t.unearned_orders.0, t.available.0), (35_000_000, 35_000_000, 0));
    assert_eq!(b.get_period(202611).orders_in.0, 35_000_000);
    assert!(get_logs().iter().any(|l| l.contains("order_duplicate_returned")));
}

#[test]
fn delivery_turns_customer_money_into_revenue() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, 0);
    as_("mara.near");
    b.deliver("o-1".into());
    let t = b.get_treasury();
    assert_eq!((t.unearned_orders.0, t.available.0, t.withdrawable.0), (0, 35, 25));
    assert_eq!(b.get_period(202611).earned.0, 35);
    assert_eq!(b.get_order("o-1".into()).unwrap().status, OrderStatus::Delivered);
}

#[test]
#[should_panic(expected = "E_RESERVED")]
fn the_owner_cannot_withdraw_customer_money() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, 0);
    as_("mara.near");
    let _ = b.withdraw_profit(U128(1));
}

#[test]
#[should_panic(expected = "E_RESERVED")]
fn the_owner_cannot_withdraw_into_the_reserve() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, 0);
    as_("mara.near");
    b.deliver("o-1".into());
    let _ = b.withdraw_profit(U128(26));
}

#[test]
fn a_withdrawal_settles_or_comes_back() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, 0);
    as_("mara.near");
    b.deliver("o-1".into());
    let _ = b.withdraw_profit(U128(25));
    assert_eq!(b.get_treasury().pending_payouts.0, 25);
    let payout = Payout::Profit { to: id("mara.near"), amount: U128(25) };
    assert!(!callback(&mut b, payout.clone(), false));
    let t = b.get_treasury();
    assert_eq!((t.available.0, t.pending_payouts.0, t.held.0), (35, 0, 35));
    as_("mara.near");
    let _ = b.withdraw_profit(U128(25));
    assert!(callback(&mut b, payout, true));
    let t = b.get_treasury();
    assert_eq!((t.available.0, t.pending_payouts.0, t.held.0), (10, 0, 10));
    assert_eq!(b.get_period(202611).owner_withdrawals.0, 25);
}

#[test]
fn the_customer_cancels_in_time_and_is_refunded() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, T0 + 1000);
    as_("sam.near");
    let _ = b.cancel_order("o-1".into());
    assert_eq!(b.get_order("o-1".into()).unwrap().status, OrderStatus::Refunding);
    let payout = Payout::Refund { order_id: "o-1".into(), to: id("sam.near"), amount: U128(35) };
    callback(&mut b, payout, true);
    assert_eq!(b.get_order("o-1".into()).unwrap().status, OrderStatus::Refunded);
    let t = b.get_treasury();
    assert_eq!((t.held.0, t.unearned_orders.0, t.pending_payouts.0), (0, 0, 0));
    assert_eq!(b.get_period(202611).refunds.0, 35);
}

#[test]
fn a_failed_refund_puts_the_order_back() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, T0 + 1000);
    as_("sam.near");
    let _ = b.cancel_order("o-1".into());
    callback(&mut b, Payout::Refund { order_id: "o-1".into(), to: id("sam.near"), amount: U128(35) }, false);
    assert_eq!(b.get_order("o-1".into()).unwrap().status, OrderStatus::Paid);
    assert_eq!(b.get_treasury().unearned_orders.0, 35);
}

#[test]
#[should_panic(expected = "E_DEADLINE")]
fn no_cancellation_refund_after_the_deadline() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, T0 + 1000);
    at("sam.near", T0 + 1000);
    let _ = b.cancel_order("o-1".into());
}

#[test]
#[should_panic(expected = "E_NOT_CUSTOMER")]
fn only_the_customer_cancels() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, T0 + 1000);
    as_("mara.near");
    let _ = b.cancel_order("o-1".into());
}

#[test]
fn the_business_can_refund_but_not_twice() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, 0);
    as_("mara.near");
    let _ = b.refund_order("o-1".into());
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        as_("mara.near");
        let _ = b.refund_order("o-1".into());
    }));
    assert!(again.is_err());
}

#[test]
fn credit_is_used_for_work_and_the_rest_can_be_taken_back() {
    let mut b = business();
    pay(&mut b, "cedar.near", 50, serde_json::json!({ "prepay": {} }));
    as_("mara.near");
    b.use_credit(id("cedar.near"), U128(5), "500 renders".into());
    assert_eq!(b.credit_of(id("cedar.near")).0, 45);
    as_("cedar.near");
    let _ = b.withdraw_credit(U128(45));
    callback(&mut b, Payout::Credit { to: id("cedar.near"), amount: U128(45) }, true);
    let t = b.get_treasury();
    assert_eq!((t.held.0, t.customer_credit.0, t.available.0), (5, 0, 5));
    let p = b.get_period(202611);
    assert_eq!((p.prepaid_in.0, p.credit_used.0, p.credit_withdrawn.0, p.earned.0), (50, 5, 45, 5));
}

fn sale(b: &mut Business) -> String {
    as_("mara.near");
    b.propose_sale("D-1".into(), id("northline.near"), U128(1000), U64(T0 + 3_600_000), "1".repeat(64));
    b.get_deal("D-1".into()).unwrap().digest
}

#[test]
#[should_panic(expected = "E_FUNDS: fund the deal")]
fn the_buyer_must_fund_before_accepting() {
    let mut b = business();
    let d = sale(&mut b);
    as_("northline.near");
    b.accept_sale("D-1".into(), d);
}

#[test]
#[should_panic(expected = "E_FUNDS: fund exactly the price")]
fn funding_must_match_the_price() {
    let mut b = business();
    sale(&mut b);
    pay(&mut b, "northline.near", 999, serde_json::json!({ "fund_deal": { "deal_id": "D-1" } }));
}

#[test]
fn a_sale_pays_the_seller_and_leaves_customers_untouched() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, T0 + 1000);
    pay(&mut b, "cedar.near", 50, serde_json::json!({ "prepay": {} }));
    let d = sale(&mut b);
    pay(&mut b, "northline.near", 1000, serde_json::json!({ "fund_deal": { "deal_id": "D-1" } }));
    as_("mara.near");
    b.accept_sale("D-1".into(), d.clone());
    as_("northline.near");
    b.accept_sale("D-1".into(), d);
    let c = b.get_control();
    assert_eq!((c.owner, c.generation), (id("northline.near"), 2));
    let t = b.get_treasury();
    assert_eq!((t.unearned_orders.0, t.customer_credit.0, t.deal_holds.0, t.seller_proceeds.0), (35, 50, 0, 1000));
    assert_eq!(b.proceeds_of(id("mara.near")).0, 1000);
    assert_eq!(b.get_period(202611).sale_proceeds.0, 1000);
    // The customer can still cancel the order they paid under the previous owner.
    as_("sam.near");
    let _ = b.cancel_order("o-1".into());
    // The former owner can collect proceeds but can no longer act as owner.
    as_("mara.near");
    let _ = b.claim_proceeds();
    assert_eq!(b.get_treasury().pending_payouts.0, 1035);
    let after = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        as_("mara.near");
        b.appoint_operator(id("mara-helper.near"), vec!["support".into()]);
    }));
    assert!(after.is_err());
}

#[test]
fn a_revised_price_lets_the_buyer_take_the_hold_back() {
    let mut b = business();
    sale(&mut b);
    pay(&mut b, "northline.near", 1000, serde_json::json!({ "fund_deal": { "deal_id": "D-1" } }));
    as_("mara.near");
    b.revise_sale("D-1".into(), U128(1500), U64(T0 + 3_600_000), "2".repeat(64));
    as_("northline.near");
    let _ = b.withdraw_deal_hold("D-1".into());
    callback(&mut b, Payout::DealHold { deal_id: "D-1".into(), to: id("northline.near"), amount: U128(1000) }, true);
    let t = b.get_treasury();
    assert_eq!((t.deal_holds.0, t.held.0), (0, 0));
}

#[test]
#[should_panic(expected = "E_NOT_AUTHORIZED")]
fn an_operator_without_fulfillment_cannot_deliver() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 35, 0);
    as_("mara.near");
    b.appoint_operator(id("helper.near"), vec!["support".into()]);
    as_("helper.near");
    b.deliver("o-1".into());
}

// ---------- Characterization (job 003a) ----------
//
// These tests pass by asserting what v2 does today; they change no behaviour. Tests named
// `gap_…` pin down behaviour the digital 100/20/80 journey must not rely on. See
// docs/astra/reports/2026-11-02_003a_characterize-credit-and-close.md.

fn prepaid(b: &mut Business, who: &str, amount: u128) {
    pay(b, who, amount, serde_json::json!({ "prepay": {} }));
}

fn fund(b: &mut Business) {
    pay(b, "northline.near", 1000, serde_json::json!({ "fund_deal": { "deal_id": "D-1" } }));
}

fn buckets_add_up(b: &Business) -> bool {
    let t = b.get_treasury();
    t.held.0
        == t.customer_credit.0
            + t.unearned_orders.0
            + t.available.0
            + t.pending_payouts.0
            + t.deal_holds.0
            + t.seller_proceeds.0
}

#[test]
fn gap_a_fulfillment_operator_spends_customer_credit_without_the_customer() {
    let mut b = business();
    prepaid(&mut b, "cedar.near", 50);
    as_("mara.near");
    // Everstreet appoints every helper with both capabilities (server/src/payments.ts).
    b.appoint_operator(id("helper.near"), vec!["support".into(), "fulfillment".into()]);
    as_("helper.near");
    b.use_credit(id("cedar.near"), U128(50), "no customer signature, policy or cap".into());
    assert_eq!(b.credit_of(id("cedar.near")).0, 0);
    let t = b.get_treasury();
    assert_eq!((t.customer_credit.0, t.available.0, t.withdrawable.0), (0, 50, 40));
    // The owner can then withdraw it above the reserve.
    as_("mara.near");
    let _ = b.withdraw_profit(U128(40));
    assert_eq!(b.get_treasury().pending_payouts.0, 40);
}

#[test]
fn gap_the_same_memo_charges_credit_twice() {
    let mut b = business();
    prepaid(&mut b, "cedar.near", 50);
    as_("mara.near");
    b.use_credit(id("cedar.near"), U128(5), "usage-0001".into());
    as_("mara.near");
    b.use_credit(id("cedar.near"), U128(5), "usage-0001".into());
    // The memo is only logged; nothing records or checks it.
    assert_eq!(b.credit_of(id("cedar.near")).0, 40);
    assert_eq!(b.get_period(202611).credit_used.0, 10);
}

#[test]
fn two_prepayments_are_two_deposits_not_a_replay() {
    let mut b = business();
    prepaid(&mut b, "cedar.near", 25);
    prepaid(&mut b, "cedar.near", 25);
    // Two token transfers moved money twice; v2 credits both (unlike a repeated order id).
    assert_eq!(b.credit_of(id("cedar.near")).0, 50);
    assert_eq!(b.get_period(202611).prepaid_in.0, 50);
    assert_eq!(b.get_treasury().held.0, 50);
}

#[test]
fn gap_the_seller_can_withdraw_between_the_buyers_acceptance_and_their_own() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 100, 0);
    as_("mara.near");
    b.deliver("o-1".into());
    let d = sale(&mut b);
    fund(&mut b);
    as_("northline.near");
    b.accept_sale("D-1".into(), d.clone());
    as_("mara.near");
    let _ = b.withdraw_profit(U128(90));
    // The digest covers parties, price, expiry, terms and generation, not the treasury, so the
    // buyer's acceptance still matches after the withdrawal.
    let after = b.get_deal("D-1".into()).unwrap();
    assert_eq!(after.digest, d);
    assert_eq!(after.deal.buyer_accepted.as_deref(), Some(d.as_str()));
    as_("mara.near");
    b.accept_sale("D-1".into(), d);
    assert_eq!(b.get_control().owner, id("northline.near"));
    let t = b.get_treasury();
    assert_eq!((t.available.0, t.pending_payouts.0), (10, 90));
}

#[test]
fn the_second_matching_acceptance_closes_in_the_same_call() {
    let mut b = business();
    as_("mara.near");
    b.appoint_operator(id("helper.near"), vec!["fulfillment".into()]);
    let d = sale(&mut b);
    fund(&mut b);
    as_("mara.near");
    b.accept_sale("D-1".into(), d.clone());
    let c = b.get_control();
    assert_eq!((c.owner.clone(), c.generation, c.operators.len()), (id("mara.near"), 1, 1));
    assert_eq!(b.get_deal("D-1".into()).unwrap().deal.status, DealStatus::Open);
    as_("northline.near");
    b.accept_sale("D-1".into(), d);
    // No intermediate state: owner, generation, grants and status changed in this one call.
    let c = b.get_control();
    assert_eq!((c.owner, c.generation, c.operators.len()), (id("northline.near"), 2, 0));
    assert_eq!(b.get_deal("D-1".into()).unwrap().deal.status, DealStatus::Closed);
    assert!(!b.operator_check(id("helper.near"), "fulfillment".into()).authorized);
}

#[test]
fn gap_a_balance_read_reserves_nothing_against_a_customer_withdrawal() {
    let mut b = business();
    prepaid(&mut b, "cedar.near", 50);
    // An off-chain service reads the balance and serves usage on the strength of it...
    let seen = b.credit_of(id("cedar.near")).0;
    // ...the customer withdraws before the usage is charged...
    as_("cedar.near");
    let _ = b.withdraw_credit(U128(50));
    callback(&mut b, Payout::Credit { to: id("cedar.near"), amount: U128(50) }, true);
    // ...and the charge for work already delivered fails.
    let charge = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        as_("mara.near");
        b.use_credit(id("cedar.near"), U128(5), "usage served before the withdrawal".into());
    }));
    assert_eq!(seen, 50);
    assert!(charge.is_err());
    assert_eq!(b.credit_of(id("cedar.near")).0, 0);
}

#[test]
fn coverage_holds_across_a_sale_but_consent_does_not() {
    let mut b = business();
    prepaid(&mut b, "cedar.near", 50);
    order(&mut b, "o-1", "sam.near", 35, T0 + 1000);
    let d = sale(&mut b);
    fund(&mut b);
    as_("northline.near");
    b.accept_sale("D-1".into(), d.clone());
    as_("mara.near");
    b.accept_sale("D-1".into(), d);
    // Coverage: every unit is still in exactly one bucket, customers' included.
    assert!(buckets_add_up(&b));
    let t = b.get_treasury();
    assert_eq!((t.customer_credit.0, t.unearned_orders.0), (50, 35));
    // The former owner is refused...
    let old = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        as_("mara.near");
        b.use_credit(id("cedar.near"), U128(1), "former owner".into());
    }));
    assert!(old.is_err());
    // ...but the new owner can charge the customer's credit without the customer.
    as_("northline.near");
    b.use_credit(id("cedar.near"), U128(50), "new owner, no customer consent".into());
    assert_eq!(b.credit_of(id("cedar.near")).0, 0);
    assert!(buckets_add_up(&b));
}

#[test]
fn gap_a_failed_profit_payout_returns_to_the_buyer_after_the_close() {
    let mut b = business();
    order(&mut b, "o-1", "sam.near", 100, 0);
    as_("mara.near");
    b.deliver("o-1".into());
    as_("mara.near");
    let _ = b.withdraw_profit(U128(90));
    let d = sale(&mut b);
    fund(&mut b);
    as_("northline.near");
    b.accept_sale("D-1".into(), d.clone());
    as_("mara.near");
    b.accept_sale("D-1".into(), d);
    // The seller's withdrawal transfer fails after the close: the money returns to
    // `available`, which the buyer now controls. The seller's proceeds are unchanged.
    assert!(!callback(&mut b, Payout::Profit { to: id("mara.near"), amount: U128(90) }, false));
    assert_eq!(b.get_treasury().available.0, 100);
    assert_eq!(b.proceeds_of(id("mara.near")).0, 1000);
    as_("northline.near");
    let _ = b.withdraw_profit(U128(90));
    assert_eq!(b.get_treasury().pending_payouts.0, 90);
}
