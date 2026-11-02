//! The close on a real local NEAR node (near-sandbox): deploy, lock the contract account by
//! deleting its only key, run the fixture through a sale, and check that the former owner's
//! transactions fail on chain while the protected treasury is unchanged.

use std::collections::HashMap;
use std::sync::Arc;

use near_api::{Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

const NAMES: [&str; 6] = ["openseat", "issuer", "founder", "northline", "worker-a", "worker-b"];

struct World {
    _sandbox: Sandbox,
    net: NetworkConfig,
    signers: HashMap<&'static str, Arc<Signer>>,
    public_keys: HashMap<&'static str, String>,
}

fn id(name: &str) -> AccountId {
    name.parse().unwrap()
}

impl World {
    async fn start() -> Self {
        let accounts: Vec<GenesisAccount> =
            NAMES.iter().map(|n| GenesisAccount::generate_with_name(id(n))).collect();
        let sandbox = Sandbox::start_sandbox_with_config(SandboxConfig {
            additional_accounts: accounts.clone(),
            ..Default::default()
        })
        .await
        .expect("sandbox");
        let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse().unwrap());
        let signers = NAMES
            .iter()
            .zip(&accounts)
            .map(|(n, a)| (*n, Signer::from_secret_key(a.private_key.parse().unwrap()).unwrap()))
            .collect();
        let public_keys = NAMES.iter().zip(&accounts).map(|(n, a)| (*n, a.public_key.clone())).collect();
        Self { _sandbox: sandbox, net, signers, public_keys }
    }

    async fn call(&self, who: &'static str, method: &str, args: Value, yocto: u128) -> Result<Vec<String>, String> {
        let result = Contract(id("openseat"))
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(100))
            .deposit(NearToken::from_yoctonear(yocto))
            .with_signer(id(who), self.signers[who].clone())
            .send_to(&self.net)
            .await
            .expect("rpc");
        let logs = result.logs().iter().map(|l| l.to_string()).collect();
        if result.is_failure() {
            Err(format!("{result:?}"))
        } else {
            Ok(logs)
        }
    }

    async fn ok(&self, who: &'static str, method: &str, args: Value) -> Vec<String> {
        let yocto = u128::from(who != "issuer");
        self.call(who, method, args, yocto).await.unwrap_or_else(|e| panic!("{method} as {who} failed: {e}"))
    }

    async fn view(&self, method: &str, args: Value) -> Value {
        Contract(id("openseat"))
            .call_function(method, args)
            .read_only::<Value>()
            .fetch_from(&self.net)
            .await
            .expect("view")
            .data
    }
}

fn build() -> Vec<u8> {
    let path = cargo_near_build::build_with_cli(cargo_near_build::BuildOpts {
        manifest_path: Some(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR")).into()),
        no_abi: true,
        ..Default::default()
    })
    .expect("wasm build");
    std::fs::read(path).expect("wasm read")
}

#[tokio::test]
async fn sale_on_a_locked_contract() {
    let wasm = build();
    let w = World::start().await;

    Contract::deploy(id("openseat"))
        .use_code(wasm)
        .with_init_call("new", json!({ "name": "openseat", "owner": "founder", "issuer": "issuer" }))
        .unwrap()
        .with_signer(w.signers["openseat"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();

    // Lock: delete the contract account's only key. Nobody can redeploy or add keys now.
    Account(id("openseat"))
        .delete_key(w.public_keys["openseat"].parse::<near_api::PublicKey>().unwrap())
        .with_signer(w.signers["openseat"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();
    let keys = Account(id("openseat")).list_keys().fetch_from(&w.net).await.unwrap();
    assert!(keys.data.is_empty(), "contract account still has keys: {:?}", keys.data);

    // Fixture: treasury 45 with 20 reserved; buyer funded with 150; worker A on generation 1.
    w.ok("issuer", "mint", json!({ "to": "founder", "amount": "45" })).await;
    w.ok("issuer", "mint", json!({ "to": "northline", "amount": "150" })).await;
    w.ok("founder", "deposit_treasury", json!({ "amount": "45" })).await;
    let commitment = "0".repeat(64);
    w.ok(
        "founder",
        "register_obligation",
        json!({ "obligation_id": "credit-1", "amount": "20", "commitment": commitment, "memo": "promised credits" }),
    )
    .await;
    w.ok("founder", "appoint_operator", json!({ "account_id": "worker-a", "capabilities": ["fulfillment"] })).await;
    let err = w.call("issuer", "mint", json!({ "to": "openseat", "amount": "1000" }), 0).await.unwrap_err();
    assert!(err.contains("cannot credit the business treasury"), "{err}");

    // The sale: propose, both accept the same digest; the buyer's acceptance closes it.
    let expires = (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()
        + 3_600_000)
        .to_string();
    w.ok(
        "founder",
        "propose_sale",
        json!({ "deal_id": "D-1", "buyer": "northline", "price": "100", "expires_at_ms": expires, "terms_hash": "1".repeat(64) }),
    )
    .await;
    let digest = w.view("get_deal", json!({ "deal_id": "D-1" })).await["digest"].as_str().unwrap().to_string();
    w.ok("founder", "accept_sale", json!({ "deal_id": "D-1", "digest": digest })).await;
    let logs = w.ok("northline", "accept_sale", json!({ "deal_id": "D-1", "digest": digest })).await;
    assert!(logs.iter().any(|l| l.contains("sale_finalized")), "{logs:?}");

    let control = w.view("get_control", json!({})).await;
    assert_eq!(control["owner"], "northline");
    assert_eq!(control["generation"], 2);
    assert_eq!(control["operators"], json!([]));
    assert_eq!(w.view("balance_of", json!({ "account_id": "founder" })).await, "100");
    assert_eq!(w.view("balance_of", json!({ "account_id": "northline" })).await, "50");
    let t = w.view("get_treasury", json!({})).await;
    assert_eq!((t["treasury"].clone(), t["reserved"].clone(), t["available"].clone()), (json!("45"), json!("20"), json!("25")));

    // The former owner's real transactions fail on chain.
    let err = w
        .call("founder", "appoint_operator", json!({ "account_id": "founder", "capabilities": ["support"] }), 1)
        .await
        .unwrap_err();
    assert!(err.contains("E_NOT_OWNER"), "{err}");
    let err = w.call("founder", "withdraw_treasury", json!({ "amount": "1" }), 1).await.unwrap_err();
    assert!(err.contains("E_NOT_OWNER"), "{err}");
    let err = w.call("northline", "accept_sale", json!({ "deal_id": "D-1", "digest": digest }), 1).await.unwrap_err();
    assert!(err.contains("E_STATE"), "a second close cannot pay again: {err}");

    // Worker A's grant died with generation 1; the buyer appoints worker B for generation 2.
    let check = w.view("operator_check", json!({ "account_id": "worker-a", "capability": "fulfillment" })).await;
    assert_eq!(check["authorized"], false);
    w.ok("northline", "appoint_operator", json!({ "account_id": "worker-b", "capabilities": ["fulfillment"] })).await;
    let check = w.view("operator_check", json!({ "account_id": "worker-b", "capability": "fulfillment" })).await;
    assert_eq!(check["authorized"], true);
    assert_eq!(check["generation"], 2);

    // The new owner cannot take the reserved 20 either.
    let err = w.call("northline", "withdraw_treasury", json!({ "amount": "26" }), 1).await.unwrap_err();
    assert!(err.contains("E_RESERVED"), "{err}");
    w.ok("northline", "withdraw_treasury", json!({ "amount": "25" })).await;
}
