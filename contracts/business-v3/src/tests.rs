//! Keyless unit tests for the v3 core (job 003e, addendum §8 scenarios 1-14 plus adversarial,
//! bounded-sequence and near-overflow cases).
//!
//! Every successful call made through `W::call` is followed by the storage check (S0: delta ≤ 0;
//! S1: delta = 0 for the FT receiver and the payout callback) and the invariants I1, U1, U2, P1
//! and P4. Every refusal made through `W::refuse` checks the error code and that nothing changed
//! before the panic. `catch_unwind` here only observes that the method validated before it
//! mutated; it is not a model of on-chain rollback (a real panic reverts the whole receipt).
//! Signatures are synthetic: ed25519 keys from fixed test seeds. Ownership changes are injected
//! with the test-only `test_set_owner`; that is not a sale.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_793_577_600_000; // 2026-11-02T00:00:00Z
const BIZ: &str = "studio.biz.near";
const TOKEN: &str = "tusd.near";
const FOUNDER: &str = "founder.near";
const METER: &str = "meter.near";
const METER2: &str = "meter2.near";
const CARA: &str = "cara.near";
const DEV: &str = "dev.near";
const SPONSOR: &str = "sponsor.near";
const BUYER: &str = "buyer.near";
const STRANGER: &str = "stranger.near";
const ACCOUNTS: &[&str] = &[FOUNDER, METER, METER2, CARA, DEV, SPONSOR, BUYER, STRANGER];
/// The unit price in base units of the token (addendum §8).
const P: u128 = 50_000;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MIN: u64 = 60_000;
const DAY: u64 = 86_400_000;

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, yocto: u128, at_ms: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id(BIZ))
        .predecessor_account_id(id(who))
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .block_timestamp(at_ms * 1_000_000);
    b
}

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn pk(k: &SigningKey) -> String {
    hex::encode(k.verifying_key().to_bytes())
}

/// A distinct fingerprint per hold and slot (`alt` gives a different one for the same slot).
fn fp(hold: u32, slot: u8, alt: u8) -> [u8; 32] {
    let mut f = [0u8; 32];
    f[..4].copy_from_slice(&hold.to_le_bytes());
    f[4] = slot;
    f[5] = alt;
    f[31] = 0xAB;
    f
}

fn rules() -> Rules {
    Rules { min_reserve: U128(5 * P), max_hold_units: 10, max_hold_ttl_ms: U64(60 * MIN), max_settle_grace_ms: U64(60 * MIN) }
}

fn plan_input(price: u128) -> PlanInput {
    PlanInput {
        unit_price: U128(price),
        max_units_per_purchase: 100,
        max_units_outstanding: 200,
        max_hold_units: 10,
        hold_ttl_ms: U64(30 * MIN),
        settle_grace_ms: U64(10 * MIN),
    }
}

fn buy_msg(plan_id: u32, units: u32, seq: u32, install: Option<(u8, &SigningKey, u16)>) -> String {
    let mut buy = serde_json::json!({ "plan_id": plan_id, "units": units, "purchase_seq": seq });
    if let Some((slot, k, per_day)) = install {
        buy["install"] = serde_json::json!({ "slot": slot, "pk": pk(k), "max_hold_units": 10, "max_units_per_day": per_day });
    }
    serde_json::json!({ "buy": buy }).to_string()
}

/// Runs `f`, which must panic, and returns the panic message.
fn panic_message<R>(f: impl FnOnce() -> R) -> String {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(_) => panic!("expected a refusal, but the call succeeded"),
        Err(e) => e
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default(),
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Midday UTC on the 15th of a month.
fn mid_month(yyyymm: u32) -> u64 {
    let (y, m) = ((yyyymm / 100) as i64, (yyyymm % 100) as i64);
    days_from_civil(y, m, 15) as u64 * DAY + DAY / 2
}

fn next_month(yyyymm: u32) -> u32 {
    if yyyymm % 100 == 12 {
        (yyyymm / 100 + 1) * 100 + 1
    } else {
        yyyymm + 1
    }
}

/// A test world: the contract, the clock and whether a test corrupted state on purpose.
struct W {
    b: Business,
    now: u64,
    /// Set by the stranded test, which deletes a record behind the contract's back; the
    /// per-record sums are then skipped (I1 and P4 are still checked).
    corrupt: bool,
}

impl W {
    fn new() -> W {
        // Start from empty storage, even if an earlier world ran on this thread.
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        testing_env!(ctx(FOUNDER, 0, T0).build());
        let b = Business::new("studio".into(), id(FOUNDER), id(TOKEN), rules());
        let mut w = W { b, now: T0, corrupt: false };
        w.env(FOUNDER, 0);
        let (_, pre) = w.measure(|_| ());
        assert_eq!(pre, 0);
        let (plan, grew) = w.measured(FOUNDER, NEAR, |b| b.create_plan(plan_input(P)));
        assert_eq!(plan, 1);
        assert!(grew > 0, "W1: a plan is new storage");
        let (_, grew) = w.measured(FOUNDER, NEAR, |b| b.appoint_operator(id(METER), METERING));
        let expected = borsh::to_vec(&(id(METER), OperatorGrant { caps: METERING, generation: 1 })).unwrap().len() as i64;
        assert_eq!(grew, expected, "W1: an operator grows the root by its encoded size");
        w.invariants();
        w
    }

    fn env(&self, who: &str, yocto: u128) {
        testing_env!(ctx(who, yocto, self.now).build());
    }

    fn env_callback(&self, ok: bool) {
        let result = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
        testing_env!(
            ctx(BIZ, 0, self.now).build(),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
    }

    /// Writes every cached collection entry and the root, as the runtime would at the end of a
    /// call, so `storage_usage` reflects the whole state.
    fn flush(&mut self) {
        self.b.plans.flush();
        self.b.entitlements.flush();
        self.b.party.flush();
        self.b.slots.flush();
        self.b.periods.flush();
        env::state_write(&self.b);
    }

    /// Storage delta of `f` within the current context.
    fn measure<R>(&mut self, f: impl FnOnce(&mut Business) -> R) -> (R, i64) {
        self.flush();
        let before = env::storage_usage() as i64;
        let r = f(&mut self.b);
        self.flush();
        (r, env::storage_usage() as i64 - before)
    }

    fn measured<R>(&mut self, who: &str, yocto: u128, f: impl FnOnce(&mut Business) -> R) -> (R, i64) {
        self.env(who, yocto);
        self.measure(f)
    }

    /// A call that must succeed, must not grow storage (S0) and must keep every invariant.
    fn call<R>(&mut self, who: &str, yocto: u128, f: impl FnOnce(&mut Business) -> R) -> R {
        let (r, d) = self.measured(who, yocto, f);
        assert!(d <= 0, "S0: storage grew by {d} bytes");
        self.invariants();
        r
    }

    /// A call that must be refused with `code`, having changed nothing before it panicked.
    fn refuse<R>(&mut self, who: &str, yocto: u128, code: &str, f: impl FnOnce(&mut Business) -> R) {
        let before = self.snap();
        self.env(who, yocto);
        let b = &mut self.b;
        let msg = panic_message(|| f(b));
        assert!(msg.contains(code), "expected {code}, got: {msg}");
        assert_eq!(self.snap(), before, "a refused call ({code}) changed state before panicking");
    }

    fn snap(&self) -> String {
        let b = &self.b;
        let ents: Vec<_> = ACCOUNTS
            .iter()
            .flat_map(|a| (1..=b.plan_count).map(move |p| (*a, p)))
            .map(|(a, p)| b.entitlements.get(&(id(a), p)).copied())
            .collect();
        let parties: Vec<_> = ACCOUNTS.iter().map(|a| b.party.get(&id(a)).copied()).collect();
        let slots: Vec<_> = (0..PAYOUT_SLOTS).map(|i| b.slots.get(&i).copied()).collect();
        let periods: Vec<_> = (0..PERIOD_RING).map(|i| b.periods.get(&i).copied()).collect();
        format!(
            "{:?}",
            (b.get_treasury(), ents, parties, slots, periods, &b.operators, &b.owner, b.generation, b.reg_seq, b.payout_seq, b.plan_count)
        )
    }

    /// I1, P4 always; U1, U2, P1 and the per-record bucket sums unless state was corrupted.
    fn invariants(&self) {
        let b = &self.b;
        assert_eq!(b.held, b.ent_free_value + b.ent_held_value + b.available + b.pending_total + b.claims_total, "I1");
        let slots: Vec<PayoutSlot> = (0..PAYOUT_SLOTS).map(|i| *b.slots.get(&i).expect("pre-allocated slot")).collect();
        let pending: u128 = slots.iter().filter(|s| s.state != SLOT_FREE).map(|s| s.amount).sum();
        assert_eq!(pending, b.pending_total, "P4");
        for s in &slots {
            if s.state == SLOT_FREE {
                assert_eq!(*s, PayoutSlot::free(), "a free slot is fully cleared");
            }
        }
        for i in 0..PERIOD_RING {
            let p = b.periods.get(&i).expect("pre-allocated period");
            assert!(p.yyyymm == 0 || ring_index(p.yyyymm) == i, "a period sits at its ring index");
        }
        if self.corrupt {
            return;
        }
        let (mut free_v, mut held_v, mut claims) = (0u128, 0u128, 0u128);
        for a in ACCOUNTS {
            for plan_id in 1..=b.plan_count {
                let Some(e) = b.entitlements.get(&(id(a), plan_id)) else { continue };
                let plan = b.plans.get(&plan_id).unwrap();
                let h = e.held_units();
                assert_eq!(e.purchased, e.free + h + e.consumed + e.refunded, "U1 for {a}");
                if e.hold.active {
                    assert_eq!(e.hold.used.count_ones(), e.hold.charged as u32, "U2 popcount");
                    assert!(e.hold.charged <= e.hold.units && e.hold.units <= plan.max_hold_units, "U2 bounds");
                    assert!(e.hold.used >> e.hold.units == 0, "U2 no bit beyond the hold");
                } else {
                    assert_eq!(e.hold, Hold::empty(), "U2 a closed hold is cleared");
                }
                assert_eq!(e.last_hold.used.count_ones(), e.last_hold.charged as u32, "U2 last hold");
                let in_flight = slots
                    .iter()
                    .filter(|s| s.state == SLOT_IN_FLIGHT && s.reg_id == e.reg_id && s.plan_id == plan_id && s.to.is(&id(a)))
                    .count();
                assert_eq!(e.pending_refs as usize, in_flight, "P1 for {a}");
                assert!(e.pending_refs <= MAX_CUSTOMER_PENDING, "P1 bound");
                free_v += e.free as u128 * plan.unit_price.0;
                held_v += h as u128 * plan.unit_price.0;
                claims += e.claim;
            }
            if let Some(r) = b.party.get(&id(a)) {
                let in_flight = slots.iter().filter(|s| s.state == SLOT_IN_FLIGHT && s.reg_id == 0 && s.to.is(&id(a))).count();
                assert_eq!(r.pending_refs as usize, in_flight, "P1 for party {a}");
                claims += r.claim;
            }
        }
        assert_eq!(free_v, b.ent_free_value, "free units times price");
        assert_eq!(held_v, b.ent_held_value, "held units times price");
        assert_eq!(claims, b.claims_total, "claims");
    }

    // ---------- scenario helpers ----------

    /// W1: a shell is new storage, paid by `payer`, charged at the measured growth.
    fn shell(&mut self, customer: &str, payer: &str) -> u64 {
        let (reg, grew) = self.measured(payer, NEAR, |b| b.sponsor_shell(id(customer), 1));
        assert!(grew > 0);
        let e = self.ent(customer);
        assert_eq!(e.storage_paid.0, grew as u128 * env::storage_byte_cost().as_yoctonear(), "charged the measured growth");
        assert_eq!(e.storage_payer, id(payer));
        self.invariants();
        reg.0
    }

    /// The token delivering a transfer; returns the unused amount. S1: never allocates.
    fn ft(&mut self, sender: &str, amount: u128, msg: String) -> u128 {
        let (r, d) = self.measured(TOKEN, 0, |b| b.ft_on_transfer(id(sender), U128(amount), msg));
        assert_eq!(d, 0, "S1: the FT receiver must not change storage size");
        self.invariants();
        match r {
            PromiseOrValue::Value(v) => v.0,
            PromiseOrValue::Promise(_) => panic!("the receiver never returns a promise"),
        }
    }

    fn buy(&mut self, customer: &str, units: u32, seq: u32, install: Option<(u8, &SigningKey)>) -> u128 {
        self.ft(customer, units as u128 * P, buy_msg(1, units, seq, install.map(|(s, k)| (s, k, 30))))
    }

    /// A purchase that must come back whole with nothing changed.
    fn returned(&mut self, sender: &str, amount: u128, msg: String) {
        let before = self.snap();
        assert_eq!(self.ft(sender, amount, msg), amount, "the whole amount comes back");
        assert_eq!(self.snap(), before, "a returned purchase changed nothing");
    }

    fn ent(&self, c: &str) -> EntitlementView {
        self.b.get_entitlement(id(c), 1).expect("entitlement")
    }

    fn t(&self) -> TreasuryView {
        self.b.get_treasury()
    }

    #[allow(clippy::too_many_arguments)]
    fn auth(&self, c: &str, k: &SigningKey, reg: u64, seq: u32, units: u8, serve_until: u64, slot: u8, epoch: u32) -> (HoldAuth, String) {
        let m = hold_message(&id(BIZ), 1, &id(c), reg, slot, epoch, seq, units, serve_until);
        let a = HoldAuth { hold_seq: seq, units, serve_until_ms: U64(serve_until), key_slot: slot, key_epoch: epoch };
        (a, hex::encode(k.sign(&m).to_bytes()))
    }

    /// The usual HoldAuth: key slot 0, epoch 1, serving for 20 minutes.
    fn std_auth(&self, c: &str, k: &SigningKey, seq: u32, units: u8) -> (HoldAuth, String) {
        self.auth(c, k, self.ent(c).reg_id.0, seq, units, self.now + 20 * MIN, 0, 1)
    }

    fn open(&mut self, c: &str, k: &SigningKey, seq: u32, units: u8) -> String {
        let (a, s) = self.std_auth(c, k, seq, units);
        self.call(METER, 0, |b| b.open_hold(id(c), 1, a, s))
    }

    #[allow(clippy::too_many_arguments)]
    fn use_with(&self, c: &str, k: &SigningKey, reg: u64, key_slot: u8, epoch: u32, seq: u32, slot: u8, f: [u8; 32]) -> UseInput {
        let m = use_message(&id(BIZ), 1, &id(c), reg, key_slot, epoch, seq, slot, &f);
        UseInput { slot, fingerprint: hex::encode(f), sig: hex::encode(k.sign(&m).to_bytes()) }
    }

    fn use_(&self, c: &str, k: &SigningKey, seq: u32, slot: u8, alt: u8) -> UseInput {
        self.use_with(c, k, self.ent(c).reg_id.0, 0, 1, seq, slot, fp(seq, slot, alt))
    }

    fn uses(&self, c: &str, k: &SigningKey, seq: u32, slots: std::ops::Range<u8>) -> Vec<UseInput> {
        slots.map(|s| self.use_(c, k, seq, s, 0)).collect()
    }

    fn settle(&mut self, c: &str, seq: u32, uses: Vec<UseInput>, close: bool) -> Vec<String> {
        self.call(METER, 0, |b| b.settle_hold(id(c), 1, seq, uses, close))
    }

    /// The payout callback, run as the contract with the transfer's outcome. S1: never
    /// allocates.
    fn callback(&mut self, slot: u8, payout_id: u64, ok: bool) -> bool {
        self.env_callback(ok);
        let (r, d) = self.measure(|b| b.on_payout(slot, U64(payout_id)));
        assert_eq!(d, 0, "S1: the payout callback must not change storage size");
        self.invariants();
        r
    }

    /// The newest payout in flight: (slot, payout id).
    fn last_payout(&self) -> (u8, u64) {
        self.b.get_pending().iter().filter(|p| p.state == "in_flight").max_by_key(|p| p.payout_id.0).map(|p| (p.slot, p.payout_id.0)).expect("a payout in flight")
    }

    fn refund(&mut self, c: &str, units: u64) -> (u8, u64) {
        self.call(c, 1, |b| drop(b.refund_units(1, U64(units))));
        self.last_payout()
    }

    fn withdraw(&mut self, who: &str, amount: u128) -> (u8, u64) {
        self.call(who, 1, |b| drop(b.withdraw_profit(U128(amount))));
        self.last_payout()
    }

    fn inject_owner(&mut self, owner: &str, generation: u32, grants: &[(&str, u8)]) {
        self.env(owner, 0);
        self.b.test_set_owner(id(owner), generation, grants.iter().map(|(a, c)| (id(a), *c)).collect());
        self.invariants();
    }
}

fn all(r: &[String], s: &str, n: usize) {
    assert_eq!(r.len(), n);
    assert!(r.iter().all(|x| x == s), "expected {n} × {s}, got {r:?}");
}

/// Scenario 1, the 100/20/80 path: a self-paid shell, 100 units bought with a key installed,
/// two holds of 10 each fully used and closed.
fn happy() -> (W, SigningKey) {
    let mut w = W::new();
    let k = key(1);
    assert_eq!(w.shell(CARA, CARA), 1);
    assert_eq!(w.buy(CARA, 100, 1, Some((0, &k))), 0);
    assert_eq!(w.open(CARA, &k, 1, 10), "opened");
    let u = w.uses(CARA, &k, 1, 0..10);
    all(&w.settle(CARA, 1, u, true), "charged", 10);
    assert_eq!(w.open(CARA, &k, 2, 10), "opened");
    let u = w.uses(CARA, &k, 2, 0..10);
    all(&w.settle(CARA, 2, u, true), "charged", 10);
    (w, k)
}

fn assert_100_20_80(w: &W) {
    let e = w.ent(CARA);
    assert_eq!((e.free.0, e.consumed.0, e.purchased.0, e.refunded.0), (80, 20, 100, 0));
    let t = w.t();
    assert_eq!((t.available.0, t.ent_free_value.0, t.ent_held_value.0, t.held.0), (20 * P, 80 * P, 0, 100 * P));
    assert_eq!((e.last_hold_seq, e.last_hold_used, e.last_hold_charged), (2, 0x3FF, 10));
    assert!(!e.hold_active);
}

// ---------- scenario 1 ----------

#[test]
fn s01_the_100_20_80_path() {
    let (w, _) = happy();
    assert_100_20_80(&w);
    let p = w.b.get_period(202611).unwrap();
    assert_eq!((p.purchases_in.0, p.earned.0, p.refunds_paid.0), (100 * P, 20 * P, 0));
    assert_eq!(w.ent(CARA).key_states, vec![1, 0, 0, 0]);
    assert_eq!(w.ent(CARA).key_epochs, vec![1, 0, 0, 0]);
    assert_eq!(w.t().withdrawable.0, 15 * P);
}

// ---------- scenario 2 ----------

#[test]
fn s02_the_same_use_twice_is_already_and_a_closed_hold_is_closed() {
    let mut w = W::new();
    let k = key(1);
    w.shell(CARA, CARA);
    w.buy(CARA, 100, 1, Some((0, &k)));
    w.open(CARA, &k, 1, 10);
    let u = w.uses(CARA, &k, 1, 0..10);
    w.settle(CARA, 1, u, true);
    w.open(CARA, &k, 2, 10);
    let u = w.uses(CARA, &k, 2, 0..5);
    all(&w.settle(CARA, 2, u, false), "charged", 5);
    let available = w.t().available;
    // The same use again, alone and inside a mixed batch.
    let again = vec![w.use_(CARA, &k, 2, 2, 0)];
    all(&w.settle(CARA, 2, again, false), "already", 1);
    let mixed = vec![w.use_(CARA, &k, 2, 3, 0), w.use_(CARA, &k, 2, 5, 0), w.use_(CARA, &k, 2, 5, 0)];
    assert_eq!(w.settle(CARA, 2, mixed, false), vec!["already", "charged", "already"]);
    assert_eq!(w.ent(CARA).hold_charged, 6);
    assert_eq!(w.t().available.0, available.0 + P);
    // The whole earlier batch again (a duplicate batch) charges nothing.
    let dup = w.uses(CARA, &k, 2, 0..6);
    all(&w.settle(CARA, 2, dup, false), "already", 6);
    assert_eq!(w.ent(CARA).hold_charged, 6);
    let rest = w.uses(CARA, &k, 2, 6..10);
    all(&w.settle(CARA, 2, rest, true), "charged", 4);
    // h1 closed long ago.
    let late = w.uses(CARA, &k, 1, 0..1);
    w.refuse(METER, 0, "E_HOLD_CLOSED", |b| b.settle_hold(id(CARA), 1, 1, late, false));
    assert_100_20_80(&w);
}

// ---------- scenario 3 ----------

#[test]
fn s03_a_different_use_for_a_charged_slot_reverts_the_whole_batch() {
    let mut w = W::new();
    let k = key(1);
    w.shell(CARA, CARA);
    w.buy(CARA, 100, 1, Some((0, &k)));
    w.open(CARA, &k, 1, 10);
    let u = w.uses(CARA, &k, 1, 0..5);
    w.settle(CARA, 1, u, false);
    // Slot 5 is new and valid, slot 3 is altered: nothing at all is charged.
    let batch = vec![w.use_(CARA, &k, 1, 5, 0), w.use_(CARA, &k, 1, 3, 1)];
    w.refuse(METER, 0, "E_CONFLICT(3)", |b| b.settle_hold(id(CARA), 1, 1, batch, true));
    // Two different uses for one new slot inside one batch.
    let batch = vec![w.use_(CARA, &k, 1, 6, 0), w.use_(CARA, &k, 1, 6, 1)];
    w.refuse(METER, 0, "E_CONFLICT(6)", |b| b.settle_hold(id(CARA), 1, 1, batch, false));
    let e = w.ent(CARA);
    assert_eq!((e.hold_charged, e.hold_used, e.consumed.0), (5, 0x1F, 5));
}

// ---------- scenario 4 ----------

#[test]
fn s04_signatures_bind_the_hold_and_holds_need_a_live_customer_authorization() {
    let (mut w, k) = happy();
    w.open(CARA, &k, 3, 10);
    // A use signed for h1 submitted into h3 (and one claiming another slot's signature).
    let old = w.use_(CARA, &k, 1, 0, 0);
    w.refuse(METER, 0, "E_SIG", |b| b.settle_hold(id(CARA), 1, 3, vec![old], false));
    let mut moved = w.use_(CARA, &k, 3, 0, 0);
    moved.slot = 1;
    w.refuse(METER, 0, "E_SIG", |b| b.settle_hold(id(CARA), 1, 3, vec![moved], false));
    // Signed by another key, or for another customer.
    let stranger = w.use_(CARA, &key(9), 3, 0, 0);
    w.refuse(METER, 0, "E_SIG", |b| b.settle_hold(id(CARA), 1, 3, vec![stranger], false));
    let other = w.use_with(DEV, &k, 1, 0, 1, 3, 0, fp(3, 0, 0));
    w.refuse(METER, 0, "E_SIG", |b| b.settle_hold(id(CARA), 1, 3, vec![other], false));
    // Slot and batch bounds.
    let out = w.use_(CARA, &k, 3, 10, 0);
    w.refuse(METER, 0, "E_SLOT", |b| b.settle_hold(id(CARA), 1, 3, vec![out], false));
    let many: Vec<UseInput> = (0..11).map(|_| w.use_(CARA, &k, 3, 0, 0)).collect();
    w.refuse(METER, 0, "E_BATCH", |b| b.settle_hold(id(CARA), 1, 3, many, false));
    w.call(METER, 0, |b| b.release_hold(id(CARA), 1, 3));
    // A new day: the key's 30-unit daily cap (all used by h1-h3) starts over.
    w.now += DAY;

    let reg = w.ent(CARA).reg_id.0;
    let now = w.now;
    // Expired: less than 60 s left to serve.
    let (a, s) = w.auth(CARA, &k, reg, 4, 5, now + MIN - 1, 0, 1);
    w.refuse(METER, 0, "E_EXPIRED", |b| b.open_hold(id(CARA), 1, a, s));
    // Past the plan's 30-minute limit.
    let (a, s) = w.auth(CARA, &k, reg, 4, 5, now + 31 * MIN, 0, 1);
    w.refuse(METER, 0, "E_TTL", |b| b.open_hold(id(CARA), 1, a, s));
    // No customer authorization: a missing, malformed or foreign signature.
    let (a, _) = w.std_auth(CARA, &k, 4, 5);
    w.refuse(METER, 0, "E_SIG", |b| b.open_hold(id(CARA), 1, a.clone(), String::new()));
    w.refuse(METER, 0, "E_SIG", |b| b.open_hold(id(CARA), 1, a.clone(), "00".repeat(64)));
    let (_, foreign) = w.std_auth(CARA, &key(9), 4, 5);
    w.refuse(METER, 0, "E_SIG", |b| b.open_hold(id(CARA), 1, a.clone(), foreign));
    // Signed for 5 units, submitted as 6.
    let (mut bigger, s5) = w.std_auth(CARA, &k, 4, 5);
    bigger.units = 6;
    w.refuse(METER, 0, "E_SIG", |b| b.open_hold(id(CARA), 1, bigger, s5));
    // Wrong key slot, wrong epoch, wrong sequence, too many units, wrong caller.
    let (a, s) = w.auth(CARA, &k, reg, 4, 5, now + 20 * MIN, 1, 1);
    w.refuse(METER, 0, "E_KEY", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.auth(CARA, &k, reg, 4, 5, now + 20 * MIN, 0, 2);
    w.refuse(METER, 0, "E_KEY", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.auth(CARA, &k, reg, 4, 5, now + 20 * MIN, 9, 1);
    w.refuse(METER, 0, "E_KEY", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.std_auth(CARA, &k, 5, 5);
    w.refuse(METER, 0, "E_HOLD_SEQ", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.std_auth(CARA, &k, 3, 5);
    w.refuse(METER, 0, "E_HOLD_SEQ_USED", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.std_auth(CARA, &k, 4, 11);
    w.refuse(METER, 0, "E_UNITS", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.std_auth(CARA, &k, 4, 0);
    w.refuse(METER, 0, "E_UNITS", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.std_auth(CARA, &k, 4, 5);
    w.refuse(STRANGER, 0, "E_NOT_OPERATOR", |b| b.open_hold(id(CARA), 1, a.clone(), s.clone()));
    // Paused by the customer, then unpaused.
    w.call(CARA, 1, |b| b.set_paused(1, true));
    w.refuse(METER, 0, "E_PAUSED", |b| b.open_hold(id(CARA), 1, a.clone(), s.clone()));
    w.call(CARA, 1, |b| b.set_paused(1, false));
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a.clone(), s.clone())), "opened");
    // The identical authorization again is idempotent.
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "already");
    // The daily cap: 30 units a day on this key; 5 so far today, released units still count.
    w.call(METER, 0, |b| b.release_hold(id(CARA), 1, 4));
    assert_eq!(w.open(CARA, &k, 5, 10), "opened");
    w.call(METER, 0, |b| b.release_hold(id(CARA), 1, 5));
    assert_eq!(w.open(CARA, &k, 6, 10), "opened");
    w.call(METER, 0, |b| b.release_hold(id(CARA), 1, 6));
    let (a, s) = w.std_auth(CARA, &k, 7, 6);
    w.refuse(METER, 0, "E_DAILY_CAP", |b| b.open_hold(id(CARA), 1, a, s));
    assert_eq!(w.open(CARA, &k, 7, 5), "opened");
    w.call(METER, 0, |b| b.release_hold(id(CARA), 1, 7));
    let (a, s) = w.std_auth(CARA, &k, 8, 1);
    w.refuse(METER, 0, "E_DAILY_CAP", |b| b.open_hold(id(CARA), 1, a, s));
    w.now += DAY;
    assert_eq!(w.open(CARA, &k, 8, 10), "opened");
    assert_eq!(w.ent(CARA).free.0, 70);
}

#[test]
fn s04b_revoked_keys_and_skipped_sequences_defeat_signed_authorizations() {
    let (mut w, k) = happy();
    // A HoldAuth signed but not yet submitted is burned by skip_hold_seq.
    let (a, s) = w.std_auth(CARA, &k, 3, 5);
    w.refuse(SPONSOR, 1, "E_NOT_CUSTOMER", |b| b.skip_hold_seq(1));
    w.call(CARA, 1, |b| b.skip_hold_seq(1));
    w.refuse(METER, 0, "E_HOLD_SEQ_USED", |b| b.open_hold(id(CARA), 1, a, s));
    // A second key with its own daily cap.
    let k2 = key(2);
    w.refuse(CARA, 1, "E_KEY", |b| b.install_key(1, 0, pk(&k2), 10, 15));
    w.refuse(CARA, 1, "E_ARGS", |b| b.install_key(1, 1, "zz".into(), 10, 15));
    w.refuse(CARA, 1, "E_ARGS", |b| b.install_key(1, 1, pk(&k2), 11, 15));
    w.refuse(CARA, 0, "E_DEPOSIT", |b| b.install_key(1, 1, pk(&k2), 10, 15));
    w.call(CARA, 1, |b| b.install_key(1, 1, pk(&k2), 10, 15));
    let reg = w.ent(CARA).reg_id.0;
    let (a, s) = w.auth(CARA, &k2, reg, 4, 8, w.now + 20 * MIN, 1, 1);
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "opened");
    // One use signed, then the key is revoked: serving stops now, the signed use still settles.
    let u = w.use_with(CARA, &k2, reg, 1, 1, 4, 0, fp(4, 0, 0));
    w.call(CARA, 1, |b| b.revoke_key(1, 1));
    let e = w.ent(CARA);
    assert_eq!(e.serve_until_ms.0, w.now);
    assert_eq!((e.key_states[1], e.key_epochs[1]), (2, 2));
    w.now += 5 * MIN;
    all(&w.settle(CARA, 4, vec![u], true), "charged", 1);
    // The revoked key cannot open another hold, at its old or new epoch.
    let (a, s) = w.auth(CARA, &k2, reg, 5, 1, w.now + 20 * MIN, 1, 1);
    w.refuse(METER, 0, "E_KEY", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.auth(CARA, &k2, reg, 5, 1, w.now + 20 * MIN, 1, 2);
    w.refuse(METER, 0, "E_KEY", |b| b.open_hold(id(CARA), 1, a, s));
    w.refuse(CARA, 1, "E_KEY", |b| b.revoke_key(1, 1));
    // Reinstalling the same key in that slot moves to epoch 3; epoch-1 signatures stay dead.
    w.call(CARA, 1, |b| b.install_key(1, 1, pk(&k2), 10, 15));
    let (a, s) = w.auth(CARA, &k2, reg, 5, 1, w.now + 20 * MIN, 1, 1);
    w.refuse(METER, 0, "E_KEY", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.auth(CARA, &k2, reg, 5, 7, w.now + 20 * MIN, 1, 3);
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "opened");
    // Daily cap on this key: 8 + 7 = 15 today.
    w.call(METER, 0, |b| b.release_hold(id(CARA), 1, 5));
    let (a, s) = w.auth(CARA, &k2, reg, 6, 1, w.now + 20 * MIN, 1, 3);
    w.refuse(METER, 0, "E_DAILY_CAP", |b| b.open_hold(id(CARA), 1, a, s));
    let e = w.ent(CARA);
    assert_eq!((e.free.0, e.consumed.0), (79, 21));
}

// ---------- scenario 5 ----------

#[test]
fn s05_refund_with_a_hold_open_settles_on_success() {
    let (mut w, k) = happy();
    w.open(CARA, &k, 3, 10);
    w.refuse(CARA, 1, "E_UNITS", |b| b.refund_units(1, U64(81)));
    w.refuse(CARA, 1, "E_UNITS", |b| b.refund_units(1, U64(71)));
    w.refuse(CARA, 1, "E_UNITS", |b| b.refund_units(1, U64(0)));
    w.refuse(CARA, 2, "E_DEPOSIT", |b| b.refund_units(1, U64(70)));
    w.refuse(STRANGER, 1, "E_NOT_CUSTOMER", |b| b.refund_units(1, U64(70)));
    let (slot, pid) = w.refund(CARA, 70);
    let p = &w.b.get_pending()[0];
    assert_eq!((p.kind.as_str(), p.amount.0, p.to.as_str()), ("refund", 70 * P, CARA));
    assert_eq!(w.ent(CARA).pending_refs, 1);
    assert!(w.callback(slot, pid, true));
    let e = w.ent(CARA);
    assert_eq!((e.refunded.0, e.free.0, e.pending_refs), (70, 0, 0));
    assert_eq!(w.t().held.0, 30 * P);
    assert_eq!(w.t().pending_total.0, 0);
    assert_eq!(w.b.get_period(202611).unwrap().refunds_paid.0, 70 * P);
    // The same callback again changes nothing.
    let before = w.snap();
    assert!(!w.callback(slot, pid, true));
    assert!(!w.callback(slot, pid, false));
    assert_eq!(w.snap(), before);
}

#[test]
fn s05b_a_failed_refund_becomes_the_customers_claim_never_profit() {
    let (mut w, k) = happy();
    w.open(CARA, &k, 3, 10);
    let (slot, pid) = w.refund(CARA, 70);
    let available = w.t().available;
    assert!(!w.callback(slot, pid, false));
    let e = w.ent(CARA);
    assert_eq!((e.claim.0, e.refunded.0, e.free.0, e.pending_refs), (70 * P, 70, 0, 0));
    let t = w.t();
    assert_eq!((t.claims_total.0, t.held.0, t.available.0), (70 * P, 100 * P, available.0));
    assert_eq!(t.withdrawable.0, 15 * P, "a failed refund never becomes withdrawable");
    // The slot is reused for the claim with a new payout id; the old callback is ignored.
    w.call(CARA, 1, |b| drop(b.claim_customer(1)));
    let (slot2, pid2) = w.last_payout();
    assert_eq!(slot2, slot);
    assert!(pid2 > pid);
    let before = w.snap();
    assert!(!w.callback(slot, pid, true), "a stale callback for a reused slot does nothing");
    assert_eq!(w.snap(), before);
    assert!(w.callback(slot2, pid2, true));
    let t = w.t();
    assert_eq!((t.claims_total.0, t.held.0), (0, 30 * P));
    assert_eq!(w.ent(CARA).claim.0, 0);
    assert_eq!(w.b.get_period(202611).unwrap().claims_paid.0, 70 * P);
    w.refuse(CARA, 1, "E_FUNDS", |b| b.claim_customer(1));
}

#[test]
fn s05c_a_missing_callback_stays_pending_and_visible() {
    let (mut w, _) = happy();
    let (slot, pid) = w.refund(CARA, 30);
    // No callback ever runs. Time passes; nothing resolves it by guessing.
    w.now += 40 * DAY;
    w.invariants();
    let p = w.b.get_pending();
    assert_eq!(p.len(), 1);
    assert_eq!((p[0].slot, p[0].payout_id.0, p[0].state.as_str(), p[0].amount.0), (slot, pid, "in_flight", 30 * P));
    assert_eq!(p[0].started_at_ms.0, T0);
    let t = w.t();
    assert_eq!((t.pending_total.0, t.held.0, t.claims_total.0), (30 * P, 100 * P, 0));
    assert_eq!(w.ent(CARA).pending_refs, 1);
    // There is no method that retries or settles it; the record cannot be deleted under it.
    let (s2, p2) = w.refund(CARA, 50);
    assert!(w.callback(s2, p2, true));
    w.refuse(CARA, 1, "E_PENDING_REFS", |b| b.unregister(id(CARA), 1));
    assert_eq!(w.b.get_pending().len(), 1);
}

// ---------- scenario 6 ----------

#[test]
fn s06_ownership_change_mid_hold_injected() {
    let (mut w, k) = happy();
    w.open(CARA, &k, 3, 10);
    w.inject_owner(BUYER, 2, &[(METER2, METERING)]);
    assert_eq!(w.b.get_control(), (id(BUYER), 2));
    assert!(w.b.get_party(id(BUYER)).is_some(), "the successor gets a party record");
    let u = w.uses(CARA, &k, 3, 0..4);
    w.refuse(METER, 0, "E_NOT_OPERATOR", |b| b.settle_hold(id(CARA), 1, 3, u.clone(), false));
    // A grant left over from generation 1 does not count in generation 2.
    w.b.operators.push((id(METER), OperatorGrant { caps: METERING, generation: 1 }));
    w.refuse(METER, 0, "E_NOT_OPERATOR", |b| b.settle_hold(id(CARA), 1, 3, u.clone(), false));
    w.b.operators.pop();
    all(&w.call(METER2, 0, |b| b.settle_hold(id(CARA), 1, 3, u, true)), "charged", 4);
    let e = w.ent(CARA);
    assert_eq!((e.consumed.0, e.free.0), (24, 76));
    w.refuse(FOUNDER, 1, "E_NOT_OWNER", |b| b.withdraw_profit(U128(P)));
    w.refuse(FOUNDER, NEAR, "E_NOT_OWNER", |b| b.appoint_operator(id(METER), METERING));
    w.refuse(FOUNDER, NEAR, "E_NOT_OWNER", |b| b.create_plan(plan_input(P)));
    w.refuse(BUYER, 1, "E_RESERVED", |b| b.withdraw_profit(U128(19 * P + 1)));
    let (slot, pid) = w.withdraw(BUYER, 19 * P);
    assert!(w.callback(slot, pid, true));
    assert_eq!(w.t().available.0, 5 * P);
    assert_eq!(w.b.get_period(202611).unwrap().owner_withdrawals.0, 19 * P);
}

// ---------- scenario 7 ----------

#[test]
fn s07_the_party_slot_schedule() {
    let (mut w, _) = happy();
    let (slot, pid) = w.withdraw(FOUNDER, 10 * P);
    assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().pending_refs, 1);
    let available = w.t().available.0;
    assert_eq!(available, 10 * P);
    w.inject_owner(BUYER, 2, &[]);
    w.refuse(FOUNDER, 1, "E_PENDING_REFS", |b| b.release_party_slot());
    assert!(!w.callback(slot, pid, false));
    assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().claim.0, 10 * P);
    assert_eq!(w.t().available.0, available, "the failed withdrawal is the founder's claim, not the buyer's profit");
    assert_eq!(w.t().withdrawable.0, 5 * P);
    w.refuse(FOUNDER, 1, "E_CLAIM", |b| b.release_party_slot());
    w.refuse(STRANGER, 1, "E_NO_RECORD", |b| b.claim_party());
    w.call(FOUNDER, 1, |b| drop(b.claim_party()));
    let (slot, pid) = w.last_payout();
    assert_eq!(w.t().available.0, available);
    assert!(w.callback(slot, pid, true));
    assert_eq!(w.t().available.0, available);
    assert_eq!(w.t().held.0, 90 * P);
    w.call(FOUNDER, 1, |b| b.release_party_slot());
    assert!(w.b.get_party(id(FOUNDER)).is_none());
    w.refuse(BUYER, 1, "E_OWNER", |b| b.release_party_slot());
}

// ---------- scenario 8 ----------

#[test]
fn s08_a_payout_whose_record_vanished_is_stranded_then_reclaimed() {
    let (mut w, _) = happy();
    let (slot, pid) = w.refund(CARA, 10);
    // Corrupt on purpose: the record disappears while its payout is in flight.
    w.corrupt = true;
    w.b.entitlements.remove(&(id(CARA), 1));
    assert!(!w.callback(slot, pid, false));
    let p = w.b.get_pending();
    assert_eq!((p.len(), p[0].state.as_str(), p[0].amount.0), (1, "stranded", 10 * P));
    assert_eq!(w.t().pending_total.0, 10 * P);
    // The stale callback for a stranded slot does nothing.
    assert!(!w.callback(slot, pid, true));
    w.refuse(STRANGER, 1, "E_NOT_BENEFICIARY", |b| b.claim_stranded(slot));
    w.refuse(CARA, 1, "E_STATE", |b| b.claim_stranded(slot + 1));
    w.call(CARA, 1, |b| drop(b.claim_stranded(slot)));
    let (s2, p2) = w.last_payout();
    assert_eq!(s2, slot, "re-sent through the same slot");
    assert!(p2 > pid);
    // It fails again: still stranded, still pending.
    assert!(!w.callback(s2, p2, false));
    assert_eq!(w.b.get_pending()[0].state, "stranded");
    w.call(CARA, 1, |b| drop(b.claim_stranded(slot)));
    let (s3, p3) = w.last_payout();
    assert!(w.callback(s3, p3, true));
    assert!(w.b.get_pending().is_empty());
    assert_eq!(w.t().held.0, 90 * P);
    assert_eq!(w.t().pending_total.0, 0);
}

#[test]
fn s08b_a_record_with_a_payout_in_flight_cannot_be_deleted() {
    let (mut w, _) = happy();
    let (slot, pid) = w.refund(CARA, 80);
    w.refuse(CARA, 1, "E_PENDING_REFS", |b| b.unregister(id(CARA), 1));
    assert!(!w.callback(slot, pid, false));
    w.refuse(CARA, 1, "E_CLAIM", |b| b.unregister(id(CARA), 1));
    w.call(CARA, 1, |b| drop(b.claim_customer(1)));
    let (slot, pid) = w.last_payout();
    w.refuse(CARA, 1, "E_PENDING_REFS", |b| b.unregister(id(CARA), 1));
    assert!(w.callback(slot, pid, true));
    let (_, d) = w.measured(CARA, 1, |b| b.unregister(id(CARA), 1));
    assert!(d < 0, "deleting the record frees its storage");
    assert!(w.b.get_entitlement(id(CARA), 1).is_none());
    w.invariants();
}

// ---------- scenario 9 ----------

#[test]
fn s09_a_sponsor_pays_for_storage_and_gets_no_authority() {
    let mut w = W::new();
    let k = key(1);
    w.refuse(SPONSOR, NEAR, "E_ARGS", |b| b.sponsor_shell(id(CARA), 7));
    w.shell(CARA, SPONSOR);
    w.refuse(SPONSOR, NEAR, "E_EXISTS", |b| b.sponsor_shell(id(CARA), 1));
    w.refuse(CARA, NEAR, "E_EXISTS", |b| b.sponsor_shell(id(CARA), 1));
    w.refuse(SPONSOR, 1, "E_NOT_CUSTOMER", |b| b.install_key(1, 0, pk(&key(7)), 10, 30));
    w.refuse(SPONSOR, 1, "E_NOT_CUSTOMER", |b| b.set_paused(1, true));
    w.refuse(SPONSOR, 1, "E_NOT_CUSTOMER", |b| b.refund_units(1, U64(1)));
    // The sponsor paying tokens credits nobody: the sender has no record.
    w.returned(SPONSOR, 10 * P, buy_msg(1, 10, 1, None));
    // The customer installs through the purchase; the payer is still the sponsor.
    assert_eq!(w.buy(CARA, 100, 1, Some((0, &k))), 0);
    let e = w.ent(CARA);
    assert_eq!((e.storage_payer.as_str(), e.key_states[0], e.free.0), (SPONSOR, 1, 100));
    // Once bought or keyed, only the customer may unregister.
    w.refuse(SPONSOR, 1, "E_NOT_CUSTOMER", |b| b.unregister(id(CARA), 1));
    // An untouched shell can be taken back by its sponsor, deposit returned to the sponsor.
    w.shell(DEV, SPONSOR);
    w.refuse(STRANGER, 1, "E_NOT_CUSTOMER", |b| b.unregister(id(DEV), 1));
    let (_, d) = w.measured(SPONSOR, 1, |b| b.unregister(id(DEV), 1));
    assert!(d < 0);
    assert!(w.b.get_entitlement(id(DEV), 1).is_none());
}

// ---------- scenario 10 ----------

#[test]
fn s10_re_registration_defeats_old_signatures() {
    let (mut w, k) = happy();
    let old_reg = w.ent(CARA).reg_id.0;
    let old_use = w.use_with(CARA, &k, old_reg, 0, 1, 1, 0, fp(1, 0, 7));
    let (slot, pid) = w.refund(CARA, 80);
    assert!(w.callback(slot, pid, true));
    w.refuse(CARA, 0, "E_DEPOSIT", |b| b.unregister(id(CARA), 1));
    let (_, d) = w.measured(CARA, 1, |b| b.unregister(id(CARA), 1));
    assert!(d < 0);
    // Same block: a new shell, the same key reinstalled at epoch 1 again.
    let reg = w.shell(CARA, CARA);
    assert!(reg > old_reg);
    assert_eq!(w.buy(CARA, 10, 1, Some((0, &k))), 0);
    assert_eq!(w.ent(CARA).key_epochs[0], 1);
    // Only the registration id differs, and that defeats the old authorizations.
    let (a, s) = w.auth(CARA, &k, old_reg, 1, 5, w.now + 20 * MIN, 0, 1);
    w.refuse(METER, 0, "E_SIG", |b| b.open_hold(id(CARA), 1, a, s));
    assert_eq!(w.open(CARA, &k, 1, 5), "opened");
    w.refuse(METER, 0, "E_SIG", |b| b.settle_hold(id(CARA), 1, 1, vec![old_use], false));
    let fresh = w.use_(CARA, &k, 1, 0, 7);
    all(&w.settle(CARA, 1, vec![fresh], true), "charged", 1);
    let e = w.ent(CARA);
    assert_eq!((e.purchased.0, e.consumed.0, e.free.0), (10, 1, 9));
}

// ---------- scenario 11 ----------

#[test]
fn s11_invalid_purchases_come_back_whole_with_nothing_changed() {
    let (mut w, k) = happy();
    w.returned(CARA, 100 * P, buy_msg(1, 100, 1, None)); // replayed sequence
    w.returned(CARA, 10 * P, buy_msg(1, 10, 3, None)); // skipped sequence
    w.returned(CARA, 10 * P - 1, buy_msg(1, 10, 2, None)); // wrong amount
    w.returned(CARA, 10 * P + 1, buy_msg(1, 10, 2, None));
    w.returned(CARA, 0, buy_msg(1, 0, 2, None)); // nothing sent
    w.returned(CARA, 0, buy_msg(1, 1, 2, None));
    w.returned(CARA, 101 * P, buy_msg(1, 101, 2, None)); // over the per-purchase cap
    w.returned(CARA, 10 * P, buy_msg(9, 10, 2, None)); // no such plan
    w.returned(DEV, 10 * P, buy_msg(1, 10, 1, None)); // no record
    w.returned(CARA, 10 * P, "not json".into());
    w.returned(CARA, 10 * P, r#"{"order":{}}"#.into());
    w.returned(CARA, 10 * P, r#"{"buy":{"plan_id":1,"units":10}}"#.into());
    w.returned(CARA, 10 * P, r#"{"buy":{"plan_id":1,"units":-10,"purchase_seq":2}}"#.into());
    let long = format!(r#"{{"buy":{{"plan_id":1,"units":10,"purchase_seq":2,"pad":"{}"}}}}"#, "x".repeat(1000));
    assert!(long.len() > MAX_MSG);
    w.returned(CARA, 10 * P, long);
    // Install into the key slot already in use, a bad key, or a policy outside the plan.
    w.returned(CARA, 10 * P, buy_msg(1, 10, 2, Some((0, &key(4), 30))));
    w.returned(CARA, 10 * P, buy_msg(1, 10, 2, Some((4, &key(4), 30))));
    w.returned(CARA, 10 * P, buy_msg(1, 10, 2, Some((1, &key(4), 0))));
    let bad_pk = r#"{"buy":{"plan_id":1,"units":10,"purchase_seq":2,"install":{"slot":1,"pk":"abc","max_hold_units":10,"max_units_per_day":30}}}"#;
    w.returned(CARA, 10 * P, bad_pk.into());
    // The outstanding cap counts free and held units: 70 free + 10 held + 100 + 21 > 200.
    w.open(CARA, &k, 3, 10);
    assert_eq!(w.ft(CARA, 100 * P, buy_msg(1, 100, 2, None)), 0);
    w.returned(CARA, 21 * P, buy_msg(1, 21, 3, None));
    assert_eq!(w.ft(CARA, 20 * P, buy_msg(1, 20, 3, None)), 0, "exactly at the cap is fine");
    // Only the business's own token may call the receiver at all.
    w.refuse("other-token.near", 0, "E_ASSET", |b| b.ft_on_transfer(id(CARA), U128(P), buy_msg(1, 1, 4, None)));
    let e = w.ent(CARA);
    assert_eq!((e.purchased.0, e.purchase_seq, e.free.0, e.held_units_view()), (220, 3, 190, 10));
}

impl EntitlementView {
    fn held_units_view(&self) -> u64 {
        if self.hold_active {
            (self.hold_units - self.hold_charged) as u64
        } else {
            0
        }
    }
}

// ---------- scenario 12 ----------

#[test]
fn s12_an_expired_hold_can_be_released_by_anyone() {
    let (mut w, k) = happy();
    w.open(CARA, &k, 3, 10);
    let u = w.uses(CARA, &k, 3, 0..3);
    w.settle(CARA, 3, u, false);
    let settle_until = w.ent(CARA).settle_until_ms.0;
    assert_eq!(settle_until, w.now + 30 * MIN);
    w.refuse(STRANGER, 0, "E_NOT_OPERATOR", |b| b.release_hold(id(CARA), 1, 3));
    w.now = settle_until + 1;
    let late = w.uses(CARA, &k, 3, 3..4);
    w.refuse(METER, 0, "E_EXPIRED", |b| b.settle_hold(id(CARA), 1, 3, late.clone(), false));
    w.refuse(STRANGER, 0, "E_HOLD_CLOSED", |b| b.release_hold(id(CARA), 1, 2));
    w.call(STRANGER, 0, |b| b.release_hold(id(CARA), 1, 3));
    let e = w.ent(CARA);
    assert_eq!((e.free.0, e.consumed.0, e.hold_active, e.last_hold_seq, e.last_hold_charged), (77, 23, false, 3, 3));
    w.refuse(METER, 0, "E_HOLD_CLOSED", |b| b.settle_hold(id(CARA), 1, 3, late, false));
    w.refuse(STRANGER, 0, "E_HOLD_CLOSED", |b| b.release_hold(id(CARA), 1, 3));
}

// ---------- scenario 13 ----------

#[test]
fn s13_bounded_payouts() {
    let (mut w, _) = happy();
    w.refund(CARA, 1);
    w.refund(CARA, 1);
    w.refuse(CARA, 1, "E_PENDING_REFS", |b| b.refund_units(1, U64(1)));
    for _ in 0..14 {
        w.withdraw(FOUNDER, 1);
    }
    assert_eq!(w.b.get_pending().len(), 16);
    w.refuse(FOUNDER, 1, "E_BUSY", |b| b.withdraw_profit(U128(1)));
    // One settles; its slot is free again for the next payout.
    let (slot, pid) = w.last_payout();
    assert!(w.callback(slot, pid, true));
    let (again, pid2) = w.withdraw(FOUNDER, 1);
    assert_eq!(again, slot);
    assert!(pid2 > pid);
}

#[test]
fn s13b_books_across_months_and_the_ring_rewrites_in_place() {
    let (mut w, _) = happy();
    let (slot, pid) = w.refund(CARA, 1);
    // The callback lands next month and is booked there, without growing storage.
    w.now = mid_month(202612);
    assert!(w.callback(slot, pid, true));
    assert_eq!(w.b.get_period(202612).unwrap().refunds_paid.0, P);
    assert_eq!(w.b.get_period(202611).unwrap().refunds_paid.0, 0);
    // A purchase every month for 25 months, each booked with no storage change (S1).
    let mut month = 202612;
    for i in 0..25u32 {
        w.now = mid_month(month);
        assert_eq!(w.ft(CARA, P, buy_msg(1, 1, 2 + i, None)), 0);
        assert_eq!(w.b.get_period(month).unwrap().purchases_in.0, P);
        month = next_month(month);
    }
    // 202612 and 202812 share a ring index; the newer month replaced it in place.
    assert_eq!(ring_index(202612), ring_index(202812));
    assert!(w.b.get_period(202612).is_none());
    assert!(w.b.get_period(202611).is_none());
    assert_eq!(w.b.get_period(202812).unwrap().purchases_in.0, P);
    let tags: std::collections::BTreeSet<u32> = (0..PERIOD_RING).map(|i| w.b.periods.get(&i).unwrap().yyyymm).collect();
    assert_eq!(tags.len(), 24);
    assert_eq!(*tags.iter().next().unwrap(), 202701);
}

// ---------- scenario 14 ----------

#[test]
fn s14_record_sizes_are_fixed() {
    // Pre-allocated by `new`, measured first while this test's storage is empty (unit VM:
    // key + value + 40 bytes per record, plus the root).
    testing_env!(ctx(FOUNDER, 0, T0).build());
    let before = env::storage_usage();
    let mut b = Business::new("studio".into(), id(FOUNDER), id(TOKEN), rules());
    b.slots.flush();
    b.periods.flush();
    b.party.flush();
    env::state_write(&b);
    let total = env::storage_usage() - before;
    drop(b);
    let (w, _) = happy();
    let shell = Entitlement::shell(1, &id("a.near"));
    let mut full = *w.b.entitlements.get(&(id(CARA), 1)).unwrap();
    let ent = borsh::to_vec(&shell).unwrap().len();
    assert_eq!(borsh::to_vec(&full).unwrap().len(), ent, "a used entitlement is the same size as a shell");
    full.hold.active = true;
    full.storage_payer = FixedAccount::of(&id(&format!("{}.near", "x".repeat(59))));
    assert_eq!(borsh::to_vec(&full).unwrap().len(), ent);
    let slot = borsh::to_vec(&PayoutSlot::free()).unwrap().len();
    let party = borsh::to_vec(&PartyRecord { claim: 0, pending_refs: 0, payer: FixedAccount::none(), deposit: 0 }).unwrap().len();
    let period = borsh::to_vec(&Period::default()).unwrap().len();
    let plan = borsh::to_vec(&w.b.get_plan(1).unwrap()).unwrap().len();
    println!(
        "UNIT-VM BORSH SIZES (not on-chain measurements): Entitlement {ent} B, PayoutSlot {slot} B, PartyRecord {party} B, Period {period} B, Plan {plan} B; new() pre-allocates {total} B including the root"
    );
    assert_eq!((ent, slot, party, period), (EXPECTED_SIZES.0, EXPECTED_SIZES.1, EXPECTED_SIZES.2, EXPECTED_SIZES.3));
}

/// Entitlement, PayoutSlot, PartyRecord, Period (borsh bytes), pinned so a change is visible.
const EXPECTED_SIZES: (usize, usize, usize, usize) = (762, 111, 99, 84);

// W1 methods charge the growth they measure, so an underfunded call panics after its write.
// The runtime reverts the whole receipt; the unit VM does not model that, so these only check
// the refusal and stop.

#[test]
#[should_panic(expected = "E_STORAGE")]
fn an_underfunded_shell_is_refused() {
    let mut w = W::new();
    w.env(SPONSOR, 1);
    w.b.sponsor_shell(id(CARA), 1);
}

#[test]
#[should_panic(expected = "E_STORAGE")]
fn an_underfunded_plan_is_refused() {
    let mut w = W::new();
    w.env(FOUNDER, 0);
    w.b.create_plan(plan_input(P));
}

// ---------- adversarial administration ----------

#[test]
fn administration_is_owner_only_and_operators_are_bounded() {
    let mut w = W::new();
    w.refuse(STRANGER, NEAR, "E_NOT_OWNER", |b| b.create_plan(plan_input(P)));
    w.refuse(FOUNDER, NEAR, "E_ARGS", |b| b.create_plan(plan_input(0)));
    w.refuse(FOUNDER, NEAR, "E_ARGS", |b| b.create_plan(PlanInput { max_hold_units: 11, ..plan_input(P) }));
    w.refuse(FOUNDER, NEAR, "E_ARGS", |b| b.create_plan(PlanInput { hold_ttl_ms: U64(61 * MIN), ..plan_input(P) }));
    w.refuse(FOUNDER, NEAR, "E_ARGS", |b| b.create_plan(PlanInput { max_units_outstanding: 99, ..plan_input(P) }));
    w.refuse(FOUNDER, 0, "E_STORAGE", |b| b.appoint_operator(id(STRANGER), SUPPORT));
    w.refuse(STRANGER, NEAR, "E_NOT_OWNER", |b| b.appoint_operator(id(STRANGER), METERING));
    w.refuse(FOUNDER, NEAR, "E_ARGS", |b| b.appoint_operator(id(STRANGER), 4));
    w.refuse(FOUNDER, NEAR, "E_ARGS", |b| b.appoint_operator(id(STRANGER), 0));
    // A SUPPORT-only operator cannot meter.
    w.measured(FOUNDER, NEAR, |b| b.appoint_operator(id(STRANGER), SUPPORT));
    let k = key(1);
    w.shell(CARA, CARA);
    w.buy(CARA, 10, 1, Some((0, &k)));
    let (a, s) = w.std_auth(CARA, &k, 1, 5);
    w.refuse(STRANGER, 0, "E_NOT_OPERATOR", |b| b.open_hold(id(CARA), 1, a.clone(), s.clone()));
    // Revoking METER removes its authority; re-appointing an existing operator adds no storage.
    w.refuse(FOUNDER, 0, "E_DEPOSIT", |b| b.revoke_operator(id(METER)));
    w.call(FOUNDER, 1, |b| b.revoke_operator(id(METER)));
    w.refuse(METER, 0, "E_NOT_OPERATOR", |b| b.open_hold(id(CARA), 1, a.clone(), s.clone()));
    let (_, d) = w.measured(FOUNDER, NEAR, |b| b.appoint_operator(id(STRANGER), METERING | SUPPORT));
    assert_eq!(d, 0);
    assert_eq!(w.call(STRANGER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "opened");
    // At most 8 operators.
    for i in 0..7 {
        w.measured(FOUNDER, NEAR, |b| b.appoint_operator(id(&format!("op{i}.near")), METERING));
    }
    assert_eq!(w.b.operators.len(), 8);
    w.refuse(FOUNDER, NEAR, "E_LIMIT", |b| b.appoint_operator(id("op9.near"), METERING));
    // Plans are immutable: the price a customer bought at is the price refunded.
    assert_eq!(w.b.get_plan(1).unwrap().unit_price.0, P);
    assert_eq!(w.b.get_plan(1).unwrap().created_generation, 1);
}

#[test]
fn withdrawals_respect_the_reserve_and_never_touch_customer_money() {
    let (mut w, k) = happy();
    w.open(CARA, &k, 3, 10);
    let (rs, rp) = w.refund(CARA, 20);
    // available 20P, reserve 5P: 15P withdrawable, whatever customers hold or have in flight.
    w.refuse(FOUNDER, 1, "E_RESERVED", |b| b.withdraw_profit(U128(15 * P + 1)));
    w.refuse(FOUNDER, 1, "E_RESERVED", |b| b.withdraw_profit(U128(0)));
    w.refuse(STRANGER, 1, "E_NOT_OWNER", |b| b.withdraw_profit(U128(P)));
    let (ws, wp) = w.withdraw(FOUNDER, 15 * P);
    w.refuse(FOUNDER, 1, "E_RESERVED", |b| b.withdraw_profit(U128(1)));
    // The customer's refund fails: it becomes their claim; withdrawable stays 0.
    assert!(!w.callback(rs, rp, false));
    assert_eq!(w.t().withdrawable.0, 0);
    w.refuse(FOUNDER, 1, "E_RESERVED", |b| b.withdraw_profit(U128(1)));
    // The withdrawal fails: back to the founder's claim, not to available.
    assert!(!w.callback(ws, wp, false));
    assert_eq!(w.t().available.0, 5 * P);
    assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().claim.0, 15 * P);
    // Using the open hold earns more; only that is newly withdrawable.
    let u = w.uses(CARA, &k, 3, 0..2);
    w.settle(CARA, 3, u, true);
    assert_eq!(w.t().withdrawable.0, 2 * P);
    // Everything owed is still covered.
    let t = w.t();
    assert_eq!(t.claims_total.0, 35 * P);
    assert_eq!(t.ent_free_value.0, (80 - 20 - 2) as u128 * P);
}

// ---------- near-overflow limits ----------

#[test]
fn near_overflow_limits_refuse_cleanly() {
    let mut w = W::new();
    let huge = u128::MAX / 3;
    let (plan2, _) = w.measured(FOUNDER, NEAR, |b| b.create_plan(PlanInput { max_units_per_purchase: 10, max_units_outstanding: 10, ..plan_input(huge) }));
    w.measured(CARA, NEAR, |b| b.sponsor_shell(id(CARA), plan2));
    w.shell(DEV, DEV);
    // 4 × (MAX/3) overflows: returned.
    w.returned(CARA, u128::MAX, buy_msg(plan2, 4, 1, None));
    // 3 × (MAX/3) = MAX exactly: accepted; the treasury is now full.
    assert_eq!(huge * 3, u128::MAX);
    assert_eq!(w.ft(CARA, u128::MAX, buy_msg(plan2, 3, 1, None)), 0);
    assert_eq!(w.t().held.0, u128::MAX);
    // Any further purchase would overflow the treasury: returned whole.
    w.returned(DEV, P, buy_msg(1, 1, 1, None));
    // Refunding all of it moves MAX through pending and out.
    w.call(CARA, 1, |b| drop(b.refund_units(plan2, U64(3))));
    let (slot, pid) = w.last_payout();
    assert_eq!(w.t().pending_total.0, u128::MAX);
    assert!(w.callback(slot, pid, true));
    assert_eq!(w.t().held.0, 0);
    // The month's gross purchases now exceed u128: the books saturate, the purchase goes through.
    assert_eq!(w.ft(DEV, P, buy_msg(1, 1, 1, None)), 0);
    assert_eq!(w.b.get_period(202611).unwrap().purchases_in.0, u128::MAX);
    assert_eq!(w.t().held.0, P);

    // Sequences and epochs at their limits (set directly; this is a test of the guards).
    let k = key(1);
    let kd = (id(DEV), 1);
    let mut e = *w.b.entitlements.get(&kd).unwrap();
    e.purchase_seq = u32::MAX;
    e.hold_seq = u32::MAX;
    e.keys[0] = KeySlot { state: KEY_ACTIVE, epoch: u32::MAX, pk: k.verifying_key().to_bytes(), max_hold_units: 10, max_units_per_day: 30, day: 0, held_today: 0 };
    e.keys[1] = KeySlot { state: KEY_REVOKED, epoch: u32::MAX, ..KeySlot::empty() };
    w.b.entitlements.insert(kd, e);
    w.returned(DEV, P, buy_msg(1, 1, 0, None));
    w.refuse(DEV, 1, "E_OVERFLOW", |b| b.skip_hold_seq(1));
    let (a, s) = w.auth(DEV, &k, e.reg_id, 0, 1, w.now + 20 * MIN, 0, u32::MAX);
    w.refuse(METER, 0, "E_HOLD_SEQ_USED", |b| b.open_hold(id(DEV), 1, a, s));
    w.refuse(DEV, 1, "E_OVERFLOW", |b| b.revoke_key(1, 0));
    w.refuse(DEV, 1, "E_OVERFLOW", |b| b.install_key(1, 1, pk(&k), 10, 30));
}

// ---------- bounded random sequences ----------

/// xorshift64*, fixed seeds: reproducible.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

impl W {
    /// Tries a call that may be refused. A success gets the S0 check and every invariant; a
    /// refusal must have changed nothing before it panicked.
    fn attempt<R>(&mut self, who: &str, yocto: u128, callback: Option<bool>, f: impl FnOnce(&mut Business) -> R) -> bool {
        let before = self.snap();
        match callback {
            Some(ok) => self.env_callback(ok),
            None => self.env(who, yocto),
        }
        self.flush();
        let start = env::storage_usage() as i64;
        let b = &mut self.b;
        let ok = catch_unwind(AssertUnwindSafe(|| drop(f(b)))).is_ok();
        if ok {
            self.flush();
            let d = env::storage_usage() as i64 - start;
            assert!(d <= 0, "S0: storage grew by {d}");
            if callback.is_some() {
                assert_eq!(d, 0, "S1");
            }
            self.invariants();
        } else {
            assert_eq!(self.snap(), before, "a refused call changed state before panicking");
        }
        ok
    }
}

#[test]
fn random_sequences_keep_every_invariant() {
    let customers = [CARA, DEV];
    let keys = [key(1), key(2)];
    let mut totals = [0usize; 12];
    for seed in [0x9E37_79B9_7F4A_7C15u64, 0xD1B5_4A32_D192_ED03, 0x2545_F491_4F6C_DD1D, 0x0123_4567_89AB_CDEF] {
        let mut w = W::new();
        let mut r = Rng(seed);
        for (c, k) in customers.iter().zip(&keys) {
            w.shell(c, c);
            w.buy(c, 20, 1, Some((0, k)));
        }
        for _ in 0..400 {
            let ci = r.below(2) as usize;
            let (c, k) = (customers[ci], &keys[ci]);
            let e = *w.b.entitlements.get(&(id(c), 1)).unwrap();
            let op = r.below(12) as usize;
            let done = match op {
                0 => {
                    let units = 1 + r.below(15) as u32;
                    let seq = e.purchase_seq + if r.below(5) == 0 { 0 } else { 1 };
                    let amount = units as u128 * P + if r.below(6) == 0 { 1 } else { 0 };
                    let before = w.snap();
                    let back = w.ft(c, amount, buy_msg(1, units, seq, None));
                    assert!(back == 0 || (back == amount && w.snap() == before));
                    back == 0
                }
                1 => {
                    let units = 1 + r.below(10) as u8;
                    let seq = e.hold_seq + 1;
                    let (a, s) = w.auth(c, k, e.reg_id, seq, units, w.now + (1 + r.below(29)) * MIN, 0, 1);
                    w.attempt(METER, 0, None, |b| b.open_hold(id(c), 1, a, s))
                }
                2 | 3 => {
                    let n = 1 + r.below(4) as usize;
                    let seq = if e.hold.active { e.hold.seq } else { e.last_hold.seq };
                    let uses: Vec<UseInput> = (0..n)
                        .map(|_| {
                            let slot = r.below(10) as u8;
                            let alt = if r.below(8) == 0 { 1 } else { 0 };
                            w.use_with(c, k, e.reg_id, 0, 1, seq, slot, fp(seq, slot, alt))
                        })
                        .collect();
                    let close = r.below(3) == 0;
                    w.attempt(METER, 0, None, |b| b.settle_hold(id(c), 1, seq, uses, close))
                }
                4 => w.attempt(if r.below(2) == 0 { METER } else { STRANGER }, 0, None, |b| b.release_hold(id(c), 1, e.hold.seq)),
                5 => {
                    let units = 1 + r.below(12);
                    w.attempt(c, 1, None, |b| b.refund_units(1, U64(units)))
                }
                6 | 7 => {
                    let p = w.b.get_pending();
                    if p.is_empty() {
                        false
                    } else {
                        let pick = &p[r.below(p.len() as u64) as usize];
                        let (slot, pid) = (pick.slot, pick.payout_id.0 - r.below(4).min(1) * (r.below(2)));
                        let ok = r.below(2) != 0;
                        w.attempt(BIZ, 0, Some(ok), |b| b.on_payout(slot, U64(pid)))
                    }
                }
                8 => w.attempt(c, 1, None, |b| b.claim_customer(1)),
                9 => {
                    let amount = 1 + r.below(8) as u128 * P;
                    w.attempt(FOUNDER, 1, None, |b| b.withdraw_profit(U128(amount)))
                }
                10 => w.attempt(FOUNDER, 1, None, |b| b.claim_party()),
                _ => {
                    w.now += [MIN, 7 * MIN, 31 * MIN, DAY][r.below(4) as usize];
                    true
                }
            };
            if done {
                totals[op] += 1;
            }
        }
    }
    // The sequences did real work in every operation, not just refusals.
    for (op, n) in totals.iter().enumerate() {
        assert!(*n >= 5, "operation {op} succeeded only {n} times: {totals:?}");
    }
    println!("random sequence successes by operation: {totals:?}");
}

#[test]
fn period_and_ring_helpers() {
    assert_eq!(period_of(T0), 202611);
    assert_eq!(period_of(1_709_164_800_000), 202402);
    assert_eq!(ring_index(202611), ring_index(202811));
    assert_ne!(ring_index(202611), ring_index(202612));
    let mut m = 202601;
    let mut seen = std::collections::BTreeSet::new();
    for _ in 0..24 {
        assert_eq!(period_of(mid_month(m)), m);
        seen.insert(ring_index(m));
        m = next_month(m);
    }
    assert_eq!(seen.len(), 24);
}
