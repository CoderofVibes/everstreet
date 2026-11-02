//! Operating control of one business (docs/AUTHORITY.md).
//!
//! One deployment = one business. The contract records who controls it (`owner`), who may act
//! for it (`operators`, each stamped with the authority generation it was granted in), the
//! business treasury with the part of it reserved for registered customer obligations, and
//! sale deals. A sale finalizes in the call that brings the second matching acceptance: the
//! buyer's held price goes to the seller, the buyer becomes owner and the generation moves on,
//! which voids every operator grant and signed command from the previous generation.
//!
//! Amounts are integer demo credits (`asset()`): test units with no value. The contract has no
//! method that adds keys or replaces code; the deploy script deletes the account's full-access
//! key after `new`, so nobody, including the founder and the platform, can change these rules.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, require, serde_json, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
};

/// Capabilities an owner may grant an operator.
pub const CAPABILITIES: [&str; 4] = ["fulfillment", "support", "release", "obligations"];

const EVENT_STANDARD: &str = "business_control";
const EVENT_VERSION: &str = "1.0.0";

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Operators,
    Balances,
    Obligations,
    Deals,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct OperatorGrant {
    pub capabilities: Vec<String>,
    pub generation: u32,
    pub granted_at_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum ObligationStatus {
    Open,
    Fulfilled,
}

/// A monetary promise to a customer, paid from the treasury. `commitment` is
/// hex(sha256("<salt>|<beneficiary account>")) so the beneficiary stays off the public ledger
/// and the reserve can only ever be paid to them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Obligation {
    pub amount: U128,
    pub commitment: String,
    pub memo: String,
    pub status: ObligationStatus,
    pub registered_at_ms: U64,
    pub registered_generation: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum DealStatus {
    Open,
    Closed,
    Cancelled,
    Expired,
    Void,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Deal {
    pub seller: AccountId,
    pub buyer: AccountId,
    pub price: U128,
    pub expires_at_ms: U64,
    /// hex sha256 of the off-chain closing packet: rights, protected obligations, transfer items.
    pub terms_hash: String,
    /// The generation the seller proposed under; the close fails if control changed since.
    pub expected_generation: u32,
    /// Bumped by every revision; acceptances name the digest of one version.
    pub version: u32,
    pub seller_accepted: Option<String>,
    pub buyer_accepted: Option<String>,
    /// Buyer credits held for this deal while the buyer's acceptance stands.
    pub held: U128,
    pub status: DealStatus,
    pub closed_at_ms: Option<U64>,
}

#[near(serializers = [json])]
pub struct DealView {
    pub deal_id: String,
    pub digest: String,
    pub deal: Deal,
}

#[near(serializers = [json])]
pub struct ControlView {
    pub business: AccountId,
    pub name: String,
    pub owner: AccountId,
    pub generation: u32,
    /// Only grants valid in the current generation.
    pub operators: Vec<(AccountId, OperatorGrant)>,
}

#[near(serializers = [json])]
pub struct OperatorCheck {
    pub authorized: bool,
    pub owner: AccountId,
    pub generation: u32,
    pub reason: String,
}

#[near(serializers = [json])]
pub struct TreasuryView {
    pub treasury: U128,
    pub reserved: U128,
    pub available: U128,
}

#[near(serializers = [json])]
pub struct AssetView {
    pub symbol: String,
    pub decimals: u8,
    pub note: String,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub name: String,
    pub issuer: AccountId,
    pub capabilities: Vec<String>,
    pub upgradable: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Business {
    name: String,
    issuer: AccountId,
    owner: AccountId,
    generation: u32,
    operators: IterableMap<AccountId, OperatorGrant>,
    balances: LookupMap<AccountId, u128>,
    treasury: u128,
    reserved: u128,
    obligations: IterableMap<String, Obligation>,
    deals: IterableMap<String, Deal>,
}

fn emit(event: &str, data: serde_json::Value) {
    let log = serde_json::json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{log}"));
}

fn sha256_hex(text: &str) -> String {
    hex::encode(env::sha256(text.as_bytes()))
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn assert_one_yocto() {
    require!(
        env::attached_deposit() == NearToken::from_yoctonear(1),
        "E_DEPOSIT: attach exactly 1 yoctoNEAR (a full-access key must sign this)"
    );
}

#[near]
impl Business {
    #[init]
    pub fn new(name: String, owner: AccountId, issuer: AccountId) -> Self {
        require!(!name.is_empty() && name.len() <= 64, "E_ARGS: name is 1-64 characters");
        let contract = Self {
            name,
            issuer,
            owner: owner.clone(),
            generation: 1,
            operators: IterableMap::new(StorageKey::Operators),
            balances: LookupMap::new(StorageKey::Balances),
            treasury: 0,
            reserved: 0,
            obligations: IterableMap::new(StorageKey::Obligations),
            deals: IterableMap::new(StorageKey::Deals),
        };
        emit("business_created", serde_json::json!({ "owner": owner, "generation": 1 }));
        contract
    }

    // ---------- demo credits ----------

    /// The issuer credits demo units to a participant. Never to the business itself, so the
    /// platform cannot inflate the treasury.
    pub fn mint(&mut self, to: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.issuer, "E_NOT_ISSUER: only the issuer mints demo credits");
        require!(to != env::current_account_id(), "E_ARGS: the issuer cannot credit the business treasury");
        self.credit(&to, amount.0);
        emit("credits_minted", serde_json::json!({ "to": to, "amount": amount }));
    }

    /// The owner moves their own demo credits into the business treasury.
    #[payable]
    pub fn deposit_treasury(&mut self, amount: U128) {
        assert_one_yocto();
        let caller = self.require_owner("deposit to the treasury");
        self.debit(&caller, amount.0);
        self.treasury += amount.0;
        emit("treasury_deposit", serde_json::json!({ "by": caller, "amount": amount }));
    }

    /// The owner withdraws from the treasury, never more than is available after reserves.
    #[payable]
    pub fn withdraw_treasury(&mut self, amount: U128) {
        assert_one_yocto();
        let caller = self.require_owner("withdraw from the treasury");
        let available = self.treasury - self.reserved;
        require!(
            amount.0 <= available,
            format!("E_RESERVED: only {available} of the treasury's {} is available; {} is reserved for customer obligations", self.treasury, self.reserved)
        );
        self.treasury -= amount.0;
        self.credit(&caller, amount.0);
        emit("treasury_withdrawal", serde_json::json!({ "by": caller, "amount": amount, "generation": self.generation }));
    }

    // ---------- operators ----------

    #[payable]
    pub fn appoint_operator(&mut self, account_id: AccountId, capabilities: Vec<String>) {
        assert_one_yocto();
        self.require_owner("appoint operators");
        require!(!capabilities.is_empty(), "E_ARGS: grant at least one capability");
        for c in &capabilities {
            require!(CAPABILITIES.contains(&c.as_str()), format!("E_ARGS: unknown capability {c}"));
        }
        let grant = OperatorGrant {
            capabilities: capabilities.clone(),
            generation: self.generation,
            granted_at_ms: U64(now_ms()),
        };
        self.operators.insert(account_id.clone(), grant);
        emit(
            "operator_appointed",
            serde_json::json!({ "operator": account_id, "capabilities": capabilities, "generation": self.generation }),
        );
    }

    #[payable]
    pub fn revoke_operator(&mut self, account_id: AccountId) {
        assert_one_yocto();
        self.require_owner("revoke operators");
        require!(self.operators.remove(&account_id).is_some(), "E_ARGS: not an operator");
        emit("operator_revoked", serde_json::json!({ "operator": account_id, "generation": self.generation }));
    }

    // ---------- obligations ----------

    /// Reserves treasury funds for a promise to a customer. Owner, or an operator holding
    /// `obligations` in the current generation.
    #[payable]
    pub fn register_obligation(&mut self, obligation_id: String, amount: U128, commitment: String, memo: String) {
        assert_one_yocto();
        self.require_owner_or_operator("obligations");
        require!(amount.0 > 0, "E_ARGS: amount must be positive");
        require!(commitment.len() == 64, "E_ARGS: commitment is a hex sha256");
        require!(!self.obligations.contains_key(&obligation_id), "E_ARGS: obligation id already used");
        let available = self.treasury - self.reserved;
        require!(amount.0 <= available, format!("E_FUNDS: only {available} is available to reserve"));
        self.reserved += amount.0;
        self.obligations.insert(
            obligation_id.clone(),
            Obligation {
                amount,
                commitment,
                memo,
                status: ObligationStatus::Open,
                registered_at_ms: U64(now_ms()),
                registered_generation: self.generation,
            },
        );
        emit("obligation_registered", serde_json::json!({ "obligation_id": obligation_id, "amount": amount }));
    }

    /// Pays a reserved obligation to the beneficiary its commitment names, and only to them.
    #[payable]
    pub fn fulfill_obligation(&mut self, obligation_id: String, beneficiary: AccountId, salt: String) {
        assert_one_yocto();
        self.require_owner_or_operator("obligations");
        let mut ob = self.obligations.get(&obligation_id).cloned().unwrap_or_else(|| env::panic_str("E_ARGS: no such obligation"));
        require!(ob.status == ObligationStatus::Open, "E_STATE: obligation already fulfilled");
        require!(
            sha256_hex(&format!("{salt}|{beneficiary}")) == ob.commitment,
            "E_COMMITMENT: beneficiary does not match the registered commitment"
        );
        ob.status = ObligationStatus::Fulfilled;
        self.reserved -= ob.amount.0;
        self.treasury -= ob.amount.0;
        self.credit(&beneficiary, ob.amount.0);
        self.obligations.insert(obligation_id.clone(), ob.clone());
        emit("obligation_fulfilled", serde_json::json!({ "obligation_id": obligation_id, "amount": ob.amount, "generation": self.generation }));
    }

    // ---------- sale ----------

    /// The owner proposes selling control to `buyer`. Nobody has accepted yet.
    #[payable]
    pub fn propose_sale(&mut self, deal_id: String, buyer: AccountId, price: U128, expires_at_ms: U64, terms_hash: String) {
        assert_one_yocto();
        let seller = self.require_owner("propose a sale");
        require!(!deal_id.is_empty() && deal_id.len() <= 64, "E_ARGS: deal id is 1-64 characters");
        require!(!self.deals.contains_key(&deal_id), "E_ARGS: deal id already used");
        require!(buyer != seller, "E_ARGS: buyer and seller must differ");
        require!(buyer != env::current_account_id(), "E_ARGS: the business cannot buy itself");
        require!(terms_hash.len() == 64, "E_ARGS: terms_hash is a hex sha256");
        require!(expires_at_ms.0 > now_ms(), "E_ARGS: expiry is in the past");
        let deal = Deal {
            seller,
            buyer,
            price,
            expires_at_ms,
            terms_hash,
            expected_generation: self.generation,
            version: 1,
            seller_accepted: None,
            buyer_accepted: None,
            held: U128(0),
            status: DealStatus::Open,
            closed_at_ms: None,
        };
        let digest = self.digest(&deal_id, &deal);
        self.deals.insert(deal_id.clone(), deal);
        emit("sale_proposed", serde_json::json!({ "deal_id": deal_id, "digest": digest, "version": 1 }));
    }

    /// The seller changes the terms. Every earlier acceptance is void and the buyer's hold is
    /// returned; both parties must accept the new digest.
    #[payable]
    pub fn revise_sale(&mut self, deal_id: String, price: U128, expires_at_ms: U64, terms_hash: String) {
        assert_one_yocto();
        let mut deal = self.open_deal(&deal_id);
        require!(env::predecessor_account_id() == deal.seller, "E_NOT_SELLER: only the seller revises terms");
        require!(terms_hash.len() == 64, "E_ARGS: terms_hash is a hex sha256");
        require!(expires_at_ms.0 > now_ms(), "E_ARGS: expiry is in the past");
        self.release_hold(&mut deal);
        deal.price = price;
        deal.expires_at_ms = expires_at_ms;
        deal.terms_hash = terms_hash;
        deal.version += 1;
        deal.seller_accepted = None;
        deal.buyer_accepted = None;
        let digest = self.digest(&deal_id, &deal);
        let version = deal.version;
        self.deals.insert(deal_id.clone(), deal);
        emit("sale_revised", serde_json::json!({ "deal_id": deal_id, "digest": digest, "version": version }));
    }

    /// The seller or the buyer accepts one exact version of the terms, named by its digest.
    /// The buyer's acceptance holds the price. The call that brings the second matching
    /// acceptance closes the sale.
    #[payable]
    pub fn accept_sale(&mut self, deal_id: String, digest: String) {
        assert_one_yocto();
        let mut deal = self.open_deal(&deal_id);
        let caller = env::predecessor_account_id();
        require!(now_ms() < deal.expires_at_ms.0, "E_EXPIRED: the offer has expired");
        require!(
            deal.expected_generation == self.generation && deal.seller == self.owner,
            "E_GENERATION: control changed since these terms were proposed"
        );
        let current = self.digest(&deal_id, &deal);
        require!(digest == current, "E_TERMS: these are not the current terms; read the deal again");
        if caller == deal.seller {
            deal.seller_accepted = Some(digest.clone());
        } else if caller == deal.buyer {
            if deal.buyer_accepted.is_none() {
                self.debit(&caller, deal.price.0);
                deal.held = deal.price;
            }
            deal.buyer_accepted = Some(digest.clone());
        } else {
            env::panic_str("E_NOT_PARTY: only the seller or the buyer accepts");
        }
        emit("sale_accepted", serde_json::json!({ "deal_id": deal_id, "by": caller, "digest": digest }));
        if deal.seller_accepted.as_deref() == Some(&current) && deal.buyer_accepted.as_deref() == Some(&current) {
            self.finalize(&deal_id, &mut deal);
        }
        self.deals.insert(deal_id, deal);
    }

    /// Either party withdraws from an open deal; the buyer's hold is returned.
    #[payable]
    pub fn cancel_sale(&mut self, deal_id: String) {
        assert_one_yocto();
        let mut deal = self.open_deal(&deal_id);
        let caller = env::predecessor_account_id();
        require!(caller == deal.seller || caller == deal.buyer, "E_NOT_PARTY: only the seller or the buyer cancels");
        self.release_hold(&mut deal);
        deal.status = DealStatus::Cancelled;
        self.deals.insert(deal_id.clone(), deal);
        emit("sale_cancelled", serde_json::json!({ "deal_id": deal_id, "by": caller }));
    }

    /// Anyone may expire a lapsed deal so the buyer's hold comes back.
    pub fn expire_sale(&mut self, deal_id: String) {
        let mut deal = self.open_deal(&deal_id);
        require!(now_ms() >= deal.expires_at_ms.0, "E_STATE: not expired yet");
        self.release_hold(&mut deal);
        deal.status = DealStatus::Expired;
        self.deals.insert(deal_id.clone(), deal);
        emit("sale_expired", serde_json::json!({ "deal_id": deal_id }));
    }

    // ---------- views ----------

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            name: self.name.clone(),
            issuer: self.issuer.clone(),
            capabilities: CAPABILITIES.iter().map(|c| c.to_string()).collect(),
            upgradable: false,
        }
    }

    pub fn asset(&self) -> AssetView {
        AssetView {
            symbol: "DEMO".into(),
            decimals: 0,
            note: "Demo credits on NEAR testnet. Test units with no value.".into(),
        }
    }

    pub fn get_control(&self) -> ControlView {
        ControlView {
            business: env::current_account_id(),
            name: self.name.clone(),
            owner: self.owner.clone(),
            generation: self.generation,
            operators: self
                .operators
                .iter()
                .filter(|(_, g)| g.generation == self.generation)
                .map(|(a, g)| (a.clone(), g.clone()))
                .collect(),
        }
    }

    /// What OpenSeat asks before running an operator command: may `account_id` use
    /// `capability` right now? The owner holds every capability.
    pub fn operator_check(&self, account_id: AccountId, capability: String) -> OperatorCheck {
        let (authorized, reason) = if account_id == self.owner {
            (true, "owner".to_string())
        } else {
            match self.operators.get(&account_id) {
                None => (false, "not an operator".to_string()),
                Some(g) if g.generation != self.generation => (
                    false,
                    format!("grant is from generation {}; control is now at generation {}", g.generation, self.generation),
                ),
                Some(g) if !g.capabilities.contains(&capability) => (false, format!("not granted {capability}")),
                Some(_) => (true, format!("operator with {capability}")),
            }
        };
        OperatorCheck { authorized, owner: self.owner.clone(), generation: self.generation, reason }
    }

    pub fn get_treasury(&self) -> TreasuryView {
        TreasuryView {
            treasury: U128(self.treasury),
            reserved: U128(self.reserved),
            available: U128(self.treasury - self.reserved),
        }
    }

    pub fn get_obligations(&self) -> Vec<(String, Obligation)> {
        self.obligations.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_deal(&self, deal_id: String) -> Option<DealView> {
        self.deals.get(&deal_id).map(|d| DealView {
            deal_id: deal_id.clone(),
            digest: self.digest(&deal_id, d),
            deal: d.clone(),
        })
    }

    pub fn get_deals(&self) -> Vec<DealView> {
        self.deals
            .iter()
            .map(|(id, d)| DealView { deal_id: id.clone(), digest: self.digest(id, d), deal: d.clone() })
            .collect()
    }
}

impl Business {
    fn require_owner(&self, action: &str) -> AccountId {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner,
            format!("E_NOT_OWNER: only the current owner ({}) may {action}; generation {}", self.owner, self.generation)
        );
        caller
    }

    fn require_owner_or_operator(&self, capability: &str) -> AccountId {
        let caller = env::predecessor_account_id();
        let check = self.operator_check(caller.clone(), capability.to_string());
        require!(check.authorized, format!("E_NOT_AUTHORIZED: {caller} may not use {capability}: {}", check.reason));
        caller
    }

    fn credit(&mut self, who: &AccountId, amount: u128) {
        let balance = self.balances.get(who).copied().unwrap_or(0);
        self.balances.insert(who.clone(), balance + amount);
    }

    fn debit(&mut self, who: &AccountId, amount: u128) {
        let balance = self.balances.get(who).copied().unwrap_or(0);
        require!(balance >= amount, format!("E_FUNDS: {who} holds {balance} demo credits, needs {amount}"));
        self.balances.insert(who.clone(), balance - amount);
    }

    fn open_deal(&self, deal_id: &String) -> Deal {
        let deal = self.deals.get(deal_id).cloned().unwrap_or_else(|| env::panic_str("E_ARGS: no such deal"));
        require!(deal.status == DealStatus::Open, format!("E_STATE: deal is {:?}", deal.status));
        deal
    }

    fn release_hold(&mut self, deal: &mut Deal) {
        if deal.held.0 > 0 {
            let buyer = deal.buyer.clone();
            self.credit(&buyer, deal.held.0);
            deal.held = U128(0);
        }
    }

    /// The digest both parties sign off on. Any change to any field changes it.
    fn digest(&self, deal_id: &str, d: &Deal) -> String {
        sha256_hex(&format!(
            "business-deal/v1|{}|{}|{}|{}|{}|{}|{}|{}|{}",
            env::current_account_id(),
            deal_id,
            d.version,
            d.seller,
            d.buyer,
            d.price.0,
            d.expires_at_ms.0,
            d.terms_hash,
            d.expected_generation
        ))
    }

    /// Settlement, owner change and generation bump in one step. Every other open deal is
    /// void (control changed under it) and its hold goes back to its buyer.
    fn finalize(&mut self, deal_id: &str, deal: &mut Deal) {
        require!(deal.held == deal.price, "E_STATE: buyer hold does not match the price");
        let price = deal.price.0;
        deal.held = U128(0);
        self.credit(&deal.seller, price);
        let previous = self.owner.clone();
        self.owner = deal.buyer.clone();
        self.generation += 1;
        deal.status = DealStatus::Closed;
        deal.closed_at_ms = Some(U64(now_ms()));
        let stale: Vec<AccountId> = self.operators.keys().cloned().collect();
        for operator in stale {
            self.operators.remove(&operator);
        }
        let others: Vec<String> = self
            .deals
            .iter()
            .filter(|(id, d)| id.as_str() != deal_id && d.status == DealStatus::Open)
            .map(|(id, _)| id.clone())
            .collect();
        for id in others {
            let mut other = self.deals.get(&id).cloned().unwrap();
            self.release_hold(&mut other);
            other.status = DealStatus::Void;
            self.deals.insert(id, other);
        }
        emit(
            "sale_finalized",
            serde_json::json!({
                "deal_id": deal_id,
                "previous_owner": previous,
                "owner": self.owner,
                "price": deal.price,
                "generation": self.generation,
                "treasury": U128(self.treasury),
                "reserved": U128(self.reserved),
            }),
        );
    }
}

#[cfg(test)]
mod tests;
