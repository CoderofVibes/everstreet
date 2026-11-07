//! A companion to one business contract: control of one external asset (an EVM registry with a
//! single `controller` role) follows the business's owner, with no transfer step of its own.
//!
//! The business contract stays the only source of authority. On every request this contract asks
//! it `get_control()` and acts only if the caller is the owner at that moment. It then asks NEAR's
//! MPC signer to sign one narrowly typed EVM transaction, built here, never supplied by the caller:
//!
//! - `Publish { digest }`: `publish(bytes32)` on the registry, signed from the current
//!   generation's address (path `gen-<generation>`).
//! - `SetController { to, from_generation }`: `setController(address)` on the registry, signed from
//!   the address of `from_generation` (any generation up to the current one). This is how a buyer
//!   moves the role from the seller's address to their own after a close; the seller, no longer
//!   the owner, can't ask for anything.
//!
//! Each owner has their own address on the other chain because the generation is in the path.
//! After the buyer moves the role, anything signed earlier for the seller's address controls
//! nothing: the registry only accepts its controller. The external step is not final until the
//! destination chain says so; this contract proves who asked and what was signed, not that it
//! landed.
//!
//! A refusal returns the attached deposit and logs `asset_refused` with its code; nothing is
//! signed. No keys on this account; no admin; no upgrade.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};

const CONTROL_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// What the signer may use; the rest of the attached gas stays for the callbacks.
const SIGN_GAS: Gas = Gas::from_tgas(50);

/// The business contract's view, only the fields this contract reads.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ControlView {
    pub owner: AccountId,
    pub generation: u32,
    pub control_seq: U64,
}

#[near(serializers = [json])]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// `publish(bytes32)`: 32 bytes, hex.
    Publish { digest: String },
    /// `setController(address)`: 20 bytes, hex; signed from `from_generation`'s address.
    SetController { to: String, from_generation: u32 },
}

/// The EVM transaction's variable fields; everything else is fixed by this contract.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TxParams {
    pub nonce: U64,
    pub gas_limit: U64,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub business: AccountId,
    pub signer: AccountId,
    pub chain_id: U64,
    /// The registry contract, 0x-prefixed lowercase hex.
    pub registry: String,
    pub max_gas_limit: U64,
    pub max_fee_per_gas: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AssetKey {
    business: AccountId,
    signer: AccountId,
    chain_id: u64,
    registry: [u8; 20],
    max_gas_limit: u64,
    max_fee_per_gas: u128,
    /// Requests signed so far (a counter for the event log; not a nonce).
    signed: u64,
}

// ---------- the exact EVM transaction (EIP-1559), built here ----------

fn hex_bytes<const N: usize>(s: &str, what: &str) -> [u8; N] {
    let h = s.strip_prefix("0x").unwrap_or(s);
    let v =
        hex::decode(h).unwrap_or_else(|_| env::panic_str(&format!("E_INPUT: {what} isn't hex")));
    if v.len() != N {
        env::panic_str(&format!("E_INPUT: {what} must be {N} bytes"));
    }
    let mut out = [0u8; N];
    out.copy_from_slice(&v);
    out
}

fn selector(sig: &str) -> [u8; 4] {
    let h = env::keccak256(sig.as_bytes());
    [h[0], h[1], h[2], h[3]]
}

/// The ABI call data for an action.
pub fn call_data(action: &Action) -> Vec<u8> {
    let mut d = Vec::with_capacity(36);
    match action {
        Action::Publish { digest } => {
            d.extend_from_slice(&selector("publish(bytes32)"));
            d.extend_from_slice(&hex_bytes::<32>(digest, "digest"));
        }
        Action::SetController { to, .. } => {
            d.extend_from_slice(&selector("setController(address)"));
            d.extend_from_slice(&[0u8; 12]);
            d.extend_from_slice(&hex_bytes::<20>(to, "to"));
        }
    }
    d
}

fn rlp_bytes(out: &mut Vec<u8>, b: &[u8]) {
    if b.len() == 1 && b[0] < 0x80 {
        out.push(b[0]);
    } else if b.len() < 56 {
        out.push(0x80 + b.len() as u8);
        out.extend_from_slice(b);
    } else {
        let len = be_min(b.len() as u128);
        out.push(0xb7 + len.len() as u8);
        out.extend_from_slice(&len);
        out.extend_from_slice(b);
    }
}

fn be_min(v: u128) -> Vec<u8> {
    let bytes = v.to_be_bytes();
    let first = bytes.iter().position(|&x| x != 0).unwrap_or(bytes.len());
    bytes[first..].to_vec()
}

fn rlp_uint(out: &mut Vec<u8>, v: u128) {
    rlp_bytes(out, &be_min(v));
}

fn rlp_list(out: &mut Vec<u8>, body: &[u8]) {
    if body.len() < 56 {
        out.push(0xc0 + body.len() as u8);
    } else {
        let len = be_min(body.len() as u128);
        out.push(0xf7 + len.len() as u8);
        out.extend_from_slice(&len);
    }
    out.extend_from_slice(body);
}

/// The unsigned EIP-1559 transaction: 0x02 || rlp([chain_id, nonce, tip, max_fee, gas, to, 0,
/// data, []]). Its keccak256 is what the signer signs.
pub fn unsigned_tx(chain_id: u64, registry: &[u8; 20], tx: &TxParams, data: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(128);
    rlp_uint(&mut body, chain_id as u128);
    rlp_uint(&mut body, tx.nonce.0 as u128);
    rlp_uint(&mut body, tx.max_priority_fee_per_gas.0);
    rlp_uint(&mut body, tx.max_fee_per_gas.0);
    rlp_uint(&mut body, tx.gas_limit.0 as u128);
    rlp_bytes(&mut body, registry);
    rlp_uint(&mut body, 0);
    rlp_bytes(&mut body, data);
    rlp_list(&mut body, &[]);
    let mut out = vec![0x02];
    rlp_list(&mut out, &body);
    out
}

pub fn path_for(generation: u32) -> String {
    format!("gen-{generation}")
}

#[near]
impl AssetKey {
    #[init]
    pub fn new(
        business: AccountId,
        signer: AccountId,
        chain_id: U64,
        registry: String,
        max_gas_limit: U64,
        max_fee_per_gas: U128,
    ) -> Self {
        Self {
            business,
            signer,
            chain_id: chain_id.0,
            registry: hex_bytes::<20>(&registry, "registry"),
            max_gas_limit: max_gas_limit.0,
            max_fee_per_gas: max_fee_per_gas.0,
            signed: 0,
        }
    }

    pub fn get_config(&self) -> Config {
        Config {
            business: self.business.clone(),
            signer: self.signer.clone(),
            chain_id: U64(self.chain_id),
            registry: format!("0x{}", hex::encode(self.registry)),
            max_gas_limit: U64(self.max_gas_limit),
            max_fee_per_gas: U128(self.max_fee_per_gas),
        }
    }

    /// The signing path for a generation (each owner's own address on the other chain).
    pub fn get_path(&self, generation: u32) -> String {
        path_for(generation)
    }

    /// Exactly what a request would have signed: the unsigned transaction and its hash. Read-only;
    /// it doesn't check who may ask (the request does, at that moment).
    pub fn preview(&self, action: Action, tx: TxParams) -> Value {
        let unsigned = unsigned_tx(self.chain_id, &self.registry, &tx, &call_data(&action));
        json!({
            "unsigned_tx": format!("0x{}", hex::encode(&unsigned)),
            "payload": hex::encode(env::keccak256(&unsigned)),
        })
    }

    /// Asks the business contract who owns it now, then (in `on_control`) signs only if the caller
    /// is that owner. The attached deposit pays the signer and is returned on a refusal.
    #[payable]
    pub fn request(&mut self, action: Action, tx: TxParams) -> Promise {
        require!(
            env::attached_deposit() >= NearToken::from_yoctonear(1),
            "E_DEPOSIT: attach the signer's fee"
        );
        require!(
            tx.gas_limit.0 > 0 && tx.gas_limit.0 <= self.max_gas_limit,
            "E_GAS: gas limit out of range"
        );
        require!(
            tx.max_fee_per_gas.0 <= self.max_fee_per_gas
                && tx.max_priority_fee_per_gas.0 <= tx.max_fee_per_gas.0,
            "E_FEE: fee out of range"
        );
        // Validate the action's fields now (a malformed one never reaches the business contract).
        let _ = call_data(&action);
        Promise::new(self.business.clone())
            .function_call(
                "get_control".to_string(),
                b"{}".to_vec(),
                NearToken::from_yoctonear(0),
                CONTROL_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(
                        SIGN_GAS
                            .saturating_add(CALLBACK_GAS)
                            .saturating_add(CALLBACK_GAS),
                    )
                    .on_control(
                        env::predecessor_account_id(),
                        env::attached_deposit(),
                        action,
                        tx,
                    ),
            )
    }

    #[private]
    pub fn on_control(
        &mut self,
        caller: AccountId,
        deposit: NearToken,
        action: Action,
        tx: TxParams,
        #[callback_result] control: Result<ControlView, PromiseError>,
    ) -> near_sdk::PromiseOrValue<Value> {
        let refuse = |code: &str, why: &str| {
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({ "standard": "asset-key", "version": "1.0.0", "event": "asset_refused", "data": [{ "caller": caller, "code": code }] })
            ));
            Promise::new(caller.clone()).transfer(deposit).detach();
            near_sdk::PromiseOrValue::Value(json!({ "refused": code, "reason": why }))
        };
        let Ok(c) = control else {
            return refuse("E_CONTROL_UNREAD", "the business contract couldn't be read");
        };
        if c.owner != caller {
            return refuse("E_NOT_OWNER", "only the business's current owner can ask");
        }
        let generation = match &action {
            Action::Publish { .. } => c.generation,
            Action::SetController {
                from_generation, ..
            } => {
                if *from_generation == 0 || *from_generation > c.generation {
                    return refuse("E_GENERATION", "no such generation yet");
                }
                *from_generation
            }
        };
        let unsigned = unsigned_tx(self.chain_id, &self.registry, &tx, &call_data(&action));
        let payload = env::keccak256(&unsigned);
        let path = path_for(generation);
        self.signed += 1;
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({ "standard": "asset-key", "version": "1.0.0", "event": "asset_sign_requested", "data": [{
                "caller": caller, "generation": generation, "owner_generation": c.generation,
                "control_seq": c.control_seq, "path": path, "payload": hex::encode(&payload),
                "nonce": tx.nonce, "action": action,
            }] })
        ));
        let args = json!({ "request": { "payload_v2": { "Ecdsa": hex::encode(&payload) }, "path": path, "domain_id": 0 } });
        Promise::new(self.signer.clone())
            .function_call(
                "sign".to_string(),
                serde_json::to_vec(&args).unwrap(),
                deposit,
                SIGN_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_signed(
                        generation,
                        hex::encode(&payload),
                        format!("0x{}", hex::encode(&unsigned)),
                    ),
            )
            .into()
    }

    /// The signer's answer, passed back with what it signed (so the caller can assemble the
    /// signed transaction). A failed signature fails the request; nothing is claimed.
    #[private]
    pub fn on_signed(
        &mut self,
        generation: u32,
        payload: String,
        unsigned_tx: String,
        #[callback_result] signature: Result<Value, PromiseError>,
    ) -> Value {
        let Ok(sig) = signature else {
            env::panic_str("E_SIGN: the signer didn't sign")
        };
        json!({ "generation": generation, "path": path_for(generation), "payload": payload, "unsigned_tx": unsigned_tx, "signature": sig })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same bytes the app builds (server/src/evm.ts; server/test/evm.test.ts holds this hex).
    #[test]
    fn known_vector() {
        let tx = TxParams {
            nonce: U64(7),
            gas_limit: U64(80_000),
            max_fee_per_gas: U128(3_000_000_000),
            max_priority_fee_per_gas: U128(1_000_000_000),
        };
        let a = Action::SetController {
            to: format!("0x{}", "ab".repeat(20)),
            from_generation: 1,
        };
        let u = unsigned_tx(11155111, &[0x22; 20], &tx, &call_data(&a));
        println!("VECTOR {}", hex::encode(&u));
        println!("PAYLOAD {}", hex::encode(near_sdk::env::keccak256(&u)));
    }

    #[test]
    fn rlp_and_call_data_are_exact() {
        // RLP of small ints and empty values.
        let mut o = vec![];
        rlp_uint(&mut o, 0);
        assert_eq!(o, vec![0x80]);
        let mut o = vec![];
        rlp_uint(&mut o, 0x7f);
        assert_eq!(o, vec![0x7f]);
        let mut o = vec![];
        rlp_uint(&mut o, 1024);
        assert_eq!(o, vec![0x82, 0x04, 0x00]);
        // Selectors (well-known values).
        use sha3::{Digest, Keccak256};
        let k = Keccak256::digest(b"setController(address)");
        assert_eq!(selector("setController(address)"), [k[0], k[1], k[2], k[3]]);
        let d = call_data(&Action::Publish {
            digest: "11".repeat(32),
        });
        assert_eq!(d.len(), 36);
        let d = call_data(&Action::SetController {
            to: format!("0x{}", "ab".repeat(20)),
            from_generation: 1,
        });
        assert_eq!(&d[4..16], &[0u8; 12]);
        assert_eq!(&d[16..], &[0xab; 20]);
        // The transaction starts with the EIP-1559 type byte and a list.
        let tx = TxParams {
            nonce: U64(0),
            gas_limit: U64(60_000),
            max_fee_per_gas: U128(2_000_000_000),
            max_priority_fee_per_gas: U128(1_000_000_000),
        };
        let u = unsigned_tx(11155111, &[0x22; 20], &tx, &d);
        assert_eq!(u[0], 0x02);
        assert!(u[1] >= 0xc0);
    }
}
