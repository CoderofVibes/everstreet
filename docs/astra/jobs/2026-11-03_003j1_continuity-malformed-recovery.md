# Correct malformed-answer recovery in Ownership and continuity

**Why (Tony):** keep building the complete platform, with approachable recovery and truthful
ownership evidence. Astra reproduced two failures at02f5f56 despite the519-test suite passing.

## Reproductions

Use ContinuityController with a valid never_observed view (owner_epoch mara:0, testnet binding,
transport configured). All answers are finite scripted values; no network or mutations needed.

1. load succeeds. refresh throws ApiError404 and its follow-up get throws offline. Access becomes
   unconfirmed. Next explicit checkAccess get returns malformed `{state:'observed'}`. apply rejects
   it, but load returns ok anyway. checkAccess never settles: access stays checking and blocked
   says Check access first. It cannot be retried by the user.
2. From the same valid initial view, refresh returns `{outcome:'accepted',message:'accepted',
   view:{state:'observed'}}`. apply rejects the view, but refresh announces done/accepted and
   "Recorded a newer block." It still displays never_observed and a malformed-answer error.

## Required correction

- Distinguish validated/applied, superseded, access-ended and failed reads; do not equate HTTP
  completion with a valid view. Every checkAccess path settles or is superseded by a newer valid
  access decision. A malformed answer never leaves checking/sending forever or restores access.
- Validate the whole refresh response at the browser boundary, including supported outcomes,
  required view for completed observation outcomes, period outcomes/month and refusal fields.
  Do not cast unknown JSON directly to RefreshAnswer. Invalid/missing/object-valued fields must
  not announce a successful observation or crash React. Keep the last valid evidence/time and
  a clear retryable failure. Do not regress owner epoch/read sequencing/late-answer fencing.
- Add meaningful reproductions for both failures before fixes, plus malformed refresh envelope,
  retry to a valid answer and an older malformed answer after a newer successful access check.
  Finite fixtures only; no need for mutation tests here. Run check/build and report/commit.

## Review already passed (do not redo unnecessarily)

Astra browser: valid month refresh adds October without rewriting November provenance; offline
refusal preserves block/time; keyboard Enter refresh works; transfer to Noah followed by refresh
clears private page; Harbor correctly shows stale/conflict/owner mismatch. Desktop1440/1280 and
mobile390 have no document horizontal overflow. Full accessibility/all-state browser matrix
remains partial. No live endpoint, ownership reconciliation or M3 acceptance.

Priority P1/S-M. Finish before003k. No contracts/scripts/config/signing changes required.
