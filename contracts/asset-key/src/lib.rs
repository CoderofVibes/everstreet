//! A companion to one business contract: control of one external asset (an EVM registry with a
//! single `controller` role) follows the business's owner, with no transfer step of its own.
//!
//! The business contract stays the only source of authority. On every request this contract asks
//! it `get_control()` and acts only if the caller is the owner at that moment. It then asks NEAR's
//! MPC signer to sign one narrowly typed EVM transaction, built here, never supplied by the caller:
//!
//! - `Publish { digest }`: `publish(bytes32)` on the registry, signed from the current
//!   generation's address (path `gen-<generation>`).
//! - `SetController { from_generation }`: `setController(<the current generation's address>)` on
//!   the registry, signed from the address of `from_generation` (an earlier generation). The
//!   destination is never the caller's choice: in the same promise chain this contract asks the
//!   signer's `derived_public_key` view for path `gen-<current generation>` and this account, and
//!   derives the EVM address itself (keccak256 of the 64-byte public key, last 20 bytes). This is
//!   how a buyer moves the role from the seller's address to their own after a close; the seller,
//!   no longer the owner, can't ask for anything, and while still the owner can only ever move the
//!   role to the business's own current address.
//!
//! Nonces: for each signing path this contract records the highest EVM nonce it has signed, and
//! signs nonce `n` for that path only if `n <= highest + 1` (the first signature for a path is
//! nonce 0). Re-signing a lower or equal nonce is allowed (a replacement transaction). An owner
//! about to sell can therefore hold at most one signed transaction past what was already signed for
//! the path, never a stockpile of future nonces. The highest nonce is recorded when the signature
//! request is sent.
//!
//! Each owner has their own address on the other chain because the generation is in the path.
//! After the buyer moves the role, anything signed earlier for the seller's address controls
//! nothing: the registry only accepts its controller. The external step is not final until the
//! destination chain says so; this contract proves who asked and what was signed, not that it
//! landed.
//!
//! A refusal returns the attached deposit and logs `asset_refused` with its code; nothing is
//! signed. Codes: `E_CONTROL_UNREAD` (the business couldn't be read), `E_NOT_OWNER`,
//! `E_GENERATION` (`from_generation` is 0, not yet reached, or the current one: nothing to move),
//! `E_NONCE` (beyond the highest signed nonce + 1 for that path), `E_DERIVE` (the current
//! generation's key couldn't be read or parsed), `E_SIGN` (the signer's receipt failed; the
//! deposit is returned to the caller). No keys on this account; no admin; no upgrade.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

const CONTROL_GAS: Gas = Gas::from_tgas(10);
/// The signer's `derived_public_key` view (one curve operation on the production signer).
const DERIVE_GAS: Gas = Gas::from_tgas(20);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// What the signer may use; the rest of the attached gas stays for the callbacks.
const SIGN_GAS: Gas = Gas::from_tgas(50);
/// `on_derived`: itself, then the sign call and `on_signed` (70 Tgas).
const ON_DERIVED_GAS: Gas = Gas::from_tgas(10 + 50 + 10);
/// `on_control`: itself, then (for a set-controller) the derive view and `on_derived`, or (for a
/// publish) the sign call and `on_signed` (100 Tgas).
const ON_CONTROL_GAS: Gas = Gas::from_tgas(10 + 20 + 70);
/// The longest answer read from the signer's `derived_public_key`.
const MAX_KEY_ANSWER: usize = 512;

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
    /// `setController(<the current generation's address>)`, signed from `from_generation`'s
    /// address. The destination is derived here, never supplied.
    SetController { from_generation: u32 },
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

#[derive(BorshStorageKey)]
#[near]
enum Key {
    NextNonce,
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
    /// Per generation (signing path): one past the highest EVM nonce signed so far. Absent: none
    /// signed yet, so only nonce 0 may be signed. One entry per generation that ever signed.
    next_nonce: LookupMap<u32, u64>,
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

/// The ABI call data for `publish(bytes32)`.
pub fn publish_data(digest: &str) -> Vec<u8> {
    let mut d = Vec::with_capacity(36);
    d.extend_from_slice(&selector("publish(bytes32)"));
    d.extend_from_slice(&hex_bytes::<32>(digest, "digest"));
    d
}

/// The ABI call data for `setController(address)`.
pub fn set_controller_data(to: &[u8; 20]) -> Vec<u8> {
    let mut d = Vec::with_capacity(36);
    d.extend_from_slice(&selector("setController(address)"));
    d.extend_from_slice(&[0u8; 12]);
    d.extend_from_slice(to);
    d
}

/// The EVM address of a 64-byte secp256k1 public key (x || y): the last 20 bytes of its keccak256.
pub fn evm_address(xy: &[u8; 64]) -> [u8; 20] {
    let h = env::keccak256(xy);
    let mut out = [0u8; 20];
    out.copy_from_slice(&h[12..]);
    out
}

/// The 64-byte public key (x || y) in a `derived_public_key` answer, which is a JSON string in
/// either of two formats: NEAR's production signer answers `"secp256k1:<base58 of x || y>"`, the
/// local test signer answers hex (`04 || x || y`, or `x || y`). Anything else is `None`.
pub fn parse_derived_key(answer: &[u8]) -> Option<[u8; 64]> {
    let s: String = serde_json::from_slice(answer).ok()?;
    let bytes = if let Some(b58) = s.strip_prefix("secp256k1:") {
        near_sdk::bs58::decode(b58).into_vec().ok()?
    } else {
        let h = s.strip_prefix("0x").unwrap_or(&s);
        let v = hex::decode(h).ok()?;
        match v.len() {
            65 if v[0] == 0x04 => v[1..].to_vec(),
            64 => v,
            _ => return None,
        }
    };
    bytes.try_into().ok()
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

/// A refusal: logs `asset_refused`, returns the deposit to the caller, signs nothing.
fn refusal(caller: &AccountId, deposit: NearToken, code: &str, why: &str) -> Value {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "asset-key", "version": "1.0.0", "event": "asset_refused", "data": [{ "caller": caller, "code": code }] })
    ));
    if !deposit.is_zero() {
        Promise::new(caller.clone()).transfer(deposit).detach();
    }
    json!({ "refused": code, "reason": why })
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
            next_nonce: LookupMap::new(Key::NextNonce),
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

    /// The highest EVM nonce signed so far for a generation's path (`null`: none yet). The next
    /// request for that path may use any nonce up to this + 1 (only 0 when `null`).
    pub fn get_signed_nonce(&self, generation: u32) -> Option<U64> {
        self.next_nonce.get(&generation).map(|n| U64(n - 1))
    }

    /// Exactly what a request would have signed: the unsigned transaction and its hash. Read-only;
    /// it doesn't check who may ask (the request does, at that moment). A set-controller's
    /// destination is derived by the request itself; here it is `to` (required for a
    /// set-controller, ignored for a publish): pass the current generation's address.
    pub fn preview(&self, action: Action, tx: TxParams, to: Option<String>) -> Value {
        let data = match &action {
            Action::Publish { digest } => publish_data(digest),
            Action::SetController { .. } => {
                let to = to.unwrap_or_else(|| env::panic_str("E_INPUT: `to` is required"));
                set_controller_data(&hex_bytes::<20>(&to, "to"))
            }
        };
        let unsigned = unsigned_tx(self.chain_id, &self.registry, &tx, &data);
        json!({
            "unsigned_tx": format!("0x{}", hex::encode(&unsigned)),
            "payload": hex::encode(env::keccak256(&unsigned)),
        })
    }

    /// Asks the business contract who owns it now, then (in `on_control`) signs only if the caller
    /// is that owner. The attached deposit pays the signer and is returned on any refusal.
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
        if let Action::Publish { digest } = &action {
            let _ = publish_data(digest);
        }
        Promise::new(self.business.clone())
            .function_call(
                "get_control".to_string(),
                b"{}".to_vec(),
                NearToken::from_yoctonear(0),
                CONTROL_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_CONTROL_GAS)
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
    ) -> PromiseOrValue<Value> {
        let refuse =
            |code: &str, why: &str| PromiseOrValue::Value(refusal(&caller, deposit, code, why));
        let Ok(c) = control else {
            return refuse("E_CONTROL_UNREAD", "the business contract couldn't be read");
        };
        if c.owner != caller {
            return refuse("E_NOT_OWNER", "only the business's current owner can ask");
        }
        match &action {
            Action::Publish { digest } => {
                if !self.nonce_allowed(c.generation, tx.nonce.0) {
                    return refuse("E_NONCE", "past the next nonce for this path");
                }
                let data = publish_data(digest);
                let generation = c.generation;
                self.sign(caller, deposit, generation, &c, &action, None, &tx, &data)
                    .into()
            }
            Action::SetController { from_generation } => {
                let from = *from_generation;
                if from == 0 || from > c.generation {
                    return refuse("E_GENERATION", "no such generation yet");
                }
                if from == c.generation {
                    return refuse(
                        "E_GENERATION",
                        "nothing to move: that is the current generation",
                    );
                }
                if !self.nonce_allowed(from, tx.nonce.0) {
                    return refuse("E_NONCE", "past the next nonce for this path");
                }
                // The destination: the current generation's own address, as the signer derives it
                // for this account.
                let args = json!({
                    "path": path_for(c.generation),
                    "predecessor": env::current_account_id(),
                    "domain_id": 0,
                });
                Promise::new(self.signer.clone())
                    .function_call(
                        "derived_public_key".to_string(),
                        serde_json::to_vec(&args).unwrap(),
                        NearToken::from_yoctonear(0),
                        DERIVE_GAS,
                    )
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(ON_DERIVED_GAS)
                            .on_derived(caller, deposit, from, c, tx),
                    )
                    .into()
            }
        }
    }

    /// The current generation's public key arrived: derive its address and sign
    /// `setController(<it>)` from `from_generation`'s path. The answer is read raw, so a malformed
    /// one is a refusal (`E_DERIVE`), never a panic (a panic here would keep the deposit).
    #[private]
    pub fn on_derived(
        &mut self,
        caller: AccountId,
        deposit: NearToken,
        from_generation: u32,
        control: ControlView,
        tx: TxParams,
    ) -> PromiseOrValue<Value> {
        let key = env::promise_result_checked(0, MAX_KEY_ANSWER)
            .ok()
            .and_then(|answer| parse_derived_key(&answer));
        let Some(key) = key else {
            return PromiseOrValue::Value(refusal(
                &caller,
                deposit,
                "E_DERIVE",
                "the current generation's key couldn't be read",
            ));
        };
        // Checked again at the moment of signing.
        if !self.nonce_allowed(from_generation, tx.nonce.0) {
            return PromiseOrValue::Value(refusal(
                &caller,
                deposit,
                "E_NONCE",
                "past the next nonce for this path",
            ));
        }
        let to = evm_address(&key);
        let action = Action::SetController { from_generation };
        let data = set_controller_data(&to);
        self.sign(
            caller,
            deposit,
            from_generation,
            &control,
            &action,
            Some(to),
            &tx,
            &data,
        )
        .into()
    }

    /// The signer's answer, passed back with what it signed (so the caller can assemble the
    /// signed transaction). A failed signature returns the deposit to the caller (`E_SIGN`).
    #[private]
    pub fn on_signed(
        &mut self,
        caller: AccountId,
        deposit: NearToken,
        generation: u32,
        payload: String,
        unsigned_tx: String,
        #[callback_result] signature: Result<Value, PromiseError>,
    ) -> Value {
        let Ok(sig) = signature else {
            return refusal(&caller, deposit, "E_SIGN", "the signer didn't sign");
        };
        json!({ "generation": generation, "path": path_for(generation), "payload": payload, "unsigned_tx": unsigned_tx, "signature": sig })
    }
}

impl AssetKey {
    fn nonce_allowed(&self, generation: u32, nonce: u64) -> bool {
        nonce <= self.next_nonce.get(&generation).copied().unwrap_or(0)
    }

    /// Records the nonce for the path and sends the signature request.
    #[allow(clippy::too_many_arguments)]
    fn sign(
        &mut self,
        caller: AccountId,
        deposit: NearToken,
        generation: u32,
        control: &ControlView,
        action: &Action,
        to: Option<[u8; 20]>,
        tx: &TxParams,
        data: &[u8],
    ) -> Promise {
        let unsigned = unsigned_tx(self.chain_id, &self.registry, tx, data);
        let payload = env::keccak256(&unsigned);
        let path = path_for(generation);
        self.signed += 1;
        let next = tx.nonce.0.saturating_add(1);
        if next > self.next_nonce.get(&generation).copied().unwrap_or(0) {
            self.next_nonce.insert(generation, next);
        }
        let mut event = json!({
            "caller": caller, "generation": generation, "owner_generation": control.generation,
            "control_seq": control.control_seq, "path": path, "payload": hex::encode(&payload),
            "nonce": tx.nonce, "action": action,
        });
        if let Some(to) = to {
            event["to"] = json!(format!("0x{}", hex::encode(to)));
        }
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({ "standard": "asset-key", "version": "1.0.0", "event": "asset_sign_requested", "data": [event] })
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
                        caller,
                        deposit,
                        generation,
                        hex::encode(&payload),
                        format!("0x{}", hex::encode(&unsigned)),
                    ),
            )
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
        let u = unsigned_tx(
            11155111,
            &[0x22; 20],
            &tx,
            &set_controller_data(&[0xab; 20]),
        );
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
        let d = publish_data(&"11".repeat(32));
        assert_eq!(d.len(), 36);
        let d = set_controller_data(&[0xab; 20]);
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

    /// Both answer formats of `derived_public_key` give the same 64 bytes, and the same address as
    /// an independent keccak.
    #[test]
    fn derived_key_formats_and_address() {
        use sha3::{Digest, Keccak256};
        let xy: Vec<u8> = (1..=64).collect();
        let prod = format!("secp256k1:{}", near_sdk::bs58::encode(&xy).into_string());
        let got = parse_derived_key(&serde_json::to_vec(&prod).unwrap()).unwrap();
        assert_eq!(got.to_vec(), xy);
        let mut uncompressed = vec![0x04];
        uncompressed.extend_from_slice(&xy);
        for h in [
            hex::encode(&uncompressed),
            hex::encode(&xy),
            format!("0x{}", hex::encode(&xy)),
        ] {
            assert_eq!(
                parse_derived_key(&serde_json::to_vec(&h).unwrap())
                    .unwrap()
                    .to_vec(),
                xy
            );
        }
        // The production format checks its curve and length; the hex one its prefix and length.
        let ed = format!(
            "ed25519:{}",
            near_sdk::bs58::encode(&xy[..32]).into_string()
        );
        assert!(parse_derived_key(&serde_json::to_vec(&ed).unwrap()).is_none());
        let short = format!(
            "secp256k1:{}",
            near_sdk::bs58::encode(&xy[..63]).into_string()
        );
        assert!(parse_derived_key(&serde_json::to_vec(&short).unwrap()).is_none());
        let mut bad_prefix = uncompressed.clone();
        bad_prefix[0] = 0x02;
        assert!(
            parse_derived_key(&serde_json::to_vec(&hex::encode(&bad_prefix)).unwrap()).is_none()
        );
        assert!(parse_derived_key(b"{\"x\":1}").is_none());
        assert!(parse_derived_key(b"not json").is_none());
        let k = Keccak256::digest(&xy);
        assert_eq!(evm_address(&got).to_vec(), k[12..].to_vec());
    }
}

#[cfg(test)]
mod attack_tests;
