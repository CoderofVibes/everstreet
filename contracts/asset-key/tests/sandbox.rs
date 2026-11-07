//! The companion on a real local NEAR node (near-sandbox), with the real business-v3 contract and
//! a local stand-in for the MPC signer (test-signer; deterministic test keys, never public).
//!
//! What it shows, end to end:
//! - the seller, as owner at generation 1, gets a `publish` signed from generation 1's address,
//!   at nonces 0 and 1 only: a nonce past the highest signed + 1 is refused `E_NONCE`;
//! - the seller can't name a destination for the role (the action has none; a `to` is ignored),
//!   and while generation 1 is current there is nothing to move (`E_GENERATION`);
//! - anyone else asking is refused `E_NOT_OWNER` (deposit returned, nothing signed);
//! - after the sale closes, the former seller is refused for every action, including moving the
//!   role from their own generation's address;
//! - the buyer moves the role from generation 1's address to generation 2's, an address the
//!   companion derives itself through the signer's `derived_public_key` (naming any other address
//!   yields the same transaction), then publishes from generation 2's address;
//! - on a model of the registry (only its controller may act), a `publish` the seller had signed
//!   before the close is rejected once the role has moved.
//!
//! Run in WSL from `contracts/`:
//!   CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p asset-key --test sandbox -- --nocapture

#![allow(unused_must_use)]

use std::collections::HashMap;
use std::sync::Arc;

use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};
use sha3::{Digest, Keccak256};

const NAMES: [&str; 7] = ["biz", "tusd", "platform", "mara", "noah", "signer", "asset"];
const D: u128 = 1_000_000;
const CHAIN_ID: u64 = 11155111;
const REGISTRY: &str = "0x2222222222222222222222222222222222222222";

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
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

impl World {
    async fn start() -> Self {
        let accounts: Vec<GenesisAccount> = NAMES
            .iter()
            .map(|n| GenesisAccount::generate_with_name(id(n)))
            .collect();
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
            .map(|(n, a)| {
                (
                    *n,
                    Signer::from_secret_key(a.private_key.parse().unwrap()).unwrap(),
                )
            })
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
        }
    }

    async fn send(
        &self,
        who: &'static str,
        contract: &str,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> ExecutionFinalResult {
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

    async fn ok(
        &self,
        who: &'static str,
        contract: &str,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> ExecutionFinalResult {
        let r = self.send(who, contract, method, args, deposit).await;
        assert!(!r.is_failure(), "{method} as {who}: {r:?}");
        r
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

    async fn deploy(&self, who: &'static str, code: Vec<u8>, init: &str, args: Value) {
        Contract::deploy(id(who))
            .use_code(code)
            .with_init_call(init, args)
            .unwrap()
            .with_signer(self.signers[who].clone())
            .send_to(&self.net)
            .await
            .unwrap()
            .assert_success();
    }

    async fn lock(&self, who: &'static str) {
        Account(id(who))
            .delete_key(
                self.public_keys[who]
                    .parse::<near_api::PublicKey>()
                    .unwrap(),
            )
            .with_signer(self.signers[who].clone())
            .send_to(&self.net)
            .await
            .unwrap()
            .assert_success();
    }

    /// One request to the companion; the whole outcome.
    async fn request_full(
        &self,
        who: &'static str,
        action: Value,
        nonce: u64,
    ) -> ExecutionFinalResult {
        let tx = json!({ "nonce": nonce.to_string(), "gas_limit": "80000", "max_fee_per_gas": "3000000000", "max_priority_fee_per_gas": "1000000000" });
        self.ok(
            who,
            "asset",
            "request",
            json!({ "action": action, "tx": tx }),
            NearToken::from_yoctonear(1),
        )
        .await
    }

    /// One request to the companion; its return value (signed, or refused).
    async fn request(&self, who: &'static str, action: Value, nonce: u64) -> Value {
        self.request_full(who, action, nonce)
            .await
            .json::<Value>()
            .expect("a JSON answer")
    }
}

/// The EVM address that produced `signature` over `payload` (what the registry would see).
fn signer_of(answer: &Value) -> [u8; 20] {
    let sig = &answer["signature"];
    let r = hex::decode(&sig["big_r"]["affine_point"].as_str().unwrap()[2..]).unwrap();
    let s = hex::decode(sig["s"]["scalar"].as_str().unwrap()).unwrap();
    let rec = RecoveryId::from_byte(sig["recovery_id"].as_u64().unwrap() as u8).unwrap();
    let signature = Signature::from_scalars(
        <[u8; 32]>::try_from(r).unwrap(),
        <[u8; 32]>::try_from(s).unwrap(),
    )
    .unwrap();
    let payload = hex::decode(answer["payload"].as_str().unwrap()).unwrap();
    // The payload is the keccak of exactly the unsigned transaction the contract returned.
    let unsigned = hex::decode(&answer["unsigned_tx"].as_str().unwrap()[2..]).unwrap();
    assert_eq!(&Keccak256::digest(&unsigned)[..], &payload[..]);
    let key = VerifyingKey::recover_from_prehash(&payload, &signature, rec).expect("recover");
    address(&key)
}

/// The call data inside a signed answer's unsigned transaction: the last field before the empty
/// access list (`0xa4` = a 36-byte string, then `0xc0`).
fn call_data_of(answer: &Value) -> Vec<u8> {
    let unsigned = hex::decode(&answer["unsigned_tx"].as_str().unwrap()[2..]).unwrap();
    let n = unsigned.len();
    assert_eq!((unsigned[n - 38], unsigned[n - 1]), (0xa4, 0xc0));
    unsigned[n - 37..n - 1].to_vec()
}

fn address(key: &VerifyingKey) -> [u8; 20] {
    let p = key.to_encoded_point(false);
    let h = Keccak256::digest(&p.as_bytes()[1..]);
    h[12..].try_into().unwrap()
}

/// The address the stand-in signer derives for the companion at `path` (asked with the same
/// arguments the companion uses, as for the production signer).
async fn derived(w: &World, path: &str) -> [u8; 20] {
    let pk = w
        .view(
            "signer",
            "derived_public_key",
            json!({ "path": path, "predecessor": "asset", "domain_id": 0 }),
        )
        .await;
    let bytes = hex::decode(pk.as_str().unwrap()).unwrap();
    address(&VerifyingKey::from_sec1_bytes(&bytes).unwrap())
}

/// A model of the registry: only its controller may act. It reads the signed call data itself.
struct Registry {
    controller: [u8; 20],
    published: Vec<String>,
}
impl Registry {
    fn apply(&mut self, answer: &Value) -> Result<(), &'static str> {
        if signer_of(answer) != self.controller {
            return Err("not controller");
        }
        let data = call_data_of(answer);
        let publish = &Keccak256::digest(b"publish(bytes32)")[..4];
        let set_controller = &Keccak256::digest(b"setController(address)")[..4];
        if &data[..4] == publish {
            self.published.push(hex::encode(&data[4..]));
        } else if &data[..4] == set_controller {
            assert_eq!(&data[4..16], &[0u8; 12]);
            self.controller = data[16..].try_into().unwrap();
        } else {
            unreachable!()
        }
        Ok(())
    }
}

#[tokio::test]
async fn control_of_the_external_asset_follows_the_business_owner() {
    let (business, token, signer, asset) = (
        build("business-v3/Cargo.toml"),
        build("test-token/Cargo.toml"),
        build("test-signer/Cargo.toml"),
        build("asset-key/Cargo.toml"),
    );
    let w = World::start().await;
    w.deploy("tusd", token, "new", json!({ "owner_id": "platform", "total_supply": (1_000_000 * D).to_string(), "symbol": "tUSD" })).await;
    let rules = json!({ "min_reserve": "0", "max_hold_units": 4, "max_hold_ttl_ms": "600000", "max_settle_grace_ms": "600000" });
    w.deploy(
        "biz",
        business,
        "new",
        json!({ "name": "biz", "owner": "mara", "asset": "tusd", "rules": rules, "closer": null }),
    )
    .await;
    Contract::deploy(id("signer"))
        .use_code(signer)
        .without_init_call()
        .with_signer(w.signers["signer"].clone())
        .send_to(&w.net)
        .await
        .unwrap()
        .assert_success();
    w.deploy(
        "asset",
        asset,
        "new",
        json!({ "business": "biz", "signer": "signer", "chain_id": CHAIN_ID.to_string(), "registry": REGISTRY, "max_gas_limit": "200000", "max_fee_per_gas": "50000000000" }),
    )
    .await;
    // Born locked, like the testnet deployments.
    w.lock("biz").await;
    w.lock("asset").await;

    let gen1 = derived(&w, "gen-1").await;
    let gen2 = derived(&w, "gen-2").await;
    assert_ne!(gen1, gen2, "each generation has its own address");
    let mut registry = Registry {
        controller: gen1,
        published: vec![],
    };

    // The seller, owner at generation 1, publishes from generation 1's address (nonce 0: the first
    // signature for a path).
    let publish = json!({ "kind": "publish", "digest": "11".repeat(32) });
    let a = w.request("mara", publish.clone(), 0).await;
    assert_eq!(a["generation"], 1);
    assert_eq!(signer_of(&a), gen1);
    registry.apply(&a).unwrap();
    // Signed before the close and not yet sent: a second publish from generation 1's address, at
    // the one nonce past the highest signed.
    let early = json!({ "kind": "publish", "digest": "22".repeat(32) });
    let held = w.request("mara", early.clone(), 1).await;
    assert_eq!(signer_of(&held), gen1);
    // No stockpile of future nonces: anything past highest + 1 (now 2) is refused.
    for nonce in [3u64, 5, 1_000_000] {
        let r = w.request("mara", early.clone(), nonce).await;
        assert_eq!(r["refused"], "E_NONCE", "nonce {nonce}");
    }
    assert_eq!(
        w.view("asset", "get_signed_nonce", json!({ "generation": 1 }))
            .await,
        "1"
    );
    // While still the owner, the seller can't hand the role to an address of their choosing: the
    // action has no destination (a `to` is ignored), and generation 1 is the current one, so
    // there is nothing to move.
    let grab = json!({ "kind": "set_controller", "to": format!("0x{}", "33".repeat(20)), "from_generation": 1 });
    assert_eq!(
        w.request("mara", grab.clone(), 2).await["refused"],
        "E_GENERATION"
    );

    // Anyone else is refused; nothing is signed and the deposit comes back.
    let refused = w.request("noah", publish.clone(), 0).await;
    assert_eq!(refused["refused"], "E_NOT_OWNER");

    // The sale closes: mara → noah, generation 2.
    w.ok(
        "platform",
        "tusd",
        "storage_deposit",
        json!({ "account_id": "biz" }),
        NearToken::from_millinear(10),
    )
    .await;
    w.ok(
        "platform",
        "tusd",
        "storage_deposit",
        json!({ "account_id": "noah" }),
        NearToken::from_millinear(10),
    )
    .await;
    w.ok(
        "platform",
        "tusd",
        "ft_transfer",
        json!({ "receiver_id": "noah", "amount": (100 * D).to_string() }),
        NearToken::from_yoctonear(1),
    )
    .await;
    let terms = json!({ "terms": { "buyer": "noah", "price": (50 * D).to_string(), "expires_at_ms": (now_ms() + 3_600_000).to_string(), "close_window_ms": "0", "available_floor": "0", "grants": [], "terms_hash": "1".repeat(64) } });
    w.ok(
        "mara",
        "biz",
        "propose_sale",
        terms,
        NearToken::from_millinear(100),
    )
    .await;
    let deal = w.view("biz", "get_control", json!({})).await["live_deal"].clone();
    let fund = json!({ "fund_deal": { "deal_seq": deal["seq"], "version": deal["version"], "price": (50 * D).to_string() } });
    w.ok(
        "noah",
        "tusd",
        "ft_transfer_call",
        json!({ "receiver_id": "biz", "amount": (50 * D).to_string(), "msg": fund.to_string() }),
        NearToken::from_yoctonear(1),
    )
    .await;
    let accept =
        json!({ "deal_seq": deal["seq"], "version": deal["version"], "digest": deal["digest"] });
    w.ok(
        "mara",
        "biz",
        "accept_sale",
        accept.clone(),
        NearToken::from_yoctonear(1),
    )
    .await;
    w.ok(
        "noah",
        "biz",
        "accept_sale",
        accept,
        NearToken::from_yoctonear(1),
    )
    .await;
    let control = w.view("biz", "get_control", json!({})).await;
    assert_eq!(
        (control["owner"].as_str(), control["generation"].as_u64()),
        (Some("noah"), Some(2))
    );

    // The former seller can't ask for anything now, not even from their own generation's path.
    assert_eq!(
        w.request("mara", publish.clone(), 2).await["refused"],
        "E_NOT_OWNER"
    );
    assert_eq!(
        w.request("mara", grab.clone(), 2).await["refused"],
        "E_NOT_OWNER"
    );

    // The buyer moves the role: signed from generation 1's address (at most nonce 2 there), to
    // generation 2's address, which the companion derived itself from the signer.
    let rotate = json!({ "kind": "set_controller", "from_generation": 1 });
    assert_eq!(
        w.request("noah", rotate.clone(), 3).await["refused"],
        "E_NONCE"
    );
    let full = w.request_full("noah", rotate.clone(), 2).await;
    println!(
        "set_controller request: {} Tgas burnt; per receipt: {}",
        full.total_gas_burnt.as_tgas(),
        full.receipt_outcomes()
            .iter()
            .map(|o| format!(
                "{} {:.1}",
                o.executor_id,
                o.gas_burnt.as_gas() as f64 / 1e12
            ))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let r = full.json::<Value>().expect("a JSON answer");
    assert_eq!(r["generation"], 1);
    assert_eq!(signer_of(&r), gen1);
    assert_eq!(&call_data_of(&r)[16..], &gen2[..]);
    // Naming another address changes nothing: the same transaction (a replacement at nonce 2)
    // still moves the role to generation 2's address only.
    let named = w.request("noah", grab.clone(), 2).await;
    assert_eq!(named["unsigned_tx"], r["unsigned_tx"]);
    assert_ne!(&call_data_of(&named)[16..], &[0x33u8; 20][..]);
    registry.apply(&r).unwrap();
    assert_eq!(registry.controller, gen2);
    // A generation that doesn't exist yet, and the current one (nothing to move), are refused.
    let ahead = json!({ "kind": "set_controller", "from_generation": 3 });
    assert_eq!(w.request("noah", ahead, 3).await["refused"], "E_GENERATION");
    let same = json!({ "kind": "set_controller", "from_generation": 2 });
    assert_eq!(w.request("noah", same, 0).await["refused"], "E_GENERATION");

    // The seller's earlier signature (generation 1's address) now controls nothing.
    assert_eq!(registry.apply(&held), Err("not controller"));
    // The buyer publishes from generation 2's address (its path's first nonce, 0).
    let next = json!({ "kind": "publish", "digest": "44".repeat(32) });
    let b = w.request("noah", next.clone(), 0).await;
    assert_eq!((b["generation"].as_u64(), signer_of(&b)), (Some(2), gen2));
    registry.apply(&b).unwrap();
    assert_eq!(registry.published, vec!["11".repeat(32), "44".repeat(32)]);
    assert_eq!(
        (
            w.view("asset", "get_signed_nonce", json!({ "generation": 1 }))
                .await,
            w.view("asset", "get_signed_nonce", json!({ "generation": 2 }))
                .await,
            w.view("asset", "get_signed_nonce", json!({ "generation": 3 }))
                .await,
        ),
        (json!("2"), json!("0"), Value::Null)
    );
    println!(
        "generation 1 address 0x{}\ngeneration 2 address 0x{}",
        hex::encode(gen1),
        hex::encode(gen2)
    );
}
