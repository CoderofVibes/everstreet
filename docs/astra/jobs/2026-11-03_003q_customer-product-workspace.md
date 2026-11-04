# Give customers a real digital-product workspace

**Why (Tony's words):** "a great one stop shop for builders, investors, and clients in need of
services" for "AI tools, SaaS, websites, crypto solutions on NEAR, online services, agents".
The current My activity is booking-led and none of the new customer runtime is visible yet.

## What the person sees and does

Build a polished customer journey for the flagship document-to-data service using the actual
prepare/confirm/execute/result/settlement APIs. This is the first customer-facing integration,
not a static demonstration. Keep the broader AI studio/import/acquisition roadmap intact.

1. A public released product's page has an understandable Use product entry, a product summary,
   exact one-use terms, supported input and privacy/retention. Respect existing publication rules:
   private or unpublished businesses/offers are not exposed by guessing IDs. Existing customers
   can still find their own prior work when a product/offer retires.
2. A focused workspace: product identity and status, document composer, result area, recent
   requests, and compact unit summary with provenance/time. Desktop result area is generous;
   mobile uses a clear reading order. Use the existing ink/mint/neutral system with deliberate
   hierarchy, not a wall of diagnostic cards. Product previews/results should give visual value.
3. Prepare -> review consent -> authorize -> reserve -> run -> retrieve result -> settle/recover.
   Show one primary next action. Preparing never implies charging. Explain one reserved use,
   units consumed and available from actual observed evidence; don't sum snapshots into invented
   balances. Exact base units/asset stay exact when decimals are unknown. No fake dollar values.
4. The customer reviews input/product/release/units/price/retention before an authorization
   adapter is called. Browser code independently validates/recomputes the canonical envelope
   and input commitment before requesting signatures; never signs an opaque server hash blindly.
   No customer private key on server. Production signing/identity stays unavailable unless
   explicitly configured in a later authorized integration. Do not add live wallet transactions.
5. Result rendered as readable structured fields plus useful validation/refusal context. Optional
   JSON copy/download is customer-initiated and contains only that result. Unknown execution is
   never rerun automatically. Charge pending, returned and unknown have distinct plain language
   and explicit recovery actions; no button creates a second request to hide a lost response.
6. My activity gains My products/Recent uses ahead of legacy bookings, with durable resume links.
   Add bounded customer-only list/read endpoints where needed. Keep bookings/requests intact.
   Results and unsent document text must clear on account switch/access loss, and late responses
   must not populate another session. No private input/result/salt/signatures in localStorage,
   URLs, analytics or public page metadata. Durable opaque request IDs may be scoped to session.
7. Preserve typed-ahead text separately from accepted request recovery (reuse prior controller
   lessons). Reload, tabs/navigation and lost-response retries find the original request; strict
   response validation, request sequencing and explicit Check access for uncertain authorization.
   Unavailable provider/signing/storage or insufficient units is a useful truthful state.

## Underneath and preview

Use real routes with an injected client authorization adapter, unavailable by default. Add a
disposable local QA preview with fictional digital product, funded100 customer and scoped
preview-only synthetic authorization, scripted extractor, in-memory protected storage and
fixture-backed chain. Make simulated authorization/provider/chain unmistakable. Never ship a
test key or automatic synthetic signing fallback in the normal app bundle/configuration. The
preview must not require real wallet/model/RPC/credentials/runtime DB, and no network side effects.
Claude owns any scripts/config changes needed; no package changes without a concrete necessity.

Provide deterministic preview controls for lost prepare/confirm/execute/settle replies, storage
failure, expired/revoked hold, sale/identity switch, and unavailable adapters. Keep controls out
of production routes. Document exact launch and cleanup commands for Astra browser review.

Refresh stale Home capability/source copy where appropriate: provider costs can now be observed
in configured runtime records, not only entered by founders. Do not overstate unwired capability.
No public release and no fictitious published businesses in Tony's runtime state.

## Done when

- API/privacy/controller tests cover happy path and real error/recovery states, original request
  versus typed-ahead input, malformed envelopes/responses, exact retry, identity switching and
  retired/unpublished products. Every button has a real supported action or explicit unavailable
  explanation. One logical request causes one provider execution and one unit charge.
- Disposable preview demonstrates100 -> one successful use ->99 with result preserved after
  simulated sale, old/new owner unable to read private result, customer able to start next use.
  Actual contract proof remains separate; do not label the preview a live NEAR transaction.
- Keyboard, screen reader status, reduced motion, 1440/1280/390 layouts, long product names,
  long outputs and loading/error states considered. npm run check/web build pass. Report routes,
  limitations, exact commits and preview setup; stop for Astra browser review.

## Priority and boundaries

P0/L after003o1 corrections pass. No live wallet/provider/RPC wiring, signing/deployments,
spending/billing changes, public release/push, submission, real data, research assessment or
Day One. All six milestones stay open. Full creative walkthrough remains after full buildout.
