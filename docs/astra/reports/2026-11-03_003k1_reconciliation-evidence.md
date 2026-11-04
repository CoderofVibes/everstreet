# 003k1 report: exact outcome identity, and the missing reconciliation evidence

Claude, 2026-11-03. Job: [003k1](../jobs/2026-11-03_003k1_reconciliation-evidence.md).
Commit `4eb2f6a`.

**Files:**

- `server/src/v3intents.ts`
- `docs/design/V3_RECONCILIATION.md`, §4 table
- `server/test/v3-intents.test.ts`
- `server/test/v3-intents-effects.test.ts` (new)
- `server/test/deal-world.ts`: optional store and v3 options; existing callers unchanged
- `contracts/business-v3/src/tests.rs`: fixture test only, no behaviour change
- `server/test/fixtures/v3/gated-closed.json` (new)

## The finding, reproduced first

Astra's corrected, coherent probe went into a test, run against `70bc241`:

- an intent for seq 1, version 1, digest A;
- an observed `cancelled` outcome at version 2, with digest `f…`, `generation_after` 1, the owner
  `founder.near` at generation 1, and operators at generation 1.

It returned `ended` and marked the version-1 intent ended. The same-version outcomes with a
different digest, price, seller or buyer were also wrongly `ended`. Three tests failed.

Astra's first probe, with an inconsistent operator generation, is malformed and is rightly
refused by the reader. I didn't use it.

## The correction

Identity is compared before **any** terminal state. Versions only rise while a deal is live
(`revise_sale`), so:

| Outcome observed | Result |
|---|---|
| A later version than the intent | `superseded`, code `revised_then_<status>`. The recorded version was revised away, then that version ended or closed. It is never called the recorded terms' outcome. |
| An earlier version, or the same version with another digest, party or price | `conflict`. The intent stays `recorded`. |
| An exact `cancelled`, `expired` or `aborted` match | `ended`, but only when `generation_after` equals the expected generation, as `terminate` keeps it |
| An exact `closed` match | Applied, with `generation_after = expected + 1` (unchanged) |

A terminal answer (`ended` or `superseded`) now reads back the stored status after its
compare-and-set, so concurrent calls agree with what is recorded.

**The compare-and-set race.** I tried to reproduce the hypothesised "already for a terminal row"
race on the apply path, and couldn't make it happen. A compare-and-set to `applied` can only lose
to another apply of the **same** intent. Another intent can only supersede it if *that* intent
matches the closed outcome, and the unique `(seq, version)` constraint rules that out. So the apply
path's `already` is accurate, and I left it unchanged. The reachable concurrent cases are tested
(below).

## Evidence

**Contract fixture.** `gated-closed.json` is produced by the contract's own methods. In the
existing `serialized_views_match_server_fixtures`, after `gated-closing`, the configured closer
calls `close_sale(order())`. The result is checked in the test: owner `buyer.near`, generation 2,
no live deal. It was generated once with `UPDATE_V3_FIXTURES=1` and then verified against the
committed file. The closed outcome's digest equals the closing deal's (`7fae…`), at control step 8.

```
WSL cargo test -p business-v3 --lib    → 64 passed
WSL cargo clippy -p business-v3 --all-targets  → 0 warnings
```

**App API tests.** These run on contract fixtures plus labelled, coherent synthetic mutations:

| Test | What is shown |
|---|---|
| The reproduction | `superseded` / `revised_then_cancelled`. Authority is unchanged, and a later call agrees. |
| Expired and aborted after a revision | Both `superseded` |
| 12 same-version mismatches | `cancelled`, `expired` and `aborted`, each with a changed digest, price, seller or buyer: all `conflict`, with the intent still `recorded` |
| A genuine exact cancelled outcome | `ended` |
| A closed outcome at a later version (from 003k, updated) | Now `superseded` / `revised_then_closed`; authority unchanged |
| A Gated close (contract fixtures) | Intent recorded from the closing deal with mode `gated` and closer `closer.near`. `pending` (`deal_closing`), then applied once with target generation 2 and control step 8. |
| Two intents across a revision (v1 from the fixture; synthetic v2 revised then closed), reconciled concurrently | v2 applied, v1 superseded. Repeats are stable: `superseded`, then `already`. One ownership entry, for v2 only. |
| Three concurrent reconciles of one exactly ending intent | All `ended` |
| Migration on a populated older file database (an `ownership` table without `v3_intent_id`, two rows) | Opened twice: the column is added as nullable, the rows are kept with null, both unique indexes exist, and the second open changes nothing. A second entry for one intent is refused as UNIQUE. Cleanup closes every handle in `finally`. |

**Effects through real routes** (`v3-intents-effects.test.ts`). The v3 evidence is contract
fixtures; the evidence room runs on the FakeChain double. The setup:

- two published businesses with payments on, each listed privately;
- a granted request for Noah's team and a pending one for Ana's team on the sold business, and a
  grant on the other business;
- a saved import with its first inspection and report;
- a customer's (Lena's) inquiry.

Results:

| What | Result |
|---|---|
| An evidence-room read by the buyer's team, held inside its monthly reads while the sale applies | Comes back not 200, with no evidence fields |
| The listing | `closed` |
| The granted request | `revoked`, `access_version + 1` |
| The pending request | `withdrawn`, `access_version + 1` |
| The room afterwards | Refused |
| The other business | Listing `private`, its grant and access version unchanged, and its room still 200 |
| The import and report | The seller gets 404 on both. The buyer gets 200, and the report is byte-identical. The workspace row is unchanged. |
| The customer's inquiry | The row is exactly unchanged. Lena's activity is unchanged. It now appears in the buyer's inbox, not the seller's. |

**Mutation check:** with the granted-access revocation removed, the effects test fails. Each
mutation was run alone in a single-file run, restored, and the diff inspected before the full
suite.

```
npm run check        Test Files 42 passed (42); Tests 561 passed (561)
npm run web:build    built (existing chunk-size advisory only)
```

No test database files are left.

## Limits

- **Customer records.** These are app records (an inquiry). They don't prove customer runtime
  continuity or NEAR credits; that's 003l's subject.
- **The FakeChain double.** It powers the evidence room's monthly reads. The v3 evidence is
  separate, and comes from contract fixtures.
- **Not built.** Still not built: signing, a managed closer, live reads, a UI for intents, external
  asset handover, M3.
