//! A stand-in for NEAR's MPC signer, for a LOCAL NODE ONLY. It answers the same `sign` request
//! shape (`{ request: { payload_v2: { Ecdsa: <hex32> }, path, domain_id: 0 } }`) with the same
//! response shape (`big_r.affine_point`, `s.scalar`, `recovery_id`), from a deterministic test key
//! per (predecessor, path): sha256("everstreet-test-signer:" + predecessor + "," + path). Anyone
//! can recompute these keys: they protect nothing and exist so a test can check who asked for
//! what. It is never deployed to a public network.

use k256::ecdsa::SigningKey;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, require, AccountId};
use sha2::{Digest, Sha256};

#[near(contract_state)]
#[derive(Default)]
pub struct TestSigner {
    signed: u64,
}

fn key_for(predecessor: &str, path: &str) -> SigningKey {
    let seed = Sha256::digest(format!("everstreet-test-signer:{predecessor},{path}").as_bytes());
    SigningKey::from_bytes(&seed).expect("a valid test key")
}

#[near]
impl TestSigner {
    #[payable]
    pub fn sign(&mut self, request: Value) -> Value {
        require!(
            request["domain_id"].as_u64() == Some(0),
            "only domain 0 (secp256k1)"
        );
        let path = request["path"].as_str().expect("path").to_string();
        let payload =
            hex::decode(request["payload_v2"]["Ecdsa"].as_str().expect("payload")).expect("hex");
        require!(payload.len() == 32, "a 32-byte payload");
        let key = key_for(env::predecessor_account_id().as_str(), &path);
        let (sig, rec) = key.sign_prehash_recoverable(&payload).expect("sign");
        let (r, s) = (sig.r().to_bytes(), sig.s().to_bytes());
        let prefix = if rec.is_y_odd() { 3u8 } else { 2u8 };
        self.signed += 1;
        json!({
            "scheme": "Secp256k1",
            "big_r": { "affine_point": format!("{:02x}{}", prefix, hex::encode(r)) },
            "s": { "scalar": hex::encode(s) },
            "recovery_id": rec.to_byte(),
        })
    }

    /// The test key's public key for (predecessor, path): uncompressed, hex.
    pub fn derived_public_key(&self, path: String, predecessor: AccountId) -> String {
        let key = key_for(predecessor.as_str(), &path);
        hex::encode(key.verifying_key().to_encoded_point(false).as_bytes())
    }
}
