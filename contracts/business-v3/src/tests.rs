//! Keyless unit tests for the v3 core (job 003e, addendum §8 scenarios 1-14 plus adversarial,
//! bounded-sequence and near-overflow cases).
//!
//! Every successful call made through `W::call` is followed by the storage check (S0: delta ≤ 0;
//! S1: delta = 0 for the FT receiver and the payout callback) and the invariants I1, U1, U2, P1
//! and P4. Every refusal made through `W::refuse` checks the error code and that nothing changed
//! before the panic. `catch_unwind` here only observes that the method validated before it
//! mutated; it is not a model of on-chain rollback (a real panic reverts the whole receipt).
//! Signatures are synthetic: ed25519 keys from fixed test seeds. 003g: every change of owner goes
//! through the contract's own sale methods (propose, fund, accept, and close_sale in Gated mode);
//! the injected `test_set_owner` is gone. Direct state edits remain only where a fault is
//! injected on purpose, and each says so.

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
const MORE: [&str; 4] = ["ines.near", "joon.near", "kofi.near", "lena.near"];
const CLOSER: &str = "closer.near";

/// A valid 64-character account: the longest an account id can be.
fn long(c: char) -> String {
    format!("{}.near", c.to_string().repeat(59))
}

/// Every account the invariants and snapshots look at, including 64-character ones.
fn accounts() -> Vec<String> {
    let mut v: Vec<String> = [FOUNDER, METER, METER2, CARA, DEV, SPONSOR, BUYER, STRANGER, CLOSER]
        .iter()
        .chain(MORE.iter())
        .map(|s| s.to_string())
        .collect();
    v.extend(['b', 'o', 's', 'm', 'c'].map(long));
    v
}
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
    /// A Direct-mode business: the second matching acceptance closes a sale.
    fn new() -> W {
        W::with_closer(None)
    }

    /// A Gated-mode business: only `CLOSER` finalizes a sale both parties accepted.
    fn gated() -> W {
        W::with_closer(Some(CLOSER))
    }

    fn with_closer(closer: Option<&str>) -> W {
        // Start from empty storage, even if an earlier world ran on this thread.
        near_sdk::mock::with_mocked_blockchain(|b| drop(b.take_storage()));
        testing_env!(ctx(FOUNDER, 0, T0).build());
        let b = Business::new("studio".into(), id(FOUNDER), id(TOKEN), rules(), closer.map(id));
        let mut w = W { b, now: T0, corrupt: false };
        w.env(FOUNDER, 0);
        let (_, pre) = w.measure(|_| ());
        assert_eq!(pre, 0);
        let (plan, grew) = w.measured(FOUNDER, NEAR, |b| b.create_plan(plan_input(P)));
        assert_eq!(plan, 1);
        assert!(grew > 0, "W1: a plan is new storage");
        let (_, grew) = w.measured(FOUNDER, 1, |b| b.appoint_operator(id(METER), METERING));
        assert_eq!(grew, 0, "W2 (003g): operator slots are pre-allocated");
        assert_eq!(w.b.control_seq, 2, "a plan and an appointment: two control changes");
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
        self.b.deal.flush();
        self.b.outcomes.flush();
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
        let all = accounts();
        let ents: Vec<_> = all
            .iter()
            .flat_map(|a| (1..=b.plan_count).map(move |p| (a.clone(), p)))
            .map(|(a, p)| b.entitlements.get(&(id(&a), p)).copied())
            .collect();
        let parties: Vec<_> = all.iter().map(|a| b.party.get(&id(a)).copied()).collect();
        let slots: Vec<_> = (0..PAYOUT_SLOTS).map(|i| b.slots.get(&i).copied()).collect();
        let periods: Vec<_> = (0..PERIOD_RING).map(|i| b.periods.get(&i).copied()).collect();
        let outcomes: Vec<_> = (0..OUTCOME_RING).map(|i| b.outcomes.get(&i).copied()).collect();
        format!(
            "{:?}",
            (
                (b.get_treasury(), ents, parties, slots, periods, &b.operators, &b.owner, b.generation, b.reg_seq, b.payout_seq, b.plan_count),
                (b.control_seq, b.deal.get(&0).copied(), outcomes, b.service_manifest, b.manifest_seq, b.deal_seq, b.escrow_total),
            )
        )
    }

    /// I1′, P4 and the sale invariants always; U1, U2, P1 and the per-record sums unless state
    /// was corrupted on purpose.
    fn invariants(&self) {
        let b = &self.b;
        assert_eq!(
            b.held,
            b.ent_free_value + b.ent_held_value + b.available + b.pending_total + b.claims_total + b.escrow_total,
            "I1′"
        );
        // D1: escrow belongs to the live deal and is 0 or its price, funded by its buyer.
        let d = *b.deal.get(&0).expect("pre-allocated deal slot");
        assert_eq!(b.escrow_total, if d.live { d.escrow } else { 0 }, "D1 escrow total");
        if d.live {
            assert!(d.escrow == 0 || d.escrow == d.price, "D1 escrow is 0 or the price");
            if d.escrow > 0 {
                assert_eq!(d.escrow_owner, d.buyer, "D1 the buyer funded it");
            }
            // D4 / generation: a live deal is always against the current generation and seller.
            assert_eq!(d.expected_generation, b.generation, "D4 generation");
            assert_eq!(d.seller, b.owner, "D4 seller is the owner");
            assert_eq!((d.plan_count, d.manifest, d.manifest_seq), (b.plan_count, b.service_manifest, b.manifest_seq), "D4");
            // D5: from the seller's acceptance, and while closing, the floor holds.
            if d.seller_accepted || d.state == DEAL_CLOSING {
                assert!(b.available >= d.available_floor, "D5 floor");
            }
            if d.state == DEAL_CLOSING {
                assert_eq!(d.closing_control_seq, b.control_seq, "nothing changes control while closing");
            }
        } else {
            assert_eq!(d, DealSlot::empty(), "an ended deal leaves the slot cleared");
        }
        if !self.corrupt && d.live {
            // D2: the live deal's seller and buyer have records (they are pinned).
            assert!(b.party.contains_key(&d.seller.account()) && b.party.contains_key(&d.buyer.account()), "D2");
        }
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
        for a in &accounts() {
            let a = a.as_str();
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
                claims += r.owed();
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

    // ---------- 003g sale helpers: the contract's own methods, never an injected owner ----------

    /// Terms to `buyer` at `price`, open a day, floor 0, the right close window for the mode.
    fn terms(&self, buyer: &str, price: u128, grants: &[(&str, u8)]) -> DealTermsInput {
        DealTermsInput {
            buyer: id(buyer),
            price: U128(price),
            expires_at_ms: U64(self.now + DAY),
            close_window_ms: U64(if self.b.close_mode == MODE_GATED { 30 * MIN } else { 0 }),
            available_floor: U128(0),
            grants: grants.iter().map(|(a, c)| (id(a), *c)).collect(),
            terms_hash: "11".repeat(32),
        }
    }

    /// Proposes (W1 only if the buyer has no record yet); returns the deal number.
    fn propose(&mut self, seller: &str, t: DealTermsInput) -> u64 {
        let had = self.b.party.contains_key(&t.buyer);
        let (seq, d) = self.measured(seller, NEAR, |b| b.propose_sale(t));
        if had {
            assert_eq!(d, 0, "proposing to a buyer with a record allocates nothing");
        } else {
            assert!(d > 0, "a new buyer record is measured growth");
        }
        self.invariants();
        seq.0
    }

    fn deal(&self) -> DealView {
        self.b.get_control().live_deal.expect("a live deal")
    }

    /// Exactly a storage-neutral call: every deal transition rewrites pre-allocated state.
    fn neutral<R>(&mut self, who: &str, yocto: u128, f: impl FnOnce(&mut Business) -> R) -> R {
        let (r, d) = self.measured(who, yocto, f);
        assert_eq!(d, 0, "a deal transition must not change storage size");
        self.invariants();
        r
    }

    fn fund(&mut self, buyer: &str) -> u128 {
        let d = self.deal();
        self.ft(buyer, d.price.0, fund_msg(d.seq.0, d.version, d.price.0))
    }

    fn accept(&mut self, who: &str) -> String {
        let d = self.deal();
        self.neutral(who, 1, |b| b.accept_sale(d.seq, d.version, d.digest.clone()))
    }

    /// The close order the closer would issue now for the live deal.
    fn order(&self) -> CloseOrder {
        let c = self.b.get_control();
        let d = c.live_deal.expect("a live deal");
        CloseOrder {
            deal_seq: d.seq,
            version: d.version,
            digest: d.digest,
            expected_generation: d.expected_generation,
            closing_control_seq: d.closing_control_seq,
            manifest: c.service_manifest,
            manifest_seq: c.manifest_seq,
            issued_at_ms: U64(self.now),
        }
    }

    /// A complete sale through the contract: propose, fund, both accept (and the closer closes
    /// in Gated mode). Checks the result exactly.
    fn sell(&mut self, seller: &str, buyer: &str, price: u128, grants: &[(&str, u8)]) {
        let generation = self.b.generation;
        let t = self.terms(buyer, price, grants);
        self.propose(seller, t);
        assert_eq!(self.fund(buyer), 0);
        assert_eq!(self.accept(buyer), "accepted");
        if self.b.close_mode == MODE_GATED {
            assert_eq!(self.accept(seller), "closing");
            let o = self.order();
            self.neutral(CLOSER, 0, |b| b.close_sale(o));
        } else {
            assert_eq!(self.accept(seller), "closed");
        }
        let c = self.b.get_control();
        assert_eq!((c.owner, c.generation, c.live_deal), (id(buyer), generation + 1, None));
    }
}

fn fund_msg(seq: u64, version: u32, price: u128) -> String {
    serde_json::json!({ "fund_deal": { "deal_seq": seq.to_string(), "version": version, "price": price.to_string() } })
        .to_string()
}

/// A HoldAuth for any plan and key slot, signed by `k`.
#[allow(clippy::too_many_arguments)]
fn auth_on(plan: u32, c: &str, k: &SigningKey, reg: u64, seq: u32, units: u8, serve_until: u64, slot: u8, epoch: u32) -> (HoldAuth, String) {
    let m = hold_message(&id(BIZ), plan, &id(c), reg, slot, epoch, seq, units, serve_until);
    let a = HoldAuth { hold_seq: seq, units, serve_until_ms: U64(serve_until), key_slot: slot, key_epoch: epoch };
    (a, hex::encode(k.sign(&m).to_bytes()))
}

/// A UseAuth for any plan and key slot, signed by `k`.
#[allow(clippy::too_many_arguments)]
fn use_on(plan: u32, c: &str, k: &SigningKey, reg: u64, key_slot: u8, epoch: u32, seq: u32, slot: u8, f: [u8; 32]) -> UseInput {
    let m = use_message(&id(BIZ), plan, &id(c), reg, key_slot, epoch, seq, slot, &f);
    UseInput { slot, fingerprint: hex::encode(f), sig: hex::encode(k.sign(&m).to_bytes()) }
}

/// A month the books recorded (panics otherwise).
fn rec(w: &W, yyyymm: u32) -> PeriodView {
    let l = w.b.get_period(yyyymm);
    assert_eq!(l.status, "recorded", "{yyyymm}: {l:?}");
    l.period.unwrap()
}

/// An exact counter's amount (panics if it saturated).
fn n(c: &Counter) -> u128 {
    assert!(c.exact, "counter saturated: {c:?}");
    c.amount.0
}

fn all(r: &[String], s: &str, n: usize) {
    assert_eq!(r.len(), n);
    assert!(r.iter().all(|x| x == s), "expected {n} × {s}, got {r:?}");
}

/// Scenario 1, the 100/20/80 path: a self-paid shell, 100 units bought with a key installed,
/// two holds of 10 each fully used and closed.
fn happy() -> (W, SigningKey) {
    happy_in(W::new())
}

/// Scenario 1 in a given business (Direct or Gated).
fn happy_in(mut w: W) -> (W, SigningKey) {
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
    assert_eq!((e.free.0, e.consumed.0, e.purchased.0, e.units_retired_to_refund.0), (80, 20, 100, 0));
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
    let p = rec(&w, 202611);
    assert_eq!((n(&p.purchases_in), n(&p.earned), n(&p.customer_returns)), (100 * P, 20 * P, 0));
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
    w.refuse(CARA, 1, "E_KEY_INVALID", |b| b.install_key(1, 1, "zz".into(), 10, 15));
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
    assert_eq!((e.units_retired_to_refund.0, e.free.0, e.pending_refs), (70, 0, 0));
    assert_eq!(w.t().held.0, 30 * P);
    assert_eq!(w.t().pending_total.0, 0);
    let p = rec(&w, 202611);
    assert_eq!((n(&p.customer_returns), n(&p.paid_on_retry), n(&p.owner_withdrawals)), (70 * P, 0, 0));
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
    // 70 units are retired into the refund, but the money is still the customer's unpaid claim.
    assert_eq!((e.claim.0, e.units_retired_to_refund.0, e.free.0, e.pending_refs), (70 * P, 70, 0, 0));
    assert_eq!(n(&rec(&w, 202611).customer_returns), 0, "nothing has been returned yet");
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
    // The later-paid claim is still a customer return, never an owner withdrawal.
    let p = rec(&w, 202611);
    assert_eq!((n(&p.customer_returns), n(&p.paid_on_retry), n(&p.owner_withdrawals)), (70 * P, 70 * P, 0));
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
fn s06_ownership_change_mid_hold_through_a_sale() {
    let (mut w, k) = happy();
    w.open(CARA, &k, 3, 10);
    w.sell(FOUNDER, BUYER, 400 * P, &[(METER2, METERING)]);
    assert_eq!(w.b.get_control().operators, vec![(id(METER2), METERING, 2)]);
    assert!(w.b.get_party(id(BUYER)).is_some(), "the buyer's record was created at the proposal");
    assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().sale_proceeds_claim.0, 400 * P);
    let u = w.uses(CARA, &k, 3, 0..4);
    w.refuse(METER, 0, "E_NOT_OPERATOR", |b| b.settle_hold(id(CARA), 1, 3, u.clone(), false));
    // Fault injected on purpose: a grant left over from generation 1 still doesn't count.
    let spare = w.b.operators[7];
    w.b.operators[7] = OperatorSlot { account: FixedAccount::of(&id(METER)), caps: METERING, generation: 1 };
    w.refuse(METER, 0, "E_NOT_OPERATOR", |b| b.settle_hold(id(CARA), 1, 3, u.clone(), false));
    w.b.operators[7] = spare;
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
    assert_eq!(n(&rec(&w, 202611).owner_withdrawals), 19 * P);
}

// ---------- scenario 7 ----------

#[test]
fn s07_the_party_slot_schedule() {
    let (mut w, _) = happy();
    let (slot, pid) = w.withdraw(FOUNDER, 10 * P);
    assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().pending_refs, 1);
    let available = w.t().available.0;
    assert_eq!(available, 10 * P);
    w.sell(FOUNDER, BUYER, 400 * P, &[]);
    w.refuse(FOUNDER, 1, "E_PENDING_REFS", |b| b.release_party_slot());
    assert!(!w.callback(slot, pid, false));
    let r = w.b.get_party(id(FOUNDER)).unwrap();
    assert_eq!((r.profit_claim.0, r.sale_proceeds_claim.0, r.escrow_return_claim.0), (10 * P, 400 * P, 0));
    assert_eq!(w.t().available.0, available, "the failed withdrawal is the founder's claim, not the buyer's profit");
    assert_eq!(w.t().withdrawable.0, 5 * P);
    w.refuse(FOUNDER, 1, "E_CLAIM", |b| b.release_party_slot());
    w.refuse(STRANGER, 1, "E_NO_RECORD", |b| b.claim_party(CLAIM_PROFIT));
    w.refuse(FOUNDER, 1, "E_FUNDS", |b| b.claim_party(CLAIM_ESCROW_RETURN));
    w.refuse(FOUNDER, 1, "E_ARGS", |b| b.claim_party(3));
    w.call(FOUNDER, 1, |b| drop(b.claim_party(CLAIM_PROFIT)));
    let (slot, pid) = w.last_payout();
    assert_eq!(w.t().available.0, available);
    assert!(w.callback(slot, pid, true));
    assert_eq!(w.t().available.0, available);
    // The proceeds are still owed, so the record stays until they are collected too.
    w.refuse(FOUNDER, 1, "E_CLAIM", |b| b.release_party_slot());
    w.call(FOUNDER, 1, |b| drop(b.claim_party(CLAIM_SALE_PROCEEDS)));
    let (slot, pid) = w.last_payout();
    assert!(w.callback(slot, pid, true));
    assert_eq!(w.t().held.0, 90 * P, "100P customer money less the 10P withdrawal; escrow in and out");
    let m = rec(&w, 202611);
    assert_eq!(
        (n(&m.owner_withdrawals), n(&m.sale_proceeds_paid), n(&m.escrow_in), n(&m.escrow_returned)),
        (10 * P, 400 * P, 400 * P, 0)
    );
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
    let party_slots = |w: &W| w.b.get_pending().iter().filter(|p| p.kind == "profit" || p.kind == "party_claim").count();
    // A customer: at most 2 payouts in flight.
    w.refund(CARA, 1);
    w.refund(CARA, 1);
    w.refuse(CARA, 1, "E_PENDING_REFS", |b| b.refund_units(1, U64(1)));
    // A party: at most 2 in flight, however small.
    let (fs, fp1) = w.withdraw(FOUNDER, 1);
    w.withdraw(FOUNDER, 1);
    w.refuse(FOUNDER, 1, "E_PARTY_CAP: 2 of your", |b| b.withdraw_profit(U128(1)));
    // A failed withdrawal becomes a claim; claiming it counts toward the same cap.
    assert!(!w.callback(fs, fp1, false));
    w.call(FOUNDER, 1, |b| drop(b.claim_party(CLAIM_PROFIT)));
    w.refuse(FOUNDER, 1, "E_PARTY_CAP: 2 of your", |b| b.withdraw_profit(U128(1)));
    // Actual sales: each owner gets its own 2, and 4 across all parties.
    w.sell(FOUNDER, BUYER, 50 * P, &[]);
    w.withdraw(BUYER, 1);
    w.withdraw(BUYER, 1);
    assert_eq!(party_slots(&w), 4);
    w.sell(BUYER, STRANGER, 60 * P, &[]);
    w.refuse(STRANGER, 1, "E_PARTY_CAP: 4 owner payouts", |b| b.withdraw_profit(U128(1)));
    // Collecting sale proceeds is a party payout too: the cap holds for it.
    w.refuse(FOUNDER, 1, "E_PARTY_CAP", |b| b.claim_party(CLAIM_SALE_PROCEEDS));
    // Customers still have the other 12 slots: CARA's 2 plus five more customers' 2 each.
    let k = key(1);
    for c in [DEV, MORE[0], MORE[1], MORE[2], MORE[3]] {
        w.shell(c, c);
        w.buy(c, 10, 1, Some((0, &k)));
        w.refund(c, 1);
        w.refund(c, 1);
    }
    assert_eq!(w.b.get_pending().len(), 16);
    assert_eq!(party_slots(&w), 4);
    // Every slot is now taken by legitimate payouts: only then does anyone see E_BUSY.
    w.shell(SPONSOR, SPONSOR);
    w.buy(SPONSOR, 10, 1, None);
    w.refuse(SPONSOR, 1, "E_BUSY", |b| b.refund_units(1, U64(1)));
    // A customer payout settles; its slot goes to the next customer, with a higher id.
    let p = w.b.get_pending();
    let c = p.iter().find(|p| p.kind == "refund").unwrap();
    let (slot, pid) = (c.slot, c.payout_id.0);
    assert!(w.callback(slot, pid, true));
    let (again, pid2) = w.refund(SPONSOR, 1);
    assert_eq!(again, slot);
    assert!(pid2 > pid);
    // A party payout settles: the freed slot is the only one, and parties are still capped at 4.
    let q = w.b.get_pending();
    let o = q.iter().find(|p| p.kind == "profit").unwrap();
    let (oslot, opid) = (o.slot, o.payout_id.0);
    assert!(w.callback(oslot, opid, true));
    assert_eq!(party_slots(&w), 3);
}

#[test]
fn s13b_books_across_months_and_the_ring_rewrites_in_place() {
    let (mut w, _) = happy();
    let (slot, pid) = w.refund(CARA, 1);
    // The callback lands next month and is booked there, without growing storage.
    w.now = mid_month(202612);
    assert!(w.callback(slot, pid, true));
    assert_eq!(n(&rec(&w, 202612).customer_returns), P);
    assert_eq!(n(&rec(&w, 202611).customer_returns), 0);
    // A purchase every month for 25 months, each booked with no storage change (S1).
    let mut month = 202612;
    for i in 0..25u32 {
        w.now = mid_month(month);
        assert_eq!(w.ft(CARA, P, buy_msg(1, 1, 2 + i, None)), 0);
        assert_eq!(n(&rec(&w, month).purchases_in), P);
        month = next_month(month);
    }
    // 202612 and 202812 share a ring index; the newer month replaced it in place.
    assert_eq!(ring_index(202612), ring_index(202812));
    assert_eq!(w.b.get_period(202612).status, "not_retained");
    assert_eq!(w.b.get_period(202611).status, "not_retained");
    assert_eq!(n(&rec(&w, 202812).purchases_in), P);
    // A month inside the window with nothing booked, and invalid months: defined answers.
    assert_eq!(w.b.get_period(202901).status, "no_activity");
    for bad in [0, 202600, 202613, 196912, 1_000_001] {
        let l = w.b.get_period(bad);
        assert_eq!((l.status.as_str(), l.period.is_none()), ("invalid", true), "{bad}");
    }
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
    let mut b = Business::new("studio".into(), id(FOUNDER), id(TOKEN), rules(), None);
    b.slots.flush();
    b.periods.flush();
    b.party.flush();
    b.deal.flush();
    b.outcomes.flush();
    env::state_write(&b);
    let total = env::storage_usage() - before;
    let root = borsh::to_vec(&b).unwrap().len();
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
    let party = borsh::to_vec(&PartyRecord::new(&id("a.near"), 0)).unwrap().len();
    let period = borsh::to_vec(&Period::default()).unwrap().len();
    let plan = borsh::to_vec(&w.b.get_plan(1).unwrap()).unwrap().len();
    let deal = borsh::to_vec(&DealSlot::empty()).unwrap().len();
    let outcome = borsh::to_vec(&DealOutcome::empty()).unwrap().len();
    println!(
        "UNIT-VM BORSH SIZES (not on-chain measurements): Entitlement {ent} B, PayoutSlot {slot} B, PartyRecord {party} B, Period {period} B, Plan {plan} B, DealSlot {deal} B, DealOutcome {outcome} B, root {root} B; new() pre-allocates {total} B including the root"
    );
    assert_eq!((ent, slot, party, period, deal, outcome), EXPECTED_SIZES);
}

/// Entitlement, PayoutSlot, PartyRecord, Period, DealSlot, DealOutcome (borsh bytes), pinned so a
/// change is visible. 003e1: PayoutSlot +1 (`detached`), Period +1 (`saturated`). 003g: PartyRecord
/// +32 (three claim categories), Period +48 (escrow in/returned, proceeds paid); deal records new.
const EXPECTED_SIZES: (usize, usize, usize, usize, usize, usize) = (762, 112, 131, 133, 675, 227);

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
    w.refuse(FOUNDER, 0, "E_DEPOSIT", |b| b.appoint_operator(id(STRANGER), SUPPORT));
    // 003g: operator slots are pre-allocated, so even a new operator is a same-size rewrite.
    // A re-grant changes no storage but still needs an intentional deposit.
    w.refuse(FOUNDER, 0, "E_DEPOSIT", |b| b.appoint_operator(id(METER), METERING | SUPPORT));
    let (_, d) = w.measured(FOUNDER, 1, |b| b.appoint_operator(id(METER), METERING | SUPPORT));
    assert_eq!(d, 0);
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
    // At most 8 operators, each a same-size rewrite, including a 64-character account.
    for i in 0..6 {
        let (_, d) = w.measured(FOUNDER, NEAR, |b| b.appoint_operator(id(&format!("op{i}.near")), METERING));
        assert_eq!(d, 0);
    }
    let (_, d) = w.measured(FOUNDER, 1, |b| b.appoint_operator(id(&long('o')), METERING));
    assert_eq!(d, 0);
    assert_eq!(w.b.get_control().operators.len(), 8);
    w.refuse(FOUNDER, NEAR, "E_LIMIT", |b| b.appoint_operator(id("op9.near"), METERING));
    // Revoking frees a slot for another, still with no storage change.
    let (_, d) = w.measured(FOUNDER, 1, |b| b.revoke_operator(id(&long('o'))));
    assert_eq!(d, 0);
    let (_, d) = w.measured(FOUNDER, 1, |b| b.appoint_operator(id("op9.near"), SUPPORT));
    assert_eq!(d, 0);
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
    assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().profit_claim.0, 15 * P);
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
    // Saturated: reported as a lower bound, never as an exact total.
    let p = rec(&w, 202611);
    assert_eq!((p.purchases_in.amount.0, p.purchases_in.exact), (u128::MAX, false));
    assert!(p.customer_returns.exact && p.earned.exact);
    assert_eq!(n(&p.customer_returns), u128::MAX);
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
                10 => w.attempt(FOUNDER, 1, None, |b| b.claim_party(CLAIM_PROFIT)),
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

// ---------- 003e1 step 1: pinned-host weak-key experiment (reports, does not assume) ----------

fn hx(s: &str) -> [u8; 32] {
    hex::decode(s).unwrap().try_into().unwrap()
}

/// Canonical encodings of the four points of order dividing 4 (test inputs only).
fn order4_encodings() -> Vec<[u8; 32]> {
    vec![
        hx("0100000000000000000000000000000000000000000000000000000000000000"), // identity
        hx("ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"), // order 2
        hx("0000000000000000000000000000000000000000000000000000000000000000"), // order 4
        hx("0000000000000000000000000000000000000000000000000000000000000080"), // order 4
    ]
}

/// A signature (R, s = 0) with R of small order that the *host* accepts for `msg` under `pk`.
fn host_forgery(pk: &[u8; 32], msg: &[u8; 32]) -> Option<[u8; 64]> {
    order4_encodings().into_iter().find_map(|r| {
        let mut sig = [0u8; 64];
        sig[..32].copy_from_slice(&r);
        env::ed25519_verify(&sig, msg, pk).then_some(sig)
    })
}

/// The curve's eight small-order points (curve25519-dalek's own constants), canonically
/// encoded, plus encodings the decoder also maps to small-order points.
fn weak_encodings() -> Vec<[u8; 32]> {
    let mut v: Vec<[u8; 32]> = curve25519_dalek::constants::EIGHT_TORSION.iter().map(|p| p.compress().to_bytes()).collect();
    // Non-canonical identity: y = p + 1.
    v.push(hx("eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"));
    // Identity with the sign bit set.
    v.push(hx("0100000000000000000000000000000000000000000000000000000000000080"));
    v
}

/// The first 32-byte string with y = i that doesn't decode to a curve point.
fn undecodable() -> [u8; 32] {
    (2u8..=255)
        .map(|i| {
            let mut b = [0u8; 32];
            b[0] = i;
            b
        })
        .find(|b| ed25519_dalek::VerifyingKey::from_bytes(b).is_err())
        .expect("some y has no point")
}

/// Signs everything a weak key could be asked for: a HoldAuth (varying serve_until) and one
/// use per slot (varying the fingerprint), using only `host_forgery`. Returns how many
/// candidates were tried.
#[allow(clippy::type_complexity)]
fn forge_all(w: &W, pk: &[u8; 32], reg: u64) -> ((HoldAuth, String), Vec<UseInput>, usize) {
    let mut tries = 0;
    let hold = (0..64u64)
        .find_map(|t| {
            tries += 1;
            let su = w.now + 20 * MIN + t;
            let m = hold_message(&id(BIZ), 1, &id(CARA), reg, 0, 1, 1, 10, su);
            host_forgery(pk, &m).map(|sig| {
                (HoldAuth { hold_seq: 1, units: 10, serve_until_ms: U64(su), key_slot: 0, key_epoch: 1 }, hex::encode(sig))
            })
        })
        .expect("a forged HoldAuth");
    let uses = (0..10u8)
        .map(|slot| {
            (0..64u8)
                .find_map(|alt| {
                    tries += 1;
                    let f = fp(1, slot, alt);
                    let m = use_message(&id(BIZ), 1, &id(CARA), reg, 0, 1, 1, slot, &f);
                    host_forgery(pk, &m).map(|sig| UseInput { slot, fingerprint: hex::encode(f), sig: hex::encode(sig) })
                })
                .expect("a forged UseAuth")
        })
        .collect();
    (hold, uses, tries)
}

/// The pinned unit host (near-sdk 5.29.1 → near-vm-runner 0.37.4, non-strict ed25519-dalek
/// 2.2.0 `verify`) accepts signatures nobody made, for small-order keys. This pins the host
/// behaviour the install check defends against; if a future pin verifies strictly, this fails
/// and the finding should be revisited, not silently kept.
#[test]
fn the_pinned_host_accepts_forgeries_under_weak_keys() {
    let _w = W::new();
    let msgs: Vec<[u8; 32]> = (0..16u8).map(|i| env::sha256_array([i])).collect();
    // The identity key: (R = identity, s = 0) verifies for every message.
    let identity = order4_encodings()[0];
    assert!(msgs.iter().all(|m| host_forgery(&identity, m).is_some()));
    // The all-zero key (order 4): k = H(R‖A‖M) depends on R, so each small-order R verifies
    // with probability 1/4; most messages have a forgery among the four, and varying the
    // message finds one quickly.
    let zero = order4_encodings()[2];
    let forged = msgs.iter().filter(|m| host_forgery(&zero, m).is_some()).count();
    assert!(forged >= 4, "only {forged} of 16 messages forgeable");
    // A real key is not forgeable this way.
    let real = key(1).verifying_key().to_bytes();
    assert!((0..64u8).all(|i| host_forgery(&real, &env::sha256_array([i])).is_none()));
}

/// What the install check prevents (reproduced before the fix, 003e1): with a weak key in a
/// record, an operator opens a hold and charges every unit with no customer signature at all.
/// The key is written into the record directly because the contract now refuses to install it.
#[test]
fn a_weak_key_in_a_record_would_let_an_operator_charge_without_the_customer() {
    for pk in [order4_encodings()[0], order4_encodings()[2]] {
        let mut w = W::new();
        w.shell(CARA, CARA);
        w.buy(CARA, 10, 1, None);
        let k = (id(CARA), 1);
        let mut e = *w.b.entitlements.get(&k).unwrap();
        e.keys[0] = KeySlot { state: KEY_ACTIVE, epoch: 1, pk, max_hold_units: 10, max_units_per_day: 30, day: 0, held_today: 0 };
        w.b.entitlements.insert(k, e);
        let ((a, s), uses, tries) = forge_all(&w, &pk, e.reg_id);
        assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "opened");
        all(&w.settle(CARA, 1, uses, true), "charged", 10);
        assert_eq!(w.ent(CARA).consumed.0, 10);
        println!("weak key {}: all 10 units charged by forgeries after {tries} host checks", hex::encode(pk));
    }
}

#[test]
fn weak_and_undecodable_keys_are_refused_on_both_install_paths() {
    let mut w = W::new();
    w.shell(CARA, CARA);
    w.buy(CARA, 10, 1, None);
    let mut bad = weak_encodings();
    assert_eq!(bad.len(), 10);
    bad.push(undecodable());
    for pk in &bad {
        let pk = hex::encode(pk);
        w.refuse(CARA, 1, "E_KEY_INVALID", |b| b.install_key(1, 0, pk.clone(), 10, 30));
        let msg = format!(
            r#"{{"buy":{{"plan_id":1,"units":1,"purchase_seq":2,"install":{{"slot":0,"pk":"{pk}","max_hold_units":10,"max_units_per_day":30}}}}}}"#
        );
        w.returned(CARA, P, msg);
    }
    // Every one of them is something the decoder either rejects or reports as weak.
    for pk in &bad {
        assert!(ed25519_dalek::VerifyingKey::from_bytes(pk).map_or(true, |k| k.is_weak()));
    }
    // A real key installs on either path.
    w.call(CARA, 1, |b| b.install_key(1, 0, pk(&key(1)), 10, 30));
    assert_eq!(w.buy(CARA, 1, 2, Some((1, &key(2)))), 0);
    assert_eq!(w.ent(CARA).key_states, vec![1, 1, 0, 0]);
}

// ---------- 003e1: deadlines ----------

#[test]
fn deadline_ceilings_are_checked_at_new_and_at_every_plan() {
    testing_env!(ctx(FOUNDER, 0, T0).build());
    let make = |ttl: u64, grace: u64| {
        let rules = Rules { max_hold_ttl_ms: U64(ttl), max_settle_grace_ms: U64(grace), ..rules() };
        Business::new("studio".into(), id(FOUNDER), id(TOKEN), rules, None)
    };
    for (ttl, grace) in [(MIN - 1, 0), (MAX_HOLD_TTL_MS + 1, 0), (u64::MAX, 0), (MIN, MAX_SETTLE_GRACE_MS + 1), (MIN, u64::MAX), (0, 0)] {
        let msg = panic_message(|| make(ttl, grace));
        assert!(msg.contains("E_ARGS"), "ttl {ttl} grace {grace}: {msg}");
    }
    // The floor and the ceilings themselves are accepted.
    drop(make(MIN, 0));
    drop(make(MAX_HOLD_TTL_MS, MAX_SETTLE_GRACE_MS));

    let mut w = W::new();
    for input in [
        PlanInput { hold_ttl_ms: U64(MIN - 1), ..plan_input(P) },
        PlanInput { hold_ttl_ms: U64(MAX_HOLD_TTL_MS + 1), ..plan_input(P) },
        PlanInput { hold_ttl_ms: U64(u64::MAX), ..plan_input(P) },
        PlanInput { settle_grace_ms: U64(MAX_SETTLE_GRACE_MS + 1), ..plan_input(P) },
        PlanInput { settle_grace_ms: U64(u64::MAX), ..plan_input(P) },
    ] {
        w.refuse(FOUNDER, NEAR, "E_ARGS", |b| b.create_plan(input.clone()));
    }
    let (id2, _) = w.measured(FOUNDER, NEAR, |b| b.create_plan(PlanInput { hold_ttl_ms: U64(MIN), settle_grace_ms: U64(0), ..plan_input(P) }));
    let (id3, _) = w.measured(FOUNDER, NEAR, |b| {
        b.create_plan(PlanInput { hold_ttl_ms: U64(MAX_HOLD_TTL_MS), settle_grace_ms: U64(MAX_SETTLE_GRACE_MS), ..plan_input(P) })
    });
    assert_eq!((id2, id3), (2, 3));
    let r = w.b.get_rules();
    assert_eq!(
        (r.min_hold_ttl_ms.0, r.max_hold_ttl_ms.0, r.max_settle_grace_ms.0, r.rules.max_hold_ttl_ms.0),
        (60_000, 3_600_000, 3_600_000, 3_600_000)
    );
    assert_eq!((r.payout_slots, r.max_party_pending_total, r.max_party_pending_each, r.max_customer_pending), (16, 4, 2, 2));
}

#[test]
fn hold_deadlines_hold_at_their_exact_boundaries() {
    let (mut w, k) = happy();
    let reg = w.ent(CARA).reg_id.0;
    let now = w.now;
    // Plan 1: TTL 30 min, grace 10 min. Exactly the 60 s floor opens; one ms less doesn't.
    let (a, s) = w.auth(CARA, &k, reg, 3, 1, now + MIN - 1, 0, 1);
    w.refuse(METER, 0, "E_EXPIRED", |b| b.open_hold(id(CARA), 1, a, s));
    let (a, s) = w.auth(CARA, &k, reg, 3, 1, now + MIN, 0, 1);
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "opened");
    w.call(METER, 0, |b| b.release_hold(id(CARA), 1, 3));
    // Exactly the TTL opens; one ms more, or a huge value, is refused without overflow.
    for su in [now + 30 * MIN + 1, u64::MAX, u64::MAX - 1] {
        let (a, s) = w.auth(CARA, &k, reg, 4, 1, su, 0, 1);
        w.refuse(METER, 0, "E_TTL", |b| b.open_hold(id(CARA), 1, a, s));
    }
    let (a, s) = w.auth(CARA, &k, reg, 4, 2, now + 30 * MIN, 0, 1);
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "opened");
    let e = w.ent(CARA);
    assert_eq!((e.serve_until_ms.0, e.settle_until_ms.0), (now + 30 * MIN, now + 40 * MIN));
    // Settling works exactly at the deadline; a stranger can't release until it has passed.
    w.now = now + 40 * MIN;
    let u = vec![w.use_(CARA, &k, 4, 0, 0)];
    all(&w.settle(CARA, 4, u, false), "charged", 1);
    w.refuse(STRANGER, 0, "E_NOT_OPERATOR", |b| b.release_hold(id(CARA), 1, 4));
    w.now += 1;
    let late = vec![w.use_(CARA, &k, 4, 1, 0)];
    w.refuse(METER, 0, "E_EXPIRED", |b| b.settle_hold(id(CARA), 1, 4, late, false));
    w.call(STRANGER, 0, |b| b.release_hold(id(CARA), 1, 4));
    assert_eq!(w.ent(CARA).free.0, 79);
}

// ---------- 003e1: exact readback ----------

#[test]
fn readback_identifies_exactly_which_use_was_charged() {
    let mut w = W::new();
    let k = key(1);
    w.shell(CARA, CARA);
    w.buy(CARA, 100, 1, Some((0, &k)));
    w.open(CARA, &k, 1, 10);
    let u = w.uses(CARA, &k, 1, 0..5);
    w.settle(CARA, 1, u, false);
    let e = w.ent(CARA);
    assert_eq!((e.hold_key_slot, e.hold_key_epoch, e.hold_opened_at_ms.0), (0, 1, T0));
    assert_eq!(e.hold_slots.len(), 10);
    for s in 0..10u8 {
        let want = (s < 5).then(|| hex::encode(fp(1, s, 0)));
        assert_eq!(e.hold_slots[s as usize], want, "slot {s}");
    }
    let kv = &e.keys[0];
    assert_eq!(
        (kv.state.as_str(), kv.public_key.clone(), kv.max_units_per_day, kv.held_today, kv.day),
        ("active", pk(&k), 30, 10, (T0 / DAY) as u32)
    );
    assert_eq!(e.keys[1].state, "empty");
    let reg = e.reg_id;
    let chk = |w: &W, seq: u32, slot: u8, f: &str| w.b.check_use(id(CARA), 1, reg, seq, slot, f.to_string());
    let hexfp = |s: u8, alt: u8| hex::encode(fp(1, s, alt));
    assert_eq!(chk(&w, 1, 3, &hexfp(3, 0)).status, "charged");
    assert_eq!(chk(&w, 1, 3, &hexfp(3, 1)).status, "conflict");
    assert_eq!(chk(&w, 1, 7, &hexfp(7, 0)).status, "unused");
    assert_eq!(chk(&w, 1, 12, &hexfp(7, 0)).status, "invalid");
    assert_eq!(chk(&w, 1, 3, "zz").status, "invalid");
    assert_eq!(chk(&w, 9, 3, &hexfp(3, 0)).status, "unknown_hold");
    // Closed: which slots were used, and a root the client recomputes from its own uses.
    let rest = w.uses(CARA, &k, 1, 5..7);
    w.settle(CARA, 1, rest, true);
    let c = chk(&w, 1, 3, &hexfp(3, 0));
    assert_eq!((c.status.as_str(), c.slot_used), ("closed", Some(true)));
    assert_eq!(chk(&w, 1, 8, &hexfp(8, 0)).slot_used, Some(false));
    let mine: Vec<(u8, [u8; 32])> = (0..7).map(|s| (s, fp(1, s, 0))).collect();
    let root = hex::encode(closed_hold_root(&mine));
    assert_eq!(c.closed_root.as_deref(), Some(root.as_str()));
    assert_eq!(w.ent(CARA).last_hold_root, root);
    let mut wrong = mine.clone();
    wrong[3].1 = fp(1, 3, 1);
    assert_ne!(hex::encode(closed_hold_root(&wrong)), root, "a different use gives a different root");
    // Re-registration: the old registration's uses are reported as such, never as this one's.
    let (s, p) = w.refund(CARA, 93);
    assert!(w.callback(s, p, true));
    w.call(CARA, 1, |b| b.unregister(id(CARA), 1));
    assert_eq!(chk(&w, 1, 3, &hexfp(3, 0)).status, "no_entitlement");
    w.shell(CARA, CARA);
    assert_eq!(chk(&w, 1, 3, &hexfp(3, 0)).status, "other_registration");
    let fresh = w.ent(CARA).reg_id;
    assert_eq!(w.b.check_use(id(CARA), 1, fresh, 1, 3, hexfp(3, 0)).status, "unknown_hold");
    assert_eq!(w.b.check_use(id(CARA), 1, fresh, 0, 3, hexfp(3, 0)).status, "unknown_hold");
}

#[test]
fn already_vouches_only_for_a_valid_signature() {
    let (mut w, k) = happy();
    let (a, s) = w.std_auth(CARA, &k, 3, 5);
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a.clone(), s.clone())), "opened");
    let (_, foreign) = w.std_auth(CARA, &key(9), 3, 5);
    for bad in ["00".repeat(64), foreign, "zz".into(), String::new()] {
        w.refuse(METER, 0, "E_SIG", |b| b.open_hold(id(CARA), 1, a.clone(), bad.clone()));
    }
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "already");
}

// ---------- 003e1: books keep economic categories ----------

#[test]
fn payouts_keep_their_category_through_failures_claims_and_duplicates() {
    let (mut w, _) = happy();
    // A refund fails, its claim fails, the second claim succeeds; then a duplicate callback.
    let (s, p) = w.refund(CARA, 10);
    assert!(!w.callback(s, p, false));
    w.call(CARA, 1, |b| drop(b.claim_customer(1)));
    let (s, p) = w.last_payout();
    assert!(!w.callback(s, p, false));
    assert_eq!(w.ent(CARA).claim.0, 10 * P);
    w.call(CARA, 1, |b| drop(b.claim_customer(1)));
    let (s, p) = w.last_payout();
    assert!(w.callback(s, p, true));
    let before = w.snap();
    assert!(!w.callback(s, p, true), "a duplicate callback books nothing");
    assert_eq!(w.snap(), before);
    // An owner withdrawal fails and is paid through the owner's claim.
    let (s, p) = w.withdraw(FOUNDER, 5 * P);
    assert!(!w.callback(s, p, false));
    w.call(FOUNDER, 1, |b| drop(b.claim_party(CLAIM_PROFIT)));
    let (s, p) = w.last_payout();
    assert!(w.callback(s, p, true));
    let m = rec(&w, 202611);
    assert_eq!(
        (n(&m.customer_returns), n(&m.owner_withdrawals), n(&m.paid_on_retry)),
        (10 * P, 5 * P, 15 * P)
    );
    let e = w.ent(CARA);
    assert_eq!((e.units_retired_to_refund.0, e.claim.0, e.pending_refs), (10, 0, 0));
    let t = w.t();
    assert_eq!((t.held.0, t.claims_total.0, t.pending_total.0), (85 * P, 0, 0));
}

#[test]
fn a_resent_stranded_payout_never_touches_a_recreated_record() {
    let (mut w, _) = happy();
    w.sell(FOUNDER, BUYER, 40 * P, &[]);
    w.call(FOUNDER, 1, |b| drop(b.claim_party(CLAIM_SALE_PROCEEDS)));
    let (s, p) = w.last_payout();
    // Corrupt on purpose: the founder's record vanishes while the proceeds are in flight.
    w.corrupt = true;
    w.b.party.remove(&id(FOUNDER));
    assert!(!w.callback(s, p, false));
    assert_eq!(w.b.get_pending()[0].state, "stranded");
    // The founder buys the business back: the proposal creates a fresh record, paid by the buyer.
    w.sell(BUYER, FOUNDER, 30 * P, &[]);
    let r = w.b.get_party(id(FOUNDER)).unwrap();
    assert_eq!((r.pending_refs, r.payer.clone()), (0, id(BUYER)));
    w.call(FOUNDER, 1, |b| drop(b.claim_stranded(s)));
    let (s2, p2) = w.last_payout();
    assert_eq!(s2, s);
    // It fails again: still stranded, and the new record gains no claim of any kind.
    assert!(!w.callback(s2, p2, false));
    assert_eq!(w.b.get_pending()[0].state, "stranded");
    let r = w.b.get_party(id(FOUNDER)).unwrap();
    assert_eq!((r.profit_claim.0, r.escrow_return_claim.0, r.sale_proceeds_claim.0), (0, 0, 0));
    w.call(FOUNDER, 1, |b| drop(b.claim_stranded(s)));
    let (s3, p3) = w.last_payout();
    assert!(w.callback(s3, p3, true));
    assert!(near_sdk::test_utils::get_logs().iter().all(|l| !l.contains("pending_refs_underflow")));
    let r = w.b.get_party(id(FOUNDER)).unwrap();
    assert_eq!((r.pending_refs, r.sale_proceeds_claim.0), (0, 0), "the recreated record was never touched");
    // Paid on the stranded retry, and still booked as sale proceeds, never as profit.
    let m = rec(&w, 202611);
    assert_eq!((n(&m.sale_proceeds_paid), n(&m.paid_on_retry), n(&m.owner_withdrawals)), (40 * P, 40 * P, 0));
    assert_eq!(w.t().pending_total.0, 0);
}

#[test]
fn an_impossible_pending_count_is_reported_not_hidden() {
    let (mut w, _) = happy();
    let (s, p) = w.refund(CARA, 1);
    // Corrupt on purpose: the record claims nothing is in flight.
    w.corrupt = true;
    let k = (id(CARA), 1);
    let mut e = *w.b.entitlements.get(&k).unwrap();
    e.pending_refs = 0;
    w.b.entitlements.insert(k, e);
    w.env_callback(true);
    assert!(w.b.on_payout(s, U64(p)), "the callback still completes");
    assert!(near_sdk::test_utils::get_logs().iter().any(|l| l.contains("pending_refs_underflow")));
    assert_eq!(w.ent(CARA).pending_refs, 0);
    w.invariants();
}

#[test]
fn identity_counters_refuse_before_they_overflow() {
    let (mut w, _) = happy();
    w.b.payout_seq = u64::MAX;
    w.refuse(CARA, 1, "E_OVERFLOW: payout ids", |b| b.refund_units(1, U64(1)));
    w.refuse(FOUNDER, 1, "E_OVERFLOW: payout ids", |b| b.withdraw_profit(U128(1)));
    w.b.reg_seq = u64::MAX;
    w.refuse(DEV, NEAR, "E_OVERFLOW: registration ids", |b| b.sponsor_shell(id(DEV), 1));
}

// ---------- 003e1: random sequences across prices, key rotation and owners ----------

#[test]
fn random_sequences_across_prices_key_rotation_and_owners() {
    let customers = [CARA, DEV];
    let parties = [FOUNDER, BUYER, STRANGER];
    let mut totals = [0usize; 15];
    for seed in [0x5851_F42D_4C95_7F2Du64, 0x1405_7B7E_F767_814F, 0x9E37_79B9_7F4A_7C15] {
        let mut w = W::new();
        let price2 = 3 * P + 7;
        let (plan2, _) = w.measured(FOUNDER, NEAR, |b| b.create_plan(plan_input(price2)));
        let plans = [(1u32, P), (plan2, price2)];
        let mut r = Rng(seed);
        let mut seeds = 10u8;
        // (customer, plan, key slot, epoch) → the signing key installed there.
        let mut keys: std::collections::HashMap<(usize, u32, u8, u32), SigningKey> = Default::default();
        let mut owner = FOUNDER;
        for (ci, c) in customers.iter().enumerate() {
            for (plan, price) in plans {
                w.measured(c, NEAR, |b| b.sponsor_shell(id(c), plan));
                let k = key(seeds);
                seeds += 1;
                assert_eq!(w.ft(c, 20 * price, buy_msg(plan, 20, 1, Some((0, &k, 60)))), 0);
                keys.insert((ci, plan, 0, 1), k);
            }
        }
        for _ in 0..400 {
            let ci = r.below(2) as usize;
            let c = customers[ci];
            let (plan, price) = plans[r.below(2) as usize];
            let e = *w.b.entitlements.get(&(id(c), plan)).unwrap();
            let active = (0..KEY_SLOTS as u8).find(|s| e.keys[*s as usize].state == KEY_ACTIVE);
            let signer = |slot: u8, epoch: u32| keys.get(&(ci, plan, slot, epoch)).cloned().unwrap_or_else(|| key(99));
            let op = r.below(15) as usize;
            let done = match op {
                0 => {
                    let units = 1 + r.below(15) as u32;
                    let seq = e.purchase_seq + if r.below(5) == 0 { 0 } else { 1 };
                    let amount = units as u128 * price + if r.below(6) == 0 { 1 } else { 0 };
                    let before = w.snap();
                    let back = w.ft(c, amount, buy_msg(plan, units, seq, None));
                    assert!(back == 0 || (back == amount && w.snap() == before));
                    back == 0
                }
                1 => {
                    let Some(slot) = active else { continue };
                    let units = 1 + r.below(10) as u8;
                    let su = w.now + (1 + r.below(29)) * MIN;
                    let ep = e.keys[slot as usize].epoch;
                    let (a, s) = auth_on(plan, c, &signer(slot, ep), e.reg_id, e.hold_seq + 1, units, su, slot, ep);
                    w.attempt(METER, 0, None, |b| b.open_hold(id(c), plan, a, s))
                }
                2 | 3 => {
                    let seq = if e.hold.active { e.hold.seq } else { e.last_hold.seq };
                    let (ks, ke) = if e.hold.active { (e.hold.key_slot, e.hold.key_epoch) } else { (0, 1) };
                    let k = signer(ks, ke);
                    let width = if e.hold.active && r.below(6) != 0 { e.hold.units as u64 } else { 10 };
                    let uses: Vec<UseInput> = (0..1 + r.below(4))
                        .map(|_| {
                            let slot = r.below(width) as u8;
                            let alt = u8::from(r.below(8) == 0);
                            use_on(plan, c, &k, e.reg_id, ks, ke, seq, slot, fp(seq, slot, alt))
                        })
                        .collect();
                    let close = r.below(3) == 0;
                    w.attempt(METER, 0, None, |b| b.settle_hold(id(c), plan, seq, uses, close))
                }
                4 => w.attempt(if r.below(2) == 0 { METER } else { STRANGER }, 0, None, |b| b.release_hold(id(c), plan, e.hold.seq)),
                5 => {
                    let units = 1 + r.below(12);
                    w.attempt(c, 1, None, |b| b.refund_units(plan, U64(units)))
                }
                6 | 7 => {
                    let p = w.b.get_pending();
                    if p.is_empty() {
                        continue;
                    }
                    let pick = &p[r.below(p.len() as u64) as usize];
                    let stale = r.below(pick.payout_id.0.min(5));
                    let (slot, pid, ok) = (pick.slot, pick.payout_id.0 - stale, r.below(2) == 0);
                    w.attempt(BIZ, 0, Some(ok), |b| b.on_payout(slot, U64(pid)))
                }
                8 => w.attempt(c, 1, None, |b| b.claim_customer(plan)),
                9 => {
                    let amount = 1 + r.below(4) as u128 * (P / 5);
                    w.attempt(owner, 1, None, |b| b.withdraw_profit(U128(amount)))
                }
                10 => {
                    // Usually a party that has a claim; sometimes any party (mostly refused).
                    let owes = |v: &PartyView| [v.profit_claim.0, v.escrow_return_claim.0, v.sale_proceeds_claim.0];
                    let owed: Vec<(&str, u8)> = parties
                        .iter()
                        .copied()
                        .filter_map(|p| {
                            let v = w.b.get_party(id(p))?;
                            let c = owes(&v).iter().position(|x| *x > 0)?;
                            Some((p, c as u8))
                        })
                        .collect();
                    let (who, cat) = if !owed.is_empty() && r.below(4) != 0 {
                        owed[r.below(owed.len() as u64) as usize]
                    } else {
                        (parties[r.below(3) as usize], r.below(3) as u8)
                    };
                    w.attempt(who, 1, None, |b| b.claim_party(cat))
                }
                11 => {
                    // Key rotation (rarer): revoke the active key, install a fresh one elsewhere.
                    let Some(slot) = active else { continue };
                    if r.below(4) != 0 {
                        continue;
                    }
                    let revoked = w.attempt(c, 1, None, |b| b.revoke_key(plan, slot));
                    let to = (slot + 1 + r.below(3) as u8) % KEY_SLOTS as u8;
                    let k = key(seeds);
                    seeds = seeds.wrapping_add(1).max(10);
                    let pkh = pk(&k);
                    let next_epoch = w.b.entitlements.get(&(id(c), plan)).unwrap().keys[to as usize].epoch + 1;
                    let installed = w.attempt(c, 1, None, |b| b.install_key(plan, to, pkh, 10, 60));
                    if installed {
                        keys.insert((ci, plan, to, next_epoch), k);
                    }
                    revoked && installed
                }
                12 => {
                    // An actual sale (rarer); the operator is a successor grant only sometimes.
                    if r.below(5) != 0 {
                        continue;
                    }
                    let at = parties.iter().position(|p| *p == owner).unwrap();
                    let next = parties[(at + 1 + r.below(2) as usize) % 3];
                    let grants: &[(&str, u8)] = if r.below(3) == 0 { &[] } else { &[(METER, METERING)] };
                    w.sell(owner, next, (1 + r.below(50) as u128) * P, grants);
                    owner = next;
                    true
                }
                13 => {
                    // The current owner (re-)appoints the operator: a same-size rewrite (003g).
                    let (_, d) = w.measured(owner, 1, |b| b.appoint_operator(id(METER), METERING));
                    assert_eq!(d, 0);
                    w.invariants();
                    true
                }
                _ => {
                    // Mostly short steps (holds settle within 40 minutes), sometimes a day.
                    w.now += [MIN, MIN, MIN, 2 * MIN, 2 * MIN, 5 * MIN, 5 * MIN, 11 * MIN, 31 * MIN, DAY][r.below(10) as usize];
                    true
                }
            };
            if done {
                totals[op] += 1;
            }
        }
    }
    println!("random (prices, keys, owners) successes by operation: {totals:?}");
    for (op, n) in totals.iter().enumerate() {
        assert!(*n >= 3, "operation {op} succeeded only {n} times: {totals:?}");
    }
}

// =====================================================================================
// 003g: the sale, through the contract's own methods (BUSINESS_V3_SALE.md). "Both" tests run
// in a Direct business and in a Gated one, where CLOSER acts by hand: that models who may
// close, not any runtime closer.
// =====================================================================================

const MODES: [fn() -> W; 2] = [W::new, W::gated];

fn is_gated(w: &W) -> bool {
    w.b.close_mode == MODE_GATED
}

/// Propose and fund, with the buyer's acceptance; the seller's acceptance is left to the test.
fn funded_and_buyer_accepted(w: &mut W, t: DealTermsInput) {
    let buyer = t.buyer.to_string();
    w.propose(FOUNDER, t);
    assert_eq!(w.fund(&buyer), 0);
    assert_eq!(w.accept(&buyer), "accepted");
}

/// The seller's acceptance completes the sale (and the closer closes in Gated mode).
fn seller_completes(w: &mut W) {
    if is_gated(w) {
        assert_eq!(w.accept(FOUNDER), "closing");
        let o = w.order();
        w.neutral(CLOSER, 0, |b| b.close_sale(o));
    } else {
        assert_eq!(w.accept(FOUNDER), "closed");
    }
}

#[test]
fn g01_the_100_20_80_journey_across_an_actual_close() {
    for make in MODES {
        let (mut w, k) = happy_in(make());
        assert_100_20_80(&w);
        let mut t = w.terms(BUYER, 400 * P, &[(METER2, METERING)]);
        t.available_floor = U128(10 * P);
        funded_and_buyer_accepted(&mut w, t);
        let held_before = w.t().held.0;
        seller_completes(&mut w);
        // At the close: customers unchanged, control moved, the price is the seller's claim.
        assert_100_20_80_customer(&w);
        let c = w.b.get_control();
        assert_eq!((c.owner, c.generation, c.operators), (id(BUYER), 2, vec![(id(METER2), METERING, 2)]));
        let f = w.b.get_party(id(FOUNDER)).unwrap();
        assert_eq!((f.sale_proceeds_claim.0, f.profit_claim.0, f.escrow_return_claim.0), (400 * P, 0, 0));
        let t = w.t();
        assert_eq!((t.escrow_total.0, t.held.0, t.available.0, t.claims_total.0), (0, held_before, 20 * P, 400 * P));
        let o = &w.b.get_outcomes()[0];
        assert_eq!((o.status.as_str(), o.generation_after, o.price.0), ("closed", 2, 400 * P));
        // After: the successor operator serves the same customer with the customer's own key.
        let (a, s) = w.std_auth(CARA, &k, 3, 10);
        assert_eq!(w.call(METER2, 0, |b| b.open_hold(id(CARA), 1, a, s)), "opened");
        let u = w.uses(CARA, &k, 3, 0..4);
        w.refuse(METER, 0, "E_NOT_OPERATOR", |b| b.settle_hold(id(CARA), 1, 3, u.clone(), true));
        all(&w.call(METER2, 0, |b| b.settle_hold(id(CARA), 1, 3, u, true)), "charged", 4);
        let e = w.ent(CARA);
        assert_eq!((e.consumed.0, e.free.0, e.purchased.0), (24, 76, 100));
        // The former owner has no owner authority left.
        w.refuse(FOUNDER, 1, "E_NOT_OWNER", |b| b.withdraw_profit(U128(1)));
        w.refuse(FOUNDER, NEAR, "E_NOT_OWNER", |b| b.create_plan(plan_input(P)));
        w.refuse(FOUNDER, 1, "E_NOT_OWNER", |b| b.set_manifest("22".repeat(32), U64(0)));
        w.refuse(FOUNDER, 1, "E_NOT_OWNER", |b| b.appoint_operator(id(METER), METERING));
        let back = w.terms(FOUNDER, P, &[(METER, METERING)]);
        w.refuse(FOUNDER, NEAR, "E_NOT_OWNER", |b| b.propose_sale(back));
    }
}

fn assert_100_20_80_customer(w: &W) {
    let e = w.ent(CARA);
    assert_eq!((e.free.0, e.consumed.0, e.purchased.0, e.units_retired_to_refund.0), (80, 20, 100, 0));
    assert_eq!((e.last_hold_seq, e.last_hold_used, e.last_hold_charged, e.key_epochs[0]), (2, 0x3FF, 10, 1));
}

#[test]
fn g02_a_hold_open_across_the_close() {
    for make in MODES {
        // With a successor METERING grant: it settles the old hold; the old operator can't.
        let (mut w, k) = happy_in(make());
        w.open(CARA, &k, 3, 10);
        w.sell(FOUNDER, BUYER, 100 * P, &[(METER2, METERING)]);
        let u = w.uses(CARA, &k, 3, 0..2);
        w.refuse(METER, 0, "E_NOT_OPERATOR", |b| b.settle_hold(id(CARA), 1, 3, u.clone(), true));
        all(&w.call(METER2, 0, |b| b.settle_hold(id(CARA), 1, 3, u, true)), "charged", 2);
        assert_eq!(w.ent(CARA).free.0, 78);
        // With no successor METERING grant (possible in Direct mode only: a Gated close refuses
        // terms without one), after its deadline anyone releases it; the units come back.
        let (mut w, k) = happy_in(make());
        if is_gated(&w) {
            let t = w.terms(BUYER, 100 * P, &[]);
            w.refuse(FOUNDER, NEAR, "successor METERING", |b| b.propose_sale(t));
            continue;
        }
        w.open(CARA, &k, 3, 10);
        let settle_until = w.ent(CARA).settle_until_ms.0;
        w.sell(FOUNDER, BUYER, 100 * P, &[]);
        w.refuse(STRANGER, 0, "E_NOT_OPERATOR", |b| b.release_hold(id(CARA), 1, 3));
        w.now = settle_until + 1;
        w.call(STRANGER, 0, |b| b.release_hold(id(CARA), 1, 3));
        assert_eq!(w.ent(CARA).free.0, 80);
    }
}

#[test]
fn g03_g04_seller_payouts_failing_or_unanswered_across_the_close() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let (fs, fp1) = w.withdraw(FOUNDER, 3 * P);
        let (_ms, _mp) = w.withdraw(FOUNDER, 2 * P);
        w.sell(FOUNDER, BUYER, 100 * P, &[(METER2, METERING)]);
        let available = w.t().available.0;
        assert_eq!(available, 15 * P);
        // The failed one becomes the seller's profit claim; the buyer's money is unaffected.
        assert!(!w.callback(fs, fp1, false));
        let f = w.b.get_party(id(FOUNDER)).unwrap();
        assert_eq!((f.profit_claim.0, f.sale_proceeds_claim.0), (3 * P, 100 * P));
        assert_eq!(w.t().available.0, available);
        // The other never answers: it stays pending and listed; nothing guesses.
        w.now += 40 * DAY;
        w.invariants();
        let p = w.b.get_pending();
        assert_eq!((p.len(), p[0].state.as_str(), p[0].amount.0, p[0].kind.as_str()), (1, "in_flight", 2 * P, "profit"));
        assert_eq!(w.t().withdrawable.0, 10 * P, "the buyer's withdrawable ignores the seller's payouts");
        w.refuse(FOUNDER, 1, "E_PENDING_REFS", |b| b.release_party_slot());
    }
}

#[test]
fn g05_unfunding_refunding_and_refunding_twice() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        funded_and_buyer_accepted(&mut w, t);
        let seq = w.deal().seq;
        // A second funding while funded comes back whole.
        let d = w.deal();
        w.returned(BUYER, 100 * P, fund_msg(d.seq.0, d.version, 100 * P));
        // The buyer takes it back: an escrow-return claim; their acceptance is cleared.
        w.refuse(STRANGER, 1, "E_NOT_BUYER", |b| b.unfund_deal(seq));
        w.neutral(BUYER, 1, |b| b.unfund_deal(seq));
        let d = w.deal();
        assert_eq!((d.state.as_str(), d.buyer_accepted, d.escrow.0), ("proposed", false, 0));
        assert_eq!(w.b.get_party(id(BUYER)).unwrap().escrow_return_claim.0, 100 * P);
        w.refuse(BUYER, 1, "E_FUNDS", |b| b.unfund_deal(seq));
        w.refuse(BUYER, 1, "E_UNFUNDED", |b| b.accept_sale(d.seq, d.version, d.digest.clone()));
        // Collected: booked as escrow returned, never as profit or a customer refund.
        w.call(BUYER, 1, |b| drop(b.claim_party(CLAIM_ESCROW_RETURN)));
        let (s, p) = w.last_payout();
        assert!(w.callback(s, p, true));
        let m = rec(&w, 202611);
        assert_eq!(
            (n(&m.escrow_in), n(&m.escrow_returned), n(&m.owner_withdrawals), n(&m.customer_returns), n(&m.purchases_in)),
            (100 * P, 100 * P, 0, 0, 100 * P)
        );
        // Funded again, accepted, and (Gated) closing: escrow stays put.
        assert_eq!(w.fund(BUYER), 0);
        assert_eq!(w.accept(BUYER), "accepted");
        if is_gated(&w) {
            assert_eq!(w.accept(FOUNDER), "closing");
            w.refuse(BUYER, 1, "E_CLOSING", |b| b.unfund_deal(seq));
            w.refuse(BUYER, 1, "E_CLOSING", |b| b.cancel_sale(seq));
            w.refuse(FOUNDER, 1, "E_CLOSING", |b| b.cancel_sale(seq));
            let o = w.order();
            w.neutral(CLOSER, 0, |b| b.close_sale(o));
        } else {
            assert_eq!(w.accept(FOUNDER), "closed");
        }
        assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().sale_proceeds_claim.0, 100 * P);
    }
}

#[test]
fn g06_funding_that_isnt_exactly_right_comes_back_whole() {
    let (mut w, _) = happy();
    // No live deal at all.
    w.returned(BUYER, P, fund_msg(1, 1, P));
    let t = w.terms(BUYER, 100 * P, &[]);
    w.propose(FOUNDER, t);
    let d = w.deal();
    let (seq, v) = (d.seq.0, d.version);
    w.returned(BUYER, 100 * P - 1, fund_msg(seq, v, 100 * P)); // amount below the price
    w.returned(BUYER, 100 * P, fund_msg(seq, v, 100 * P + 1)); // stated price wrong
    w.returned(BUYER, 100 * P, fund_msg(seq, v + 1, 100 * P)); // wrong version
    w.returned(BUYER, 100 * P, fund_msg(seq + 1, v, 100 * P)); // wrong deal
    w.returned(STRANGER, 100 * P, fund_msg(seq, v, 100 * P)); // not the buyer
    w.returned(FOUNDER, 100 * P, fund_msg(seq, v, 100 * P)); // the seller
    w.returned(BUYER, 100 * P, r#"{"fund_deal":{"deal_seq":"1"}}"#.into()); // malformed
    w.now = d.expires_at_ms.0; // at expiry: too late
    w.returned(BUYER, 100 * P, fund_msg(seq, v, 100 * P));
    assert_eq!(w.t().escrow_total.0, 0);
}

#[test]
fn g07_a_revision_invalidates_acceptances_and_returns_mismatched_escrow() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        funded_and_buyer_accepted(&mut w, t);
        let v1 = w.deal();
        // Same price, new document: version 2, acceptances cleared, escrow kept.
        let mut t2 = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        t2.terms_hash = "22".repeat(32);
        let seq = v1.seq;
        w.neutral(FOUNDER, 1, |b| b.revise_sale(seq, t2));
        let v2 = w.deal();
        assert_eq!((v2.version, v2.buyer_accepted, v2.seller_accepted, v2.escrow.0), (2, false, false, 100 * P));
        assert_ne!(v2.digest, v1.digest);
        // The old acceptance can't be replayed, nor the new version with the old digest.
        w.refuse(BUYER, 1, "E_VERSION", |b| b.accept_sale(seq, 1, v1.digest.clone()));
        w.refuse(BUYER, 1, "E_TERMS", |b| b.accept_sale(seq, 2, v1.digest.clone()));
        w.refuse(FOUNDER, 1, "E_TERMS", |b| b.accept_sale(seq, 2, "00".repeat(32)));
        // The buyer can't change while funded.
        let t3 = w.terms(STRANGER, 100 * P, &[(METER2, METERING)]);
        w.refuse(FOUNDER, NEAR, "E_FUNDED_BUYER", |b| b.revise_sale(seq, t3));
        // A new price returns the escrow at once, to the buyer, as an escrow-return claim.
        let t4 = w.terms(BUYER, 120 * P, &[(METER2, METERING)]);
        w.neutral(FOUNDER, 1, |b| b.revise_sale(seq, t4));
        let v3 = w.deal();
        assert_eq!((v3.version, v3.escrow.0, v3.price.0), (3, 0, 120 * P));
        assert_eq!(w.b.get_party(id(BUYER)).unwrap().escrow_return_claim.0, 100 * P);
        assert_eq!(w.t().escrow_total.0, 0);
        // Re-funded at the new price; the sale completes; both kinds of claim stay apart.
        assert_eq!(w.fund(BUYER), 0);
        assert_eq!(w.accept(BUYER), "accepted");
        seller_completes(&mut w);
        let b = w.b.get_party(id(BUYER)).unwrap();
        let f = w.b.get_party(id(FOUNDER)).unwrap();
        assert_eq!((b.escrow_return_claim.0, f.sale_proceeds_claim.0), (100 * P, 120 * P));
        w.refuse(STRANGER, 1, "E_NOT_OWNER", |b| b.revise_sale(seq, w_terms_stub()));
    }
}

#[test]
fn g08_only_the_closer_closes_and_only_with_the_exact_order() {
    let (mut w, _) = happy_in(W::gated());
    let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
    funded_and_buyer_accepted(&mut w, t);
    assert_eq!(w.accept(FOUNDER), "closing");
    let started = w.now;
    let good = w.order();
    let with = |f: &dyn Fn(&mut CloseOrder)| {
        let mut o = good.clone();
        f(&mut o);
        o
    };
    w.refuse(STRANGER, 0, "E_NOT_CLOSER", |b| b.close_sale(good.clone()));
    w.refuse(FOUNDER, 0, "E_NOT_CLOSER", |b| b.close_sale(good.clone()));
    w.refuse(CLOSER, 0, "E_NO_DEAL", |b| b.close_sale(with(&|o| o.deal_seq = U64(9))));
    w.refuse(CLOSER, 0, "E_VERSION", |b| b.close_sale(with(&|o| o.version = 2)));
    w.refuse(CLOSER, 0, "E_GENERATION", |b| b.close_sale(with(&|o| o.expected_generation = 2)));
    w.refuse(CLOSER, 0, "E_CLOSE_SEQ", |b| b.close_sale(with(&|o| o.closing_control_seq = U64(o.closing_control_seq.0 - 1))));
    w.refuse(CLOSER, 0, "E_TERMS", |b| b.close_sale(with(&|o| o.digest = "00".repeat(32))));
    w.refuse(CLOSER, 0, "E_MANIFEST", |b| b.close_sale(with(&|o| o.manifest = "33".repeat(32))));
    w.refuse(CLOSER, 0, "E_MANIFEST", |b| b.close_sale(with(&|o| o.manifest_seq = U64(1))));
    w.refuse(CLOSER, 0, "E_ISSUED_FUTURE", |b| b.close_sale(with(&|o| o.issued_at_ms = U64(started + 1))));
    w.now = started + MIN;
    w.refuse(CLOSER, 0, "E_ISSUED_BEFORE", |b| b.close_sale(with(&|o| o.issued_at_ms = U64(started - 1))));
    w.now = started + 25 * MIN;
    w.refuse(CLOSER, 0, "E_ISSUE_AGE", |b| b.close_sale(with(&|o| o.issued_at_ms = U64(started + 5 * MIN - 1))));
    // Exactly at the age limit is fine; the close lands.
    let fine = with(&|o| o.issued_at_ms = U64(started + 5 * MIN));
    w.neutral(CLOSER, 0, |b| b.close_sale(fine));
    assert_eq!(w.b.get_control().owner, id(BUYER));
    // Replayed: nothing left to close.
    w.refuse(CLOSER, 0, "E_NO_DEAL", |b| b.close_sale(good.clone()));
    // A Direct business has no closer at all.
    let (mut d, _) = happy();
    let mut o = good.clone();
    o.deal_seq = U64(1);
    d.refuse(CLOSER, 0, "E_MODE", |b| b.close_sale(o));
}

#[test]
fn g08b_the_close_deadline_is_exact() {
    let (mut w, _) = happy_in(W::gated());
    let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
    funded_and_buyer_accepted(&mut w, t);
    assert_eq!(w.accept(FOUNDER), "closing");
    let d = w.deal();
    assert_eq!(d.deadline_ms.0, w.now + 30 * MIN);
    w.now = d.deadline_ms.0;
    let o = w.order();
    w.refuse(CLOSER, 0, "E_DEADLINE", |b| b.close_sale(o));
    w.now = d.deadline_ms.0 - 1;
    let o = w.order();
    w.neutral(CLOSER, 0, |b| b.close_sale(o));
}

#[test]
fn g09_an_unclosed_gated_sale_is_aborted_and_the_escrow_goes_back_to_the_buyer() {
    let (mut w, _) = happy_in(W::gated());
    let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
    funded_and_buyer_accepted(&mut w, t);
    assert_eq!(w.accept(FOUNDER), "closing");
    let d = w.deal();
    w.refuse(STRANGER, 0, "E_NOT_EXPIRED", |b| b.abort_close(d.seq));
    w.refuse(STRANGER, 0, "E_CLOSING", |b| b.expire_sale(d.seq));
    w.now = d.deadline_ms.0;
    let late = w.order();
    w.neutral(STRANGER, 0, |b| b.abort_close(d.seq));
    let o = &w.b.get_outcomes()[0];
    assert_eq!((o.status.as_str(), o.escrow_returned.0, o.generation_after), ("aborted", 100 * P, 1));
    assert_eq!(w.b.get_party(id(BUYER)).unwrap().escrow_return_claim.0, 100 * P);
    assert_eq!(w.b.get_control().owner, id(FOUNDER));
    w.refuse(CLOSER, 0, "E_NO_DEAL", |b| b.close_sale(late));
    // The seller's administration is open again.
    w.measured(FOUNDER, NEAR, |b| b.create_plan(plan_input(2 * P)));
}

#[test]
fn g10_away_and_back_through_two_actual_sales() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let first = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        funded_and_buyer_accepted(&mut w, first);
        let deal1 = w.deal();
        seller_completes(&mut w);
        // The buyer sells it back to the founder.
        let t = w.terms(FOUNDER, 90 * P, &[(METER, METERING)]);
        w.propose(BUYER, t);
        assert_eq!(w.fund(FOUNDER), 0);
        assert_eq!(w.accept(FOUNDER), "accepted");
        if is_gated(&w) {
            assert_eq!(w.accept(BUYER), "closing");
            let o = w.order();
            w.neutral(CLOSER, 0, |b| b.close_sale(o));
        } else {
            assert_eq!(w.accept(BUYER), "closed");
        }
        let c = w.b.get_control();
        assert_eq!((c.owner, c.generation, c.operators), (id(FOUNDER), 3, vec![(id(METER), METERING, 3)]));
        // Deal 1's acceptance can't be replayed; METER2 (generation 2) no longer meters.
        w.refuse(BUYER, 1, "E_NO_DEAL", |b| b.accept_sale(deal1.seq, deal1.version, deal1.digest.clone()));
        let k = key(1);
        let (a, s) = w.std_auth(CARA, &k, 3, 1);
        w.refuse(METER2, 0, "E_NOT_OPERATOR", |b| b.open_hold(id(CARA), 1, a.clone(), s.clone()));
        assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 1, a, s)), "opened");
        // Both outcomes recorded; each claim stays with its own beneficiary.
        let out = w.b.get_outcomes();
        assert_eq!(out.iter().map(|o| (o.seq.0, o.generation_after)).collect::<Vec<_>>(), vec![(2, 3), (1, 2)]);
        assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().sale_proceeds_claim.0, 100 * P);
        assert_eq!(w.b.get_party(id(BUYER)).unwrap().sale_proceeds_claim.0, 90 * P);
    }
}

#[test]
fn g11_customers_carry_on_during_a_deal_and_never_lower_available() {
    for make in MODES {
        let (mut w, k) = happy_in(make());
        let mut t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        t.available_floor = U128(20 * P);
        w.propose(FOUNDER, t);
        assert_eq!(w.accept(FOUNDER), "accepted");
        let digest = w.deal().digest;
        let control = w.b.control_seq;
        let mut available = w.t().available.0;
        let mut seen = |w: &W| {
            let a = w.t().available.0;
            assert!(a >= available, "available fell from {available} to {a}");
            available = a;
        };
        assert_eq!(w.buy(CARA, 10, 2, None), 0);
        seen(&w);
        let (s, p) = w.refund(CARA, 10);
        assert!(w.callback(s, p, true));
        seen(&w);
        w.open(CARA, &k, 3, 10);
        let u = w.uses(CARA, &k, 3, 0..3);
        w.settle(CARA, 3, u, false);
        seen(&w);
        w.call(METER, 0, |b| b.release_hold(id(CARA), 1, 3));
        seen(&w);
        // A customer re-registers mid-deal (all refunded first): the deal is unaffected.
        let free = w.ent(CARA).free.0;
        let (s, p) = w.refund(CARA, free);
        assert!(w.callback(s, p, true));
        w.call(CARA, 1, |b| b.unregister(id(CARA), 1));
        w.shell(CARA, CARA);
        assert_eq!(w.buy(CARA, 5, 1, Some((0, &k))), 0);
        seen(&w);
        assert_eq!(w.b.control_seq, control, "customer activity never changes control");
        assert_eq!(w.deal().digest, digest, "customers aren't part of the terms");
        assert_eq!(w.fund(BUYER), 0);
        if is_gated(&w) {
            assert_eq!(w.accept(BUYER), "closing");
            let o = w.order();
            w.neutral(CLOSER, 0, |b| b.close_sale(o));
        } else {
            assert_eq!(w.accept(BUYER), "closed");
        }
        assert_eq!(w.b.get_control().owner, id(BUYER));
    }
}

#[test]
fn g12_g13_the_floor_binds_the_seller_from_their_acceptance() {
    for make in MODES {
        // Draining first: neither party can accept below the floor.
        let (mut w, _) = happy_in(make());
        let mut t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        t.available_floor = U128(18 * P);
        w.propose(FOUNDER, t.clone());
        w.withdraw(FOUNDER, 3 * P); // only min_reserve applies before the seller accepts
        let d = w.deal();
        w.refuse(FOUNDER, 1, "E_FLOOR", |b| b.accept_sale(d.seq, d.version, d.digest.clone()));
        assert_eq!(w.fund(BUYER), 0);
        w.refuse(BUYER, 1, "E_FLOOR", |b| b.accept_sale(d.seq, d.version, d.digest.clone()));

        // Accepting first: withdrawals keep available at the floor, exactly.
        let (mut w, _) = happy_in(make());
        t.available_floor = U128(12 * P);
        t.expires_at_ms = U64(w.now + DAY);
        w.propose(FOUNDER, t.clone());
        assert_eq!(w.accept(FOUNDER), "accepted");
        w.refuse(FOUNDER, 1, "E_FLOOR", |b| b.withdraw_profit(U128(8 * P + 1)));
        w.withdraw(FOUNDER, 8 * P);
        assert_eq!(w.t().available.0, 12 * P);
        w.refuse(FOUNDER, 1, "E_FLOOR", |b| b.withdraw_profit(U128(1)));
        assert_eq!(w.fund(BUYER), 0);
        if is_gated(&w) {
            assert_eq!(w.accept(BUYER), "closing");
            w.refuse(FOUNDER, 1, "E_CLOSING", |b| b.withdraw_profit(U128(1)));
        }

        // The buyer accepting first commits the seller to nothing: only the reserve applies,
        // and the floor is checked again at the seller's acceptance.
        let (mut w, _) = happy_in(make());
        t.available_floor = U128(18 * P);
        t.expires_at_ms = U64(w.now + DAY);
        funded_and_buyer_accepted(&mut w, t.clone());
        w.withdraw(FOUNDER, 15 * P);
        let d = w.deal();
        w.refuse(FOUNDER, 1, "E_FLOOR", |b| b.accept_sale(d.seq, d.version, d.digest.clone()));
        assert_eq!(w.b.get_control().owner, id(FOUNDER));
    }
}

#[test]
fn g14_g15_no_administration_while_live_and_the_manifest_is_bound() {
    let (mut w, _) = happy_in(W::gated());
    // The manifest pointer: owner only, stale sequence refused.
    w.refuse(STRANGER, 1, "E_NOT_OWNER", |b| b.set_manifest("aa".repeat(32), U64(0)));
    w.refuse(FOUNDER, 1, "E_MANIFEST_SEQ", |b| b.set_manifest("aa".repeat(32), U64(1)));
    w.refuse(FOUNDER, 1, "E_ARGS", |b| b.set_manifest("zz".into(), U64(0)));
    w.neutral(FOUNDER, 1, |b| b.set_manifest("aa".repeat(32), U64(0)));
    let c = w.b.get_control();
    assert_eq!((c.service_manifest, c.manifest_seq.0), ("aa".repeat(32), 1));
    let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
    w.propose(FOUNDER, t);
    let digest = w.deal().digest;
    // While live: no plans, operators, manifest changes or second deal.
    w.refuse(FOUNDER, NEAR, "E_DEAL_PENDING", |b| b.create_plan(plan_input(2 * P)));
    w.refuse(FOUNDER, 1, "E_DEAL_PENDING", |b| b.appoint_operator(id(METER2), METERING));
    w.refuse(FOUNDER, 1, "E_DEAL_PENDING", |b| b.revoke_operator(id(METER)));
    w.refuse(FOUNDER, 1, "E_DEAL_PENDING", |b| b.set_manifest("bb".repeat(32), U64(1)));
    let other = w.terms(STRANGER, P, &[(METER2, METERING)]);
    w.refuse(FOUNDER, NEAR, "E_DEAL_PENDING", |b| b.propose_sale(other));
    assert_eq!(w.deal().digest, digest);
    // The digest binds the manifest: the same deal against another pointer is another digest.
    let mut slot = *w.b.deal.get(&0).unwrap();
    let mine = w.b.digest_of(&slot);
    slot.manifest = [0xbb; 32];
    assert_ne!(w.b.digest_of(&slot), mine);
    // Fault injected on purpose: the pointer changes behind the deal; the closer can't close.
    assert_eq!(w.fund(BUYER), 0);
    assert_eq!(w.accept(BUYER), "accepted");
    assert_eq!(w.accept(FOUNDER), "closing");
    let o = w.order();
    w.b.service_manifest = [0xbb; 32];
    w.refuse(CLOSER, 0, "E_MANIFEST", |b| b.close_sale(o.clone()));
    w.b.service_manifest = [0xaa; 32];
    w.neutral(CLOSER, 0, |b| b.close_sale(o));
}

#[test]
fn g17_storage_only_grows_for_a_missing_buyer_record() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        // A new buyer: measured growth, charged to the proposer, recorded as the payer.
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        let (_, grew) = w.measured(FOUNDER, NEAR, |b| b.propose_sale(t));
        assert!(grew > 0);
        let r = w.b.get_party(id(BUYER)).unwrap();
        assert_eq!((r.payer.clone(), r.deposit.0), (id(FOUNDER), grew as u128 * env::storage_byte_cost().as_yoctonear()));
        assert!(r.pinned);
        // Every transition after that is a same-size rewrite, including the close.
        let seq = w.deal().seq;
        w.neutral(FOUNDER, 1, |b| b.cancel_sale(seq));
        // A buyer that already has a record: only the intentional yoctoNEAR, no growth.
        w.refuse(FOUNDER, 0, "E_DEPOSIT", |b| b.propose_sale(w_terms_stub()));
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        w.neutral(FOUNDER, 1, |b| b.propose_sale(t));
        assert_eq!(w.fund(BUYER), 0);
        assert_eq!(w.accept(BUYER), "accepted");
        seller_completes(&mut w);
    }
}

#[test]
#[should_panic(expected = "E_STORAGE")]
fn g17b_an_underfunded_new_buyer_record_is_refused() {
    let (mut w, _) = happy();
    let t = w.terms(BUYER, 100 * P, &[]);
    w.env(FOUNDER, 1);
    w.b.propose_sale(t);
}

#[test]
fn g17c_64_character_accounts_and_operator_replacement_change_no_storage() {
    let closer = long('c');
    let (mut w, _) = happy_in(W::with_closer(Some(&closer)));
    let (buyer, seller2, op) = (long('b'), long('s'), long('m'));
    // Founder → a 64-character buyer, with a 64-character operator grant.
    let t = w.terms(&buyer, 100 * P, &[(op.as_str(), METERING), (METER2, SUPPORT)]);
    w.propose(FOUNDER, t);
    assert_eq!(w.fund(&buyer), 0);
    assert_eq!(w.accept(&buyer), "accepted");
    assert_eq!(w.accept(FOUNDER), "closing");
    let o = w.order();
    w.neutral(&closer, 0, |b| b.close_sale(o));
    assert_eq!(w.b.get_control().operators, vec![(id(&op), METERING, 2), (id(METER2), SUPPORT, 2)]);
    // That buyer → another 64-character account, replacing both operators with one short one.
    let t = w.terms(&seller2, 50 * P, &[(METER, METERING)]);
    w.propose(&buyer, t);
    assert_eq!(w.fund(&seller2), 0);
    assert_eq!(w.accept(&seller2), "accepted");
    assert_eq!(w.accept(&buyer), "closing");
    let o = w.order();
    w.neutral(&closer, 0, |b| b.close_sale(o));
    let c = w.b.get_control();
    assert_eq!((c.owner, c.generation, c.operators), (id(&seller2), 3, vec![(id(METER), METERING, 3)]));
    // The root record is the same size at every owner.
    w.flush();
    assert_eq!(borsh::to_vec(&w.b).unwrap().len(), 974);
}

#[test]
fn g18_the_outcome_ring_wraps_in_place() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let mut owner = FOUNDER.to_string();
        for i in 0..9u64 {
            let buyer = if owner == FOUNDER { BUYER } else { FOUNDER };
            let t = w.terms(buyer, (10 + i as u128) * P, &[(METER, METERING)]);
            w.propose(&owner, t);
            let seq = w.deal().seq;
            match i % 3 {
                0 => w.neutral(&owner, 1, |b| b.cancel_sale(seq)),
                1 => {
                    w.now += DAY;
                    w.neutral(STRANGER, 0, |b| b.expire_sale(seq));
                }
                _ => {
                    assert_eq!(w.fund(buyer), 0);
                    assert_eq!(w.accept(buyer), "accepted");
                    if is_gated(&w) {
                        assert_eq!(w.accept(&owner), "closing");
                        let o = w.order();
                        w.neutral(CLOSER, 0, |b| b.close_sale(o));
                    } else {
                        assert_eq!(w.accept(&owner), "closed");
                    }
                    owner = buyer.to_string();
                }
            }
        }
        let out = w.b.get_outcomes();
        assert_eq!(out.len(), 8);
        assert_eq!(out.iter().map(|o| o.seq.0).collect::<Vec<_>>(), (2..=9).rev().collect::<Vec<_>>());
        assert_eq!(out[0].status, "closed");
        assert_eq!(out[1].status, "expired");
    }
}

#[test]
fn g19_a_direct_close_is_one_atomic_call() {
    let (mut w, _) = happy();
    let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
    w.propose(FOUNDER, t);
    assert_eq!(w.accept(FOUNDER), "accepted"); // the seller first this time
    assert_eq!(w.fund(BUYER), 0);
    let before = (w.b.get_control(), w.t(), w.b.get_party(id(FOUNDER)).unwrap());
    assert_eq!((before.0.owner.clone(), before.0.generation, before.1.escrow_total.0), (id(FOUNDER), 1, 100 * P));
    assert_eq!(w.accept(BUYER), "closed");
    let c = w.b.get_control();
    assert_eq!((c.owner, c.generation, c.operators, c.live_deal), (id(BUYER), 2, vec![(id(METER2), METERING, 2)], None));
    assert_eq!(w.b.get_party(id(FOUNDER)).unwrap().sale_proceeds_claim.0, 100 * P);
    assert_eq!(w.t().escrow_total.0, 0);
}

#[test]
fn g20_expiry_and_generation() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        w.propose(FOUNDER, t);
        assert_eq!(w.fund(BUYER), 0);
        let d = w.deal();
        w.refuse(STRANGER, 0, "E_NOT_EXPIRED", |b| b.expire_sale(d.seq));
        w.now = d.expires_at_ms.0;
        w.refuse(BUYER, 1, "E_EXPIRED", |b| b.accept_sale(d.seq, d.version, d.digest.clone()));
        w.neutral(STRANGER, 0, |b| b.expire_sale(d.seq));
        let o = &w.b.get_outcomes()[0];
        assert_eq!((o.status.as_str(), o.escrow_returned.0), ("expired", 100 * P));
        assert_eq!(w.b.get_party(id(BUYER)).unwrap().escrow_return_claim.0, 100 * P);
        // Fault injected on purpose: a generation that moved under a live deal is refused.
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        w.propose(FOUNDER, t);
        let d = w.deal();
        w.b.generation += 1;
        w.corrupt = true;
        let before = w.snap();
        w.env(FOUNDER, 1);
        let msg = panic_message(|| w.b.accept_sale(d.seq, d.version, d.digest.clone()));
        assert!(msg.contains("E_GENERATION"), "{msg}");
        assert_eq!(w.snap(), before);
    }
}

#[test]
fn g21_live_deals_pin_their_records_and_deposits_go_back_to_who_paid() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        w.propose(FOUNDER, t);
        let seq = w.deal().seq;
        // Pinned while proposed, accepted, funded and (Gated) closing.
        w.refuse(BUYER, 1, "E_DEAL_PINNED", |b| b.release_party_slot());
        assert_eq!(w.accept(FOUNDER), "accepted");
        w.refuse(BUYER, 1, "E_DEAL_PINNED", |b| b.release_party_slot());
        // The buyer changes before any funding: the old buyer is unpinned, the new one pinned
        // (its record created at the seller's expense).
        let t2 = w.terms(STRANGER, 100 * P, &[(METER2, METERING)]);
        let (_, grew) = w.measured(FOUNDER, NEAR, |b| b.revise_sale(seq, t2));
        assert!(grew > 0);
        w.invariants();
        assert!(!w.b.get_party(id(BUYER)).unwrap().pinned);
        assert!(w.b.get_party(id(STRANGER)).unwrap().pinned);
        assert_eq!(w.b.get_party(id(STRANGER)).unwrap().payer, id(FOUNDER));
        // The old buyer releases its record; the deposit goes to whoever paid it (the founder).
        let deposit = w.b.get_party(id(BUYER)).unwrap().deposit.0;
        let (_, freed) = w.measured(BUYER, 1, |b| b.release_party_slot());
        assert!(freed < 0);
        w.invariants();
        assert!(w.b.get_party(id(BUYER)).is_none());
        let refund = near_sdk::test_utils::get_created_receipts();
        assert!(
            refund.iter().any(|r| r.receiver_id == id(FOUNDER)
                && r.actions.iter().any(|a| matches!(a, near_sdk::mock::MockAction::Transfer { deposit: d, .. } if d.as_yoctonear() == deposit))),
            "the deposit goes back to its payer"
        );
        assert_eq!(w.fund(STRANGER), 0);
        w.refuse(STRANGER, 1, "E_DEAL_PINNED", |b| b.release_party_slot());
        assert_eq!(w.accept(STRANGER), "accepted");
        if is_gated(&w) {
            // The revision cleared the seller's acceptance; accepting again starts the close.
            assert_eq!(w.accept(FOUNDER), "closing");
            w.refuse(STRANGER, 1, "E_DEAL_PINNED", |b| b.release_party_slot());
            let o = w.order();
            w.neutral(CLOSER, 0, |b| b.close_sale(o));
        } else {
            assert_eq!(w.accept(FOUNDER), "closed");
        }
        // After the close nothing is pinned: the former owner holds a claim, the new owner keeps
        // its record as owner.
        w.refuse(FOUNDER, 1, "E_CLAIM", |b| b.release_party_slot());
        w.refuse(STRANGER, 1, "E_OWNER", |b| b.release_party_slot());
    }
}

#[test]
fn control_sequence_rises_exactly_once_per_control_change() {
    for make in MODES {
        let (mut w, k) = happy_in(make());
        let mut last = w.b.control_seq;
        let mut step = |w: &W, by: u64, what: &str| {
            assert_eq!(w.b.control_seq, last + by, "{what}");
            last = w.b.control_seq;
        };
        step(&w, 0, "customers don't change control");
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        w.propose(FOUNDER, t);
        step(&w, 1, "propose");
        let d = w.deal();
        w.returned(BUYER, 1, fund_msg(d.seq.0, d.version, 1));
        step(&w, 0, "returned funding");
        assert_eq!(w.fund(BUYER), 0);
        step(&w, 1, "fund");
        w.neutral(BUYER, 1, |b| b.unfund_deal(d.seq));
        step(&w, 1, "unfund");
        assert_eq!(w.fund(BUYER), 0);
        step(&w, 1, "fund again");
        let mut t2 = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        t2.terms_hash = "33".repeat(32);
        w.neutral(FOUNDER, 1, |b| b.revise_sale(d.seq, t2));
        step(&w, 1, "revise");
        assert_eq!(w.accept(BUYER), "accepted");
        step(&w, 1, "accept");
        let digest = w_digest(&w);
        w.refuse(BUYER, 1, "E_ALREADY_ACCEPTED", |b| b.accept_sale(d.seq, 2, digest));
        step(&w, 0, "a refused call");
        w.open(CARA, &k, 3, 1);
        let (s, p) = w.refund(CARA, 1);
        assert!(w.callback(s, p, true));
        step(&w, 0, "customer activity and callbacks during a deal");
        if is_gated(&w) {
            assert_eq!(w.accept(FOUNDER), "closing");
            step(&w, 1, "the second acceptance, entering closing");
            assert_eq!(w.deal().closing_control_seq.0, w.b.control_seq, "closing binds the value after its rise");
            let o = w.order();
            w.neutral(CLOSER, 0, |b| b.close_sale(o));
            step(&w, 1, "close");
        } else {
            assert_eq!(w.accept(FOUNDER), "closed");
            step(&w, 1, "the second acceptance, closing directly");
        }
        assert_eq!(w.b.get_outcomes()[0].control_seq.0, w.b.control_seq);
        w.measured(BUYER, NEAR, |b| b.create_plan(plan_input(3 * P)));
        step(&w, 1, "create_plan");
        w.neutral(BUYER, 1, |b| b.appoint_operator(id(METER), METERING));
        step(&w, 1, "appoint");
        w.neutral(BUYER, 1, |b| b.revoke_operator(id(METER)));
        step(&w, 1, "revoke");
        w.neutral(BUYER, 1, |b| b.set_manifest("44".repeat(32), U64(0)));
        step(&w, 1, "set_manifest");
    }
}

fn w_digest(w: &W) -> String {
    w.deal().digest
}

#[test]
fn counters_and_deadlines_refuse_before_they_overflow() {
    let (mut w, _) = happy();
    let t = w.terms(BUYER, 100 * P, &[]);
    w.b.deal_seq = u64::MAX;
    w.refuse(FOUNDER, NEAR, "E_OVERFLOW: deal sequence", |b| b.propose_sale(t.clone()));
    w.b.deal_seq = 0;
    w.b.control_seq = u64::MAX;
    w.refuse(FOUNDER, NEAR, "E_OVERFLOW: control sequence", |b| b.propose_sale(t.clone()));
    w.refuse(FOUNDER, 1, "E_OVERFLOW: control sequence", |b| b.appoint_operator(id(METER2), METERING));
    w.b.control_seq = 2;
    w.b.manifest_seq = u64::MAX;
    w.refuse(FOUNDER, 1, "E_OVERFLOW: manifest sequence", |b| b.set_manifest("55".repeat(32), U64(u64::MAX)));
    w.b.manifest_seq = 0;
    w.propose(FOUNDER, t.clone());
    // Fault injected on purpose: a version at its limit can't be revised.
    let mut slot = *w.b.deal.get(&0).unwrap();
    slot.version = u32::MAX;
    w.b.deal.insert(0, slot);
    w.refuse(FOUNDER, NEAR, "E_OVERFLOW: deal version", |b| b.revise_sale(U64(1), t.clone()));
    slot.version = 1;
    w.b.deal.insert(0, slot);
    // A generation at its limit can't close: refused before anything changes.
    w.b.generation = u32::MAX;
    slot.expected_generation = u32::MAX;
    w.b.deal.insert(0, slot);
    assert_eq!(w.fund(BUYER), 0);
    assert_eq!(w.accept(BUYER), "accepted");
    let d = w.deal();
    w.refuse(FOUNDER, 1, "E_OVERFLOW: generation", |b| b.accept_sale(d.seq, d.version, d.digest.clone()));
}

#[test]
fn terms_are_validated_before_anything_changes() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let gated = is_gated(&w);
        let ok = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        let cases: Vec<(DealTermsInput, &str)> = vec![
            (DealTermsInput { buyer: id(FOUNDER), ..ok.clone() }, "E_ARGS: the buyer"),
            (DealTermsInput { buyer: id(BIZ), ..ok.clone() }, "E_ARGS: the buyer"),
            (DealTermsInput { buyer: id(TOKEN), ..ok.clone() }, "E_ARGS: the buyer"),
            (DealTermsInput { price: U128(0), ..ok.clone() }, "E_ARGS: the price"),
            (DealTermsInput { expires_at_ms: U64(w.now + MIN - 1), ..ok.clone() }, "E_ARGS: the offer"),
            (DealTermsInput { expires_at_ms: U64(w.now + 30 * DAY + 1), ..ok.clone() }, "E_ARGS: the offer"),
            (DealTermsInput { expires_at_ms: U64(u64::MAX), ..ok.clone() }, "E_ARGS: the offer"),
            (DealTermsInput { close_window_ms: U64(if gated { 0 } else { 30 * MIN }), ..ok.clone() }, "window"),
            (DealTermsInput { grants: vec![(id(METER2), 4)], ..ok.clone() }, "E_ARGS: capabilities"),
            (DealTermsInput { grants: vec![(id(METER2), 1), (id(METER2), 2)], ..ok.clone() }, "different account"),
            (
                DealTermsInput {
                    grants: vec![(id(METER), 1), (id(METER2), 1), (id(MORE[0]), 1), (id(MORE[1]), 1), (id(MORE[2]), 1)],
                    ..ok.clone()
                },
                "at most 4",
            ),
            (DealTermsInput { terms_hash: "abc".into(), ..ok.clone() }, "terms hash"),
        ];
        for (t, code) in cases {
            w.refuse(FOUNDER, NEAR, code, |b| b.propose_sale(t));
        }
        if gated {
            w.refuse(FOUNDER, NEAR, "E_ARGS: the buyer", |b| b.propose_sale(DealTermsInput { buyer: id(CLOSER), ..ok.clone() }));
            w.refuse(FOUNDER, NEAR, "successor METERING", |b| {
                b.propose_sale(DealTermsInput { grants: vec![(id(METER2), SUPPORT)], ..ok.clone() })
            });
            w.refuse(FOUNDER, NEAR, "window", |b| b.propose_sale(DealTermsInput { close_window_ms: U64(DAY + 1), ..ok.clone() }));
        }
        w.propose(FOUNDER, ok);
    }
}

#[test]
fn escrow_returns_keep_their_category_through_failure_and_stranded_retry() {
    for make in MODES {
        let (mut w, _) = happy_in(make());
        let t = w.terms(BUYER, 100 * P, &[(METER2, METERING)]);
        w.propose(FOUNDER, t);
        assert_eq!(w.fund(BUYER), 0);
        let seq = w.deal().seq;
        w.neutral(BUYER, 1, |b| b.cancel_sale(seq));
        assert_eq!(w.b.get_outcomes()[0].status, "cancelled");
        // Collect: the payout is an escrow return; it fails and comes back to that same claim.
        w.call(BUYER, 1, |b| drop(b.claim_party(CLAIM_ESCROW_RETURN)));
        let p = w.b.get_pending();
        assert_eq!(p[0].kind, "escrow_return");
        let (s, pid) = w.last_payout();
        assert!(!w.callback(s, pid, false));
        let r = w.b.get_party(id(BUYER)).unwrap();
        assert_eq!((r.escrow_return_claim.0, r.profit_claim.0), (100 * P, 0));
        // Fault injected on purpose: the record vanishes while the retry is in flight; it
        // strands, is re-sent detached, and is still booked as an escrow return.
        w.call(BUYER, 1, |b| drop(b.claim_party(CLAIM_ESCROW_RETURN)));
        let (s, pid) = w.last_payout();
        w.corrupt = true;
        w.b.party.remove(&id(BUYER));
        assert!(!w.callback(s, pid, false));
        w.call(BUYER, 1, |b| drop(b.claim_stranded(s)));
        let (s, pid) = w.last_payout();
        assert!(w.callback(s, pid, true));
        let m = rec(&w, 202611);
        assert_eq!(
            (n(&m.escrow_returned), n(&m.paid_on_retry), n(&m.owner_withdrawals), n(&m.sale_proceeds_paid)),
            (100 * P, 100 * P, 0, 0)
        );
        assert_eq!(w.t().claims_total.0, 0);
    }
}

#[test]
fn g22_random_sequences_interleave_deals_with_customers_and_payouts() {
    let parties = [FOUNDER, BUYER, STRANGER];
    let mut totals = [0usize; 16];
    let mut closes = 0usize;
    for make in MODES {
        for seed in [0xA076_1D64_78BD_642Fu64, 0xE703_7ED1_A0B4_28DB, 0x8EBC_6AF0_9C88_C6E3] {
            let (mut w, _) = happy_in(make());
            // Every party gets a record first (a proposal, then cancelled), so later proposals
            // allocate nothing and run through the same no-growth check as everything else.
            for p in [BUYER, STRANGER] {
                let t = w.terms(p, P, &[(METER, METERING)]);
                w.propose(FOUNDER, t);
                let s = w.deal().seq;
                w.neutral(FOUNDER, 1, |b| b.cancel_sale(s));
            }
            let mut r = Rng(seed);
            for _ in 0..400 {
                let c = w.b.get_control();
                let owner = c.owner.to_string();
                let live = c.live_deal;
                let generation = c.generation;
                let op = r.below(16) as usize;
                let done = match op {
                    0 => {
                        let others: Vec<&str> = parties.iter().copied().filter(|p| *p != owner).collect();
                        let buyer = others[r.below(others.len() as u64) as usize];
                        let mut t = w.terms(buyer, (1 + r.below(30) as u128) * P, &[(METER, METERING)]);
                        t.available_floor = U128(r.below(2) as u128 * 5 * P);
                        t.expires_at_ms = U64(w.now + (30 + r.below(600)) * MIN);
                        w.attempt(&owner, 1, None, |b| b.propose_sale(t))
                    }
                    1 => {
                        let Some(d) = live else { continue };
                        let off = u128::from(r.below(5) == 0);
                        let before = w.snap();
                        let back = w.ft(d.buyer.as_ref(), d.price.0 + off, fund_msg(d.seq.0, d.version, d.price.0));
                        assert!(back == 0 || (back == d.price.0 + off && w.snap() == before));
                        back == 0
                    }
                    2 => {
                        let Some(d) = live else { continue };
                        w.attempt(d.buyer.as_ref(), 1, None, |b| b.unfund_deal(d.seq))
                    }
                    3 | 4 => {
                        let Some(d) = live else { continue };
                        // Mostly the party that hasn't accepted yet; sometimes either (refused).
                        let pick_buyer = match (d.seller_accepted, d.buyer_accepted) {
                            (true, false) => r.below(4) != 0,
                            (false, true) => r.below(4) == 0,
                            _ => r.below(2) != 0,
                        };
                        let who = if pick_buyer { d.buyer.to_string() } else { d.seller.to_string() };
                        let version = if r.below(8) == 0 { d.version + 1 } else { d.version };
                        w.attempt(&who, 1, None, |b| b.accept_sale(d.seq, version, d.digest.clone()))
                    }
                    5 => {
                        let Some(d) = live else { continue };
                        if r.below(3) != 0 {
                            continue;
                        }
                        let price = if r.below(2) == 0 { d.price.0 } else { (1 + r.below(30) as u128) * P };
                        let mut t = w.terms(d.buyer.as_ref(), price, &[(METER, METERING)]);
                        t.expires_at_ms = d.expires_at_ms;
                        if t.expires_at_ms.0 < w.now + MIN {
                            t.expires_at_ms = U64(w.now + 10 * MIN);
                        }
                        w.attempt(&owner, 1, None, |b| b.revise_sale(d.seq, t))
                    }
                    6 => {
                        let Some(d) = live else { continue };
                        if r.below(3) != 0 {
                            continue;
                        }
                        let who = parties[r.below(3) as usize];
                        w.attempt(who, 1, None, |b| b.cancel_sale(d.seq))
                    }
                    7 => {
                        let Some(d) = live else { continue };
                        w.attempt(STRANGER, 0, None, |b| b.expire_sale(d.seq))
                    }
                    8 => {
                        if live.is_none() || !is_gated(&w) {
                            continue;
                        }
                        let mut o = w.order();
                        if r.below(6) == 0 {
                            o.issued_at_ms = U64(w.now + 1);
                        }
                        let ok = w.attempt(CLOSER, 0, None, |b| b.close_sale(o));
                        if ok {
                            assert_eq!(w.b.generation, generation + 1);
                        }
                        ok
                    }
                    9 => {
                        let Some(d) = live else { continue };
                        w.attempt(STRANGER, 0, None, |b| b.abort_close(d.seq))
                    }
                    10 => {
                        let who = parties[r.below(3) as usize];
                        let cat = r.below(3) as u8;
                        w.attempt(who, 1, None, |b| b.claim_party(cat))
                    }
                    11 => {
                        let amount = 1 + r.below(4) as u128 * P;
                        w.attempt(&owner, 1, None, |b| b.withdraw_profit(U128(amount)))
                    }
                    12 => {
                        let e = *w.b.entitlements.get(&(id(CARA), 1)).unwrap();
                        let units = 1 + r.below(5) as u32;
                        w.ft(CARA, units as u128 * P, buy_msg(1, units, e.purchase_seq + 1, None)) == 0
                    }
                    13 => {
                        let units = 1 + r.below(5);
                        w.attempt(CARA, 1, None, |b| b.refund_units(1, U64(units)))
                    }
                    14 => {
                        let p = w.b.get_pending();
                        if p.is_empty() {
                            continue;
                        }
                        let pick = &p[r.below(p.len() as u64) as usize];
                        let (slot, pid, ok) = (pick.slot, pick.payout_id.0, r.below(3) != 0);
                        w.attempt(BIZ, 0, Some(ok), |b| b.on_payout(slot, U64(pid)))
                    }
                    _ => {
                        w.now += [MIN, 5 * MIN, 31 * MIN, 3 * 60 * MIN][r.below(4) as usize];
                        true
                    }
                };
                if done {
                    totals[op] += 1;
                    if w.b.generation > generation {
                        closes += 1;
                    }
                }
            }
        }
    }
    println!("deal random successes by operation: {totals:?}; closes {closes}");
    for op in [0, 1, 2, 3, 6, 7, 10, 11, 12, 13, 14] {
        assert!(totals[op] >= 3, "operation {op} succeeded only {} times: {totals:?}", totals[op]);
    }
    assert!(totals[3] + totals[4] >= 10 && totals[8] >= 2 && totals[9] >= 1 && closes >= 6, "{totals:?}; closes {closes}");
}

/// Valid-looking terms for refusal tests that never get as far as validating them.
fn w_terms_stub() -> DealTermsInput {
    DealTermsInput {
        buyer: id(STRANGER),
        price: U128(P),
        expires_at_ms: U64(T0 + DAY),
        close_window_ms: U64(0),
        available_floor: U128(0),
        grants: vec![],
        terms_hash: "11".repeat(32),
    }
}

// =====================================================================================
// 003h: the views' actual JSON, committed as server fixtures. The server's v3 decoder is
// tested against exactly these bytes. Synthetic only: this changes no contract behaviour.
// Regenerate with UPDATE_V3_FIXTURES=1; otherwise the committed files must match.
// =====================================================================================

/// One token unit at 18 decimals: amounts here are far above 2^53.
const E18: u128 = 1_000_000_000_000_000_000;

/// A business with a plan at 1e18 a unit: 100 units bought, 10 used and earned.
fn fixture_world(make: fn() -> W) -> W {
    let mut w = make();
    w.measured(FOUNDER, NEAR, |b| b.create_plan(plan_input(E18)));
    w.measured(CARA, NEAR, |b| b.sponsor_shell(id(CARA), 2));
    let k = key(1);
    assert_eq!(w.ft(CARA, 100 * E18, buy_msg(2, 100, 1, Some((0, &k, 30)))), 0);
    let reg = w.b.get_entitlement(id(CARA), 2).unwrap().reg_id.0;
    let (a, s) = auth_on(2, CARA, &k, reg, 1, 10, w.now + 20 * MIN, 0, 1);
    assert_eq!(w.call(METER, 0, |b| b.open_hold(id(CARA), 2, a, s)), "opened");
    let uses: Vec<UseInput> = (0..10).map(|i| use_on(2, CARA, &k, reg, 0, 1, 1, i, fp(1, i, 0))).collect();
    all(&w.call(METER, 0, |b| b.settle_hold(id(CARA), 2, 1, uses, true)), "charged", 10);
    // An owner payout in flight, so the pending list isn't empty.
    w.withdraw(FOUNDER, E18);
    w
}

/// Each view's JSON exactly as the contract returns it (serde_json of the view value).
fn views_json(w: &W) -> String {
    let raw = |v: String| serde_json::Value::String(v);
    let out = serde_json::json!({
        "get_control": raw(serde_json::to_string(&w.b.get_control()).unwrap()),
        "get_outcomes": raw(serde_json::to_string(&w.b.get_outcomes()).unwrap()),
        "get_treasury": raw(serde_json::to_string(&w.b.get_treasury()).unwrap()),
        "get_pending": raw(serde_json::to_string(&w.b.get_pending()).unwrap()),
        "get_period:202611": raw(serde_json::to_string(&w.b.get_period(202611)).unwrap()),
    });
    serde_json::to_string_pretty(&out).unwrap() + "\n"
}

fn fixture(name: &str, committed: &str, actual: String) {
    if std::env::var("UPDATE_V3_FIXTURES").is_ok() {
        let path = format!("{}/../../server/test/fixtures/v3/{name}.json", env!("CARGO_MANIFEST_DIR"));
        std::fs::write(&path, &actual).unwrap();
        return;
    }
    assert_eq!(committed.replace("\r\n", "\n"), actual, "{name}: the committed server fixture is out of date");
}

#[test]
fn serialized_views_match_server_fixtures() {
    // Direct, the seller has accepted and the buyer has funded (not yet accepted).
    let mut w = fixture_world(W::new);
    let mut t = w.terms(BUYER, 300 * E18, &[(METER2, METERING)]);
    t.available_floor = U128(2 * E18);
    w.propose(FOUNDER, t);
    assert_eq!(w.fund(BUYER), 0);
    assert_eq!(w.accept(FOUNDER), "accepted");
    fixture("direct-accepting", include_str!("../../../server/test/fixtures/v3/direct-accepting.json"), views_json(&w));
    // The buyer accepts: closed in the same call.
    assert_eq!(w.accept(BUYER), "closed");
    fixture("direct-closed", include_str!("../../../server/test/fixtures/v3/direct-closed.json"), views_json(&w));
    // Gated: both accepted, closing until the closer finalizes.
    let mut g = fixture_world(W::gated);
    let t = g.terms(BUYER, 300 * E18, &[(METER2, METERING)]);
    g.propose(FOUNDER, t);
    assert_eq!(g.fund(BUYER), 0);
    assert_eq!(g.accept(BUYER), "accepted");
    assert_eq!(g.accept(FOUNDER), "closing");
    fixture("gated-closing", include_str!("../../../server/test/fixtures/v3/gated-closing.json"), views_json(&g));
    // Job 003k1: the configured closer finalizes with the exact order: closed, generation 2.
    let o = g.order();
    g.neutral(CLOSER, 0, |b| b.close_sale(o));
    let c = g.b.get_control();
    assert_eq!((c.owner, c.generation, c.live_deal.is_none()), (id(BUYER), 2, true));
    fixture("gated-closed", include_str!("../../../server/test/fixtures/v3/gated-closed.json"), views_json(&g));
}
