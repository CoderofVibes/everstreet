# 003h1 report: monthly reads are separate evidence, and control changes must be possible

Claude, 2026-11-03. Job: [003h1](../jobs/2026-11-03_003h1_observation-coverage-and-coherence.md).
Commit `deacc8f`.

**Files:** `server/src/v3read.ts`, `server/src/v3observe.ts`, `server/src/db.ts` (new table
`v3_periods`), `server/test/v3-observe.test.ts`, `docs/design/V3_OBSERVATIONS.md` (new §4a: the
design, written before the code, with the contract method behind each rule).

Not changed: the contract, its fixtures, `main.ts`, the transport, signing and the network. No
ownership reconciliation was added.

## Reproduced first

Astra's two cases were added as tests and run against `e47e289`'s service. Both failed as
reported:

| Case | Result on `e47e289` |
|---|---|
| A read without a month, then the same block with month 202611 | `conflict`, flagged for good |
| Block 1001 with only the owner changed to `impostor.near` (`control_seq` 6, generation 1 kept) | `accepted`, shown as the owner |

## 1. Monthly reads are separate from the core snapshot

- **Separate evidence.** The core is `get_control`, `get_outcomes`, `get_treasury` and
  `get_pending`. Its digest and stored snapshot no longer include the month. A month read is
  stored in `v3_periods`, one row per month (the newest evidence), with its own block height, hash,
  digest and `observed_at`.
- **When a month is recorded.** Only when the core from the same read was `accepted`, `duplicate`
  or `stale`. A core that is refused as `conflict`, `contradictory` or `source_changed` records no
  month (`not_recorded`).
- **Ordering per month:**

  | Case | Result |
  |---|---|
  | Same block, same bytes | `duplicate` |
  | Same block, other bytes (the same method, arguments and block) | `conflict`, flagged |
  | Same height, another hash | `conflict`, flagged |
  | Lower block | `stale` |
  | Higher block | Stored |

- **Missing is not zero.** A refresh without a month never touches stored months. The view's
  `periods` list shows each month with its own block, `observed_at`, age and freshness, and
  `at_core_block` is true only when that month was read at the core block shown.
- **Bounded.** At most 24 months per business, the contract's `PERIOD_RING`. A 25th month drops
  the month with the oldest evidence, never the one just stored.
- **Response.** A refresh now answers `{ outcome, message, period: { yyyymm, outcome } | null,
  view }`, and the `v3.observed` event records the same period result.
- **API change.** The view's single `period` field became the `periods` list. Nothing in the web
  app uses this API yet.

## 2. Control evidence must be something the contract can produce

All the rules, with the contract methods that guarantee them, are in the note's §4a.

**One snapshot** (refused as `malformed` before anything is stored):

- Operators are at the current generation.
- A live deal's seller is the owner, and its `expected_generation` is the generation.
- Direct deals have no close window and are never closing. A closing deal is fully accepted, at
  the current `control_seq`.
- Escrow, and escrow returned, is all or nothing; a closed sale returns none.
- The outcome ring is contiguous and ends at the deal before the live one. Outcome control
  sequences rise and generations never fall.
- The newest closed sale's buyer is the owner, at the current generation.
- While deal 1 is still in the ring, the generation is 1 + the number of closes.

**A newer block, against the high-water observation** (`contradictory`, flagged, not projected):

- At the same `control_seq`: any change at all to control or outcomes. Treasury, pending and
  months may change.
- At a higher `control_seq`:
  - the close mode, closer or asset changes;
  - the generation falls, or rises faster than the control sequence;
  - the owner changes within a generation;
  - the manifest sequence falls or rises too fast, or the manifest changes without its sequence;
  - the latest deal number falls;
  - a live deal changes its seller or generation.

Operator lists, deal terms, acceptance flags and skipped deals are deliberately not compared; all
can change legitimately.

**Other fixes:**

- A stale core block at the height of a retained observation, with another hash, is now a
  `conflict`.
- Options are validated at construction:
  - `retention` must be a whole number from 1 to 10 000; 0 would have pruned the projection's own
    observation;
  - the timings must be positive whole numbers;
  - a binding needs a valid network and account, and each business gets one binding.

  Anything else throws `v3 options: …`.

Sticky genuine conflicts, source isolation, unknown owner mappings and the control-epoch fences are
unchanged. There is still no flag-clearing workflow.

## Tests (`server/test/v3-observe.test.ts`, 48; 30 new)

All tests use the real Rust-produced fixtures. Synthetic mutations are labelled in the test source.

| Area | Scenarios |
|---|---|
| Reproductions | Month added at a recorded block: core `duplicate`, month stored, no flag. Owner-only change: not accepted, not shown. |
| Coverage | No month, then 202611, then 202610, then 202611 again at one block: coexisting, no flag, one core observation. The same month and block with other bytes: `conflict`, the first stands. Two months read concurrently at one block: both stored. Reversed completion (1003 read first, 1005 finishes first): the month stays at 1005, and 1003 is `stale`. The next block without a month keeps the month, labelled block 1000, `at_core_block: false`, its own age (20 minutes, stale) while the core is fresh. A contradictory core records no month. 25 months: 24 kept, the oldest-block month dropped, all still there after restart. |
| Same control step | An operator, manifest, live-deal or owner (with seller) change: `contradictory`, not projected, flag detail "without a control step" |
| Higher control step | Generation going back or rising too fast; owner changing within a generation; close mode, asset or manifest changing (each `contradictory`, with the reason); latest deal number going back |
| Legitimate changes, accepted | Customer money moving at the same step; `set_manifest`; appointing operators; the real direct sale (ACCEPTING → CLOSED); a sale seen only after many skipped steps; a Gated close finalized by its closer. The app's owner never changes. |
| One snapshot | The three fixtures and a wrapped ring are coherent. Ten incoherent cases are refused as `malformed`. |
| Setup | Nine unsound option sets throw; `everstreetApi` with retention 0 throws |
| Updated | Two 003h tests whose synthetic data the contract can't produce were corrected to coherent data that still tests the same rule: an outcome rewritten at a later control step is still a `conflict`, and the wrapped-ring history gap is still reported. |

**Mutation checks** (each reverted):

| Mutant | Failing tests |
|---|---|
| The core digest and record include the month again | 4 |
| No same-step control comparison | 4 |
| No per-month stale rule | 1 |
| No 24-month cap | 1 |
| No setup validation | 1 |

The period is stripped from the core in two places. Removing just one of them changed nothing,
which I checked; removing both reproduces the original fault. The owner-only reproduction is also
refused by the one-snapshot rule (seller = owner), so it stays caught even with the same-step
comparison removed.

## Commands

```
npx vitest run server/test/v3-observe.test.ts  → 48 passed
npm run check        Test Files 35 passed (35); Tests 445 passed (445)
npm run web:build    built (existing chunk-size advisory only)
```

Rust wasn't rerun: no contract or fixture file changed (64 passed at `8d4bda8`).

## Still open

- **Trust.** The transport is still trusted for provenance, with no proof. No real transport, live
  read or UI exists.
- **Local databases.** Databases written by 003h code keep their old, period-including digests.
  These are local and test-only; there is no production wiring.
- **Not built:** reconciliation into app ownership, the managed closer, and flag clearing.

M3 stays open.
