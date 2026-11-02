# Business contract v2 — a business that can change hands intact

Status: design, Nov 1 2026 (Claude). Nothing here is built yet. Product, profile and UI design
come from Astra's passes (`docs/astra/2026-11-01_LaunchPad.md`, `2026-11-01_IntactProfiles.md`);
this doc is the on-chain architecture underneath them. v1 (`contracts/business`, deployed as
`openseat.everstreet.testnet`) stays as history and as the proven sale core.

## What it must make true (Tony, Nov 1)

> A founder launches a paid service with its own NEAR account. The business holds its treasury,
> tracks prepaid customer balances, pays the workers that deliver its service, and publishes the
> rules governing what a future owner may change. A prospective buyer can inspect revenue,
> operating costs, outstanding obligations, and actual service performance before buying it. A
> customer cooperative could buy the service it depends on.

Plus: real revenue, overhead, profit and performance numbers, and an Everstreet valuation, all on
the business's profile.

Mapping:

| Promise | Where it lives in v2 |
|---|---|
| Its own NEAR account | One contract account per business, created by a factory, born with no keys, code by immutable global hash (§2) |
| Holds its treasury | The business account holds a NEP-141 test stablecoin; every unit is accounted to a bucket (§3) |
| Tracks prepaid customer balances | Per-customer credit balances inside the contract, refundable if the rules say so (§4) |
| Pays the workers | Workers are operators with pay terms; pay accrues from metered usage or per period and is claimed from the treasury (§5) |
| Publishes the rules | Owner rules fixed at creation, readable by anyone, enforced by every method (§6) |
| Buyer inspects revenue, costs, obligations | Monthly period ledger kept by the contract itself + NEP-297 events (§7) |
| Buyer inspects service performance | Worker reports, independent observer checks, and customer-confirmed usage, each labeled (§8) |
| Sale keeps it intact | v1's two-party digest sale, paid in the token, with a public notice period and retained workers so the service never stops (§9) |
| A customer cooperative can buy | The owner can be any account, including a DAO or multisig (§10) |

## 1. Shape

```
customer / buyer / founder (NEAR Auth login, gas sponsored)
        │ ft_transfer_call / calls
        ▼
 test stablecoin (NEP-141) ──► business account  <slug>.biz.everstreet.testnet   (locked, global code by hash)
                                 owner · generation · operators+pay · customer credits · price list
                                 owner rules · period ledger · performance · deals
        ▲ settle_usage / report_performance / claim_pay                 ▲ observe
        │                                                               │
   workers (API servers, people)                              independent observer (platform canary)
        ▲
 customers' API calls ── gateway run by a worker; endpoint resolved from the business account
                                                    │ events
                                                    ▼
                              Everstreet indexer → profile: revenue, overhead, profit, performance, valuation
```

## 2. Creating a business

- A factory contract `biz.everstreet.testnet` creates `<slug>.biz.everstreet.testnet` in one
  receipt: create account, fund storage, `UseGlobalContract` **by code hash**, call `new`. No key
  is ever added. NEAR docs: an account using a global contract *by account id* runs whatever the
  publisher redeploys, which would break the lock; by hash it is immutable. Each new contract
  version is a new hash; existing businesses keep theirs.
- `new(name, owner, rules, asset, observers)` — rules (§6) and the accepted asset are fixed here.
- Verify early: SDK 5.29 support for `use_global_contract` from a factory promise, and the
  storage cost per business (target well under 1 NEAR, paid by the platform on testnet).

## 3. Money and the treasury invariant

One accepted asset per business: a test stablecoin we deploy from NEAR's global FT
(`ft.globals.primitives.testnet`), issued by a faucet page and labeled "test dollars, no value".
Money arrives only through `ft_on_transfer` from that token; anything else is refused.

Every token unit the business holds is in exactly one bucket, checked after each method:

```
token balance = Σ customer credits        (prepaid, a liability)
              + Σ open obligations         (v1's reserved promises)
              + accrued unpaid worker pay
              + Σ deal holds               (buyer funds held for a sale)
              + pending outbound transfers (sent, awaiting callback)
              + available                  (what the owner may withdraw, above the reserve rule)
```

Outbound transfers (`withdraw_credit`, `claim_pay`, `pay_expense`, `withdraw_profit`, seller
proceeds) move the amount to *pending* first and settle in the `ft_transfer` callback; a failed
transfer returns it to its bucket. No method reads a balance across an unresolved callback.

## 4. Customers and prepaid credit

- **Prepay:** `ft_transfer_call(business, amount, {"prepay":{}})` → `credit[customer] += amount`.
- **Buy once:** `{"order":{"offer":"…","qty":n,"ref":"…"}}` → paid order; revenue is earned when a
  worker marks it delivered (`deliver(ref)`), refundable before that.
- **Use:** metered by workers (§5); each settlement debits credit at the published price.
- **Withdraw unused credit:** `withdraw_credit(amount)` by the customer, if the rules allow (the
  default rule says yes). This is what makes "your balance survives any sale" credible.
- Privacy: amounts per account are public. Customers can use a dedicated account per business
  (NEAR Auth makes this invisible); names and emails never go on chain.

## 5. Workers, metering, pay and overhead

- An operator grant (v1) gains **pay terms**: `per_unit_bps` (share of metered revenue) and/or
  `flat_per_period`, plus capabilities: `metering`, `delivery`, `support`, `spend`, `release`.
- **Metering:** `settle_usage(period, worker_batch_id, entries: [(customer, units)], receipts_root)`
  by a `metering` worker of the current generation. The contract prices units from the price list
  in force, debits each customer (capped at their credit; shortfall recorded, never negative),
  adds to earned revenue, accrues the worker's share. Idempotent per `(worker, worker_batch_id)`.
  A worker can charge only published prices to customers with credit; it cannot invent money.
- **Pay:** `claim_pay()` by the worker; flat pay accrues per elapsed period.
- **Overhead:** `pay_expense(to, amount, category, memo_hash)` by owner or a `spend` operator,
  within a per-period budget the owner sets. Categories (hosting, tools, contractor, marketing,
  other) feed the profile's overhead breakdown. Costs paid outside Everstreet can be added
  off chain as founder-supplied entries; the profile keeps the two apart.
- **Price list:** `set_price(plan, unit, price, effective_at_ms)`; the rules decide how much
  notice and how large an increase is allowed. History is public.

## 6. Owner rules (the business's published constitution)

Fixed at `new`, returned by `get_rules()`, enforced in code. A future owner inherits them and can
never change them; that is the point, and it is what a buyer is buying.

| Rule | Default | Enforced in |
|---|---|---|
| `credit_refundable` | true | `withdraw_credit` |
| `price_notice_days` | 30 | `set_price` (effective_at ≥ now + notice) |
| `max_price_increase_bps_per_year` | 1000 (10%) | `set_price` |
| `min_reserve` | 1 period of flat worker pay | `withdraw_profit` |
| `sale_notice_days` | 14 | `accept_sale` cannot close before the deal was public this long |
| `post_sale_price_lock_days` | 90 | `set_price` after a close |
| `pay_workers_before_close` | true | finalize requires zero accrued unpaid pay |
| `observers` | platform canary | who may post independent checks (§8) |

Templates in the launch studio offer these as plain sentences ("Customers can take back unused
credit any time"); the founder picks; the profile shows them as "Promises this business keeps,
whoever owns it."

## 7. The period ledger (real numbers)

The contract keeps a ledger per UTC month, updated by every money method:
`prepaid_in, orders_in, earned_revenue, refunds, credit_withdrawn, worker_pay, expenses_by_category,
owner_withdrawals, sale_proceeds, closing_credit_balance`. `get_period(yyyymm)` returns it; NEP-297
events give the line items. The Everstreet indexer turns this into the profile:

- **Revenue** = earned revenue (not prepayments; prepaid credit is a liability until used).
- **Overhead** = worker pay + on-chain expenses (+ founder-supplied off-chain costs, labeled).
- **Profit** = revenue − overhead, with the on-chain share shown ("92% of costs on NEAR").
- **Obligations** = customer credits + open obligations + accrued pay, live.
- **Valuation (Everstreet estimate)** = Astra's model on these inputs, versioned; the snapshot's
  hash can be anchored by the owner (`anchor_snapshot(kind, hash)`) when it is shared with a
  buyer, so later disputes can point at exactly what was shown.

Anyone can recompute the numbers from the chain; Everstreet's role is presentation and the
estimate model, not custody of the truth.

## 8. Performance a buyer can trust

Three sources, never merged into one badge:

1. **Worker-reported:** `report_performance(period, {requests, errors, p50_ms, p95_ms, uptime_bps},
   evidence_root)` — the operator's own numbers.
2. **Independent observer:** accounts named in the rules (Everstreet's canary, later third
   parties) post `observe(period, checks_ok, checks_total, p95_ms)` from synthetic calls.
3. **Customer-confirmed usage:** customers' SDKs sign per-batch usage receipts; workers include
   their Merkle root in `settle_usage`; a customer can check their own leaf and dispute.

The profile shows each with its label; disagreements between 1 and 2 are themselves shown.

## 9. Selling it intact

v1's sale, extended:

- Buyer funds the deal with `ft_transfer_call(… {"fund_deal":{"deal_id"}})`; held per deal.
- Deal terms add `retained_operators` (workers that keep running) and the transfer manifest of
  off-chain items. Both parties accept the same digest as in v1.
- Closing requires the `sale_notice_days` to have passed since the deal was proposed (customers
  saw it coming and could withdraw credit) and, by rule, all accrued worker pay settled.
- On close: seller paid from the hold, owner = buyer, generation + 1, all grants void **except
  the retained operators, which are re-stamped to the new generation**. The API keeps serving
  through the close; nobody re-plumbs billing because customers already pay the business account.
- Still off chain and listed in the manifest: source repository access, domain (mitigated: the
  endpoint customers call is read from `get_endpoints()` on the business account, so moving
  hosting is an owner call, not a DNS transfer), third-party accounts. `publish_release(version,
  source_hash, artifact_hash)` keeps a public release log so the buyer can match code to hashes.

## 10. Group owners and cooperatives

The contract only checks the caller, so the owner may be a DAO (Sputnik DAO from
`dao.globals.primitives.testnet`) or a multisig. A cooperative buy: customers join the DAO, the
DAO proposal funds the deal and calls `accept_sale`; after close, owner actions go through DAO
proposals. Pooled money from many people can be regulated as investment; on testnet with test
dollars this is a demonstration, and the profile says so.

## 11. People without wallets

- Sign-in with Google, Apple, email or passkey through **NEAR Auth** (MPC-held keys, testnet
  config available), so founders, customers and buyers get NEAR accounts without seed phrases.
- Gas sponsored by an Everstreet relayer (NEP-366 meta transactions), gated to Everstreet
  contracts and a per-user allowance.
- Big actions (accepting a sale, withdrawing profit) show a plain review sheet before signing.

## 12. Build slices (each with unit + sandbox tests before testnet)

1. Token + prepay + withdraw credit + treasury invariant + period ledger.
2. Price list + rules + usage metering (idempotent, capped) + customer-confirmed receipts root.
3. Worker pay + expenses + owner withdrawal against the reserve rule.
4. Performance reports + observer checks.
5. Sale v2: token-funded holds, notice period, retained operators, pay-before-close.
6. Factory + global code by hash + endpoint registry + release log.
7. Indexer → profile numbers and valuation inputs.

Slices 1–3 are what the profile's revenue/overhead/profit need; the launch-pad Phase 1 (no chain
needed) can be built alongside.

## Open questions

1. Which test stablecoin: our own via global FT (proposed) or an existing testnet USDC?
2. Default rules: are the defaults above right for a first founder, or should some be opt-in?
3. Customer-confirmed receipts add SDK work for API customers; launch with worker-reported +
   observer, add receipts in slice 2b?
4. NEAR Auth on testnet: confirm availability and limits before committing the onboarding to it.
