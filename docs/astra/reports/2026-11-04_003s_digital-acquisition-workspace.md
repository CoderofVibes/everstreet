# 003s report: digital acquisition workspace

Claude, 2026-11-04. Job: [003s](../jobs/2026-11-04_003s_digital-acquisition-workspace.md).
Commit `102a7a7`, after 003r1 (`504c4f5`, report `7b5d474`). Not pushed. No contract change; Rust
was not rerun. Design: [ACQUISITION_WORKSPACE.md](../../design/ACQUISITION_WORKSPACE.md).

## What a person sees

**Owner** (`/desk/:id/handover`, from the desk's **Sale and handover**, or from Ownership and
continuity):
- A five-step progression stated as facts. Each step reads done, now or later:
  1. terms observed;
  2. exact version recorded;
  3. the contract's outcome;
  4. applied here;
  5. the buyer's first steps.
- **Read the contract again**, which records evidence and never applies a sale.
- The sale's exact terms:
  - price in base units of the asset;
  - seller and buyer accounts;
  - deal number and version, state and acceptances;
  - offer expiry and close mode (Direct, or Gated by a named closer);
  - **authority the buyer receives** (operator grants);
  - **customer obligations that stay with the business**.
  
  Digests, terms hash, generation, escrow and floor are under Technical details.
- **Review this version**, then **Record this exact version**. The deal identity comes from the
  evidence, so nothing is typed.
- Recorded versions, each with **Check the contract's outcome…**. That first shows what applying
  would do, then asks for **Check the outcome and apply it here**.

**Participants** (`/handovers`, from Activity → Business handovers):
- Their own minimal receipts. The business is named only if it is published or they own it now.
- The same explained two-step apply.
- After it applies, the buyer sees first steps:
  1. ownership evidence;
  2. desk → studio Service → Customer offer readiness, including whether the platform may meter
     uses;
  3. customers keep everything, and new uses wait for metering if it wasn't granted;
  4. what isn't handed over.
- The seller sees that their access ended and keeps their receipt. The owner workspace clears to
  the same.

**Selling (v2).** It works as before. For a v3-bound business it shows a notice pointing to Sale
and handover, and hides "Propose these terms on NEAR". Discovery and access requests are
unchanged.

## Underneath

- **Backend rules unchanged.** Recording, reconciliation and the authority rules are not
  modified.
- **One narrow API addition:** `GET /api/me/v3/handovers`, the viewer's own receipts, at most 20.
  - The receipt gained `business_id` and `recorded_at`.
  - The name is disclosed only to the current owner, or when the page is published.
  - It was not broadened in any other way: buyers get no terms or business data before the sale.
- **Browser modules:**
  - `web/src/handoverApi.ts`: strict parsers; amounts and heights stay decimal strings.
  - `web/src/handover.ts`: the `OwnerHandover` and `Handovers` controllers.
  - `web/src/pages/Handover.tsx`: the pages.
- **Behaviours:**
  - **Generations.** Late answers are dropped by a generation counter, and routes are keyed by
    person.
  - **Lost record answers.** The exact record request is kept apart from what is shown now and
    recovered with the same key, also after a reload (session storage holds only the opaque key
    and the deal identity). A record answer naming another deal is treated as unanswered.
  - **Reviews.** Kept only while the observed seq, version and contract digest match.
  - **Access checks.** A 404 or `control_changed` leads to one: denied gives the receipt view, an
    inconclusive check pauses changes behind **Check access**.
  - **Reconcile replies.** A lost or malformed reply says that checking again is safe; the server
    answers `already`.

## Checks

- `npm run check`: Biome and `tsc` clean, **747 tests in 62 files** (734/60 at 003r1).
- `npm run web:build`: built. The bundle scan found no preview key, preview signer route or seed
  helper.
- **`web/test/handover.test.ts`** (11, real API, controllers):
  - read, review and record without typing; reads and refreshes never apply;
  - revised terms need a fresh review;
  - a lost record answer (network / 502 / malformed) recovered as one intent, also after a
    reload;
  - an answer naming another deal's seq, version or digest stays recoverable;
  - **the whole journey**, through the actual `reconcile`:
    - a customer use;
    - a recorded intent;
    - the buyer's receipt (minimal; loading never reconciles; the first click only explains);
    - pending, then the contract-fixture close;
    - a lost reply, then `already`;
    - one ownership entry naming the intent;
    - the seller's page clears to the receipt, and their owner links return 404;
    - the buyer's owner links work;
    - the customer's request, history, result and entitlement unchanged, with neither owner
      reading them;
    - the next use refused until metering is appointed, then a full use works;
  - receipts private to participants; an unpublished business isn't named; public business and
    offer JSON contain no buyer account, price, intent or digest;
  - a malformed reconcile answer changes nothing.
- **`server/test/acquisition-preview.test.ts`** (2), the preview through its site:
  - Direct: proposed, accepting, unavailable, a lost record, a lost reconcile reply, then closed
    and applied once, with customer continuity and metering appointment;
  - conflict and cancelled change nothing;
  - Gated: closing, then closed.
- **Shared fixture transport:** `server/test/v3-fixture-transport.ts`. Synthetic states are
  labelled. "Proposed" is one control step earlier, so the reader's coherence rules hold.
- **What the evidence proves:**
  - contract fixtures prove the deal's identity, terms and outcome;
  - app tests prove recording, receipts, privacy, reconciliation and continuity in the app;
  - two synthetic sources (the v3 observation transport and the customer chain double) are kept
    coherent; the double's after-sale control is contract-produced.
- **Mutants**, one at a time, each restored, with the diff inspected before running. All 6 were
  killed:
  1. receipt always names the business;
  2. receipt list not person-scoped;
  3. a stale review is kept after a revision;
  4. record answer identity unchecked: **survived** at first. The 3 added tests kill it;
  5. apply without the confirming click;
  6. lost access keeps the intents: **survived** at first. The strengthened journey test kills
     it.
- **Behaviour fix found while testing mutants:** the review now drops only on an identity
  change, not on acceptance progress.

## Preview for Astra

```
npm run web:build
npx tsx scripts/preview-acquisition.ts            # Direct
npx tsx scripts/preview-acquisition.ts --gated    # Gated
```

The site runs on `127.0.0.1:8814` and the controls on `:8815`. They were not launched this
session, and no listener is running.
1. As Ava, open `/desk/<business>/handover` (the id is printed at start). **Read the contract
   again**, review, then record. Optionally `POST :8815/lose/record` first, then recover.
2. `POST /deal/accepting`. Read again: the review survives, because only progress changed.
3. As Noah, open `/handovers`, then Check outcome → apply: pending.
4. `POST /deal/closed` (optionally `/lose/reconcile` first), then apply again: applied, or
   already after a lost reply.
5. As Ava, the workspace shows ended access and the receipt.
6. As Cara, `/uses/<id>`: the result is still there.
7. A new use is refused until `POST /metering/appoint`.

Also try `/deal/conflict`, `/deal/unavailable`, `/deal/cancelled`, a person switch, and the
desk's Selling page notice.

## Not done / limits

- **Not browser-verified here:** the 1440/1280/390 layouts, keyboard, focus and announcements.
  The structure is in place: labelled sections, `role="status"`/`alert`, facts grids that
  collapse under 760 px, and long accounts and amounts that wrap.
- **No live chain actions:** no wallet, proposal, acceptance, payment or closing on NEAR. No live
  RPC, no `main.ts` wiring. The endpoint's chain identity is still trusted, as in 003h.
- **Buyer before the sale:** sees only the minimal receipt. Richer pre-sale terms for buyers
  would need an explicit participant authorization, which isn't built.
- **External assets:** domains, provider accounts and secrets aren't transferred and aren't shown
  as transferred.
- **Milestones:** not the live purchase flow and not all of M3. All six milestones stay open.
