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
| Platform metering policy (003m1) | `platformMeters`: the configured account holds METERING granted **in the current generation**. Deliberately narrower than the contract's `require_metering` (`contractMeters`: owner **or** such an operator, unit test `c01`): the platform never acts through owner authority, so an owner account without a grant is not admitted. |

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
| 2 | Active, with every expected field equal (seq, units, key slot, key epoch, serve_until, settle_until) | `reserved`; **serving at B** only while the key at our slot is still active at our epoch **and** `T_B < serve_until` (003m1) | Each (slot, epoch) names one key forever: the epoch rises on every install and revoke. The public key was matched at that epoch when we prepared. Equal fields mean the signed message is ours. |
| 3 | Active, seq, units, key slot, key epoch and settle_until equal, `serve_until < ours`, and the key's epoch now above ours | `reserved`, serving ended (`key_revoked`) | Only `revoke_key` lowers `serve_until` (`c04`). Signed uses still settle. Nothing new is dispatched. |
| 4 | Active, `hold_seq == ours`, any other field different | `refused: superseded` | One sequence opens at most once (`E_HOLD_SEQ_USED`, `c04`), so ours never opened and never will. |
| 5 | `hold_seq < ours − 1` | `unknown: inconsistent` | Allocation read `hold_seq = ours − 1`, and the sequence never falls. This is evidence of a different source; it is flagged and never resolved. |
| 6 | `hold_seq == ours − 1`, and the key at our slot is at a **higher** epoch than ours | `refused: key_changed` | The contract needs `k.epoch == auth.key_epoch`, and epochs only rise. A **lower** epoch is a regression: a conflict (§5.4), never a refusal (003m1). |
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
| `reserved` | Row 2 or 3 at a pinned block; the block and the matched fields are recorded. **Historical**: it says the hold was ours at B, never that it may be served now (§5.4). | Later jobs (dispatch, settle, release) |
| `refused` | Rows 4, 6 or 7: this authorization did not and cannot open a hold | Terminal |
| `unresolved` | Rows 1 or 9: readback can't attribute the sequence | Terminal for automation; visible to the customer |
| `reserve_unknown` + `evidence_conflict` | Row 5, or a fence violation (§5.4) | Sticky: nothing is read, sent, decided or freed |
| `cancelled`, `expired` | Never confirmed | Terminal |

**Leases and events:**
- **CAS lease.** Each submission or readback step claims a lease by compare-and-swap: it raises
  `lease_gen` and sets `lease_until`. It applies its result only if `lease_gen` is unchanged.
- **Stale workers.** A stale worker's result is discarded. It can never overwrite a newer state.
- **Events.** Events are append-only and bounded per request. They carry codes, blocks and
  attempts; never the salt, signatures or input.
- **No remote awaits inside SQLite.** Each step commits its intent, awaits outside any
  transaction, then commits its outcome under the CAS.

### 5.4 Evidence is fenced and historical (job 003m1)

Astra reproduced three unsafe decisions at `5bb81a0`: a first readback below the prepared block
refused a hold that had opened; a different hash at the evidence height terminalized; an
expired hold read as `serving: true`. The rules now:

- **The baseline.** Preparation persists an evidence mark for its pinned block: the height, hash
  and timestamp, the sha256 of the decoded entitlement, and a summary of what may only rise
  (`reg_id`, then within one registration `hold_seq` and each key's epoch). Every later readback
  is compared with the last accepted mark (`evidenceProblem`).
- **Lower block:** stale. It is recorded as an event and changes nothing.
- **Equal height:** it must be identical in hash, time and content. Otherwise it is a conflict
  (`equal_height_hash_differs`, `equal_block_time_differs`, `equal_block_view_differs`).
- **Higher height:** its time must be later (assumption A1; else `block_time_not_rising`), and
  nothing may regress (`registration_regressed`, `hold_sequence_regressed`,
  `key_epoch_regressed`). Row 5 of §5.2 is also a conflict.
- **Conflicts are sticky.** The request stays `reserve_unknown` with reason `evidence_conflict`
  and the conflict recorded. Nothing is read, resent, decided or freed for it, and the worker pass
  skips it. Its allocation stays held. **Recovery is a defined later step, not automatic:** a
  later reviewed job resolves it explicitly. A later honest block never clears it silently.
- **A 003m row without a mark** is fenced from its prepared block (height, hash and time; its
  content digest is unknown, so equal-height content isn't compared).
- **Serving is historical.** `serving` reports whether the hold was serving **at the evidence
  block**: the key still active at our epoch and `T_B < serve_until`. Serving ends at
  `serve_until`; `revoke_key` lowers it to the revocation time. Status always returns
  `ready_now: false`. Dispatch (later job) revalidates fresh control, entitlement, the exact
  hold, the unused slot and the deadline itself.
- **Nothing trusts the writer.** Stale evidence is never resolved by a writer's answer or a fresh
  hold. The exact signatures and payload, and the one logical request, are kept.
- **Bindings before every call.** Prepare and confirm refuse `binding_mismatch` when the writer's
  network or signer, or the reader's network, differs from the request's binding; nothing is
  called. A step that finds a mismatch records it and calls nothing. After the read's await,
  prepare's transaction rechecks the account mapping and binding. Confirm rechecks the account
  mapping (`account_changed`), the offer, the active release and the binding, atomically with
  its transition.

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
| A readback below the prepared or evidence block (003m1) | Stale: ignored; the state and allocation are unchanged |
| Equal-height evidence that differs, a regression, or time not rising (003m1) | Sticky `evidence_conflict` (§5.4): no refusal, release, resend or fresh hold |
| A reservation read after `serve_until` (003m1) | `reserved`, `serving: false`, `serve_window_passed`; `ready_now` always false |
| Writer or reader on another network or signer (003m1) | `409 binding_mismatch` at prepare and confirm; in a step, recorded and nothing called |

## 10. Live prerequisites not met

**What is already authorized and what is not (corrected in 003m1).** The code, interfaces, test
doubles and tests for every item below are already authorized and need no further approval.
What stays prohibited without Tony's explicit yes in chat is the live act itself: real signing
and transactions, operator key custody, deployment, live endpoints or providers, spending, and
any external commitment.

The live prerequisites:
1. Wallet sign-in, so a person proves their chain account. `install_key` is signed from that
   account, and use-keys are generated client-side.
2. Platform METERING operator key custody, and transaction signing.
3. A live testnet endpoint with verified chain identity (V3_OBSERVATIONS.md §8), and a reader that
   returns block timestamps.
4. A real fungible token.
5. An input and result protection implementation, with deletion.

## 11. Assumptions to check before any live use

- **A1.** NEAR block timestamps rise strictly from block to block, so a pinned block's timestamp
  bounds every later block. It is used in row 7 and in the evidence fence (§5.4: a higher block
  whose time didn't rise is a conflict, so a live adapter that breaks A1 fails closed). It must be confirmed against nearcore's
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

## 13. Execution of a reserved request (job 003n) [P]

One reserved customer request runs the released product once, through the existing managed
runtime (`invocations.ts`): the same validated extractor, provider contract, prices, budget,
operator ceiling, concurrency limit, ledger and restart recovery. **Unit settlement and release
are later jobs.** The customer's unit stays held on the contract, and nothing here claims it was
charged or returned.

### 13.1 Identity

- **One-to-one.** One customer request has at most one execution (`customer_executions`, keyed by
  request), and one execution has exactly one `runtime_invocations` row with purpose
  **`customer_use`**. The invocation's idempotency key is derived from the request id, so two
  workers can't create two invocations.
- **Fixed by the request.** The offer, release, artifact digest and input digest come from the
  prepared request. The release must still be the offer's release, still active, and still
  served by the model, validator and release policy it was released with. The artifact's digest
  must equal the offer's (no artifact swap). The caller supplies no owner, artifact or release.
- **Owner identity is a business fact.** The invocation records the business owner and
  generation at dispatch, and `requested_by` is the customer. The record is business operating
  history for cost only (§13.5).

### 13.2 Transitions

| Step | Where | What |
|---|---|---|
| 1. Request | `POST /api/customer/uses/:id/execute` (that customer only) | Requires `reserved`, no conflict, no execution yet (an existing one is returned, never redispatched). |
| 2. Input | No await | The input is the protected copy (§3.4, `load`) or the one the customer resubmits. Either must match the prepared sha256 **and** length, or the request is refused (`input_mismatch`). It is never executed with missing input (`input_needed`). |
| 3. Fresh evidence | Await, outside SQLite | One pinned read of control, plan and entitlement, fenced against the request's mark (§5.4). It must show: `platformMeters`, the offer's plan unchanged, decision row 2 **serving at B**, slot 0 unused (`hold_used` bit clear, no fingerprint), and `serve_until − T_B ≥ maximum execution time + margin`. Otherwise: stale is `503 evidence_stale`; a conflict is recorded (sticky) and `409 evidence_conflict`; anything else is `409 not_serving` with the reason. Nothing is reserved or sent. |
| 4. Dispatch intent | One transaction | Rechecked: the request is still `reserved` with no conflict and no execution; the binding and adapters; the offer, release and runtime identity; and the local control epoch read before the await (`control_changed` otherwise). Then the runtime's own checks: budget, ceiling and concurrency. It inserts the invocation (`running`, the worst-case reservation in the ledger) and the execution row, with the admission evidence. |
| 5. One provider call | Await | The existing `run`, at most once: only the creator of the invocation calls the provider. |
| 6. Result | Await, then one transaction | The extraction is validated by the existing validator. On a clean answer the result is protected (`protect`), then the invocation is finished with **no output stored** in it, and the execution records the reference, scheme and retention deadline. |

### 13.3 What can go wrong

| Case | Outcome |
|---|---|
| Lost reply to the customer | The same execution and result are returned again |
| Crash after the intent | The existing `recover()` makes it `unknown` / `outcome_unknown`, its reservation held. Never run again. |
| Provider failure, timeout, partial or unknown usage | The existing ledger: final usage settles exactly; partial or unknown keeps the hold as unresolved |
| Cancelled | The provider call is aborted. A late output after a cancellation is **not stored or delivered**; its usage is still recorded. |
| Protection fails after a result | The execution is `result_unavailable`. Nothing is re-run automatically, and the cost stands. |
| Competing workers | One invocation (unique key); the other gets the existing execution |

### 13.4 Execution is a result, not a settlement

- **What `fulfilled` means.** The customer's status shows the execution state and outcome, and
  `fulfilled` only for a validated `extracted` answer. A validated answer is not proof of model
  quality.
- **Units.** The status always says the unit is reserved and awaiting settlement. No unit is
  marked consumed or refunded, and the reservation's allocation stays held until a later
  settle/release job proves the hold closed.

### 13.5 Privacy and accounting

- **Where the result lives.** It is stored only through an injected `Protection` (`protect`,
  `load`, `delete`), with a retention deadline (`offer.retention_days`). Without one, execution
  is unavailable: there is no plaintext fallback. Retrieval after the deadline is refused
  (`result_expired`), and a bounded `expireResults(limit)` deletes expired copies through the seam.
- **Who reads it.** The result is read only by the requesting customer, before and after a sale,
  with the caller rechecked after the `load` await. The former owner, the new owner and other
  customers get 404.
- **Owner-facing routes:**
  - the runtime list excludes `customer_use`;
  - `GET /api/runtime/invocations/:id` and `cancel` answer 404 for it;
  - `finish` never writes its output;
  - events and errors carry codes only.
- **What the business sees.** Its budget, ceiling and books `spend` count the provider cost
  (reported tokens at declared prices) as aggregated operating history, with no customer text.
- **Owner trials.** Their access, retention note and `answerFor` fence are unchanged.

### 13.7 Freshness, retention, diagnostics and delivery (job 003n1)

Astra reproduced three failures at `461dfa3`:
- the same final block a day later still dispatched once;
- a result loaded across its retention deadline was returned;
- provider failure text (which can echo the customer's document) was stored in the business's
  `failure_detail`.

The rules now:

- **Admission freshness (local-clock policy).** Prepare and execute accept the newest final block
  only if:
  - `now − T_B ≤ maxBlockAgeMs` (default 120 s): else `503 evidence_too_old`;
  - `T_B − now ≤ maxFutureSkewMs` (default 30 s): else `503 clock_uncertain`.

  Chain timestamps stay the evidence for chain facts; the local clock is admission policy only,
  never proof of a refund.
- **Time left counts from the later clock:** `serve_until − max(now, T_B)` must cover the runtime
  limit plus the margin. It is checked after the read **and again inside the dispatch
  transaction**, together with the release, model and artifact (`releaseFor` and the same artifact
  job). A model change during the read gives `release_needs_recheck`; a re-pointed release gives
  `artifact_changed`.
- **Retention is exact and rechecked after the await.** A result is available while
  `now < retention_until` and expired from the deadline on. `result` checks the caller, the state,
  the reference, the scheme and the deadline before the `load`, and **all of them again after it**.
  Loaded bytes are never returned if any changed (`result_expired`, `result_changed`).
- **Allowlisted diagnostics.** A `customer_use` record stores only a fixed sentence per failure
  class (`CUSTOMER_DIAGNOSTICS`), never provider prose. The class, usage and cost stay exact.
  Owner trials keep the provider's explanation.
- **Validated, delivered, eligible.** These are three separate facts:
  - *validated*: completed with a valid `extracted` answer;
  - *delivered*: the result was durably protected (`delivered_at`);
  - *fulfilled* and *settlement_eligible*: both of the above.

  Eligibility is frozen at delivery; later expiry or deletion doesn't undo it. In these cases the
  work is ineligible and never re-run:
  - a protection failure;
  - a crash between finishing and protecting;
  - a model refusal (delivered for the customer to read, but ineligible).
- **Cleanup through the seam, bounded and honest:**
  - **`expireInputs(limit)`** deletes an input that can't be needed again: the request ended
    without running, its execution finished (nothing re-runs), or its serving time passed.
    A request that may still run keeps its input.
  - **`expireResults(limit)`** deletes a result at or past its deadline.
  - **Failures.** A failed deletion keeps its reference and is counted as failed, and a
    reference under another protection scheme is skipped: it is never passed to this seam, and
    neither execute nor `result` loads it (`protection_scheme_changed`).
  - **Orphans.** Protecting a result is followed by a compare-and-swap. A losing result copy is
    deleted, as are duplicate input copies. A crash between `protect` returning and the record
    leaves an unreferenced copy in the seam's own store; the seam's own expiry must cover that.

### 13.6 Bounds and limits

- **Residual race.** A sale or revocation can land after the fresh read and before or during the
  provider call. That is bounded by the one-unit hold and its `serve_until`; it is not atomic.
- **No worker.** No worker starts by itself, and nothing is wired in `main`.
- **Deferred.** Unit settlement and release follow in §14 (job 003o); the customer UI is later.

## 14. Settling the unit, or releasing it (job 003o) [P, with V rules]

### 14.1 Intent

There is one `customer_settlements` row per reserved request. It is separate from the
invocation, whose provider cost is already exact and is never counted again here.

| Situation | Intent | Payload |
|---|---|---|
| An execution that is **settlement-eligible** (§13.7: validated, durably delivered) | `charge` | The request's own fingerprint and stored UseAuth for slot 0, with `close: true`; no new signature or hold. The frozen eligibility facts are kept. |
| An execution that finished and is not eligible: failed, unknown, cancelled, refused, undeliverable | `release` | `release_hold` for this exact hold |
| A request that never ran: abandoned by the customer (`POST /api/customer/uses/:id/release`), or its serving time passed | `release` | The same |

- **Not yet.** While an execution is running, or an unexecuted request can still run, nothing is
  decided. Once a unit intent exists, execute is refused (`unit_settling`).
- **No release instead of a charge.** A delivered use can't be released instead of settled
  (`delivered`).

### 14.2 The step (leased, bounded)

1. **Claim.** The lease is claimed by compare-and-swap (`lease_gen`).
2. **Check.** The adapters and binding must fit (`binding_mismatch`), and the request must have no
   evidence conflict.
3. **Read.** One pinned read of `get_control`, `get_entitlement` and `check_use` for slot 0, fenced
   against the request's evidence mark (§5.4): stale is ignored, a conflict is sticky.
4. **Decide.** `decideSettlement` uses the entitlement **and** `check_use`, which must agree
   (`views_disagree` otherwise). The one-unit scope is validated:

   | Readback | Fact |
   |---|---|
   | Open, our identity, slot 0 holding **our** fingerprint | `charged`, open |
   | Closed, `last_hold_seq` ours, bitmap `1`, charged 1, and `last_hold_root == root([(0, our fingerprint)])` (recomputed from the complete used list) | `charged`, closed |
   | Closed, bitmap `0`, root = the empty list's | `returned` |
   | Open, slot 0 unused | `unused_open`; settleable only while `T_B ≤ settle_until` **[V]** (`E_EXPIRED` after) |
   | Open, another fingerprint in slot 0 | `conflict: other_fingerprint` |
   | Closed with any other root or bitmap | `unknown: root_mismatch` / `not_one_unit` |
   | Our sequence behind the contract's record | `unknown: history_lost` |
   | Another registration | `unknown: registration_changed` |

5. **Apply**, under the lease:
   - charged and closed is `charged`;
   - returned is `returned`;
   - a conflict is sticky;
   - unknown is `unresolved`;
   - charged but open: release the hold to close it (its one unit is used, so nothing more is
     charged);
   - unused and open: settle (charge) or release. A charge whose deadline passed becomes a
     release (`settle_deadline_passed`): never a charge.
6. **Submit**, only if an action is due:
   - within five submissions;
   - with authority from the same read: the platform's granted METERING now, or, for a release,
     a block after `settle_until`, when the contract lets anyone release, though only the
     configured actor is used;
   - with a fresh block (§13.7).

   The intent is persisted (`unknown`, attempt count) before the await. The writer's answer is
   only an event; the next step's readback decides.

### 14.3 What it guarantees

- **Charges.** Only a delivered extraction can be charged, and only readback proves it. A lost
  answer, a dropped request or a duplicate yields at most one charge (the same signed use is
  `already` while open, and `E_HOLD_CLOSED` once closed **[V]**).
- **Refunds.** An unused unit returns only when observed released (closed with the empty root).
  Expiry alone is never a refund. Root mismatch, lost history and changed registration stay
  `unknown`.
- **The allocation.** It is freed only when the hold is closed or the sequence moved on. Then the
  customer may explicitly prepare the next use; nothing is created automatically. A conflict
  keeps it held.
- **Open requests.** A reserved request whose unit is decided (charged, returned or unresolved)
  no longer counts toward the open-request limit.
- **Authority.** Lost platform authority (for example after a sale that granted METERING to
  someone else) sends nothing (`operator_not_authorized`) and stays retryable. A regrant
  resumes. The new owner never inherits customer keys or private results.
- **Balances.** The customer's view shows the unit state, its source block, retryability, and
  `free`/`consumed` exactly as the contract's view reported them. There is no local arithmetic.

### 14.4 Evidence, kept apart

- **The contract itself:** `customer_settlement_matches_server_fixture` (Rust, actual methods)
  produces `customer-settlement.json`. It covers:
  - a one-unit charge with close;
  - a replay (`already`) and a close by release;
  - an unused release (the empty root);
  - a conflicting fingerprint (`E_CONFLICT`);
  - an expired settle (`E_EXPIRED`) followed by a release by anyone;
  - 100/20/80 across an actual sale with the platform's grant;
  - the former owner refused, and the successor's next use (21/79).
- **The decision rules over that JSON:** `customer-settlement-fixture.test.ts`.
- **The API path:** `customer-settlement.test.ts` runs against the **TypeScript test double**,
  which models `settle_hold`, `release_hold` and `check_use` from `lib.rs`. It does not execute
  the contract. Its 20-use trace and the reconciled sale are evidence about the app, not about the
  contract VM.

### 14.5 Registration-bound release and the delivery decision (job 003o1)

**The registration ABA [V].** `release_hold(customer, plan_id, hold_seq)` names no registration.
Unit test `c05` shows the problem using only the actual lifecycle:
1. registration 1's hold 1 closes;
2. the customer refunds all 10 units, the payout callback succeeds, and the customer
   unregisters;
3. the customer registers again (registration 2), buys with a key, and opens hold 1.

A release meant for registration 1's hold 1 then **closes registration 2's hold 1**. No read
before the transaction can prevent this.

**The correction.** This is an additive contract method, undeployed:
`release_hold_for(customer, plan_id, reg_id, hold_seq)`. It refuses another registration
(`E_REGISTRATION`) in the same call, changing nothing, then behaves exactly as `release_hold`: the
operator any time, anyone after `settle_until` (`c06`). `release_hold` itself is unchanged, for
compatibility.
- **The worker.** The injected writer has only `releaseHoldFor`, and the request's stored
  `reg_id` is in its payload. A writer without it can't release (`writer_unavailable`); there is no
  unguarded fallback.
- **Deployment.** Live use needs a new business-v3 deployment that includes this method (a new
  account, per the born-locked rule). Nothing was deployed.

**The delivery decision.** It is durable, and a release can't overtake it.
- **The states.** `customer_executions.delivery` is:
  - undecided (`null`);
  - `protecting`, set by CAS before the protection await, with its start time;
  - `delivered`, by CAS only from `protecting`;
  - `not_delivered`: the protection failed, the run didn't complete, or recovery after
    `deliveryTimeoutMs` (default 5 min) since the protection started or the run finished.
- **No intent while undecided.** Neither the worker, the customer's reconcile nor the customer's
  release (`delivery_pending`) records a unit intent while the decision is pending. Recovery
  persists `not_delivered` in the intent's own transaction, so the frozen intent and the delivery
  decision always agree.
- **Late completion.** A protection that completes after the decision became final is discarded:
  its copy is deleted through the seam (`late_result_discarded`). It never turns a release
  decision into a delivered or chargeable result. The provider cost stands; nothing is re-run.

**Fenced unit steps.** Every write in a unit step, its error and conflict paths included, happens
only under the step's lease. A stale worker whose read is overtaken records nothing, not even a
sticky conflict (reproduced as reachable by a mutant). `check_use`'s slot bit must agree with the
entitlement's bitmap, and a closed hold's charged count with its bitmap. Contradictory views at
one block never manufacture charged or returned.
