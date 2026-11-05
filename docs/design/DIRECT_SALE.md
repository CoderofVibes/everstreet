# Direct sale through each participant's own wallet (job 003wf2)

Claude, 2026-11-04. Authority: [003wf2](../astra/jobs/2026-11-04_003wf2_direct-sale-wallet-journey.md).
Builds on [BUSINESS_V3_SALE.md](BUSINESS_V3_SALE.md) (contract semantics),
[V3_RECONCILIATION.md](V3_RECONCILIATION.md) and [ACQUISITION_WORKSPACE.md](ACQUISITION_WORKSPACE.md)
(observation, intents, apply), and the purchase pattern in
[APPLICATION_COMPOSITION.md](APPLICATION_COMPOSITION.md) §10 (durable wallet intent, exact FINAL
receipt resolution). Nothing here is deployed, signed or sent: the contract change is undeployed
source, and every journey runs against a synthetic chain double anchored to the contract's own tests.

## 1. What a person can do

A **seller** (the business's owner here, whose linked NEAR account is the contract's owner) proposes
exact terms to one named **buyer** (a person here with a linked account). The buyer reviews the
business, price, authority and customer obligations, funds escrow with the business's own token and
accepts. The seller accepts the same version. On a Direct contract the second matching acceptance
closes the sale in that receipt. Everstreet then verifies that exact outcome and applies it through
the existing reconciliation; the buyer operates the business, the seller's management access ends,
customers keep the same service and units. Proceeds and returned escrow are **claims** until a
payout is proven.

Gated contracts are not sold here: their close needs the closer/drain/continuity integration of a
separate child job. A Gated business shows that plainly and offers no Direct wallet controls.

## 2. Contract additions (business-v3, undeployed)

The deployed v3 accounts lack these, and a contract can't be redeployed (born locked), so every
wallet action below needs a NEW business account running this code. Older code is detected by the
absent capability view and refused; nothing falls back to the unguarded methods.

**Why guards.** `revise_sale`, `unfund_deal` and `cancel_sale` name only the deal number, and
`expire_sale` and `appoint_operator` name nothing about the state they act on. A browser re-read
before sending can't stop a different state at execution: the other party (or another tab) can act
in between. `control_seq` rises by exactly 1 on every successful call that changes control state
(§2.4 of the sale design: plans, operators, manifest, propose, revise, fund, unfund, accept,
cancel, expire, abort, close) and on nothing else. Naming the reviewed `control_seq` therefore pins
the entire control state the person reviewed: if anything about the sale moved, the call is refused
before any change and nothing happens.

| New method | Caller, deposit | Guard (checked before any change) | Then exactly |
|---|---|---|---|
| `get_sale_terms(buyer)` | view | — | `{version: 1, guarded: true, next_deal_seq, plan_count, min_reserve, party_exists, party_bytes, storage_byte_cost}` |
| `propose_sale_guarded(terms, expected_control_seq, digest)` | owner; party quote, or 1 yocto if the buyer has a record | `control_seq == expected` (`E_REVIEWED`); the would-be deal's digest `== digest` (`E_TERMS`) | `propose_sale` |
| `revise_sale_guarded(deal_seq, expected_control_seq, terms, digest)` | seller; as propose | same two guards, the digest of the revised version | `revise_sale` |
| `unfund_deal_guarded(deal_seq, expected_control_seq)` | buyer; exactly 1 yocto | `E_REVIEWED` | `unfund_deal` |
| `cancel_sale_guarded(deal_seq, expected_control_seq)` | seller or buyer; exactly 1 yocto | `E_REVIEWED` | `cancel_sale` |
| `expire_sale_guarded(deal_seq, expected_control_seq)` | anyone; none | `E_REVIEWED` | `expire_sale` |
| `claim_party_guarded(category, expected_amount, expected_payout_seq)` | the party; exactly 1 yocto | owed in that category `== expected_amount` AND `payout_seq == expected_payout_seq` (`E_REVIEWED`) | `claim_party` |
| `appoint_operator_guarded(account, caps, expected_control_seq)` | owner; ≥ 1 yocto, excess refunded | `E_REVIEWED` | `appoint_operator` |

**Unchanged and used as is:**
- `accept_sale(deal_seq, version, digest)`: already binds the exact terms. Whether it records an
  acceptance or closes depends only on whether the other party already accepted those same terms;
  the review says so as a conditional ("if the buyer has accepted by then, this closes the sale").
  A control_seq guard here would make two parties' acceptances refuse each other.
- Funding: `ft_transfer_call` on the business's token with
  `msg = {"fund_deal": {deal_seq, version, price, expected_control_seq}}`. `(deal_seq, version)`
  names one fixed set of terms; `expected_control_seq` (new, optional in the message so older
  messages still parse) makes it land only on exactly the reviewed control state. Without it a
  delayed or repeated request could fund the same version again after an intervening unfund
  (Astra's DirectSaleDesignReview 1). Anything else is returned whole.

**Why a claim names the payout sequence (Astra's review 1).** An amount alone doesn't identify a
claim: after a payout the same category can be credited the same amount again (a later deal's
escrow return), and an old request would then collect it. Every payout raises `payout_seq` and only
a payout lowers a claim; every credit or restore raises the amount. So "owed == X and payout_seq ==
p" holds at execution only if nothing was paid or credited since the review: the request collects
exactly the claim incarnation reviewed. `get_sale_terms` reports `payout_seq`.

Guarded methods check their guard first, then call the same internal path as the original, so the
original's refusals, storage accounting, events and `control_seq` rise are identical. The
unguarded methods stay for compatibility; the product never prepares them.

**Measured party storage.** A missing buyer record is the only growth on a sale path (W1).
`party_bytes = PARTY_BASE_BYTES + len(buyer)`, with `PARTY_BASE_BYTES` measured: tests compare the
quote to the actual growth for short and 64-character accounts. The deposit is
`party_bytes × storage_byte_cost` when the record is missing, otherwise exactly 1 yocto; a record
created meanwhile refunds the excess, a record released meanwhile makes the call fail whole
(`E_STORAGE`). Customer shell quotes and guesses are never used for it.

**Fixture.** `direct-sale.json` is produced by a Rust test that runs one scripted history of these
calls (and their refusals) and records, after each step, the views, logs and return values. The
server's chain double replays the same calls and must reproduce every view byte for byte, every
refusal code and every return value (§6).

## 3. Terms document and digest

**Off-chain terms** are one immutable document per proposal or revision, stored here, with
`terms_hash = sha256(canonical bytes)` placed on chain. Canonical bytes are `JSON.stringify` of a
fixed, ordered structure (no optional keys, no times that change between review and storing):

```
{ schema: "sale-terms/1", business: {id, name}, contract: {network, account}, seller, buyer,
  asset: {account, symbol, decimals}, price, expires_at_ms, available_floor,
  grants: [{account, caps}], continuity: {metering_account, metering_granted},
  transfers: {included: [...], not_included: [...]}, note }
```

`included` and `not_included` are fixed sentences (the contract's owner role and its powers; the
operators named; customer obligations stay with the business; domains, provider and model accounts,
secrets and anything outside this app are not included), plus the seller's own listed exclusions
(at most 8, each ≤ 160 characters). `note` ≤ 1000 characters. A document is never edited; a
revision makes a new one. Only the seller and the named buyer can read it; nothing about a sale
appears on a storefront, profile or listing.

**The contract digest** is recomputed in TypeScript exactly as `digest_of`: borsh of
`((DEAL_DOMAIN, business, seq, version, seller, buyer, asset, price, expires_at_ms, close_window_ms),
(floor, grants, terms_hash, expected_generation, manifest, manifest_seq, plan_count, min_reserve,
close_mode, closer))`, sha256. Tests check it against every digest in the contract fixtures.

**Metering continuity.** The terms form names the platform's metering account with METERING by
default. If the seller removes it, the review says so in words to both parties: after the close,
customers keep their units but new uses pause until the buyer appoints metering, and the buyer's
page then offers exactly that appointment (`appoint_operator_guarded`). Nothing reappoints anyone
silently.

## 4. Every visible action

All amounts are canonical base-unit decimal strings, compared with BigInt; the token's display
scale comes only from its validated NEP-148 metadata read at the same block; the raw base units
stay in the technical details. Every call is ONE FunctionCall.

| Action (who) | Method, receiver | Deposit, gas | Source views (one pinned block) | Refused here when |
|---|---|---|---|---|
| Propose these terms (seller) | `propose_sale_guarded` → business | party quote or 1; 50 Tgas | `get_control`, `get_sale_terms(buyer)`, `get_treasury`, token `ft_metadata` | no capability; Gated; live deal; chain owner ≠ the seller's account; buyer unmapped or the seller; invalid terms |
| Revise (seller) | `revise_sale_guarded` → business | as propose | same | not live; closing; buyer change while funded |
| Register with the token (buyer before funding; any claimant before collecting) | `storage_deposit(account, registration_only: true)` → token | token's `storage_balance_bounds.min`; 30 Tgas | token `storage_balance_of`, `storage_balance_bounds` | already registered |
| Fund escrow (buyer) | `ft_transfer_call(business, price, fund_deal msg with expected_control_seq)` → token | 1; 100 Tgas | `get_control`, token balance/registration of buyer and business | funded; expired; balance < price; not registered |
| Accept version V (seller or buyer) | `accept_sale` → business | 1; 30 Tgas | `get_control`, `get_treasury` | not a party; already accepted; expired; floor not met; buyer unfunded; seller's version not recorded here |
| Take escrow back (buyer) | `unfund_deal_guarded` → business | 1; 30 Tgas | `get_control` | nothing funded; closing |
| Cancel the offer (seller or buyer) | `cancel_sale_guarded` → business | 1; 30 Tgas | `get_control` | closing |
| End the expired offer (either party) | `expire_sale_guarded` → business | 0; 30 Tgas | `get_control` + block timestamp | not yet expired at the block |
| Collect sale proceeds / returned escrow (party) | `claim_party_guarded(2 or 1, amount, payout_seq)` → business | 1; 60 Tgas | `get_party(account)`, `get_pending`, `get_sale_terms` (payout_seq), token `storage_balance_of(account)` | nothing owed; party payout cap reached; the recipient isn't registered with the token (register first: an unregistered recipient's transfer fails and the claim is restored) |
| Appoint metering (new owner) | `appoint_operator_guarded(platform, METERING)` → business | 1; 30 Tgas | `get_control` | not the owner; live deal; already appointed |

**Authority here.** A person acts only with their linked account, and the server refuses a preview
whose actor isn't that account's role on chain at the read block. The browser compares the
wallet's connected account with the verified participant before sending; a different account is
refused with nothing sent. Strangers get 404 without any chain read: the sale is reachable only for
the business's owner here, the buyer named in a stored terms document or recorded intent, or a
person with their own sale actions for it.

## 5. Durable wallet intent and recovery

One row per wallet action (`sale_actions`):

```
prepared ──ask recorded──▶ requested ──check──▶ confirmed | refused | unknown
   │                                                 │
   └─ set aside (never asked)        a fresh final read proves it can't take effect any more
                                                     ▼
                                     no_longer_possible (still checkable by its own transaction)
```

**No fresh ask for an unknown action (Astra's DirectSaleDesignReview 1).** The wallet signs a NEW
transaction every time it is asked, so asking again is never "the same request": it is a second
transaction whose effect must be proven separately. An asked action is recovered only by its own
transaction (the wallet's hash, or the ID the person copies from the wallet's activity). If the
wallet gave no hash, the stored request is kept and the page explains how to find the original;
a new transaction is never taken as proof of what the old one did.

**Each guard gives an exclusivity identity.** Every action this page prepares carries one:

| Kinds | Identity | Why at most one action with it can ever take effect |
|---|---|---|
| propose, revise, unfund, cancel, expire, appoint, fund | `control:<expected_control_seq>` | the first success raises control_seq; every other call guarded on that value is refused (funding: returned whole) |
| accept | `accept:<deal_seq>:<version>:<account>` | a party's second acceptance of a version is refused (`E_ALREADY_ACCEPTED`), and only a revision (a new version) clears it |
| claim | `claim:<category>:<payout_seq>` | the first payout raises payout_seq |
| register | `register:<token>:<account>` | NEP-145 requires `registration_only: true` to refund the whole deposit when the account is already registered (the double implements and tests it; another token's conformance isn't verified here) |

**"Can no longer take effect"** is provable from one fresh final read, per identity: control_seq
moved past the expected value; the deal number isn't live, its version moved on, or this party's
acceptance is recorded; payout_seq moved; the account is registered. The row then becomes
`no_longer_possible`: whether it took effect is still unknown, and it stays checkable by its own
transaction, but it no longer blocks a new action.

**A replacement while an action is unknown** is offered only when a fresh preview has the SAME
identity as the open one (the state hasn't moved): at most one of the two can take effect, and the
person is told exactly that before their wallet is asked. A preview with another identity is
admitted only once the open action is no longer possible. A new action after a definitive refusal
or a restored claim is simply a new action. Admission (in one `BEGIN IMMEDIATE` transaction): an
open `prepared` row is returned for recovery; an open asked row admits a new one only with the same
identity and an explicit `replaces` naming it; otherwise `action_open` with that row.

1. **Prepare** (no row): one pinned read, the exact call and an `action_digest` =
   sha256 of [kind, network, contract, actor account, receiver, method, args, deposit, gas,
   reviewed deal identity, reviewed amounts]. Nothing is stored.
2. **Create**: the server reads again and must reproduce the same digest, else `review_changed`
   with the new preview (review again). The row and, for propose/revise, the terms document are
   stored in one `BEGIN IMMEDIATE` transaction. At most one open action per business and account
   (a unique partial index): a second tab or process gets the first one back to recover.
3. **Ask recorded** before the wallet is invoked (`asks + 1`, durable), then the wallet's hash if
   it answers. A crash after the mark is still "requested": the outcome may exist.
4. **Check**: only THIS action's own FINAL transaction resolves it: hash, signer = the actor,
   receiver, the single FunctionCall's method, args, deposit and gas exactly the stored call, the
   transaction outcome's id = its hash, and its receipt graph (§5.1). A readback informs but never
   confirms and never shows an action didn't happen; a lookalike later deal is not this action. A
   named transaction ID is recorded only once it is shown to be exactly this action.
5. **Unknown stays unknown.** No automatic or offered resend because time passed, a nonce was used
   or a result is missing (see the identities above for the only replacement).
6. **Set aside** is only for a row whose wallet was never asked (`prepared`). An asked row stays
   tracked until its own transaction shows the outcome.

**Prepared versus sent.** Prepared: a durable reviewed request; no wallet was asked. Requested /
unknown: a wallet was asked; the transaction may exist. Confirmed: the transaction's own FINAL
receipts show the exact effect. Refused: its own FINAL receipts show the contract refused it (the
receipt rolled back), and the wallet was asked exactly once.

### 5.1 Exact evidence per kind

- **Business calls** (propose, revise, accept, unfund, cancel, expire, appoint): the first receipt's
  executor is the business, status an affirmative `SuccessValue`, and its logs carry the expected
  `business_core` event for this deal: `sale_proposed` (deal_seq, buyer, price), `sale_revised`
  (deal_seq, version), `sale_accepted` (by the actor) or `sale_finalized` (deal_seq, buyer, price,
  generation), `sale_unfunded`, `sale_ended` (status 2 cancelled / 3 expired),
  `operator_appointed`. Accept's value is `"accepted"` or `"closed"`. A failed first receipt with a
  contract error is "refused" (definitive only at one ask).
- **Funding**: the token's transfer succeeded; its children are the business's receiver outcome and
  the token's resolution. Funded: the receiver logged `sale_funded` with this deal and the price and
  returned `"0"` unused, the resolution used the whole price, and the transaction's own value equals
  it. Returned: `funding_returned` with the whole amount unused, the resolution used `"0"` (one ask
  only, else unknown). A successful token transfer alone is never proof escrow was retained.
- **Claims**: the claim receipt logged `payout_started` to the actor for exactly the reviewed amount;
  the callback receipt `on_payout` for that payout id returned `true` and logged
  `payout_settled` ok → **paid**; returned `false` → **failed, restored as a claim** (the contract
  put it back in the same category); no callback outcome → **pending** (unknown; the contract's
  `get_pending` lists it).

### 5.2 Three different facts, never merged

| Fact | Established by | Shown as |
|---|---|---|
| The transaction did what was reviewed | its own FINAL receipt graph (§5.1) | the action's state |
| The contract's ownership | a coherent pinned read: `get_control.owner`, `generation`, the outcome ring | "The contract shows…" |
| Everstreet's records | the existing `V3Intents.reconcile` compare-and-set, once | "Applied here" |

When the seller's propose or revise is confirmed, the server refreshes the evidence and records the
exact version through the existing `V3Intents.record` (idempotent by the action). The seller can
accept only a version recorded here, so a close is always reconcilable. When an acceptance is
confirmed as `"closed"`, the server runs the existing reconciliation for that participant; its
answer is shown as it states it (applied, already, pending, conflict…). Ownership is never written
by this module.

## 6. Synthetic network boundary

`SaleChain` (server test support) is the sale half of ONE state model with the existing customer
chain double: control, operators, deal slot, party records, payout slots, outcome ring, the
treasury buckets and the token ledger. It applies the actual encoded calls a wallet sends
(receiver, method, JSON args, deposit, signer) by the contract's rules, and answers every view and
each transaction's FINAL outcome with its receipt graph and logs. It refuses unexpected receivers,
methods, multiple actions and malformed arguments. No real fetch exists in it or in the harness.

**One economic state (Astra's review 2).** The customer double's purchases, holds, settlements
and releases move the same treasury buckets the sale reads (`held`, `ent_free_value`,
`ent_held_value`, `available`), exactly as lib.rs books them (a purchase adds to held and free
value; opening a hold moves value from free to held; a charged use moves it to available; a
release moves it back to free). So a customer's settled use raises `available` and can let the
sale's floor pass; customer obligations shown to the buyer are the live buckets; metering after the
close is checked against the post-sale operators and generation of the same object; the
observation transport reads the same object. Tests exercise a customer operation that changes the
floor outcome and the service continuing under the buyer's actual grants.

**Anchors, kept apart.** The sale rules are anchored by replaying the contract's `direct-sale.json`
(same calls; byte-identical views; same codes, values and logs). The customer rules keep their own
contract fixtures (customer-purchase, customer-settlement, guarded-revoke). The combined journey is
labelled synthetic evidence; it is not a contract run.

Not modelled, and stated: gas use and limits (gas values are reviewed but unchecked), protocol
storage pricing beyond the fixture's byte cost, receipt timing across blocks (each transaction
lands at once), NEAR (not token) balances and refunds, and the monthly books (`get_period`).

## 7. Composition

`/sales/:business` is one page for both parties, with the approved calm acquisition composition:

```
BUSINESS SALE · BUSINESS CONTRACT ON NEAR TESTNET · you are the seller|buyer
Ledgerline Invoice Reader                                   [ one next action ]
One sentence from the reading ("Deal 2, version 1: escrow funded; you accepted; waiting for
the buyer. Read at block 1042.")
Progress: Terms proposed · Escrow funded · Both accept (closes) · Applied here · Takes over / collected
┌ main ─────────────────────────────────┐ ┌ continuity ─────────────────────────────┐
│ Your wallet request (when one is open)│ │ Authority the buyer receives             │
│ Exact terms + terms document (hash    │ │ Customer obligations that stay           │
│ checked in the browser)               │ │ Not included: needs its own transfer     │
│ Prepare / revise terms (seller)       │ │ Claims: owed, pending, failed, paid      │
│ Other actions (quiet)                 │ │                                          │
│ Your wallet requests (history)        │ │                                          │
└───────────────────────────────────────┘ └──────────────────────────────────────────┘
```

**Roles (from one read plus the local records; Astra's review 3).**

| Role | When |
|---|---|
| seller | owner here AND the contract's owner is your account |
| buyer | the live deal names your account as buyer |
| former seller | a closed outcome names you as seller (the contract's owner is someone else) |
| new owner | a closed outcome names you as buyer and the contract's owner is your account |
| claimant | your party record holds a claim or a payout to you is in flight |

A person can hold several (a new owner who also has returned escrow to collect). Nothing for a live
deal is offered when no deal is live: an ended deal shows its outcome, never fund/accept actions.

**The one next action (first match wins):** an open action (check it, or recover it) · load error
(try again) · no linked account · older contract / Gated (none; reason shown) · a closed sale of
yours not applied here (apply the close here) · a claim owed whose recipient isn't registered with
the token (register) · a claim owed (collect proceeds / returned escrow) · new owner without the
platform's metering (appoint metering so customers continue) · buyer not registered with the token
(register) · buyer unfunded (fund escrow) · own acceptance missing (accept version V) · other party
pending (none: "waiting for the buyer/seller") · seller with no live deal (prepare terms) ·
otherwise none.

Revise, cancel, take escrow back and end-expired are secondary, quieter actions with their own
review. Every review shows the exact call (receiver, method, arguments, deposit, gas), the plain
effect, and what can't be guaranteed ("if the buyer accepts first, this closes the sale"). Reached
from the owner's Sale and handover page, from each participant's handover receipts and from the
v3 notice on Selling.

## 8. Not in this job

Gated close (closer, drain, continuity), live testnet or a real wallet, deployment of the new
contract code, the parent 003wf matrix (owner plan setup, unresolved-writer recovery, the complete
100/20/80/79 configured journey, broader concurrency, prepared-only external rehearsal) and the
approved 003x/005e/006b/006c additions. M3 stays open.
