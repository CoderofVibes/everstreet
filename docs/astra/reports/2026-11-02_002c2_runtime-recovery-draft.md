# Job 002c2 report: recover an earlier request while drafting the next

Claude, 2026-11-02. Job: [002c2](../jobs/2026-11-02_002c2_runtime-recovery-draft.md), from
[002c1-independent-repeat](2026-11-02_002c1-independent-repeat.md).

## Change

`web/src/serviceAttempt.ts` now keeps the Service requests (`Requests`) apart from the editable
draft.

- **Recovery never reads the draft.** A request whose answer was lost (`unknown`) is
  recoverable from its own stored key, text and target, whatever the draft holds: changed,
  empty, or a different target. `recover(requests, key)` re-sends that key, which the server
  answers from its record without new work, and the draft is never touched. The 002c1 rule
  that hid recovery when the draft differed, and the test that encoded it, are removed.
- **No silent new paid work.** While any request is unresolved, the plain Run is replaced by
  "Run this text as a new, separately paid request". `start(..., explicitNew)` refuses new work
  without that flag. Running new work doesn't discard the unresolved request; it stays listed
  and recoverable.
- **Requests are identified.** Each unresolved request is listed as "An earlier request has no
  answer yet (sent hh:mm on <target>: "<first line>")" with **Check on that request (won't run
  it again)** and "Your current text above stays as it is". A shown result is labelled "Result
  of your latest request" or "Result of an earlier request", with the request it came from.
  Saving a test case uses that request's own text, not the draft.
- **Unchanged:** the actor, project and owner-epoch keying; the access-loss clearing (which
  also clears requests); in-flight waiting; and bounded, visibility-aware polling.

## Evidence

- `web/test/serviceAttempt.test.ts` (6):
  - in flight: nothing else is sent;
  - recovery from stored fields with a changed, empty or blank draft, and another target; a
    plain Run can't replace the unresolved request;
  - explicit new paid work makes a new key, and the earlier request stays recoverable;
  - a recovered answer settles the earlier request;
  - refused and answered requests aren't recoverable;
  - identification text, and bounded polling.
- Server-side same-key recovery (one invocation, no new provider call) was already covered by
  002c1 tests.
- `npm run check`: lint, types, 29 files / 320 tests passed. `npm run web:build` passed.

**Not browser-verified by me.** Astra should repeat it: a delayed request with its response
lost, type a different next draft, change tab and target, recover (one invocation, same result,
draft unchanged), then try new paid work (explicit action only).
