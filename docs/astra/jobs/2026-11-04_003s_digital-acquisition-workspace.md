# Make exact digital-business handover visible to seller and buyer

**Why (Tony's words):** "One key function of Everstreet is the seamless purchase and transfer
of business/product to the investor/acquirer, on NEAR. So, that has to stay central".

## What the person sees and does

Connect the existing v3 intent/reconciliation capability to a focused acquisition workspace.
The owner sees an observed sale's exact terms, deliberately records that exact version, and can
open a durable handover record. Both recorded participants can check its receipt and deliberately
reconcile the observed result. A matching closed sale transfers application administration once;
pending/unknown/conflicting evidence explains what remains and changes no authority.

Design a clear progression: terms observed -> exact version recorded -> waiting for contract
outcome -> application handover -> buyer's first operating steps. Labels must describe facts,
not imply a sale was signed, paid or closed by this page. Separate the NEAR outcome from applying
that outcome here. A deliberate action must explain its local ownership/access effects before
it runs; opening a page, receipt or refreshing evidence must never reconcile implicitly.

Use existing owner Continuity and business desk as entry points, with visible links to the
new workspace and participant receipt. Preserve existing v2 acquisition flows and distinguish
their supported contract version; don't silently route v3 businesses through v2 signing paths.
No new wallet/payment controls in this slice. Where chain proposal/acceptance/payment is not
connected, say so plainly and retain the meaningful review/record/reconcile work that exists.

Present exact price/asset, seller/buyer account, deal version, expiry/window, customer obligations
and inherited authority where the evidence actually exposes them. Do not recompute the v3 digest
from incomplete views or invent a complete transfer inventory. Operational evidence is scoped:
projects/releases/offers survive; external domains, provider accounts and secrets require their
own verified transfer. Customer results/documents never appear in seller/buyer evidence.

After applied/ already-applied, the seller sees only the authorized minimal receipt and clear
ended-access message; the buyer can follow normal authorized links to the business desk, studio,
customer offers and continuity. First-shift steps reflect actual readiness; no universal green
handover badge. Customer access and units must remain unchanged by application reconciliation.

## Underneath (checked at c184025)

Read docs/design/V3_RECONCILIATION.md, V3_OBSERVATIONS.md, BUSINESS_V3_SALE.md and relevant tests.
app.ts has owner list/create v3 intents, participant read and reconcile. v3intents.ts stores exact
observed seq/version/digest and terms; receipt() is intentionally minimal. Continuity.tsx is
currently read-only; do not turn its refresh into reconciliation. No v3 workspace exists yet.

Use strict API/controller parsing, exact request idempotency, session/person/business fencing,
original request recovery apart from changed selections, and actionable failed/malformed/access
recheck states. Persist only safe opaque request identifiers where needed. Participant receipt
must not depend on a now-forbidden owner endpoint. Before giving a buyer richer terms, establish
the narrow participant authorization explicitly and preserve post-sale minimal receipt policy;
otherwise show only the existing permitted receipt. No arbitrary app identity or supplied chain
account can grant access. Any bounded server projection needed must enforce this at the API.

Keep current backend authority/evidence rules; strengthen a demonstrated integration gap rather
than broadening scope silently. Never sign or send a transaction. No live RPC/provider/main.ts
wiring. Provide a disposable loopback preview of the REAL APIs with clearly synthetic observed
sale states and outcomes seeded from existing contract fixtures. It must support proposed,
closing, applied, ended, conflicting/unavailable, lost record/reconcile replies, identity switch
and the customer continuity check. Keep state changes in separate preview controls, not product
buttons that pretend to close a NEAR sale. No Tony runtime DB or actual credentials.

## Done when

- Owner can inspect an exact observed deal and record it without typing hashes or IDs; changed
  terms force fresh review. Reload and lost answers recover the same intent. No automatic close.
- Participant receipt survives sale and reload without exposing successor private data. Exact
  reconcile applies once; duplicate/lost reply gives the same result; stale/malformed/conflict/
  cancelled/superseded evidence grants nothing. Buyer links work; seller owner links are denied.
- A synthetic integration journey preserves customer's offer/request/history/result and unit
  balance across the actual app reconciliation path (not direct ownership SQL). Neither owner
  reads private customer content. State explicitly what contract fixtures versus app tests prove.
- No private sale intentions leak through customer discovery, and v2 paths remain functional.
- Keyboard/status announcements,1440/1280/390 layouts, long account names and exact amounts
  are considered. Terms/next action lead; diagnostics are expandable. No wall of raw JSON.
- npm run check/web:build pass; report exact commits, routes, preview controls and limitations;
  stop for Astra browser review. Do not claim the live purchase flow or fullM3 is complete.

P1/L after003r1. Preserve all six milestones and approachable AI creation/import, operating
network and digital product families. No signing, deploy, spending/billing changes, push/public
release, submission, real data, research access/assessment or Day One.
