# Customer use across the runtime and a sale (jobs 003l, 003l1)

Claude, 2026-11-03. Authority: [003l](../astra/jobs/2026-11-03_003l_customer-use-protocol.md),
corrected under [003l1](../astra/jobs/2026-11-03_003l1_customer-protocol-corrections.md) after
Astra's [review](../astra/2026-11-03_CustomerProtocolReview.md). Builds on
[BUSINESS_V3_CORE.md](BUSINESS_V3_CORE.md), [BUSINESS_V3_SALE.md](BUSINESS_V3_SALE.md),
[V3_OBSERVATIONS.md](V3_OBSERVATIONS.md) and [V3_RECONCILIATION.md](V3_RECONCILIATION.md).

## 0. What this document is

- **Verified facts** (marked **[V]**) are read from `contracts/business-v3/src/lib.rs` and pinned by
  keyless unit tests that call the actual methods. Each names its test.
- **Proposed behaviour** (marked **[P]**) is the app protocol. §8 lists what job 003m builds; the
  rest is for later jobs.
- **Authorization.** Tony has already authorized building this locally: tables, routes, injected
  adapters and tests. No routine design approval is needed. Live wallet sign-in, operator key
  custody, transaction signing, deployment, live endpoints or providers, real tokens and spending
  stay forbidden until Tony says yes in chat. Every live dependency is unconfigured and disabled.

| 003l1 point | Where |
|---|---|
| 1, 2: owner authority and any-account METERING | §1 |
| 3: accepting/closing, no blanket freeze | §6 |
| 4: prepare before sign; canonical bytes; network binding | §3, §4 |
| 5: reservation identity | §5 |
| 6: closed roots and the limits of expiry | §7 |
| 7: dispatch is at most once | §7 |
| 8: revocation latency | §6, §7 |
| 9: protection and retention seams | §3.4 |
| 10: one state table, interruptions | §5.3, §9 |

## 1. Authority as the contract enforces it [V]

| Act | Who may | Source; test |
|---|---|---|
| Install or revoke a use-key, pause, skip a hold sequence | The customer's own account only (`own_entitlement`), 1 yoctoNEAR | `install_key`, `revoke_key`, `skip_hold_seq`, `set_paused` |
| Open a hold, charge uses | **The current owner**, or an account holding METERING **at the current generation** (`require_metering`, lib.rs:2302) | `c01`, `c02`, `g02` |
| Release a hold | The same, before `settle_until`; **anyone** after it | `release_hold`; `g02` |
| A Gated close | Terms must include **some** METERING grant, to **any account** (`validate_terms`) | `c02` |

**Facts that change the 003l design:**

1. **The owner meters without any grant** (`c01`). Before a sale, the owner (not an operator)
   opens and settles. After a Direct sale with no grant, the platform's operator, the former owner
   and a stranger are refused (`E_NOT_OPERATOR`), but **the new owner settles and opens holds**.
   So "nobody can settle" is false. With no successor grant, *the platform* loses authority. The
   business does not.
2. **A Gated close accepts METERING for an unrelated account** (`c02`). A grant of only SUPPORT is
   refused. `stranger.near` with METERING is accepted, closes, and settles a hold open across the
   close; the platform's `meter.near` (SUPPORT only) and `meter2.near` are refused. **Platform
   identity is an app policy, not a contract guarantee.**
3. **A live deal never pauses metering** (`c03`). An offer can stay open 30 days (`MAX_OFFER_MS`).
   At day 29 in `accepting`, and through `closing` in Gated mode, the current operator opens and
   settles. After the close the same account, granted again, settles at generation 2.
4. **Already-signed uses outlive revocation** (`c04`). `revoke_key` sets `serve_until = min(serve_until, now)`
   and raises the key epoch. A use signed before the revoke still settles until `settle_until`.
   After the revoke, a HoldAuth at the old epoch gets `E_KEY`.

**Customer keys never pass to an owner.** A use-key is the customer's: public on chain, private
on the customer's device. Operators and owners submit transactions. Only the customer's key signs
a `HoldAuth` or a `UseAuth`. **The server never holds a customer's private key.**

## 2. Mappings (no caller chooses them) [P]

| Mapping | Trusted source |
|---|---|
| Person → customer chain account | `chain_accounts` (`owner_kind = 'person'`). A body never names an account. This local mapping is **not wallet authentication**; production needs wallet sign-in (§10). |
| Business → contract | The operator binding (`V3Options.bindings`: network, account). |
| Offer → release and plan | A `customer_offers` row (§8.1), immutable except retirement, created by the owner under the control-epoch fence. It stays with the business through a sale. |
| Platform metering identity | Operator configuration (`operatorAccount`). Never a contract fact (§1.2). |

**Customer records follow the customer, not the owner.** Every request row carries the
customer's `person_id` and chain account. Only that person reads it. A seller, a buyer who
becomes owner, or another customer gets **404**, before and after a sale. Owner trials keep their
own purpose (`trial`) and their owner-epoch fence (`answerFor`), unchanged.

## 3. Preparation before signing [P]

A customer never signs bytes the server has not first persisted. The order is fixed:

1. **Prepare** (`POST /api/customer/offers/:offer/prepare`). The server reads `get_control`,
   `get_plan` and `get_entitlement` at **one pinned final block** (with its timestamp), outside any
   transaction. In one transaction it then:
   - checks idempotency;
   - allocates the hold sequence (§5.1);
   - draws a fresh 32-byte salt and a request id;
   - computes the fingerprint and the two contract messages (§4);
   - persists everything, with expirations;
   - returns the **signing envelope**.
2. **Client check.** The client recomputes every preimage from the envelope's plain fields, checks
   the public key is its own key for this network, business and plan, and shows the consent (§3.3).
   If anything differs, it does not sign.
3. **Sign.** The client signs the two 32-byte **digests**, not the preimages (§4). One unit, one
   slot (§5.1).
4. **Confirm** (`POST /api/customer/uses/:id/confirm`) with the envelope digest and both
   signatures. The server verifies them against the **stored** public key and the **stored**
   digests, then persists the exact `open_hold` payload before any submission (§5).

### 3.1 The envelope

`version` is `customer-sign-envelope/v1`. Integers up to u32 are JSON numbers; u64 and u128 are
canonical decimal strings (no sign, no leading zeros); bytes are lowercase hex.

```
{ version, request_id, offer_id, release_id, artifact_digest,
  network, business_account, plan_id, customer_account, reg_id,
  key_slot, key_epoch, public_key,
  hold:   { hold_seq, units: 1, serve_until_ms, preimage_hex, message_hex },
  use:    { slot: 0, fingerprint_hex, preimage_hex, message_hex },
  commitment: { input_sha256, salt_hex, fingerprint_preimage_hex },
  consent: { unit_price, asset, units: 1, retention_days, sign_by_ms, accept_by_ms },
  envelope_digest }
```

`envelope_digest` is sha256 over the §4 encoding of every field above, in order, except itself.
The salt appears **only** in this customer's own envelope. It never appears in events, logs,
listings or owner responses.

### 3.2 Expirations

| Name | Clock | Rule |
|---|---|---|
| `serve_until_ms` | chain | Pinned block timestamp plus the serve window (configurable, default 10 min, never above `plan.hold_ttl_ms`). |
| `accept_by_ms` | chain | `serve_until_ms − 60 000` (`MIN_SERVE_MS`). **[V]** After it, no block can accept this HoldAuth (`c04`: `E_EXPIRED` at `serve_until − 60 s + 1 ms`). |
| `sign_by_ms` | server | `accept_by_ms` minus a submit margin (default 2 min). Covers skew between the server clock and block time. A confirm after it is refused, and nothing is submitted. |

Every *proof* of expiry uses **block timestamps** from a pinned read (§5.2), never the server
clock. Policy cut-offs use the server clock with margins.

### 3.3 What the customer consents to

The client shows, from the envelope:
- the business account and network;
- the product, by offer and release;
- the price of one unit, as exact base units of the named asset;
- that one unit is held until `serve_until`;
- that one use of the input whose sha256 is shown is authorized;
- the result's retention.

**The signed UseAuth authorizes one charge of one unit for this request.** The platform commits to
submit it only after a validated result. The contract cannot check delivery, so this is a stated
trust bound, limited to one unit per request.

### 3.4 Private input, protection and retention

- Prepare takes the input, records its sha256 and length, and **stores no plaintext**.
- With an injected `InputProtection` (`protect(bytes) → ref`, `open(ref)`, `erase(ref)`), it
  stores the opaque ref.
- Without one, it stores nothing. A later dispatch must then receive the same input again, and
  checks it against the digest.
- **There is no plaintext fallback in any environment.** Test doubles are labelled synthetic.
- Retention is configurable per offer (default 30 days for results, in a later job). Prepared and
  terminal request rows are bounded per person (§8.4). Erasure and encryption at rest are seams,
  not claims: neither exists until a protection implementation is configured.

## 4. Canonical bytes [V for the contract messages, P for the app's]

**Encoding.** This is borsh's encoding, written by hand so a client needs no library:
- a string is a u32 little-endian byte length, then its UTF-8 bytes;
- integers are little-endian at their exact width;
- a fixed byte array has **no** length prefix;
- a list is a u32 count, then its items.

Never bare concatenation.

| Message | Fields, in order | Signed bytes |
|---|---|---|
| Hold **[V]** | `"business-hold/v1"`, business str, plan u32, customer str, reg_id u64, key_slot u8, key_epoch u32, hold_seq u32, units u8, serve_until_ms u64 | sha256 of that preimage |
| Use **[V]** | `"business-use/v1"`, business str, plan u32, customer str, reg_id u64, key_slot u8, key_epoch u32, hold_seq u32, slot u8, fingerprint [32] | sha256 of that preimage |
| Fingerprint [P] | `"customer-use-fingerprint/v1"`, network str, business str, plan u32, customer str, reg_id u64, key_slot u8, key_epoch u32, hold_seq u32, slot u8, request_id str, offer_id str, release_id str, artifact_digest [32], input_sha256 [32], salt [32] | none: the fingerprint is the sha256 |
| Envelope [P] | `"customer-sign-envelope/v1"`, then §3.1's fields in order | none: the digest identifies the envelope |

**Evidence.** `customer_signing_matches_server_fixture` builds both contract preimages by hand,
asserts their sha256 equals `hold_message`/`use_message`, and shows that a signature over the
preimage is refused (`E_SIG`) while one over the digest opens the hold and charges the use. Its
output, `server/test/fixtures/v3/customer-signing.json`, is verified in
`server/test/customer-signing.test.ts` with `node:crypto` ed25519. The keys are synthetic (seed 1).

**Network binding.** The contract's messages do **not** name a network **[V]**. The app binds it
in three ways:
- the fingerprint includes the network, so every signed use commits to it;
- the envelope names it;
- the client generates **one use-key per (network, business account, plan)** and never installs
  it elsewhere, so a signature cannot verify on another network.

The HoldAuth has no free field, so its network binding is the key policy alone. This is stated,
not hidden.

## 5. Reservation [P, with V rules]

### 5.1 Allocation

- **One unit and one slot per request.** One hold per entitlement can be active **[V]**
  (`E_HOLD_ACTIVE`), and the next hold must be exactly `hold_seq + 1` **[V]**. The first
  implementation therefore runs one request at a time per (customer, plan). That limits
  throughput, and the limit is stated.
- **One allocation at a time.** A request takes `hold_seq = observed hold_seq + 1`. At most one
  local allocation per (network, contract, plan, customer account, reg_id) is open. Requests
  racing for it get one winner; the other gets `409 use_in_progress`. The same idempotency key
  returns the same preparation.
- **When an allocation frees.** It frees only when its own outcome allows reuse:
  - proven refused (§5.2);
  - unresolved, with the sequence observed past ours;
  - or a preparation cancelled or expired, once `accept_by_ms` has passed.

  Before that, the customer could still hold a valid signature for that sequence.
- **No new hold after a lost answer.** A lost response never creates a new hold: an unknown stays
  attached to its own sequence.
- **Local locks are not chain locks.** Another wallet or operator can still use the sequence. That
  shows up as an explicit conflict in readback, never as a silent success.

### 5.2 Exact identity (the decision table)

Every decision uses one pinned read of `get_entitlement` at block B, taken with B's timestamp
`T_B`. Expected values come from the persisted preparation:
- `reg_id`;
- `key_slot`, `key_epoch` and `public_key`;
- `hold_seq`;
- `units = 1`;
- `serve_until_ms`;
- `settle_until_ms = serve_until_ms + plan.settle_grace_ms`.

A read at a block **below** the reservation's newest evidence block is stale, and is ignored.
These rows are checked in order:

| # | Readback | Decision | Why it is sound **[V]** |
|---|---|---|---|
| 1 | No entitlement, or another `reg_id` | `unresolved: registration_changed` | Our messages name the old `reg_id`, so they can never open again. Whether they opened before an unregister is not readable. |
| 2 | Active, with every expected field equal (seq, units, key slot, key epoch, serve_until, settle_until) | `reserved`; serving only while the key at our slot is still active at our epoch | Each (slot, epoch) names one key forever: the epoch rises on every install and revoke. The public key was matched at that epoch when we prepared. Equal fields mean the signed message is ours. |
| 3 | Active, seq, units, key slot, key epoch and settle_until equal, `serve_until < ours`, and the key's epoch now above ours | `reserved`, serving ended (`key_revoked`) | Only `revoke_key` lowers `serve_until` (`c04`). Signed uses still settle. Nothing new is dispatched. |
| 4 | Active, `hold_seq == ours`, any other field different | `refused: superseded` | One sequence opens at most once (`E_HOLD_SEQ_USED`, `c04`), so ours never opened and never will. |
| 5 | `hold_seq < ours − 1` | `unknown: inconsistent` | Allocation read `hold_seq = ours − 1`, and the sequence never falls. This is evidence of a different source; it is flagged and never resolved. |
| 6 | `hold_seq == ours − 1`, and the key at our slot is at a different epoch | `refused: key_changed` | The contract needs `k.epoch == auth.key_epoch`, and epochs only rise. |
| 7 | `hold_seq == ours − 1`, and `T_B > accept_by_ms` | `refused: expired_unopened` | No later block can accept it (`c04`). Block timestamps rise from block to block (§11, assumption A1). |
| 8 | `hold_seq == ours − 1`, otherwise | still pending: resend the **exact** stored payload, if attempts remain | The identical HoldAuth either opens once or answers `already` (`c04`). It never opens a second hold. |
| 9 | `hold_seq ≥ ours`, not row 2, 3 or 4 | `unresolved: sequence_used` (with the readback's last-hold fields) | Once closed, only seq, bitmap, count and root remain (`c04`). Which HoldAuth opened it is not readable. |

**Rules over the table:**
- **No fresh hold.** Rows 1, 5 and 9 never authorize a fresh hold automatically. The customer sees
  "we can't tell whether this reservation opened", and may start a **new** request (new id, next
  sequence) explicitly.
- **Everstreet's own actions.** Everstreet never submits a use for a request that was not
  `reserved` and dispatched. A row-9 request can say "no charge was submitted by Everstreet for
  this request". That is a fact about our own event log. It is not a chain proof of "uncharged".
- **What the writer says is not evidence.** A writer's answer (`opened`, `already`, a refusal, a
  timeout) is recorded as an event. Only the table moves the state.
- **Transient refusals** keep the request pending (row 8) until `accept_by_ms`:
  - `E_NOT_OPERATOR`, meaning platform authority was lost (§6);
  - `E_PAUSED`;
  - `E_DAILY_CAP`;
  - `E_UNITS`, meaning no free unit;
  - `E_HOLD_ACTIVE`, meaning another hold is open.

### 5.3 States

| State | Means | Leaves by |
|---|---|---|
| `prepared` | The envelope is persisted; signatures are awaited | confirm → `reserve_requested`; cancel → `cancelled`; server clock past `sign_by_ms` → `expired` |
| `reserve_requested` | Signatures verified; the exact `open_hold` payload persisted; nothing submitted yet | A leased submission → `reserve_unknown` |
| `reserve_unknown` | At least one submission; no decisive readback yet | Table rows 2–9 |
| `reserved` | Row 2 or 3 at a pinned block; the block and the matched fields are recorded | Later jobs (dispatch, settle, release) |
| `refused` | Rows 4, 6 or 7: this authorization did not and cannot open a hold | Terminal |
| `unresolved` | Rows 1, 5 or 9: readback can't attribute the sequence | Terminal for automation; visible to the customer |
| `cancelled`, `expired` | Never confirmed | Terminal |

**Leases and events:**
- **CAS lease.** Each submission or readback step claims a lease by compare-and-swap: it raises
  `lease_gen` and sets `lease_until`. It applies its result only if `lease_gen` is unchanged.
- **Stale workers.** A stale worker's result is discarded. It can never overwrite a newer state.
- **Events.** Events are append-only and bounded per request. They carry codes, blocks and
  attempts; never the salt, signatures or input.
- **No remote awaits inside SQLite.** Each step commits its intent, awaits outside any
  transaction, then commits its outcome under the CAS.

## 6. A sale, or a revocation, while customers are being served [P]

**There is no blanket freeze.** An offer may stay open 30 days **[V]**, so pausing service for
`accepting` would be wrong. Service follows authority:

| Situation | Behaviour |
|---|---|
| The live deal's grants give **the configured platform account** METERING | Service continues through accepting, closing and the close (`c03`). |
| The grants exclude it | New preparations continue, with the consent saying the business is under offer. At the close, the platform's submissions start failing with `E_NOT_OPERATOR`. Open holds stay settleable by the new owner (§1.1) or a successor operator. Nothing the platform has not settled is charged by the platform. Each open hold's exposure is bounded by its `settle_until` (≤ serve window + grace). |
| After a close without platform METERING | Admission fails closed (`operator_not_authorized`), read from pinned control. **Recovery:** the new owner calls `appoint_operator(platform, METERING)`; the next pinned read admits again. Holds still before their `settle_until` become settleable again. |
| Unknown authority (no read, stale read, incoherent read) | Fails closed. Nothing is prepared or submitted. |

**Limits:**
- **A pinned read can be overtaken.** A close or a revocation can land in the next block, so no
  pinned read before dispatch eliminates the race. The protocol bounds it:
  - each request holds one unit;
  - its hold ends at `serve_until`;
  - a lost authority shows as a refused or unknown settle, not as a fabricated charge.
- **Revocation is seen with latency.** The latency is the time to the next pinned read plus
  finality. Admission (later job) dispatches only on a read younger than a configured age, and
  only with at least the provider's maximum duration left before `serve_until`.

## 7. After reservation (for the later jobs) [P]

- **Dispatch is at most once.** `dispatched` is committed, under the lease, **before** the
  provider is called, and automation never calls it a second time.
  - A crash or lost reply after that commit is `outcome_unknown`. The provider may have run.
  - There is no automatic redispatch. Where a provider offers an idempotency key, the request id
    is used; this is not a promise of exactly-once execution.
  - A stale worker's late result is kept as an event, never applied.
- **What the settle readback shows** (`check_use` plus the closed-hold fields):

  | Readback | Meaning |
  |---|---|
  | `charged` (hold active) | **Positive proof** of our charge |
  | `unused` | Not charged yet; resend the same signed use before `settle_until` |
  | `conflict` | Another fingerprint holds the slot. Flagged, never resolved |
  | `closed` | Only a **root recomputed from the complete ordered list of used slots** decides (`(slot, fingerprint)` for every set bit of `last_hold_used`, including other requests' and devices'). With a one-unit hold the list is only ours, so the bitmap plus our fingerprint give the exact root (`customer_signing_matches_server_fixture`: one-slot, partial and empty roots). |

  `closed` alone says the same thing for any fingerprint, as the 003l fixture showed.
- **When the root can't be matched.** With missing history or a root mismatch, the outcome stays
  **unknown**, never `unsettled_after_deadline`.
- **Expiry proves nothing about charges.** Expiry alone never proves a use was not charged before
  the hold closed. The four outcomes stay distinct:
  - positive charge (`charged`, or a matching root with our bit set);
  - proven unused (a matching root without our bit, or `released` with our bit clear and the
    complete list known);
  - conflict;
  - unavailable history.

## 8. Job 003m: what is built now [P]

### 8.1 Tables

| Table | Holds |
|---|---|
| `customer_offers` | id, business, release, project, artifact digest, network, contract account, plan id, a plan snapshot read at a recorded pinned block, retention days, state `active`/`retired`, created by, owner epoch, idempotency. Immutable but for retirement. |
| `customer_requests` | id, person (the customer), customer account, offer, idempotency key, request hash, input sha256 and length, protected-input ref or null, salt, entitlement identity (network, account, plan, reg_id, key slot, epoch, public key), hold_seq, serve_until, settle_until, accept_by, sign_by, the fingerprint, both messages, the envelope digest, the signatures (after confirm), state, reason, lease gen and until, attempts, last evidence block, timestamps. Unique on (person, idempotency key). One open allocation per entitlement (partial unique index). |
| `customer_request_events` | Append-only: request, sequence, kind, code, block, lease gen, time. |

### 8.2 Injected options (`AppOptions.customer`)

All are null by default, which answers `503 customer_use_unavailable` and has no side effects.

- `reader`: reads `get_control`, `get_plan` and `get_entitlement` at one pinned final block, with
  that block's timestamp.
- `writer`: submits `open_hold` with a stored payload and answers what the endpoint said. It has
  no signing code; tests inject a fixture-backed double.
- `operatorAccount`, `protection`, the windows, the margins and the bounds.
- Nothing is wired in `main.ts`, and no worker starts by itself.

### 8.3 Routes

| Route | Caller | Does |
|---|---|---|
| `POST /api/businesses/:id/customer-offers` | Owner (epoch fence before and after the plan read) | Creates an offer for an active release and an existing plan |
| `GET /api/businesses/:id/customer-offers` | Owner | Lists offers. No customer data. |
| `POST /api/businesses/:id/customer-offers/:offer/retire` | Owner (fenced) | Retires an offer |
| `POST /api/customer/offers/:offer/prepare` | Customer | §3; returns the envelope |
| `GET /api/customer/uses/:id` | That customer only | Status, with the envelope while `prepared` |
| `POST /api/customer/uses/:id/confirm` | That customer | Verifies and persists, then one leased submission step if a writer exists |
| `POST /api/customer/uses/:id/cancel` | That customer | From `prepared` only |
| `POST /api/customer/uses/:id/reconcile` | That customer | One bounded readback/resend step |

A `reconcileDue(limit)` method serves a later worker.

### 8.4 Bounds

- Input of at most 20 000 characters.
- At most 20 non-terminal requests per person, and 200 kept in total.
- Five submissions per request, and 50 events.
- Bounded reader and writer timeouts.
- Every test double has its own finite ceiling.

## 9. Interruptions (one table, consistent with §5.3) [P]

| Interruption | Expected |
|---|---|
| Lost prepare reply | The same idempotency key returns the same preparation; a new key gets `409 use_in_progress` |
| Same key, different input or offer | `409 idempotency_conflict`; nothing changes |
| Confirm after `sign_by_ms` | `409 preparation_expired`; nothing submitted |
| Wrong signature, key, epoch, sequence, slot or deadline | `422 signature_invalid`, because every signature is checked against the stored digests and key |
| Lost `open_hold` reply | `reserve_unknown` → §5.2. An exact match is `reserved`; still pending means the exact resend; never a second hold. |
| Restart mid-submission | The lease expires; the next step resends the identical payload |
| Two workers | One lease wins; the stale result is discarded |
| The customer revokes before the open | Row 6, `refused: key_changed` |
| The customer revokes after the open | Row 3, `reserved` with serving ended |
| An external hold or skip advances the sequence | Rows 4 or 9; never a fresh automatic hold |
| A sale while a request is open | The customer's request and its entitlement identity are unchanged. Former and new owners get 404. Admission follows §6. |
| No reader or writer configured | `503 customer_use_unavailable`; no rows, no calls |

## 10. Live prerequisites not met

Each needs Tony's explicit yes:
1. Wallet sign-in, so a person proves their chain account. `install_key` is signed from that
   account, and use-keys are generated client-side.
2. Platform METERING operator key custody, and transaction signing.
3. A live testnet endpoint with verified chain identity (V3_OBSERVATIONS.md §8), and a reader that
   returns block timestamps.
4. A real fungible token.
5. An input and result protection implementation, with deletion.

## 11. Assumptions to check before any live use

- **A1.** NEAR block timestamps rise strictly from block to block, so a pinned block's timestamp
  bounds every later block. It is used only in row 7. It must be confirmed against nearcore's
  header validation before live use; until then, row 7 holds only for the synthetic transport.
- **A2.** `get_entitlement` is read at a final block. A non-final read is refused by the reader.

## 12. Contract-produced fixtures

| File | Produced by | Shows |
|---|---|---|
| `customer-readback.json` | `customer_readback_matches_server_fixture` (003l) | Entitlement and `check_use` at funded, consumed, active, released and after-sale states |
| `customer-signing.json` | `customer_signing_matches_server_fixture` (003l1) | Hand-encoded preimages, the digests, signatures that the contract accepts, and one-slot, partial and empty closed roots |

The authority facts come from `c01`–`c04` (003l1), with `g01`/`g02` (003g).

All signatures come from a synthetic test key (seed 1). None is a wallet signature, and no fixture
executes a real transaction.
