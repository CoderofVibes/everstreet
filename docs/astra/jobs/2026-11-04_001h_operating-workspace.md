# A focused operating workspace with readable performance

**Why (Tony):** The financial performance page should be impressive and useful, with charts and
graphs; the approved UI direction calls for a distinct, calm operating workspace.

## What the person sees and does

The business overview answers: what is running, what needs action, what customers are receiving,
and what it costs. A compact business identity and stable local navigation lead to an overview,
performance, products and growth/customer work. The first useful chart and next action must not
sit below a long stack of product metadata, duplicated notices and instructions.

Use the luminous system with a clear performance canvas and quieter task/product rail. Modular
summaries belong where comparison helps. Keep meaningful charts substantial, with readable axes,
period/source controls and exact-value keyboard/touch details. Detailed tables and source notes
stay reachable. Forms such as Add cost and Post update open deliberately rather than occupying
the initial overview. All existing tools remain accessible, with drafts and recovery preserved.

## Actual baseline review and required correction

Astra inspected the fictional operations preview at1440/390 using the001f built UI while001f1
changes discovery. The page fits horizontally but puts operating summary then Books explanation
then digital metrics/charts then repeated AI spend then cost form then checklist/inquiries/imports/
growth/selling in one long flow. Header has many equal actions. Worker notice appears twice.

**Reproduced palette regression:** DeskOperations charged and returned series both compute to
rgb(49,85,217), and customer versus founder cost series also both compute to that color. Old
--mint now aliases cobalt, which equals --blue. Both legend and actual SVG fills collapse.
Evidence screenshot: docs/astra/operations-chart-before-001h-2026-11-04.jpg. Fix data-series
tokens independently from brand actions, including all financial/buyer chart consumers. Use
distinct patterns/markers/direct labels as well as colors; do not rely on hue alone. Actual CSS
contrast checks must cover chart distinctions, not merely text and focus borders.

The product row displays Untitled product although its released customer offer is Invoice reader.
Prefer real released/customer identity when appropriate, and label a divergent draft separately.
Do not silently rename records or imply the release changed with the draft.

## Underneath

Read Desk.tsx, DeskDigital.tsx, DeskBooks.tsx, DeskOperations.tsx, Value.tsx, shared chart styles
and server operations/books projections. Preserve source/units: earned versus advance payments,
test dollars versus US-dollar costs, unknown versus recorded zero, current incomplete month,
exact tiny model costs, customer versus founder build/test/runtime spend, and worker-qualified
settlement claims. Navigation is a view over existing data, not an accounting rewrite.

## Done when

- Design note maps the new local navigation and every existing action; no lost legacy, imported,
  multi-product, acquisition or customer-continuity entry points. Deep links/back-forward work.
- Overview/performance compositions inspected at1440/1280/390 and zoom: useful first view, no
  clipped essential controls, no inaccessible chart tooltip, keyboard/table alternative.
- Distinct series under actual luminous CSS and grayscale/pattern reading. Customer cost,
  founder trial/check cost and one-time build cost remain separately understandable; no duplicate
  summation or fake revenue when only runtime usage exists.
- Loading, empty, partial, unavailable source, access loss and changed ownership remain truthful.
  Selection/drafts/recovery survive local view switches; stale owner answers never reappear.
- Meaningful tests for any changed behavior and the palette regression, npm check/webbuild,
  fictional local preview with several months/products plus empty/unknown states. Explain which
  data is fixture versus observed. Local commits and report, then Astra review.

## Scope and order

P1/L after001g Studio and scheduled003u2 evidence correction. Astra dispatches; this file does
not authorize a second writer. Acquisition and customer-use compositions follow separately.
All six functional milestones remain; no cosmetic completion claims. No live provider/RPC/
wallet/main wiring/signing/deploy/push/public release/submission/new spending/real data/research
access/Day One. Exact Opus5.5/high, subscription first.
