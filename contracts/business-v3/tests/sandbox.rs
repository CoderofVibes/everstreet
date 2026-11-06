//! v3 on a real local NEAR node (near-sandbox), with the real test token. Attack review note 8:
//! the payout callback (`on_payout`) is the one place a payout could stay stuck, if it ran out of
//! gas. The unit-test host doesn't meter gas, so this file measures it on the real runtime and
//! breaks the payout paths on purpose:
//!
//! - every payout kind, succeeding and failing (a receiver the token refuses), with the gas each
//!   callback burned printed and checked against `CALLBACK_GAS`;
//! - a refund sent with every amount of attached gas from too little to plenty: each attempt
//!   either fails whole (nothing changed) or completes (paid, or a claim); none stays in flight;
//! - a customer's refund still in flight while the sale closes: it lands with the customer, and
//!   the new owner can't touch it;
//! - after every step, the token balance the business really has equals what its books hold.
//!
//! Run in WSL from `contracts/` (downloads the sandbox node once):
//!   CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --test sandbox -- --nocapture

// `ok` already checks success; most steps don't need the receipts it returns.
#![allow(unused_must_use)]

use std::collections::HashMap;
use std::sync::Arc;

use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{Account, AccountId, Chain, Contract, NearGas, NearToken, NetworkConfig, Reference, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

const NAMES: [&str; 7] = ["biz", "tusd", "platform", "mara", "cara", "dan", "noah"];
const D: u128 = 1_000_000; // six decimals
const PRICE: u128 = 2 * D; // one unit
/// Must match `CALLBACK_GAS` in src/lib.rs.
const CALLBACK_TGAS: u64 = 10;

struct World {
    _sandbox: Sandbox,
    net: NetworkConfig,
    signers: HashMap<&'static str, Arc<Signer>>,
    public_keys: HashMap<&'static str, String>,
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

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()
}

fn n(v: &Value) -> u128 {
    v.as_str().unwrap_or_else(|| panic!("not a number string: {v}")).parse().unwrap()
}

/// What one payout's callback did, read from the receipts.
#[derive(Debug)]
struct Payout {
    callback_tgas: f64,
    transfer_tgas: f64,
    ok: bool,
}

impl World {
    async fn start() -> Self {
        let accounts: Vec<GenesisAccount> = NAMES.iter().map(|n| GenesisAccount::generate_with_name(id(n))).collect();
        let sandbox = Sandbox::start_sandbox_with_config(SandboxConfig { additional_accounts: accounts.clone(), ..Default::default() })
            .await
            .expect("sandbox");
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse().unwrap());
        let signers = NAMES.iter().zip(&accounts).map(|(n, a)| (*n, Signer::from_secret_key(a.private_key.parse().unwrap()).unwrap())).collect();
        let public_keys = NAMES.iter().zip(&accounts).map(|(n, a)| (*n, a.public_key.clone())).collect();
        Self { _sandbox: sandbox, net, signers, public_keys }
    }

    async fn send(&self, who: &'static str, contract: &str, method: &str, args: Value, deposit: NearToken, gas: NearGas) -> ExecutionFinalResult {
        Contract(id(contract))
            .call_function(method, args)
            .transaction()
            .gas(gas)
            .deposit(deposit)
            .with_signer(id(who), self.signers[who].clone())
            .send_to(&self.net)
            .await
            .expect("rpc")
            .into_full()
            .expect("final result")
    }

    async fn call(&self, who: &'static str, contract: &str, method: &str, args: Value, deposit: NearToken) -> Result<ExecutionFinalResult, String> {
        let r = self.send(who, contract, method, args, deposit, NearGas::from_tgas(200)).await;
        if r.is_failure() {
            Err(format!("{r:?}"))
        } else {
            Ok(r)
        }
    }

    async fn ok(&self, who: &'static str, contract: &str, method: &str, args: Value) -> ExecutionFinalResult {
        self.call(who, contract, method, args, NearToken::from_yoctonear(1)).await.unwrap_or_else(|e| panic!("{method} as {who}: {e}"))
    }

    async fn view(&self, contract: &str, method: &str, args: Value) -> Value {
        Contract(id(contract)).call_function(method, args).read_only::<Value>().fetch_from(&self.net).await.expect("view").data
    }

    async fn tusd(&self, who: &str) -> u128 {
        n(&self.view("tusd", "ft_balance_of", json!({ "account_id": who })).await)
    }

    /// The token balance the business really has equals what its books say it holds, and no
    /// payout is left in flight once every transaction has finished.
    async fn settled(&self) {
        let t = self.view("biz", "get_treasury", json!({})).await;
        assert_eq!(self.tusd("biz").await, n(&t["held"]), "token balance and books disagree: {t}");
        let pending = self.view("biz", "get_pending", json!({})).await;
        assert_eq!(pending.as_array().map(|a| a.len()), Some(0), "a payout stayed in flight: {pending}");
    }

    async fn entitlement(&self, who: &str) -> Value {
        self.view("biz", "get_entitlement", json!({ "customer": who, "plan_id": 1 })).await
    }

    async fn buy(&self, who: &'static str, units: u32) {
        let e = self.entitlement(who).await;
        let seq = e["purchase_seq"].as_u64().unwrap() + 1;
        let msg = json!({ "buy": { "plan_id": 1, "units": units, "purchase_seq": seq } });
        let r = self.ok(who, "tusd", "ft_transfer_call", json!({ "receiver_id": "biz", "amount": (units as u128 * PRICE).to_string(), "msg": msg.to_string() })).await;
        let logs = r.logs().join("\n");
        assert!(logs.contains("units_bought"), "purchase refused: {logs}");
    }

    /// `seller` proposes a Direct sale to `buyer` at `price`; the buyer funds it (topped up from the
    /// platform if needed) and the seller accepts. Returns the buyer's `accept_sale` arguments.
    async fn sale_accepted_by_seller(&self, seller: &'static str, buyer: &'static str, price: u128) -> Value {
        let short = price.saturating_sub(self.tusd(buyer).await);
        if short > 0 {
            self.ok("platform", "tusd", "ft_transfer", json!({ "receiver_id": buyer, "amount": short.to_string() })).await;
        }
        let terms = json!({ "terms": { "buyer": buyer, "price": price.to_string(), "expires_at_ms": (now_ms() + 3_600_000).to_string(), "close_window_ms": "0", "available_floor": "0", "grants": [], "terms_hash": "1".repeat(64) } });
        self.call(seller, "biz", "propose_sale", terms, NearToken::from_millinear(100)).await.unwrap();
        let deal = self.view("biz", "get_control", json!({})).await["live_deal"].clone();
        let (seq, version, digest) = (deal["seq"].clone(), deal["version"].clone(), deal["digest"].clone());
        let fund = json!({ "fund_deal": { "deal_seq": seq, "version": version, "price": price.to_string() } });
        let r = self.ok(buyer, "tusd", "ft_transfer_call", json!({ "receiver_id": "biz", "amount": price.to_string(), "msg": fund.to_string() })).await;
        assert!(r.logs().join("\n").contains("sale_funded"), "{:?}", r.logs());
        let accept = json!({ "deal_seq": seq, "version": version, "digest": digest });
        self.ok(seller, "biz", "accept_sale", accept.clone()).await;
        accept
    }

    /// The block height at which the business ran the receipt that logged `what`.
    async fn height(&self, r: &ExecutionFinalResult, what: &str) -> u64 {
        let o = r.receipt_outcomes().iter().find(|o| o.executor_id.as_str() == "biz" && o.logs.iter().any(|l| l.contains(what)));
        let hash = o.unwrap_or_else(|| panic!("no {what} receipt")).block_hash;
        Chain::block().at(Reference::AtBlockHash(hash)).fetch_from(&self.net).await.expect("block").header.height
    }
}

/// The payout's two receipts: the token's `ft_transfer` and the business's `on_payout`.
fn payout_of(r: &ExecutionFinalResult) -> Payout {
    let outcomes = r.receipt_outcomes();
    let cb = outcomes
        .iter()
        .find(|o| o.executor_id.as_str() == "biz" && o.logs.iter().any(|l| l.contains("payout_settled")))
        .unwrap_or_else(|| panic!("no on_payout receipt: {r:?}"));
    assert!(cb.is_success(), "on_payout itself failed: {cb:?}");
    let transfer = outcomes.iter().find(|o| o.executor_id.as_str() == "tusd").expect("ft_transfer receipt");
    let settled = cb.logs.iter().find(|l| l.contains("payout_settled")).unwrap();
    Payout {
        callback_tgas: cb.gas_burnt.as_gas() as f64 / 1e12,
        transfer_tgas: transfer.gas_burnt.as_gas() as f64 / 1e12,
        ok: settled.contains("\"ok\":true"),
    }
}

fn record(gas: &mut Vec<(String, Payout)>, what: &str, p: Payout, ok: bool) {
    assert_eq!(p.ok, ok, "{what}: expected ok={ok}, got {p:?}");
    println!("  {what:<44} on_payout {:>6.3} TGas   ft_transfer {:>6.3} TGas", p.callback_tgas, p.transfer_tgas);
    gas.push((what.to_string(), p));
}

#[tokio::test]
async fn payouts_on_a_real_node_never_stay_stuck() {
    let (business, token) = (build("business-v3/Cargo.toml"), build("test-token/Cargo.toml"));
    let w = World::start().await;
    Contract::deploy(id("tusd"))
        .use_code(token)
        .with_init_call("new", json!({ "owner_id": "platform", "total_supply": (1_000_000 * D).to_string(), "symbol": "tUSD" }))
        .unwrap()
        .with_signer(w.signers["tusd"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();
    let rules = json!({ "min_reserve": "0", "max_hold_units": 4, "max_hold_ttl_ms": "600000", "max_settle_grace_ms": "600000" });
    Contract::deploy(id("biz"))
        .use_code(business)
        .with_init_call("new", json!({ "name": "biz", "owner": "mara", "asset": "tusd", "rules": rules, "closer": null }))
        .unwrap()
        .with_signer(w.signers["biz"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();
    // Born locked, like the testnet business: no key on the account.
    Account(id("biz"))
        .delete_key(w.public_keys["biz"].parse::<near_api::PublicKey>().unwrap())
        .with_signer(w.signers["biz"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();

    let storage = NearToken::from_millinear(10);
    for who in ["biz", "mara", "cara", "dan", "noah"] {
        w.call("platform", "tusd", "storage_deposit", json!({ "account_id": who }), storage).await.unwrap();
    }
    for (who, amount) in [("cara", 100 * D), ("dan", 20 * D), ("noah", 2000 * D)] {
        w.ok("platform", "tusd", "ft_transfer", json!({ "receiver_id": who, "amount": amount.to_string() })).await;
    }

    let plan = json!({ "unit_price": PRICE.to_string(), "max_units_per_purchase": 40, "max_units_outstanding": 40, "max_hold_units": 2, "hold_ttl_ms": "300000", "settle_grace_ms": "300000" });
    let r = w.call("mara", "biz", "create_plan", json!({ "input": plan }), NearToken::from_millinear(100)).await.unwrap();
    assert_eq!(r.json::<u32>().unwrap(), 1, "the first plan is plan 1");
    for who in ["cara", "dan"] {
        w.call(who, "biz", "sponsor_shell", json!({ "customer": who, "plan_id": 1 }), NearToken::from_millinear(100)).await.unwrap();
    }
    w.buy("cara", 30).await;
    w.buy("dan", 10).await;
    w.settled().await;

    println!("Callback gas by payout kind (CALLBACK_GAS = {CALLBACK_TGAS} TGas):");
    let mut gas = Vec::new();

    // 1. A refund that arrives.
    let before = w.tusd("cara").await;
    let r = w.ok("cara", "biz", "refund_units", json!({ "plan_id": 1, "units": "2" })).await;
    record(&mut gas, "refund, paid", payout_of(&r), true);
    assert_eq!(w.tusd("cara").await, before + 2 * PRICE);
    w.settled().await;

    // 2. A refund the token refuses (the customer left the token): it becomes the customer's
    //    claim, and the claim is paid once they can receive again.
    assert_eq!(w.tusd("dan").await, 0, "dan spent everything");
    w.ok("dan", "tusd", "storage_unregister", json!({ "force": false })).await;
    let r = w.ok("dan", "biz", "refund_units", json!({ "plan_id": 1, "units": "3" })).await;
    record(&mut gas, "refund, refused by the token -> claim", payout_of(&r), false);
    assert_eq!(n(&w.entitlement("dan").await["claim"]), 3 * PRICE);
    w.settled().await;
    let r = w.ok("dan", "biz", "claim_customer", json!({ "plan_id": 1 })).await;
    record(&mut gas, "customer claim, refused again -> claim", payout_of(&r), false);
    w.call("platform", "tusd", "storage_deposit", json!({ "account_id": "dan" }), storage).await.unwrap();
    let r = w.ok("dan", "biz", "claim_customer", json!({ "plan_id": 1 })).await;
    record(&mut gas, "customer claim, paid on retry", payout_of(&r), true);
    assert_eq!(w.tusd("dan").await, 3 * PRICE);
    w.settled().await;

    // 3. Attached gas from too little to plenty. Each attempt either fails whole (nothing
    //    changed) or completes; the business never keeps a payout in flight.
    println!("Refund of 1 unit by attached gas:");
    let mut first_ok = None;
    for tgas in [5u64, 10, 15, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 35, 40, 60, 100, 300] {
        let free = n(&w.entitlement("cara").await["free"]);
        let bal = w.tusd("cara").await;
        let r = w.send("cara", "biz", "refund_units", json!({ "plan_id": 1, "units": "1" }), NearToken::from_yoctonear(1), NearGas::from_tgas(tgas)).await;
        let free_after = n(&w.entitlement("cara").await["free"]);
        let bal_after = w.tusd("cara").await;
        let outcome = if r.is_failure() && free_after == free {
            "refused whole, nothing changed".to_string()
        } else {
            let p = payout_of(&r);
            assert!(p.ok, "a registered customer's refund failed at {tgas} TGas: {p:?}");
            assert_eq!((free_after, bal_after), (free - 1, bal + PRICE), "at {tgas} TGas");
            first_ok.get_or_insert(tgas);
            format!("paid (on_payout {:.3} TGas)", p.callback_tgas)
        };
        println!("  {tgas:>3} TGas: {outcome}");
        w.settled().await;
    }
    let first_ok = first_ok.expect("some attached gas is enough");

    // 4. A sale: Mara proposes to Noah, Noah funds, both accept; the business is Noah's.
    let deal = w.sale_accepted_by_seller("mara", "noah", 500 * D).await;
    let r = w.ok("noah", "biz", "accept_sale", deal).await;
    assert!(r.logs().join("\n").contains("sale_finalized"), "{:?}", r.logs());
    assert_eq!(w.view("biz", "get_control", json!({})).await["owner"], "noah");
    w.settled().await;

    // 5. The seller's proceeds: refused once (Mara left the token), a claim, then paid.
    w.ok("mara", "tusd", "storage_unregister", json!({ "force": false })).await;
    let r = w.ok("mara", "biz", "claim_party", json!({ "category": 2 })).await;
    record(&mut gas, "sale proceeds, refused by the token -> claim", payout_of(&r), false);
    w.call("platform", "tusd", "storage_deposit", json!({ "account_id": "mara" }), storage).await.unwrap();
    let r = w.ok("mara", "biz", "claim_party", json!({ "category": 2 })).await;
    record(&mut gas, "sale proceeds, paid on retry", payout_of(&r), true);
    assert_eq!(w.tusd("mara").await, 500 * D);
    // Mara no longer runs anything.
    let err = w.call("mara", "biz", "create_plan", json!({ "input": plan }), NearToken::from_millinear(100)).await.unwrap_err();
    assert!(err.contains("E_NOT_OWNER"), "{err}");
    w.settled().await;

    // 6. Escrow returned: Noah proposes a resale to Mara, Mara funds, Noah cancels.
    let deal = w.sale_accepted_by_seller("noah", "mara", 300 * D).await;
    w.ok("noah", "biz", "cancel_sale", json!({ "deal_seq": deal["deal_seq"] })).await;
    let r = w.ok("mara", "biz", "claim_party", json!({ "category": 1 })).await;
    record(&mut gas, "escrow return, paid", payout_of(&r), true);
    assert_eq!(w.tusd("mara").await, 500 * D);
    w.settled().await;

    // 7. A sale closing while a customer's refund is in flight. The refund and the buyer's
    //    acceptance are sent together, the acceptance a little later each try, until the close
    //    lands strictly between the refund's start and its callback (read from block heights).
    //    The business changes hands back and forth; every time, the refund reaches Cara.
    let (mut seller, mut buyer) = ("noah", "mara");
    let mut interleaved = false;
    for attempt in 0..10u64 {
        let deal = w.sale_accepted_by_seller(seller, buyer, 100 * D).await;
        let bal = w.tusd("cara").await;
        let (refund, close) = tokio::join!(
            w.send("cara", "biz", "refund_units", json!({ "plan_id": 1, "units": "1" }), NearToken::from_yoctonear(1), NearGas::from_tgas(100)),
            async {
                tokio::time::sleep(std::time::Duration::from_millis(attempt * 150)).await;
                w.send(buyer, "biz", "accept_sale", deal, NearToken::from_yoctonear(1), NearGas::from_tgas(100)).await
            },
        );
        assert!(!refund.is_failure() && !close.is_failure(), "{refund:?}\n{close:?}");
        assert_eq!(w.view("biz", "get_control", json!({})).await["owner"], buyer);
        assert!(payout_of(&refund).ok);
        assert_eq!(w.tusd("cara").await, bal + PRICE, "the refund reached Cara");
        let started = w.height(&refund, "payout_started").await;
        let settled_at = w.height(&refund, "payout_settled").await;
        let closed_at = w.height(&close, "sale_finalized").await;
        interleaved = started < closed_at && closed_at < settled_at;
        println!(
            "  try {}: refund started at block {started}, sale closed at {closed_at}, refund settled at {settled_at}{}",
            attempt + 1,
            if interleaved { ": the close ran while the refund was in flight" } else { "" }
        );
        w.settled().await;
        (seller, buyer) = (buyer, seller);
        if interleaved {
            break;
        }
    }
    assert!(interleaved, "the close never landed between a refund and its callback");

    // The callback's measured worst case against its fixed budget.
    let worst = gas.iter().map(|(_, p)| p.callback_tgas).fold(0.0, f64::max);
    println!("Worst on_payout: {worst:.3} TGas of {CALLBACK_TGAS} TGas reserved ({:.1}x margin). Smallest refund that went through: {first_ok} TGas attached.", CALLBACK_TGAS as f64 / worst);
    assert!(worst * 2.0 <= CALLBACK_TGAS as f64, "CALLBACK_GAS leaves less than a 2x margin over the measured worst case");
}
