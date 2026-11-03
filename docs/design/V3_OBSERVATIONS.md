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
| Height below or equal to the high-water mark (different hash) | `stale`: nothing written |
| Higher height but lower `control_seq` | `contradictory`: fails closed |
| A different network, account or schema from the projection's | `source_changed`: nothing written; the old projection stays as it was, labelled with its source |

Outcomes are only ever copied from the ring. Deal numbers from 1 to the highest seen (live or
ended) that were never observed as outcomes and aren't live are **gaps**: history is *incomplete*,
counted and listed (the first 8). Nothing is inferred to have closed or been paid.

**Retention:** the newest 50 observations per business are kept and older ones are pruned in the
same transaction. The projection, the high-water mark and the outcome table aren't pruned, so
ordering survives pruning and restarts.

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
