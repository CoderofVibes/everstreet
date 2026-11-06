// Second wave (included from attack_tests.rs).

#[test]
#[should_panic(expected = "E_DAILY_CAP")]
fn operator_exceeds_a_keys_daily_cap() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let k2 = key(2);
    set(&cust(), 1, T0);
    b.install_key(1, 1, pk_hex(&k2), 10, 5); // slot 1, epoch 1, 5 units a day
    let e = ent(&b, &cust());
    let m = hold_message(&biz(), 1, &cust(), e.reg_id.0, 1, 1, 1, 5, T0 + 120_000);
    let auth = HoldAuth { hold_seq: 1, units: 5, serve_until_ms: U64(T0 + 120_000), key_slot: 1, key_epoch: 1 };
    set(&op(), 0, T0);
    assert_eq!(b.open_hold(cust(), 1, auth, sign(&k2, &m)), "opened");
    set(&op(), 0, T0);
    b.release_hold(cust(), 1, 1);
    let m = hold_message(&biz(), 1, &cust(), e.reg_id.0, 1, 1, 2, 1, T0 + 120_000);
    let auth = HoldAuth { hold_seq: 2, units: 1, serve_until_ms: U64(T0 + 120_000), key_slot: 1, key_epoch: 1 };
    set(&op(), 0, T0 + 1_000);
    b.open_hold(cust(), 1, auth, sign(&k2, &m));
}

#[test]
#[should_panic(expected = "E_TTL")]
fn hold_past_the_plan_ttl_is_refused() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + HOUR + 1, 1);
    set(&op(), 0, T0);
    b.open_hold(cust(), 1, auth, sig);
}

#[test]
#[should_panic(expected = "E_EXPIRED")]
fn hold_ending_too_soon_is_refused() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + 59_999, 1);
    set(&op(), 0, T0);
    b.open_hold(cust(), 1, auth, sig);
}

#[test]
#[should_panic(expected = "E_REGISTRATION")]
fn release_for_the_wrong_registration_is_refused() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    set(&op(), 0, T0);
    b.release_hold_for(cust(), 1, U64(999), hs);
}

#[test]
#[should_panic(expected = "E_EXPIRED")]
fn settle_after_the_grace_deadline_is_refused() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    let u = use_input(&b, &cust(), &k, hs, 0, [7u8; 32], 1);
    set(&op(), 0, T0 + 120_000 + 600_001);
    b.settle_hold(cust(), 1, hs, vec![u], false);
}

#[test]
fn closer_cannot_replay_an_old_orders_digest_on_a_new_deal() {
    let mut b = gated_closing();
    let old = close_order(&b, T0 + 1_000);
    set(&mallory(), 0, T0 + 600_000);
    b.abort_close(U64(1));
    // Deal 2, same terms, both accept, closing.
    let t = T0 + 700_000;
    set(&owner(), ONE_NEAR, t);
    let seq = b.propose_sale(terms(buyer(), 5_000, 500, vec![(op2(), METERING)], t, 600_000)).0;
    assert_eq!(seq, 2);
    assert_eq!(fund(&mut b, &buyer(), seq, 1, 5_000, t), 0);
    let d = digest(&b);
    set(&buyer(), 1, t);
    b.accept_sale(U64(seq), 1, d.clone());
    set(&owner(), 1, t);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "closing");
    // The old order names deal 1: no such live deal.
    set(&closer(), 0, t + 1_000);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.close_sale(old.clone()))).is_err());
    // A new order carrying the old digest or the old closing sequence: refused.
    let mut mixed = close_order(&b, t + 500);
    mixed.digest = old.digest.clone();
    set(&closer(), 0, t + 1_000);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.close_sale(mixed))).is_err());
    let mut mixed = close_order(&b, t + 500);
    mixed.closing_control_seq = old.closing_control_seq;
    set(&closer(), 0, t + 1_000);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.close_sale(mixed))).is_err());
    assert_eq!(b.get_control().owner, owner());
    // The right order closes.
    let good = close_order(&b, t + 500);
    set(&closer(), 0, t + 1_000);
    b.close_sale(good);
    assert_eq!(b.get_control().owner, buyer());
}

#[test]
#[should_panic(expected = "E_ISSUED_BEFORE")]
fn close_order_issued_before_closing_started_is_refused() {
    let mut b = gated_closing();
    let order = close_order(&b, T0 - 1);
    set(&closer(), 0, T0 + 1_000);
    b.close_sale(order);
}

#[test]
#[should_panic(expected = "E_ISSUE_AGE")]
fn stale_close_order_is_refused() {
    let mut b = new_business(Some(closer()), 0);
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), 5_000, 0, vec![(op2(), METERING)], T0, DAY)).0;
    assert_eq!(fund(&mut b, &buyer(), seq, 1, 5_000, T0), 0);
    let d = digest(&b);
    set(&buyer(), 1, T0);
    b.accept_sale(U64(seq), 1, d.clone());
    set(&owner(), 1, T0);
    b.accept_sale(U64(seq), 1, d);
    let order = close_order(&b, T0 + 1_000);
    set(&closer(), 0, T0 + 1_000 + MAX_ISSUE_AGE_MS + 1);
    b.close_sale(order);
}

#[test]
#[should_panic(expected = "E_DEAL_PINNED")]
fn buyer_cannot_release_its_record_during_the_deal() {
    let mut b = new_business(None, 0);
    proposed_and_funded(&mut b, 5_000, 0);
    set(&buyer(), 1, T0);
    b.release_party_slot();
}

#[test]
#[should_panic(expected = "E_CLAIM")]
fn buyer_cannot_release_its_record_with_escrow_owed() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    set(&buyer(), 1, T0);
    b.cancel_sale(U64(seq));
    set(&buyer(), 1, T0);
    b.release_party_slot();
}

#[test]
#[should_panic(expected = "E_OWNER")]
fn owner_cannot_release_its_own_record() {
    let mut b = new_business(None, 0);
    set(&owner(), 1, T0);
    b.release_party_slot();
}

#[test]
#[should_panic(expected = "E_NOT_PARTY")]
fn outsider_cannot_accept_a_sale() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    let d = digest(&b);
    set(&mallory(), 1, T0);
    b.accept_sale(U64(seq), 1, d);
}

#[test]
#[should_panic(expected = "E_NOT_OWNER")]
fn buyer_cannot_revise_the_terms() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    set(&buyer(), 1, T0);
    b.revise_sale(U64(seq), terms(buyer(), 1, 0, vec![], T0, 0));
}

#[test]
fn funding_after_expiry_is_returned() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), 5_000, 0, vec![], T0, 0)).0;
    assert_eq!(fund(&mut b, &buyer(), seq, 1, 5_000, T0 + DAY), 5_000);
    assert_eq!(b.get_treasury().held.0, 0);
}

#[test]
fn funding_twice_is_returned() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    assert_eq!(fund(&mut b, &buyer(), seq, 1, 5_000, T0), 5_000);
    assert_eq!(b.get_treasury().escrow_total.0, 5_000);
}

#[test]
#[should_panic(expected = "E_ARGS")]
fn direct_mode_terms_with_a_close_window_are_refused() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    b.propose_sale(terms(buyer(), 5_000, 0, vec![], T0, 600_000));
}

#[test]
#[should_panic(expected = "E_ARGS")]
fn gated_terms_without_a_metering_grant_are_refused() {
    let mut b = new_business(Some(closer()), 0);
    set(&owner(), ONE_NEAR, T0);
    b.propose_sale(terms(buyer(), 5_000, 0, vec![(support(), SUPPORT)], T0, 600_000));
}

#[test]
#[should_panic(expected = "E_ARGS")]
fn the_closer_cannot_be_the_buyer() {
    let mut b = new_business(Some(closer()), 0);
    set(&owner(), ONE_NEAR, T0);
    b.propose_sale(terms(closer(), 5_000, 0, vec![(op2(), METERING)], T0, 600_000));
}

#[test]
#[should_panic(expected = "E_ARGS")]
fn the_seller_cannot_be_the_buyer() {
    let mut b = new_business(None, 0);
    set(&owner(), ONE_NEAR, T0);
    b.propose_sale(terms(owner(), 5_000, 0, vec![], T0, 0));
}

/// NOTE: the seller may name itself in the grants. The buyer accepts a digest that covers the
/// grants, so this is consent, but a client must show the grants or the buyer keeps the seller
/// as a METERING operator without knowing.
#[test]
fn note_seller_names_itself_as_successor_operator() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    set(&owner(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(buyer(), 5_000, 0, vec![(owner(), METERING)], T0, 0)).0;
    assert_eq!(fund(&mut b, &buyer(), seq, 1, 5_000, T0), 0);
    // A digest computed for the same terms without the grant is not the live digest.
    let without = {
        let mut t = b.deal_slot();
        t.grants = [GrantSlot::empty(); MAX_GRANTS];
        hex::encode(b.digest_of(&t))
    };
    set(&buyer(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.accept_sale(U64(seq), 1, without))).is_err(), "E_TERMS");
    let d = digest(&b);
    set(&buyer(), 1, T0);
    b.accept_sale(U64(seq), 1, d.clone());
    set(&owner(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "closed");
    assert_eq!(b.get_control().operators, vec![(owner(), METERING, 2)]);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + 120_000, 1);
    set(&owner(), 0, T0);
    assert_eq!(b.open_hold(cust(), 1, auth, sig), "opened", "the former owner still meters, as agreed");
}

/// NOTE: after a second sale, the middle owner's record was paid for by the first seller; its
/// release refunds the first seller, not the middle owner.
#[test]
fn note_second_sale_record_release_refunds_the_original_payer() {
    let mut b = new_business(None, 0);
    closed_sale(&mut b, 5_000, 0); // A -> B (buyer)
    let p = party(&b, &buyer());
    assert_eq!(p.payer, owner());
    assert!(p.deposit.0 > 0);
    // B sells to C.
    let c = a("carol.test.near");
    set(&buyer(), ONE_NEAR, T0);
    let seq = b.propose_sale(terms(c.clone(), 7_000, 0, vec![], T0, 0)).0;
    assert_eq!(fund(&mut b, &c, seq, 1, 7_000, T0), 0);
    let d = digest(&b);
    set(&c, 1, T0);
    b.accept_sale(U64(seq), 1, d.clone());
    set(&buyer(), 1, T0);
    assert_eq!(b.accept_sale(U64(seq), 1, d), "closed");
    assert_eq!(b.get_control().owner, c);
    assert_eq!(b.get_control().generation, 3);
    assert_eq!(party(&b, &buyer()).sale_proceeds_claim.0, 7_000);
    assert_eq!(party(&b, &owner()).sale_proceeds_claim.0, 5_000, "the first seller's claim is untouched");
    // B collects, then releases: the deposit goes to A (payer), by design.
    set(&buyer(), 1, T0);
    b.claim_party(CLAIM_SALE_PROCEEDS);
    let pend = pending(&b);
    set_callback(true, T0);
    assert!(b.on_payout(pend[0].slot, pend[0].payout_id));
    set(&buyer(), 1, T0);
    b.release_party_slot();
    assert!(b.get_party(buyer()).is_none());
    // A is still the first seller: a former owner can't act for C's business.
    set(&owner(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.withdraw_profit(U128(1)))).is_err());
    set(&buyer(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.withdraw_profit(U128(1)))).is_err());
}

#[test]
fn unregister_refunds_exactly_the_measured_deposit_to_the_payer() {
    let mut b = new_business(None, 0);
    set(&mallory(), ONE_NEAR, T0);
    b.sponsor_shell(cust(), 1);
    let paid = ent(&b, &cust()).storage_paid.0;
    assert!(paid > 0 && paid < ONE_NEAR / 100);
    // The customer unregisters: the refund goes to the sponsor, not the customer.
    set(&cust(), 1, T0);
    b.unregister(cust(), 1);
    let receipts = near_sdk::test_utils::get_created_receipts();
    let s = format!("{receipts:?}");
    assert!(s.contains("mallory.test.near"), "refund receipt names the sponsor: {s}");
    assert!(s.contains(&paid.to_string()), "refund is the measured deposit: {s}");
}

#[test]
fn operator_release_before_deadline_returns_units_to_the_customer() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let hs = open(&mut b, &cust(), &k, 5, T0);
    let u = use_input(&b, &cust(), &k, hs, 0, [7u8; 32], 1);
    set(&op(), 0, T0);
    b.settle_hold(cust(), 1, hs, vec![u], false);
    set(&op(), 0, T0);
    b.release_hold(cust(), 1, hs);
    let e = ent(&b, &cust());
    assert_eq!(e.free.0, 99);
    assert_eq!(e.consumed.0, 1);
    assert!(!e.hold_active);
    assert_eq!(b.get_treasury().available.0, PRICE);
}

#[test]
#[should_panic(expected = "E_HOLD_SEQ")]
fn skipped_hold_sequence_kills_the_signed_auth() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + 120_000, 1);
    set(&cust(), 1, T0);
    b.skip_hold_seq(1);
    set(&op(), 0, T0);
    b.open_hold(cust(), 1, auth, sig);
}

#[test]
#[should_panic(expected = "E_PAUSED")]
fn paused_customer_gets_no_new_hold() {
    let mut b = new_business(None, 0);
    let k = key(1);
    customer(&mut b, &cust(), 100, &k);
    let (auth, sig) = hold_auth(&b, &cust(), &k, 1, 5, T0 + 120_000, 1);
    set(&cust(), 1, T0);
    b.set_paused(1, true);
    set(&op(), 0, T0);
    b.open_hold(cust(), 1, auth, sig);
}

#[test]
fn purchase_with_wrong_amount_or_sequence_is_returned() {
    let mut b = new_business(None, 0);
    set(&cust(), ONE_NEAR, T0);
    b.sponsor_shell(cust(), 1);
    // Sequence 2 before 1.
    assert_eq!(buy(&mut b, &cust(), 1, 2, None, T0), PRICE);
    // Amount not units * price.
    let msg = serde_json::json!({ "buy": { "plan_id": 1, "units": 2, "purchase_seq": 1 } });
    set(&token(), 0, T0);
    match b.ft_on_transfer(cust(), U128(PRICE), msg.to_string()) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, PRICE),
        _ => panic!(),
    }
    // Over the purchase cap.
    assert_eq!(buy(&mut b, &cust(), 101, 1, None, T0), 101 * PRICE);
    assert_eq!(b.get_treasury().held.0, 0);
    // Then a correct one, and a replay of it.
    assert_eq!(buy(&mut b, &cust(), 1, 1, None, T0), 0);
    assert_eq!(buy(&mut b, &cust(), 1, 1, None, T0), PRICE);
    assert_eq!(ent(&b, &cust()).free.0, 1);
}

#[test]
fn party_record_cannot_be_released_with_a_payout_in_flight() {
    let mut b = new_business(None, 0);
    let seq = proposed_and_funded(&mut b, 5_000, 0);
    set(&buyer(), 1, T0);
    b.cancel_sale(U64(seq));
    set(&buyer(), 1, T0);
    b.claim_party(CLAIM_ESCROW_RETURN);
    set(&buyer(), 1, T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| b.release_party_slot())).is_err(), "E_PENDING_REFS");
    let p = pending(&b);
    set_callback(true, T0);
    assert!(b.on_payout(p[0].slot, p[0].payout_id));
    set(&buyer(), 1, T0);
    b.release_party_slot();
    assert!(b.get_party(buyer()).is_none());
    assert_eq!(b.get_treasury().held.0, 0);
}
