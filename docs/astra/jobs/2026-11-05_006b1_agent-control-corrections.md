# 006b1: keep customer control reliable through errors and actor changes

P0/M. Open correction job from Astra's November 5 independent assessment. Not dispatched.
Read `../2026-11-05_IndependentBuildAssessment.md` and current AGENTS/ASTRA instructions.

## Experience

A customer must be able to revoke a used-up grant that still reads existing results. Failed
reads must say access could not be checked, not None. Switching people must immediately clear
the previous person's one-time token and private records. An owner toggling Agent use with the
keyboard keeps focus and receives a truthful readback.

## Evidence and implementation boundaries

- `AgentAccess.tsx`: Revoke is only rendered for active grants; load converts errors to empty;
  revoke ignores HTTP status; token/grants and outstanding responses are not actor-fenced.
- `Portfolio.tsx`: old private data remains while a new person loads; responses lack sequencing.
  This is a source finding, not yet an independently reproduced data-disclosure exploit.
- `AgentUseSwitch.tsx`: errors hide the control; disabling the focused button dropped focus in
  the actual 1440 browser. Space switched on; focus became the document, second Space did nothing.
- `agentAccess.ts`: active_grants counts all unrevoked rows, including expired/used-up;
  MCP schema maxLength=80 disagrees with service max=60. Existing preparations bypass switch-off.

Use one actor/business lifecycle fence for these reads/writes; clear immediately on identity
loss and discard late responses. Preserve legitimate already-authorized settlement/recovery.
Define switch-off precisely for prepared versus reserved/running work before changing semantics.
Do not make the UI promise immediate revocation of all work if only new preparations are denied.
Provide actionable load/revoke failures, pending state and reliable readback. Keep duplicate
grant submissions controlled, and offer/key-slot readiness understandable without inventing it.

## Acceptance

1. Failing-first page tests: used-up grant can be revoked; revoke 403/500/network failure cannot
   appear successful; failed list is Unknown with retry, not None; create double-click cannot
   silently produce multiple grants.
2. Delayed old-person list/create responses after sign-out or account change never show their
   token, grants or private portfolio. Include sign-out/sign-in without page unmount.
3. Expired/used-up counts match the displayed definition. MCP advertised key lengths match API.
4. Switch off/on with keyboard at 1440 and phone width; focus stays useful, state is announced,
   read failure remains visible. Test turning off before confirmation and during an admitted use.
5. Real-route expiry, cap, foreign-use and revocation tests; full check and web build. Keep the
   independent concurrent-preparation probe. No real tokens, signing, chain calls or publishing.

Backend permission fixes and tests precede cosmetic setup refinements if scope bites.
