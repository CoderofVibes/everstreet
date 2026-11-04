# Customer use across the runtime and a sale (job 003l)

Claude, 2026-11-03. Authority: [003l](../astra/jobs/2026-11-03_003l_customer-use-protocol.md).
This builds on [BUSINESS_V3_CORE.md](BUSINESS_V3_CORE.md), [BUSINESS_V3_SALE.md](BUSINESS_V3_SALE.md)
and [V3_RECONCILIATION.md](V3_RECONCILIATION.md), and on the server runtime
(`server/src/invocations.ts`).

**This is a design.** No customer admission is implemented. The readback fixtures it relies on are
produced by the contract (§9). The live prerequisites in §10 are not met. Nothing here claims
production authentication, signing or uninterrupted service.

## 1. What the contract enforces (read from source)

| Step | Who may | Contract fact |
|---|---|---|
| Buy units | Anyone paying through the token (`ft_on_transfer` `buy`). Paying grants no authority. | `free += units`, `ent_free_value += value` |
| Install a use-key | **Only the customer's own account** (`own_entitlement`; a sponsor cannot), 1 yoctoNEAR | Key slot 0–3 and `epoch + 1`. Weak ed25519 keys are refused. |
| Open a hold | A METERING operator **of the current generation**, or the owner (`require_metering`) | Needs a **customer-signed** `HoldAuth` over `(business-hold/v1, business, plan, customer, reg_id, key_slot, key_epoch, hold_seq, units, serve_until)`. `hold_seq` must be exactly the next one; the key must be active at that epoch. Units move from free to held. |
| Charge uses | The same operator rule | Each use is **customer-signed** over `(business-use/v1, …, hold_seq, slot, fingerprint)`. The whole batch is checked first. The same fingerprint again gives `already`; a different one in a used slot is `E_CONFLICT`. Allowed until `settle_until = serve_until + settle_grace`. |
| Release a hold | The operator any time; **anyone** after `settle_until` | Uncharged units return to free; `last_hold = {seq, used, charged, root}` |
| Revoke a key | The customer | `serve_until = min(serve_until, now)` for its hold. Signed uses still settle until `settle_until`. |
| Readback | Views | `get_plan`, `get_entitlement` (public: keys, fingerprints of the active hold) and `check_use` |

**Across a sale** (`finalize`): every operator slot is cleared, and only the deal's grants are
installed at the new generation. Test `g02` shows this:

- **A successor METERING grant exists.** It settles a hold that was open across the close, and the
  old operator gets `E_NOT_OPERATOR`.
- **No grant** (possible in Direct mode only). Nobody can settle; after `settle_until` anyone
  releases, and the units return.

Test `g01` runs 100/20/80 across an actual close: the successor operator serves the same customer
with the customer's **own** key, and the former owner has no owner authority.

## 2. Mappings and authority (no caller chooses them)

| Mapping | Source |
|---|---|
| Person to customer chain account | `chain_accounts` (person, unique), the app's own account records. A customer-supplied account is never trusted. |
| Business to contract | The operator binding (`V3Options.bindings`) |
| Product to plan and release | A new `customer_offers` row: `(business_id, plan_id, project_id, release_id)`, written by the owner and immutable per release |
| The plan itself | `get_plan(plan_id)`, read at a pinned block. `created_generation` is noted. |

**Owner trials and customer use are different purposes.**

- Owner trials stay as today: the purpose is `trial`, fenced on the owner epoch (`answerFor`).
- Customer use is a new purpose, `customer_use`. It is admitted only for the mapped customer of
  an entitlement, on a released `customer_offers` row.
- The customer's result is retrieved by **customer authorization**, never the owner epoch. A
  later owner can't read it, and neither can the seller after a sale.

**The new owner never inherits customer keys.** Keys are the customer's: public on chain, private
on the customer's side. The operator account signs only `open_hold`, `settle_hold` and
`release_hold`. It never signs a customer's `HoldAuth` or `UseAuth`.

## 3. Request identity and fingerprints

A customer request is `customer_requests.id`, keyed by `(customer person, idempotency_key)`. Its
**fingerprint** is the 32 bytes the customer signs:

```
fingerprint = sha256( "everstreet-use/v1" || request_id || business || plan_id || reg_id
                       || hold_seq || slot || release_id || sha256(input) || salt )
```

- `salt` is 32 random bytes per request, kept server-side. Without it, the public fingerprint in
  `get_entitlement.hold_slots` would be a guessable hash of possibly personal input.
- The raw input is never published. On chain there is only the salted fingerprint.

**Exact binding.** One request is one `(reg_id, hold_seq, slot)`, at most once. A different input
can never reuse a slot: the contract's `E_CONFLICT` and readback `conflict` both refuse it.

**Output.** It belongs to the customer:

- stored encrypted at rest, and readable by the customer's session only;
- kept for the product's stated retention, with a default of 30 days, after which it is deleted;
- **not disclosed to a successor owner** unless the product promise says so, and not in this slice.

## 4. States (all intent persisted before any side effect)

`customer_uses.state` takes these values:

```
accepted ─► reserve_requested ─► reserved ─► dispatched ─► result_recorded ─► settle_requested ─► settled
               │       ▲            │            │               │                  │       ▲
               ▼       │            ▼            ▼               ▼                  ▼       │
       reserve_unknown─┘     released_unused  dispatch_failed   result_failed  settle_unknown─┘
                                                                                     │
                                                                                     ▼
                                                                         unsettled_after_deadline
```

| State | Means | Leaves by |
|---|---|---|
| `accepted` | The request, input digest and salt are stored, and the customer's signed `UseAuth` is checked locally | A reservation is needed, or the open hold has a free slot |
| `reserve_requested` | An `open_hold` transaction is intended, with its customer-signed `HoldAuth` | The hold is confirmed or unknown |
| `reserve_unknown` | No answer arrived | Readback: `get_entitlement.hold_active && hold_seq == ours` means `reserved`; `last_hold.seq == ours` means it closed; otherwise retry the **same** `HoldAuth` (`open_hold` answers `already` only with a valid signature) |
| `reserved` | The hold is observed active at a pinned block, and the slot is assigned | Dispatch |
| `dispatched` | The provider call was sent. **Only after `reserved`.** | A result or a failure |
| `result_recorded` / `result_failed` | A validated deterministic result, or a refusal, timeout or invalid output | A settle is intended **only** for a successful extraction |
| `settle_requested` | `settle_hold` with this use is intended | Confirmed or unknown |
| `settle_unknown` | No answer arrived | `check_use`: `charged` means `settled`; `unused` (hold active) means resend the **same** signed use; `closed` means recompute the root from our submitted fingerprints (§9: `closed` alone doesn't say whose fingerprint), and if ours is in the root it's `settled`, otherwise `unsettled_after_deadline`; `conflict` means fail closed and flag it |
| `released_unused` | The slot was never charged, and the hold was released | Terminal; the units are back to free |
| `unsettled_after_deadline` | The service was delivered, but the deadline passed without a charge | Terminal: the business absorbs it. **No retry charges again**, since the contract forbids it after `settle_until`. |

The rules:

- **No awaits inside SQLite.** No remote call is ever awaited inside a SQLite transaction. Each
  step commits its intent, then calls, then commits the outcome.
- **One charge per logical request.** A logical request never dispatches twice, because
  `dispatched` is a guarded transition, and never charges twice, because the slot is fixed and the
  contract answers `already`.
- **When replay can't be proven:**
  - after `settle_until`, a `closed` readback with a root we can't match: we report `unknown` and
    never guess;
  - a lost provider response after `dispatched`: the provider may have run, so the state is
    `result_failed` with `outcome_unknown`. No settle, and no automatic redispatch.

## 5. Consent and signing

- **Consent.** The customer agrees per offer (plan, release, price, retention) before their key is
  installed.
- **The key.** The customer's key is generated and held **by the customer**: a browser WebCrypto
  ed25519 key, or their wallet. `install_key` needs the customer's **own NEAR account** to sign:
  a wallet transaction.
- **Signing holds and uses.**
  - `HoldAuth` is signed per hold. The client shows the units, `serve_until` and the plan.
  - `UseAuth` is signed per use, over the fingerprint the server computed and returned to the
    client before dispatch.
- **Checks before dispatch:** the key's state and epoch from `get_entitlement`, the hold's
  `serve_until`, `hold_seq` monotonicity, and the per-key daily cap. All of them are re-verified by
  the contract.
- **Revocation.** Revoking the key stops new serving. Already-signed uses settle until
  `settle_until`. `skip_hold_seq` invalidates a signed but unsubmitted `HoldAuth`.
- **Test keys are not production keys.** The fixtures use test signing keys (`SigningKey` seed 1).
  They are not a wallet signature and don't stand in for production authentication.

## 6. Costs and units

There are two ledgers, never merged:

- **Provider cost.** This is the existing `runtime_invocations` reservation and charge, in exact
  microcents, with `usage_state` `final`, `partial` or `unknown`.
- **Customer units.** These are contract holds and charges.

The rules:

- A charge to the customer happens only for `result_recorded` with a successful deterministic
  extraction. It never happens because tokens were used.
- A failed, refused or unknown provider result charges no units: the slot stays unused, and the
  hold releases it.
- Model quality, from evaluations, is separate from deterministic validity, which comes from the
  schema validator.
- A lost settlement reply never yields a free retry: the same signed use is resent, and the
  contract answers `already`.

## 7. A sale while a use is pending

| Situation | Behaviour |
|---|---|
| A successor METERING grant to **the platform's operator account** is in the deal terms | Holds and uses continue. After the close that same account is the operator at `generation + 1` and settles them (`g02`). This is the only uninterrupted path. |
| A grant to a **different** operator | The platform's settles fail with `E_NOT_OPERATOR` from the close receipt on. The successor's operator must settle; the platform stops dispatching new uses for that business at the observed close. |
| **No** METERING grant (Direct only) | Nothing can settle after the close. Pending uses become `unsettled_after_deadline` (the business absorbs them) or `released_unused`. The release happens after `settle_until` (≤ 1 hour + TTL), and the units return to the customer. |
| Between the close receipt and the app observing it | The window in which a dispatch could be unbillable. Remedy: before dispatch, re-read control at a pinned block. Gated mode closes only by a closer order after Closing starts, so a **freeze** (no new holds while a deal is `closing`) bounds it. Direct mode has no such warning. |

**A bounded remedy, proposed for the next job.**

1. While a deal is `accepting` or `closing`, admission refuses new holds for that business, so no
   new reservation is made under an outgoing operator.
2. Uses already reserved settle before the close, or under the successor grant.
3. A deal's terms must include the platform's METERING account for managed products. In Gated mode
   that is enforced by `validate_terms`; in Direct mode the app checks it before recording the
   intent.

This makes interruption **bounded and visible**, not zero. A Direct close with no grant still
stops settlement.

## 8. Workers

- **A reconcile worker.** It leases rows in `*_requested` or `*_unknown` states, with a lease of
  30 s and at most 25 rows a pass. It resolves them only by pinned-block readback
  (`get_entitlement`, `check_use`).
- **Stale or conflicting evidence** (the observation rules in V3_OBSERVATIONS.md) leaves the row
  unknown. It never releases credit or grants access.
- **Idempotency.** Every chain call reuses its stored signed payload, so a crash or restart resends
  the same bytes.
- **No retry loop.** The number of attempts is bounded, and after that the row stays `unknown` and
  visible.

## 9. Contract-produced readback fixtures

`server/test/fixtures/v3/customer-readback.json` is produced by the new contract unit test
`customer_readback_matches_server_fixture`, through actual methods. Each value is the contract's
JSON.

| Key | State | Shows |
|---|---|---|
| `plan_1` | The plan | Unit price 50 000, hold TTL 30 min, settle grace 10 min |
| `funded_100.entitlement` | 100 bought, key installed | free 100, key slot 0 active at epoch 1 |
| `consumed_20.entitlement` | Two holds of 10, settled and closed | free 80, consumed 20, `last_hold` 2 with root |
| `consumed_20.check_use.closed_hold` / `…_altered` | Closed hold 2, slot 3, the real fingerprint and an altered one | **Both** answer `closed`, `slot_used: true`, with the same root. Only recomputing the root from our submitted fingerprints tells them apart. |
| `consumed_20.check_use.unknown_hold` | Hold 9 | `unknown_hold` |
| `active_hold.entitlement` | Hold 3 open, 4 charged | `hold_slots` lists the four fingerprints **publicly**, which is why they are salted (§3) |
| `active_hold.check_use.charged` / `altered_fingerprint` / `unused_slot` | | `charged`, `conflict`, `unused` |
| `active_hold.settle_replay` | The same signed use resent | `["already"]`; charged stays 4 |
| `released_after_deadline.*` | Released by a stranger after `settle_until` | free 76, consumed 24. The charged slot is `closed`/true; the unused slot is `closed`/false. |
| `after_sale.entitlement` / `after_sale.control` | 100/20/80, then an actual sale with a successor METERING grant | The customer's record is unchanged: 80 free and 20 consumed. The owner is the buyer at generation 2, with `meter2` as operator. |

The test keys are fixtures (`SigningKey` seed 1). Nothing here is a wallet signature.

## 10. Expected states for interruptions

| Interruption | Expected |
|---|---|
| Lost `open_hold` reply | `reserve_unknown`, then readback: active means `reserved`; otherwise the same `HoldAuth` is resent. Never a second hold. |
| Restart after `dispatched`, before the result | `result_failed` with `outcome_unknown`. No settle, no redispatch, and the slot stays unused. |
| Lost `settle_hold` reply | `settle_unknown`, then `check_use`: `charged` means settled; `unused` means resend; `closed` means check the root |
| A settle that arrives after `settle_until` | The contract gives `E_EXPIRED`; the use is `unsettled_after_deadline` |
| The customer revokes their key mid-hold | Serving stops at once. Signed uses settle until `settle_until`. |
| A sale with a platform successor grant | Continues |
| A sale without one | §7. Visible as `unsettled` or `released`. |
| The seller's private owner-trial reply, in flight across the sale | Denied, by the existing owner-epoch fence |
| The customer retrieves a result after a sale | Allowed, by customer authorization. The new owner can't read it. |

**Live prerequisites not met** (each a later, separately authorized job):

1. **Customer wallet sign-in**, to call `install_key` from the customer's own NEAR account, and
   client-side ed25519 signing of `HoldAuth` and `UseAuth`.
2. **Operator transaction signing**: a platform METERING account key, and its custody.
   Unauthorized now.
3. **A live testnet endpoint**, with verified chain identity (V3_OBSERVATIONS.md §8).
4. **A real FT** for purchases. Gas and storage costs are measured only in the unit VM.
5. **Encrypted output storage**, with a deletion job.

## 11. Bounded implementation proposal (next job, after review)

1. **Tables:**
   - `customer_offers`;
   - `customer_uses`: the states in §4, the fingerprint, salt, signed payloads, and the
     reservation and settlement block references;
   - `customer_use_events` (append-only).
2. **Admission.** A `CustomerAdmission` alongside the existing owner-trial `Admission`, without
   relaxing `answerFor`. Purpose `customer_use`.
3. **A transport interface** with no signing implementation. `ChainWriter.openHold`,
   `settleHold` and `releaseHold` are behind an interface whose only implementation is a test
   double driving the **unit-VM contract**, or failing with `unavailable` in the app.
4. **API:** `POST /api/customer/offers/:id/uses` (accepted, given the signed `UseAuth`), and
   `GET .../uses/:id` (the customer's own result).
5. **Tests:** every row of §10 against the readback fixtures and the state machine. No live call.

Not in that job: wallet sign-in, operator key custody, a live endpoint, and payments with a real
FT. Each needs Tony's authorization.
