# 003r1 report: current reviews, unconfirmed access, cancelled-use wait

Claude, 2026-11-04. Job: [003r1](../jobs/2026-11-04_003r1_review-access-and-cancelled-use.md).
Commit `504c4f5`, on top of `6d22f9d` (Astra's six docs). Not pushed. No contract change; Rust
was not rerun.

## Reproduced first

These tests failed before the fix: 8 in `web/test/offerSetup.test.ts` and
`web/test/customerWorkspace.test.ts`.

| Finding | Failing reproduction |
|---|---|
| 1. Release retired, then refresh: the review stays | "the release retired, then a refresh…": `readiness.release` was null but the inspection stayed. A binding variant (server restarted on another account) also kept it. |
| 2. A retire 404 plus an inconclusive access check kept the review actionable | "a 404 then an inconclusive access check (failed / malformed)…". Also: unanswered create while unconfirmed. |
| 3. A cancelled use offered a new request inside the guarded window | "after cancelling, it says wait…" and "a new request refused inside the window keeps the next draft…" |
| Follow-up: create response consistency | "a create answer naming another release, project, source or digest…" |

The denied and superseded access checks already behaved; they are now pinned by a test.

## What changed

**Owner offer setup** (`offerSetup.ts`, `CustomerOffers.tsx`)
- **Current reviews.** `reviewCurrent(inspection, readiness)` requires the same owner
  generation, active release id and artifact digest, and binding. Readiness now returns
  `binding`.
  - Every reload drops a review that no longer holds.
  - A late inspection answer is applied only if it still matches, and only while access is
    confirmed; otherwise `review_outdated`.
  - Create refuses a review that isn't current.
- **Unconfirmed access.** A 404 or `409 control_changed` (now a stable code from
  `stillControls`) triggers an access check:
  - **denied** (404): the page clears;
  - **inconclusive** (5xx, network failure, malformed answer): `access: "unconfirmed"`. The
    review and the retire confirmation are cleared. What was loaded stays visible as history.
    Inspect, create, recover and retire are paused (`access_unconfirmed`, buttons disabled).
    **Check access** retries, and any validated successful read confirms access;
  - **superseded** (the page closed during the check): nothing is applied;
  - **unanswered create:** stays recoverable and is resent once access is confirmed.
- **Create responses.** A success is adopted only if it names this request's release, project,
  artifact digest, source, plan and retention. Otherwise it's treated as unanswered: the exact
  pending request is kept and recoverable. The expected identity is stored with the pending
  body. Older stored bodies without it still recover with the earlier checks.

**Customer cancelled use** (`customerUse.ts`, `customerWorkspace.ts`, `CustomerProduct.tsx`)
- **Barrier kept.** The `neverSent && dead` check in prepare is unchanged.
- **Refusal detail.** A refusal inside the window now says why: `409 previous_window_open`,
  `detail {request_id, until_ms}`. The deadline is the accept-by block time. A still-open
  request gives `use_in_progress` with its id. `HttpError` and the web `ApiError` gained a
  bounded `detail`.
- **`next_use` on cancelled/expired views.** It reads `wait` (with `until_ms`) while the
  allocation is held and the server clock is ≤ the deadline, otherwise `check`, where the
  contract still decides on the next prepare.
- **Workspace.** It offers **Check again** (a read only) with "stays valid until …", instead of
  Start a new request. A refused new request keeps the typed draft, sets `waiting`, offers
  **Check again and review**, and links to the stopped request.
  - No polling, no countdown authorization and no automatic signing or creation.
  - The labels no longer say "you can start a new request" or claim that nothing could have
    been signed. They now say "nothing was sent from here".

**Retention honesty**
- New readiness item **Result cleanup**. It always says reads past retention are refused, then:
  - *unavailable*: no deletion capability is connected;
  - *unknown*: deletion is possible, but no retention pass is scheduled here (with a count of
    overdue results);
  - *observed*: deletions recorded by a pass, with count and time, "not that it runs on a
    schedule".
- Setup copy no longer says results "are deleted". No worker was added.

## Checks

- `npm run check`: Biome and `tsc` clean, **734 tests in 60 files** (720/59 before).
- `npm run web:build`: built.
- **New server tests** (`server/test/customer-next-use.test.ts`, 5):
  - wait/check by both clocks, refused exactly at the deadline, allowed one millisecond after;
  - `skip_hold_seq` frees the allocation before the deadline (hold sequence 2);
  - expired waits too, and an open request says in progress with its id;
  - cleanup goes unknown → overdue count → observed after an explicit `expireResults`;
  - cleanup is unavailable without deletion;
  - readiness binding.
- **Updated tests:** the 003m cancellation test now expects `previous_window_open` with its
  detail; the 003r readiness map includes cleanup.
- **Mutants**, one at a time, each restored, with the diff inspected before running. All 6
  were killed:
  1. `reviewCurrent` ignores a missing release;
  2. `paused()` never pauses (3 tests);
  3. response identity ignores the digest;
  4. server `nextUse` boundary `<=` → `<`;
  5. the workspace wait branch removed;
  6. the refusal no longer records `waiting`.

## Limits

- **Browser.** Owner mobile and keyboard, and the cancelled-use browser flow, are not
  browser-verified here. They are left for Astra.
- **Preview.** It is unchanged. A cancelled use in the preview waits about 9 minutes, and the
  existing `/hold/expire` control (+11 minutes) moves past the window.
- **Next use.** `next_use` uses the server clock only to choose between wait and check. Only a
  prepare's pinned read frees an allocation.
- **Milestones.** All six stay open.
