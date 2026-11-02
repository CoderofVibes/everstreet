//! One business on NEAR, version 3 core (job 003e; docs/design/BUSINESS_V3_CORE.md).
//! Undeployed. Implements the accepted entitlement, storage and payout subset of the 003d
//! candidate only: no deals, close, freeze, closer, manifest, gateway or journal.
//!
//! Customers buy prepaid units of a plan at its immutable unit price (`ft_on_transfer`). Units
//! are locked only by a customer-signed hold (`HoldAuth`) and charged only by customer-signed
//! uses (`UseAuth`), each bound to the business, plan, customer, registration, key epoch and
//! hold. Unused units are always refundable at the plan price. Every money movement out goes
//! through one of 16 pre-allocated payout slots: money moves to pending before the transfer is
//! scheduled, and the private callback settles it or makes it the beneficiary's claim. Money in
//! the contract is always in exactly one bucket:
//!
//!   held = ent_free_value + ent_held_value + available + pending_total + claims_total
//!
//! Records are fixed-size, so rewrites never grow storage. Only `new`, `create_plan`,
//! `appoint_operator` and `sponsor_shell` grow state, and they charge the measured growth.
//! The FT receiver and the callback never allocate.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    borsh, env, near, require, serde_json, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

pub const N_SLOTS: usize = 10;
pub const KEY_SLOTS: usize = 4;
pub const PAYOUT_SLOTS: u8 = 16;
pub const PERIOD_RING: u8 = 24;
pub const MAX_PLANS: u32 = 32;
pub const MAX_OPERATORS: usize = 8;
/// Payouts in flight for one customer entitlement at once.
pub const MAX_CUSTOMER_PENDING: u8 = 2;
/// Largest purchase message accepted.
pub const MAX_MSG: usize = 1024;
/// A hold must leave at least this long to serve.
pub const MIN_SERVE_MS: u64 = 60_000;
const DAY_MS: u64 = 86_400_000;

pub const METERING: u8 = 1;
pub const SUPPORT: u8 = 2;

const KEY_EMPTY: u8 = 0;
const KEY_ACTIVE: u8 = 1;
const KEY_REVOKED: u8 = 2;
const SHELL: u8 = 0;
const ACTIVE: u8 = 1;

pub const SLOT_FREE: u8 = 0;
pub const SLOT_IN_FLIGHT: u8 = 1;
pub const SLOT_STRANDED: u8 = 2;
pub const KIND_REFUND: u8 = 0;
pub const KIND_CUSTOMER_CLAIM: u8 = 1;
pub const KIND_PARTY_CLAIM: u8 = 2;
pub const KIND_PROFIT: u8 = 3;

pub const HOLD_DOMAIN: &str = "business-hold/v1";
pub const USE_DOMAIN: &str = "business-use/v1";

const EVENT_STANDARD: &str = "business_core";
const EVENT_VERSION: &str = "3.0.0";
const TRANSFER_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Plans,
    Entitlements,
    Party,
    Slots,
    Periods,
}

// ---------- fixed-size records ----------

/// An account id padded to 64 bytes, so a record holding it is always the same size.
#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FixedAccount {
    len: u8,
    bytes: [u8; 64],
}

impl FixedAccount {
    pub fn of(a: &AccountId) -> Self {
        let s = a.as_bytes();
        require!(s.len() <= 64, "E_ARGS: account id longer than 64 bytes");
        let mut bytes = [0u8; 64];
        bytes[..s.len()].copy_from_slice(s);
        Self { len: s.len() as u8, bytes }
    }
    pub fn none() -> Self {
        Self { len: 0, bytes: [0u8; 64] }
    }
    pub fn account(&self) -> AccountId {
        std::str::from_utf8(&self.bytes[..self.len as usize])
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| env::panic_str("E_STATE: stored account is unreadable"))
    }
    pub fn is(&self, a: &AccountId) -> bool {
        self.len as usize == a.as_bytes().len() && &self.bytes[..self.len as usize] == a.as_bytes()
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeySlot {
    pub state: u8,
    pub epoch: u32,
    pub pk: [u8; 32],
    pub max_hold_units: u8,
    pub max_units_per_day: u16,
    pub day: u32,
    pub held_today: u16,
}

impl KeySlot {
    const fn empty() -> Self {
        Self { state: KEY_EMPTY, epoch: 0, pk: [0u8; 32], max_hold_units: 0, max_units_per_day: 0, day: 0, held_today: 0 }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hold {
    pub active: bool,
    pub seq: u32,
    pub key_slot: u8,
    pub key_epoch: u32,
    pub pk: [u8; 32],
    pub units: u8,
    pub opened_at_ms: u64,
    pub serve_until_ms: u64,
    pub settle_until_ms: u64,
    /// Bit i set: slot i was charged.
    pub used: u16,
    pub charged: u8,
    pub slots: [[u8; 32]; N_SLOTS],
}

impl Hold {
    const fn empty() -> Self {
        Self {
            active: false,
            seq: 0,
            key_slot: 0,
            key_epoch: 0,
            pk: [0u8; 32],
            units: 0,
            opened_at_ms: 0,
            serve_until_ms: 0,
            settle_until_ms: 0,
            used: 0,
            charged: 0,
            slots: [[0u8; 32]; N_SLOTS],
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClosedHold {
    pub seq: u32,
    pub used: u16,
    pub charged: u8,
    pub slots_root: [u8; 32],
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entitlement {
    pub reg_id: u64,
    pub status: u8,
    pub free: u64,
    pub consumed: u64,
    pub refunded: u64,
    pub purchased: u64,
    pub purchase_seq: u32,
    pub hold_seq: u32,
    pub hold: Hold,
    pub last_hold: ClosedHold,
    pub keys: [KeySlot; KEY_SLOTS],
    pub claim: u128,
    pub pending_refs: u8,
    pub paused: bool,
    /// A key was ever installed (then only the customer may unregister).
    pub ever_keyed: bool,
    pub storage_payer: FixedAccount,
    pub storage_paid: u128,
}

impl Entitlement {
    fn shell(reg_id: u64, payer: &AccountId) -> Self {
        Self {
            reg_id,
            status: SHELL,
            free: 0,
            consumed: 0,
            refunded: 0,
            purchased: 0,
            purchase_seq: 0,
            hold_seq: 0,
            hold: Hold::empty(),
            last_hold: ClosedHold { seq: 0, used: 0, charged: 0, slots_root: [0u8; 32] },
            keys: [KeySlot::empty(); KEY_SLOTS],
            claim: 0,
            pending_refs: 0,
            paused: false,
            ever_keyed: false,
            storage_payer: FixedAccount::of(payer),
            storage_paid: 0,
        }
    }
    /// Units in the active hold not yet charged.
    pub fn held_units(&self) -> u64 {
        if self.hold.active {
            (self.hold.units - self.hold.charged) as u64
        } else {
            0
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PartyRecord {
    pub claim: u128,
    pub pending_refs: u16,
    pub payer: FixedAccount,
    pub deposit: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayoutSlot {
    pub state: u8,
    pub kind: u8,
    pub amount: u128,
    pub started_at_ms: u64,
    pub to: FixedAccount,
    pub plan_id: u32,
    /// The beneficiary entitlement's registration, or 0 for a party record.
    pub reg_id: u64,
    /// Monotonic across the business; a callback must carry the same id.
    pub payout_id: u64,
}

impl PayoutSlot {
    const fn free() -> Self {
        Self {
            state: SLOT_FREE,
            kind: 0,
            amount: 0,
            started_at_ms: 0,
            to: FixedAccount { len: 0, bytes: [0u8; 64] },
            plan_id: 0,
            reg_id: 0,
            payout_id: 0,
        }
    }
}

/// One month's books, in a fixed ring entry tagged with its month.
#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Period {
    pub yyyymm: u32,
    pub purchases_in: u128,
    pub earned: u128,
    pub refunds_paid: u128,
    pub claims_paid: u128,
    pub owner_withdrawals: u128,
}

// ---------- plain-data inputs and configuration ----------

/// Ceilings any plan must respect; fixed at `new`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
    pub min_reserve: U128,
    pub max_hold_units: u8,
    pub max_hold_ttl_ms: U64,
    pub max_settle_grace_ms: U64,
}

/// A plan never changes after creation; a new price is a new plan.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub unit_price: U128,
    pub max_units_per_purchase: u32,
    pub max_units_outstanding: u32,
    pub max_hold_units: u8,
    pub hold_ttl_ms: U64,
    pub settle_grace_ms: U64,
    pub created_generation: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PlanInput {
    pub unit_price: U128,
    pub max_units_per_purchase: u32,
    pub max_units_outstanding: u32,
    pub max_hold_units: u8,
    pub hold_ttl_ms: U64,
    pub settle_grace_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct OperatorGrant {
    pub caps: u8,
    pub generation: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Install {
    pub slot: u8,
    /// ed25519 public key, 64 hex characters.
    pub pk: String,
    pub max_hold_units: u8,
    pub max_units_per_day: u16,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Buy {
    pub plan_id: u32,
    pub units: u32,
    pub purchase_seq: u32,
    pub install: Option<Install>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
enum Incoming {
    #[serde(rename = "buy")]
    Buy(Buy),
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct HoldAuth {
    pub hold_seq: u32,
    pub units: u8,
    pub serve_until_ms: U64,
    pub key_slot: u8,
    pub key_epoch: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct UseInput {
    pub slot: u8,
    /// 32-byte fingerprint, 64 hex characters.
    pub fingerprint: String,
    /// ed25519 signature, 128 hex characters.
    pub sig: String,
}

// ---------- views ----------

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct EntitlementView {
    pub reg_id: U64,
    pub active: bool,
    pub free: U64,
    pub consumed: U64,
    pub refunded: U64,
    pub purchased: U64,
    pub purchase_seq: u32,
    pub hold_seq: u32,
    pub hold_active: bool,
    pub hold_units: u8,
    pub hold_charged: u8,
    pub hold_used: u16,
    pub serve_until_ms: U64,
    pub settle_until_ms: U64,
    pub last_hold_seq: u32,
    pub last_hold_used: u16,
    pub last_hold_charged: u8,
    pub last_hold_root: String,
    pub key_states: Vec<u8>,
    pub key_epochs: Vec<u32>,
    pub claim: U128,
    pub pending_refs: u8,
    pub paused: bool,
    pub storage_payer: AccountId,
    pub storage_paid: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TreasuryView {
    pub asset: AccountId,
    pub held: U128,
    pub ent_free_value: U128,
    pub ent_held_value: U128,
    pub available: U128,
    pub withdrawable: U128,
    pub pending_total: U128,
    pub claims_total: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingView {
    pub slot: u8,
    pub state: String,
    pub kind: String,
    pub amount: U128,
    pub to: AccountId,
    pub plan_id: u32,
    pub payout_id: U64,
    pub started_at_ms: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PartyView {
    pub claim: U128,
    pub pending_refs: u16,
    pub deposit: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PeriodView {
    pub yyyymm: u32,
    pub purchases_in: U128,
    pub earned: U128,
    pub refunds_paid: U128,
    pub claims_paid: U128,
    pub owner_withdrawals: U128,
}

// ---------- helpers ----------

fn emit(event: &str, data: serde_json::Value) {
    let log = serde_json::json!({ "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{log}"));
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn assert_one_yocto() {
    require!(
        env::attached_deposit() == NearToken::from_yoctonear(1),
        "E_DEPOSIT: attach exactly 1 yoctoNEAR"
    );
}

fn hex32(s: &str) -> Option<[u8; 32]> {
    let v = hex::decode(s).ok()?;
    v.try_into().ok()
}

fn hex64(s: &str) -> Option<[u8; 64]> {
    let v = hex::decode(s).ok()?;
    v.try_into().ok()
}

/// The UTC month of a millisecond timestamp, as yyyymm.
pub fn period_of(ms: u64) -> u32 {
    let days = (ms / DAY_MS) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year * 100 + m) as u32
}

/// Where a month lives in the ring.
pub fn ring_index(yyyymm: u32) -> u8 {
    let months = (yyyymm / 100) * 12 + (yyyymm % 100 - 1);
    (months % PERIOD_RING as u32) as u8
}

/// The exact bytes a customer's use-key signs to authorize a hold.
#[allow(clippy::too_many_arguments)]
pub fn hold_message(
    business: &AccountId,
    plan_id: u32,
    customer: &AccountId,
    reg_id: u64,
    key_slot: u8,
    key_epoch: u32,
    hold_seq: u32,
    units: u8,
    serve_until_ms: u64,
) -> [u8; 32] {
    let bytes = borsh::to_vec(&(
        HOLD_DOMAIN,
        business.as_str(),
        plan_id,
        customer.as_str(),
        reg_id,
        key_slot,
        key_epoch,
        hold_seq,
        units,
        serve_until_ms,
    ))
    .unwrap_or_else(|_| env::panic_str("E_STATE: cannot encode"));
    env::sha256_array(&bytes)
}

/// The exact bytes a customer's use-key signs to authorize one use in one hold slot.
#[allow(clippy::too_many_arguments)]
pub fn use_message(
    business: &AccountId,
    plan_id: u32,
    customer: &AccountId,
    reg_id: u64,
    key_slot: u8,
    key_epoch: u32,
    hold_seq: u32,
    slot: u8,
    fingerprint: &[u8; 32],
) -> [u8; 32] {
    let bytes = borsh::to_vec(&(
        USE_DOMAIN,
        business.as_str(),
        plan_id,
        customer.as_str(),
        reg_id,
        key_slot,
        key_epoch,
        hold_seq,
        slot,
        *fingerprint,
    ))
    .unwrap_or_else(|_| env::panic_str("E_STATE: cannot encode"));
    env::sha256_array(&bytes)
}

fn mul(units: u64, price: u128) -> u128 {
    (units as u128).checked_mul(price).unwrap_or_else(|| env::panic_str("E_OVERFLOW"))
}

fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).unwrap_or_else(|| env::panic_str("E_OVERFLOW"))
}

fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).unwrap_or_else(|| env::panic_str("E_INVARIANT: bucket would go negative"))
}

// ---------- the contract ----------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Business {
    name: String,
    asset: AccountId,
    rules: Rules,
    owner: AccountId,
    generation: u32,
    operators: Vec<(AccountId, OperatorGrant)>,
    plans: LookupMap<u32, Plan>,
    plan_count: u32,
    entitlements: LookupMap<(AccountId, u32), Entitlement>,
    party: LookupMap<AccountId, PartyRecord>,
    slots: LookupMap<u8, PayoutSlot>,
    periods: LookupMap<u8, Period>,
    reg_seq: u64,
    payout_seq: u64,
    held: u128,
    ent_free_value: u128,
    ent_held_value: u128,
    available: u128,
    pending_total: u128,
    claims_total: u128,
}

#[near]
impl Business {
    // ---------- setup ----------

    /// Pre-allocates the payout slots, the period ring and the founder's party record.
    #[init]
    pub fn new(name: String, owner: AccountId, asset: AccountId, rules: Rules) -> Self {
        require!(!name.is_empty() && name.len() <= 64, "E_ARGS: name is 1-64 characters");
        require!(
            rules.max_hold_units >= 1 && rules.max_hold_units as usize <= N_SLOTS,
            "E_ARGS: hold units ceiling must be 1 to 10"
        );
        let mut b = Self {
            name,
            asset,
            rules,
            owner: owner.clone(),
            generation: 1,
            operators: Vec::new(),
            plans: LookupMap::new(StorageKey::Plans),
            plan_count: 0,
            entitlements: LookupMap::new(StorageKey::Entitlements),
            party: LookupMap::new(StorageKey::Party),
            slots: LookupMap::new(StorageKey::Slots),
            periods: LookupMap::new(StorageKey::Periods),
            reg_seq: 0,
            payout_seq: 0,
            held: 0,
            ent_free_value: 0,
            ent_held_value: 0,
            available: 0,
            pending_total: 0,
            claims_total: 0,
        };
        for i in 0..PAYOUT_SLOTS {
            b.slots.insert(i, PayoutSlot::free());
        }
        for i in 0..PERIOD_RING {
            b.periods.insert(i, Period::default());
        }
        b.party.insert(owner.clone(), PartyRecord { claim: 0, pending_refs: 0, payer: FixedAccount::of(&owner), deposit: 0 });
        emit("business_created", serde_json::json!({ "owner": owner, "generation": 1 }));
        b
    }

    /// Creates an immutable plan (owner only). Charges the measured storage growth.
    #[payable]
    pub fn create_plan(&mut self, input: PlanInput) -> u32 {
        self.require_owner();
        require!(self.plan_count < MAX_PLANS, "E_LIMIT: at most 32 plans");
        require!(input.unit_price.0 > 0, "E_ARGS: unit price must be above 0");
        require!(input.max_units_per_purchase >= 1, "E_ARGS: allow at least 1 unit per purchase");
        require!(
            input.max_units_outstanding >= input.max_units_per_purchase,
            "E_ARGS: outstanding cap below the purchase cap"
        );
        require!(
            input.max_hold_units >= 1 && input.max_hold_units <= self.rules.max_hold_units,
            "E_ARGS: hold units outside the rules"
        );
        require!(input.hold_ttl_ms.0 >= MIN_SERVE_MS && input.hold_ttl_ms.0 <= self.rules.max_hold_ttl_ms.0, "E_ARGS: hold ttl outside the rules");
        require!(input.settle_grace_ms.0 <= self.rules.max_settle_grace_ms.0, "E_ARGS: settle grace outside the rules");
        let before = env::storage_usage();
        self.plan_count += 1;
        let id = self.plan_count;
        self.plans.insert(
            id,
            Plan {
                unit_price: input.unit_price,
                max_units_per_purchase: input.max_units_per_purchase,
                max_units_outstanding: input.max_units_outstanding,
                max_hold_units: input.max_hold_units,
                hold_ttl_ms: input.hold_ttl_ms,
                settle_grace_ms: input.settle_grace_ms,
                created_generation: self.generation,
            },
        );
        self.plans.flush();
        self.charge_growth(before, 0);
        emit("plan_created", serde_json::json!({ "plan_id": id, "unit_price": input.unit_price }));
        id
    }

    /// Grants capabilities to an operator for the current generation (owner only).
    #[payable]
    pub fn appoint_operator(&mut self, account: AccountId, caps: u8) {
        self.require_owner();
        require!(caps != 0 && caps & !(METERING | SUPPORT) == 0, "E_ARGS: capabilities are METERING (1) and SUPPORT (2)");
        let grant = OperatorGrant { caps, generation: self.generation };
        let existing = self.operators.iter().position(|(a, _)| *a == account);
        // The root record grows by exactly the new entry's encoded size; charged before any change.
        let added = match existing {
            Some(_) => 0,
            None => {
                require!(self.operators.len() < MAX_OPERATORS, "E_LIMIT: at most 8 operators");
                borsh::to_vec(&(&account, &grant)).unwrap_or_default().len() as u64
            }
        };
        self.charge_bytes(added);
        match existing {
            Some(i) => self.operators[i].1 = grant,
            None => self.operators.push((account.clone(), grant)),
        }
        emit("operator_appointed", serde_json::json!({ "account": account, "caps": caps, "generation": self.generation }));
    }

    #[payable]
    pub fn revoke_operator(&mut self, account: AccountId) {
        assert_one_yocto();
        self.require_owner();
        self.operators.retain(|(a, _)| *a != account);
        emit("operator_revoked", serde_json::json!({ "account": account }));
    }

    // ---------- entitlements ----------

    /// Creates an empty entitlement record (a shell) for a customer and plan. Anyone may pay for
    /// it; paying grants no authority over it. Charges the measured storage growth.
    #[payable]
    pub fn sponsor_shell(&mut self, customer: AccountId, plan_id: u32) -> U64 {
        require!(self.plans.contains_key(&plan_id), "E_ARGS: no such plan");
        let key = (customer.clone(), plan_id);
        require!(!self.entitlements.contains_key(&key), "E_EXISTS: already registered");
        let payer = env::predecessor_account_id();
        let before = env::storage_usage();
        self.reg_seq += 1;
        let reg_id = self.reg_seq;
        self.entitlements.insert(key.clone(), Entitlement::shell(reg_id, &payer));
        self.entitlements.flush();
        let cost = self.charge_growth(before, 0);
        // Record what was paid (a same-size rewrite).
        let mut e = *self.entitlements.get(&key).unwrap();
        e.storage_paid = cost;
        self.entitlements.insert(key, e);
        self.entitlements.flush();
        emit("shell_sponsored", serde_json::json!({ "customer": customer, "plan_id": plan_id, "reg_id": U64(reg_id), "payer": payer }));
        U64(reg_id)
    }

    /// The token calls this after `ft_transfer_call`. A purchase is validated completely before
    /// anything changes; anything invalid (malformed, wrong amount, replayed sequence, missing
    /// record, over a cap, overflow) returns the whole amount with no state change.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.asset, "E_ASSET: this business only accepts its own token");
        match self.validate_buy(&sender_id, amount.0, &msg) {
            Err(reason) => {
                emit("purchase_returned", serde_json::json!({ "customer": sender_id, "amount": amount, "reason": reason }));
                PromiseOrValue::Value(amount)
            }
            Ok((key, e, units, install)) => {
                let mut e = e;
                e.free += units;
                e.purchased += units;
                e.purchase_seq += 1;
                e.status = ACTIVE;
                if let Some((slot, pk, max_hold_units, max_units_per_day)) = install {
                    let k = &mut e.keys[slot as usize];
                    k.epoch += 1;
                    k.state = KEY_ACTIVE;
                    k.pk = pk;
                    k.max_hold_units = max_hold_units;
                    k.max_units_per_day = max_units_per_day;
                    e.ever_keyed = true;
                }
                self.entitlements.insert(key.clone(), e);
                self.held += amount.0;
                self.ent_free_value += amount.0;
                self.book(|p| p.purchases_in = p.purchases_in.saturating_add(amount.0));
                self.check();
                emit("units_bought", serde_json::json!({ "customer": key.0, "plan_id": key.1, "units": units, "amount": amount }));
                PromiseOrValue::Value(U128(0))
            }
        }
    }

    /// Installs a use-key. Only the customer's own account can (a sponsor cannot).
    #[payable]
    pub fn install_key(&mut self, plan_id: u32, slot: u8, pk: String, max_hold_units: u8, max_units_per_day: u16) {
        assert_one_yocto();
        let plan = self.plan(plan_id);
        let (key, mut e) = self.own_entitlement(plan_id);
        require!((slot as usize) < KEY_SLOTS, "E_ARGS: key slot 0-3");
        require!(e.keys[slot as usize].state != KEY_ACTIVE, "E_KEY: that key slot is in use");
        let pk = hex32(&pk).unwrap_or_else(|| env::panic_str("E_ARGS: public key is 64 hex characters"));
        require!(max_hold_units >= 1 && max_hold_units <= plan.max_hold_units, "E_ARGS: hold units outside the plan");
        require!(max_units_per_day >= 1, "E_ARGS: allow at least 1 unit a day");
        let k = &mut e.keys[slot as usize];
        k.epoch = k.epoch.checked_add(1).unwrap_or_else(|| env::panic_str("E_OVERFLOW: key epoch"));
        k.state = KEY_ACTIVE;
        k.pk = pk;
        k.max_hold_units = max_hold_units;
        k.max_units_per_day = max_units_per_day;
        // The slot's count for today carries over: reinstalling does not reset the daily cap.
        e.ever_keyed = true;
        self.entitlements.insert(key, e);
        emit("key_installed", serde_json::json!({ "plan_id": plan_id, "slot": slot, "epoch": e.keys[slot as usize].epoch }));
    }

    /// Revokes a use-key. If it authorized the active hold, that hold stops serving now; uses
    /// already signed stay settleable until the hold's settle deadline.
    #[payable]
    pub fn revoke_key(&mut self, plan_id: u32, slot: u8) {
        assert_one_yocto();
        let (key, mut e) = self.own_entitlement(plan_id);
        require!((slot as usize) < KEY_SLOTS, "E_ARGS: key slot 0-3");
        require!(e.keys[slot as usize].state == KEY_ACTIVE, "E_KEY: that key is not active");
        e.keys[slot as usize].epoch =
            e.keys[slot as usize].epoch.checked_add(1).unwrap_or_else(|| env::panic_str("E_OVERFLOW: key epoch"));
        e.keys[slot as usize].state = KEY_REVOKED;
        if e.hold.active && e.hold.key_slot == slot {
            e.hold.serve_until_ms = e.hold.serve_until_ms.min(now_ms());
        }
        self.entitlements.insert(key, e);
        emit("key_revoked", serde_json::json!({ "plan_id": plan_id, "slot": slot }));
    }

    /// Burns the next hold sequence, invalidating a signed but unsubmitted HoldAuth.
    #[payable]
    pub fn skip_hold_seq(&mut self, plan_id: u32) {
        assert_one_yocto();
        let (key, mut e) = self.own_entitlement(plan_id);
        require!(!e.hold.active, "E_HOLD_ACTIVE: close the active hold first");
        e.hold_seq = e.hold_seq.checked_add(1).unwrap_or_else(|| env::panic_str("E_OVERFLOW"));
        self.entitlements.insert(key, e);
    }

    #[payable]
    pub fn set_paused(&mut self, plan_id: u32, paused: bool) {
        assert_one_yocto();
        let (key, mut e) = self.own_entitlement(plan_id);
        e.paused = paused;
        self.entitlements.insert(key, e);
    }

    /// Deletes an entitlement with nothing left in it and returns its storage deposit to whoever
    /// paid. The customer may; the sponsor may only for a shell never bought or keyed.
    #[payable]
    pub fn unregister(&mut self, customer: AccountId, plan_id: u32) {
        assert_one_yocto();
        let key = (customer.clone(), plan_id);
        let e = *self.entitlements.get(&key).unwrap_or_else(|| env::panic_str("E_ARGS: no such entitlement"));
        let caller = env::predecessor_account_id();
        let allowed = caller == customer || (e.storage_payer.is(&caller) && e.purchased == 0 && !e.ever_keyed);
        require!(allowed, "E_NOT_CUSTOMER: only the customer can unregister this");
        require!(e.free == 0, "E_UNITS: refund the free units first");
        require!(!e.hold.active, "E_HOLD_ACTIVE: a hold is open");
        require!(e.claim == 0, "E_CLAIM: collect the claim first");
        require!(e.pending_refs == 0, "E_PENDING_REFS: a payout is in flight");
        self.entitlements.remove(&key);
        emit("unregistered", serde_json::json!({ "customer": customer, "plan_id": plan_id, "reg_id": U64(e.reg_id) }));
        if e.storage_paid > 0 {
            Promise::new(e.storage_payer.account()).transfer(NearToken::from_yoctonear(e.storage_paid)).detach();
        }
    }

    // ---------- holds ----------

    /// Locks units under a customer-signed HoldAuth (METERING operator of this generation, or
    /// the owner). Returns "opened", or "already" for the identical active hold.
    pub fn open_hold(&mut self, customer: AccountId, plan_id: u32, auth: HoldAuth, sig: String) -> String {
        self.require_metering();
        let plan = self.plan(plan_id);
        let key = (customer.clone(), plan_id);
        let mut e = self.entitlement(&key);
        let k_idx = auth.key_slot as usize;
        if e.hold.active
            && e.hold.seq == auth.hold_seq
            && e.hold.units == auth.units
            && e.hold.serve_until_ms == auth.serve_until_ms.0
            && e.hold.key_slot == auth.key_slot
            && e.hold.key_epoch == auth.key_epoch
        {
            return "already".into();
        }
        require!(auth.hold_seq > e.hold_seq, "E_HOLD_SEQ_USED: that hold sequence was already used");
        require!(e.status == ACTIVE, "E_STATE: nothing bought yet");
        require!(!e.paused, "E_PAUSED: the customer paused new holds");
        require!(!e.hold.active, "E_HOLD_ACTIVE: a hold is already open");
        require!(Some(auth.hold_seq) == e.hold_seq.checked_add(1), "E_HOLD_SEQ: the next hold sequence is required");
        require!(k_idx < KEY_SLOTS, "E_KEY: no such key slot");
        let k = e.keys[k_idx];
        require!(k.state == KEY_ACTIVE && k.epoch == auth.key_epoch, "E_KEY: key not active at that epoch");
        let sig = hex64(&sig).unwrap_or_else(|| env::panic_str("E_SIG: signature is 128 hex characters"));
        let msg = hold_message(
            &env::current_account_id(),
            plan_id,
            &customer,
            e.reg_id,
            auth.key_slot,
            auth.key_epoch,
            auth.hold_seq,
            auth.units,
            auth.serve_until_ms.0,
        );
        require!(env::ed25519_verify(&sig, msg, &k.pk), "E_SIG: the hold is not signed by that key");
        let max = (k.max_hold_units as u64).min(plan.max_hold_units as u64).min(N_SLOTS as u64).min(e.free);
        require!(auth.units >= 1 && auth.units as u64 <= max, "E_UNITS: hold size not allowed");
        let now = now_ms();
        require!(auth.serve_until_ms.0 >= now + MIN_SERVE_MS, "E_EXPIRED: the hold would end too soon");
        require!(auth.serve_until_ms.0 <= now + plan.hold_ttl_ms.0, "E_TTL: the hold would run past the plan's limit");
        let day = (now / DAY_MS) as u32;
        let held_today = if k.day == day { k.held_today } else { 0 };
        require!(
            held_today as u32 + auth.units as u32 <= k.max_units_per_day as u32,
            "E_DAILY_CAP: over the key's daily limit"
        );
        let value = mul(auth.units as u64, plan.unit_price.0);
        e.keys[k_idx].day = day;
        e.keys[k_idx].held_today = held_today + auth.units as u16;
        e.hold = Hold {
            active: true,
            seq: auth.hold_seq,
            key_slot: auth.key_slot,
            key_epoch: auth.key_epoch,
            pk: k.pk,
            units: auth.units,
            opened_at_ms: now,
            serve_until_ms: auth.serve_until_ms.0,
            settle_until_ms: auth.serve_until_ms.0 + plan.settle_grace_ms.0,
            used: 0,
            charged: 0,
            slots: [[0u8; 32]; N_SLOTS],
        };
        e.hold_seq = auth.hold_seq;
        e.free -= auth.units as u64;
        self.entitlements.insert(key, e);
        self.ent_free_value = sub(self.ent_free_value, value);
        self.ent_held_value = add(self.ent_held_value, value);
        self.check();
        emit("hold_opened", serde_json::json!({ "customer": customer, "plan_id": plan_id, "hold_seq": auth.hold_seq, "units": auth.units }));
        "opened".into()
    }

    /// Charges customer-signed uses into the active hold. The whole batch is checked before
    /// anything changes: a conflicting fingerprint panics with nothing charged. The same use
    /// again returns "already". `close` ends the hold and returns the rest to free units.
    pub fn settle_hold(&mut self, customer: AccountId, plan_id: u32, hold_seq: u32, uses: Vec<UseInput>, close: bool) -> Vec<String> {
        self.require_metering();
        let plan = self.plan(plan_id);
        let key = (customer.clone(), plan_id);
        let mut e = self.entitlement(&key);
        require!(e.hold.active && e.hold.seq == hold_seq, "E_HOLD_CLOSED: that hold is not active");
        require!(now_ms() <= e.hold.settle_until_ms, "E_EXPIRED: past the hold's settle deadline");
        require!(uses.len() <= e.hold.units as usize, "E_BATCH: more uses than the hold has units");
        // Pass 1: validate everything on a copy.
        let mut used = e.hold.used;
        let mut slots = e.hold.slots;
        let mut out = Vec::with_capacity(uses.len());
        let mut newly: u8 = 0;
        let business = env::current_account_id();
        for u in &uses {
            require!(u.slot < e.hold.units, "E_SLOT: slot outside the hold");
            let fp = hex32(&u.fingerprint).unwrap_or_else(|| env::panic_str("E_ARGS: fingerprint is 64 hex characters"));
            let sig = hex64(&u.sig).unwrap_or_else(|| env::panic_str("E_SIG: signature is 128 hex characters"));
            let msg = use_message(&business, plan_id, &customer, e.reg_id, e.hold.key_slot, e.hold.key_epoch, hold_seq, u.slot, &fp);
            require!(env::ed25519_verify(&sig, msg, &e.hold.pk), "E_SIG: the use is not signed for this hold");
            let bit = 1u16 << u.slot;
            if used & bit != 0 {
                if slots[u.slot as usize] == fp {
                    out.push("already".to_string());
                } else {
                    env::panic_str(&format!("E_CONFLICT({}): a different use already charged this slot", u.slot));
                }
            } else {
                used |= bit;
                slots[u.slot as usize] = fp;
                newly += 1;
                out.push("charged".to_string());
            }
        }
        // Pass 2: apply.
        let value = mul(newly as u64, plan.unit_price.0);
        e.hold.used = used;
        e.hold.slots = slots;
        e.hold.charged += newly;
        e.consumed += newly as u64;
        self.ent_held_value = sub(self.ent_held_value, value);
        self.available = add(self.available, value);
        if value > 0 {
            self.book(|p| p.earned = p.earned.saturating_add(value));
        }
        if close {
            self.close_hold(&mut e, plan.unit_price.0);
        }
        self.entitlements.insert(key, e);
        self.check();
        emit("hold_settled", serde_json::json!({ "customer": customer, "plan_id": plan_id, "hold_seq": hold_seq, "charged": newly, "closed": close }));
        out
    }

    /// Closes an active hold: an operator any time, anyone once its settle deadline has passed.
    pub fn release_hold(&mut self, customer: AccountId, plan_id: u32, hold_seq: u32) {
        let plan = self.plan(plan_id);
        let key = (customer.clone(), plan_id);
        let mut e = self.entitlement(&key);
        require!(e.hold.active && e.hold.seq == hold_seq, "E_HOLD_CLOSED: that hold is not active");
        if now_ms() <= e.hold.settle_until_ms {
            self.require_metering();
        }
        self.close_hold(&mut e, plan.unit_price.0);
        self.entitlements.insert(key, e);
        self.check();
        emit("hold_released", serde_json::json!({ "customer": customer, "plan_id": plan_id, "hold_seq": hold_seq }));
    }

    // ---------- money out ----------

    /// Refunds unused units at the plan's fixed price.
    #[payable]
    pub fn refund_units(&mut self, plan_id: u32, units: U64) -> Promise {
        assert_one_yocto();
        let plan = self.plan(plan_id);
        let (key, mut e) = self.own_entitlement(plan_id);
        require!(units.0 >= 1 && units.0 <= e.free, "E_UNITS: more than the free units");
        require!(e.pending_refs < MAX_CUSTOMER_PENDING, "E_PENDING_REFS: two payouts already in flight");
        let amount = mul(units.0, plan.unit_price.0);
        let slot = self.free_slot();
        e.free -= units.0;
        e.refunded += units.0;
        e.pending_refs += 1;
        let reg_id = e.reg_id;
        self.entitlements.insert(key.clone(), e);
        self.ent_free_value = sub(self.ent_free_value, amount);
        self.start_payout(slot, KIND_REFUND, &key.0, plan_id, reg_id, amount)
    }

    /// Pays a customer's claim (from a failed refund or claim payout).
    #[payable]
    pub fn claim_customer(&mut self, plan_id: u32) -> Promise {
        assert_one_yocto();
        let (key, mut e) = self.own_entitlement(plan_id);
        require!(e.claim > 0, "E_FUNDS: nothing to claim");
        require!(e.pending_refs < MAX_CUSTOMER_PENDING, "E_PENDING_REFS: two payouts already in flight");
        let slot = self.free_slot();
        let amount = e.claim;
        e.claim = 0;
        e.pending_refs += 1;
        let reg_id = e.reg_id;
        self.entitlements.insert(key.clone(), e);
        self.claims_total = sub(self.claims_total, amount);
        self.start_payout(slot, KIND_CUSTOMER_CLAIM, &key.0, plan_id, reg_id, amount)
    }

    /// The owner withdraws earned money above the reserve.
    #[payable]
    pub fn withdraw_profit(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let owner = self.require_owner();
        let mut r = *self.party.get(&owner).unwrap_or_else(|| env::panic_str("E_NO_RECORD: the owner has no party record"));
        let withdrawable = self.available.saturating_sub(self.rules.min_reserve.0);
        require!(amount.0 > 0 && amount.0 <= withdrawable, format!("E_RESERVED: {withdrawable} can be withdrawn"));
        let slot = self.free_slot();
        r.pending_refs += 1;
        self.party.insert(owner.clone(), r);
        self.available = sub(self.available, amount.0);
        self.start_payout(slot, KIND_PROFIT, &owner, 0, 0, amount.0)
    }

    /// A party (a current or former owner) collects a claim from a failed payout.
    #[payable]
    pub fn claim_party(&mut self) -> Promise {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let mut r = *self.party.get(&who).unwrap_or_else(|| env::panic_str("E_NO_RECORD: no party record"));
        require!(r.claim > 0, "E_FUNDS: nothing to claim");
        let slot = self.free_slot();
        let amount = r.claim;
        r.claim = 0;
        r.pending_refs += 1;
        self.party.insert(who.clone(), r);
        self.claims_total = sub(self.claims_total, amount);
        self.start_payout(slot, KIND_PARTY_CLAIM, &who, 0, 0, amount)
    }

    /// Settles a payout once the transfer's outcome is known. Never panics on an expected
    /// outcome and never allocates: a callback for a slot that isn't in flight with this payout
    /// id (an old or repeated callback) changes nothing.
    #[private]
    pub fn on_payout(&mut self, slot_id: u8, payout_id: U64) -> bool {
        let Some(slot) = self.slots.get(&slot_id).copied() else {
            emit("payout_mismatch", serde_json::json!({ "slot": slot_id, "payout_id": payout_id }));
            return false;
        };
        if slot.state != SLOT_IN_FLIGHT || slot.payout_id != payout_id.0 {
            emit("payout_mismatch", serde_json::json!({ "slot": slot_id, "payout_id": payout_id, "current": U64(slot.payout_id) }));
            return false;
        }
        let ok = near_sdk::is_promise_success();
        let to = slot.to.account();
        let a = slot.amount;
        let has_record = if slot.reg_id != 0 {
            self.entitlements.get(&(to.clone(), slot.plan_id)).is_some_and(|e| e.reg_id == slot.reg_id)
        } else {
            self.party.contains_key(&to)
        };
        if ok {
            self.held = sub(self.held, a);
            self.pending_total = sub(self.pending_total, a);
            if has_record {
                self.unref(&slot, 0);
            }
            match slot.kind {
                KIND_REFUND => self.book(|p| p.refunds_paid = p.refunds_paid.saturating_add(a)),
                KIND_PROFIT => self.book(|p| p.owner_withdrawals = p.owner_withdrawals.saturating_add(a)),
                _ => self.book(|p| p.claims_paid = p.claims_paid.saturating_add(a)),
            }
            self.slots.insert(slot_id, PayoutSlot::free());
        } else if has_record {
            // The money never left: it becomes the fixed beneficiary's claim, never available.
            self.pending_total = sub(self.pending_total, a);
            self.claims_total = add(self.claims_total, a);
            self.unref(&slot, a);
            self.slots.insert(slot_id, PayoutSlot::free());
        } else {
            // Unreachable while P1-P2 hold; kept safe: the amount stays pending, recoverable by
            // the beneficiary through `claim_stranded`.
            let mut s = slot;
            s.state = SLOT_STRANDED;
            self.slots.insert(slot_id, s);
        }
        self.check();
        emit("payout_settled", serde_json::json!({ "slot": slot_id, "payout_id": payout_id, "ok": ok, "amount": U128(a) }));
        ok
    }

    /// The beneficiary of a stranded payout re-sends it through the same slot.
    #[payable]
    pub fn claim_stranded(&mut self, slot_id: u8) -> Promise {
        assert_one_yocto();
        let mut s = *self.slots.get(&slot_id).unwrap_or_else(|| env::panic_str("E_ARGS: no such slot"));
        require!(s.state == SLOT_STRANDED, "E_STATE: that slot is not stranded");
        require!(s.to.is(&env::predecessor_account_id()), "E_NOT_BENEFICIARY: only the payout's beneficiary");
        self.payout_seq += 1;
        s.state = SLOT_IN_FLIGHT;
        s.payout_id = self.payout_seq;
        s.started_at_ms = now_ms();
        self.slots.insert(slot_id, s);
        self.check();
        self.transfer(slot_id, &s)
    }

    /// A former owner deletes their party record once nothing is owed or in flight.
    #[payable]
    pub fn release_party_slot(&mut self) {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        require!(who != self.owner, "E_OWNER: the owner keeps their record");
        let r = *self.party.get(&who).unwrap_or_else(|| env::panic_str("E_NO_RECORD: no party record"));
        require!(r.pending_refs == 0, "E_PENDING_REFS: a payout to you is in flight");
        require!(r.claim == 0, "E_CLAIM: collect your claim first");
        self.party.remove(&who);
        emit("party_released", serde_json::json!({ "account": who }));
        if r.deposit > 0 {
            Promise::new(r.payer.account()).transfer(NearToken::from_yoctonear(r.deposit)).detach();
        }
    }

    // ---------- views ----------

    pub fn get_plan(&self, plan_id: u32) -> Option<Plan> {
        self.plans.get(&plan_id).cloned()
    }

    pub fn get_entitlement(&self, customer: AccountId, plan_id: u32) -> Option<EntitlementView> {
        self.entitlements.get(&(customer, plan_id)).map(|e| EntitlementView {
            reg_id: U64(e.reg_id),
            active: e.status == ACTIVE,
            free: U64(e.free),
            consumed: U64(e.consumed),
            refunded: U64(e.refunded),
            purchased: U64(e.purchased),
            purchase_seq: e.purchase_seq,
            hold_seq: e.hold_seq,
            hold_active: e.hold.active,
            hold_units: e.hold.units,
            hold_charged: e.hold.charged,
            hold_used: e.hold.used,
            serve_until_ms: U64(e.hold.serve_until_ms),
            settle_until_ms: U64(e.hold.settle_until_ms),
            last_hold_seq: e.last_hold.seq,
            last_hold_used: e.last_hold.used,
            last_hold_charged: e.last_hold.charged,
            last_hold_root: hex::encode(e.last_hold.slots_root),
            key_states: e.keys.iter().map(|k| k.state).collect(),
            key_epochs: e.keys.iter().map(|k| k.epoch).collect(),
            claim: U128(e.claim),
            pending_refs: e.pending_refs,
            paused: e.paused,
            storage_payer: e.storage_payer.account(),
            storage_paid: U128(e.storage_paid),
        })
    }

    pub fn get_treasury(&self) -> TreasuryView {
        TreasuryView {
            asset: self.asset.clone(),
            held: U128(self.held),
            ent_free_value: U128(self.ent_free_value),
            ent_held_value: U128(self.ent_held_value),
            available: U128(self.available),
            withdrawable: U128(self.available.saturating_sub(self.rules.min_reserve.0)),
            pending_total: U128(self.pending_total),
            claims_total: U128(self.claims_total),
        }
    }

    /// Every payout in flight or stranded. A payout whose callback never ran stays listed here
    /// with its amount still pending; nothing resolves it by guessing.
    pub fn get_pending(&self) -> Vec<PendingView> {
        (0..PAYOUT_SLOTS)
            .filter_map(|i| self.slots.get(&i).map(|s| (i, *s)))
            .filter(|(_, s)| s.state != SLOT_FREE)
            .map(|(i, s)| PendingView {
                slot: i,
                state: if s.state == SLOT_IN_FLIGHT { "in_flight".into() } else { "stranded".into() },
                kind: ["refund", "customer_claim", "party_claim", "profit"][s.kind as usize].into(),
                amount: U128(s.amount),
                to: s.to.account(),
                plan_id: s.plan_id,
                payout_id: U64(s.payout_id),
                started_at_ms: U64(s.started_at_ms),
            })
            .collect()
    }

    pub fn get_party(&self, account: AccountId) -> Option<PartyView> {
        self.party.get(&account).map(|r| PartyView { claim: U128(r.claim), pending_refs: r.pending_refs, deposit: U128(r.deposit) })
    }

    pub fn get_period(&self, yyyymm: u32) -> Option<PeriodView> {
        self.periods.get(&ring_index(yyyymm)).filter(|p| p.yyyymm == yyyymm).map(|p| PeriodView {
            yyyymm: p.yyyymm,
            purchases_in: U128(p.purchases_in),
            earned: U128(p.earned),
            refunds_paid: U128(p.refunds_paid),
            claims_paid: U128(p.claims_paid),
            owner_withdrawals: U128(p.owner_withdrawals),
        })
    }

    pub fn get_control(&self) -> (AccountId, u32) {
        (self.owner.clone(), self.generation)
    }
}

impl Business {
    fn require_owner(&self) -> AccountId {
        let who = env::predecessor_account_id();
        require!(who == self.owner, "E_NOT_OWNER: only the current owner");
        who
    }

    /// The owner, or an operator holding METERING granted in the current generation.
    fn require_metering(&self) {
        let who = env::predecessor_account_id();
        if who == self.owner {
            return;
        }
        let ok = self
            .operators
            .iter()
            .any(|(a, g)| *a == who && g.caps & METERING != 0 && g.generation == self.generation);
        require!(ok, "E_NOT_OPERATOR: needs METERING in the current generation");
    }

    fn plan(&self, plan_id: u32) -> Plan {
        self.plans.get(&plan_id).cloned().unwrap_or_else(|| env::panic_str("E_ARGS: no such plan"))
    }

    fn entitlement(&self, key: &(AccountId, u32)) -> Entitlement {
        *self.entitlements.get(key).unwrap_or_else(|| env::panic_str("E_ARGS: no such entitlement"))
    }

    /// The caller's own entitlement: only a customer acts on their record.
    fn own_entitlement(&self, plan_id: u32) -> ((AccountId, u32), Entitlement) {
        let key = (env::predecessor_account_id(), plan_id);
        let e = *self
            .entitlements
            .get(&key)
            .unwrap_or_else(|| env::panic_str("E_NOT_CUSTOMER: you have no entitlement for this plan"));
        (key, e)
    }

    /// Every check for a purchase, before any mutation.
    #[allow(clippy::type_complexity)]
    fn validate_buy(
        &self,
        sender: &AccountId,
        amount: u128,
        msg: &str,
    ) -> Result<((AccountId, u32), Entitlement, u64, Option<(u8, [u8; 32], u8, u16)>), &'static str> {
        if amount == 0 {
            return Err("nothing sent");
        }
        if msg.len() > MAX_MSG {
            return Err("message too long");
        }
        let Incoming::Buy(buy) = serde_json::from_str::<Incoming>(msg).map_err(|_| "malformed message")?;
        let plan = self.plans.get(&buy.plan_id).ok_or("no such plan")?;
        let key = (sender.clone(), buy.plan_id);
        let e = *self.entitlements.get(&key).ok_or("no entitlement record; sponsor a shell first")?;
        let units = buy.units as u64;
        if units == 0 || buy.units > plan.max_units_per_purchase {
            return Err("units outside the plan's purchase limit");
        }
        let price = (units as u128).checked_mul(plan.unit_price.0).ok_or("amount overflow")?;
        if price != amount {
            return Err("amount is not units times the plan price");
        }
        if buy.purchase_seq != e.purchase_seq.checked_add(1).ok_or("sequence overflow")? {
            return Err("purchase sequence is not the next one");
        }
        let outstanding = e.free.checked_add(e.held_units()).and_then(|v| v.checked_add(units)).ok_or("units overflow")?;
        if outstanding > plan.max_units_outstanding as u64 {
            return Err("over the plan's outstanding units cap");
        }
        e.purchased.checked_add(units).ok_or("units overflow")?;
        self.held.checked_add(amount).ok_or("treasury overflow")?;
        self.ent_free_value.checked_add(amount).ok_or("treasury overflow")?;
        let install = match buy.install {
            None => None,
            Some(i) => {
                if i.slot as usize >= KEY_SLOTS {
                    return Err("key slot 0-3");
                }
                if e.keys[i.slot as usize].state == KEY_ACTIVE {
                    return Err("that key slot is in use");
                }
                let pk = hex32(&i.pk).ok_or("public key is 64 hex characters")?;
                if i.max_hold_units < 1 || i.max_hold_units > plan.max_hold_units || i.max_units_per_day < 1 {
                    return Err("key policy outside the plan");
                }
                e.keys[i.slot as usize].epoch.checked_add(1).ok_or("epoch overflow")?;
                Some((i.slot, pk, i.max_hold_units, i.max_units_per_day))
            }
        };
        Ok((key, e, units, install))
    }

    fn close_hold(&mut self, e: &mut Entitlement, unit_price: u128) {
        let rest = (e.hold.units - e.hold.charged) as u64;
        let value = mul(rest, unit_price);
        e.free += rest;
        self.ent_held_value = sub(self.ent_held_value, value);
        self.ent_free_value = add(self.ent_free_value, value);
        let used: Vec<(u8, [u8; 32])> = (0..e.hold.units)
            .filter(|i| e.hold.used & (1u16 << i) != 0)
            .map(|i| (i, e.hold.slots[i as usize]))
            .collect();
        let root = env::sha256_array(borsh::to_vec(&used).unwrap_or_default());
        e.last_hold = ClosedHold { seq: e.hold.seq, used: e.hold.used, charged: e.hold.charged, slots_root: root };
        e.hold = Hold::empty();
    }

    fn free_slot(&self) -> u8 {
        (0..PAYOUT_SLOTS)
            .find(|i| self.slots.get(i).is_some_and(|s| s.state == SLOT_FREE))
            .unwrap_or_else(|| env::panic_str("E_BUSY: every payout slot is in use"))
    }

    /// Moves `amount` (already taken out of its source bucket) into pending, records the payout
    /// in the slot with a new monotonic id, and schedules the transfer and its callback.
    fn start_payout(&mut self, slot_id: u8, kind: u8, to: &AccountId, plan_id: u32, reg_id: u64, amount: u128) -> Promise {
        self.payout_seq += 1;
        let s = PayoutSlot {
            state: SLOT_IN_FLIGHT,
            kind,
            amount,
            started_at_ms: now_ms(),
            to: FixedAccount::of(to),
            plan_id,
            reg_id,
            payout_id: self.payout_seq,
        };
        self.slots.insert(slot_id, s);
        self.pending_total = add(self.pending_total, amount);
        self.check();
        emit("payout_started", serde_json::json!({ "slot": slot_id, "payout_id": U64(s.payout_id), "to": to, "amount": U128(amount) }));
        self.transfer(slot_id, &s)
    }

    fn transfer(&self, slot_id: u8, s: &PayoutSlot) -> Promise {
        Promise::new(self.asset.clone())
            .function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&serde_json::json!({ "receiver_id": s.to.account(), "amount": U128(s.amount) })).unwrap_or_default(),
                NearToken::from_yoctonear(1),
                TRANSFER_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_payout(slot_id, U64(s.payout_id)))
    }

    /// Drops one pending reference from the payout's beneficiary, adding `claim` to its claim.
    fn unref(&mut self, slot: &PayoutSlot, claim: u128) {
        let to = slot.to.account();
        if slot.reg_id != 0 {
            let key = (to, slot.plan_id);
            if let Some(mut e) = self.entitlements.get(&key).copied() {
                e.pending_refs = e.pending_refs.saturating_sub(1);
                e.claim = add(e.claim, claim);
                self.entitlements.insert(key, e);
            }
        } else if let Some(mut r) = self.party.get(&to).copied() {
            r.pending_refs = r.pending_refs.saturating_sub(1);
            r.claim = add(r.claim, claim);
            self.party.insert(to, r);
        }
    }

    /// Adds to this month's books. The counters are reporting totals and saturate: a month's
    /// gross flow can exceed u128 (buy, refund, buy again) and must never block money moving.
    fn book(&mut self, f: impl FnOnce(&mut Period)) {
        let month = period_of(now_ms());
        let idx = ring_index(month);
        let mut p = self.periods.get(&idx).copied().unwrap_or_default();
        if p.yyyymm != month {
            p = Period { yyyymm: month, ..Period::default() };
        }
        f(&mut p);
        self.periods.insert(idx, p);
    }

    /// Charges the measured growth since `before` (plus `extra` bytes) at the storage price,
    /// requires that much attached and refunds the rest. Returns the charge in yocto.
    fn charge_growth(&mut self, before: u64, extra: u64) -> u128 {
        let grown = env::storage_usage().saturating_sub(before) + extra;
        self.charge_bytes(grown)
    }

    fn charge_bytes(&mut self, bytes: u64) -> u128 {
        let cost = bytes as u128 * env::storage_byte_cost().as_yoctonear();
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= cost, format!("E_STORAGE: attach at least {cost} yoctoNEAR for {bytes} bytes"));
        let excess = attached - cost;
        if excess > 0 {
            Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(excess)).detach();
        }
        cost
    }

    /// I1: every token held is in exactly one bucket.
    fn check(&self) {
        let sum = self
            .ent_free_value
            .checked_add(self.ent_held_value)
            .and_then(|v| v.checked_add(self.available))
            .and_then(|v| v.checked_add(self.pending_total))
            .and_then(|v| v.checked_add(self.claims_total));
        require!(sum == Some(self.held), "E_INVARIANT: buckets do not add up to what the business holds");
    }

    /// Test-only stand-in for a sale (labelled "injected" in reports): the owner and generation
    /// change, every old operator grant stops counting, the listed successor grants are made at
    /// the new generation, and the new owner gets a party record if missing.
    #[cfg(test)]
    pub fn test_set_owner(&mut self, owner: AccountId, generation: u32, grants: Vec<(AccountId, u8)>) {
        require!(generation > self.generation, "test: generation must increase");
        self.owner = owner.clone();
        self.generation = generation;
        self.operators = grants.into_iter().map(|(a, caps)| (a, OperatorGrant { caps, generation })).collect();
        if !self.party.contains_key(&owner) {
            self.party.insert(owner.clone(), PartyRecord { claim: 0, pending_refs: 0, payer: FixedAccount::of(&owner), deposit: 0 });
        }
    }
}

#[cfg(test)]
mod tests;
