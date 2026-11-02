//! Unit tests for the business invariants (brief §8): reserved funds, terms digests, a close
//! that pays once, and the founder's authority ending with the generation.

use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const T0: u64 = 1_800_000_000_000; // ms

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, yocto: u128, at_ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(id("openseat.business.near"))
        .predecessor_account_id(id(who))
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .block_timestamp(at_ms * 1_000_000)
        .build());
}

fn as_(who: &str) {
    ctx(who, 1, T0);
}

fn commitment(salt: &str, who: &str) -> String {
    hex::encode(env::sha256(format!("{salt}|{who}").as_bytes()))
}

const TERMS: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const TERMS2: &str = "2222222222222222222222222222222222222222222222222222222222222222";

/// The brief's fixture: treasury 45, 20 reserved for promised credits, buyer funded with 150.
fn fixture() -> Business {
    as_("founder.near");
    let mut b = Business::new("openseat".into(), id("founder.near"), id("issuer.near"));
    as_("issuer.near");
    b.mint(id("founder.near"), U128(45));
    b.mint(id("northline.near"), U128(150));
    as_("founder.near");
    b.deposit_treasury(U128(45));
    b.register_obligation("credit-juniper".into(), U128(20), commitment("s1", "juniper.near"), "promised credits".into());
    b.appoint_operator(id("worker-a.near"), vec!["fulfillment".into()]);
    b
}

fn propose(b: &mut Business, deal: &str, price: u128) -> String {
    as_("founder.near");
    b.propose_sale(deal.into(), id("northline.near"), U128(price), U64(T0 + 60_000), TERMS.into());
    b.get_deal(deal.into()).unwrap().digest
}

fn close(b: &mut Business) {
    let digest = propose(b, "D-1", 100);
    as_("founder.near");
    b.accept_sale("D-1".into(), digest.clone());
    as_("northline.near");
    b.accept_sale("D-1".into(), digest);
}

#[test]
fn fixture_treasury_is_45_with_25_available() {
    let b = fixture();
    let t = b.get_treasury();
    assert_eq!((t.treasury.0, t.reserved.0, t.available.0), (45, 20, 25));
}

#[test]
#[should_panic(expected = "E_RESERVED")]
fn owner_cannot_withdraw_reserved_funds() {
    let mut b = fixture();
    as_("founder.near");
    b.withdraw_treasury(U128(26));
}

#[test]
fn owner_can_withdraw_available_funds() {
    let mut b = fixture();
    as_("founder.near");
    b.withdraw_treasury(U128(25));
    assert_eq!(b.get_treasury().available.0, 0);
    assert_eq!(b.balance_of(id("founder.near")).0, 25);
}

#[test]
#[should_panic(expected = "E_ARGS: the issuer cannot credit the business treasury")]
fn issuer_cannot_inflate_the_treasury() {
    let mut b = fixture();
    as_("issuer.near");
    b.mint(id("openseat.business.near"), U128(1000));
}

#[test]
#[should_panic(expected = "E_DEPOSIT")]
fn owner_methods_need_a_full_access_key() {
    let mut b = fixture();
    ctx("founder.near", 0, T0);
    b.withdraw_treasury(U128(1));
}

#[test]
fn sale_moves_control_pays_seller_and_keeps_the_treasury() {
    let mut b = fixture();
    close(&mut b);
    let c = b.get_control();
    assert_eq!(c.owner, id("northline.near"));
    assert_eq!(c.generation, 2);
    assert!(c.operators.is_empty(), "old operator grants do not survive the close");
    assert_eq!(b.balance_of(id("founder.near")).0, 100);
    assert_eq!(b.balance_of(id("northline.near")).0, 50);
    let t = b.get_treasury();
    assert_eq!((t.treasury.0, t.reserved.0, t.available.0), (45, 20, 25));
    let deal = b.get_deal("D-1".into()).unwrap().deal;
    assert_eq!(deal.status, DealStatus::Closed);
    assert_eq!(deal.held.0, 0);
    assert!(get_logs().iter().any(|l| l.contains("sale_finalized")));
}

#[test]
fn buyer_may_accept_first() {
    let mut b = fixture();
    let digest = propose(&mut b, "D-1", 100);
    as_("northline.near");
    b.accept_sale("D-1".into(), digest.clone());
    assert_eq!(b.balance_of(id("northline.near")).0, 50, "price held on acceptance");
    as_("founder.near");
    b.accept_sale("D-1".into(), digest);
    assert_eq!(b.get_control().owner, id("northline.near"));
}

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn former_owner_cannot_appoint_after_close() {
    let mut b = fixture();
    close(&mut b);
    as_("founder.near");
    b.appoint_operator(id("founder-alt.near"), vec!["support".into()]);
}

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn former_owner_cannot_withdraw_after_close() {
    let mut b = fixture();
    close(&mut b);
    as_("founder.near");
    b.withdraw_treasury(U128(1));
}

#[test]
fn old_operator_grant_fails_the_check_after_close() {
    let mut b = fixture();
    assert!(b.operator_check(id("worker-a.near"), "fulfillment".into()).authorized);
    close(&mut b);
    let check = b.operator_check(id("worker-a.near"), "fulfillment".into());
    assert!(!check.authorized);
    assert_eq!(check.generation, 2);
    assert!(!b.operator_check(id("founder.near"), "fulfillment".into()).authorized);
    as_("northline.near");
    b.appoint_operator(id("worker-b.near"), vec!["fulfillment".into()]);
    assert!(b.operator_check(id("worker-b.near"), "fulfillment".into()).authorized);
    assert!(b.operator_check(id("northline.near"), "release".into()).authorized);
}

#[test]
#[should_panic(expected = "E_STATE")]
fn a_second_close_cannot_pay_the_seller_again() {
    let mut b = fixture();
    close(&mut b);
    let digest = b.get_deal("D-1".into()).unwrap().digest;
    as_("northline.near");
    b.accept_sale("D-1".into(), digest);
}

#[test]
fn revising_terms_voids_acceptances_and_returns_the_hold() {
    let mut b = fixture();
    let old = propose(&mut b, "D-1", 100);
    as_("northline.near");
    b.accept_sale("D-1".into(), old.clone());
    as_("founder.near");
    b.revise_sale("D-1".into(), U128(120), U64(T0 + 60_000), TERMS2.into());
    assert_eq!(b.balance_of(id("northline.near")).0, 150, "hold returned on revision");
    let deal = b.get_deal("D-1".into()).unwrap();
    assert_eq!(deal.deal.buyer_accepted, None);
    assert_ne!(deal.digest, old);
    // The seller accepting the new terms does not close: the buyer's old acceptance is gone.
    as_("founder.near");
    b.accept_sale("D-1".into(), deal.digest.clone());
    assert_eq!(b.get_control().owner, id("founder.near"));
}

#[test]
#[should_panic(expected = "E_TERMS")]
fn accepting_a_stale_digest_fails() {
    let mut b = fixture();
    let old = propose(&mut b, "D-1", 100);
    as_("founder.near");
    b.revise_sale("D-1".into(), U128(120), U64(T0 + 60_000), TERMS2.into());
    as_("northline.near");
    b.accept_sale("D-1".into(), old);
}

#[test]
#[should_panic(expected = "E_FUNDS")]
fn buyer_without_funds_cannot_accept() {
    let mut b = fixture();
    let digest = propose(&mut b, "D-1", 151);
    as_("northline.near");
    b.accept_sale("D-1".into(), digest);
}

#[test]
#[should_panic(expected = "E_EXPIRED")]
fn expired_offer_cannot_be_accepted() {
    let mut b = fixture();
    let digest = propose(&mut b, "D-1", 100);
    ctx("northline.near", 1, T0 + 60_000);
    b.accept_sale("D-1".into(), digest);
}

#[test]
fn expiry_returns_the_hold() {
    let mut b = fixture();
    let digest = propose(&mut b, "D-1", 100);
    as_("northline.near");
    b.accept_sale("D-1".into(), digest);
    ctx("anyone.near", 0, T0 + 60_000);
    b.expire_sale("D-1".into());
    assert_eq!(b.balance_of(id("northline.near")).0, 150);
    assert_eq!(b.get_deal("D-1".into()).unwrap().deal.status, DealStatus::Expired);
}

#[test]
fn closing_one_deal_voids_a_racing_deal_and_returns_its_hold() {
    let mut b = fixture();
    as_("issuer.near");
    b.mint(id("rival.near"), U128(200));
    as_("founder.near");
    b.propose_sale("D-R".into(), id("rival.near"), U128(110), U64(T0 + 60_000), TERMS.into());
    let rival = b.get_deal("D-R".into()).unwrap().digest;
    as_("rival.near");
    b.accept_sale("D-R".into(), rival.clone());
    assert_eq!(b.balance_of(id("rival.near")).0, 90);
    close(&mut b);
    assert_eq!(b.get_deal("D-R".into()).unwrap().deal.status, DealStatus::Void);
    assert_eq!(b.balance_of(id("rival.near")).0, 200);
    assert_eq!(b.balance_of(id("founder.near")).0, 100, "the seller is paid once");
}

#[test]
#[should_panic(expected = "E_NOT_PARTY")]
fn a_stranger_cannot_accept() {
    let mut b = fixture();
    let digest = propose(&mut b, "D-1", 100);
    as_("stranger.near");
    b.accept_sale("D-1".into(), digest);
}

#[test]
fn obligation_pays_only_its_committed_beneficiary() {
    let mut b = fixture();
    close(&mut b);
    as_("northline.near");
    b.fulfill_obligation("credit-juniper".into(), id("juniper.near"), "s1".into());
    assert_eq!(b.balance_of(id("juniper.near")).0, 20);
    let t = b.get_treasury();
    assert_eq!((t.treasury.0, t.reserved.0, t.available.0), (25, 0, 25));
}

#[test]
#[should_panic(expected = "E_COMMITMENT")]
fn obligation_cannot_be_redirected_to_the_owner() {
    let mut b = fixture();
    as_("founder.near");
    b.fulfill_obligation("credit-juniper".into(), id("founder.near"), "s1".into());
}

#[test]
#[should_panic(expected = "E_NOT_AUTHORIZED")]
fn operator_without_the_capability_cannot_register_obligations() {
    let mut b = fixture();
    as_("worker-a.near");
    b.register_obligation("x".into(), U128(1), commitment("s", "a.near"), "".into());
}
