# From a tested release to a customer offer

**Why (Tony's words):** give people "a good solution for building within a platform that will
then showcase their product". A founder should not need API calls to connect a tested release
to its customers; the same business and customer commitments must survive its acquisition.

## What the person sees and does

Add a focused customer-offer section to the product studio's Service area, connected to the
existing owner offer APIs. Show the active released product, exact customer terms and retention,
what remains unconfigured, and existing active/retired offers. Let an authorized founder review
and create a local offer for an existing NEAR plan, then open its customer page. Retirement stops
new uses while existing customers retain their work and the applicable obligations.

Distinguish a tested release, a configured customer offer, business publication and an operating
service. An offer is not proof that wallet identity, provider, protected storage, metering or
network connectivity is live. No all-green launch badge based only on local rows. Use an ordered
readiness summary with observed/configured/unavailable/unknown evidence and a concrete next step.

Offer setup should use readable product/version and plan summaries, exact price/asset, retention
and evidence time before confirmation. Choose among bounded known plans when verified records
exist; if there is no plan-list capability, provide an explicit plan-number inspector with its
observed summary rather than guessing or unbounded scanning. Keep technical IDs in details.
Never invent token decimals or turn a base-unit amount into dollars. Retention is an actual
enforced policy, not free copy. No automatic publication or external integration changes.

## Underneath (checked at d45690d)

Owner GET/POST /api/businesses/:id/customer-offers and POST .../:offer/retire exist in app.ts.
customerUse.createOffer requires active release, plan id, retention and idempotency key; freezes
the release/digest/plan/binding and fences control across its read. Service.tsx currently covers
owner trials/evaluations/releases, but has no customer-offer UI. Public customer entry now exists.

Add only bounded, owner-authorized readiness/plan-preview data needed for the UI. Reuse existing
bindings/readers/runtime facts; no live connections in main, no new signer, no contract changes.
Do not expose provider credentials or customer documents/results to either owner. Readiness must
not imply plan existence or current terms from stale, malformed, conflicting or cross-binding
evidence. Recheck exact release, binding, owner epoch and inspected terms at the create boundary
after awaits. A changed plan must require a fresh review, not silently change the offer's terms.
Keep all mutation actions idempotent, recover the original request after lost responses and keep
the unsaved draft separate. Retire actions target the exact offer and are safely repeatable.

On sale old-owner controls/data clear, late responses land nowhere and the buyer can manage the
business's existing offers under enforced ownership. Existing customer request/results stay
customer-only. A retired offer must not be reactivated by a retry. Scope any necessary API fixes
and migrations narrowly, with meaningful tests. Missing real adapters are explicit unavailable
states with reviewable next steps, not a demand to enter credentials in the app.

## Done when

- Founder can review a released version and inspected existing plan, choose retention, create
  one exact offer, reopen it after reload and reach the actual customer workspace. The page
  separates local configuration from live readiness. Active/retired state persists correctly.
- Lost response + edited draft retains original recovery; malformed responses/check-access
  failures settle to useful retryable states. Release/plan/binding/ownership changes during
  inspection or creation cannot publish stale or unreviewed terms. New owner gains management;
  former owner and all owners remain excluded from private customer records.
- Tests cover missing adapters, invalid/aged/contradictory evidence, duplicate submission,
  retirement/retry, reload and identity/control changes. Use finite independent resource caps.
- Extend the isolated fictional customer preview so Astra can exercise founder setup -> customer
  use -> retire -> own-history recovery -> simulated sale. Label synthetic chain/provider/signing
  distinctly. Preview only, no real wallet/model/RPC/keys/runtime DB or external calls.
- Desktop1280/1440 and mobile390, keyboard/focus/status messages and long names/terms work.
  npm run check/web:build pass; report routes, preview controls, exact commits and remaining gates.
  Stop for Astra review before any live integration or broader next implementation.

P1/M-L after003q1. Preserve all six milestones, approachable AI creation/import, digital discovery,
NEAR acquisition and customer continuity. No signing/deploy, external publication/push, new
spending or billing, submission, real data, research assessment/access or Day One.
