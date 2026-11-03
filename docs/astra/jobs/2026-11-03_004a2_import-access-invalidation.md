# Clear private import state when access ends, and fence late answers

**Why:** Tony's seamless acquisition promise includes revoking the former owner's access while
the buyer inherits the business. The import desk must honor an observed change of control.

Read reports/2026-11-03_004a1-003g-independent-review.md. Astra reproduced a real404 from the
post-inspection authority fence while the browser retained private facts, drafts and reports.
004a1's draft/recovery fixes otherwise passed the targeted browser repeat.

## Required behavior

One workspace invalidation path handles access loss from load, details save, dependency save,
inspection/recovery and report reads. Clear private view, details/dependency/manifest drafts,
attempts and historical snapshots; disable their actions and show an appropriate unavailable
state. Do not classify a missing historical report as ownership loss without checking workspace
access: distinguish missing resource from revoked scope through a guarded current-view read or
explicit structured server code. No string matching on human error messages.

Every request captures a local scope generation; invalidation/unmount/control reset retires it.
A late success, failure, file read, snapshot result or post-save draft update from a retired
generation must not restore anything or clear newer input. A response from an older control
epoch must never roll back a newer epoch. Preserve the existing counter-based write merge within
one valid epoch. Revalidation must be explicit and authoritative, not caused by an old promise.
Away-and-back control changes reset drafts even if the same person owns the business again.

## Acceptance

Reproduce and test inspection404; save404; report access loss versus missing report; delayed old
success after newer denial; reordered old/new owner generations; typed-ahead drafts and original
inspection recovery across tabs while access is valid. Include component/orchestration coverage
or a directly exercised controller so tests verify the actual request lifecycle, not merely a
helper detached from its callers. No new browser framework dependency is required.
Run check/web build, report exact evidence and remaining browser repeat. No other product,
contract, deployment, connector or provider changes. Local bounded commit then proceed003h.

Priority P1 / M. M4 remains open.
