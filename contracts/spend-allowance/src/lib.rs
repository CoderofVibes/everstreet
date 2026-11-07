//! A companion to one business contract: an operating budget an agent can pay approved suppliers
//! from, within caps, for one generation of the business only.
//!
//! The business contract stays the only source of authority. The current owner (asked of the
//! business contract at the moment of the call) grants the allowance: the agent, the allowed
//! suppliers, a cap per payment, a cap per period, and a review threshold. The grant is bound to
//! the business's generation at that moment. Every payment asks the business contract again; once
//! control has moved (a sale closed), the grant has ended: payments are refused until the new
//! owner grants again. Customer money never enters here: the budget is funded separately (a
//! token transfer with msg "fund").
//!
//! - Payments above the review threshold wait for the owner to approve that exact invoice (by
//!   its digest); approved payments count toward the period cap like any other.
//! - An amount is reserved the moment a payment is asked for, before any cross-contract call, so
//!   two payments racing for the last of the cap can't both pass; a refusal releases it.
//! - A transfer the token refuses becomes the supplier's claim, never lost and never paid twice.
//! - Each invoice digest is paid at most once.
//!
//! No keys on this account; no admin; no upgrade.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

const CONTROL_GAS: Gas = Gas::from_tgas(10);
const TRANSFER_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(15);

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ControlView {
    pub owner: AccountId,
    pub generation: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Grant {
    pub agent: AccountId,
    pub suppliers: Vec<AccountId>,
    pub per_payment: U128,
    pub per_period: U128,
    pub period_ms: U64,
    pub review_above: U128,
    /// The business's generation the grant was made at; it ends when control moves.
    pub generation: u32,
    pub granted_by: AccountId,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum PaymentState {
    /// Above the review threshold: waits for the owner's approval of this exact invoice.
    AwaitingApproval,
    /// Reserved and sent to the token; the callback hasn't answered yet.
    Sending,
    Paid,
    /// The token refused the transfer: the amount is the supplier's claim.
    Claim,
    /// Refused before any money moved (the reason is in the event log).
    Refused,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    pub supplier: AccountId,
    pub amount: U128,
    pub invoice: String,
    pub state: PaymentState,
    pub generation: u32,
    pub at_ms: U64,
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Payments,
    Claims,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SpendAllowance {
    business: AccountId,
    token: AccountId,
    grant: Option<Grant>,
    /// Token held here (funded, minus paid and claimed-out).
    balance: u128,
    /// Reserved for payments in flight or awaiting approval.
    reserved: u128,
    /// Owed to suppliers whose transfers failed.
    claims_total: u128,
    period_start_ms: u64,
    spent_in_period: u128,
    payments: IterableMap<String, Payment>,
    claims: LookupMap<AccountId, u128>,
}

fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "spend-allowance", "version": "1.0.0", "event": name, "data": [data] })
    ));
}

fn digest_ok(d: &str) -> bool {
    d.len() == 64 && d.bytes().all(|b| b.is_ascii_hexdigit())
}

#[near]
impl SpendAllowance {
    #[init]
    pub fn new(business: AccountId, token: AccountId) -> Self {
        Self {
            business,
            token,
            grant: None,
            balance: 0,
            reserved: 0,
            claims_total: 0,
            period_start_ms: 0,
            spent_in_period: 0,
            payments: IterableMap::new(Key::Payments),
            claims: LookupMap::new(Key::Claims),
        }
    }

    // ---------- views ----------

    pub fn get_allowance(&self) -> near_sdk::serde_json::Value {
        json!({
            "business": self.business, "token": self.token, "grant": self.grant,
            "balance": U128(self.balance), "reserved": U128(self.reserved),
            "claims_total": U128(self.claims_total), "available": U128(self.available()),
            "period_start_ms": U64(self.period_start_ms), "spent_in_period": U128(self.spent_in_period),
        })
    }

    pub fn get_payment(&self, invoice: String) -> Option<Payment> {
        self.payments.get(&invoice).cloned()
    }

    pub fn get_payments(&self, from: u32, limit: u32) -> Vec<Payment> {
        self.payments
            .values()
            .skip(from as usize)
            .take(limit.min(50) as usize)
            .cloned()
            .collect()
    }

    pub fn get_claim(&self, supplier: AccountId) -> U128 {
        U128(*self.claims.get(&supplier).unwrap_or(&0))
    }

    fn available(&self) -> u128 {
        self.balance - self.reserved - self.claims_total
    }

    // ---------- funding (a token transfer with msg "fund") ----------

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.token,
            "E_TOKEN: only the budget's token"
        );
        if msg != "fund" {
            return PromiseOrValue::Value(amount); // refunded in full
        }
        self.balance += amount.0;
        event(
            "allowance_funded",
            json!({ "from": sender_id, "amount": amount }),
        );
        PromiseOrValue::Value(U128(0))
    }

    // ---------- the owner's actions, each checked against the business contract now ----------

    /// Grants (or replaces) the allowance for the business's current generation.
    pub fn grant(
        &mut self,
        agent: AccountId,
        suppliers: Vec<AccountId>,
        per_payment: U128,
        per_period: U128,
        period_ms: U64,
        review_above: U128,
    ) -> Promise {
        require!(
            !suppliers.is_empty() && suppliers.len() <= 10,
            "E_INPUT: 1 to 10 suppliers"
        );
        require!(
            per_payment.0 > 0 && per_payment.0 <= per_period.0,
            "E_INPUT: per-payment cap within the period cap"
        );
        require!(
            period_ms.0 >= 60_000,
            "E_INPUT: a period of at least a minute"
        );
        let g = Grant {
            agent,
            suppliers,
            per_payment,
            per_period,
            period_ms,
            review_above,
            generation: 0,
            granted_by: env::predecessor_account_id(),
        };
        self.control().then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_grant(g),
        )
    }

    #[private]
    pub fn on_grant(
        &mut self,
        g: Grant,
        #[callback_result] control: Result<ControlView, PromiseError>,
    ) -> String {
        let Ok(c) = control else {
            env::panic_str("E_CONTROL_UNREAD: the business contract couldn't be read")
        };
        require!(
            c.owner == g.granted_by,
            "E_NOT_OWNER: only the business's current owner can grant"
        );
        let g = Grant {
            generation: c.generation,
            ..g
        };
        // A new grant starts a new period.
        self.period_start_ms = env::block_timestamp_ms();
        self.spent_in_period = 0;
        event("allowance_granted", json!({ "grant": g }));
        self.grant = Some(g);
        "granted".to_string()
    }

    /// Approves one invoice that waited for review; it is then paid like any other.
    pub fn approve(&mut self, invoice: String) -> Promise {
        let p = self
            .payments
            .get(&invoice)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E_NO_PAYMENT: no such invoice"));
        require!(
            p.state == PaymentState::AwaitingApproval,
            "E_STATE: not awaiting approval"
        );
        self.control().then(
            Self::ext(env::current_account_id())
                .with_static_gas(
                    CALLBACK_GAS
                        .saturating_add(TRANSFER_GAS)
                        .saturating_add(CALLBACK_GAS),
                )
                .on_approve(env::predecessor_account_id(), invoice),
        )
    }

    #[private]
    pub fn on_approve(
        &mut self,
        caller: AccountId,
        invoice: String,
        #[callback_result] control: Result<ControlView, PromiseError>,
    ) -> PromiseOrValue<String> {
        let p = self.payments.get(&invoice).cloned().expect("the payment");
        let Ok(c) = control else {
            env::panic_str("E_CONTROL_UNREAD: the business contract couldn't be read")
        };
        require!(
            c.owner == caller,
            "E_NOT_OWNER: only the business's current owner can approve"
        );
        if !self.grant_live(c.generation) || p.generation != c.generation {
            return PromiseOrValue::Value(self.refuse(&invoice, "E_GRANT_ENDED"));
        }
        self.send(invoice, p)
    }

    /// The current owner takes back budget nobody is owed (not reserved, not claimed).
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        require!(
            amount.0 > 0 && amount.0 <= self.available(),
            "E_AVAILABLE: more than is free"
        );
        self.reserved += amount.0;
        self.control().then(
            Self::ext(env::current_account_id())
                .with_static_gas(
                    CALLBACK_GAS
                        .saturating_add(TRANSFER_GAS)
                        .saturating_add(CALLBACK_GAS),
                )
                .on_withdraw(env::predecessor_account_id(), amount),
        )
    }

    #[private]
    pub fn on_withdraw(
        &mut self,
        caller: AccountId,
        amount: U128,
        #[callback_result] control: Result<ControlView, PromiseError>,
    ) -> PromiseOrValue<String> {
        let owner = control.map(|c| c.owner == caller).unwrap_or(false);
        if !owner {
            // Not a panic: a panic here would undo releasing the reservation.
            self.reserved -= amount.0;
            event(
                "withdraw_refused",
                json!({ "caller": caller, "code": "E_NOT_OWNER" }),
            );
            return PromiseOrValue::Value("E_NOT_OWNER".to_string());
        }
        self.transfer(caller.clone(), amount.0)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_withdrawn(caller, amount),
            )
            .into()
    }

    #[private]
    pub fn on_withdrawn(&mut self, to: AccountId, amount: U128) -> String {
        self.reserved -= amount.0;
        if near_sdk::is_promise_success() {
            self.balance -= amount.0;
            event("allowance_withdrawn", json!({ "to": to, "amount": amount }));
            "withdrawn".to_string()
        } else {
            "not_withdrawn".to_string()
        }
    }

    // ---------- the agent's one action ----------

    /// Pays an allowed supplier for one invoice, within the caps. Above the review threshold it
    /// waits for the owner's approval instead. The amount is reserved now, before anything else.
    pub fn pay(
        &mut self,
        supplier: AccountId,
        amount: U128,
        invoice: String,
    ) -> PromiseOrValue<String> {
        let g = self
            .grant
            .clone()
            .unwrap_or_else(|| env::panic_str("E_NO_GRANT: no allowance is granted"));
        require!(
            env::predecessor_account_id() == g.agent,
            "E_NOT_AGENT: only the granted agent can pay"
        );
        require!(
            digest_ok(&invoice),
            "E_INPUT: the invoice digest is 64 hex characters"
        );
        require!(
            self.payments.get(&invoice).is_none(),
            "E_REPLAY: this invoice was already submitted"
        );
        require!(
            g.suppliers.contains(&supplier),
            "E_SUPPLIER: not an allowed supplier"
        );
        require!(
            amount.0 > 0 && amount.0 <= g.per_payment.0,
            "E_CAP: above the per-payment cap"
        );
        self.roll_period(&g);
        require!(
            self.spent_in_period + amount.0 <= g.per_period.0,
            "E_PERIOD_CAP: the period's cap would be exceeded"
        );
        require!(amount.0 <= self.available(), "E_BUDGET: not enough budget");
        // Reserve now: counted against the period and the budget before any cross-contract call.
        self.spent_in_period += amount.0;
        self.reserved += amount.0;
        let p = Payment {
            supplier,
            amount,
            invoice: invoice.clone(),
            state: PaymentState::Sending,
            generation: g.generation,
            at_ms: U64(env::block_timestamp_ms()),
        };
        if amount.0 > g.review_above.0 {
            let p = Payment {
                state: PaymentState::AwaitingApproval,
                ..p
            };
            event("payment_awaiting_approval", json!({ "payment": p }));
            self.payments.insert(invoice, p);
            return PromiseOrValue::Value("awaiting_approval".to_string());
        }
        self.payments.insert(invoice.clone(), p);
        self.control()
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(
                        CALLBACK_GAS
                            .saturating_add(TRANSFER_GAS)
                            .saturating_add(CALLBACK_GAS),
                    )
                    .on_pay(invoice),
            )
            .into()
    }

    #[private]
    pub fn on_pay(
        &mut self,
        invoice: String,
        #[callback_result] control: Result<ControlView, PromiseError>,
    ) -> PromiseOrValue<String> {
        let p = self.payments.get(&invoice).cloned().expect("the payment");
        let Ok(c) = control else {
            return PromiseOrValue::Value(self.refuse(&invoice, "E_CONTROL_UNREAD"));
        };
        if !self.grant_live(c.generation) {
            return PromiseOrValue::Value(self.refuse(&invoice, "E_GRANT_ENDED"));
        }
        self.send(invoice, p)
    }

    #[private]
    pub fn on_sent(&mut self, invoice: String) -> String {
        let mut p = self.payments.get(&invoice).cloned().expect("the payment");
        self.reserved -= p.amount.0;
        if near_sdk::is_promise_success() {
            self.balance -= p.amount.0;
            p.state = PaymentState::Paid;
            event("payment_paid", json!({ "payment": p }));
        } else {
            *self.claims.entry(p.supplier.clone()).or_insert(0) += p.amount.0;
            self.claims_total += p.amount.0;
            p.state = PaymentState::Claim;
            event("payment_claim", json!({ "payment": p }));
        }
        let s = if p.state == PaymentState::Paid {
            "paid"
        } else {
            "claim"
        };
        self.payments.insert(invoice, p);
        s.to_string()
    }

    /// A supplier collects what a failed transfer left them.
    pub fn claim(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.claims.remove(&who).unwrap_or(0);
        require!(amount > 0, "E_NO_CLAIM: nothing is owed to you");
        self.claims_total -= amount;
        self.reserved += amount;
        self.transfer(who.clone(), amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_claimed(who, U128(amount)),
        )
    }

    #[private]
    pub fn on_claimed(&mut self, who: AccountId, amount: U128) -> String {
        self.reserved -= amount.0;
        if near_sdk::is_promise_success() {
            self.balance -= amount.0;
            "paid".to_string()
        } else {
            *self.claims.entry(who).or_insert(0) += amount.0;
            self.claims_total += amount.0;
            "claim".to_string()
        }
    }

    // ---------- internals ----------

    fn control(&self) -> Promise {
        Promise::new(self.business.clone()).function_call(
            "get_control".to_string(),
            b"{}".to_vec(),
            NearToken::from_yoctonear(0),
            CONTROL_GAS,
        )
    }

    fn grant_live(&self, generation: u32) -> bool {
        self.grant
            .as_ref()
            .map(|g| g.generation == generation)
            .unwrap_or(false)
    }

    fn roll_period(&mut self, g: &Grant) {
        let now = env::block_timestamp_ms();
        if now >= self.period_start_ms + g.period_ms.0 {
            self.period_start_ms = now;
            self.spent_in_period = 0;
        }
    }

    /// Ends a payment that never moved money: its reservation and period count are released.
    fn refuse(&mut self, invoice: &str, code: &str) -> String {
        let mut p = self.payments.get(invoice).cloned().expect("the payment");
        self.reserved -= p.amount.0;
        self.spent_in_period = self.spent_in_period.saturating_sub(p.amount.0);
        p.state = PaymentState::Refused;
        event(
            "payment_refused",
            json!({ "invoice": invoice, "code": code }),
        );
        self.payments.insert(invoice.to_string(), p);
        code.to_string()
    }

    fn send(&mut self, invoice: String, mut p: Payment) -> PromiseOrValue<String> {
        p.state = PaymentState::Sending;
        let (to, amount) = (p.supplier.clone(), p.amount.0);
        self.payments.insert(invoice.clone(), p);
        self.transfer(to, amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_sent(invoice),
            )
            .into()
    }

    fn transfer(&self, to: AccountId, amount: u128) -> Promise {
        Promise::new(self.token.clone()).function_call(
            "ft_transfer".to_string(),
            near_sdk::serde_json::to_vec(&json!({ "receiver_id": to, "amount": U128(amount) }))
                .unwrap(),
            NearToken::from_yoctonear(1),
            TRANSFER_GAS,
        )
    }
}
