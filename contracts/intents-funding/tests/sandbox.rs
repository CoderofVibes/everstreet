//! A buyer funds a sale's escrow with a different test token, through NEAR's intents verifier, on
//! a real local NEAR node. The verifier is NEAR's own contract built from its published source
//! (github.com/near/intents, MIT); Everstreet acts as the solver and is labelled as one. Our
//! business contract is unchanged: the buyer withdraws the swapped tUSD to their own account and
//! funds the deal with the existing `fund_deal` transfer, so the deal is funded only when the
//! business contract says so.
//!
//! States: quote → deposited → swapped (inside the verifier) → delivered (tUSD in the buyer's own
//! account) → funded (the business contract confirms). Failures: underpaid, expired quote, only
//! one side signed, wrong verifier, a forged signer, replay, a lost response (recovered from the
//! verifier's nonce record) and a refund of an unswapped deposit.
//!
//! Run in WSL from `contracts/`, after building the verifier (see docs/INTENTS.md):
//!   VERIFIER_WASM=$HOME/vendor/near-intents/target/near/defuse/defuse.wasm \
//!   CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p intents-funding --test sandbox -- --nocapture

#![allow(unused_must_use)]

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine as _;
use near_api::signer::NEP413Payload;
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{AccountId, Contract, NearGas, NearToken, NetworkConfig, PublicKey, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

const NAMES: [&str; 9] = [
    "verifier", "tusd", "talt", "biz", "platform", "mara", "noah", "solver", "fees",
];
const D: u128 = 1_000_000;
const PRICE: u128 = 200 * D;

struct World {
    _sandbox: Sandbox,
    net: NetworkConfig,
    signers: HashMap<&'static str, Arc<Signer>>,
    public_keys: HashMap<&'static str, String>,
    counter: std::sync::atomic::AtomicU8,
}

fn id(n: &str) -> AccountId {
    n.parse().unwrap()
}

fn build(manifest: &str) -> Vec<u8> {
    let path = cargo_near_build::build_with_cli(cargo_near_build::BuildOpts {
        manifest_path: Some(format!("{}/../{manifest}", env!("CARGO_MANIFEST_DIR")).into()),
        no_abi: true,
        ..Default::default()
    })
    .expect("wasm build");
    std::fs::read(path).expect("wasm read")
}

fn verifier_wasm() -> Vec<u8> {
    let path = std::env::var("VERIFIER_WASM").unwrap_or_else(|_| {
        format!(
            "{}/vendor/near-intents/target/near/defuse/defuse.wasm",
            std::env::var("HOME").unwrap()
        )
    });
    std::fs::read(&path).unwrap_or_else(|e| panic!("verifier wasm at {path}: {e} (see docs/INTENTS.md)"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// RFC 3339 in UTC with milliseconds, as the verifier parses deadlines.
fn rfc3339(ms: i64) -> String {
    let (secs, milli) = (ms.div_euclid(1000), ms.rem_euclid(1000));
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{milli:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

fn n(v: &Value) -> u128 {
    v.as_str()
        .unwrap_or_else(|| panic!("not a number string: {v}"))
        .parse()
        .unwrap()
}

/// A versioned nonce: magic prefix, version 0, the salt, the deadline in nanoseconds, 15 bytes.
fn nonce_bytes(salt_hex: &str, deadline_ms: i64, fill: u8) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[..4].copy_from_slice(&[0x56, 0x28, 0xf6, 0xc6]);
    out[4] = 0;
    for i in 0..4 {
        out[5 + i] = u8::from_str_radix(&salt_hex[2 * i..2 * i + 2], 16).unwrap();
    }
    out[9..17].copy_from_slice(&(deadline_ms * 1_000_000).to_le_bytes());
    out[17..].copy_from_slice(&[fill; 15]);
    out
}

/// A swap's two sides, as signed token diffs (positive: received; negative: given).
fn diff(talt: i128, tusd: i128) -> Value {
    json!([{ "intent": "token_diff", "diff": {
        "nep141:talt": talt.to_string(), "nep141:tusd": tusd.to_string()
    } }])
}

impl World {
    async fn start() -> Self {
        let accounts: Vec<GenesisAccount> = NAMES
            .iter()
            .map(|n| GenesisAccount::generate_with_name(id(n)))
            .collect();
        // The verifier needs host functions newer than the crate's default node (2.13.4); NEAR's
        // own verifier tests run 2.14.0.
        let sandbox = Sandbox::start_sandbox_with_config_and_version(
            SandboxConfig {
                additional_accounts: accounts.clone(),
                ..Default::default()
            },
            "2.14.0",
        )
        .await
        .expect("sandbox");
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse().unwrap());
        let signers = NAMES
            .iter()
            .zip(&accounts)
            .map(|(n, a)| (*n, Signer::from_secret_key(a.private_key.parse().unwrap()).unwrap()))
            .collect();
        let public_keys = NAMES
            .iter()
            .zip(&accounts)
            .map(|(n, a)| (*n, a.public_key.clone()))
            .collect();
        Self {
            _sandbox: sandbox,
            net,
            signers,
            public_keys,
            counter: std::sync::atomic::AtomicU8::new(1),
        }
    }

    async fn send(&self, who: &'static str, contract: &str, method: &str, args: Value, deposit: NearToken) -> ExecutionFinalResult {
        Contract(id(contract))
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(250))
            .deposit(deposit)
            .with_signer(id(who), self.signers[who].clone())
            .send_to(&self.net)
            .await
            .expect("rpc")
            .into_full()
            .expect("final result")
    }

    async fn ok(&self, who: &'static str, contract: &str, method: &str, args: Value, deposit: NearToken) -> ExecutionFinalResult {
        let r = self.send(who, contract, method, args, deposit).await;
        assert!(!r.is_failure(), "{method} as {who}: {r:?}");
        r
    }

    /// The failure text, or panic if it succeeded.
    async fn refused(&self, who: &'static str, contract: &str, method: &str, args: Value) -> String {
        let r = self.send(who, contract, method, args, NearToken::from_yoctonear(0)).await;
        assert!(r.is_failure(), "{method} as {who} was not refused: {:?}", r.logs());
        format!("{r:?}")
    }

    async fn view(&self, contract: &str, method: &str, args: Value) -> Value {
        Contract(id(contract))
            .call_function(method, args)
            .read_only::<Value>()
            .fetch_from(&self.net)
            .await
            .expect("view")
            .data
    }

    async fn deploy(&self, who: &'static str, code: Vec<u8>, args: Value) {
        Contract::deploy(id(who))
            .use_code(code)
            .with_init_call("new", args)
            .unwrap()
            .with_signer(self.signers[who].clone())
            .send_to(&self.net)
            .await
            .unwrap()
            .assert_success();
    }

    async fn token(&self, token: &str, who: &str) -> u128 {
        n(&self.view(token, "ft_balance_of", json!({ "account_id": who })).await)
    }

    /// `who`'s balance of `token` held inside the verifier.
    async fn inside(&self, token: &str, who: &str) -> u128 {
        n(&self
            .view("verifier", "mt_balance_of", json!({ "account_id": who, "token_id": format!("nep141:{token}") }))
            .await)
    }

    /// A versioned nonce: magic prefix, version 0, the verifier's current salt, the deadline in
    /// nanoseconds, and 15 unique bytes.
    async fn nonce(&self, deadline_ms: i64) -> [u8; 32] {
        let salt = self.view("verifier", "current_salt", json!({})).await;
        let c = self.counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        nonce_bytes(salt.as_str().unwrap(), deadline_ms, c)
    }

    /// `key_of` signs, as `signer_id`, the intents for `recipient` (NEP-413), as a wallet's
    /// `signMessage` would.
    async fn sign(&self, signer_id: &str, key_of: &'static str, recipient: &str, intents: Value, deadline_ms: i64) -> (Value, [u8; 32]) {
        let nonce = self.nonce(deadline_ms).await;
        let message = json!({ "signer_id": signer_id, "deadline": rfc3339(deadline_ms), "intents": intents }).to_string();
        let payload = NEP413Payload { message: message.clone(), nonce, recipient: recipient.into(), callback_url: None };
        let pk: PublicKey = self.public_keys[key_of].parse().unwrap();
        let sig = self.signers[key_of]
            .sign_message_nep413(id(signer_id), pk, &payload)
            .await
            .expect("sign");
        let signed = json!({
            "standard": "nep413",
            "payload": { "message": message, "nonce": base64::engine::general_purpose::STANDARD.encode(nonce), "recipient": recipient },
            "public_key": self.public_keys[key_of],
            "signature": sig.to_string(),
        });
        (signed, nonce)
    }

    /// The buyer's and the solver's sides of one quote: `give` tALT for `get` tUSD.
    async fn quote(&self, give: u128, get: u128, deadline_ms: i64) -> (Value, Value, [u8; 32]) {
        let (buyer, nonce) = self.sign("noah", "noah", "verifier", diff(-(give as i128), get as i128), deadline_ms).await;
        let (solver, _) = self.sign("solver", "solver", "verifier", diff(give as i128, -(get as i128)), deadline_ms).await;
        (buyer, solver, nonce)
    }

    async fn balances(&self) -> [u128; 4] {
        [
            self.inside("talt", "noah").await,
            self.inside("tusd", "noah").await,
            self.inside("talt", "solver").await,
            self.inside("tusd", "solver").await,
        ]
    }
}

#[tokio::test]
async fn a_buyer_funds_escrow_with_another_token_through_the_verifier() {
    let (business, token, verifier) = (
        build("business-v3/Cargo.toml"),
        build("test-token/Cargo.toml"),
        verifier_wasm(),
    );
    let w = World::start().await;
    w.deploy("tusd", token.clone(), json!({ "owner_id": "platform", "total_supply": (1_000_000 * D).to_string(), "symbol": "tUSD" })).await;
    w.deploy("talt", token, json!({ "owner_id": "platform", "total_supply": (1_000_000 * D).to_string(), "symbol": "tALT" })).await;
    w.deploy(
        "verifier",
        verifier,
        json!({ "config": { "wnear_id": "wnear", "fees": { "fee": 0, "fee_collector": "fees" }, "roles": {} } }),
    )
    .await;
    let rules = json!({ "min_reserve": "0", "max_hold_units": 4, "max_hold_ttl_ms": "600000", "max_settle_grace_ms": "600000" });
    w.deploy("biz", business, json!({ "name": "biz", "owner": "mara", "asset": "tusd", "rules": rules, "closer": null })).await;
    for (t, who) in [
        ("tusd", "biz"), ("tusd", "verifier"), ("tusd", "mara"), ("tusd", "noah"), ("tusd", "solver"),
        ("talt", "verifier"), ("talt", "noah"), ("talt", "solver"),
    ] {
        w.ok("platform", t, "storage_deposit", json!({ "account_id": who }), NearToken::from_millinear(10)).await;
    }
    w.ok("platform", "talt", "ft_transfer", json!({ "receiver_id": "noah", "amount": (300 * D).to_string() }), NearToken::from_yoctonear(1)).await;
    w.ok("platform", "tusd", "ft_transfer", json!({ "receiver_id": "solver", "amount": (500 * D).to_string() }), NearToken::from_yoctonear(1)).await;

    // The seller proposes a Direct sale to the buyer at 200 tUSD. The buyer holds no tUSD.
    let terms = json!({ "terms": { "buyer": "noah", "price": PRICE.to_string(), "expires_at_ms": (now_ms() + 3_600_000).to_string(), "close_window_ms": "0", "available_floor": "0", "grants": [], "terms_hash": "1".repeat(64) } });
    w.ok("mara", "biz", "propose_sale", terms, NearToken::from_millinear(100)).await;
    let deal = w.view("biz", "get_control", json!({})).await["live_deal"].clone();
    assert_eq!(w.token("tusd", "noah").await, 0);

    // Both sides register the key they sign with (the buyer's is their own account key).
    for who in ["noah", "solver"] {
        w.ok(who, "verifier", "add_public_key", json!({ "public_key": w.public_keys[who] }), NearToken::from_yoctonear(1)).await;
    }
    // The solver's tUSD sits in the verifier, ready to fill quotes.
    w.ok("solver", "tusd", "ft_transfer_call", json!({ "receiver_id": "verifier", "amount": (500 * D).to_string(), "msg": "" }), NearToken::from_yoctonear(1)).await;

    // Deposited, but short of the quote: 150 tALT for a 200 tALT quote.
    w.ok("noah", "talt", "ft_transfer_call", json!({ "receiver_id": "verifier", "amount": (150 * D).to_string(), "msg": "" }), NearToken::from_yoctonear(1)).await;
    assert_eq!(w.inside("talt", "noah").await, 150 * D);
    let later = now_ms() + 120_000;

    // Underpaid: refused, nothing moves.
    let before = w.balances().await;
    let (b, s, _) = w.quote(200 * D, PRICE, later).await;
    let e = w.refused("solver", "verifier", "execute_intents", json!({ "signed": [b, s] })).await;
    assert!(e.contains("insufficient balance"), "{e}");
    assert_eq!(w.balances().await, before, "underpaid moved funds");
    println!("  underpaid quote: refused, nothing moved");

    w.ok("noah", "talt", "ft_transfer_call", json!({ "receiver_id": "verifier", "amount": (50 * D).to_string(), "msg": "" }), NearToken::from_yoctonear(1)).await;
    let before = w.balances().await;
    assert_eq!(before, [200 * D, 0, 0, 500 * D]);

    // Expired quote.
    let (b, s, _) = w.quote(200 * D, PRICE, now_ms() - 1_000).await;
    let e = w.refused("solver", "verifier", "execute_intents", json!({ "signed": [b, s] })).await;
    assert!(e.contains("expired"), "{e}");
    println!("  expired quote: refused");

    // Only one side signed: the diffs don't balance, the verifier refuses the whole batch.
    let (b, _, _) = w.quote(200 * D, PRICE, later).await;
    let e = w.refused("solver", "verifier", "execute_intents", json!({ "signed": [b] })).await;
    assert!(e.contains("invariant") || e.contains("Invariant"), "{e}");
    println!("  one side only: refused");

    // Signed for a different verifier.
    let (b, _) = w.sign("noah", "noah", "elsewhere", diff(-(200 * D as i128), PRICE as i128), later).await;
    let (_, s, _) = w.quote(200 * D, PRICE, later).await;
    let e = w.refused("solver", "verifier", "execute_intents", json!({ "signed": [b, s] })).await;
    assert!(e.contains("wrong verifying_contract"), "{e}");
    println!("  signed for another verifier: refused");

    // The solver forges the buyer's side with the solver's own key.
    let (forged, _) = w.sign("noah", "solver", "verifier", diff(-(200 * D as i128), 1), later).await;
    let (s, _) = w.sign("solver", "solver", "verifier", diff(200 * D as i128, -1), later).await;
    let e = w.refused("solver", "verifier", "execute_intents", json!({ "signed": [forged, s] })).await;
    assert!(e.contains("doesn't exist for account 'noah'"), "{e}");
    println!("  solver signs as the buyer: refused");

    // The solver can't withdraw the buyer's deposit.
    let e = w
        .send("solver", "verifier", "ft_withdraw", json!({ "token": "talt", "receiver_id": "solver", "amount": (200 * D).to_string() }), NearToken::from_yoctonear(1))
        .await;
    assert!(e.is_failure(), "the solver withdrew tALT it never held");
    assert_eq!(w.balances().await, before, "a refused step moved funds");
    println!("  solver withdraws the buyer's deposit: refused");

    // Refunded: an extra, unswapped deposit goes back to the buyer.
    w.ok("noah", "talt", "ft_transfer_call", json!({ "receiver_id": "verifier", "amount": (20 * D).to_string(), "msg": "" }), NearToken::from_yoctonear(1)).await;
    let held = w.token("talt", "noah").await;
    w.ok("noah", "verifier", "ft_withdraw", json!({ "token": "talt", "receiver_id": "noah", "amount": (20 * D).to_string() }), NearToken::from_yoctonear(1)).await;
    assert_eq!(w.token("talt", "noah").await, held + 20 * D);
    println!("  refund of an unswapped deposit: back in the buyer's account");

    // The quote is checked before it is sent.
    let (b, s, nonce) = w.quote(200 * D, PRICE, later).await;
    let sim = w.view("verifier", "simulate_intents", json!({ "signed": [b.clone(), s.clone()] })).await;
    assert!(sim.get("invariant_violated").is_none(), "simulation: {sim}");
    let nonce_b64 = base64::engine::general_purpose::STANDARD.encode(nonce);
    assert_eq!(w.view("verifier", "is_nonce_used", json!({ "account_id": "noah", "nonce": nonce_b64 })).await, json!(false));

    // Swapped, atomically.
    w.ok("solver", "verifier", "execute_intents", json!({ "signed": [b.clone(), s.clone()] }), NearToken::from_yoctonear(0)).await;
    assert_eq!(w.balances().await, [0, PRICE, 200 * D, 500 * D - PRICE]);
    println!("  swapped: 200 tALT for 200 tUSD inside the verifier");

    // Lost response: the buyer's nonce is spent, so the swap is known to have happened.
    assert_eq!(w.view("verifier", "is_nonce_used", json!({ "account_id": "noah", "nonce": nonce_b64 })).await, json!(true));
    let e = w.refused("solver", "verifier", "execute_intents", json!({ "signed": [b, s] })).await;
    assert!(e.contains("nonce was already used"), "{e}");
    println!("  lost response: recovered from the spent nonce; replay refused");

    // Delivered: in the buyer's own account, not yet the deal's.
    w.ok("noah", "verifier", "ft_withdraw", json!({ "token": "tusd", "receiver_id": "noah", "amount": PRICE.to_string() }), NearToken::from_yoctonear(1)).await;
    assert_eq!(w.token("tusd", "noah").await, PRICE);
    let now = w.view("biz", "get_control", json!({})).await["live_deal"].clone();
    assert_eq!(n(&now["escrow"]), 0, "delivered is not funded");
    println!("  delivered: 200 tUSD in the buyer's account; escrow 0");

    // Funded: only when the business contract confirms.
    let fund = json!({ "fund_deal": { "deal_seq": deal["seq"], "version": deal["version"], "price": PRICE.to_string() } });
    let r = w.ok("noah", "tusd", "ft_transfer_call", json!({ "receiver_id": "biz", "amount": PRICE.to_string(), "msg": fund.to_string() }), NearToken::from_yoctonear(1)).await;
    assert!(r.logs().join("\n").contains("sale_funded"), "{:?}", r.logs());
    let now = w.view("biz", "get_control", json!({})).await["live_deal"].clone();
    assert_eq!(n(&now["escrow"]), PRICE);
    println!("  funded: the business contract holds 200 tUSD in escrow");
}

#[test]
fn deadlines_are_rfc3339() {
    assert_eq!(rfc3339(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(rfc3339(1_794_000_000_123), "2026-11-06T21:20:00.123Z");
}

/// The app builds the same nonce and NEP-413 hash as NEAR's own tooling (server/test/
/// intents-funding.test.ts checks the same vector against server/src/identity.ts).
#[test]
fn the_app_signs_the_same_bytes() {
    let message = r#"{"signer_id":"noah","deadline":"2026-11-06T21:20:00.123Z","intents":[{"intent":"token_diff","diff":{"nep141:talt":"-200000000","nep141:tusd":"200000000"}}]}"#;
    let nonce = nonce_bytes("a1b2c3d4", 1_794_000_000_123, 7);
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    assert_eq!(hex(&nonce), "5628f6c600a1b2c3d4c0d461be7e91e518070707070707070707070707070707");
    let hash = |callback_url: Option<String>| {
        let p = NEP413Payload { message: message.into(), nonce, recipient: "verifier".into(), callback_url };
        hex(&p.compute_hash().unwrap().0)
    };
    assert_eq!(hash(None), "cbc20abc4d73b60d276e52b50ced5f17b4fa27cf58e42b9ba7773a2451028532");
    assert_eq!(
        hash(Some("http://localhost/sales/x".into())),
        "c77270fa16d21ec2b56b9986bfb4a16c4ddaf3d9e46e5fb4fc2b2e5f7a1cd856"
    );
}
