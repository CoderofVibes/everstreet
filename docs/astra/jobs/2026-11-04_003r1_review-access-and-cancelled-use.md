# Keep offer reviews current and explain cancelled-use recovery

**Why (Tony's words):** "a good solution for building within a platform that will then
showcase their product" needs understandable recovery and customer continuity.

## Independently reproduced at c184025

1. In OfferSetup over customerWorld's real API, start and inspect. Retire that exact release
   in the disposable test database (`UPDATE runtime_releases SET state='retired' WHERE id=?`),
   then refresh. Readiness.release is null but inspection remains populated. reload() compares
   only owner_generation. A release no longer eligible for creation stays presented as reviewed.
   Backend rechecks protect creation; this is a stale review/action problem, not proven bypass.
2. Same setup with an inspection. Override retire to return404, readiness to fail503 on the
   access recheck; request retirement twice. busy correctly ends, but the old inspection remains
   actionable, with no explicit unconfirmed-access state or Check access. Reproduce denied,
   failed, malformed and superseded checks. Don't equate an inconclusive recheck with ownership.
   Both finite independent tests failed their inspection-cleared assertion in98ms. Temporary
   probe removed. Use web/test/offerSetup.test.ts portFor/setupFor/world helpers to reproduce.
3. Browser: customer prepare -> cancel -> Start a new request -> Review immediately returns
   "Another request of yours is still in progress". UI said nothing sent and offered a new
   request, but the old allocation deliberately remains until the authorization accept window
   is dead or observed sequence advances. Source prepare's neverSent/dead check is a necessary
   safety barrier: DO NOT remove it. Advancing the isolated preview clock11min lets preparation
   succeed. Explain this wait and provide a safe explicit read/recheck/retry path with the
   preserved next draft. A browser countdown alone must not authorize allocation reuse.

## Correction

- Invalidate inspections when any relevant known release identity/digest/binding/ownership
  facts change, and when access becomes uncertain. Keep historical evidence distinct from
  permission to act. Suspend mutations until an explicit successful validated access check;
  denied clears private owner content; unavailable/malformed remains retryable. Prevent late
  responses from reinstating retired reviews. Preserve unanswered mutation recovery separately.
- Return truthful customer next-use availability/reason/evidence where needed. Cancelled and
  expired do not necessarily mean immediately reusable. Explain waiting without claiming a
  charge/reservation or certainty that no signature could exist. Show the useful next action,
  keep the draft, never spin-poll or automatically sign/create a replacement. Old authorization
  and cancellation races must remain safe, with finite tests for sequence/deadline boundaries.
- Source-review follow-up: readiness's storage configuration doesn't prove deletion is running.
  The setup field says results "are deleted" after retention, yet main schedules no cleanup.
  Distinguish enforced read expiry, deletion capability and scheduled/completed cleanup evidence.
  Fix claims; don't add a live worker or imply physical deletion from having an adapter.
- Source-review follow-up: validate create response identity/release/project/source/digest as
  well as plan/retention before adopting success. Malformed or mismatched success keeps exact
  pending recovery. Add only relevant consistency checks, not speculative protocol redesign.

## Done when

Both owner reproductions fail before the fix and pass after. Cancelled-use browser flow presents
the actual waiting/recheck state, then recovers after authoritative evidence permits it. Cover
same-person ownership changes, malformed/failed check, late answers, missing release and lost
create recovery. Preserve003q1 typed-ahead fixes and confirmed return/charge presentation.
npm run check/web:build pass, concise report/local commit, then proceed to003s.

P0/M. No contract changes expected. No signing/deployment/live reads/provider calls/main wiring,
spending, push/public release, research access/assessment, submission or Day One.
