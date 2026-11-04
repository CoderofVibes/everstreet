# Keep project lists private and discovery failures truthful

**Why (Tony):** Everstreet must be an approachable, trustworthy place to create a business. The
approved UI direction preserves private drafts, multi-role navigation and honest empty/error states.

## Independently reproduced

Astra's actual browser at cdf1084, using the built001f1 bundle and a bounded local fixture wrapper:

1. Home signed in as Ava. Hold the already-authorized GET /api/product-projects response.
2. Switch to Bea; her Tutor Portal appears under Continue building.
3. Release Ava's earlier response. Header remains Acting as Bea Fictional but her card is replaced
   by Ava's Untitled product / Ledgerline Invoice Reader and its private project URL.
4. Clicking that URL correctly refuses access. This is private summary exposure in Home, not a
   demonstrated bypass of the project API. Screenshot home-actor-race-2026-11-04.jpg.

Separately, a deliberate local outage shows Home's No software products are published yet message
and removes the foundation choices. Source Home.tsx converts discover failure to[]; Composer in
Build.tsx converts foundation failure to[]. Neither is evidence of an empty catalog.

## What changes

- Home's Continue building is visibly bound to the current account before rendering. Account
  switch/sign-out immediately hides old summaries; late success AND failure cannot change another
  actor's state. Sequence reload/retry/unmount results. Clear on authoritative access loss. Existing
  project/API authority stays intact; never expose old details while the next account loads.
- Inspect the analogous Build.tsx Your product projects path (same unguarded list effect found in
  source) and reproduce/fix it in this job. A shared bounded controller is preferable to two
  divergent fixes, without a framework rewrite.
- Home catalog, needs and private recent projects each have meaningful loading/error/ready-empty
  states where relevant. On failed discover show failure/retry, never a fabricated zero/empty claim
  or a fake successful stage. Do not invent fallback catalog entries.
- Shared Composer foundation loading/failure is retryable and understandable. Preserve idea text,
  chosen supported foundation and business context during recovery; unavailable options cannot
  silently submit a different product type. Do not turn one failed auxiliary read into loss of
  unrelated content or typed work.

## Done when

Real UI race above repeated after fix. Meaningful finite delayed-response tests for A->B,
A->signed-out, late failure, quick switches, retry and unmount; actual server ownership controls
remain unchanged. Browser outage/retry retains typed idea and shows truthful catalog/foundation
states. Desktop/phone keyboard controls remain reachable. npm check/webbuild, local commits and
report with precise evidence/limits. Stop for Astra review.

No private data placed in snapshots, public projections, logs or fallback screens. No provider/
RPC/wallet/main wiring/signing/deploy/push/public release/submission/new spending/real data/
research access/Day One. Scope all searches before reading as ASTRA.md requires.

P0/M after the current001g Studio writer finishes and review; before003u2/001h. Do not interrupt
or duplicate80361. Preserve all six milestones and approved Studio/operations/acquisition/customer
rollout. This is a concrete privacy/recovery correction, not permission to redesign every page.
