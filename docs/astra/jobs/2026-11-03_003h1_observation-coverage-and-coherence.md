# Keep observation coverage separate from contradictions

**Why:** NEAR acquisition is central. A harmless request for monthly books must not create an
irreversible conflict, and impossible control changes must not be accepted as coherent evidence.
Read reports/2026-11-03_004a2-003h-independent-review.md for two reproduced failures.

## Required corrections

1. Separate core snapshot identity from optional period coverage. No-period, monthA, monthB,
   same month repeated, and concurrent different-month refreshes at the same block must coexist
   without false conflict. Compare overlapping evidence; different bytes for the SAME method,
   arguments and block remain a real conflict. A missing/not-requested period is not zero and
   must not erase a previously recorded period. All period values retain their own source,
   block and observed-at provenance; never present old period evidence as sampled at a newer
   core block. Design bounded retention and exact duplicate semantics before editing.
2. Validate control invariants against the actual003g contract. At higher block with equal
   control_seq, stable control fields cannot change; legitimate treasury/customer activity
   can. Enforce generation monotonicity and immutable source properties (close mode/closer,
   asset as the contract specifies), cross-view/live-deal party and generation consistency,
   and outcome/control ordering where actually guaranteed. Do not guess invariants: cite
   methods in the implementation note, and avoid rejecting valid observations that skipped
   several transactions or outcomes. Changed owner with same seq must not reach the projection.
3. Validate retention/config bounds so projection rows cannot be pruned away by retention0,
   negative or non-integer options; invalid trusted setup should fail clearly at construction.
   Preserve transactional writes, durable high-water, sticky genuine conflict flags, source
   isolation, unknown ownership mappings and epoch access fences. No flag-clearing workflow.

## Acceptance

Add real API/service regressions reproducing no-period then period at one block, two periods,
overlapping same-period conflict, reversed concurrent completion, retention/restart, next block
with no requested period, and truthful period freshness. Tests for same-sequence changed owner,
operator/manifest/live-deal changes, higher-sequence generation regression and verified immutable
fields; positive same-sequence customer activity and legitimate sale/manifest/operator changes.
Use actual serialized fixtures and synthetic mutations with explicit labels. Never turn an
observation into app ownership. Check/build and Rust only if fixture changes need it; bounded
commits/report. No new production transport, signing, deployment, live network, main.ts wiring,
ownership reconciliation or contract behavior changes. Then proceed005a.

Priority P1/M.003h remains review; M3 remains open.
