# An investor portfolio connected to actual business ownership

P1/L. Queued M5 implementation after002e/003v/004b/005c, explicit dispatch only. Tony's vision
brings builders, investors and clients together, with NEAR acquisition and customer continuity
central. PLATFORM_VISION explicitly includes persistent buyer portfolios.

## The experience

A buyer has a persistent portfolio workspace: businesses currently managed, acquisitions still
being considered, and historical handovers. From one useful overview they can spot service or
handover work needing attention and open the business's own operating workspace. Their shortlist,
scoped due diligence and private acquisition notes stay usable without implying they own a target.
The workspace should feel like an investor's working view, not another catalogue of generic cards.

Each business shows released identity, the viewer's actual authority, acquisition receipt where
relevant, source-qualified performance and customer obligations, plus a concrete next action.
Let the viewer organize with persistent private labels/notes and filter by operating/readiness
state. Handle multiple owned products/businesses and partial failures without turning unknown
revenue or missing balances into zero. Do not invent portfolio valuation, yield or investment
recommendations. Separate currencies/assets, periods and evidence sources before any aggregation.

## Grounded starting points

- acquire.ts workspace returns buying-team identity/role/members, saved mandates, shortlist and
  evidence requests. The shortlist is filtered through current listing visibility.
- v3intents.ts mine returns bounded personal participant receipts and you_own_it_now; historical
  receipt access deliberately does not disclose the former business's private records.
- Desk already exposes the owned-business entry point and per-business operations/books.
- Buying-team membership is research/evidence/request authority; it is not ownership or a legal
  investment interest. A team representative's acquisition must not silently give every member
  owner access. Group ownership and cooperative governance remain separate M6 work.

Read the existing routes/schema/client authority before choosing data shapes. Reuse the current
owner and scoped evidence projections. A personal portfolio must not combine someone else's
private team assumptions or customer documents. Persistent organization belongs to its explicit
person/team scope, with an audit trail for access changes; notes do not automatically transfer
with a business. Source connections retain their separate grant/transfer semantics.

## Build and verify

Write a concrete composition/data-authority map, then implement durable storage, routes and UI,
with bounded pagination and request concurrency. Integration should connect existing receipts,
ownership, operating evidence, source readiness and acquisition tasks instead of copying a stale
parallel ledger. On a confirmed sale, management eligibility changes immediately; a former owner
keeps only permitted history. Removed team membership, ended data-room grants, account switching
and delayed reads clear private material; a team label never grants access.

Acceptance: one fictional person with two owned digital businesses, one scoped acquisition target
and one former business; reload preserves organization and notes. Each card/row opens its correct
source. A fresh sale adds management only after actual app reconciliation, former owner loses it,
customer rights remain intact, and limited team roles see only permitted data. Include exact-unit,
mixed-source/missing-data and one-business-failure cases. Actual1440/1280/390 keyboard/browser
review, meaningful route/concurrency/access tests, npm check/webbuild, local commit and report.
Real testnet/integration evidence is a separate gate; do not call synthetic fixtures live proof.

This is one M5 slice. Preserve all six milestones, including actual studio execution, connected
imports, additional product families, integrations, team/co-op controls and transfer rehearsals.
No signing/deploy/push/public release/submission/spending/real data/Day One/research access.
