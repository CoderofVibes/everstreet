//! v2 on a real local NEAR node with real NEP-141 transfers: a paid order, a duplicate payment
//! returned, a wrong token refused, a cancellation refunded, delivery and an owner withdrawal,
//! and a sale funded in the token. After every step the business's token balance equals what
//! its books say it holds.

use std::collections::HashMap;
use std::sync::Arc;

use near_api::{Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

const NAMES: [&str; 7] = ["juniper", "tusd", "fake", "platform", "mara", "sam", "northline"];
const D: u128 = 1_000_000; // six decimals

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

    async fn call(&self, who: &'static str, contract: &str, method: &str, args: Value, deposit: NearToken) -> Result<Vec<String>, String> {
        let r = Contract(id(contract))
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(200))
            .deposit(deposit)
            .with_signer(id(who), self.signers[who].clone())
            .send_to(&self.net)
            .await
            .expect("rpc");
        let logs = r.logs().iter().map(|l| l.to_string()).collect();
        if r.is_failure() {
            Err(format!("{r:?}"))
        } else {
            Ok(logs)
        }
    }

    async fn ok(&self, who: &'static str, contract: &str, method: &str, args: Value) -> Vec<String> {
        self.call(who, contract, method, args, NearToken::from_yoctonear(1)).await.unwrap_or_else(|e| panic!("{method} as {who}: {e}"))
    }

    async fn view(&self, contract: &str, method: &str, args: Value) -> Value {
        Contract(id(contract)).call_function(method, args).read_only::<Value>().fetch_from(&self.net).await.expect("view").data
    }

    async fn tusd(&self, who: &str) -> u128 {
        self.view("tusd", "ft_balance_of", json!({ "account_id": who })).await.as_str().unwrap().parse().unwrap()
    }

    async fn treasury(&self) -> Value {
        self.view("juniper", "get_treasury", json!({})).await
    }

    /// The token balance the business really has equals what its books say it holds.
    async fn books_match(&self) {
        let held: u128 = self.treasury().await["held"].as_str().unwrap().parse().unwrap();
        assert_eq!(self.tusd("juniper").await, held, "token balance and books disagree");
    }

    async fn pay(&self, who: &'static str, token: &str, amount: u128, msg: Value) {
        self.ok(who, token, "ft_transfer_call", json!({ "receiver_id": "juniper", "amount": amount.to_string(), "msg": msg.to_string() })).await;
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()
}

#[tokio::test]
async fn payments_refunds_and_a_sale_on_a_real_token() {
    let (business, token) = (build("business-v2/Cargo.toml"), build("test-token/Cargo.toml"));
    let w = World::start().await;
    for (acct, sym) in [("tusd", "tUSD"), ("fake", "FAKE")] {
        Contract::deploy(id(acct))
            .use_code(token.clone())
            .with_init_call("new", json!({ "owner_id": "platform", "total_supply": (1_000_000 * D).to_string(), "symbol": sym }))
            .unwrap()
            .with_signer(w.signers[acct].clone())
            .send_to(&w.net)
            .await
            .unwrap()
            .assert_success();
    }
    Contract::deploy(id("juniper"))
        .use_code(business)
        .with_init_call(
            "new",
            json!({ "name": "juniper", "owner": "mara", "asset": "tusd", "rules": { "customer_cancel_refund": true, "credit_refundable": true, "min_reserve": (10 * D).to_string() } }),
        )
        .unwrap()
        .with_signer(w.signers["juniper"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();
    Account(id("juniper"))
        .delete_key(w.public_keys["juniper"].parse::<near_api::PublicKey>().unwrap())
        .with_signer(w.signers["juniper"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();

    // Everyone registers with both tokens; the platform hands out test dollars.
    let storage = NearToken::from_millinear(10);
    for token in ["tusd", "fake"] {
        for who in ["juniper", "mara", "sam", "northline"] {
            w.call("platform", token, "storage_deposit", json!({ "account_id": who }), storage).await.unwrap();
        }
    }
    w.ok("platform", "tusd", "ft_transfer", json!({ "receiver_id": "sam", "amount": (100 * D).to_string() })).await;
    w.ok("platform", "tusd", "ft_transfer", json!({ "receiver_id": "northline", "amount": (2000 * D).to_string() })).await;
    w.ok("platform", "fake", "ft_transfer", json!({ "receiver_id": "sam", "amount": (100 * D).to_string() })).await;

    // A paid order.
    let deadline = (now_ms() + 3_600_000).to_string();
    let order = json!({ "order": { "order_id": "o-1", "offer": "linocut", "cancel_before_ms": deadline } });
    w.pay("sam", "tusd", 35 * D, order.clone()).await;
    assert_eq!(w.tusd("sam").await, 65 * D);
    assert_eq!(w.view("juniper", "get_order", json!({ "order_id": "o-1" })).await["status"], "Paid");
    w.books_match().await;

    // The same order again: the token returns the money.
    w.pay("sam", "tusd", 35 * D, order).await;
    assert_eq!(w.tusd("sam").await, 65 * D, "an order is paid once");
    w.books_match().await;

    // The wrong token: refused, and the sender keeps it.
    w.pay("sam", "fake", 35 * D, json!({ "prepay": {} })).await;
    let fake: u128 = w.view("fake", "ft_balance_of", json!({ "account_id": "sam" })).await.as_str().unwrap().parse().unwrap();
    assert_eq!(fake, 100 * D);
    assert_eq!(w.treasury().await["customer_credit"], "0");

    // The customer cancels in time and the refund arrives.
    w.ok("sam", "juniper", "cancel_order", json!({ "order_id": "o-1" })).await;
    assert_eq!(w.tusd("sam").await, 100 * D);
    assert_eq!(w.view("juniper", "get_order", json!({ "order_id": "o-1" })).await["status"], "Refunded");
    w.books_match().await;

    // A delivered order becomes revenue; the owner withdraws only above the reserve.
    w.pay("sam", "tusd", 35 * D, json!({ "order": { "order_id": "o-2", "offer": "linocut" } })).await;
    let err = w.call("mara", "juniper", "withdraw_profit", json!({ "amount": (1 * D).to_string() }), NearToken::from_yoctonear(1)).await.unwrap_err();
    assert!(err.contains("E_RESERVED"), "{err}");
    w.ok("mara", "juniper", "deliver", json!({ "order_id": "o-2" })).await;
    w.ok("mara", "juniper", "withdraw_profit", json!({ "amount": (25 * D).to_string() })).await;
    assert_eq!(w.tusd("mara").await, 25 * D);
    w.books_match().await;
    let t = w.treasury().await;
    assert_eq!((t["available"].as_str(), t["withdrawable"].as_str()), (Some("10000000"), Some("0")));

    // A sale funded in the token: the seller is paid, the buyer owns it, the books still match.
    let expires = (now_ms() + 3_600_000).to_string();
    w.ok("mara", "juniper", "propose_sale", json!({ "deal_id": "D-1", "buyer": "northline", "price": (1500 * D).to_string(), "expires_at_ms": expires, "terms_hash": "1".repeat(64) })).await;
    let digest = w.view("juniper", "get_deal", json!({ "deal_id": "D-1" })).await["digest"].as_str().unwrap().to_string();
    w.pay("northline", "tusd", 1500 * D, json!({ "fund_deal": { "deal_id": "D-1" } })).await;
    w.ok("mara", "juniper", "accept_sale", json!({ "deal_id": "D-1", "digest": digest })).await;
    let logs = w.ok("northline", "juniper", "accept_sale", json!({ "deal_id": "D-1", "digest": digest })).await;
    assert!(logs.iter().any(|l| l.contains("sale_finalized")), "{logs:?}");
    assert_eq!(w.view("juniper", "get_control", json!({})).await["owner"], "northline");
    w.books_match().await;
    w.ok("mara", "juniper", "claim_proceeds", json!({})).await;
    assert_eq!(w.tusd("mara").await, 1525 * D);
    let err = w.call("mara", "juniper", "withdraw_profit", json!({ "amount": "1" }), NearToken::from_yoctonear(1)).await.unwrap_err();
    assert!(err.contains("E_NOT_OWNER"), "{err}");
    w.books_match().await;
}
