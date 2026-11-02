# 003d design: business-v3 protocol for transferring a digital business (proposal v1)

This is for Astra to review and save. I wrote no files, changed no code, ran no commands and touched no status. Everything below comes from reading source and documents. I tested nothing. I read v2 `contracts/business-v2/src/lib.rs`, the structure of `server/src/deals.ts`, `docs/design/BUILD_RUNTIME.md`, `BUSINESS_V2.md`, the 003a report, the M3 adversarial review, the financial review, and jobs 002c, 003, 003b, 003d, 003f and 003p. NEAR facts were checked against official docs on 2026-11-02. Section 19 lists each link and marks what is verified and what is inferred.

---

## 0. Summary

- **New contract.** `contracts/business-v3` gets a new global code hash, used by hash, on new keyless accounts. It has no self-upgrade method, so its rules really are fixed. v1, v2, Juniper and all evidence stay as they are.
- **Units, not money.** Purchases are counted in units of an immutable plan. Each charge needs a use signed by the customer's own key, and the contract checks that signature. That proves the customer authorized the charge. It does not prove the service was delivered; the runtime attests delivery.
- **Reserve before serving.** The gateway serves a use only inside a hold it has seen confirmed on chain. Withdrawals can't race usage, because the contract orders holds and refunds.
- **A close needs a readiness attestation.** On a managed business, matching acceptances only move the deal to `Closing` and freeze on-chain administration. Ownership changes only through `close_sale` with a valid readiness attestation from the managed runtime. That attestation is bound to the business, deal, version, digest, generation, freeze epoch, service manifest and expiry. Because the runtime freezes before it signs, there is no window in which the former owner can administer the business after the close, even when the close happens outside the platform UI or the runtime sees it late.
- **Weaker modes stay labelled.** Observed mode (v3 without the managed runtime) and v1/v2 keep the weaker guarantee ("refused once the close is observed"). Section 11 says exactly what they get.

---

## 1. Scope and migration boundary

| Item | Decision |
|---|---|
| v1/v2 contracts, accounts, wasm, evidence | Unchanged. They are shown in the app as "legacy: operator-trusted credit; observed-finality revocation". |
| v3 code | Crate `business-v3`, published as a global contract **by hash**. Each business is a new keyless account using that hash. Docs: deployment by hash is immutable; deployment by account ID can be redeployed by its owner. |
| Contract upgrades | No update or migrate method. Docs: a locked account can still upgrade itself if its code exposes an update method, so including one would make the fixed rules revisable. A v4 means a new account; customers keep the right to refund in v3 and move by choice. |
| Service upgrades (the part that should not be frozen) | Off chain, through releases that must satisfy a plan's **service contract** (§4). Old entitlements are served by new compatible releases. Incompatible changes are routed to an older compatible release or ended through plan sunset with a funded refund. |
| Identifiers | Neutral throughout: event standard `business_control`, version `3.0.0`, digest domains `business-deal/v3`, `business-readiness/v1`, `business-use/v1`. |
| Execution mode | Fixed at `new`: `Managed { metering_account, registry_account }` or `Observed`. It can't be changed in v3 (§16, decision C). |

---

## 2. Three kinds of guarantee

| Claim | Kind | Mechanism |
|---|---|---|
| A charged use was authorized by the customer for that exact request fingerprint | **Cryptographic, enforced by the contract** | Customer's ed25519 use-key signature, verified with `env::ed25519_verify` at settlement |
| A use is charged at most once, at the plan's fixed unit price | **Enforced by the contract** | Per-key nonce window; `unit_price` is immutable on the plan |
| Unused units are always refundable at unit price; liabilities are fully backed | **Enforced by the contract** | Bucket invariant I1 and units invariant I2; unconsumed units never become owner money |
| Available treasury ≥ the agreed floor at close; no seller withdrawal below it after any acceptance | **Enforced by the contract** | Floor is in the digest; checked on withdrawal and at finalize |
| Successor grants are exactly the accepted ones; old grants are void in the same execution | **Enforced by the contract** | `finalize` |
| Managed close can't happen without a readiness signature for this exact deal, epoch and manifest | **Enforced by the contract (signature authenticity)** | `close_sale` verifies the attestor signature |
| Administration was actually drained and fenced, and the manifest is true | **Runtime attestation (trusted)** | The managed runtime's durable freeze and fencing |
| The use was delivered, and its output was correct or useful | **Runtime attestation (trusted)**, with signed receipts as audit evidence | Delivery and failure receipts signed by the runtime |
| A former owner is refused off chain in Observed or legacy mode | **Observed finality** | Reconciler (003b) plus commit fences; window stated in the UI |

A readiness signature proves only that the runtime key signed. It doesn't prove the drain happened. A usage cap or hash proves nothing about delivery.

---

## 3. Contract state (`business-v3`)

```rust
pub struct Rules {                       // fixed at new()
    pub mode: Mode,                      // Managed{metering_account, registry_account} | Observed
    pub min_reserve: U128,
    pub close_window_ms: (u64, u64),     // allowed range for a deal's close window, e.g. 30m..24h
    pub sunset_notice_min_ms: u64,       // e.g. 30 days
    pub hold_caps: HoldCaps,             // ceilings any plan must respect: units ≤ 50, ttl ≤ 1h, grace ≤ 30m
}
pub struct Business {
    name: String, asset: AccountId, rules: Rules,
    owner: AccountId, generation: u32,
    operators: IterableMap<AccountId, Operator>,   // ≤ MAX_OPERATORS = 8
    plans: LookupMap<u32, Plan>, plan_count: u32,  // ≤ MAX_PLANS = 32
    entitlements: LookupMap<EntKey, Entitlement>,  // count unbounded; each record prepaid by its registrant
    party_claims: LookupMap<AccountId, u128>,      // only pre-funded slots (§7)
    deal: Option<Deal>, deal_seq: u64,             // at most one live deal
    freeze_epoch: u64, last_close: Option<CloseRecord>,
    attestor: Option<[u8; 32]>,                    // Managed only; rotated only by registry_account
    periods: LookupMap<u32, Period>,               // one per UTC month
    // buckets (u128, base units of `asset`)
    held, ent_free_value, ent_held_value, available, pending, escrow, claims_total,
}
pub struct Operator { caps: u8 /*METERING=1, SUPPORT=2*/, generation: u32,
                      support_daily_cap: u128, support_day: u32, support_spent: u128 }
```

### Plan (immutable apart from `status`)

```rust
pub struct Plan {
    product_id: [u8; 16], unit_price: u128,
    max_units_per_purchase: u32, max_units_outstanding: u32,   // per entitlement, e.g. 10_000
    max_hold_units: u32, hold_ttl_ms: u64, settle_grace_ms: u64,
    service_contract: [u8; 32],   // digest of the service contract (§4)
    terms_hash: [u8; 32],         // salted digest of the plain-language plan terms (retention, refund, service policy)
    status: PlanStatus,           // Open | SalesClosed | Sunset { service_ends_at_ms }
    created_generation: u32,
}
```

### Entitlement (fixed size; never grows after `register`)

```rust
pub struct EntKey { customer: AccountId, plan_id: u32 }
pub struct Entitlement {
    incarnation: u64,             // block height at register; bound into every use signature
    free: u64, consumed: u64, refunded: u64, purchased: u64,
    purchase_seq: u32, hold_seq: u32,
    hold: Hold,                   // fixed struct with an `active` flag, not Option
    keys: [UseKey; 4],            // fixed slots; inactive keys are zeroed
    claim: u128,                  // money owed to this customer (failed refund, goodwill)
    paused: bool,                 // set by the customer: no new holds
    pending_refunds: u8,          // blocks unregister while a payout is in flight
    storage_payer: AccountId, storage_paid: u128,
}
pub struct Hold { active: bool, seq: u32, units: u32, consumed: u32,
                  opened_at_ms: u64, serve_until_ms: u64, settle_until_ms: u64 }
pub struct UseKey { active: bool, pk: [u8; 32], high: u64, window: u128, revoked_at_ms: u64 }
```

**Size estimate, not measured.** Value about 450 B, key about 73 B, plus trie overhead. I budget 600 B, which is about 0.006 NEAR at 10¹⁹ yocto/byte (verified price). The S1 slice measures the real figure. `register` charges the **measured** `env::storage_usage()` delta (the pattern in the docs) and stores it in `storage_paid`.

**No token-balance shortcut.** Units are stored as unit counts. Money is tracked in separate aggregate buckets. The two are tied by equations I1 and I2 (§6). Nothing ever derives units from a balance.

---

## 4. Purchased rights, service contracts and compatible upgrades

### Service contract

The service contract is an off-chain canonical JSON document. Only its digest goes on chain.

```json
{ "v":1, "product_id":"…", "interface":{"input_kind":"text","max_input_bytes":65536},
  "output_schema_digest":"…",                      // field names, types, required/nullable
  "quality_suite":{"digest":"…","threshold":{"field_exact_min":0.95,"schema_valid":1.0}},
  "limits":{"max_output_bytes":16384,"deliver_within_ms":60000},
  "retention":"input_none_after_completion;output_7d", "salt":"<32 random bytes>" }
```

The salt stops anyone guessing the document from its digest.

### Compatibility and routing (runtime, 002c)

A release R may serve plan p only if all of the following hold. Each check is a durable record bound to R's artifact digest.

1. R's output schema equals p's schema, or is a strict superset whose extra fields are projected away for p's customers.
2. R's input limits are at least p's limits.
3. R passed p's `quality_suite` at or above the threshold, in an evaluation run tied to R's artifact digest.
4. R uses an allowed provider binding (§12).

Routing for a use of plan p picks the owner-selected release among those compatible with p. If the owner makes an incompatible release the product default, p stays routed to its newest compatible release (the "pinned fallback"). A use stays pinned to the release it started on (002c).

The runtime keeps a fallback release `supported` while any plan using it has outstanding units. If no compatible release can run (for example, the provider withdrew the model), the runtime marks p `unservable`, refuses new holds for p, and tells customers. Their units stay refundable at all times (below).

### Fixed economic rights

- `unit_price`, `service_contract` and `terms_hash` never change.
- A new owner sets new prices by creating a new plan. They may `close_plan_sales(p)`, which stops new purchases only.
- `sunset_plan(p, service_ends_at_ms)` requires `service_ends_at_ms ≥ now + rules.sunset_notice_min_ms`. After that time, holds are refused for p.

### Funded remedy for inability to serve

In v3, **unused units are always refundable at `unit_price`**. This is a constant, not an option. Money for unconsumed units sits in `ent_free_value + ent_held_value`. Only settlement of a customer-signed use can move it into `available`. So the remedy is always funded, whoever owns the business, and nobody promises that a particular third-party model will stay available.

Units don't expire in v3 (decision E).

---

## 5. Authorizing, reserving and settling a use

### 5.1 What the customer authorizes

The customer's client holds an ed25519 use-key: browser WebCrypto or an SDK, never the seller's or the platform's account key. Each request carries a `SignedUse`:

```rust
pub struct SignedUse { key_index: u8, nonce: u64, fingerprint: [u8; 32],
                       not_after_ms: u64, signature: [u8; 64] }
// signed bytes = sha256(borsh(("business-use/v1", business_account, plan_id, customer,
//                              incarnation, key_index, nonce, fingerprint, not_after_ms)))
// fingerprint  = sha256("fp/v1" || request_salt(32B, client-random) || sha256(input) || canonical(params))
```

The logical request ID is `(customer, plan_id, key_index, nonce)`. The fingerprint binds the exact payload. The salt means the fingerprint published on chain can't be dictionary-matched against a known document.

There is no per-use NEAR transaction. The customer's on-chain actions are `register`, purchase and refund. The per-use authorization is the signature.

### 5.2 Holds (on chain): reserve before billable work

| Method | Caller | Guards | Effect |
|---|---|---|---|
| `open_hold(customer, plan_id, hold_seq, units)` | METERING operator or owner. Not payable, so a function-call key works (verified: function-call keys can't attach deposits). | Plan not `Sunset` past its end date; not `unservable`; entitlement not `paused`; no active hold; `hold_seq == ent.hold_seq + 1`; `units ≤ min(plan.max_hold_units, ent.free)` | `free −= units`; hold becomes active with `serve_until = now + ttl` and `settle_until = serve_until + grace`. **Idempotent:** if `hold_seq == ent.hold_seq` and the active hold has the same `units`, it returns "already" with no change. A different `units` value fails with `E_CONFLICT`. |
| `settle_hold(customer, plan_id, hold_seq, uses: Vec<SignedUse>, close: bool)` | METERING operator or owner, not payable | Active hold with this sequence; `now ≤ settle_until`; `uses.len() ≤ MAX_USES_PER_SETTLE` (start at 16; measure); for each use, the key is active, or was revoked with `revoked_at_ms > hold.opened_at_ms`; `not_after_ms ≤ hold.serve_until_ms`; signature valid | Per use: nonce already set in the window → **skip** (counts as `already`, no charge). Nonce older than `high − 127` → **panic `E_REPLAY_OLD`**. Otherwise set the bit and add one to the charged count `c`. Requires `hold.consumed + c ≤ hold.units`. Then `consumed += c`, value `c·P` moves held → available, and `earned` goes into the period ledger. If `close`, the remainder returns to `free` and the hold deactivates. |
| `release_hold(customer, plan_id, hold_seq)` | Operator at any time; **anyone** after `settle_until`; not payable | Active hold with this sequence | Remainder returns to `free`; hold deactivates. Uses served but not settled are lost revenue for the business. |

### 5.3 Customer methods

| Method | Notes |
|---|---|
| `register(plan_id, use_key, for_customer: Option<AccountId>)`, payable | Anyone may sponsor storage. `storage_payer` gets it back on `unregister`. Sets `incarnation = env::block_height()`. |
| `add_use_key` / `revoke_use_key(plan_id, idx)`, 1 yocto, customer only | At most 4 slots. Revoking sets `revoked_at_ms`; settlement accepts uses from that key only within a hold opened before the revocation. |
| `set_paused(plan_id, bool)`, 1 yocto | Customer exit control: no new holds. |
| `refund_units(plan_id, units)`, 1 yocto → Promise | `units ≤ free`. Payout = `units·P`. Increments `pending_refunds`. |
| `claim()`, 1 yocto → Promise | Pays out `claim` (customer) or `party_claims[caller]`. |
| `unregister(plan_id)`, 1 yocto | Requires `free = 0`, no hold, `claim = 0`, `pending_refunds = 0`. Returns storage NEAR to `storage_payer`. Re-registering gives a new `incarnation`, so every old signature becomes invalid. |
| Purchase via `ft_on_transfer` with msg `{"buy":{"plan_id":1,"units":100,"purchase_seq":1}}` | Returns the **full amount** (refund) unless: plan is `Open`; entitlement exists (the FT receipt carries no NEAR deposit, so storage must already be paid); `amount == units·P` exactly; `purchase_seq == ent.purchase_seq + 1`; `free + held + units ≤ max_units_outstanding`. A duplicate `purchase_seq` returns the money and emits `purchase_duplicate_returned`. |

### 5.4 Off-chain use states (gateway, 002c ledger)

The table is `uses(business, customer, plan, key_index, nonce)`, UNIQUE on that tuple, and stores fingerprint, release, hold sequence and state.

```
admitted ──dispatch-intent committed──► dispatched ──valid output before deliver_by──► delivered ──outbox──► settling ──final read──► settled
   │                                      │  └──provider error / invalid / deadline passed──► failed(no charge)
   │                                      └──crash / restart──► unknown ──provider reconciliation before deliver_by──► delivered | failed
   └──hold closed or expired before dispatch──► failed(no charge)
```

**Admission** happens in one `BEGIN IMMEDIATE` transaction and requires all of the following:

- the signature verifies against the key as last observed on chain;
- the entitlement's hold is active **and observed at final finality**;
- `chain_now_est < serve_until − margin`, where `margin ≥ deliver_within + settlement budget + 2 min of clock skew`;
- admitted uses in this hold `< hold.units`;
- the nonce is above the key's settled watermark minus 64;
- unsettled admitted uses for this key `≤ 64`.

If no hold is open, the gateway opens one (`open_hold`, waiting for `FINAL`). The first request in a hold therefore pays about one finality latency, roughly 1.2 s per the docs.

**Idempotency:**

- Same tuple and same fingerprint returns the stored outcome. If the output's retention has expired, it returns "delivered; output no longer retained". It never runs again.
- Same tuple with a **different fingerprint** returns `409 conflict`, and that payload is never served. The chain stores no fingerprints, but a nonce is consumed only once, so at most one of the two payloads can ever be charged.

**Timeout and late success.** `deliver_by = min(not_after_ms, serve_until − settle_margin)`. If the client times out, it polls with the same signed request. A provider result that arrives after `deliver_by` is discarded. The use becomes `failed(late)` and isn't charged. The provider cost goes on the business's runtime ledger. Terminal states are final.

**Receipts.** For every outcome the runtime signs a receipt `{tuple, fingerprint, state, release, output_digest?}` with its runtime key and returns it to the customer. If a "failed" receipt is later charged, the customer holds signed evidence of the contradiction. That is evidence for a dispute, not something the contract enforces.

**Settlement outbox.** Each batch is persisted before it is sent. If the outcome is unknown, the gateway reads `get_entitlement` (the window bits) and resubmits only uses whose nonce bits are clear. That is safe because the contract skips nonces it has already settled. Paid provider calls are never automatically re-run (002a rule).

### 5.5 Bounds on replay and history

- **On chain:** a 128-nonce window per key. Anything older is refused. Pruning off-chain history therefore can't lead to a second charge, because an old nonce can't be settled again.
- **Off chain:** rows are kept at least until their nonce is below the on-chain watermark minus 128 **and** the plan's retention period has passed. After that they compact to a per-key watermark. A replay below the watermark gets `409 expired request id`, with no service and no charge.

---

## 6. Money: buckets, equations and every transition

Let `P_p` be plan p's unit price. For an entitlement e: `H_e = hold.units − hold.consumed` if the hold is active, otherwise 0.

**I1 (checked after every method and callback):**
`held = ent_free_value + ent_held_value + available + pending + escrow + claims_total`

**I1a:** `ent_free_value = Σ free_e·P_p`, `ent_held_value = Σ H_e·P_p`. These are maintained incrementally, never recomputed by iteration. Debug and test builds also assert per-record deltas.

**I2 (per entitlement, units are conserved):**
`purchased = free + H + consumed + refunded`

**I3:** while `deal.state ∈ {Accepting, Closing}`, `available ≥ deal.floor` after every method.

**I4:** `available` increases **only** through `settle_hold`. It decreases only through `withdraw_profit` and `goodwill_refund`. No callback writes to `available`.

**I5:** `held` changes only in `ft_on_transfer` (+) and in a successful payout callback (−). Sandbox tests check that `ft_balance_of(business) ≥ held`, with equality when no stray plain `ft_transfer` was received.

| Operation (amounts in tokens) | free_v | held_v | avail | pend | escrow | claims | held |
|---|---|---|---|---|---|---|---|
| buy u units | +uP | | | | | | +uP |
| open_hold h | −hP | +hP | | | | | |
| settle c | | −cP | +cP | | | | |
| close or release hold, remainder r | +rP | −rP | | | | | |
| refund_units u | −uP | | | +uP | | | |
| withdraw_profit a (respects reserve and I3) | | | −a | +a | | | |
| goodwill_refund g (SUPPORT, daily cap, respects I3) | | | −g | | | +g (customer claim) | |
| claim a | | | | +a | | −a | |
| payout success a | | | | −a | | | −a |
| **payout failure a** | | | | −a | | **+a to the payout's fixed beneficiary** | |
| fund_deal (exact price) | | | | | +p | | +p |
| finalize | | | | | −p | +p (seller party claim) | |
| cancel, expire or abort with escrow | | | | | −p | +p (buyer party claim) | |

### Payouts and callbacks, including across an ownership change

```rust
enum Payout { CustomerRefund{customer, plan_id, amount}, Claim{to, amount}, Profit{to, amount} }
```

A payout moves money to `pending` and calls `ft_transfer` with 1 yocto. `on_payout` is `#[private]`, O(1), never panics on the expected failure, and has static gas reserved when the promise is created. Methods that start a payout require `env::prepaid_gas() ≥ PAYOUT_MIN_GAS`.

- **Success:** `pending −= a`, `held −= a`, record in the period ledger; decrement `pending_refunds` if applicable.
- **Failure:** `pending −= a`, then credit the beneficiary fixed at request time. For a customer that is `ent.claim += a` (the record already has the slot). For anyone else it is `party_claims[to] += a`, using a pre-funded slot (§7). Never `available`. Writing `claim` takes no new storage, so the callback can't fail on storage.

Result: a seller's profit withdrawal that fails after the close becomes the **seller's** claim. It never becomes buyer money, and it was never counted toward the floor because it had already left `available`. A customer refund whose transfer fails (for example, the customer isn't registered with the FT) becomes the customer's claim. They register with the token, then call `claim()`.

**Callback failure (docs-verified).** The callback is guaranteed to run, but it can fail and is not retried. If it ran out of gas, `pending` would stay stuck. Mitigations: fixed static gas measured in S4 with a 2× margin, constant-size arguments and a short fixed log. A stuck pending amount stays visible in `get_treasury().pending` as a disclosed anomaly. There is deliberately no on-chain "resolve" method, because the contract can't learn the transfer outcome.

---

## 7. Storage, admission and resource bounds

| Resource | Bound | Who pays |
|---|---|---|
| Entitlements | No global count. The contract **never iterates** customers; aggregates only. | Registrant or sponsor, measured delta, refundable on `unregister` |
| Use keys per entitlement | 4 fixed slots | Included in the entitlement |
| Window per key | 128 nonces (u64 + u128) | Included |
| Holds | 1 per entitlement, fixed struct | Included |
| Plans | ≤ 32 | Owner deposit on `create_plan` (measured) |
| Operators | ≤ 8; `finalize` clears ≤ 8 and installs ≤ 4 | Owner deposit on appoint |
| Deals | 1 live at a time. On terminal state, escrow moves to the buyer's claim and the record is deleted. `last_close` keeps one summary. History lives in events. | Proposer's `propose_sale` deposit covers the deal record plus two party-claim slots (buyer, seller) |
| Party claims | One slot per seller or buyer, pre-funded by the deal deposit. The initial owner's slot is funded at `new`. | As stated |
| Period ledger | One record per month, about 100 B | Business balance (12 per year) |
| Pending payouts | No stored records; the data travels in callback arguments | — |
| `settle_hold` batch | ≤ 16 uses (to be measured) | Operator gas |
| Transaction gas | Max 1 PGas per transaction from protocol 83 (verified). Keep every method ≤ 150 Tgas worst case. | — |

**Storage exhaustion.** Every operation that grows state is payable and charges the measured delta. Callbacks and `ft_on_transfer` never grow state. A business account low on NEAR can still serve, settle, refund and claim, because none of those grow storage. It can only fail to add plans or deals.

---

## 8. Deal terms, digest and state machine

```rust
pub struct DealTermsInput {
    buyer: AccountId, price: U128, expires_at_ms: U64, close_window_ms: U64,
    available_floor: U128,
    successor_grants: Vec<Grant>,              // ≤ 4; Managed: must include metering_account with METERING
    required_service_manifest: [u8; 32],       // Managed: the manifest the buyer accepts (§9.3)
    terms_hash: [u8; 32],                      // salted canonical off-chain terms: transfer inventory,
}                                              // disclosure snapshot ref, data categories, external items
pub struct Grant { account: AccountId, caps: u8, support_daily_cap: U128 }
// digest = sha256(borsh(("business-deal/v3", current_account, code_version=3, deal_seq, version,
//   seller, buyer, asset, price, expires_at_ms, close_window_ms, expected_generation, available_floor,
//   plan_manifest_digest(), sha256(borsh(successor_grants)), mode, attestor, required_service_manifest, terms_hash)))
// plan_manifest_digest() = sha256 over (plan_id, borsh(Plan without status)) for all plans in id order (≤ 32)
```

The digest is **recomputed from live state** at every `accept_sale` and `close_sale`. Any change to an input (plans, attestor, generation, owner, terms) makes stored acceptances stale automatically. Admin methods that would change an input are also refused explicitly while a deal is live (below), so a stale acceptance is never silent.

### States

`Proposed(v)` → `Accepting(v, by)` → `Closing(v, epoch, deadline)` → `Closed`. Other terminal states: `Cancelled | Expired | Aborted`.

| Method | Caller | From | Guards | To / effect |
|---|---|---|---|---|
| `propose_sale(terms)`, payable | owner | no live deal | Not frozen; grants valid (Managed requires metering_account); `close_window_ms` within rule bounds; expiry in the future; storage deposit | `Proposed(1)`, `deal_seq += 1`, emit digest |
| `revise_sale(terms)`, 1 yocto | seller | Proposed, Accepting | Same validation | `Proposed(v+1)`; both acceptances cleared |
| `ft_on_transfer` fund_deal `{deal_seq, version}` | buyer | Proposed, Accepting | `amount == price`, not already funded, version matches | escrow += price |
| `unfund_deal`, 1 yocto | buyer | Proposed, Accepting | Funded | escrow → buyer claim; buyer acceptance cleared |
| `accept_sale(digest)`, 1 yocto | seller or buyer | Proposed, Accepting | `now < expires_at`; `generation == expected`; `seller == owner`; digest == live digest; buyer funded (for the buyer); `available ≥ floor` | Records acceptance. On the second matching acceptance: **Managed** → `Closing`, `freeze_epoch += 1`, `deadline = now + close_window_ms`. **Observed** → finalize now. |
| `cancel_sale`, 1 yocto | seller or buyer | Proposed, Accepting | — | `Cancelled`; escrow → buyer claim; record deleted |
| `expire_sale` | anyone | Proposed, Accepting | `now ≥ expires_at` | `Expired`, as above |
| `close_sale(digest, readiness)` | **anyone** | Closing | `now < deadline`; `now < r.expires_at`; `r.expires_at − r.issued_at ≤ 30 min`; `r.issued_at ≥ closing_started_at`; digest == live digest == `r.digest`; `r.{deal_seq, version, expected_generation, freeze_epoch}` match; `r.service_manifest == deal.required_service_manifest`; `ed25519_verify(r.sig, msg, deal.attestor)`; `available ≥ floor`; `escrow == price` | **finalize** → `Closed` |
| `abort_close` | anyone | Closing | `now ≥ deadline` | `Aborted`; escrow → buyer claim; freeze cleared; `last_abort = (deal_seq, epoch)` |

In `Closing`, no party can cancel or unfund before the deadline. This protects both sides once both have committed (decision B).

`close_sale` and `abort_close` are mutually exclusive, because they are split by `now < deadline` versus `now ≥ deadline` on the same block clock, and `r.expires_at ≤ deadline` is enforced when the attestation is issued.

### `finalize` (bounded, O(1) apart from ≤ 8 operator removals and ≤ 4 inserts)

1. escrow −price, `party_claims[seller] += price`, record `sale_proceeds`.
2. `owner = buyer`, `generation += 1`.
3. Remove all operators (≤ 8), then install `successor_grants` at the new generation.
4. Clear the freeze; deal → `Closed`; `last_close = {deal_seq, version, digest, buyer, generation}`; delete the deal record.
5. Emit `sale_finalized`.

Entitlements, holds, claims and pending payouts are untouched. There is no scan over deals, because only one can be live.

### What may happen after the first acceptance (`Accepting`)

| Allowed | Refused |
|---|---|
| Customer purchase, refund, claim, register, keys, pause | `create_plan`, `close_plan_sales`, `sunset_plan` (`E_DEAL_PENDING`) |
| Holds and settlement by current METERING operators | `appoint_operator` (revoking is allowed: it reduces privilege) |
| Party acceptance, revision, cancel, fund, unfund | `withdraw_profit` or `goodwill_refund` that would break I3 (`E_FLOOR`) |
| `withdraw_profit` above the floor and reserve | Attestor rotation by the registry (`E_DEAL_PENDING`) |

In `Closing`, **every** owner admin method is refused (`E_FROZEN`), including revocations and withdrawals. Customer, metering and claim paths keep working. Only time, `close_sale` or `abort_close` changes the deal.

**An acceptance is stale when:** the version changed; the generation or owner changed; the live digest differs (plans, attestor, terms); the buyer unfunded (buyer's acceptance only); or the deal is terminal.

---

## 9. Managed administration freeze and readiness

### 9.1 Readiness attestation

```rust
pub struct Readiness { deal_seq: u64, version: u32, digest: [u8; 32], expected_generation: u32,
    freeze_epoch: u64, service_manifest: [u8; 32], drained_admin_seq: u64,
    issued_at_ms: u64, expires_at_ms: u64, signature: [u8; 64] }
// signed = sha256(borsh(("business-readiness/v1", business_account, deal_seq, version, digest,
//          expected_generation, freeze_epoch, service_manifest, drained_admin_seq, issued_at_ms, expires_at_ms)))
```

The attestor key is copied into the deal at proposal and is part of the digest. Only `registry_account` (the platform) can rotate the business-level attestor, and never while a deal is live (decision C).

### 9.2 Runtime authority row and freeze state machine (server, durable SQLite)

```
authority(business_id PK, account, mode, observed_generation, observed_owner, observed_height,
          verified BOOL, freeze_state, freeze_deal_seq, freeze_version, freeze_epoch, freeze_digest,
          freeze_seen_height, drain_admin_seq, readiness_blob, readiness_expires_at)
admin_ops(id, business_id, kind, admitted_generation, admitted_admin_seq, state, lease…)   // releases, provider/config edits,
                                                                                         // operator changes, plan changes, activations
```

| # | Trigger (each reads chain at `final` with a height) | Precondition | Effect (one transaction) |
|---|---|---|---|
| T0 | Process start or DB restore | — | Every row `verified=false`. Admin fails closed until T1 or T4 re-verifies that business. |
| T1 | Observe deal `Closing(seq, v, epoch)` at height h | `h ≥ observed_height`; epoch > freeze_epoch, or same and already frozen | `freeze_state=frozen(...)`, `verified=true`. From this commit on, every admin commit fails its fence. |
| T2 | Drain (immediately after T1, and on restart) | Frozen | Every `admin_ops` row not yet terminal: not dispatched → `cancelled(frozen)`; dispatched or applying → `fenced` (it can never apply; 002a semantics, reservation held if paid). Record `drain_admin_seq`. Compute the service manifest **inside this transaction**. |
| T3 | Sign readiness | Drained; manifest == `freeze_digest`'s required manifest; `now_est < deadline − 2 min` | Store the signed blob. `expires_at = min(now_est + 20 min, deadline − 1 min)`. Optionally submit `close_sale` through the relayer (permissionless). Re-issuing for the same epoch returns the stored blob until it expires, then issues a new one. |
| T3′ | Manifest mismatch | — | `freeze_state=mismatch`. Both parties see "terms no longer match the live service; revise or wait for abort". No readiness is issued. |
| T4 | Observe `Closed` for (seq, v), generation g+1, at h | `h ≥ freeze_seen_height`; `g+1 > observed_generation` | Ownership transition per 003b (unique `(business_id, generation)`); owner = buyer; seller sessions lose admin; operating grants mapped; freeze cleared; evidence row. |
| T5 | Observe `Aborted`, `Cancelled` or `Expired` for (seq, v, epoch) at h | `h ≥ freeze_seen_height`; generation unchanged; positive observation of that terminal state | Freeze cleared; seller admin re-enabled. **Never** by wall clock, an RPC timeout, absence of data, or a lower-height answer. |
| T6 | RPC error, or answer below the stored height | — | No transition. Admin stays frozen or fails closed. Customer service continues. |

**The admin commit fence.** It runs inside the same `BEGIN IMMEDIATE` transaction as the effect:

```sql
SELECT 1 FROM authority WHERE business_id=? AND verified=1 AND freeze_state='none'
  AND observed_generation=? AND observed_owner=?
```

`?` is the op's `admitted_generation` and requester. If no row matches, the op is fenced. This adds the freeze to 002a's existing lease and owner-epoch checks.

**Why late observation is safe in managed mode.** A close needs readiness, and the runtime signs readiness only after T1 and T2 have committed. So the off-chain freeze always comes **before** the on-chain close. A late T4 delays only when the buyer can start administering. The seller has no administrative window after the close. Before the close, the seller is still the owner, and any change they make after the buyer accepted shows up as a manifest mismatch (T3′), not a silent change.

**Steady state.** Without a deal in `Closing`, a managed business can't change owner externally, because the contract refuses. So admin needs only `verified=1`; there is no chain read per command. This removes 003a's check-then-act window (findings 10 and 11) for managed businesses.

### 9.3 Service manifest (canonical JSON, hashed)

```json
{ "products":[{"product_id":"…","default_release":"…",
   "plans":[{"plan_id":1,"service_contract":"…","routed_release":"…","artifact_digest":"…"}]}],
  "provider_bindings":[{"kind":"platform_managed|seller_owned|buyer_staged","provider":"…","model":"…","pricing_version":"…"}],
  "operating":{"metering_account":"…","gateway_route_id":"…"},
  "admin_policy_version":1 }
```

It contains nothing that changes per customer. If a binding is `seller_owned`, readiness is refused unless the deal's terms list a `buyer_staged` replacement that the runtime has verified (§12).

---

## 10. Successor operating rights and continuity of customer service

- **Managed rule** (enforced by the contract at `propose_sale`): `successor_grants` must include `rules.mode.metering_account` with METERING. `finalize` re-installs it at the new generation in the same execution, so `open_hold` and `settle_hold` keep working from the next block.
- **Signing.** The metering account's key is a function-call key held only by the runtime, scoped to the business with methods `[open_hold, settle_hold, release_hold]`. It isn't the seller's key, and it isn't an admin key.
- **Customer access** doesn't depend on the owner. Customer tokens are stored as hashes scoped to `(business_id, customer)`. Use-keys are on chain. Provider credentials are business bindings in the platform vault (§12).
- **Holds across the close.** A hold opened at generation g is settled at g+1 by any current METERING operator. Signatures authorize the charge, not the operator. Revenue from uses settled after the close goes to the business's `available`, which the buyer now controls (decision D). Readiness reports `unsettled_served_units` for disclosure.
- **The buyer may later replace the metering operator.** If they choose not to keep it, service pauses, and the UI says "paused", never "uninterrupted". Refunds are unaffected.

---

## 11. Observed-authority reconciliation (003b) and what legacy businesses get

The monotonic observation applier is shared by all modes:

- `chain_observations(business_id, height, generation, owner, deal_seq, version, digest, status)` keeps the maximum height per business.
- An observation is applied only if its `(generation, deal status rank)` is greater than what is stored. Ranks: Proposed < Accepting < Closing < terminal.
- The ownership transition inserts `ownership(business_id, generation)` UNIQUE. The deal, ownership, listing, team and event writes happen in one transaction.
- If the observed generation is more than one above what is stored, the app applies the **current** owner from `get_control()` (fail closed for the stale owner; admin for the new owner only if the account maps to a platform user). Intermediate deals are marked `reconciliation_needed` and are not attributed. An older closed deal never brings back authority, because the generation is monotonic.
- Status reads of old transactions need an archival RPC after about 1.5 days, since nodes garbage-collect after 5 epochs (docs-verified).

| Mode | Close path | Strongest honest off-chain claim |
|---|---|---|
| v3 Managed | Readiness required | Former owner has **no** administrative effect after the close. Their changes after acceptance can't carry over silently (manifest). This depends on trusting the runtime. |
| v3 Observed | Second acceptance closes | "Refused from the first commit after Everstreet observes the close at final finality. Commands admitted before that may complete." Window ≈ observation interval + about 1.2 s finality + longest admitted command. |
| v2 / v1 legacy | v2 acceptance | Same as Observed. Credit is labelled operator-trusted (003a recommendation 3). Not eligible for the 100/20/80 claim. |
| Imported (M4) | Whatever their contract supports | Readiness only if imported into a v3 Managed account. Otherwise Observed. |

Missing final state means admin fails closed in every mode. Customer paths continue under §5's bounds.

---

## 12. Privacy and continuity inventory

| Data | Where | Public? | Moves to buyer? |
|---|---|---|---|
| Accounts, plan prices, unit counts, hold sizes and times, nonces, salted fingerprints, claims, deal price and floor | Chain | **Public**: disclose this at purchase. Offer one account per business. | Yes, inherently |
| Customer inputs and outputs, prompts | Runtime store under the plan's retention terms | No | Only as the plan terms allow. The buyer gets no broader access than the seller had under those terms. The retention clock keeps running. No new uses of the data. |
| Use records (tuple, fingerprint, state, release, cost, receipt signatures) | Runtime | No | **Yes**: needed to answer disputes, settle signed uses and continue service |
| Signed uses not yet settled | Runtime outbox | No | **Yes**: any METERING operator can settle them |
| Releases, artifacts, evaluations, build history | Studio DB | No | Yes (records transfer; old instructions are fenced) |
| Seller's personal studio chats, notes, unrelated credentials | Studio | No | **No** |
| Provider credential | Vault binding | No | Platform-managed: stays with the business. Seller-owned: external item that must be replaced (`buyer_staged`, verified). |
| Domains, repos, cloud accounts, IP, legal entity | External | — | Each item in the `terms_hash` inventory has status `not_started` / `staged` / `verified(evidence)` / `waived_by_buyer`. Never shown as a blanket "transferred". |
| Deal terms and disclosure snapshot | Off chain, salted canonical JSON; only `terms_hash` on chain | No | Immutable snapshot (003p); a revocable room is separate |

---

## 13. The 100/20/80 sequence

Assumptions: P = 50,000 base units (0.05 test dollars at 6 decimals), plan 1 with `max_hold_units` 10, TTL 30 min, grace 10 min, Managed mode.

| Step | Action | State afterwards |
|---|---|---|
| 1 | `register(1, pkA)` | ent: free 0, incarnation h₀ |
| 2 | `ft_transfer_call(5,000,000, buy{1,100,seq 1})` | free 100; free_v 5.0M; held 5.0M |
| 3 | Use n=1: no hold → `open_hold(seq 1, 10)`, FINAL | free 90; held_v 0.5M |
| 4 | Uses 1–10 admitted, delivered, receipts returned; `settle_hold(1, uses 1..10, close)` | consumed 10; avail 0.5M; held_v 0 |
| 5 | Hold 2, uses 11–20, settle and close | consumed 20; free 80; free_v 4.0M; avail 1.0M |
| 6 | Seller proposes deal: price 20M, floor 0.8M, grants [metering], manifest M | Proposed(1) |
| 7 | Buyer funds 20M and accepts | Accepting; escrow 20M |
| 8 | Seller `withdraw_profit(0.2M)` → 0.8M ≥ floor, so allowed | avail 0.8M; pend 0.2M |
| 9 | Seller accepts | Closing(epoch 1); on-chain admin frozen |
| 10 | Runtime T1/T2: seller's queued release activation is fenced; manifest = M; T3 signs R | — |
| 11 | `close_sale(D, R)` | owner = buyer, generation 2; metering re-granted; seller claim 20M; escrow 0 |
| 12 | Step 8's payout fails (seller not registered with the FT) | seller claim 20.2M; avail stays 0.8M |
| 13 | Runtime T4: buyer gets admin; seller → 403 off chain, `E_NOT_OWNER` on chain | — |
| 14 | Customer use n=21 with the same key and token: hold 3 opened by the metering operator at generation 2 | free 70 + held 10, so 80 remaining before n=21 is settled |
| 15 | Buyer releases R2 compatible with SC1 (suite passes) → plan 1 routed to R2 | Customer unaffected |

Check after step 11: held = 4.0M (free_v) + 0.8M (avail) + 0.2M (pend) + 20M (claims) = 25.0M = 5.0M + 20M. Units for the entitlement: 100 = 80 + 0 + 20 + 0.

---

## 14. Adversarial review: failure schedules and the corrections they forced

1. **Seller admin committed in the gap between on-chain Closing and the runtime noticing it.** The first draft froze only off chain and assumed the freeze came before the close. A command committed in that gap would have carried over silently. **Correction:** the readiness must attest the service manifest, and the contract compares it with `required_service_manifest` from the digest. A seller edit causes a mismatch and an abort, not a silent carry-over.
2. **Readiness signed, then the DB is restored from a backup taken before the freeze.** The freeze row is gone and seller admin re-opens while a valid readiness exists, so the close could carry later changes. **Correction:** T0 sets every row `verified=false` on start or restore, and admin needs T1 or T4 re-verification against the chain. A business in `Closing` re-freezes before any admin runs. Readiness TTL is capped at 20–30 min (contract-checked) to limit exposure.
3. **Customer is served, then exits before settlement.** If customers could release holds or advance nonces, they could take service and void payment. **Correction:** customers can't release a hold before `settle_until` and can't touch nonce windows. They can pause (no new holds), refund free units, or wait. Exit latency is at most TTL + grace = 40 min.
4. **Leaked use-key plus revocation.** If settlement rejected revoked keys outright, honest uses served just before the revocation would become free. If it accepted them, an attacker could keep using the key. **Correction:** uses from a revoked key settle only within a hold opened before `revoked_at`. Exposure is at most one hold (≤ 10 units).
5. **v2's free-text deal ID, deleted records and old signed acceptances.** Deleting terminal deals would let an ID be reused, and a signed `accept_sale` can stay valid for about 14.4 hours (docs: validity is measured in blocks). **Correction:** contract-assigned `deal_seq`, which is in the digest along with the version. An old signed acceptance can never match a new deal.
6. **Party-claim storage at callback time.** v2 inserts into `proceeds` from a callback; under storage pressure that callback could fail, and a failed callback isn't retried. **Correction:** customer claims live inside the fixed entitlement record. Party-claim slots are pre-funded by the deal deposit and at `new`. No callback grows storage.
7. **Stale RPC during abort.** A lagging node returns `Accepting` after `Closing`, and a naive runtime unfreezes. **Correction:** T5 needs a *positive* observation of a terminal status at height ≥ `freeze_seen_height`. Optional hardening: two independent RPC endpoints must agree before unfreezing (decision F).
8. **Gateway down past `settle_until`.** The hold is released and the business loses revenue for served uses. **Accepted as a tradeoff**, because it favours the customer. Mitigations: the margin and an outbox alarm at 50% of the grace period.
9. **Wedged drain (an external side effect in flight).** If drain meant waiting for completion, one stuck op could block every close. **Correction:** drain means *terminal or fenced*. Fenced ops can never apply, so drain completes in a single transaction. The only exception is an admin op with external side effects that can't be fenced; managed `extraction_spec` products have none (activation is a DB pointer). Any future op of that kind must be commit-then-act and idempotent, or it blocks readiness and is shown.
10. **Compromised or misused attestor key.** It can close an accepted deal without a real drain. It can't change terms, price, floor or grants. **Accepted and listed** in §16. Exposure is limited to deals both parties already accepted.
11. **Seller grief: accept, then edit to force an abort.** The buyer's escrow returns at the deadline as a claim. That costs availability, not money. This is disclosed.

---

## 15. Adversarial test matrix (expected states)

"U" is a keyless Rust unit test (VMContextBuilder); "S" is the local near-sandbox with the real FT; "T" is a TypeScript test with doubles.

| # | Scenario | Tier | Expected |
|---|---|---|---|
| 1 | Duplicate logical use: the same signed use is submitted twice, in one batch and across batches | U, T | Charged 1 unit. Second result `already`. Gateway returns the stored result; one provider call. |
| 2 | Altered replay: same nonce, different fingerprint | T, U | Gateway 409, not served. If both are submitted on chain, only the first nonce settles; the second is skipped (no charge). |
| 3 | Replay after pruning: nonce ≤ high−128 | U, T | `E_REPLAY_OLD` panic; nothing charged. Gateway 409 `expired`. |
| 4 | Withdraw vs reserve: `refund_units(all)` lands before `open_hold` | U, S | `open_hold` fails `E_UNITS`; gateway serves nothing. Reverse order: refund is limited to free = total − 10. |
| 5 | 50 concurrent requests, 1 unit left in the hold | T | Exactly one admitted and served; 49 get `hold_exhausted` or wait for the next hold. |
| 6 | Timeout, then late success after `deliver_by` | T | Use `failed(late)`, never settled; provider cost on the runtime ledger; customer receipt says failed. |
| 7 | Unknown settlement outcome | T | Outbox reads window bits, resubmits only clear nonces; total charged = delivered count. |
| 8 | Sale during a pending use (hold open at gen 1, settled at gen 2 by the re-granted operator) | U, S, T | Settles; avail +P to the buyer; units conserved. |
| 9 | Seller payout fails after the close | U, S (unregistered FT account) | `party_claims[seller] += a`; avail unchanged; seller `claim()` succeeds after registering. |
| 10 | Wrong successor grant: revise grants after the buyer accepted, then close with the old digest | U | `E_TERMS`. Managed proposal without the metering account → `E_GRANTS`. Close installs exactly the digest's grants; old operator `E_NOT_AUTHORIZED`. |
| 11 | Treasury reduction: seller withdraws below the floor while Accepting | U | `E_FLOOR`. Withdrawal before any acceptance, then accept → `E_TREASURY`. |
| 12 | Direct close without readiness: both accept from the CLI outside the UI | U, S | Deal `Closing`, owner unchanged. `close_sale` with a missing, wrong-key, expired, wrong-epoch or wrong-manifest R → `E_READINESS`. |
| 13 | Freeze, then restart (crash after T1, before T2) | T | Restart: T0 → T1 re-observed, T2 fences queued ops; admin 403 throughout; readiness issued once. |
| 14 | DB restored to before the freeze while Closing | T | Admin 403 until re-observed, then frozen again. |
| 15 | Cancelled / expired / revised deal | U, T | Revise in Accepting: acceptances cleared, old R invalid (digest). Cancel in Closing before the deadline: `E_CLOSING`. `abort_close` before the deadline: `E_STATE`; after it: Aborted, escrow → buyer claim. T5 unfreezes only on final observation. |
| 16 | Close/abort at the deadline boundary | U | Block timestamp < deadline: only close succeeds. ≥ deadline: only abort succeeds. |
| 17 | Late observation: runtime sees Closed 10 minutes late | T | No seller admin committed after the close (freeze in place since T1); buyer admin starts at T4. |
| 18 | Stale or lower-height RPC answer during an abort | T | No unfreeze. |
| 19 | Out-of-order observations from two reconcilers | T | One ownership row, one event; the lower generation is ignored. |
| 20 | Buyer resale: gen 2 → gen 3 | U, T | Same protocol; replaying the gen-1 deal observation doesn't regress; the old buyer's grants are void. |
| 21 | Storage exhaustion: business account at its NEAR limit | S | Serve, settle, refund and claim succeed; `create_plan` fails. Registering without a deposit → `E_STORAGE`; buying for an unregistered customer → full refund. |
| 22 | Key revocation | U | Uses from the revoked key settle only in a hold opened before the revocation. |
| 23 | Incompatible release activated | T | Plan 1 stays on its last compatible release; with none left, `unservable`, holds refused, refunds succeed. |
| 24 | Equations | U, S | I1 and I2 asserted after every call. Sandbox: `ft_balance_of ≥ held`. |
| 25 | Cross-language vectors | U+T | Rust produces digest, readiness and use-signature vectors; TS signer and verifier match byte for byte. |

---

## 16. Trust and availability tradeoffs that remain, with my recommended decisions

**What is trusted:**

- **The managed runtime (the platform):** attestor key, metering key, customer-credential store, provider vault, gateway honesty about delivery and quality, and the truth of the drain and manifest.
- **The registry account:** can rotate the attestor.
- **The RPC providers.**
- **The NEAR protocol and the test FT contract.**
- **In local preview, the platform's custody of people's account keys.** Today's server stores their secrets. That limits "only the buyer can act" to "only the buyer, or the platform holding their key". It must be disclosed.

**Availability costs:**

- First use per hold waits about one finality.
- An abort caused by the seller delays the buyer.
- A gateway outage past the grace period loses business revenue.
- An RPC outage freezes admin, though customers continue.
- Immutable code means a bug needs a new account and customers moving by choice.
- Usage patterns are public on chain.

| Decision | Recommended | Alternative | Cost of recommendation |
|---|---|---|---|
| A. Customer authorization | **Customer-signed uses verified on chain** | Operator-attested charges under customer caps (the 003a/M3 review shape) | Client key management in the customer UX and SDK; ed25519 gas per settle (to measure) |
| B. Cancelling during Closing | **Bound until the deadline** | Either party may cancel at any time | A party can't back out for up to `close_window_ms` |
| C. Attestor rotation | **Registry only, never during a deal; mode fixed** | Per-business fixed key; or owner-settable (rejected: self-attestation) | The platform holds the lever; an "exit managed mode" path is deferred to a v4 or `leave_managed` design |
| D. Revenue for uses settled after the close | **Goes to the business (buyer); disclosed in readiness** | A settlement barrier before readiness | Seller bears compute for the last served uses; price it in |
| E. Unit expiry | **None** | Expiry date per plan | Permanent obligations, fully backed and refundable |
| F. Unfreeze confirmation | **One final read, monotonic height**; add dual RPC before testnet evidence | Two independent endpoints | Small; a second endpoint dependency |

---

## 17. Bounded implementation slices (after design review; none started)

| Slice | Content | Acceptance |
|---|---|---|
| S1. v3 core: plans, entitlements, money (Rust unit) | New crate; `new`, `create_plan`, `register`/`unregister` with measured storage, buy via `ft_on_transfer`, `refund_units`, claims, payout callback routing, I1/I2 checks, views | Matrix 4 (refund side), 9 (unit), 21 (unit), 24; measured entitlement bytes reported |
| S2. Holds and signed-use settlement (unit + sandbox gas) | `open_hold`, `settle_hold`, `release_hold`, windows, keys, revocation, pause | Matrix 1–4, 22, 24; gas measured at batch sizes 1, 8, 16 and `MAX_USES_PER_SETTLE` set; Rust test vectors produced |
| S3. Deal v3 and readiness (unit) | Terms, digest, single live deal, Accepting restrictions, Closing freeze, `close_sale` verification, `abort_close`, finalize grants, registry rotation | Matrix 10–12, 15, 16, 20 (contract side) |
| S4. Local sandbox end to end | Real FT; full 100/20/80 plus sale; failed payout to an unregistered account; callback gas measurement; storage exhaustion | Matrix 8, 9, 12, 21, 24 in sandbox; balance ≥ books at every step |
| S5. Server chain boundary | v3 `Chain` interface and FakeChain with parity tests on the shared vectors; TS use signer and verifier | Matrix 25; FakeChain refuses everything the contract refuses |
| S6. Gateway use ledger (with 002c) | Admission, idempotency, outbox, late results, receipts, retention and watermark pruning | Matrix 1–3, 5–7 (TS) |
| S7. Authority and freeze runtime (after 003b) | Authority rows, monotonic observations, T0–T6, admin fence in every admin commit, test-only readiness signer | Matrix 13, 14, 17–19; outside-UI close; duplicate reconcilers |
| S8. Service-contract compatibility and routing (002c) | Compatibility records, fallback routing, `unservable` | Matrix 23 |
| S9. Deal terms, inventory and UI claims (with 003p) | Salted terms snapshot, manifest preview, external-item statuses, claim labels per §2 | Copy review; old v2 terms hashes unchanged |
| S10. Testnet run plan (document only) | Publish by hash, new keyless account, bounded script, evidence format | Needs Tony's explicit yes; doesn't touch Juniper |

Order: S1 → S2 → S3 → S4 (contract); S5 after S2; S6 after S5 and 002c; S7 after 003b; S8 with 002c; S9 after 003p; S10 last. One writer at a time.

---

## 18. Dependency map

- **003b → S7.** Monotonic observations, unique ownership per generation and a transactional settle are the base the freeze sits on. 003b's "observed finality" stays the claim for Observed and legacy businesses.
- **003p → S9.** The deal snapshot and disclosure scoping feed `terms_hash`. Necessary liabilities (plans, outstanding units, floor) must be in terms whatever the disclosure choices; optional financial figures are not.
- **002c → S6, S8.** Runtime execution, pinned releases, evaluation provenance, the runtime usage ledger, idempotent invocations and the business-scoped provider binding. 002c's "release activation is owner/generation-checked" becomes the §9.2 admin fence plus the freeze.
- **002a/002a1.** Fencing, leases, "dispatched paid calls never re-run" and held reservations are reused unchanged. The freeze adds one more fence condition.
- **003f.** Earned = settled units × price (`settle_hold`). Customer liabilities = `ent_free_value + ent_held_value`; claims shown separately. Cash in = purchases. Provider cost comes from the runtime ledger in USD and is never subtracted from test tokens. A stuck `pending` is shown as an anomaly, not zero.

---

## 19. NEAR sources (checked 2026-11-02)

### Verified, read today in the official docs or docs.rs

- A callback runs even if the called function fails; state isn't rolled back automatically. https://docs.near.org/smart-contracts/anatomy/crosscontract#what-happens-if-the-function-i-call-fails
- A callback can itself fail; only its own changes revert; it isn't retried. https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-failures
- Any public method can run between a call and its callback. https://docs.near.org/smart-contracts/security/cross-contract-calls/reentrancy
- Checklist: private, bounded callbacks; settle without panicking. https://docs.near.org/smart-contracts/security/checklist
- `env::promise_result_checked` needs near-sdk ≥ 5.24. https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-failures#keep-callbacks-small-and-bounded
- Storage costs 10¹⁹ yocto per byte; accounts get 770 bytes free. https://docs.near.org/protocol/storage/storage-staking
- Charge the measured storage delta. https://docs.near.org/smart-contracts/security/storage
- Global contracts: by hash is immutable; by account can be redeployed. https://docs.near.org/smart-contracts/global-contracts
- A locked account still upgrades itself if its code has an update method. https://docs.near.org/smart-contracts/release/upgrade#locking-a-contract-account
- Transaction validity is measured in blocks (86,400 ≈ 14.4 h). https://docs.near.org/integrations/transaction-lifecycle
- Blocks ≈ 600 ms, finality ≈ 1.2 s, `wait_until: FINAL`. https://docs.near.org/integrations/blocks-and-finality
- Max 1 PGas per transaction since protocol 83. https://docs.near.org/smart-contracts/anatomy/collections#storage-management
- Function-call keys can't attach deposits; they are scoped by receiver and method. https://docs.near.org/protocol/accounts-contracts/access-keys#function-call-keys
- `ft_transfer_call` → `ft_on_transfer` (receipt deposit 0 in the example) → `ft_resolve_transfer` refunds the unused amount. https://docs.near.org/integrations/fungible-tokens and https://docs.near.org/smart-contracts/security/cross-contract-calls/ft-transfer-call
- Block timestamp is approximate UNIX time. https://docs.near.org/smart-contracts/anatomy/environment#timestamp
- Non-archival nodes garbage-collect after 5 epochs (≈ 1.5 days). https://docs.near.org/protocol/network/epoch
- `env::ed25519_verify(&[u8;64], msg, &[u8;32]) -> bool`, documented at near-sdk 5.30.0. https://docs.rs/near-sdk/latest/near_sdk/env/fn.ed25519_verify.html
- NEP-413 off-chain message signing. https://docs.near.org/web3-apps/tutorials/wallet-login#sign-messages-nep-413
- Gas keys with parallel nonce lanes exist; they could raise the metering key's throughput. https://docs.near.org/protocol/transactions/transaction-anatomy

### Inferred; S1/S2/S4 must confirm by running

- That `ed25519_verify` is available in the repo's pinned near-sdk **5.29.1**. Found by source inspection of `Cargo.toml` only; compiling S2 confirms it.
- The gas cost of `ed25519_verify`, and from it `MAX_USES_PER_SETTLE`.
- The entitlement's byte size.
- Callback static gas.
- That the test FT fails `ft_transfer` to an unregistered receiver.
- That a sponsor can pay customer storage through a meta-transaction relayer.

None of the above is executed evidence. The 100/20/80 and close guarantees stay design claims until S1–S7 tests pass, and a testnet run needs Tony's explicit yes.
