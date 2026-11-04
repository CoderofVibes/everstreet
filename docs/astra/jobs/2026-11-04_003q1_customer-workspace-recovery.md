# Customer workspace: recover the original request and tell the truth about units

**Why (Tony's words):** "clients in need of services" must be able to use digital products,
and acquisition must happen "without breaking customer obligations" (platform promise).

## What the person sees and does

The customer can recover a lost preparation answer while writing their next document. The
original request, the current draft, and the contract's unit outcome remain separate. A request
that was only prepared must never be described as reserved. A completed charged request should
read as completed, not announce an active signed hold. Preserve the one-primary-action design.

## Independently reproduced at d45690d

Disposable scripts/preview-customer.ts, real routes with explicitly synthetic adapters:

1. Cara opens Ledgerline's Invoice reader, pastes a fictional invoice, clicks Review one use.
   Prepared consent correctly says nothing is held yet, but Your unit and Recent uses both say
   one unit reserved. Source: customerUse.unitsView returns reserved_awaiting_settlement for
   every request without a settlement row. Include cancelled/expired/refused/unknown states
   in the fix; absence of a settlement is not reservation evidence.
2. Successful authorize -> run -> show -> settle twice confirms 99 free/1 used. Reload the
   durable /uses/:id link: title remains Reserved and says the contract shows the signed hold,
   while Your unit says used. The headline must compose reservation, execution and settlement
   states without overwriting the protocol's historical facts or inventing current balances.
3. Start another use, paste document A, POST the isolated preview control /lose/prepare, Review.
   It reports the lost answer. Change the composer to document B, click Review again: "Another
   request of yours is still in progress". No original-request recovery action is visible.
   prepare() chooses a new key whenever pending.text !== draft, overwriting the recovery key.
   Reload clears the draft and shows a blank new composer; the original prepared request is
   only discoverable manually in Recent uses. Before reload that list was stale. Same-text
   retry alone does not satisfy acceptance. Test network errors, post-commit 502, malformed
   replies, blank/oversized typed-ahead text, reload and navigation. Never persist private text.
4. Public /b/ledgerline offers "Use a product / Invoice reader" yet says "No offer published
   yet" below. Suppress or clarify the legacy offer empty state when a digital offer exists.
   Do not infer business readiness from having an offer or silently publish anything.

## Underneath

Use explicit preparation/unknown/reserved/terminal unit projections in server responses, strict
parsers, activity labels and workspace presentation. Keep evidence provenance and timestamps.
For uncertain preparation retain the original exact request in memory separately from the draft,
with a clearly labelled recover-original action independent of current draft validation. Reload
recovery can use an owner-scoped opaque key lookup or the own-request list, with exact matching;
do not guess by product/title or disclose another person's record. An unanswered attempt must
not be silently replaced. If original input is needed after reload, ask to paste the same
document and verify its commitment before authorization. Keep all private data out of storage.

Handle denied sessionStorage writes without leaving actions permanently busy or losing the only
recoverable server ID; this is a source-review follow-up, not a reproduced browser failure.
Recheck final unit/readback and request consistency before exposing next-use actions. No
automatic provider redispatch, duplicate charge, or recovery by creating another request.

## Done when

- Reproduce findings first; finite deterministic API/controller tests distinguish preparation,
  reservation pending/unknown, cancellation, expiration, charged/returned/conflict and a lost
  reply with a changed draft. Include sessionStorage denied, reload, access loss and late answers.
- Recovery finds the same accepted ID and preserves the separate typed-ahead draft in-session.
  No duplicate hold/execution/charge; no private browser persistence. Owner and buyer cannot read
  customer results. Retired products still allow own-history recovery.
- Customer statuses agree across workspace and Activity. Prepared means no unit held; terminal
  settlement isn't described as currently reserved. Public digital offers have no contrary empty
  state. Narrow/desktop reading order and status announcements remain usable.
- npm run check/web:build pass; report exact commits and preview steps. Proceed to003r only after
  these corrections and focused regression checks pass. Astra repeats the browser review later.

P0/M. No contract change expected; Claude owns any needed script changes. No live wiring, signing,
deploy, spending, push, public release, research access or Day One. All six milestones stay open.
