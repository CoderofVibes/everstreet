//! One business on NEAR, version 2 (docs/design/BUSINESS_V2.md, slices 1 and 5).
//!
//! The business account holds one accepted NEP-141 token. Every unit it holds sits in exactly
//! one bucket, checked after every change:
//!
//!   held = customer credit + paid-but-not-yet-delivered orders + available
//!        + pending payouts + sale deal holds + seller proceeds
//!
//! Customers pay with `ft_transfer_call` on the token (an order, or prepaid credit). An order's
//! money is the customer's until it is delivered; refunds go back to them by the rules fixed at
//! creation. The owner can withdraw only what is earned and available above the reserve. Control
//! changes hands by v1's two-party sale, now paid in the token. Payouts are asynchronous: money
//! moves to "pending" first and settles, or returns to its bucket, in the transfer's callback.
//! There is no method that adds keys or replaces code.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, require, serde_json, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

pub const CAPABILITIES: [&str; 4] = ["fulfillment", "support", "release", "spend"];
const EVENT_STANDARD: &str = "business_control";
const EVENT_VERSION: &str = "2.0.0";
const TRANSFER_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Operators,
    Credits,
    Orders,
    Periods,
    Deals,
    Proceeds,
}

/// Promises fixed at creation. A future owner inherits them and cannot change them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
    /// A customer may cancel a paid order before its `cancel_before_ms` and get it all back.
    pub customer_cancel_refund: bool,
    /// A customer may take back unused prepaid credit at any time.
    pub credit_refundable: bool,
    /// The owner cannot withdraw below this much available money.
    pub min_reserve: U128,
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
pub enum OrderStatus {
    Paid,
    Delivered,
    Refunding,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Order {
    pub customer: AccountId,
    pub amount: U128,
    /// An opaque reference to what was bought (no personal data).
    pub offer: String,
    pub status: OrderStatus,
    pub paid_at_ms: U64,
    /// 0 when the customer cannot cancel for a refund.
    pub cancel_before_ms: U64,
    pub settled_at_ms: Option<U64>,
}

/// One month's books, kept by the contract as money moves.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Period {
    pub orders_in: U128,
    pub prepaid_in: U128,
    pub earned: U128,
    pub refunds: U128,
    pub credit_used: U128,
    pub credit_withdrawn: U128,
    pub owner_withdrawals: U128,
    pub sale_proceeds: U128,
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
    pub terms_hash: String,
    pub expected_generation: u32,
    pub version: u32,
    pub seller_accepted: Option<String>,
    pub buyer_accepted: Option<String>,
    /// Buyer tokens held for this deal (funded with `fund_deal`).
    pub held: U128,
    pub status: DealStatus,
    pub closed_at_ms: Option<U64>,
}

/// What an outbound transfer is for, so its callback can settle or restore it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Payout {
    Refund { order_id: String, to: AccountId, amount: U128 },
    Credit { to: AccountId, amount: U128 },
    Profit { to: AccountId, amount: U128 },
    Proceeds { to: AccountId, amount: U128 },
    DealHold { deal_id: String, to: AccountId, amount: U128 },
}

#[near(serializers = [json])]
pub struct TreasuryView {
    pub asset: AccountId,
    pub held: U128,
    pub customer_credit: U128,
    pub unearned_orders: U128,
    pub available: U128,
    pub withdrawable: U128,
    pub pending_payouts: U128,
    pub deal_holds: U128,
    pub seller_proceeds: U128,
}

#[near(serializers = [json])]
pub struct ControlView {
    pub business: AccountId,
    pub name: String,
    pub owner: AccountId,
    pub generation: u32,
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
pub struct ConfigView {
    pub name: String,
    pub version: String,
    pub asset: AccountId,
    pub rules: Rules,
    pub capabilities: Vec<String>,
    pub upgradable: bool,
}

#[near(serializers = [json])]
pub struct DealView {
    pub deal_id: String,
    pub digest: String,
    pub deal: Deal,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
enum Incoming {
    Order { order_id: String, offer: String, cancel_before_ms: Option<U64> },
    Prepay {},
    FundDeal { deal_id: String },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Business {
    name: String,
    asset: AccountId,
    rules: Rules,
    owner: AccountId,
    generation: u32,
    operators: IterableMap<AccountId, OperatorGrant>,
    credits: LookupMap<AccountId, u128>,
    orders: LookupMap<String, Order>,
    periods: LookupMap<u32, Period>,
    deals: IterableMap<String, Deal>,
    proceeds: LookupMap<AccountId, u128>,
    held: u128,
    credit_total: u128,
    unearned: u128,
    available: u128,
    pending: u128,
    deal_holds: u128,
    proceeds_total: u128,
}

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
        "E_DEPOSIT: attach exactly 1 yoctoNEAR (a full-access key must sign this)"
    );
}

/// The UTC month of a millisecond timestamp, as yyyymm.
pub fn period_of(ms: u64) -> u32 {
    let days = (ms / 86_400_000) as i64;
    // Howard Hinnant's civil-from-days.
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

#[near]
impl Business {
    #[init]
    pub fn new(name: String, owner: AccountId, asset: AccountId, rules: Rules) -> Self {
        require!(!name.is_empty() && name.len() <= 64, "E_ARGS: name is 1-64 characters");
        emit("business_created", serde_json::json!({ "owner": owner, "asset": asset, "generation": 1, "rules": rules }));
        Self {
            name,
            asset,
            rules,
            owner,
            generation: 1,
            operators: IterableMap::new(StorageKey::Operators),
            credits: LookupMap::new(StorageKey::Credits),
            orders: LookupMap::new(StorageKey::Orders),
            periods: LookupMap::new(StorageKey::Periods),
            deals: IterableMap::new(StorageKey::Deals),
            proceeds: LookupMap::new(StorageKey::Proceeds),
            held: 0,
            credit_total: 0,
            unearned: 0,
            available: 0,
            pending: 0,
            deal_holds: 0,
            proceeds_total: 0,
        }
    }

    // ---------- money in ----------

    /// Called by the accepted token after a customer's `ft_transfer_call`. Anything this method
    /// refuses (wrong token, malformed message) panics, and the token returns the money. A
    /// repeated order id returns the whole amount: an order is paid once.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.asset, "E_ASSET: this business only accepts its own token");
        require!(amount.0 > 0, "E_ARGS: nothing sent");
        let incoming: Incoming = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("E_MSG: say what the payment is for"));
        match incoming {
            Incoming::Order { order_id, offer, cancel_before_ms } => {
                require!(!order_id.is_empty() && order_id.len() <= 64, "E_ARGS: order id is 1-64 characters");
                if self.orders.contains_key(&order_id) {
                    emit("order_duplicate_returned", serde_json::json!({ "order_id": order_id, "amount": amount }));
                    return PromiseOrValue::Value(amount);
                }
                self.orders.insert(
                    order_id.clone(),
                    Order {
                        customer: sender_id.clone(),
                        amount,
                        offer: offer.chars().take(120).collect(),
                        status: OrderStatus::Paid,
                        paid_at_ms: U64(now_ms()),
                        cancel_before_ms: cancel_before_ms.unwrap_or(U64(0)),
                        settled_at_ms: None,
                    },
                );
                self.held += amount.0;
                self.unearned += amount.0;
                self.book(|p| p.orders_in.0 += amount.0);
                emit("order_paid", serde_json::json!({ "order_id": order_id, "customer": sender_id, "amount": amount }));
            }
            Incoming::Prepay {} => {
                let c = self.credits.get(&sender_id).copied().unwrap_or(0);
                self.credits.insert(sender_id.clone(), c + amount.0);
                self.held += amount.0;
                self.credit_total += amount.0;
                self.book(|p| p.prepaid_in.0 += amount.0);
                emit("credit_prepaid", serde_json::json!({ "customer": sender_id, "amount": amount }));
            }
            Incoming::FundDeal { deal_id } => {
                let mut deal = self.open_deal(&deal_id);
                require!(sender_id == deal.buyer, "E_NOT_PARTY: only the buyer funds the deal");
                require!(deal.held.0 == 0, "E_STATE: this deal is already funded");
                require!(amount == deal.price, "E_FUNDS: fund exactly the price");
                deal.held = amount;
                self.deals.insert(deal_id.clone(), deal);
                self.held += amount.0;
                self.deal_holds += amount.0;
                emit("deal_funded", serde_json::json!({ "deal_id": deal_id, "amount": amount }));
            }
        }
        self.check();
        PromiseOrValue::Value(U128(0))
    }

    // ---------- orders ----------

    /// The order was delivered: the customer's money becomes the business's revenue.
    #[payable]
    pub fn deliver(&mut self, order_id: String) {
        assert_one_yocto();
        self.require_owner_or_operator("fulfillment");
        let mut o = self.order(&order_id);
        require!(o.status == OrderStatus::Paid, format!("E_STATE: order is {:?}", o.status));
        o.status = OrderStatus::Delivered;
        o.settled_at_ms = Some(U64(now_ms()));
        self.unearned -= o.amount.0;
        self.available += o.amount.0;
        self.book(|p| p.earned.0 += o.amount.0);
        self.orders.insert(order_id.clone(), o.clone());
        emit("order_delivered", serde_json::json!({ "order_id": order_id, "amount": o.amount, "generation": self.generation }));
        self.check();
    }

    /// The business refunds a paid order (owner, or an operator with `support`).
    #[payable]
    pub fn refund_order(&mut self, order_id: String) -> Promise {
        assert_one_yocto();
        self.require_owner_or_operator("support");
        self.start_refund(order_id)
    }

    /// The customer cancels before the order's deadline and gets everything back, if the rules
    /// allow it. No owner can turn this off after creation.
    #[payable]
    pub fn cancel_order(&mut self, order_id: String) -> Promise {
        assert_one_yocto();
        let o = self.order(&order_id);
        require!(env::predecessor_account_id() == o.customer, "E_NOT_CUSTOMER: only the customer cancels their order");
        require!(self.rules.customer_cancel_refund, "E_RULES: this business does not offer cancellation refunds");
        require!(o.cancel_before_ms.0 > 0 && now_ms() < o.cancel_before_ms.0, "E_DEADLINE: the cancellation window has closed");
        self.start_refund(order_id)
    }

    // ---------- credit ----------

    /// The customer takes back unused prepaid credit.
    #[payable]
    pub fn withdraw_credit(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        require!(self.rules.credit_refundable, "E_RULES: credit at this business is not refundable");
        let who = env::predecessor_account_id();
        let c = self.credits.get(&who).copied().unwrap_or(0);
        require!(amount.0 > 0 && amount.0 <= c, format!("E_FUNDS: you have {c} in credit"));
        self.credits.insert(who.clone(), c - amount.0);
        self.credit_total -= amount.0;
        self.payout(Payout::Credit { to: who, amount })
    }

    /// The owner (or a `fulfillment` operator) charges a customer's credit for delivered work.
    #[payable]
    pub fn use_credit(&mut self, customer: AccountId, amount: U128, memo: String) {
        assert_one_yocto();
        self.require_owner_or_operator("fulfillment");
        let c = self.credits.get(&customer).copied().unwrap_or(0);
        require!(amount.0 > 0 && amount.0 <= c, format!("E_FUNDS: {customer} has {c} in credit"));
        self.credits.insert(customer.clone(), c - amount.0);
        self.credit_total -= amount.0;
        self.available += amount.0;
        self.book(|p| {
            p.credit_used.0 += amount.0;
            p.earned.0 += amount.0;
        });
        emit("credit_used", serde_json::json!({ "customer": customer, "amount": amount, "memo": memo.chars().take(120).collect::<String>() }));
        self.check();
    }

    // ---------- money out to the owner ----------

    #[payable]
    pub fn withdraw_profit(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let owner = self.require_owner("withdraw");
        let withdrawable = self.available.saturating_sub(self.rules.min_reserve.0);
        require!(
            amount.0 > 0 && amount.0 <= withdrawable,
            format!("E_RESERVED: {withdrawable} can be withdrawn; customer money and the {} reserve stay", self.rules.min_reserve.0)
        );
        self.available -= amount.0;
        self.payout(Payout::Profit { to: owner, amount })
    }

    /// A seller collects what a sale paid them.
    #[payable]
    pub fn claim_proceeds(&mut self) -> Promise {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let p = self.proceeds.get(&who).copied().unwrap_or(0);
        require!(p > 0, "E_FUNDS: no sale proceeds to claim");
        self.proceeds.remove(&who);
        self.proceeds_total -= p;
        self.payout(Payout::Proceeds { to: who, amount: U128(p) })
    }

    /// Settles or restores a payout once the token transfer's outcome is known.
    #[private]
    pub fn on_payout(&mut self, payout: Payout) -> bool {
        let ok = near_sdk::is_promise_success();
        let (amount, _) = payout_amount(&payout);
        self.pending -= amount;
        if ok {
            self.held -= amount;
            match &payout {
                Payout::Refund { order_id, .. } => {
                    let mut o = self.order(order_id);
                    o.status = OrderStatus::Refunded;
                    o.settled_at_ms = Some(U64(now_ms()));
                    self.orders.insert(order_id.clone(), o);
                    self.book(|p| p.refunds.0 += amount);
                }
                Payout::Credit { .. } => self.book(|p| p.credit_withdrawn.0 += amount),
                Payout::Profit { .. } => self.book(|p| p.owner_withdrawals.0 += amount),
                Payout::Proceeds { .. } | Payout::DealHold { .. } => {}
            }
        } else {
            // The money never left: put it back where it was.
            match &payout {
                Payout::Refund { order_id, .. } => {
                    let mut o = self.order(order_id);
                    o.status = OrderStatus::Paid;
                    self.orders.insert(order_id.clone(), o);
                    self.unearned += amount;
                }
                Payout::Credit { to, .. } => {
                    let c = self.credits.get(to).copied().unwrap_or(0);
                    self.credits.insert(to.clone(), c + amount);
                    self.credit_total += amount;
                }
                Payout::Profit { .. } => self.available += amount,
                Payout::Proceeds { to, .. } => {
                    let c = self.proceeds.get(to).copied().unwrap_or(0);
                    self.proceeds.insert(to.clone(), c + amount);
                    self.proceeds_total += amount;
                }
                Payout::DealHold { deal_id, .. } => {
                    if let Some(mut d) = self.deals.get(deal_id).cloned() {
                        d.held = U128(amount);
                        self.deals.insert(deal_id.clone(), d);
                    }
                    self.deal_holds += amount;
                }
            }
        }
        emit(if ok { "payout_settled" } else { "payout_returned" }, serde_json::json!({ "payout": payout }));
        self.check();
        ok
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
        self.operators.insert(account_id.clone(), OperatorGrant { capabilities: capabilities.clone(), generation: self.generation, granted_at_ms: U64(now_ms()) });
        emit("operator_appointed", serde_json::json!({ "operator": account_id, "capabilities": capabilities, "generation": self.generation }));
    }

    #[payable]
    pub fn revoke_operator(&mut self, account_id: AccountId) {
        assert_one_yocto();
        self.require_owner("revoke operators");
        require!(self.operators.remove(&account_id).is_some(), "E_ARGS: not an operator");
        emit("operator_revoked", serde_json::json!({ "operator": account_id, "generation": self.generation }));
    }

    // ---------- sale ----------

    #[payable]
    pub fn propose_sale(&mut self, deal_id: String, buyer: AccountId, price: U128, expires_at_ms: U64, terms_hash: String) {
        assert_one_yocto();
        let seller = self.require_owner("propose a sale");
        require!(!deal_id.is_empty() && deal_id.len() <= 64, "E_ARGS: deal id is 1-64 characters");
        require!(!self.deals.contains_key(&deal_id), "E_ARGS: deal id already used");
        require!(buyer != seller && buyer != env::current_account_id(), "E_ARGS: invalid buyer");
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
        emit("sale_proposed", serde_json::json!({ "deal_id": deal_id, "digest": digest }));
    }

    /// New terms void both acceptances. A funded hold stays; the buyer can withdraw it if they
    /// do not like the new price.
    #[payable]
    pub fn revise_sale(&mut self, deal_id: String, price: U128, expires_at_ms: U64, terms_hash: String) {
        assert_one_yocto();
        let mut deal = self.open_deal(&deal_id);
        require!(env::predecessor_account_id() == deal.seller, "E_NOT_SELLER: only the seller revises terms");
        require!(terms_hash.len() == 64, "E_ARGS: terms_hash is a hex sha256");
        require!(expires_at_ms.0 > now_ms(), "E_ARGS: expiry is in the past");
        deal.price = price;
        deal.expires_at_ms = expires_at_ms;
        deal.terms_hash = terms_hash;
        deal.version += 1;
        deal.seller_accepted = None;
        deal.buyer_accepted = None;
        let digest = self.digest(&deal_id, &deal);
        self.deals.insert(deal_id.clone(), deal);
        emit("sale_revised", serde_json::json!({ "deal_id": deal_id, "digest": digest }));
    }

    /// Either party accepts one exact version. The buyer must have funded exactly the price.
    /// The call that brings the second matching acceptance closes the sale.
    #[payable]
    pub fn accept_sale(&mut self, deal_id: String, digest: String) {
        assert_one_yocto();
        let mut deal = self.open_deal(&deal_id);
        let caller = env::predecessor_account_id();
        require!(now_ms() < deal.expires_at_ms.0, "E_EXPIRED: the offer has expired");
        require!(deal.expected_generation == self.generation && deal.seller == self.owner, "E_GENERATION: control changed since these terms were proposed");
        let current = self.digest(&deal_id, &deal);
        require!(digest == current, "E_TERMS: these are not the current terms; read the deal again");
        if caller == deal.seller {
            deal.seller_accepted = Some(digest.clone());
        } else if caller == deal.buyer {
            require!(deal.held == deal.price, "E_FUNDS: fund the deal with the exact price before accepting");
            deal.buyer_accepted = Some(digest.clone());
        } else {
            env::panic_str("E_NOT_PARTY: only the seller or the buyer accepts");
        }
        emit("sale_accepted", serde_json::json!({ "deal_id": deal_id, "by": caller, "digest": digest }));
        if deal.seller_accepted.as_deref() == Some(&current) && deal.buyer_accepted.as_deref() == Some(&current) {
            self.finalize(&deal_id, &mut deal);
        }
        self.deals.insert(deal_id, deal);
        self.check();
    }

    #[payable]
    pub fn cancel_sale(&mut self, deal_id: String) {
        assert_one_yocto();
        let mut deal = self.open_deal(&deal_id);
        let caller = env::predecessor_account_id();
        require!(caller == deal.seller || caller == deal.buyer, "E_NOT_PARTY: only the seller or the buyer cancels");
        deal.status = DealStatus::Cancelled;
        self.deals.insert(deal_id.clone(), deal);
        emit("sale_cancelled", serde_json::json!({ "deal_id": deal_id, "by": caller }));
    }

    pub fn expire_sale(&mut self, deal_id: String) {
        let mut deal = self.open_deal(&deal_id);
        require!(now_ms() >= deal.expires_at_ms.0, "E_STATE: not expired yet");
        deal.status = DealStatus::Expired;
        self.deals.insert(deal_id.clone(), deal);
        emit("sale_expired", serde_json::json!({ "deal_id": deal_id }));
    }

    /// The buyer takes back a hold from a deal that did not close (cancelled, expired, void),
    /// or from an open deal they no longer want after a revision.
    #[payable]
    pub fn withdraw_deal_hold(&mut self, deal_id: String) -> Promise {
        assert_one_yocto();
        let mut deal = self.deals.get(&deal_id).cloned().unwrap_or_else(|| env::panic_str("E_ARGS: no such deal"));
        let caller = env::predecessor_account_id();
        require!(caller == deal.buyer, "E_NOT_PARTY: only the buyer withdraws the hold");
        require!(deal.status != DealStatus::Closed, "E_STATE: the sale closed; the hold paid the seller");
        require!(deal.held.0 > 0, "E_FUNDS: nothing held");
        let amount = deal.held;
        deal.held = U128(0);
        deal.buyer_accepted = None;
        self.deals.insert(deal_id.clone(), deal);
        self.deal_holds -= amount.0;
        self.payout(Payout::DealHold { deal_id, to: caller, amount })
    }

    // ---------- views ----------

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            name: self.name.clone(),
            version: "2".into(),
            asset: self.asset.clone(),
            rules: self.rules.clone(),
            capabilities: CAPABILITIES.iter().map(|c| c.to_string()).collect(),
            upgradable: false,
        }
    }

    pub fn get_control(&self) -> ControlView {
        ControlView {
            business: env::current_account_id(),
            name: self.name.clone(),
            owner: self.owner.clone(),
            generation: self.generation,
            operators: self.operators.iter().filter(|(_, g)| g.generation == self.generation).map(|(a, g)| (a.clone(), g.clone())).collect(),
        }
    }

    pub fn operator_check(&self, account_id: AccountId, capability: String) -> OperatorCheck {
        let (authorized, reason) = if account_id == self.owner {
            (true, "owner".to_string())
        } else {
            match self.operators.get(&account_id) {
                None => (false, "not an operator".to_string()),
                Some(g) if g.generation != self.generation => (false, format!("grant is from generation {}; control is now at generation {}", g.generation, self.generation)),
                Some(g) if !g.capabilities.contains(&capability) => (false, format!("not granted {capability}")),
                Some(_) => (true, format!("operator with {capability}")),
            }
        };
        OperatorCheck { authorized, owner: self.owner.clone(), generation: self.generation, reason }
    }

    pub fn get_treasury(&self) -> TreasuryView {
        TreasuryView {
            asset: self.asset.clone(),
            held: U128(self.held),
            customer_credit: U128(self.credit_total),
            unearned_orders: U128(self.unearned),
            available: U128(self.available),
            withdrawable: U128(self.available.saturating_sub(self.rules.min_reserve.0)),
            pending_payouts: U128(self.pending),
            deal_holds: U128(self.deal_holds),
            seller_proceeds: U128(self.proceeds_total),
        }
    }

    pub fn get_order(&self, order_id: String) -> Option<Order> {
        self.orders.get(&order_id).cloned()
    }

    pub fn get_period(&self, yyyymm: u32) -> Period {
        self.periods.get(&yyyymm).cloned().unwrap_or_default()
    }

    pub fn credit_of(&self, account_id: AccountId) -> U128 {
        U128(self.credits.get(&account_id).copied().unwrap_or(0))
    }

    pub fn proceeds_of(&self, account_id: AccountId) -> U128 {
        U128(self.proceeds.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_deal(&self, deal_id: String) -> Option<DealView> {
        self.deals.get(&deal_id).map(|d| DealView { deal_id: deal_id.clone(), digest: self.digest(&deal_id, d), deal: d.clone() })
    }
}

fn payout_amount(p: &Payout) -> (u128, &AccountId) {
    match p {
        Payout::Refund { amount, to, .. }
        | Payout::Credit { amount, to }
        | Payout::Profit { amount, to }
        | Payout::Proceeds { amount, to }
        | Payout::DealHold { amount, to, .. } => (amount.0, to),
    }
}

impl Business {
    fn require_owner(&self, action: &str) -> AccountId {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner, format!("E_NOT_OWNER: only the current owner ({}) may {action}; generation {}", self.owner, self.generation));
        caller
    }

    fn require_owner_or_operator(&self, capability: &str) -> AccountId {
        let caller = env::predecessor_account_id();
        let check = self.operator_check(caller.clone(), capability.to_string());
        require!(check.authorized, format!("E_NOT_AUTHORIZED: {caller} may not use {capability}: {}", check.reason));
        caller
    }

    fn order(&self, order_id: &String) -> Order {
        self.orders.get(order_id).cloned().unwrap_or_else(|| env::panic_str("E_ARGS: no such order"))
    }

    fn start_refund(&mut self, order_id: String) -> Promise {
        let mut o = self.order(&order_id);
        require!(o.status == OrderStatus::Paid, format!("E_STATE: order is {:?}", o.status));
        o.status = OrderStatus::Refunding;
        self.unearned -= o.amount.0;
        self.orders.insert(order_id.clone(), o.clone());
        self.payout(Payout::Refund { order_id, to: o.customer, amount: o.amount })
    }

    /// Moves money to pending and sends it; `on_payout` settles or restores it.
    fn payout(&mut self, payout: Payout) -> Promise {
        let (amount, to) = payout_amount(&payout);
        self.pending += amount;
        self.check();
        emit("payout_started", serde_json::json!({ "payout": payout }));
        Promise::new(self.asset.clone())
            .function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&serde_json::json!({ "receiver_id": to, "amount": U128(amount) })).unwrap(),
                NearToken::from_yoctonear(1),
                TRANSFER_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_payout(payout))
    }

    fn book(&mut self, f: impl FnOnce(&mut Period)) {
        let key = period_of(now_ms());
        let mut p = self.periods.get(&key).cloned().unwrap_or_default();
        f(&mut p);
        self.periods.insert(key, p);
    }

    /// Every unit held is in exactly one bucket.
    fn check(&self) {
        require!(
            self.held == self.credit_total + self.unearned + self.available + self.pending + self.deal_holds + self.proceeds_total,
            "E_INVARIANT: buckets do not add up to what the business holds"
        );
    }

    fn open_deal(&self, deal_id: &String) -> Deal {
        let deal = self.deals.get(deal_id).cloned().unwrap_or_else(|| env::panic_str("E_ARGS: no such deal"));
        require!(deal.status == DealStatus::Open, format!("E_STATE: deal is {:?}", deal.status));
        deal
    }

    fn digest(&self, deal_id: &str, d: &Deal) -> String {
        hex::encode(env::sha256(
            format!(
                "business-deal/v2|{}|{}|{}|{}|{}|{}|{}|{}|{}",
                env::current_account_id(),
                deal_id,
                d.version,
                d.seller,
                d.buyer,
                d.price.0,
                d.expires_at_ms.0,
                d.terms_hash,
                d.expected_generation
            )
            .as_bytes(),
        ))
    }

    /// Hold to seller proceeds, owner to buyer, generation up, old grants void, racing deals void.
    fn finalize(&mut self, deal_id: &str, deal: &mut Deal) {
        let price = deal.price.0;
        deal.held = U128(0);
        self.deal_holds -= price;
        let p = self.proceeds.get(&deal.seller).copied().unwrap_or(0);
        self.proceeds.insert(deal.seller.clone(), p + price);
        self.proceeds_total += price;
        self.book(|p| p.sale_proceeds.0 += price);
        let previous = self.owner.clone();
        self.owner = deal.buyer.clone();
        self.generation += 1;
        deal.status = DealStatus::Closed;
        deal.closed_at_ms = Some(U64(now_ms()));
        let stale: Vec<AccountId> = self.operators.keys().cloned().collect();
        for o in stale {
            self.operators.remove(&o);
        }
        let others: Vec<String> = self.deals.iter().filter(|(id, d)| id.as_str() != deal_id && d.status == DealStatus::Open).map(|(id, _)| id.clone()).collect();
        for id in others {
            let mut other = self.deals.get(&id).cloned().unwrap();
            other.status = DealStatus::Void;
            self.deals.insert(id, other);
        }
        emit(
            "sale_finalized",
            serde_json::json!({ "deal_id": deal_id, "previous_owner": previous, "owner": self.owner, "price": deal.price, "generation": self.generation, "customer_credit": U128(self.credit_total), "unearned_orders": U128(self.unearned) }),
        );
    }
}

#[cfg(test)]
mod tests;
