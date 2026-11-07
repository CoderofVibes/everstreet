//! Attack review of 2026-11-07 (reports/2026-11-07_attack-review.md): the reviewer's tests, written
//! against a test-stripped copy and kept here as regression tests. A `*_finding_*` test shows an
//! attack succeeding until its fix lands; every other test shows the contract refusing one.
//! `#[private]` on the callbacks is wrapper-enforced (verified in near-sdk-macros' snapshots), so the
//! tests call the callback bodies with simulated promise results.

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};
use std::panic::{catch_unwind, AssertUnwindSafe};

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const REGISTRY: &str = "0x1111111111111111111111111111111111111111";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn me() -> AccountId {
    acc("asset.test.near")
}
fn business() -> AccountId {
    acc("biz.test.near")
}
fn signer() -> AccountId {
    acc("signer.test.near")
}
fn seller() -> AccountId {
    acc("founder.test.near")
}
fn buyer() -> AccountId {
    acc("buyer.test.near")
}

fn env(pred: &AccountId, deposit: u128, results: Vec<PromiseResult>) {
    let ctx = VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}

fn new() -> AssetKey {
    env(&seller(), 0, vec![]);
    AssetKey::new(business(), signer(), U64(11155111), REGISTRY.into(), U64(200_000), U128(100_000_000_000))
}

fn view(owner: &AccountId, generation: u32) -> PromiseResult {
    // The business's real get_control answer has many more fields; the companion must ignore them.
    PromiseResult::Successful(
        serde_json::json!({
            "owner": owner, "generation": generation, "control_seq": "7", "close_mode": "direct", "closer": null,
            "service_manifest": "00".repeat(32), "manifest_seq": "0", "operators": [], "live_deal": null
        })
        .to_string()
        .into_bytes(),
    )
}

fn tx(nonce: u64) -> TxParams {
    TxParams { nonce: U64(nonce), gas_limit: U64(100_000), max_fee_per_gas: U128(50_000_000_000), max_priority_fee_per_gas: U128(1_000_000_000) }
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

/// Every function call created, as (receiver, method, args json, deposit).
fn calls() -> Vec<(String, String, serde_json::Value, u128)> {
    let mut out = vec![];
    for r in get_created_receipts() {
        for a in &r.actions {
            if let MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } = a {
                out.push((
                    r.receiver_id.to_string(),
                    String::from_utf8(method_name.clone()).unwrap(),
                    serde_json::from_slice(args).unwrap_or(serde_json::Value::Null),
                    attached_deposit.as_yoctonear(),
                ));
            }
        }
    }
    out
}

fn transfers() -> Vec<(String, u128)> {
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

fn sign_calls() -> Vec<serde_json::Value> {
    calls().into_iter().filter(|c| c.1 == "sign").map(|c| c.2).collect()
}

// -------------------------------------------------------------------------------------

#[test]
fn k01_anyone_can_ask_but_only_the_owner_gets_a_signature() {
    let mut a = new();
    let mallory = acc("mallory.test.near");
    env(&mallory, ONE_NEAR, vec![]);
    a.request(Action::Publish { digest: "aa".repeat(32) }, tx(0));
    let c = calls();
    assert_eq!(c[0].0, business().to_string());
    assert_eq!(c[0].1, "get_control");
    assert_eq!(c[1].1, "on_control");
    // The business answers: the owner is the founder, not mallory.
    env(&me(), 0, vec![view(&seller(), 1)]);
    let r = a.on_control(mallory.clone(), NearToken::from_yoctonear(ONE_NEAR), Action::Publish { digest: "aa".repeat(32) }, tx(0), Ok(ControlView { owner: seller(), generation: 1, control_seq: U64(7) }));
    assert!(matches!(r, near_sdk::PromiseOrValue::Value(v) if v["refused"] == "E_NOT_OWNER"));
    assert!(sign_calls().is_empty());
    assert_eq!(transfers(), vec![(mallory.to_string(), ONE_NEAR)]);
    assert!(get_logs().iter().any(|l| l.contains("asset_refused")));
}

#[test]
fn k02_former_owner_is_refused_once_the_view_says_so() {
    let mut a = new();
    // After the close the business answers owner = buyer, generation 2.
    env(&me(), 0, vec![view(&buyer(), 2)]);
    for action in [Action::Publish { digest: "aa".repeat(32) }, Action::SetController { to: "0x".to_string() + &"22".repeat(20), from_generation: 1 }] {
        let r = a.on_control(seller(), NearToken::from_yoctonear(1), action, tx(0), Ok(ControlView { owner: buyer(), generation: 2, control_seq: U64(7) }));
        assert!(matches!(r, near_sdk::PromiseOrValue::Value(v) if v["refused"] == "E_NOT_OWNER"));
    }
    assert!(sign_calls().is_empty());
    // The buyer takes the role from the seller's generation-1 address without the seller.
    env(&me(), 0, vec![view(&buyer(), 2)]);
    a.on_control(buyer(), NearToken::from_yoctonear(1), Action::SetController { to: "0x".to_string() + &"22".repeat(20), from_generation: 1 }, tx(0), Ok(ControlView { owner: buyer(), generation: 2, control_seq: U64(7) }));
    let s = sign_calls();
    assert_eq!(s.len(), 1);
    assert_eq!(s[0]["request"]["path"], "gen-1");
    // And publishes from its own generation-2 address.
    env(&me(), 0, vec![view(&buyer(), 2)]);
    a.on_control(buyer(), NearToken::from_yoctonear(1), Action::Publish { digest: "aa".repeat(32) }, tx(0), Ok(ControlView { owner: buyer(), generation: 2, control_seq: U64(7) }));
    assert_eq!(sign_calls()[0]["request"]["path"], "gen-2");
}

#[test]
fn k03_finding_owner_can_hand_the_registry_to_any_address_and_stockpile_nonces() {
    // The seller, while still owner, gets setController(<its own EOA>) signed from the gen-1 address
    // for several future nonces. Nothing binds `to` to a business address or `nonce` to the chain.
    let mut a = new();
    let evil = "0x".to_string() + &"de".repeat(20);
    for nonce in [5u64, 6, 7, 1_000_000] {
        env(&me(), 0, vec![view(&seller(), 1)]);
        let r = a.on_control(seller(), NearToken::from_yoctonear(1), Action::SetController { to: evil.clone(), from_generation: 1 }, tx(nonce), Ok(ControlView { owner: seller(), generation: 1, control_seq: U64(7) }));
        assert!(matches!(r, near_sdk::PromiseOrValue::Promise(_)), "signed");
        drop(r); // near-sdk schedules a Promise when it is dropped or returned
        let s = sign_calls();
        assert_eq!(s.len(), 1, "one sign request per call");
        assert_eq!(s[0]["request"]["path"], "gen-1");
        let unsigned = unsigned_tx(11155111, &hex_bytes::<20>(REGISTRY, "r"), &tx(nonce), &call_data(&Action::SetController { to: evil.clone(), from_generation: 1 }));
        assert_eq!(s[0]["request"]["payload_v2"]["Ecdsa"], hex::encode(env::keccak256(&unsigned)));
        // The calldata really names the attacker's address.
        assert!(hex::encode(&unsigned).contains(&"de".repeat(20)));
    }
    assert_eq!(a.signed, 4);
}

#[test]
fn k04_finding_the_callback_trusts_the_view_it_is_handed() {
    // Between the business's `get_control` receipt and this callback a close can land. The callback
    // has only the (now stale) view, so it signs for the former owner. Unit tests cannot move the
    // chain; this shows there is no second check.
    let mut a = new();
    env(&me(), 0, vec![view(&seller(), 1)]);
    let r = a.on_control(seller(), NearToken::from_yoctonear(1), Action::Publish { digest: "bb".repeat(32) }, tx(3), Ok(ControlView { owner: seller(), generation: 1, control_seq: U64(7) }));
    assert!(matches!(r, near_sdk::PromiseOrValue::Promise(_)));
    drop(r);
    assert_eq!(sign_calls()[0]["request"]["path"], "gen-1");
}

#[test]
fn k05_generation_bounds_and_publish_always_from_the_current_generation() {
    let mut a = new();
    env(&me(), 0, vec![view(&buyer(), 2)]);
    let r = a.on_control(buyer(), NearToken::from_yoctonear(1), Action::SetController { to: "0x".to_string() + &"22".repeat(20), from_generation: 3 }, tx(0), Ok(ControlView { owner: buyer(), generation: 2, control_seq: U64(7) }));
    assert!(matches!(r, near_sdk::PromiseOrValue::Value(v) if v["refused"] == "E_GENERATION"));
    env(&me(), 0, vec![view(&buyer(), 2)]);
    let r = a.on_control(buyer(), NearToken::from_yoctonear(1), Action::SetController { to: "0x".to_string() + &"22".repeat(20), from_generation: 0 }, tx(0), Ok(ControlView { owner: buyer(), generation: 2, control_seq: U64(7) }));
    assert!(matches!(r, near_sdk::PromiseOrValue::Value(v) if v["refused"] == "E_GENERATION"));
    assert!(sign_calls().is_empty());
}

#[test]
fn k06_caller_cannot_smuggle_calldata_destination_chain_or_path() {
    let mut a = new();
    // Malformed fields are refused in `request`, before any cross-contract call.
    env(&seller(), 1, vec![]);
    expect_refused("E_INPUT", || a.request(Action::Publish { digest: "aa".repeat(31) }, tx(0)));
    expect_refused("E_INPUT", || a.request(Action::Publish { digest: "aa".repeat(33) }, tx(0)));
    expect_refused("E_INPUT", || a.request(Action::Publish { digest: "zz".repeat(32) }, tx(0)));
    expect_refused("E_INPUT", || a.request(Action::SetController { to: "0x".to_string() + &"22".repeat(19), from_generation: 1 }, tx(0)));
    expect_refused("E_INPUT", || a.request(Action::SetController { to: "0x".to_string() + &"22".repeat(32), from_generation: 1 }, tx(0)));
    assert!(calls().is_empty());
    // Gas and fee caps, and the deposit.
    let mut t = tx(0);
    t.gas_limit = U64(200_001);
    expect_refused("E_GAS", || a.request(Action::Publish { digest: "aa".repeat(32) }, t.clone()));
    t.gas_limit = U64(0);
    expect_refused("E_GAS", || a.request(Action::Publish { digest: "aa".repeat(32) }, t.clone()));
    let mut t = tx(0);
    t.max_fee_per_gas = U128(100_000_000_001);
    expect_refused("E_FEE", || a.request(Action::Publish { digest: "aa".repeat(32) }, t.clone()));
    let mut t = tx(0);
    t.max_priority_fee_per_gas = U128(t.max_fee_per_gas.0 + 1);
    expect_refused("E_FEE", || a.request(Action::Publish { digest: "aa".repeat(32) }, t.clone()));
    env(&seller(), 0, vec![]);
    expect_refused("E_DEPOSIT", || a.request(Action::Publish { digest: "aa".repeat(32) }, tx(0)));
    // The transaction the contract hashes is exactly the typed one: a hand-assembled vector.
    let registry = [0x11u8; 20];
    let t = TxParams { nonce: U64(1), gas_limit: U64(4), max_fee_per_gas: U128(3), max_priority_fee_per_gas: U128(2) };
    let data = [0xaa, 0xbb, 0xcc, 0xdd];
    let got = unsigned_tx(1, &registry, &t, &data);
    let mut want = vec![0x02, 0xe1, 0x01, 0x01, 0x02, 0x03, 0x04, 0x94];
    want.extend_from_slice(&registry);
    want.extend_from_slice(&[0x80, 0x84, 0xaa, 0xbb, 0xcc, 0xdd, 0xc0]);
    assert_eq!(got, want);
    // Zero nonce and zero fees encode as empty strings (0x80), never as 0x00.
    let t0 = TxParams { nonce: U64(0), gas_limit: U64(1), max_fee_per_gas: U128(0), max_priority_fee_per_gas: U128(0) };
    let got0 = unsigned_tx(1, &registry, &t0, &[]);
    assert_eq!(&got0[..7], &[0x02, 0xc0 + 1 + 1 + 1 + 1 + 1 + 21 + 1 + 1 + 1, 0x01, 0x80, 0x80, 0x80, 0x01]);
    // Calldata: fixed selectors, exact widths.
    let cd = call_data(&Action::Publish { digest: "aa".repeat(32) });
    assert_eq!(cd.len(), 36);
    assert_eq!(&cd[..4], &env::keccak256(b"publish(bytes32)")[..4]);
    let cd = call_data(&Action::SetController { to: "0x".to_string() + &"22".repeat(20), from_generation: 1 });
    assert_eq!(cd.len(), 36);
    assert_eq!(&cd[..4], &env::keccak256(b"setController(address)")[..4]);
    assert_eq!(&cd[4..16], &[0u8; 12]);
    // The sign request carries only the hash, the generation path and domain 0.
    env(&me(), 0, vec![view(&seller(), 1)]);
    a.on_control(seller(), NearToken::from_yoctonear(1), Action::Publish { digest: "aa".repeat(32) }, tx(0), Ok(ControlView { owner: seller(), generation: 1, control_seq: U64(7) }));
    let s = &sign_calls()[0]["request"];
    assert_eq!(s["domain_id"], 0);
    assert_eq!(s["path"], "gen-1");
    assert_eq!(s.as_object().unwrap().len(), 3);
}

#[test]
fn k07_unreadable_business_refunds_and_signs_nothing() {
    let mut a = new();
    env(&me(), 0, vec![PromiseResult::Failed]);
    let r = a.on_control(seller(), NearToken::from_yoctonear(ONE_NEAR), Action::Publish { digest: "aa".repeat(32) }, tx(0), Err(PromiseError::Failed));
    assert!(matches!(r, near_sdk::PromiseOrValue::Value(v) if v["refused"] == "E_CONTROL_UNREAD"));
    assert!(sign_calls().is_empty());
    assert_eq!(transfers(), vec![(seller().to_string(), ONE_NEAR)]);
}

#[test]
fn k08_finding_a_failed_signature_keeps_the_deposit_in_the_companion() {
    // on_control forwards the whole deposit to the signer. If the signer's receipt fails, the
    // protocol refunds that deposit to the predecessor of the sign receipt (this contract), and
    // on_signed panics without sending anything back to the caller. No method can pay it out.
    let mut a = new();
    env(&me(), 0, vec![view(&seller(), 1)]);
    a.on_control(seller(), NearToken::from_yoctonear(ONE_NEAR), Action::Publish { digest: "aa".repeat(32) }, tx(0), Ok(ControlView { owner: seller(), generation: 1, control_seq: U64(7) }));
    let c = calls();
    let sign = c.iter().find(|c| c.1 == "sign").unwrap();
    assert_eq!(sign.3, ONE_NEAR, "the whole deposit rides on the sign call");
    env(&me(), 0, vec![PromiseResult::Failed]);
    expect_refused("E_SIGN", || a.on_signed(1, "00".repeat(32), "0x02".into(), Err(PromiseError::Failed)));
    assert!(transfers().is_empty(), "no refund to the caller");
}

#[test]
fn k09_signer_answer_is_passed_through_with_what_was_signed() {
    let mut a = new();
    env(&me(), 0, vec![PromiseResult::Successful(b"{}".to_vec())]);
    let v = a.on_signed(1, "ab".repeat(32), "0x02".into(), Ok(serde_json::json!({"big_r": {"affine_point": "02aa"}, "s": {"scalar": "bb"}, "recovery_id": 0})));
    assert_eq!(v["path"], "gen-1");
    assert_eq!(v["payload"], "ab".repeat(32));
}
