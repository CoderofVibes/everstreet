# The digital business operating desk

**Why (Tony's words):** "I'm wanting something that feels like a web solution for the future AI
economy, not a plain webpage." The platform is for "AI tools, SaaS, websites, crypto solutions
on NEAR, online services, agents" with acquisition and customer continuity central.

## What the founder and buyer see

Make the business desk one coherent operating workspace for the digital product already built.
A founder arrives at a clear picture of the actual products, customer access, operating work,
usage/cost and ownership readiness. A buyer's first shift opens the same useful business desk.
Business history belongs to the business; customers' documents and unrelated private data do not.

At017617e Astra's browser shows a released Invoice Reader with8 actual recorded uses,3charged,
1settling and1reserved. Yet the top says Shaping, "You're all caught up" and "Nothing open.
Share your page"; the sidebar says "Your offer's title appears here", "Price not set", proposed,
date/place not set. "Edit in studio" opens the old /studio brief while real product work is
under /build. Useful charts occupy a narrow lower column below legacy sections. These are
observed contradictory surfaces, not a request to fabricate better-looking sample statistics.

## Experience

- Compact business header with published/private state distinct from product release and service
  availability. Keep a clear route to the actual product studio, and Acquisition/continuity visible.
  With multiple projects, show a choice rather than picking an arbitrary one. Preserve access
  to legacy offer editing under an accurately named action when applicable.
- Primary operating summary: products/releases/customer access; actual waiting work; customer
  use and cost highlights. Put the existing003t charts in a readable main canvas with responsive
  layout, not underneath unrelated empty panels. Avoid two competing period controls or totals.
- A useful product card: name from saved product/release with honest fallback; supported family;
  saved draft vs active release; active/retired offers; service configured/unknown status; obvious
  Open studio / Customer access / View public product actions where those capabilities exist.
  Published page alone cannot mean a working customer service. A saved brief cannot mean a release.
- Prioritized work from actual records: customer obligations requiring action, maintenance gaps,
  known release/access needs and unanswered inquiries. Separate waiting on a system from a task
  a founder can complete. Labels and links are enough when no mutation is implemented; never add
  fake checkboxes that settle units, restore authority, or complete an external transfer.
- Existing imported products, inquiries, manual tasks, costs, growth and legacy offerings remain
  reachable. Lead with digital operations for businesses that have them. A legacy class business
  must still work. Do not infer family solely from name, fixtures or business count.
- No blank generic offer card pretending to describe a working digital service. When a legacy
  offer also exists, identify it as that offering. A customer price may be exact contract base
  units and observed asset identity; do not invent dollar conversion or conflate a sale price.

## Checked implementation and requirements

`web/src/pages/Desk.tsx` currently renders STAGE_LABEL from the old business stage, summary from
manual tasks/inquiries only, links desk.project_id to/studio, and always renders OfferCard and
desk.missing in the sidebar. DeskProducts, DeskImports, DeskGrowth/DeskBooks, DeskSelling and
the existing operation/maintenance/release APIs are building blocks. Prefer one owner-safe
server projection where needed over an N+1 fanout across every product or fabricated client
joins. Bound results; preserve exact identity and ownership generations across async work.

Write a short layout/data design first. Reuse the token system, SVG charts, semantic controls and
existing routes. No broad rewrite or new library required. Source-backed status hierarchy is
more important than more cards. Keep technical diagnostics behind detail where useful.

- Counts/status must derive from current records and say when not read. No real-time guarantees
  from cached/readiness facts; no automatic calls to provider, wallet, chain writer or worker.
- Prevent private old-owner/business data reappearing after actor switch, access loss, late
  responses or route changes. Keep unsent inquiry replies across local panel changes. Respect
  dirty drafts and action recovery. No new buyer or public disclosure in this job.
- Existing exact unit settlement, old-owner revocation and customer access stay unchanged.
  No contract/main.ts/provider wiring changes. No publishing controls triggered by layout work.

## Done when

An isolated preview shows at least a digital business with active release/usage/known pending
work, a brief-only founder, multiple products, an imported product and a legacy offering. Use
real app records with clearly labelled fixtures, no invented activity presented as observation.
The digital desk no longer claims all caught up or displays an empty legacy offer as its product.
The founder can reach Studio, customer access, operations and acquisition without hunting.

Meaningful tests cover bounded owner projection, status contradictions, multi-product choice,
unknown/empty/retired states, actor/business switch and late access loss. Existing regression
suite remains passing. Verify1440/1280/390, keyboard and200%zoom when tools permit; report what
was actually checked. npm check/web build, local commit/report, then stop for Astra review.

P1/L after003t1. This is M1/M3/M5 integration, not milestone completion. Preserve M2 creation,
M4 source/runtime import, M5 demand/expert/operator/portfolio roadmap and M6 products/team/co-op.
No public push/release/submission, mainnet, real data, spending, signing/deploy, main/live wiring,
research library access/assessment or Day One. No routine design approval needed.

The separately pending Astra browser sale-intent action is outside this job; do not perform it
or substitute an API action to bypass its automatic-review rejection.
