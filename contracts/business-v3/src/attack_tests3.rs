//! Attack review of 2026-11-07 (reports/2026-11-07_attack-review.md): the reviewer's tests, written
//! against a test-stripped copy and kept here as regression tests. A `*_finding_*` test shows an
//! attack succeeding until its fix lands; every other test shows the contract refusing one.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_700_000_000_000; // ms
const PRICE: u128 = 1_000_000;
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

struct Fx {
    b: Business,
    business: AccountId,
    owner: AccountId,
    asset: AccountId,
    customer: AccountId,
    buyer: AccountId,
    operator: AccountId,
    closer: Option<AccountId>,
    now: u64,
}

impl Fx {
    fn env(&self, pred: &AccountId, deposit: u128) {
        self.env_with(pred, deposit, vec![]);
    }
    fn env_with(&self, pred: &AccountId, deposit: u128, results: Vec<PromiseResult>) {
        let ctx = VMContextBuilder::new()
            .current_account_id(self.business.clone())
            .predecessor_account_id(pred.clone())
            .signer_account_id(pred.clone())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(self.now * 1_000_000)
            .build();
        testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
    }
    fn new(closer: Option<AccountId>) -> Self {
        let business = acc("biz.test.near");
        let owner = acc("founder.test.near");
        let asset = acc("token.test.near");
        let customer = acc("cust.test.near");
        let buyer = acc("buyer.test.near");
        let operator = acc("ops.test.near");
        let ctx = VMContextBuilder::new()
            .current_account_id(business.clone())
            .predecessor_account_id(owner.clone())
            .block_timestamp(T0 * 1_000_000)
            .build();
        testing_env!(ctx);
        let rules = Rules {
            min_reserve: U128(0),
            max_hold_units: 10,
            max_hold_ttl_ms: U64(MAX_HOLD_TTL_MS),
            max_settle_grace_ms: U64(MAX_SETTLE_GRACE_MS),
        };
        let b = Business::new("Shop".into(), owner.clone(), asset.clone(), rules, closer.clone());
        Fx { b, business, owner, asset, customer, buyer, operator, closer, now: T0 }
    }
    fn plan(&mut self) -> u32 {
        self.env(&self.owner.clone(), ONE_NEAR);
        self.b.create_plan(PlanInput {
            unit_price: U128(PRICE),
            max_units_per_purchase: 100,
            max_units_outstanding: 1000,
            max_hold_units: 5,
            hold_ttl_ms: U64(600_000),
            settle_grace_ms: U64(600_000),
        })
    }
    fn appoint(&mut self, who: &AccountId, caps: u8) {
        self.env(&self.owner.clone(), 1);
        self.b.appoint_operator(who.clone(), caps);
    }
    fn shell(&mut self, customer: &AccountId, plan: u32) -> u64 {
        let c = customer.clone();
        self.env(&c, ONE_NEAR);
        self.b.sponsor_shell(c, plan).0
    }
    /// A purchase by `customer` of `units`, optionally installing a key in slot 0.
    fn buy(&mut self, customer: &AccountId, plan: u32, units: u32, seq: u32, key: Option<&SigningKey>) -> u128 {
        let install = key.map(|k| Install {
            slot: 0,
            pk: hex::encode(k.verifying_key().to_bytes()),
            max_hold_units: 5,
            max_units_per_day: 100,
        });
        let msg = serde_json::json!({ "buy": { "plan_id": plan, "units": units, "purchase_seq": seq, "install": install } }).to_string();
        let amount = units as u128 * PRICE;
        self.env(&self.asset.clone(), 0);
        match self.b.ft_on_transfer(customer.clone(), U128(amount), msg) {
            PromiseOrValue::Value(v) => v.0,
            _ => panic!("promise"),
        }
    }
    fn fund(&mut self, sender: &AccountId, seq: u64, version: u32, amount: u128, price: u128, csq: Option<u64>) -> u128 {
        let msg = serde_json::json!({ "fund_deal": { "deal_seq": U64(seq), "version": version, "price": U128(price), "expected_control_seq": csq.map(U64) } }).to_string();
        self.env(&self.asset.clone(), 0);
        match self.b.ft_on_transfer(sender.clone(), U128(amount), msg) {
            PromiseOrValue::Value(v) => v.0,
            _ => panic!("promise"),
        }
    }
    fn terms(&self, grants: Vec<(AccountId, u8)>, price: u128, floor: u128) -> DealTermsInput {
        DealTermsInput {
            buyer: self.buyer.clone(),
            price: U128(price),
            expires_at_ms: U64(self.now + DAY_MS),
            close_window_ms: U64(if self.closer.is_some() { 3_600_000 } else { 0 }),
            available_floor: U128(floor),
            grants,
            terms_hash: "ab".repeat(32),
        }
    }
    fn propose(&mut self, grants: Vec<(AccountId, u8)>, price: u128, floor: u128) -> u64 {
        let t = self.terms(grants, price, floor);
        self.env(&self.owner.clone(), ONE_NEAR);
        self.b.propose_sale(t).0
    }
    fn deal(&self) -> DealView {
        self.b.get_control().live_deal.expect("a live deal")
    }
    fn accept(&mut self, who: &AccountId) -> String {
        let d = self.deal();
        self.env(who, 1);
        self.b.accept_sale(d.seq, d.version, d.digest)
    }
    fn hold_sig(&self, key: &SigningKey, customer: &AccountId, plan: u32, reg: u64, epoch: u32, hold_seq: u32, units: u8, serve: u64) -> String {
        let m = hold_message(&self.business, plan, customer, reg, 0, epoch, hold_seq, units, serve);
        hex::encode(key.sign(&m).to_bytes())
    }
    fn use_sig(&self, key: &SigningKey, customer: &AccountId, plan: u32, reg: u64, epoch: u32, hold_seq: u32, slot: u8, fp: &[u8; 32]) -> String {
        let m = use_message(&self.business, plan, customer, reg, 0, epoch, hold_seq, slot, fp);
        hex::encode(key.sign(&m).to_bytes())
    }
    fn ent(&self, c: &AccountId, plan: u32) -> EntitlementView {
        self.b.get_entitlement(c.clone(), plan).unwrap()
    }
    fn t(&self) -> TreasuryView {
        self.b.get_treasury()
    }
    /// A full Direct sale: propose, fund, both accept. Returns the price.
    fn sell(&mut self, grants: Vec<(AccountId, u8)>, price: u128) -> u128 {
        let seq = self.propose(grants, price, 0);
        assert_eq!(self.fund(&self.buyer.clone(), seq, 1, price, price, None), 0);
        assert_eq!(self.accept(&self.buyer.clone()), "accepted");
        assert_eq!(self.accept(&self.owner.clone()), "closed");
        price
    }
}

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

/// Runs `f` and returns the panic message (the refusal), or None if it did not panic.
fn refused<F: FnOnce() -> R, R>(f: F) -> Option<String> {
    let r = catch_unwind(AssertUnwindSafe(f));
    match r {
        Ok(_) => None,
        Err(e) => Some(
            e.downcast_ref::<String>()
                .cloned()
                .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "<non-string panic>".into()),
        ),
    }
}

fn expect_refused<F: FnOnce() -> R, R>(code: &str, f: F) {
    let m = refused(f).unwrap_or_else(|| panic!("expected refusal {code}, but the call succeeded"));
    assert!(m.contains(code), "expected {code}, got: {m}");
}

/// The last receipt that is an `ft_transfer` call, as (receiver_id, amount).
fn last_ft_transfer() -> Option<(String, u128)> {
    for r in get_created_receipts().iter().rev() {
        for a in &r.actions {
            if let near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, .. } = a {
                if method_name == b"ft_transfer" {
                    let v: serde_json::Value = serde_json::from_slice(args).unwrap();
                    return Some((v["receiver_id"].as_str().unwrap().to_string(), v["amount"].as_str().unwrap().parse().unwrap()));
                }
            }
        }
    }
    None
}

// =====================================================================================
// Outsider
// =====================================================================================

#[test]
fn a01_fake_token_cannot_buy_or_fund() {
    let mut f = Fx::new(None);
    let p = f.plan();
    f.shell(&f.customer.clone(), p);
    let fake = acc("fake-token.test.near");
    f.env(&fake, 0);
    let msg = serde_json::json!({ "buy": { "plan_id": p, "units": 1, "purchase_seq": 1 } }).to_string();
    expect_refused("E_ASSET", || f.b.ft_on_transfer(f.customer.clone(), U128(PRICE), msg));
    assert_eq!(f.t().held.0, 0);
}

// a02: `#[private]` on `on_payout` is enforced by the extern wrapper near-sdk-macros generates
// ("Method on_payout is private" when predecessor != current account), not by the Rust method, so a
// unit test cannot exercise it; checked in the macro snapshot (private_method.snap) instead. The
// method body itself tolerates any slot/payout id (it logs payout_mismatch and changes nothing).
#[test]
fn a02_on_payout_with_a_wrong_id_changes_nothing() {
    let mut f = Fx::new(None);
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Successful(vec![])]);
    assert!(!f.b.on_payout(0, U64(1)));
    assert!(!f.b.on_payout(99, U64(1)));
    assert_eq!(f.t().held.0, 0);
}

#[test]
fn a03_outsider_cannot_propose_appoint_withdraw_or_create_plan() {
    let mut f = Fx::new(None);
    f.plan();
    let outsider = acc("mallory.test.near");
    f.env(&outsider, ONE_NEAR);
    let t = f.terms(vec![], 5 * PRICE, 0);
    expect_refused("E_NOT_OWNER", || f.b.propose_sale(t));
    expect_refused("E_NOT_OWNER", || f.b.appoint_operator(outsider.clone(), METERING));
    expect_refused("E_NOT_OWNER", || f.b.create_plan(PlanInput { unit_price: U128(1), max_units_per_purchase: 1, max_units_outstanding: 1, max_hold_units: 1, hold_ttl_ms: U64(60_000), settle_grace_ms: U64(0) }));
    f.env(&outsider, 1);
    expect_refused("E_NOT_OWNER", || f.b.withdraw_profit(U128(1)));
    expect_refused("E_NOT_OWNER", || f.b.set_manifest("00".repeat(32), U64(0)));
    expect_refused("E_NOT_OWNER", || f.b.revoke_operator(outsider.clone()));
    expect_refused("E_NO_RECORD", || f.b.claim_party(0));
    expect_refused("E_NO_RECORD", || f.b.release_party_slot());
}

#[test]
fn a04_outsider_cannot_meter_or_touch_entitlements() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let outsider = acc("mallory.test.near");
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 2, serve);
    f.env(&outsider, 0);
    let auth = HoldAuth { hold_seq: 1, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 };
    expect_refused("E_NOT_OPERATOR", || f.b.open_hold(f.customer.clone(), p, auth.clone(), sig.clone()));
    expect_refused("E_NOT_OPERATOR", || f.b.settle_hold(f.customer.clone(), p, 1, vec![], false));
    f.env(&outsider, 1);
    expect_refused("E_NOT_CUSTOMER", || f.b.refund_units(p, U64(1)));
    expect_refused("E_NOT_CUSTOMER", || f.b.claim_customer(p));
    expect_refused("E_NOT_CUSTOMER", || f.b.install_key(p, 1, hex::encode(key(2).verifying_key().to_bytes()), 1, 1));
    expect_refused("E_NOT_CUSTOMER", || f.b.revoke_key(p, 0));
    expect_refused("E_NOT_CUSTOMER", || f.b.set_paused(p, true));
    expect_refused("E_NOT_CUSTOMER", || f.b.unregister(f.customer.clone(), p));
}

#[test]
fn a05_outsider_cannot_release_an_active_hold_before_its_deadline() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 2, serve);
    f.env(&f.owner.clone(), 0);
    assert_eq!(f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig), "opened");
    let outsider = acc("mallory.test.near");
    f.env(&outsider, 0);
    expect_refused("E_NOT_OPERATOR", || f.b.release_hold(f.customer.clone(), p, 1));
    // After the settle deadline anyone may: units come back to the customer, nothing is charged.
    f.now = serve + 600_001;
    f.env(&outsider, 0);
    f.b.release_hold(f.customer.clone(), p, 1);
    let e = f.ent(&f.customer.clone(), p);
    assert_eq!(e.free.0, 10);
    assert!(!e.hold_active);
}

#[test]
fn a06_outsider_cannot_expire_abort_or_claim_stranded() {
    let mut f = Fx::new(Some(acc("closer.test.near")));
    f.plan();
    let seq = f.propose(vec![(f.operator.clone(), METERING)], 5 * PRICE, 0);
    let outsider = acc("mallory.test.near");
    f.env(&outsider, 0);
    expect_refused("E_NOT_EXPIRED", || f.b.expire_sale(U64(seq)));
    expect_refused("E_STATE", || f.b.abort_close(U64(seq)));
    f.env(&outsider, 1);
    expect_refused("E_NOT_PARTY", || f.b.cancel_sale(U64(seq)));
    expect_refused("E_NOT_BUYER", || f.b.unfund_deal(U64(seq)));
    expect_refused("E_NOT_PARTY", || f.b.accept_sale(U64(seq), 1, f.deal().digest));
    expect_refused("E_STATE", || f.b.claim_stranded(0));
    f.env(&outsider, 0);
    expect_refused("E_NOT_CLOSER", || {
        f.b.close_sale(CloseOrder { deal_seq: U64(seq), version: 1, digest: "00".repeat(32), expected_generation: 1, closing_control_seq: U64(0), manifest: "00".repeat(32), manifest_seq: U64(0), issued_at_ms: U64(f.now) })
    });
}

// =====================================================================================
// Buyer
// =====================================================================================

#[test]
fn a10_buyer_cannot_accept_or_close_without_funding() {
    let mut f = Fx::new(None);
    f.plan();
    let seq = f.propose(vec![], 5 * PRICE, 0);
    // Seller accepts first; the buyer tries to accept unfunded.
    assert_eq!(f.accept(&f.owner.clone()), "accepted");
    let d = f.deal();
    f.env(&f.buyer.clone(), 1);
    expect_refused("E_UNFUNDED", || f.b.accept_sale(d.seq, d.version, d.digest.clone()));
    assert_eq!(f.b.get_control().owner, f.owner);
    // Funding less than the price is returned whole.
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 4 * PRICE, 4 * PRICE, None), 4 * PRICE);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 4 * PRICE, 5 * PRICE, None), 4 * PRICE);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 6 * PRICE, 6 * PRICE, None), 6 * PRICE);
    assert_eq!(f.t().escrow_total.0, 0);
    // Someone else funding on the buyer's behalf is returned.
    assert_eq!(f.fund(&acc("friend.test.near"), seq, 1, 5 * PRICE, 5 * PRICE, None), 5 * PRICE);
    // Wrong version / wrong seq / stale control_seq returned.
    assert_eq!(f.fund(&f.buyer.clone(), seq, 2, 5 * PRICE, 5 * PRICE, None), 5 * PRICE);
    assert_eq!(f.fund(&f.buyer.clone(), seq + 1, 1, 5 * PRICE, 5 * PRICE, None), 5 * PRICE);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, Some(0)), 5 * PRICE);
    assert_eq!(f.t().held.0, 0);
}

#[test]
fn a11_buyer_cannot_fund_twice_or_get_escrow_back_after_close() {
    let mut f = Fx::new(None);
    f.plan();
    let seq = f.propose(vec![], 5 * PRICE, 0);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    // A second funding is returned whole.
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 5 * PRICE);
    assert_eq!(f.t().escrow_total.0, 5 * PRICE);
    assert_eq!(f.accept(&f.buyer.clone()), "accepted");
    assert_eq!(f.accept(&f.owner.clone()), "closed");
    // Closed: the buyer owns, the seller is owed exactly the price, escrow is gone.
    let c = f.b.get_control();
    assert_eq!(c.owner, f.buyer);
    assert_eq!(c.generation, 2);
    assert!(c.live_deal.is_none());
    assert_eq!(f.t().escrow_total.0, 0);
    assert_eq!(f.b.get_party(f.owner.clone()).unwrap().sale_proceeds_claim.0, 5 * PRICE);
    assert_eq!(f.b.get_party(f.buyer.clone()).unwrap().escrow_return_claim.0, 0);
    // Buyer tries to take escrow back or cancel after the close.
    f.env(&f.buyer.clone(), 1);
    expect_refused("E_NO_DEAL", || f.b.unfund_deal(U64(seq)));
    expect_refused("E_NO_DEAL", || f.b.cancel_sale(U64(seq)));
    expect_refused("E_FUNDS", || f.b.claim_party(CLAIM_ESCROW_RETURN));
    // The new owner cannot withdraw the price either: it is a claim, not available.
    expect_refused("E_RESERVED", || f.b.withdraw_profit(U128(1)));
}

#[test]
fn a12_buyer_cannot_pay_less_by_accepting_an_old_version() {
    let mut f = Fx::new(None);
    f.plan();
    let seq = f.propose(vec![], 5 * PRICE, 0);
    let old = f.deal();
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    // Seller raises the price: escrow returns to the buyer's claim, acceptances cleared.
    let t = f.terms(vec![], 8 * PRICE, 0);
    f.env(&f.owner.clone(), 1);
    f.b.revise_sale(U64(seq), t);
    assert_eq!(f.b.get_party(f.buyer.clone()).unwrap().escrow_return_claim.0, 5 * PRICE);
    assert_eq!(f.t().escrow_total.0, 0);
    f.env(&f.buyer.clone(), 1);
    expect_refused("E_VERSION", || f.b.accept_sale(old.seq, old.version, old.digest.clone()));
    // Funding the new version with the old price is returned.
    assert_eq!(f.fund(&f.buyer.clone(), seq, 2, 5 * PRICE, 5 * PRICE, None), 5 * PRICE);
    // Accepting the new version unfunded is refused.
    let d = f.deal();
    f.env(&f.buyer.clone(), 1);
    expect_refused("E_UNFUNDED", || f.b.accept_sale(d.seq, d.version, d.digest.clone()));
}

#[test]
fn a13_buyer_unfund_then_seller_second_acceptance_cannot_close() {
    let mut f = Fx::new(None);
    f.plan();
    let seq = f.propose(vec![], 5 * PRICE, 0);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    assert_eq!(f.accept(&f.buyer.clone()), "accepted");
    f.env(&f.buyer.clone(), 1);
    f.b.unfund_deal(U64(seq));
    assert_eq!(f.b.get_party(f.buyer.clone()).unwrap().escrow_return_claim.0, 5 * PRICE);
    // The seller's acceptance now only records; it can't close an unfunded deal.
    assert_eq!(f.accept(&f.owner.clone()), "accepted");
    assert_eq!(f.b.get_control().owner, f.owner);
    let d = f.deal();
    assert!(d.seller_accepted && !d.buyer_accepted);
}

#[test]
fn a14_buyer_cannot_release_pinned_record_or_be_the_token_or_closer() {
    let mut f = Fx::new(Some(acc("closer.test.near")));
    f.plan();
    let seq = f.propose(vec![(f.operator.clone(), METERING)], 5 * PRICE, 0);
    f.env(&f.buyer.clone(), 1);
    expect_refused("E_DEAL_PINNED", || f.b.release_party_slot());
    f.env(&f.buyer.clone(), 1);
    f.b.cancel_sale(U64(seq));
    // Proposals to forbidden buyers.
    f.env(&f.owner.clone(), ONE_NEAR);
    let mut t = f.terms(vec![(f.operator.clone(), METERING)], 5 * PRICE, 0);
    t.buyer = f.asset.clone();
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.buyer = acc("closer.test.near");
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.buyer = f.business.clone();
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.buyer = f.owner.clone();
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
}

// =====================================================================================
// Seller
// =====================================================================================

#[test]
fn a20_seller_cannot_keep_escrow_and_business() {
    let mut f = Fx::new(None);
    f.plan();
    let seq = f.propose(vec![], 5 * PRICE, 0);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    assert_eq!(f.accept(&f.buyer.clone()), "accepted");
    // Seller cancels instead of accepting: escrow goes to the buyer's claim, never to the seller.
    f.env(&f.owner.clone(), 1);
    f.b.cancel_sale(U64(seq));
    assert_eq!(f.b.get_party(f.buyer.clone()).unwrap().escrow_return_claim.0, 5 * PRICE);
    assert_eq!(f.b.get_party(f.owner.clone()).unwrap().sale_proceeds_claim.0, 0);
    assert_eq!(f.t().escrow_total.0, 0);
    assert_eq!(f.t().claims_total.0, 5 * PRICE);
    assert_eq!(f.t().available.0, 0);
    // The owner cannot withdraw the returned escrow.
    f.env(&f.owner.clone(), 1);
    expect_refused("E_RESERVED", || f.b.withdraw_profit(U128(1)));
    // The buyer collects it.
    f.env(&f.buyer.clone(), 1);
    f.b.claim_party(CLAIM_ESCROW_RETURN);
    assert_eq!(last_ft_transfer(), Some((f.buyer.to_string(), 5 * PRICE)));
}

#[test]
fn a21_seller_cannot_change_terms_once_closing_or_change_buyer_while_funded() {
    let mut f = Fx::new(Some(acc("closer.test.near")));
    f.plan();
    let seq = f.propose(vec![(f.operator.clone(), METERING)], 5 * PRICE, 0);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    // Funded: buyer can't be swapped.
    let mut t = f.terms(vec![(f.operator.clone(), METERING)], 5 * PRICE, 0);
    t.buyer = acc("other-buyer.test.near");
    f.env(&f.owner.clone(), ONE_NEAR);
    expect_refused("E_FUNDED_BUYER", || f.b.revise_sale(U64(seq), t.clone()));
    assert_eq!(f.accept(&f.buyer.clone()), "accepted");
    assert_eq!(f.accept(&f.owner.clone()), "closing");
    let t2 = f.terms(vec![(f.operator.clone(), METERING)], 1, 0);
    f.env(&f.owner.clone(), 1);
    expect_refused("E_CLOSING", || f.b.revise_sale(U64(seq), t2.clone()));
    expect_refused("E_CLOSING", || f.b.cancel_sale(U64(seq)));
    expect_refused("E_CLOSING", || f.b.withdraw_profit(U128(1)));
    f.env(&f.owner.clone(), ONE_NEAR);
    expect_refused("E_DEAL_PENDING", || f.b.appoint_operator(f.owner.clone(), METERING));
    f.env(&f.buyer.clone(), 1);
    expect_refused("E_CLOSING", || f.b.unfund_deal(U64(seq)));
}

#[test]
fn a22_seller_cannot_drain_available_below_the_accepted_floor() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    // Customer uses 4 units: available = 4 * PRICE.
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 4, serve);
    f.env(&f.owner.clone(), 0);
    f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 4, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig);
    let uses: Vec<UseInput> = (0..4u8)
        .map(|s| {
            let fp = [s + 1; 32];
            UseInput { slot: s, fingerprint: hex::encode(fp), sig: f.use_sig(&k, &f.customer.clone(), p, reg, 1, 1, s, &fp) }
        })
        .collect();
    f.env(&f.owner.clone(), 0);
    f.b.settle_hold(f.customer.clone(), p, 1, uses, true);
    assert_eq!(f.t().available.0, 4 * PRICE);
    // Deal with a floor of 3 units of value; seller accepts.
    let seq = f.propose(vec![], 5 * PRICE, 3 * PRICE);
    assert_eq!(f.accept(&f.owner.clone()), "accepted");
    f.env(&f.owner.clone(), 1);
    expect_refused("E_FLOOR", || f.b.withdraw_profit(U128(2 * PRICE)));
    f.b.withdraw_profit(U128(PRICE)); // exactly down to the floor is allowed
    assert_eq!(f.t().available.0, 3 * PRICE);
    f.env(&f.owner.clone(), 1);
    expect_refused("E_FLOOR", || f.b.withdraw_profit(U128(1)));
    // Buyer funds and accepts; the floor held.
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    assert_eq!(f.accept(&f.buyer.clone()), "closed");
    assert_eq!(f.t().available.0, 3 * PRICE);
}

#[test]
fn a23_seller_who_drains_before_accepting_cannot_close_below_the_floor() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 4, serve);
    f.env(&f.owner.clone(), 0);
    f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 4, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig);
    let fp = [9u8; 32];
    let u = UseInput { slot: 0, fingerprint: hex::encode(fp), sig: f.use_sig(&k, &f.customer.clone(), p, reg, 1, 1, 0, &fp) };
    f.env(&f.owner.clone(), 0);
    f.b.settle_hold(f.customer.clone(), p, 1, vec![u], true);
    assert_eq!(f.t().available.0, PRICE);
    let seq = f.propose(vec![], 5 * PRICE, PRICE);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    assert_eq!(f.accept(&f.buyer.clone()), "accepted");
    // The floor binds only from the seller's acceptance: the seller withdraws everything...
    f.env(&f.owner.clone(), 1);
    f.b.withdraw_profit(U128(PRICE));
    assert_eq!(f.t().available.0, 0);
    // ...and then can't close.
    let d = f.deal();
    f.env(&f.owner.clone(), 1);
    expect_refused("E_FLOOR", || f.b.accept_sale(d.seq, d.version, d.digest.clone()));
    assert_eq!(f.b.get_control().owner, f.owner);
    // The buyer is not stuck: unfund works.
    f.env(&f.buyer.clone(), 1);
    f.b.unfund_deal(U64(seq));
    assert_eq!(f.b.get_party(f.buyer.clone()).unwrap().escrow_return_claim.0, 5 * PRICE);
}

#[test]
fn a24_seller_cannot_take_customer_money_without_signed_uses() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    assert_eq!(f.t().ent_free_value.0, 10 * PRICE);
    assert_eq!(f.t().available.0, 0);
    f.env(&f.owner.clone(), 1);
    expect_refused("E_RESERVED", || f.b.withdraw_profit(U128(1)));
    // The owner forges a hold with its own key.
    let forger = key(7);
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&forger, &f.customer.clone(), p, reg, 1, 1, 4, serve);
    f.env(&f.owner.clone(), 0);
    expect_refused("E_SIG", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 4, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig));
    // The owner can't install a key into the customer's record.
    f.env(&f.owner.clone(), 1);
    expect_refused("E_NOT_CUSTOMER", || f.b.install_key(p, 1, hex::encode(forger.verifying_key().to_bytes()), 5, 100));
    // Nor through a purchase it did not make (ft_on_transfer names the token's sender).
    assert_eq!(f.t().available.0, 0);
}

#[test]
fn a25_seller_cannot_propose_twice_or_during_live_deal_change_control() {
    let mut f = Fx::new(None);
    f.plan();
    f.propose(vec![], 5 * PRICE, 0);
    let t = f.terms(vec![], 1, 0);
    f.env(&f.owner.clone(), ONE_NEAR);
    expect_refused("E_DEAL_PENDING", || f.b.propose_sale(t.clone()));
    expect_refused("E_DEAL_PENDING", || f.b.create_plan(PlanInput { unit_price: U128(1), max_units_per_purchase: 1, max_units_outstanding: 1, max_hold_units: 1, hold_ttl_ms: U64(60_000), settle_grace_ms: U64(0) }));
    expect_refused("E_DEAL_PENDING", || f.b.appoint_operator(f.operator.clone(), METERING));
    f.env(&f.owner.clone(), 1);
    expect_refused("E_DEAL_PENDING", || f.b.revoke_operator(f.operator.clone()));
    expect_refused("E_DEAL_PENDING", || f.b.set_manifest("11".repeat(32), U64(0)));
}

#[test]
fn a26_seller_accept_twice_refused_and_seller_gets_exactly_the_price() {
    let mut f = Fx::new(None);
    f.plan();
    let seq = f.propose(vec![], 5 * PRICE, 0);
    assert_eq!(f.accept(&f.owner.clone()), "accepted");
    let d = f.deal();
    f.env(&f.owner.clone(), 1);
    expect_refused("E_ALREADY_ACCEPTED", || f.b.accept_sale(d.seq, d.version, d.digest.clone()));
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    assert_eq!(f.accept(&f.buyer.clone()), "closed");
    let seller = f.b.get_party(f.owner.clone()).unwrap();
    assert_eq!(seller.sale_proceeds_claim.0, 5 * PRICE);
    assert_eq!(seller.profit_claim.0, 0);
    assert_eq!(f.t().claims_total.0, 5 * PRICE);
    // Claiming it twice: the second finds nothing.
    f.env(&f.owner.clone(), 1);
    f.b.claim_party(CLAIM_SALE_PROCEEDS);
    assert_eq!(last_ft_transfer(), Some((f.owner.to_string(), 5 * PRICE)));
    f.env(&f.owner.clone(), 1);
    expect_refused("E_FUNDS", || f.b.claim_party(CLAIM_SALE_PROCEEDS));
}

// =====================================================================================
// Former owner and operators
// =====================================================================================

#[test]
fn a30_former_owner_and_old_operators_have_no_power_after_close() {
    let mut f = Fx::new(None);
    let p = f.plan();
    f.appoint(&f.operator.clone(), METERING | SUPPORT);
    let kept = acc("kept.test.near");
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    f.sell(vec![(kept.clone(), METERING)], 5 * PRICE);
    let c = f.b.get_control();
    assert_eq!(c.owner, f.buyer);
    assert_eq!(c.operators, vec![(kept.clone(), METERING, 2)]);
    let former = f.owner.clone();
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 2, serve);
    let auth = HoldAuth { hold_seq: 1, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 };
    // The kept operator opens a hold at generation 2; the old parties then try to act on it.
    f.env(&kept, 0);
    assert_eq!(f.b.open_hold(f.customer.clone(), p, auth.clone(), sig.clone()), "opened");
    for who in [&former, &f.operator.clone()] {
        f.env(who, 0);
        expect_refused("E_NOT_OPERATOR", || f.b.open_hold(f.customer.clone(), p, auth.clone(), sig.clone()));
        expect_refused("E_NOT_OPERATOR", || f.b.settle_hold(f.customer.clone(), p, 1, vec![], true));
        expect_refused("E_NOT_OPERATOR", || f.b.release_hold(f.customer.clone(), p, 1));
        f.env(who, ONE_NEAR);
        expect_refused("E_NOT_OWNER", || f.b.appoint_operator(who.clone(), METERING));
        expect_refused("E_NOT_OWNER", || f.b.propose_sale(f.terms(vec![], 1, 0)));
        expect_refused("E_NOT_OWNER", || f.b.create_plan(PlanInput { unit_price: U128(1), max_units_per_purchase: 1, max_units_outstanding: 1, max_hold_units: 1, hold_ttl_ms: U64(60_000), settle_grace_ms: U64(0) }));
        f.env(who, 1);
        expect_refused("E_NOT_OWNER", || f.b.withdraw_profit(U128(1)));
        expect_refused("E_NOT_OWNER", || f.b.revoke_operator(kept.clone()));
        expect_refused("E_NOT_OWNER", || f.b.set_manifest("11".repeat(32), U64(0)));
        // Nor delete a customer's shell.
        expect_refused("E_NOT_CUSTOMER", || f.b.unregister(f.customer.clone(), p));
    }
    // The kept operator does work at generation 2.
    f.env(&kept, 0);
    f.b.release_hold(f.customer.clone(), p, 1);
    assert!(!f.ent(&f.customer.clone(), p).hold_active);
}

#[test]
fn a31_former_owner_cannot_delete_shells_it_paid_for() {
    let mut f = Fx::new(None);
    let p = f.plan();
    // The founder sponsors a shell for a customer, then sells.
    f.env(&f.owner.clone(), ONE_NEAR);
    f.b.sponsor_shell(f.customer.clone(), p);
    f.sell(vec![], 5 * PRICE);
    f.env(&f.owner.clone(), 1);
    expect_refused("E_NOT_CUSTOMER", || f.b.unregister(f.customer.clone(), p));
    // The new owner may clear an unbought shell someone else paid for; the deposit goes to the payer.
    f.env(&f.buyer.clone(), 1);
    f.b.unregister(f.customer.clone(), p);
    assert!(f.b.get_entitlement(f.customer.clone(), p).is_none());
}

#[test]
fn a32_operator_cannot_exceed_its_capabilities() {
    let mut f = Fx::new(None);
    let p = f.plan();
    f.appoint(&f.operator.clone(), METERING);
    let support = acc("support.test.near");
    f.appoint(&support, SUPPORT);
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let op = f.operator.clone();
    f.env(&op, ONE_NEAR);
    expect_refused("E_NOT_OWNER", || f.b.appoint_operator(op.clone(), METERING));
    expect_refused("E_NOT_OWNER", || f.b.propose_sale(f.terms(vec![], 1, 0)));
    f.env(&op, 1);
    expect_refused("E_NOT_OWNER", || f.b.withdraw_profit(U128(1)));
    expect_refused("E_NOT_CUSTOMER", || f.b.refund_units(p, U64(1)));
    expect_refused("E_NOT_CUSTOMER", || f.b.install_key(p, 1, hex::encode(key(3).verifying_key().to_bytes()), 1, 1));
    // SUPPORT alone can't meter.
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 2, serve);
    f.env(&support, 0);
    expect_refused("E_NOT_OPERATOR", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig.clone()));
    // A METERING operator can't charge a use without the customer's signature.
    f.env(&op, 0);
    assert_eq!(f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig), "opened");
    let fp = [1u8; 32];
    let forged = hex::encode(key(9).sign(&use_message(&f.business, p, &f.customer, reg, 0, 1, 1, 0, &fp)).to_bytes());
    f.env(&op, 0);
    expect_refused("E_SIG", || f.b.settle_hold(f.customer.clone(), p, 1, vec![UseInput { slot: 0, fingerprint: hex::encode(fp), sig: forged.clone() }], false));
    assert_eq!(f.t().available.0, 0);
    // Nor more uses than the hold has units, nor a slot outside the hold.
    let good: Vec<UseInput> = (0..3u8).map(|s| UseInput { slot: s, fingerprint: hex::encode([s + 1; 32]), sig: f.use_sig(&k, &f.customer.clone(), p, reg, 1, 1, s, &[s + 1; 32]) }).collect();
    f.env(&op, 0);
    expect_refused("E_BATCH", || f.b.settle_hold(f.customer.clone(), p, 1, vec![good[0].clone(), good[1].clone(), good[0].clone()], false));
    expect_refused("E_SLOT", || f.b.settle_hold(f.customer.clone(), p, 1, vec![good[2].clone()], false));
    // Hold bigger than signed: refused by the signature.
    f.env(&op, 0);
    f.b.release_hold(f.customer.clone(), p, 1);
    let sig2 = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 2, 2, serve);
    f.env(&op, 0);
    expect_refused("E_SIG", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 2, units: 5, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig2));
}

#[test]
fn a33_operator_cannot_replay_a_hold_or_use_across_holds_customers_plans_or_epochs() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let p2 = f.plan();
    f.appoint(&f.operator.clone(), METERING);
    let reg = f.shell(&f.customer.clone(), p);
    let reg2 = f.shell(&f.customer.clone(), p2);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    f.buy(&f.customer.clone(), p2, 10, 1, Some(&k)); // same device key on plan 2
    let other = acc("other.test.near");
    f.shell(&other, p);
    f.buy(&other, p, 10, 1, Some(&k)); // and another customer who (unwisely) uses the same key
    let op = f.operator.clone();
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 2, serve);
    let auth = HoldAuth { hold_seq: 1, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 };
    f.env(&op, 0);
    assert_eq!(f.b.open_hold(f.customer.clone(), p, auth.clone(), sig.clone()), "opened");
    // Same signed hold on plan 2, or for the other customer: refused.
    f.env(&op, 0);
    expect_refused("E_SIG", || f.b.open_hold(f.customer.clone(), p2, auth.clone(), sig.clone()));
    expect_refused("E_SIG", || f.b.open_hold(other.clone(), p, auth.clone(), sig.clone()));
    let _ = reg2;
    // A use signed for hold 1 slot 0.
    let fp = [5u8; 32];
    let u = UseInput { slot: 0, fingerprint: hex::encode(fp), sig: f.use_sig(&k, &f.customer.clone(), p, reg, 1, 1, 0, &fp) };
    f.env(&op, 0);
    assert_eq!(f.b.settle_hold(f.customer.clone(), p, 1, vec![u.clone()], false), vec!["charged"]);
    // Replayed: "already", nothing more charged.
    f.env(&op, 0);
    assert_eq!(f.b.settle_hold(f.customer.clone(), p, 1, vec![u.clone()], false), vec!["already"]);
    assert_eq!(f.ent(&f.customer.clone(), p).consumed.0, 1);
    // Moved to slot 1: refused.
    let mut moved = u.clone();
    moved.slot = 1;
    f.env(&op, 0);
    expect_refused("E_SIG", || f.b.settle_hold(f.customer.clone(), p, 1, vec![moved.clone()], false));
    // A different fingerprint in the charged slot: conflict, nothing charged.
    let conflict = UseInput { slot: 0, fingerprint: hex::encode([6u8; 32]), sig: f.use_sig(&k, &f.customer.clone(), p, reg, 1, 1, 0, &[6u8; 32]) };
    f.env(&op, 0);
    expect_refused("E_CONFLICT", || f.b.settle_hold(f.customer.clone(), p, 1, vec![conflict.clone()], false));
    // Close, open hold 2, replay hold 1's use into hold 2: refused.
    f.env(&op, 0);
    f.b.release_hold(f.customer.clone(), p, 1);
    let sig2 = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 2, 2, serve);
    f.env(&op, 0);
    assert_eq!(f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 2, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig2), "opened");
    f.env(&op, 0);
    expect_refused("E_SIG", || f.b.settle_hold(f.customer.clone(), p, 2, vec![u.clone()], false));
    // Replay hold 1's auth: sequence used.
    f.env(&op, 0);
    f.b.release_hold(f.customer.clone(), p, 2);
    f.env(&op, 0);
    expect_refused("E_HOLD_SEQ_USED", || f.b.open_hold(f.customer.clone(), p, auth.clone(), sig.clone()));
    // After the customer revokes and reinstalls (epoch 3), an auth for epoch 1 is refused.
    f.env(&f.customer.clone(), 1);
    f.b.revoke_key(p, 0);
    f.env(&f.customer.clone(), 1);
    f.b.install_key(p, 0, hex::encode(k.verifying_key().to_bytes()), 5, 100);
    assert_eq!(f.ent(&f.customer.clone(), p).key_epochs[0], 3);
    let sig3 = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 3, 2, serve);
    f.env(&op, 0);
    expect_refused("E_KEY", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 3, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig3));
    // After unregister and a new shell (new reg_id), an old-registration auth is refused.
    f.env(&f.customer.clone(), 1);
    f.b.refund_units(p, U64(9));
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Successful(vec![])]);
    f.b.on_payout(0, U64(1));
    f.env(&f.customer.clone(), 1);
    f.b.unregister(f.customer.clone(), p);
    let reg_b = f.shell(&f.customer.clone(), p);
    assert_ne!(reg_b, reg);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let old_reg_sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 2, serve);
    f.env(&op, 0);
    expect_refused("E_SIG", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, old_reg_sig));
}

// =====================================================================================
// Customer
// =====================================================================================

#[test]
fn a40_customer_cannot_refund_twice_or_claim_twice() {
    let mut f = Fx::new(None);
    let p = f.plan();
    f.shell(&f.customer.clone(), p);
    f.buy(&f.customer.clone(), p, 10, 1, None);
    f.env(&f.customer.clone(), 1);
    f.b.refund_units(p, U64(10));
    assert_eq!(last_ft_transfer(), Some((f.customer.to_string(), 10 * PRICE)));
    f.env(&f.customer.clone(), 1);
    expect_refused("E_UNITS", || f.b.refund_units(p, U64(1)));
    // The transfer fails: it becomes the customer's claim, exactly once.
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Failed]);
    assert!(!f.b.on_payout(0, U64(1)));
    assert_eq!(f.ent(&f.customer.clone(), p).claim.0, 10 * PRICE);
    // A repeated callback for the same payout changes nothing.
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Failed]);
    assert!(!f.b.on_payout(0, U64(1)));
    assert_eq!(f.ent(&f.customer.clone(), p).claim.0, 10 * PRICE);
    assert_eq!(f.t().claims_total.0, 10 * PRICE);
    f.env(&f.customer.clone(), 1);
    f.b.claim_customer(p);
    f.env(&f.customer.clone(), 1);
    expect_refused("E_FUNDS", || f.b.claim_customer(p));
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Successful(vec![])]);
    assert!(f.b.on_payout(0, U64(2)));
    assert_eq!(f.t().held.0, 0);
    assert_eq!(f.t().claims_total.0, 0);
    assert_eq!(f.t().pending_total.0, 0);
}

#[test]
fn a41_customer_cannot_spend_or_refund_another_customers_units() {
    let mut f = Fx::new(None);
    let p = f.plan();
    f.appoint(&f.operator.clone(), METERING);
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let thief = acc("thief.test.near");
    f.shell(&thief, p);
    let tk = key(2);
    f.buy(&thief, p, 1, 1, Some(&tk));
    // Thief signs a hold naming the victim; the victim's key slot has a different key.
    let serve = f.now + 300_000;
    let sig = hex::encode(tk.sign(&hold_message(&f.business, p, &f.customer, reg, 0, 1, 1, 5, serve)).to_bytes());
    f.env(&f.operator.clone(), 0);
    expect_refused("E_SIG", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 5, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig));
    f.env(&thief, 1);
    expect_refused("E_UNITS", || f.b.refund_units(p, U64(2))); // only its own 1 unit
    expect_refused("E_NOT_CUSTOMER", || f.b.unregister(f.customer.clone(), p));
    assert_eq!(f.ent(&f.customer.clone(), p).free.0, 10);
}

#[test]
fn a42_customer_cannot_buy_with_wrong_amount_sequence_or_cap() {
    let mut f = Fx::new(None);
    let p = f.plan();
    f.shell(&f.customer.clone(), p);
    let c = f.customer.clone();
    let send = |f: &mut Fx, amount: u128, msg: serde_json::Value| -> u128 {
        f.env(&f.asset.clone(), 0);
        match f.b.ft_on_transfer(c.clone(), U128(amount), msg.to_string()) {
            PromiseOrValue::Value(v) => v.0,
            _ => panic!(),
        }
    };
    // Underpay: returned whole.
    assert_eq!(send(&mut f, 9 * PRICE, serde_json::json!({"buy":{"plan_id":p,"units":10,"purchase_seq":1}})), 9 * PRICE);
    // Overpay: returned whole (no free units).
    assert_eq!(send(&mut f, 11 * PRICE, serde_json::json!({"buy":{"plan_id":p,"units":10,"purchase_seq":1}})), 11 * PRICE);
    // Zero units, huge units (overflow), wrong seq, over purchase cap, unknown plan, garbage.
    assert_eq!(send(&mut f, PRICE, serde_json::json!({"buy":{"plan_id":p,"units":0,"purchase_seq":1}})), PRICE);
    assert_eq!(send(&mut f, PRICE, serde_json::json!({"buy":{"plan_id":p,"units":u32::MAX,"purchase_seq":1}})), PRICE);
    assert_eq!(send(&mut f, PRICE, serde_json::json!({"buy":{"plan_id":p,"units":1,"purchase_seq":2}})), PRICE);
    assert_eq!(send(&mut f, 101 * PRICE, serde_json::json!({"buy":{"plan_id":p,"units":101,"purchase_seq":1}})), 101 * PRICE);
    assert_eq!(send(&mut f, PRICE, serde_json::json!({"buy":{"plan_id":99,"units":1,"purchase_seq":1}})), PRICE);
    assert_eq!(send(&mut f, PRICE, serde_json::json!({"nope":1})), PRICE);
    assert_eq!(send(&mut f, PRICE, serde_json::json!({"buy":{"plan_id":p,"units":1,"purchase_seq":1},"fund_deal":{}})), PRICE);
    // No shell for another account: returned.
    f.env(&f.asset.clone(), 0);
    let r = f.b.ft_on_transfer(acc("nobody.test.near"), U128(PRICE), serde_json::json!({"buy":{"plan_id":p,"units":1,"purchase_seq":1}}).to_string());
    assert!(matches!(r, PromiseOrValue::Value(U128(v)) if v == PRICE));
    // A weak (small-order) use-key through the purchase path: returned.
    let weak = hex::encode([0u8; 32]); // the identity point encodes as all zeros... use a known torsion point instead
    let torsion = "0100000000000000000000000000000000000000000000000000000000000000";
    assert_eq!(send(&mut f, PRICE, serde_json::json!({"buy":{"plan_id":p,"units":1,"purchase_seq":1,"install":{"slot":0,"pk":torsion,"max_hold_units":1,"max_units_per_day":1}}})), PRICE);
    let _ = weak;
    assert_eq!(f.t().held.0, 0);
    // The real purchase works and bumps the sequence; replaying it is returned.
    assert_eq!(send(&mut f, 10 * PRICE, serde_json::json!({"buy":{"plan_id":p,"units":10,"purchase_seq":1}})), 0);
    assert_eq!(send(&mut f, 10 * PRICE, serde_json::json!({"buy":{"plan_id":p,"units":10,"purchase_seq":1}})), 10 * PRICE);
    // Over the outstanding cap (1000).
    assert_eq!(send(&mut f, 100 * PRICE, serde_json::json!({"buy":{"plan_id":p,"units":100,"purchase_seq":2}})), 0);
    for s in 3..=10 {
        assert_eq!(send(&mut f, 100 * PRICE, serde_json::json!({"buy":{"plan_id":p,"units":100,"purchase_seq":s}})), 0);
    }
    assert_eq!(f.ent(&c, p).free.0, 910); // 10 + 100*9
    assert_eq!(send(&mut f, 100 * PRICE, serde_json::json!({"buy":{"plan_id":p,"units":100,"purchase_seq":11}})), 100 * PRICE);
}

#[test]
fn a43_customer_cannot_install_weak_key_or_unregister_with_units() {
    let mut f = Fx::new(None);
    let p = f.plan();
    f.shell(&f.customer.clone(), p);
    f.buy(&f.customer.clone(), p, 2, 1, None);
    f.env(&f.customer.clone(), 1);
    let torsion = "0100000000000000000000000000000000000000000000000000000000000000";
    expect_refused("E_KEY_INVALID", || f.b.install_key(p, 0, torsion.into(), 1, 1));
    expect_refused("E_KEY_INVALID", || f.b.install_key(p, 0, "zz".repeat(32), 1, 1));
    expect_refused("E_KEY_INVALID", || f.b.install_key(p, 0, "ec".repeat(32), 1, 1)); // not a point? (if it is, the next line still holds)
    f.env(&f.customer.clone(), 1);
    expect_refused("E_UNITS", || f.b.unregister(f.customer.clone(), p));
    expect_refused("E_ARGS", || f.b.install_key(p, 4, hex::encode(key(1).verifying_key().to_bytes()), 1, 1));
    expect_refused("E_ARGS", || f.b.install_key(p, 0, hex::encode(key(1).verifying_key().to_bytes()), 6, 1)); // above the plan's 5
}

#[test]
fn a44_customer_payout_caps_leave_slots_for_parties() {
    let mut f = Fx::new(None);
    let p = f.plan();
    // 14 customers each start a refund that never settles (callbacks withheld).
    for i in 0..14 {
        let c = acc(&format!("c{i}.test.near"));
        f.shell(&c, p);
        f.buy(&c, p, 1, 1, None);
        f.env(&c, 1);
        f.b.refund_units(p, U64(1));
    }
    let c15 = acc("c15.test.near");
    f.shell(&c15, p);
    f.buy(&c15, p, 1, 1, None);
    f.env(&c15, 1);
    expect_refused("E_BUSY", || f.b.refund_units(p, U64(1)));
    // Two slots stay for parties; the owner has nothing to withdraw here, but a party claim can start.
    assert_eq!(f.b.get_pending().len(), 14);
}

#[test]
fn a45_customer_hold_and_daily_caps_bind() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    // Install with max_hold_units 2 and 3 units a day.
    let msg = serde_json::json!({ "buy": { "plan_id": p, "units": 10, "purchase_seq": 1, "install": { "slot": 0, "pk": hex::encode(k.verifying_key().to_bytes()), "max_hold_units": 2, "max_units_per_day": 3 } } }).to_string();
    f.env(&f.asset.clone(), 0);
    f.b.ft_on_transfer(f.customer.clone(), U128(10 * PRICE), msg);
    let serve = f.now + 300_000;
    let s3 = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 3, serve);
    f.env(&f.owner.clone(), 0);
    expect_refused("E_UNITS", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 3, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, s3));
    let s2 = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 2, serve);
    f.env(&f.owner.clone(), 0);
    assert_eq!(f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, s2), "opened");
    f.env(&f.owner.clone(), 0);
    f.b.release_hold(f.customer.clone(), p, 1);
    // 2 held today; another 2 would exceed 3.
    let s2b = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 2, 2, serve);
    f.env(&f.owner.clone(), 0);
    expect_refused("E_DAILY_CAP", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 2, units: 2, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, s2b));
    // Hold deadlines: too short and too long.
    let s_short = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 2, 1, f.now + 59_999);
    f.env(&f.owner.clone(), 0);
    expect_refused("E_EXPIRED", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 2, units: 1, serve_until_ms: U64(f.now + 59_999), key_slot: 0, key_epoch: 1 }, s_short));
    let s_long = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 2, 1, f.now + 600_001);
    f.env(&f.owner.clone(), 0);
    expect_refused("E_TTL", || f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 2, units: 1, serve_until_ms: U64(f.now + 600_001), key_slot: 0, key_epoch: 1 }, s_long));
}

// =====================================================================================
// The sale leaves customers untouched; refunds after the sale
// =====================================================================================

#[test]
fn a50_customers_are_untouched_by_a_sale_and_refund_at_the_plan_price() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 3, serve);
    f.env(&f.owner.clone(), 0);
    f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 3, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig);
    let before = f.ent(&f.customer.clone(), p);
    let kept = acc("kept.test.near");
    f.sell(vec![(kept.clone(), METERING)], 5 * PRICE);
    let after = f.ent(&f.customer.clone(), p);
    assert_eq!(before, after);
    assert_eq!(f.b.get_plan(p).unwrap().unit_price.0, PRICE);
    // The new generation's operator settles one signed use, closes; the customer refunds the rest.
    let fp = [3u8; 32];
    let u = UseInput { slot: 0, fingerprint: hex::encode(fp), sig: f.use_sig(&k, &f.customer.clone(), p, reg, 1, 1, 0, &fp) };
    f.env(&kept, 0);
    f.b.settle_hold(f.customer.clone(), p, 1, vec![u], true);
    assert_eq!(f.ent(&f.customer.clone(), p).free.0, 9);
    f.env(&f.customer.clone(), 1);
    f.b.refund_units(p, U64(9));
    assert_eq!(last_ft_transfer(), Some((f.customer.to_string(), 9 * PRICE)));
    // The new owner can't make the plan's price change (no method), and can withdraw only the 1 earned unit.
    assert_eq!(f.t().available.0, PRICE);
    f.env(&f.buyer.clone(), 1);
    expect_refused("E_RESERVED", || f.b.withdraw_profit(U128(PRICE + 1)));
}

#[test]
fn a51_sale_cannot_close_with_ungranted_operators_and_grants_need_valid_caps() {
    let mut f = Fx::new(None);
    f.plan();
    f.env(&f.owner.clone(), ONE_NEAR);
    let mut t = f.terms(vec![(acc("x.test.near"), 4)], 1, 0);
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.grants = vec![(acc("x.test.near"), 1), (acc("x.test.near"), 2)];
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.grants = (0..5).map(|i| (acc(&format!("g{i}.test.near")), METERING)).collect();
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.grants = vec![];
    t.price = U128(0);
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.price = U128(1);
    t.expires_at_ms = U64(f.now + 59_999);
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.expires_at_ms = U64(f.now + MAX_OFFER_MS + 1);
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
    t.expires_at_ms = U64(f.now + DAY_MS);
    t.close_window_ms = U64(1);
    expect_refused("E_ARGS", || f.b.propose_sale(t.clone()));
}

// =====================================================================================
// Gated close
// =====================================================================================

#[test]
fn a60_gated_close_needs_the_exact_order_and_only_the_closer() {
    let closer = acc("closer.test.near");
    let mut f = Fx::new(Some(closer.clone()));
    let p = f.plan();
    f.shell(&f.customer.clone(), p);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&key(1)));
    let seq = f.propose(vec![(f.operator.clone(), METERING)], 5 * PRICE, 0);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    assert_eq!(f.accept(&f.buyer.clone()), "accepted");
    assert_eq!(f.accept(&f.owner.clone()), "closing");
    let d = f.deal();
    let order = |f: &Fx| CloseOrder {
        deal_seq: d.seq,
        version: d.version,
        digest: d.digest.clone(),
        expected_generation: 1,
        closing_control_seq: d.closing_control_seq,
        manifest: "00".repeat(32),
        manifest_seq: U64(0),
        issued_at_ms: U64(f.now),
    };
    // Seller, buyer, outsider: refused.
    for who in [f.owner.clone(), f.buyer.clone(), acc("mallory.test.near")] {
        f.env(&who, 0);
        expect_refused("E_NOT_CLOSER", || f.b.close_sale(order(&f)));
    }
    // Closer with a tampered order.
    f.env(&closer, 0);
    let mut o = order(&f);
    o.closing_control_seq = U64(d.closing_control_seq.0 - 1);
    expect_refused("E_CLOSE_SEQ", || f.b.close_sale(o.clone()));
    let mut o = order(&f);
    o.digest = "11".repeat(32);
    expect_refused("E_TERMS", || f.b.close_sale(o.clone()));
    let mut o = order(&f);
    o.issued_at_ms = U64(f.now + 1);
    expect_refused("E_ISSUED_FUTURE", || f.b.close_sale(o.clone()));
    let mut o = order(&f);
    o.issued_at_ms = U64(d.closing_started_ms.0 - 1);
    expect_refused("E_ISSUED_BEFORE", || f.b.close_sale(o.clone()));
    let mut o = order(&f);
    o.manifest = "22".repeat(32);
    expect_refused("E_MANIFEST", || f.b.close_sale(o.clone()));
    // No new holds while closing, by the owner either.
    f.env(&f.owner.clone(), 0);
    expect_refused("E_CLOSING", || f.b.open_hold(f.customer.clone(), 1, HoldAuth { hold_seq: 1, units: 1, serve_until_ms: U64(f.now + 300_000), key_slot: 0, key_epoch: 1 }, "00".repeat(64)));
    // Abort before the deadline refused; the closer closes in time.
    f.env(&acc("mallory.test.near"), 0);
    expect_refused("E_NOT_EXPIRED", || f.b.abort_close(U64(seq)));
    f.now += 1_000;
    f.env(&closer, 0);
    f.b.close_sale(order(&f));
    let c = f.b.get_control();
    assert_eq!(c.owner, f.buyer);
    assert_eq!(c.generation, 2);
    assert_eq!(c.operators, vec![(f.operator.clone(), METERING, 2)]);
    assert_eq!(f.b.get_party(f.owner.clone()).unwrap().sale_proceeds_claim.0, 5 * PRICE);
}

#[test]
fn a61_gated_close_that_misses_its_deadline_returns_escrow_to_the_buyer() {
    let closer = acc("closer.test.near");
    let mut f = Fx::new(Some(closer.clone()));
    f.plan();
    let seq = f.propose(vec![(f.operator.clone(), METERING)], 5 * PRICE, 0);
    assert_eq!(f.fund(&f.buyer.clone(), seq, 1, 5 * PRICE, 5 * PRICE, None), 0);
    assert_eq!(f.accept(&f.buyer.clone()), "accepted");
    assert_eq!(f.accept(&f.owner.clone()), "closing");
    let d = f.deal();
    f.now = d.deadline_ms.0;
    f.env(&closer, 0);
    expect_refused("E_DEADLINE", || {
        f.b.close_sale(CloseOrder { deal_seq: d.seq, version: d.version, digest: d.digest.clone(), expected_generation: 1, closing_control_seq: d.closing_control_seq, manifest: "00".repeat(32), manifest_seq: U64(0), issued_at_ms: U64(f.now) })
    });
    f.env(&acc("anyone.test.near"), 0);
    f.b.abort_close(U64(seq));
    assert_eq!(f.b.get_control().owner, f.owner);
    assert_eq!(f.b.get_party(f.buyer.clone()).unwrap().escrow_return_claim.0, 5 * PRICE);
    assert_eq!(f.t().escrow_total.0, 0);
}

// =====================================================================================
// Payout machinery: stale callbacks, failed party payouts, stranded
// =====================================================================================

#[test]
fn a70_failed_party_payout_returns_to_the_same_category_and_person() {
    let mut f = Fx::new(None);
    f.plan();
    f.sell(vec![], 5 * PRICE);
    f.env(&f.owner.clone(), 1);
    f.b.claim_party(CLAIM_SALE_PROCEEDS);
    assert_eq!(f.b.get_party(f.owner.clone()).unwrap().sale_proceeds_claim.0, 0);
    assert_eq!(f.t().pending_total.0, 5 * PRICE);
    // The former owner can't release the record while the payout is in flight.
    f.env(&f.owner.clone(), 1);
    expect_refused("E_PENDING_REFS", || f.b.release_party_slot());
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Failed]);
    f.b.on_payout(0, U64(1));
    let r = f.b.get_party(f.owner.clone()).unwrap();
    assert_eq!(r.sale_proceeds_claim.0, 5 * PRICE);
    assert_eq!(r.profit_claim.0, 0);
    assert_eq!(r.escrow_return_claim.0, 0);
    assert_eq!(f.t().pending_total.0, 0);
    assert_eq!(f.t().held.0, 5 * PRICE);
    // Not released either: it still holds a claim.
    f.env(&f.owner.clone(), 1);
    expect_refused("E_CLAIM", || f.b.release_party_slot());
    // A callback with a stale id (slot free now) changes nothing.
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Successful(vec![])]);
    assert!(!f.b.on_payout(0, U64(1)));
    assert_eq!(f.t().held.0, 5 * PRICE);
}

#[test]
fn a71_party_payout_caps_and_guarded_claim() {
    let mut f = Fx::new(None);
    f.plan();
    f.sell(vec![], 5 * PRICE);
    // Give the former owner a second claim category via a failed profit withdrawal? It is no longer
    // the owner; instead exercise the guard: a guarded claim naming a stale payout_seq is refused.
    f.env(&f.owner.clone(), 1);
    expect_refused("E_REVIEWED", || f.b.claim_party_guarded(CLAIM_SALE_PROCEEDS, U128(5 * PRICE), U64(99)));
    expect_refused("E_REVIEWED", || f.b.claim_party_guarded(CLAIM_SALE_PROCEEDS, U128(1), U64(0)));
    expect_refused("E_ARGS", || f.b.claim_party(3));
    f.b.claim_party_guarded(CLAIM_SALE_PROCEEDS, U128(5 * PRICE), U64(0));
}

#[test]
fn a72_claim_stranded_only_by_beneficiary_and_a_detached_retry_touches_no_record() {
    // Strand a payout by corrupting state: remove the customer's record while its refund is in flight
    // (prevented on chain by pending_refs; injected here to reach the stranded path).
    let mut f = Fx::new(None);
    let p = f.plan();
    f.shell(&f.customer.clone(), p);
    f.buy(&f.customer.clone(), p, 2, 1, None);
    f.env(&f.customer.clone(), 1);
    f.b.refund_units(p, U64(2));
    f.b.entitlements.remove(&(f.customer.clone(), p));
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Failed]);
    f.b.on_payout(0, U64(1));
    assert_eq!(f.b.get_pending()[0].state, "stranded");
    f.env(&acc("mallory.test.near"), 1);
    expect_refused("E_NOT_BENEFICIARY", || f.b.claim_stranded(0));
    // The customer re-registers meanwhile; the detached retry must not credit the new record.
    f.shell(&f.customer.clone(), p);
    f.env(&f.customer.clone(), 1);
    f.b.claim_stranded(0);
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Failed]);
    f.b.on_payout(0, U64(2));
    assert_eq!(f.b.get_pending()[0].state, "stranded");
    assert_eq!(f.ent(&f.customer.clone(), p).claim.0, 0);
    assert_eq!(f.ent(&f.customer.clone(), p).pending_refs, 0);
    f.env(&f.customer.clone(), 1);
    f.b.claim_stranded(0);
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Successful(vec![])]);
    f.b.on_payout(0, U64(3));
    assert!(f.b.get_pending().is_empty());
    assert_eq!(f.t().held.0, 0);
}

// =====================================================================================
// Notes worth recording (behaviour, not refusals)
// =====================================================================================

#[test]
fn a80_note_revoked_key_still_settles_uses_until_the_settle_deadline() {
    // The spec says so; recorded here so the bound (hold.units, up to an hour) is explicit.
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 5, serve);
    f.env(&f.owner.clone(), 0);
    f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 5, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig);
    // The customer notices the device is compromised and revokes.
    f.env(&f.customer.clone(), 1);
    f.b.revoke_key(p, 0);
    assert_eq!(f.ent(&f.customer.clone(), p).serve_until_ms.0, f.now);
    // Uses "signed" after revocation (indistinguishable on chain) still charge all 5 units.
    f.now += 100_000;
    let uses: Vec<UseInput> = (0..5u8).map(|s| UseInput { slot: s, fingerprint: hex::encode([s + 1; 32]), sig: f.use_sig(&k, &f.customer.clone(), p, reg, 1, 1, s, &[s + 1; 32]) }).collect();
    f.env(&f.owner.clone(), 0);
    f.b.settle_hold(f.customer.clone(), p, 1, uses, true);
    assert_eq!(f.ent(&f.customer.clone(), p).consumed.0, 5);
    assert_eq!(f.t().available.0, 5 * PRICE);
}

#[test]
fn a81_note_seller_can_name_itself_as_a_kept_operator() {
    // Allowed if the buyer accepts the digest that lists it; recorded so the UI must show grants.
    let mut f = Fx::new(None);
    f.plan();
    let seller = f.owner.clone();
    f.sell(vec![(seller.clone(), METERING)], 5 * PRICE);
    assert_eq!(f.b.get_control().operators, vec![(seller, METERING, 2)]);
}

#[test]
fn a82_note_buyer_record_deposit_is_the_sellers_and_stays_until_the_buyer_releases() {
    let mut f = Fx::new(None);
    f.plan();
    let seq = f.propose(vec![], 5 * PRICE, 0);
    let r = f.b.get_party(f.buyer.clone()).unwrap();
    assert_eq!(r.payer, f.owner);
    assert!(r.deposit.0 > 0);
    f.env(&f.owner.clone(), 1);
    f.b.cancel_sale(U64(seq));
    // Only the buyer can release it; the seller's deposit waits on the buyer.
    f.env(&f.owner.clone(), 1);
    expect_refused("E_OWNER", || f.b.release_party_slot());
    assert!(f.b.get_party(f.buyer.clone()).is_some());
}

// a83: re-initialisation is refused by the #[init] wrapper generated by near-sdk-macros
// (`state_exists()` -> "The contract has already been initialized"), not by `Business::new`
// itself, so it cannot be exercised from a unit test; checked in the macro source instead.

#[test]
fn a73_failed_profit_withdrawal_becomes_the_owners_profit_claim_and_party_caps_bind() {
    let mut f = Fx::new(None);
    let p = f.plan();
    let reg = f.shell(&f.customer.clone(), p);
    let k = key(1);
    f.buy(&f.customer.clone(), p, 10, 1, Some(&k));
    let serve = f.now + 300_000;
    let sig = f.hold_sig(&k, &f.customer.clone(), p, reg, 1, 1, 5, serve);
    f.env(&f.owner.clone(), 0);
    f.b.open_hold(f.customer.clone(), p, HoldAuth { hold_seq: 1, units: 5, serve_until_ms: U64(serve), key_slot: 0, key_epoch: 1 }, sig);
    let uses: Vec<UseInput> = (0..5u8).map(|s| UseInput { slot: s, fingerprint: hex::encode([s + 1; 32]), sig: f.use_sig(&k, &f.customer.clone(), p, reg, 1, 1, s, &[s + 1; 32]) }).collect();
    f.env(&f.owner.clone(), 0);
    f.b.settle_hold(f.customer.clone(), p, 1, uses, true);
    assert_eq!(f.t().available.0, 5 * PRICE);
    f.env(&f.owner.clone(), 1);
    f.b.withdraw_profit(U128(PRICE));
    f.env(&f.owner.clone(), 1);
    f.b.withdraw_profit(U128(PRICE));
    f.env(&f.owner.clone(), 1);
    expect_refused("E_PARTY_CAP", || f.b.withdraw_profit(U128(PRICE)));
    assert_eq!(f.t().available.0, 3 * PRICE);
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Failed]);
    f.b.on_payout(0, U64(1));
    let r = f.b.get_party(f.owner.clone()).unwrap();
    assert_eq!(r.profit_claim.0, PRICE);
    assert_eq!(f.t().available.0, 3 * PRICE, "a failed withdrawal never returns to available");
    assert_eq!(f.t().claims_total.0, PRICE);
    f.env_with(&f.business.clone(), 0, vec![PromiseResult::Successful(vec![])]);
    f.b.on_payout(1, U64(2));
    assert_eq!(f.t().held.0, 9 * PRICE);
    f.env(&f.owner.clone(), 1);
    f.b.claim_party(CLAIM_PROFIT);
    assert_eq!(last_ft_transfer(), Some((f.owner.to_string(), PRICE)));
    // The customer's refund of the 5 unused units is unaffected by the owner's payouts.
    f.env(&f.customer.clone(), 1);
    f.b.refund_units(p, U64(5));
    assert_eq!(last_ft_transfer(), Some((f.customer.to_string(), 5 * PRICE)));
}
