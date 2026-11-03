# Reading business-v3: observations, not authority (job 003h)

Claude, 2026-11-03. Authority: [003h](../astra/jobs/2026-11-03_003h_v3-observation-foundation.md).
Builds on [BUSINESS_V3_SALE.md](BUSINESS_V3_SALE.md) and [AUTHORITY.md](../AUTHORITY.md).

This is a read-only boundary. It never signs, never moves money or ownership, and never makes a
network call in development or tests. No production wiring (`main.ts`) is added.

## 1. Trust

- **Bindings are operator configuration.** Each one is `{ business_id, network, account }` and is
  supplied through the app's injected options (`AppOptions.v3`), never by a request. No person can
  claim, change or add a binding. There is no public route.
- **The transport asserts provenance, not truth.** The injected `ViewTransport` reports which
  final block a view was evaluated at. The service checks those identities for consistency, but it
  can't prove the bytes came from NEAR consensus; a lying transport could lie consistently.
  Cryptographic light-client verification is a later gate. Every observation records the source
  (network, account, schema) and the block (height, hash), with `finality: "final"` as the
  transport claimed it.
- **An observation grants nothing.** If the chain's owner doesn't match the app's owner of the
  business, the app reports *reconciliation required*. It never reassigns ownership, grants access
  or reveals private data. Reconciliation remains 003b's compare-and-set path, extended to v3 later.

## 2. One coherent snapshot

1. The transport names the current final block `{ height, hash }`.
2. Every view (`get_control`, `get_outcomes`, `get_treasury`, `get_pending`, and optionally
   `get_period(yyyymm)`) is called **at that block** (`block_id = hash`).
3. Each answer must name the same height and hash, or the whole snapshot is refused
   (`mixed_blocks`). Reads never mix "latest" answers from different blocks.
4. Each call has a timeout (`timeout`). Any failure refuses the whole snapshot; nothing partial is
   stored.

## 3. Decoding (schema `business-v3/003g`)

The decoder matches the contract's actual JSON (`serde_json` of the 003g view structs) exactly:

- **Field sets:** every field is required and no unknown field is allowed (`malformed`).
- **u64 and u128** are decimal strings (`U64`, `U128`). They are checked against their bounds and
  kept as **strings**, compared only with `BigInt`, and never converted to `Number`. Block heights
  are decimal strings too.
- **u8, u16 and u32** must be safe integers within their range.
- **Enums** must come from the fixed lists. Anything else is `unknown_enum`, which is never mapped
  to a default.
- **Account ids** follow NEAR rules (2–64 characters).
- **Hex digests** are exactly 64 lowercase hex characters.
- **Lists are bounded:** operators ≤ 8, grants ≤ 4, outcomes ≤ 8, pending ≤ 16, keys not read.

Fixtures are the real thing. `business-v3`'s unit test `serialized_views_match_server_fixtures`
serializes actual views (Direct accepting, Direct closed, Gated closing, with amounts above 2⁵³)
and asserts they equal the committed JSON in `server/test/fixtures/v3/`. The TypeScript decoder is
tested against those same files. No contract behaviour changes.

## 4. Durable ordering

Observations are recorded in one transaction:

- `v3_observations`: the decoded snapshot (never raw transport text), plus source, block, control
  sequence and a digest.
- `v3_outcomes`: each terminal deal outcome ever seen, keyed by deal number.
- `v3_projection`: the current state and the **high-water mark** (block height and control
  sequence).

The cases, compared with the high-water mark and the projection's source:

| Case | Result |
|---|---|
| Same source, a new block (`height` above high-water), `control_seq` ≥ high-water | Accepted. Equal `control_seq` is normal: customers and payouts change the treasury without control changing. |
| Exactly the same block hash and digest as an earlier observation | `duplicate`: idempotent, nothing written |
| Same block hash, different content; or same height, different hash | `conflict`: fails closed, nothing written; the projection is flagged |
| Height below the high-water mark (a hash not already recorded) | `stale`: nothing written |
| Higher height but lower `control_seq`, or any control change §4a forbids | `contradictory`: fails closed; the projection is flagged |
| A deal outcome already recorded, now reported with different content | `conflict`: nothing written; the projection is flagged; the first outcome stands |
| A different network, account or schema from the projection's | `source_changed`: nothing written; the old projection stays as it was, labelled with its source |

Checks run in this order: source, same block hash, height, control sequence, outcomes.

**Flags are sticky.** A later accepted observation updates the projection but never clears a
`conflict` or `contradictory` flag. Nothing clears one in this job: deciding that conflicting
evidence has been explained is an operator act that hasn't been designed yet.

Outcomes are only ever copied from the ring. Deal numbers from 1 to the highest seen (live or
ended) that were never observed as outcomes and aren't live are **gaps**: history is *incomplete*,
counted and listed (the first 8). Nothing is inferred to have closed or been paid.

**Retention:** the newest 50 observations per business are kept and older ones are pruned in the
same transaction. The projection, the high-water mark and the outcome table aren't pruned, so
ordering survives pruning and restarts.

## 4a. Coverage and coherence (job 003h1)

[003h1](../astra/jobs/2026-11-03_003h1_observation-coverage-and-coherence.md) corrects two faults
Astra reproduced:

- Adding a monthly read at an already-recorded block was a false, sticky `conflict`.
- An owner change with an unchanged `control_seq` was accepted.

### Core snapshot and period coverage are separate evidence

- **The core snapshot** is `get_control`, `get_outcomes`, `get_treasury` and `get_pending` at one
  block. Every refresh reads it. Its digest covers only those four views, so whether a month was
  also asked for never changes it. `v3_observations` stores the core only.
- **Period evidence** is one `get_period(yyyymm)` answer at one block. It is read at the same
  pinned block as its core and stored in `v3_periods`, keyed by business and month. Each row has
  its own block height and hash, digest and `observed_at`.

**Recording a period** happens only when the core from the same read was `accepted`, `duplicate`
or `stale`. A `conflict`, `contradictory` or `source_changed` core block contributes nothing. The
period is compared with the row already stored for that month:

| Case | Result |
|---|---|
| No row for the month, or a higher block | Stored; it replaces the month's row |
| Same block hash, same digest | `duplicate`, idempotent |
| Same block hash, different digest: the same method, arguments and block giving different bytes | `conflict`; the projection is flagged |
| Same height, another hash | `conflict`; flagged |
| Lower block | `stale` for that month; the newer evidence stays |

The month's result is reported next to the core's: `{ outcome, period: { yyyymm, outcome } }`.

- **Coexisting reads.** A read without a month, months A and B, the same month twice, and two
  months read concurrently at one block all coexist: the core is `duplicate` and each month is
  stored or `duplicate`.
- **Not asked is not zero.** A refresh without a month never touches period rows. A month that
  was never read is absent; nothing shows it as zero.
- **Provenance.** Each month shows its own block and `observed_at`, and `at_core_block` is true
  only when its block is the core block shown. A month read at block 1000 is never presented as
  sampled at a later core block.
- **Retention.** One row per month (its newest evidence), and at most 24 months per business,
  matching the contract's `PERIOD_RING = 24`. Storing a 25th month drops the month whose evidence
  is oldest (lowest block height). A dropped month that is read again is simply stored again.
- **Stale core blocks are checked too.** A core block below the high-water mark at the same height
  as a retained observation, with another hash, is now a `conflict`, not merely `stale`.

### What one snapshot must satisfy

These are refused as `malformed` before anything is stored. Each rule is guaranteed by the 003g
contract source (`contracts/business-v3/src/lib.rs`), named here:

1. **Operators belong to the current generation.** Every operator's generation equals
   `generation`. `appoint_operator` writes `self.generation`, and `finalize` resets every slot to
   the new generation.
2. **A live deal matches control.** Its seller is the owner and its `expected_generation` is
   `generation`. `propose_sale` sets both from the current state, and only `finalize` changes the
   owner or generation, which empties the deal slot.
3. **A live deal matches the close mode.**
   - Direct: `close_window_ms` is 0 (`validate_terms`), and a deal is never `closing`
     (`accept_sale` finalizes at once).
   - A `closing` deal is in Gated mode, with both parties accepted, and its `closing_control_seq`
     equals `control_seq`. While closing, every method that raises the control sequence refuses or
     ends the deal:
     - `revise_sale`, `unfund_deal`, `accept_sale`, `cancel_sale` and `expire_sale` refuse;
     - `create_plan`, operator changes and `set_manifest` call `require_no_deal`;
     - `fund_deal` returns the funds;
     - only `close_sale` and `abort_close` end the deal.
4. **Escrow is all or nothing.** A live deal's escrow is 0 or its price, and an outcome's
   `escrow_returned` is 0 or its price.
   - `fund_deal` requires the exact price.
   - `revise_sale` returns escrow whenever the price changes.
   - A closed outcome returns 0 (`finalize`).
5. **The outcome ring is contiguous.** `propose_sale` requires no live deal, so deals end in
   order, and `record_outcome` writes slot `seq % 8`. The ring therefore holds exactly deals
   `max(1, m−7)..m`, where m is the latest ended deal; with a live deal, m = `live.seq − 1`.
6. **Outcomes are ordered.**
   - Each outcome's `control_seq` is higher than the one before it, and none exceeds `control_seq`.
     Each end is its own `next_control()`.
   - `generation_after` never decreases and never exceeds `generation`.
7. **The latest close shows the current owner.**
   - The newest `closed` outcome's buyer is the owner, and its `generation_after` is `generation`,
     because `finalize` sets both and any later close would appear later in the ring.
   - Outcomes after it have `generation_after` equal to `generation`.
8. **A complete ring counts every close.** When the ring still holds deal 1, `generation` is
   1 + the number of `closed` outcomes. `new` sets generation 1, and only `finalize` raises it,
   recording a `closed` outcome as it does.

### What a newer block must satisfy against the high-water observation

These are compared with the high-water observation's core. A failure is `contradictory`: nothing
is applied and the projection is flagged.

- **Same `control_seq`:** `get_control` and `get_outcomes` must be exactly the same. Every method
  that changes a field of those views raises the control sequence:
  - `create_plan`;
  - `appoint_operator` and `revoke_operator`;
  - `set_manifest`;
  - the sale methods (`propose_sale`, `revise_sale`, `unfund_deal`, `accept_sale`,
    `cancel_sale`, `expire_sale`, `abort_close`, `close_sale`);
  - `fund_deal`.

  Outcomes are written only by `terminate` and `finalize`. Treasury, pending payouts and periods
  can change, because customer and payout methods don't raise it.
- **Higher `control_seq`:**
  - `close_mode`, the closer and the treasury's asset are unchanged. They are set only in `new`.
  - `generation` never decreases, and rises by at most the rise in `control_seq` (only `finalize`
    raises it, by 1, in one control step).
  - The same `generation` means the same owner, because the owner changes only in `finalize`.
  - `manifest_seq` never decreases and rises by at most the `control_seq` rise. The same
    `manifest_seq` means the same `service_manifest` (`set_manifest` raises both).
  - The latest deal number never decreases. That number is the live deal's, otherwise the highest
    outcome's, otherwise 0; `deal_seq` rises only in `propose_sale`.
  - A deal live in both keeps its seller and `expected_generation`. `propose_sale` fixes them, and
    `revise_sale` requires the same seller and generation.

**Deliberately not compared** across a higher `control_seq`: operator lists, deal terms and
acceptance flags, and how many deals or outcomes were skipped. All can change legitimately between
two observations.

### Trusted setup is validated at construction

The service refuses to start, with a clear error, if:

- `retention` isn't a whole number from 1 to 10 000. Retention 0 would prune the projection's own
  observation.
- `staleAfterMs` or `timeoutMs` isn't a positive whole number.
- A binding has an invalid network name or account id.
- Two bindings name one business.

## 5. Application API (owner only)

| Route | Returns |
|---|---|
| `GET /api/businesses/:id/v3` | The projection: source, block, freshness (`observed_at`, age, `stale_after_ms` 10 min), control, deal or outcomes, treasury in exact strings, history completeness, owner-match status. Or `unbound` (v2 or unconfigured; existing paths unchanged) or `never_observed`. |
| `POST /api/businesses/:id/v3/refresh` | Takes a snapshot through the transport and records it |

**`refresh` fencing:** it takes the control epoch first, re-checks it after every await, and
re-checks inside the write transaction.

**Errors** are sanitized codes with short fixed messages. Raw transport text and data are never
put in responses or audit events; the event records only the code, block and digest.

**Owner match:** the observed owner account is looked up in `chain_accounts` (person rows, reading
only `owner_id`, never the stored secret):

- `matches`: it maps to the app's current owner;
- `mismatch`: reconciliation required;
- `unknown_mapping`: no person has that account.

## 6. Language at the point of use

- A manifest hash is "a hash pointer, not available code".
- A configured closer is "the account allowed to finalize; not a verified handover".
- A closed outcome is "observed closed at block N". A sale-proceeds claim is "owed", and only the
  period counters show "paid".

## 7. Next integration contract (not built here)

**Reconciliation into the app's ownership** (extending 003b to v3) requires all of:

- an accepted, non-conflicting observation at or above the deal's close;
- an outcome `closed` whose seq, version and digest equal the locally recorded terms;
- `generation` exactly the recorded one plus 1, and owner = the recorded buyer's mapped account;
- a compare-and-set in one local transaction.

Gaps, conflicts, an unknown mapping or a stale high-water mark block it.

**A future managed closer** would additionally need: drain evidence, artifact availability behind
the manifest pointer, a signed and journalled close order, and signing infrastructure. None of
this exists yet.

**v2** businesses keep their `Chain` paths unchanged. A business is read as v3 only when a binding
exists, and the two are never mixed.
