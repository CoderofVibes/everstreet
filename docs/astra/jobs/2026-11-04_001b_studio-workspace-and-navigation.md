# Make the growing platform feel like a coherent builder workspace

**Why (Tony's words):** "something that feels like a web solution for the future AI economy,
not a plain webpage" and people who haven't figured out prompting should be able to build here.

## Direction

The platform now has useful studio/runtime, customer, offer and handover capabilities. Reconnect
them into a legible working environment rather than continuing to append panels. This is a
bounded M1/M2 experience integration pass, preserving the existing product and authority rules.
Keep the ink navigation, bright canvas, electric mint and data-blue visual system; visual value
comes from actual product work, structured output and operational facts, not decorative gradients.

## What the person sees and does

### Global navigation and phone layout

At390px the full wrapped navigation occupies about285px, then acting context takes another55px,
before any useful page content. Replace this with a compact mobile top bar and accessible
navigation disclosure/drawer, keeping the primary task visible early. Keep actor identity easy
to inspect and change. Every existing route stays reachable: build/import, businesses, customer
activity, discovery/opportunities and acquisitions. Handovers should be findable without knowing
its URL. Desktop keeps a purposeful rail; don't add duplicated navigation bars.

Keyboard behavior matters: labelled toggle, expanded state, Escape/close, focus management and
return, visible focus, route-change close, no hidden interactive items in the tab order. Avoid
scroll traps and content covered by fixed controls; use44px-class touch targets. Environment and
synthetic-preview qualification stay readable in a compact strip, not removed to gain space.

### Studio: distinct creation and operation tasks

Current ProductStudio always gives the left Assistant/brief editor a large column even when
Service is selected. In the actual desktop offer screenshot that column becomes a tall blank
region with Save revision at the bottom while release, trials, checks, readiness and offers
compete in a long narrow right column. Give operational views enough canvas and preserve a
clear way back to creation. Use a task-aware layout: conversation/editor beside working preview
while shaping, generous canvas for builds/service/continuity, with the editor available through
a deliberate panel control. Do not unmount stateful controllers just to change their layout.

Organize Service into comprehensible tasks such as Try, Evaluate/release and Customer access,
with the active version and runtime budget visible where decisions require them. Use one clear
primary next step for the chosen task. Offer readiness can have a compact summary and details;
do not make all configuration rows permanently dominate the workspace. Never hide an unresolved
run, pending create, lost-response recovery or access warning by changing tabs.

### Version and capability truth

ProductStudio.tsx currently hardcodes a project-wide "Prototype" chip and relies on brief-only
steps even while Service has an active tested release. Clearly separate the editable brief/
prototype revision, generated candidate, tested artifact and active released product. Show only
states supported by real records. An active managed release is not proof of live provider,
wallet or network connection. A newly edited brief must not relabel the deployed artifact or
make an unchanged release look updated. Give each displayed version a clear source/action.

A founder should understand where they are and how to advance: saved brief, actual build state,
latest evaluation, active release, customer offer readiness, handover readiness. Use a compact
stage/work summary with links to the actual existing actions; do not invent completed stages
from a single boolean. Pending/unavailable states should explain the one useful next step.

An owner or buyer coming from the business desk/receipt should reach the relevant product and
customer access without searching a long Service page. Keep acquisition and customer continuity
visible as parts of the business, not hidden technical features. No auto-publication or auto-run.

## Underneath

Read App.tsx, ProductStudio.tsx, Service.tsx, CustomerOffers.tsx and existing state controllers/
style tokens. Reuse exact endpoints and their owner fences. If an aggregate status projection is
needed, make it bounded, owner-only and derived from existing records, with explicit provenance
and unknowns; never include private customer input/results. No secrets or live integration.

Preserve accepted brief versions, unsaved drafts, typed-ahead text, conversation outbox, runtime
trials/results, pending offer recovery and history selection across task/layout changes. Previous
002b2/002c1 panel continuity fixes must remain effective. Person/project/ownership changes still
clear private state; delayed answers cannot reappear under another actor. No private customer
data in browser storage. Keep existing import and v2 booking/commerce flows usable.

Use small native CSS/SVG/icon work within the existing system. No new branding, fonts/assets
from external services, packages or generated visual dependencies are needed. Update the design
note to describe the final interaction and exact remaining capability gaps, not a marketing claim.

## Done when

- New founder can orient in the studio, change creation/operation tasks, reopen drafts and
  accepted versions, and find the next actual action without a terminal or knowledge of IDs.
- A tested active release coexists truthfully with an editable prototype revision. Failed/
  unavailable build/evaluation/runtime state never shows as launched. Status rechecks on actual
  events/navigation without unbounded polling or repeated remote calls.
- Service trials, release checks, customer offer inspection/create/recover/retire and continuity
  remain accessible; switching views with pending work preserves it. Buyer first-step entry
  points reach the correct authorized page. Existing customer and acquisition workflows stay intact.
- Desktop1440/1280 and mobile390 are ready for Astra's visual review. Global mobile nav no longer
  pushes the task below a wall of links. Long names/exact amounts and200% zoom remain usable.
- Meaningful controller/integration checks cover state continuity and capability projection;
  do not write superficial tests for CSS. npm run check/web:build pass. Provide a disposable
  fictional preview with representative draft, failed/candidate/released and unavailable states,
  using existing preview infrastructure where possible. No live sources or runtime DB.
- Report routes/controls, exact commits and limitations; stop for Astra review. This does not
  complete M1 or M2 without the remaining independent gates. All six milestones remain open.

P1/L after003s1. No signing/deploy/live provider/RPC, spending/billing, push/public release,
submission, real data, research access/assessment or Day One. Preserve the complete roadmap.
