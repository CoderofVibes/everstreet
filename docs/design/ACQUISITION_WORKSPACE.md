# Digital acquisition workspace (job 003s)

Claude, 2026-11-04. Authority: [003s](../astra/jobs/2026-11-04_003s_digital-acquisition-workspace.md).
Builds on [V3_RECONCILIATION.md](V3_RECONCILIATION.md), [V3_OBSERVATIONS.md](V3_OBSERVATIONS.md)
and [BUSINESS_V3_SALE.md](BUSINESS_V3_SALE.md). The backend authority and evidence rules are
unchanged.

Nothing here signs, pays, proposes, accepts or closes a sale on NEAR. There is no wallet, payment
control, live RPC or `main.ts` wiring.

## Routes and entry points

| Path | Who | What |
|---|---|---|
| `/desk/:id/handover` | The current owner | **Sale and handover**: what the contract shows, the sale's exact terms, recording that version, and applying the outcome |
| `/handovers` | Each participant | Their own handover receipts, with an explained "check the outcome and apply it here" |

The workspace is reached from:
- the business desk (a **Sale and handover** button);
- Ownership and continuity (a link; that page stays read-only);
- Activity (**Business handovers**, shown only when the person has receipts).

**Selling** (`/desk/:id/sale`, the v2 path) is unchanged for v2 businesses. For a v3-bound
business it shows a notice pointing to Sale and handover. It also hides "Propose these terms on
NEAR", so a v3 business is never routed through the earlier contract's signing. Discovery and
access requests there still apply.

**New API:** `GET /api/me/v3/handovers` returns the viewer's own receipts (seller or buyer), at
most 20, newest first. Each item has:
- the same minimal receipt as before, plus `business_id` and `recorded_at`;
- `business.name` only when the viewer owns the business now or its page is published (otherwise
  null);
- `you_own_it_now`.

Nothing else about the business is added, and nobody else's receipts are reachable.

## The progression, as facts

1. Sale terms observed on the contract.
2. The exact version recorded here.
3. The contract's outcome.
4. Applied here: the buyer manages the business.
5. The buyer's first steps.

Each step reads done, now or later, from the evidence and the intents. No label implies that this
page signed, paid or closed anything.

## Owner: review and record, without typing

- **Read the contract again.** This is `POST .../v3/refresh`, a deliberate action that records
  evidence and **never** reconciles.
- **Terms shown, from the evidence:**
  - the exact price in base units of the asset (no decimals or dollars);
  - the seller and buyer accounts;
  - the deal number and version, the state and who accepted;
  - the offer expiry and how the sale closes (Direct, or Gated by a named closer);
  - **authority the buyer receives:** the deal's operator grants and their capabilities. An
    account not listed, such as the platform's metering account, needs the new owner to appoint
    it;
  - **customer obligations that stay with the business:** prepaid unused and reserved in use.
  
  Under Technical details: the contract's own digest, the terms hash, the generation, the escrow
  and the floor. The digest is never recomputed.
- **Review this version, then Record this exact version.**
  - The request carries the seq, version and digest **from the evidence**.
  - A revised deal (a new version or digest) sets the review aside: refresh, then review again.
    Acceptance and escrow progress don't.
  - A lost answer keeps the exact record request apart from what is shown now, and offers
    **Recover my original request**. The pending request is in session storage (opaque key and
    deal identity only), so it can be recovered after a reload.
  - An answer naming another deal is treated as unanswered.
  - A 404 or `control_changed` leads to an access check: denied clears to the receipt view, and
    an inconclusive check pauses changes behind **Check access**.

## Participants: an explicit reconciliation

**Check the contract's outcome…** first lists what applying does, before anything runs:
- the app reads the contract again, and only an exactly matching close is applied;
- the business, its products, releases and customer offers move to the buyer, once;
- the seller's team, listing and data-room access end;
- customers keep everything, and nobody gains access to their records;
- domains, provider accounts and other external services are not handed over.

**Check the outcome and apply it here** then calls the existing `POST .../reconcile`. Its answers
(pending, unavailable, conflict, ended, superseded, applied, already) are shown as the server
states them. A lost or malformed reply says that checking again is safe; the server applies at
most once and answers `already`.

**After it applies:**
- **The seller's workspace clears.** Evidence, intents and review are gone. The page shows the
  ended-access message and their minimal receipt.
- **The buyer's receipt shows first steps:**
  1. check the ownership evidence;
  2. open the desk, then the studio's Service → Customer offer readiness, which shows whether the
     platform may meter uses;
  3. customers keep everything, and new uses wait for metering if the sale didn't grant it;
  4. what isn't handed over.
  
  There is no handover badge.

## Proof, kept apart

- **Contract fixtures** (`server/test/fixtures/v3`, produced by the business-v3 unit tests) prove
  the deal's identity, terms and closed outcome: `direct-accepting` → `direct-closed`, and
  `gated-closing` → `gated-closed`.
- **Synthetic edits are labelled:**
  - proposed (one control step earlier, no acceptances);
  - ended (cancelled, expired);
  - a revision;
  - a same-height conflict.
- **App tests** prove recording, receipts, privacy, explicit reconciliation (through the actual
  `reconcile`, never ownership SQL), the seller's lost access, the buyer's owner links and
  customer continuity:
  - the request, history and result stay with the customer;
  - the customer chain double's entitlement is unchanged;
  - neither owner reads customer content;
  - the next use fails closed until metering is appointed, then works.
- **Two synthetic sources in those tests:** the v3 observation transport and the customer chain
  double. They are kept coherent, and the double's after-sale control is contract-produced too.
- **Not proven:** a live sale, wallet or payment, or a real endpoint's chain identity. This is
  not all of M3.

## Qualified evidence (job 003s1)

- **When a reading can be recorded.** `reviewProblem(evidence)` decides whether the current
  reading can back a new record. These disqualify it:
  - no reading;
  - no live deal;
  - a **flag** (the backend refuses these as well);
  - a **stale** reading, older than the 10-minute freshness window: read the contract again
    first;
  - a chain owner that doesn't map to this business's owner here.
  
  The terms stay visible "as last read, for reference", with the reason. Review and Record are
  withheld, and a held review is dropped on reload. An unanswered record can still be recovered
  as the same request; the server decides.
- **A re-read of the same block** is answered `duplicate` and keeps its original reading time. A
  stale reading becomes current only from a newer block.
- **Refresh answers are parsed strictly** (`parseRefresh`). Only two forms are accepted:
  - `refused` with a code and no view;
  - a recording outcome (accepted, duplicate, stale, conflict, contradictory or source_changed)
    with its period and a valid view. The view must be observed for accepted/duplicate, and
    flagged for a conflict.
  
  Anything else is `refresh_malformed`: retryable, and the evidence shown is not replaced.
- **Deadlines are labelled against the reading.** The offer deadline (and a Gated closer's
  deadline) is marked "already passed when this was read" when it was. That says nothing about
  how the sale ended; only a later reading of the outcome does.

## Disposable preview

```
npm run web:build
npx tsx scripts/preview-acquisition.ts            (Direct: proposed → accepting → closed)
npx tsx scripts/preview-acquisition.ts --gated    (Gated: closing → closed)
```

The site runs on 127.0.0.1:8814 and the controls on :8815. It is built on the customer preview,
with a fictional business, one completed customer use and the synthetic page signer.

**Controls:**
- `POST /deal/proposed|accepting|closing|closed|cancelled|expired|conflict|unavailable` sets what
  the synthetic contract shows. It is recorded only when a person reads it in the app. `closed`
  also moves the customer chain double to the contract's after-sale control.
- `POST /metering/appoint` is the buyer's synthetic `appoint_operator`.
- `POST /lose/record` and `POST /lose/reconcile` make the server act and lose its answer.

People switch with the acting-context menu. The scenario is driven without a listener by
`server/test/acquisition-preview.test.ts`.

**Provenance and clock (003s1).**
- **Preview label.** Both previews serve `/__preview/label.js`, which sets
  `window.__everstreetPreview`. The app shell then shows a persistent amber strip:
  - here, "Preview only: synthetic sale evidence, customer chain and runtime";
  - in the customer preview, "…synthetic customer chain, runtime and signer".
  
  The app never sets it. It changes no behaviour and holds no key or signer.
- **Fixture clock.** The sale views are the contract tests' fixtures, and their digest-covered
  terms fix their times:
  - T0 = 2026-11-02T00:00Z;
  - Gated closer deadline T0 + 30 min;
  - offer open until 2026-11-03T00:00Z.
  
  They are read on a **fixture clock** that starts at T0 + 10 min and runs at real speed, so the
  readings are coherent with their own terms. The label states this. Customer uses keep this
  computer's clock. No fixture term was rewritten. After 20 minutes of a Gated preview, the
  closer's deadline correctly reads as passed.
