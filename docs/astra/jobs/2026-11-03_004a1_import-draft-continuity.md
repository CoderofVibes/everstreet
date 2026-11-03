# Keep import work intact while founders explore and save

**Why:** Tony wants an approachable place to bring or build a digital product. Reviewing
dependencies and acquisition readiness must not silently erase a founder's work.

Read reports/2026-11-03_004a-browser-and-core-review.md.004a is built but not accepted.

## What the person sees and does

Draft product details, a supplied manifest, and dependency statements survive switching
Overview/Dependencies/Readiness within the same actor/workspace/control generation. Saved and
unsaved text stay distinguishable. After a slow inspection or save, newer edits remain intact.
Pending/failed requests have truthful states and a recovery path; navigating tabs cannot mint
a new inspection after an ambiguous success. Reset private state when actor/workspace/control
generation changes. Do not persist raw manifests or private drafts to browser storage.

## Underneath and acceptance

1. Reproduce both tab-loss cases in Astra's report, then lift or retain panel state within the
   scoped workspace. Preserve retry identity and original request separately from new drafts.
   Hidden retained panels must not remain in keyboard/accessibility navigation.
2. Guard asynchronous file reads by selection revision. A later paste/selection/clear wins.
   Inspection completion clears only its submitted draft, not later text. Recovery after a
   lost response uses the same key/payload even after switching tabs; no duplicate inspection.
3. Reproduce two dependency saves completing in reverse order and details-save/inspection
   overlap. Merge/reload authoritative versions safely; don't drop another successful write
   because a different request incremented a single global seq. Keep optimistic conflict
   handling meaningful and typed-ahead drafts intact. Disable duplicate same-action submits.
4. Snapshot selection has an explicit selected/loading/error state; old data cannot masquerade
   as the newly selected report. Keep immutable history and current guidance clearly separate.
5. Label/focus readiness's horizontal scroll region and verify keyboard access. Retain clean
   page width at1440/1280/390, including long valid names. Keep honest evidence labels.

Use meaningful tests of request ordering/draft revisions/recovery boundaries, not rendering
snapshots that only mirror implementation. Existing access and API tests must stay green.
Run check/web build. Report exact evidence and browser work still requiring Astra's repeat.
Allowed: web, necessary server/test support, job/report. No connector, provider call, contract,
deploy or public publication. Local bounded commits; then proceed to003g as dispatched.

Priority P1 / M. No milestone completion implied.
