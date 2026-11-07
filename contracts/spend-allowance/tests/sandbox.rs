//! The supplier allowance on a real local NEAR node, with the real business-v3 contract and the
//! test token: caps, the allowlist, review above a threshold, replay, the period cap, a failed
//! transfer becoming the supplier's claim, and the grant ending when the business is sold, until
//! the new owner grants again.
//!
//! Run in WSL from `contracts/`:
//!   CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p spend-allowance --test sandbox -- --nocapture

#![allow(unused_must_use)]

use std::collections::HashMap;
use std::sync::Arc;

use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use serde_json::{json, Value};

const NAMES: [&str; 9] = [
    "biz", "tusd", "platform", "mara", "noah", "agent", "quill", "other", "vault",
];
const D: u128 = 1_000_000;

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

fn n(v: &Value) -> u128 {
    v.as_str()
        .unwrap_or_else(|| panic!("not a number string: {v}"))
        .parse()
        .unwrap()
}

fn inv(i: u8) -> String {
    format!("{:02x}", i).repeat(32)
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

    /// The contract's refusal code, or panic if it wasn't refused.
    async fn refused(
        &self,
        who: &'static str,
        contract: &str,
        method: &str,
        args: Value,
    ) -> String {
        let r = self
            .send(who, contract, method, args, NearToken::from_yoctonear(0))
            .await;
        assert!(
            r.is_failure(),
            "{method} as {who} was not refused: {:?}",
            r.logs()
        );
        let text = format!("{r:?}");
        let at = text.find("E_").expect("an E_ code");
        text[at..]
            .split(|c: char| !(c.is_ascii_uppercase() || c == '_'))
            .next()
            .unwrap()
            .to_string()
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

    async fn tusd(&self, who: &str) -> u128 {
        n(&self
            .view("tusd", "ft_balance_of", json!({ "account_id": who }))
            .await)
    }

    async fn pay(&self, supplier: &str, amount: u128, invoice: &str) -> ExecutionFinalResult {
        self.send(
            "agent",
            "vault",
            "pay",
            json!({ "supplier": supplier, "amount": amount.to_string(), "invoice": invoice }),
            NearToken::from_yoctonear(0),
        )
        .await
    }

    async fn payment(&self, invoice: &str) -> String {
        let p = self
            .view("vault", "get_payment", json!({ "invoice": invoice }))
            .await;
        p["state"].as_str().unwrap_or("none").to_string()
    }

    async fn allowance(&self) -> Value {
        self.view("vault", "get_allowance", json!({})).await
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
}

#[tokio::test]
async fn the_allowance_pays_within_its_caps_and_ends_at_the_sale() {
    let (business, token, vault) = (
        build("business-v3/Cargo.toml"),
        build("test-token/Cargo.toml"),
        build("spend-allowance/Cargo.toml"),
    );
    let w = World::start().await;
    w.deploy("tusd", token, json!({ "owner_id": "platform", "total_supply": (1_000_000 * D).to_string(), "symbol": "tUSD" })).await;
    let rules = json!({ "min_reserve": "0", "max_hold_units": 4, "max_hold_ttl_ms": "600000", "max_settle_grace_ms": "600000" });
    w.deploy(
        "biz",
        business,
        json!({ "name": "biz", "owner": "mara", "asset": "tusd", "rules": rules, "closer": null }),
    )
    .await;
    w.deploy(
        "vault",
        vault,
        json!({ "business": "biz", "token": "tusd" }),
    )
    .await;
    for who in ["biz", "vault"] {
        Account(id(who))
            .delete_key(w.public_keys[who].parse::<near_api::PublicKey>().unwrap())
            .with_signer(w.signers[who].clone())
            .send_to(&w.net)
            .await
            .unwrap()
            .assert_success();
    }
    // Token registrations: not "other"'s, and not yet the supplier "quill"'s (its first transfer fails).
    for who in ["biz", "vault", "mara", "noah"] {
        w.ok(
            "platform",
            "tusd",
            "storage_deposit",
            json!({ "account_id": who }),
            NearToken::from_millinear(10),
        )
        .await;
    }
    w.ok(
        "platform",
        "tusd",
        "ft_transfer",
        json!({ "receiver_id": "mara", "amount": (200 * D).to_string() }),
        NearToken::from_yoctonear(1),
    )
    .await;
    w.ok(
        "platform",
        "tusd",
        "ft_transfer",
        json!({ "receiver_id": "noah", "amount": (200 * D).to_string() }),
        NearToken::from_yoctonear(1),
    )
    .await;

    // The owner funds the budget (separate from any customer money).
    w.ok(
        "mara",
        "tusd",
        "ft_transfer_call",
        json!({ "receiver_id": "vault", "amount": (60 * D).to_string(), "msg": "fund" }),
        NearToken::from_yoctonear(1),
    )
    .await;
    assert_eq!(n(&w.allowance().await["balance"]), 60 * D);

    // Only the business's current owner can grant.
    let grant = json!({ "agent": "agent", "suppliers": ["quill"], "per_payment": D.to_string(), "per_period": (5 * D).to_string(), "period_ms": "604800000", "review_above": (1_500_000u128).to_string() });
    assert_eq!(
        w.refused("noah", "vault", "grant", grant.clone()).await,
        "E_NOT_OWNER"
    );
    w.ok(
        "mara",
        "vault",
        "grant",
        grant.clone(),
        NearToken::from_yoctonear(0),
    )
    .await;
    assert_eq!(w.allowance().await["grant"]["generation"], 1);

    // Refusals before any money moves.
    assert_eq!(
        w.refused(
            "mara",
            "vault",
            "pay",
            json!({ "supplier": "quill", "amount": "900000", "invoice": inv(1) })
        )
        .await,
        "E_NOT_AGENT"
    );
    assert_eq!(
        w.refused(
            "agent",
            "vault",
            "pay",
            json!({ "supplier": "other", "amount": "900000", "invoice": inv(1) })
        )
        .await,
        "E_SUPPLIER"
    );
    assert_eq!(
        w.refused(
            "agent",
            "vault",
            "pay",
            json!({ "supplier": "quill", "amount": (1_200_000u128).to_string(), "invoice": inv(1) })
        )
        .await,
        "E_CAP"
    );

    // The supplier isn't registered with the token yet: the transfer fails and becomes its claim.
    w.pay("quill", 900_000, &inv(1)).await;
    assert_eq!(w.payment(&inv(1)).await, "Claim");
    assert_eq!(
        n(
            &w.view("vault", "get_claim", json!({ "supplier": "quill" }))
                .await
        ),
        900_000
    );
    w.ok(
        "platform",
        "tusd",
        "storage_deposit",
        json!({ "account_id": "quill" }),
        NearToken::from_millinear(10),
    )
    .await;
    w.ok(
        "quill",
        "vault",
        "claim",
        json!({}),
        NearToken::from_yoctonear(0),
    )
    .await;
    assert_eq!(w.tusd("quill").await, 900_000);

    // A normal payment; the same invoice again is a replay.
    w.pay("quill", 900_000, &inv(2)).await;
    assert_eq!(w.payment(&inv(2)).await, "Paid");
    assert_eq!(
        w.refused(
            "agent",
            "vault",
            "pay",
            json!({ "supplier": "quill", "amount": "900000", "invoice": inv(2) })
        )
        .await,
        "E_REPLAY"
    );
    assert_eq!(w.tusd("quill").await, 1_800_000);

    // Above the review threshold: it waits for the owner's approval of that invoice.
    let r = w.pay("quill", 1_800_000, &inv(3)).await;
    assert_eq!(r.json::<String>().unwrap(), "awaiting_approval");
    assert_eq!(w.payment(&inv(3)).await, "AwaitingApproval");
    assert_eq!(w.tusd("quill").await, 1_800_000);
    assert_eq!(
        w.refused("agent", "vault", "approve", json!({ "invoice": inv(3) }))
            .await,
        "E_NOT_OWNER"
    );
    w.ok(
        "mara",
        "vault",
        "approve",
        json!({ "invoice": inv(3) }),
        NearToken::from_yoctonear(0),
    )
    .await;
    assert_eq!(w.payment(&inv(3)).await, "Paid");
    assert_eq!(w.tusd("quill").await, 3_600_000);

    // The period cap counts approved payments too: 0.9 + 0.9 + 1.8 = 3.6 of 5; 1.6 more is over.
    assert_eq!(
        w.refused(
            "agent",
            "vault",
            "pay",
            json!({ "supplier": "quill", "amount": (1_600_000u128).to_string(), "invoice": inv(4) })
        )
        .await,
        "E_PERIOD_CAP"
    );

    // The business is sold (mara → noah); the grant ends with the generation it was made for.
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

    let before = w.allowance().await;
    let r = w.pay("quill", 500_000, &inv(5)).await;
    assert!(
        r.logs().join("\n").contains("E_GRANT_ENDED"),
        "{:?}",
        r.logs()
    );
    assert_eq!(w.payment(&inv(5)).await, "Refused");
    let after = w.allowance().await;
    assert_eq!(
        (
            after["reserved"].clone(),
            after["balance"].clone(),
            after["spent_in_period"].clone()
        ),
        (
            before["reserved"].clone(),
            before["balance"].clone(),
            before["spent_in_period"].clone()
        ),
        "a refused payment releases what it reserved"
    );
    assert_eq!(w.tusd("quill").await, 3_600_000);
    // The former owner can't grant again or take the budget; the new owner can.
    assert_eq!(
        w.refused("mara", "vault", "grant", grant.clone()).await,
        "E_NOT_OWNER"
    );
    let wd = w
        .send(
            "mara",
            "vault",
            "withdraw",
            json!({ "amount": D.to_string() }),
            NearToken::from_yoctonear(0),
        )
        .await;
    assert_eq!(wd.json::<String>().unwrap(), "E_NOT_OWNER");
    assert_eq!(
        w.allowance().await["reserved"],
        before["reserved"],
        "a refused withdrawal releases its reservation"
    );
    w.ok(
        "noah",
        "vault",
        "grant",
        grant,
        NearToken::from_yoctonear(0),
    )
    .await;
    assert_eq!(w.allowance().await["grant"]["generation"], 2);
    w.pay("quill", 500_000, &inv(6)).await;
    assert_eq!(w.payment(&inv(6)).await, "Paid");
    assert_eq!(w.tusd("quill").await, 4_100_000);
    let a = w.allowance().await;
    assert_eq!(n(&a["balance"]), 60 * D - 4_100_000);
    assert_eq!((n(&a["reserved"]), n(&a["claims_total"])), (0, 0));
    assert_eq!(
        w.tusd("vault").await,
        n(&a["balance"]),
        "the token balance equals the books"
    );
    println!("allowance after the sale: {a}");
}
