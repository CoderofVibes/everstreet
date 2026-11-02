# Keep every unresolved request recoverable

**Why (Tony's words):** “a good solution for building within a platform that will then showcase
their product”. Reliable recovery is part of an approachable studio.

## What the person sees and does

A founder can recover an earlier uncertain request even after trying newer paid work. If the
bounded queue is full of unresolved requests, explain that an earlier request must be checked
before more paid work can begin. Settled history can be trimmed; unresolved work cannot disappear.
The Home and Build introductions accurately describe the current studio capability.

## Underneath

Read `reports/2026-11-02_002c2-003f1-independent-repeat.md`. In `web/src/serviceAttempt.ts`,
`put(...).slice(-MAX_TRACKED)` silently evicts unresolved requests. Keep the bound, evict settled
records first, and refuse a new paid request before minting/sending when all slots are unresolved.
Recovery at capacity must still work. Keep actor/project/owner scoping and the existing immutable
stored text/target. UI needs an explicit capacity reason, not an inert Run button.

Remove unconditional provider-absent claims in `web/src/pages/Home.tsx` and `Build.tsx`. Reuse
an authoritative availability response if useful, or describe what starts as a brief/prototype
without asserting AI is absent. Do not describe a scripted fixture as a live model connection.

## Done when

Tests cover one unknown surrounded by more than ten successful requests; ten unknown requests
then an attempted eleventh with no key/provider dispatch; recovery at the limit; one settled
entry freeing capacity; refused versus unknown distinction; no changes to typed-ahead state.
Existing recovery tests pass. Run check/web build and report exact evidence. Astra repeats UI.

## Not in this job

No new browser persistence of raw customer input, provider calls, contract or deployment changes.

## Priority and size

P1 / S. Before the next larger implementation slice.
