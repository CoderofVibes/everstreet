# 003h report: read business-v3 as observations, never as authority

Claude, 2026-11-03. Job: [003h](../jobs/2026-11-03_003h_v3-observation-foundation.md).

| Commit | What |
|---|---|
| `8041156` | Implementation note `docs/design/V3_OBSERVATIONS.md` (written first) |
| `8d4bda8` | business-v3 fixture test; `server/test/fixtures/v3/*.json` (test-only, no contract behaviour change) |
| `2e4d317` | `server/src/v3read.ts`, `server/src/v3observe.ts`, tables in `db.ts`, two routes in `app.ts`, `server/test/v3-observe.test.ts` |
| this commit | Note correction (ordering table, sticky flags), this report, JOBS |

Out of scope and not done:

- Signing; network calls; `main.ts`, scripts or config.
- UI.
- v1 or v2 changes; contract behaviour; new dependencies.
- Ownership changes and a runtime closer.

## What exists now

**Reader (`v3read.ts`).** This is separate from the signing v2 `Chain`.

- `ViewTransport` is an injected interface with exactly two methods, `finalBlock(network)` and
  `view({network, account, method, args, block})`. It can't create accounts, read keys, sign or
  broadcast. No implementation ships, so the default is unavailable.
- `readSnapshot` pins one final block and reads `get_control`, `get_outcomes`, `get_treasury`,
  `get_pending` and, if asked, one `get_period {yyyymm}` at that block.
- It refuses:
  - an answer from another block (`mixed_blocks`, including the same height with another hash);
  - a result over 64 KiB, or a malformed block identity;
  - a read that runs past the timeout.
- Errors are codes only: `unavailable`, `timeout`, `mixed_blocks`, `malformed`, `out_of_range` and
  `unknown_enum`.

**Schema `business-v3/003g`.** The decoders match the contract's actual JSON:

- Exact field sets.
- u64 and u128 values stay canonical decimal strings, compared with BigInt and never with `Number`.
- Small integers are range-checked; enums are allow-listed; account ids are validated; the manifest
  must be 32 bytes of hex.
- Operators are decoded from the `[account, caps, generation]` tuple, with at most 8.

Coherence is checked before anything is persisted:

- the treasury buckets add up to `held`, and withdrawable ≤ available;
- escrow equals the live deal's;
- the pending total matches;
- outcomes are unique, and the live deal isn't also an outcome.

**Persistence.** STRICT tables `v3_observations`, `v3_outcomes` and `v3_projection`; outcomes can't
be updated (trigger). Ordering is as in the note's §4 table:

| Result | When |
|---|---|
| `accepted` | A new block |
| `duplicate` | The same block and digest again |
| `stale` | An older block |
| `conflict` | The same block or height with other content, or a recorded outcome changed |
| `contradictory` | A higher block with a lower control sequence |
| `source_changed` | A different network, account or schema from the projection's |

- Retention keeps the newest 50 observations per business, as an option.
- The projection, the high-water mark and the outcomes are never pruned.
- The history of deal outcomes reports gaps (count and the first 8); nothing is inferred.

**API (owner only).**

- `GET /api/businesses/:id/v3` returns one of three states:
  - `unbound`;
  - `never_observed`, saying whether a transport is configured;
  - `observed`: source, block and finality, provenance note, observation time and freshness,
    high-water mark, flag, control (with manifest and closer notes), owner match, treasury in exact
    strings with the claims note, pending, period, outcomes, history.
- `POST /api/businesses/:id/v3/refresh` takes an optional `period` and nothing else. It:
  - captures the control epoch;
  - re-checks it after the read (on both the error and the success path) and inside the write
    transaction;
  - logs `v3.read_refused {code}` or `v3.observed {outcome, block_height, digest}`.
- Bindings come only from `AppOptions.v3.bindings`. A request body can't name an account or network.

## Evidence

The fixtures are produced by business-v3's own unit test (`serialized_views_match_server_fixtures`)
from three synthetic worlds: Direct accepting, Direct closed and Gated closing. That test fails if
the contract's JSON drifts from the committed files. All values are fictional.

`server/test/v3-observe.test.ts` has 16 tests through the real API and service. It covers:

- **Decoding:**
  - Direct and Gated snapshots;
  - values above 2^53 (`held` 4×10^20) kept exact;
  - 16 malformed, out-of-range and unknown-enum cases, each refused with its code.
- **Coherent reads:** mixed blocks, both kinds; incoherent pending; bad JSON; timeouts.
- **Ordering:**
  - duplicate;
  - reversed completion: the older block's read finishes last and is `stale`;
  - the same control sequence while funds change;
  - a contradictory sequence;
  - same-block and same-height conflicts;
  - a reversed outcome (closed, then reported cancelled) is a `conflict`; the first stands, and
    the row can't be updated.
- **History and owner match:** a ring gap (deals 1–2 missing, listed and not invented); `matches`,
  `unknown_mapping` and `mismatch`. On a mismatch, the app owner is unchanged and the chain's owner
  still gets 404.
- **Access during the read:**
  - the caller loses control while the read is in flight: 404, nothing recorded;
  - away and back during the read: 409, nothing recorded.
- **Isolation and trust:**
  - another person and an unbound business, where refresh is 409 with no transport call;
  - body fields can't change the binding; a bad period is 400;
  - no transport: `unavailable`;
  - raw transport error text kept out of responses and events.
- **Restart and source:** a changed binding after restart gives `source_changed`, and the old record
  is kept. The high-water mark survives restart and pruning, and retention holds at 2.

**Mutation checks** (each reverted):

| Mutant | Failing tests |
|---|---|
| No control re-check after the read | 1 |
| No stale rule | 2 |
| No same-height conflict | 1 |
| No outcome immutability | 1 |
| No contradiction rule | 1 |
| Unbounded retention | 1 |

The outcome-immutability test was added after I found that branch had no test.

```
npx vitest run server/test/v3-observe.test.ts  → 16 passed
npm run check        Test Files 35 passed (35); Tests 401 passed (401)
npm run web:build    built (existing chunk-size advisory only)
WSL cargo test -p business-v3 --lib            → 64 passed (incl. the fixture test)
WSL cargo clippy -p business-v3 --all-targets  → 0 warnings
```

## Limits and remaining gates

- **Trust.** The transport asserts provenance; nothing here verifies a block cryptographically.
  `finality: "final"` means the transport said so. Every view carries that note.
- **Flags are sticky** and nothing clears one. Clearing a flag means deciding that conflicting
  evidence was explained, which is an operator act that hasn't been designed.
- **Owner match** uses the existing person `chain_accounts` rows. A wallet the app doesn't hold
  shows as `unknown_mapping`; linking an external wallet is not built.
- **Not built:**
  - a real transport (RPC client), which needs approval for network calls;
  - production wiring;
  - UI;
  - reconciliation into app ownership;
  - a managed closer.

  The note's §7 gives the exact contract for reconciliation and the managed closer, and keeps v2
  separate.
- **No browser or live check.** These are API tests on the contract's unit-test JSON. They don't
  show that a deployed v3 contract behaves the same.

M3 and M4 stay open. Stopping here for Astra review, before reconciliation or runtime integration.
