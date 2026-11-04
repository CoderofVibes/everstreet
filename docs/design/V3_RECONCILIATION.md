# v3 acquisition intent and local reconciliation (job 003k)

Claude, 2026-11-03. Authority: [003k](../astra/jobs/2026-11-03_003k_v3-intents-and-reconciliation.md).
It builds on [BUSINESS_V3_SALE.md](BUSINESS_V3_SALE.md),
[V3_OBSERVATIONS.md](V3_OBSERVATIONS.md) and the v2 reconciler (`server/src/deals.ts`).

This is keyless and local only. There is no signing, wallet, payment, live read or `main.ts`
wiring. A reconciliation is observed finality: a chain read followed by a database write. NEAR and
SQLite never change atomically together.

## 1. What is proven from the views, and what isn't

| Fact needed | Source |
|---|---|
| The deal's identity, as agreed: `seq`, `version`, `digest` | `get_control.live_deal` when the intent is recorded |
| Its terms: seller, buyer, price, floor, expiry, close window, grants, `terms_hash`, `expected_generation` | `get_control.live_deal` |
| That this exact deal closed | `get_outcomes` (or the immutable `v3_outcomes` copy): `status = closed`, with the same `seq`, `version`, `digest`, `seller`, `buyer` and `price` |
| The successor generation | `outcome.generation_after = expected_generation + 1`; `finalize` raises the generation by exactly 1 (D3) |
| No newer transfer since | `get_control`: `generation = generation_after` and `owner = buyer`. Any later close would raise the generation again. |
| The control step that closed it | `outcome.control_seq`, recorded in the receipt |

**The digest isn't recomputed here.** `digest_of` includes `plan_count`, `min_reserve`, the
business account and the asset, and `plan_count` and `min_reserve` are not in the views read
(`get_control`, `get_outcomes`, `get_treasury`, `get_pending`). So the application compares the
contract's **own** digest at two points: the live deal's when the intent is recorded, and the
outcome's when it closed. It never runs a second, approximate algorithm.

Because the contract has no view returning a deal's terms after it ends, the intent is the
durable record of the agreed terms. The outcome's own fields (`version`, `digest`, parties, price)
then bind it to those terms.

**Identity.** A chain account maps to a person only through `chain_accounts` (`owner_kind =
'person'`, `account_id` unique), the app's own record of accounts it created or linked. This is
not wallet proof. In local preview, accounts are fixtures. Identity is never taken from a request.

## 2. Records

**`v3_intents`** holds one row per exact deal version, made immutable at creation:

| Field group | Contents |
|---|---|
| Binding | `business_id`; `network`, `account`, `schema` (the trusted binding, as observed) |
| The deal | `deal_seq`, `version`, `digest` (contract text) |
| Terms | The live deal's terms, as JSON |
| Parties | `seller_account` and `buyer_account`; `seller_person_id` and `buyer_person_id` (from `chain_accounts`) |
| Generations | `expected_generation`; `local_epoch` (the ownership-history count when recorded); `recorded_block` (height and hash) |
| State | `status`: `recorded`, then `applied`, `ended` or `superseded`; `result` (the last reconcile receipt, JSON) |
| Request | `idempotency_key`, `request_hash`, `created_by`, and times |

Constraints:

- `UNIQUE (business_id, idempotency_key)`;
- `UNIQUE (business_id, network, account, deal_seq, version)`;
- at most 20 intents per business.

**`ownership.v3_intent_id`** is a new column, added with `ALTER`. A unique partial index makes it
at most one ownership entry per intent. This is separate from v2's `deal_id`, which references
v2 `deals`.

## 3. Recording an intent

`POST /api/businesses/:id/v3/intents` takes `{ idempotency_key, deal_seq, version, digest }`. Only
the current owner may call it.

**What the caller supplies.** Only the three identity fields, so they confirm exactly which deal
they mean. Every term comes from the latest **recorded** observation, never from the request.

**Refused when:**

- the business is unbound, or there is no observation;
- the projection is flagged;
- the binding differs from the record;
- there is no live deal, or it isn't the exact `seq`/`version`/`digest`;
- the seller account doesn't map to the viewer;
- the buyer account doesn't map to exactly one *other* person;
- the business already has 20 intents;
- a different input reuses a key (409).

An exact replay returns the same intent.

## 4. Reconciling

`POST /api/businesses/:id/v3/intents/:intent/reconcile` may be called by either participant:
the intent's seller person or buyer person. Anyone else gets 404. Nothing is supplied except the
ids.

1. **Fresh evidence.** The service reads one coherent snapshot through its own trusted transport,
   at a pinned final block (`readSnapshot`). It records it through the normal observation rules,
   `V3Observations.record`, in a transaction. Only `accepted` or `duplicate` evidence may be used.
   `stale`, `conflict`, `contradictory` and `source_changed`, a flagged projection, or any read
   failure give **unavailable** or **conflict**, and nothing else is written. No caller can write
   observation rows.
2. **Decide**, from that snapshot plus the immutable outcome copies:

   | Evidence | Answer |
   |---|---|
   | The binding (network, account, schema) differs from the intent | `conflict` |
   | The target `seq` is the live deal (proposed, accepting or closing) | `pending` |
   | No outcome for `seq`, and the history has a gap that covers it | `unavailable` (no guess) |
   | No outcome for `seq` otherwise | `pending` |
   | An outcome at a **later** version than the intent (the recorded version was revised away, then that version ended or closed) | `superseded`, code `revised_then_<status>`; the intent becomes `superseded` (job 003k1) |
   | An outcome at an earlier version, or at the same version with another digest, seller, buyer or price | `conflict`; the intent stays `recorded` |
   | An exactly matching `cancelled`, `expired` or `aborted` outcome, with `generation_after = expected_generation` | `ended`; the intent becomes `ended` |
   | An exactly matching `closed` outcome whose `generation_after ≠ expected_generation + 1` | `conflict` |
   | Current control generation is above `generation_after`, or the owner isn't the buyer | `conflict` (a newer, unmatched transfer) |
   | Current control generation is below `generation_after` | `pending` |
   | The buyer or seller mapping changed since the intent | `conflict` |
3. **Apply** in one local transaction (`store.tx`), with every local fact rechecked inside it:
   1. **Compare-and-set** the intent from `recorded` to `applied`. If 0 rows change, answer
      `already`.
   2. **Monotonic.** The business owner must still be `seller_person_id`, the ownership-history
      count must still be `local_epoch`, and no ownership entry may have `generation ≥ target`.
      Otherwise it is `conflict` (stale), and the transaction rolls back.
   3. **Move the owner** to `buyer_person_id`, and append **one** ownership entry: from the
      seller, to the buyer, at the target generation, with `v3_intent_id`. This raises the local
      epoch, so every in-flight seller request fenced by `stillControls` is denied (owner trials,
      builds, imports, observation refreshes, product writes).
   4. **Revoke what the seller set up**, the same way the v2 reconciler does:
      - revoke the `team` rows;
      - close the listing;
      - revoke granted evidence access, and withdraw pending requests;
      - reset the seller's personal value settings;
      - void open v2 deals.
   5. **Supersede** the business's other `recorded` v3 intents.
   6. **Record one event**, `business.sold`, with `{ v3_intent, to, generation, contract }`.

   Never touched: projects, revisions, releases, imports, customer records and entitlements.
   External accounts and runtime readiness are not marked complete.

Identity is compared before any terminal state. A terminal answer (`ended`, `superseded`) is
read back from the stored status after its compare-and-set, so concurrent calls agree on what is
actually recorded.

**Retries, concurrency and restarts converge.** Two calls can both read, but only one wins the
compare-and-set; the other answers `already`. A lost reply after the commit is answered `already`
on retry. A restart keeps the intent and the ownership entry.

## 5. Who can read what

- The current owner can list a business's intents (`GET .../v3/intents`).
- A participant can read **their** intent's receipt: `GET .../v3/intents/:intent`, also available
  to the former owner. The receipt has the status, the deal identity, the target generation, the
  outcome's control step, and the applied time.
- The receipt holds no business data. After a sale, the former owner can't see projects, imports,
  observations or the owner list. The buyer gets owner access through the normal ownership check,
  not through the receipt.

## 6. What this slice does not prove or do

- **Signing, payments and closing.** It doesn't sign, pay, or close a deal on NEAR. There is no
  managed closer or close order.
- **Live evidence.** There is no live endpoint and no cryptographic proof of chain state. The
  transport's provenance is still trusted (V3_OBSERVATIONS.md §1).
- **Customers.** Entitlement continuity or customer runtime admission across the sale isn't
  touched. Those need their own durable asynchronous state machines, and no remote transaction
  ever happens inside a SQLite transaction.
- **External assets.** It doesn't hand over external assets: domains, provider accounts, source
  hosting.
- **Lost history.** If a closed outcome scrolled out of the 8-entry ring before any observation,
  this design can't recover it, and reports `unavailable`.
- **The digest.** It can't be recomputed from the views read; see §1.
