# 003k report: exact v3 acquisition intents and local reconciliation

Claude, 2026-11-03. Job: [003k](../jobs/2026-11-03_003k_v3-intents-and-reconciliation.md).

| Commit | What |
|---|---|
| `466392c` | Design, written before code: `docs/design/V3_RECONCILIATION.md` |
| `42d60c7` | `server/src/v3intents.ts` (new); read-only accessors in `v3observe.ts`; four routes in `app.ts`; `v3_intents` and `ownership.v3_intent_id` in `db.ts`; `server/test/v3-intents.test.ts` (new) |

Not touched: signing, live reads, `main.ts` and configuration, contracts, packages, and UI.

## What the views can and can't establish

**Proven from the views:**

- the deal's identity and terms, from `get_control.live_deal` when the intent is recorded;
- that this exact deal closed, from the outcome (or its immutable stored copy): its status,
  `seq`, `version`, `digest`, parties, price and `generation_after`;
- that no newer transfer happened, from current control: the generation and the owner.

**Not provable, so not attempted: recomputing the digest.** The contract's `digest_of` includes
`plan_count` and `min_reserve`, and neither is in the views read. So the bridge compares the
contract's own digests: the live deal's, kept in the intent, against the closed outcome's. No
second algorithm exists.

**Limits stated in the design:**

- Identity is the app's own `chain_accounts` records (person rows only, unique), not wallet proof.
  Local-preview accounts are fixtures.
- A close that scrolled out of the 8-entry ring before any observation answers `unavailable`
  (`history_gap`); it is never guessed.

## Behaviour

**Recording an intent** (`POST /api/businesses/:id/v3/intents`, current owner only):

- **Input.** Only `{ idempotency_key, deal_seq, version, digest }`. Every term, account and
  generation comes from the latest recorded observation. Caller-supplied buyer ids, accounts,
  network and contract are ignored (tested).
- **Refused:**
  - no evidence, flagged evidence, or a different source;
  - no live deal, or not this exact `seq`/`version`/`digest`;
  - a seller who isn't the viewer;
  - an unmapped buyer, a buyer that is a business row, or a buyer mapped to the seller;
  - over 20 intents.

  Each refusal has a code.
- **Idempotent.** An exact replay returns the same intent. A reused key with other input, or a
  second intent for the same deal version, is 409.

**Reconciling** (`POST .../v3/intents/:intent/reconcile`, the intent's seller or buyer only;
others get 404):

1. **Fresh evidence.** It reads through the observation service's trusted transport, and records
   the result through the normal observation rules, so no caller writes observations. Only
   `accepted` or `duplicate` evidence is used.
2. **The decision.** The answer is one of `pending`, `unavailable`, `conflict`, `ended`,
   `applied`, `already` or `superseded`, each with a code.
3. **Applying.** It applies only a `closed` outcome that matches the version, digest, seller,
   buyer, price and `generation_after = expected + 1`, while control is still at that generation
   with the buyer as owner.

**The commit is one local transaction:**

- a compare-and-set of the intent;
- the local owner, ownership-history count (the epoch) and newest generation, all rechecked;
- the owner moved, one ownership entry (with `v3_intent_id`, unique) and one `business.sold`
  event;
- what the seller set up ends, as in the v2 reconciler: the team, listing visibility, evidence
  access and personal value settings, and open v2 deals are voided;
- other recorded intents superseded.

The new ownership entry raises the local epoch, so in-flight seller requests are fenced by the
existing `stillControls`.

**Receipts.** A participant's receipt has the status, deal identity, target generation, the
outcome's control step and the applied time, and no business data. The current owner lists full
intents.

## Evidence (`server/test/v3-intents.test.ts`, 12 API tests)

The contract fixtures (`direct-accepting`, `direct-closed`) are views produced by the contract's
own unit test, using the actual methods: one deal, the same digest. Synthetic mutations are
labelled in the test and kept coherent with §4a.

| Area | What is shown |
|---|---|
| Recording | Terms from evidence; replay; `key_reused`; `already_recorded`; three mismatches; four invalid inputs; caller identity ignored; `never_observed`; non-owner and unrelated person 404; unmapped and business-row buyer refused; flagged evidence refused |
| Exact close (contract fixtures) | While live: `pending` with nothing changed. Then closed: applied by the buyer. Owner Noah; one ownership entry with `v3_intent_id` and the chain generation 2; one event; the team grant revoked; product revisions unchanged. The seller gets 404 on the project, the v3 view and the intent list; the buyer reads the project and sees `owner_match: matches`. The seller's receipt carries no business text, and an unrelated person gets 404. |
| Convergence | Two concurrent calls give one `applied` and one `already`; retries (a lost reply) give `already`; there is exactly one entry and one event |
| Restart | A file database closed and reopened between the intent and the reconcile, and again after: applied once, then `already` |
| Mismatches (synthetic) | Version, digest, price or buyer: `conflict` (`outcome_mismatch`), with authority unchanged |
| Ended (synthetic) | Cancelled, expired, aborted: `ended`, and stays `ended` |
| Newer transfer and gap (synthetic) | Resold to another account: `newer_transfer`. The ring wrapped past deal 1: `history_gap`. Nothing applied. |
| Evidence | Transport down: `unavailable` (no raw text). Mixed blocks; stale (older block); a same-block conflict, and afterwards a sticky flag that blocks even a genuine close. Authority unchanged throughout. |
| Identity and locality | A changed binding gives `binding_changed`; a buyer account relinked gives `mapping_changed`; local away-and-back after the intent gives `local_owner_changed` |
| In flight | A seller's v3 refresh waiting in the transport while the sale applies is denied (404) when it resumes |

**Mutation checks.** Each was run alone in a single-file run of about 1 s, then restored, the diff
inspected, then the full suite run:

| Mutant | Failing tests |
|---|---|
| No compare-and-set | 1 |
| No local-epoch check | 1, after tightening the test: it had passed through the generation check, so the away-and-back entries now carry no chain generation, isolating the epoch check |
| No digest comparison | 1 |

```
npm run check        Test Files 41 passed (41); Tests 548 passed (548)
npm run web:build    built (existing chunk-size advisory only)
```

Rust wasn't run: no fixture changed.

## Not covered by tests, or out of scope

- **Paths implemented but not exercised.** These follow the v2 reconciler's statements:
  - listing closure and the evidence-access revocation (the fixture has no listing);
  - the `superseded` path for other recorded intents;
  - seller denial specifically on imports, which use the same ownership check as the tested
    projects.
- **Customer records.** No entitlement rows exist in this fixture. Product revisions are shown
  unchanged; customer runtime continuity isn't touched.
- **Gated mode.** Only Direct closes are reconciled with contract fixtures. No Gated closed
  fixture exists yet.
- **Not built:** signing, a managed closer, close orders, a live endpoint, chain-identity
  attestation, a customer-admission state machine, a UI for intents, and external asset handover.
- **Atomicity.** NEAR and SQLite never change atomically. This is observed finality: a read, then
  one local transaction.

No live, production, 100/20/80 or M3 acceptance is claimed. Stopping here for Astra's review.
