# 003j1 report: malformed answers during recovery and refresh

Claude, 2026-11-03. Job: [003j1](../jobs/2026-11-03_003j1_continuity-malformed-recovery.md).
Commit `6d0ce41`.

**Files:**

- `web/src/continuityController.ts`
- `web/src/continuityApi.ts`
- `web/test/continuity.test.ts`
- `server/test/continuity-preview.test.ts`

No server code, scripts, config or contract changes.

## Reproduced first

Astra's two cases and 11 malformed refresh answers were added as tests and run against
`02f5f56`. 13 failed:

| Case | Result on `02f5f56` |
|---|---|
| #1: a malformed answer to Check access | Access stayed `checking` |
| #2: an `accepted` refresh carrying `{state:'observed'}` | Announced `done` |
| Refusals without a code, or with an object message | Accepted as `refused` |

## The change

**Reads say what happened.** `apply` returns `applied`, `superseded` or `malformed`. `load`
returns `applied`, `superseded`, `malformed`, `ended` or `failed`. An HTTP answer is no longer
taken for a valid view.

**Check access always settles.** Only a valid applied view confirms access (or a newer one that
was applied), and access ending clears the page. Anything else, including a malformed answer, sets
`unconfirmed` again, so the person can retry. It never stays `checking`. A 404 refresh whose
recheck is malformed is treated like a failed recheck.

**The whole refresh answer is validated.** `parseRefreshAnswer` runs before anything is
announced. It requires:

- an object;
- a supported outcome: `accepted`, `duplicate`, `stale`, `conflict`, `contradictory`,
  `source_changed` or `refused`;
- a text message;
- for a refusal, a text code;
- for a completed observation, a valid view in the `observed` state;
- for any month result, a valid month and a supported month outcome.

**A malformed answer settles as `unknown`.** It shows a retryable message ("wasn't in the
expected form… nothing is shown as recorded"). The last valid evidence object and its original
time stay. Sequencing, epoch fencing and late-answer drops are unchanged.

## Evidence

- `web/test/continuity.test.ts`: 32 tests, 16 new. They cover:
  - both reproductions, including retry to a valid answer restoring access;
  - 11 malformed envelopes, each failing to `unknown` with the evidence and time kept and retry
    available. The cases: a string, an array, no outcome, an unknown or object outcome, an
    observation without a view, an object message, a bad month or month outcome, a refusal
    without a code, and a refusal with an object message;
  - a retry after a malformed answer succeeding;
  - a valid refusal keeping its code;
  - an older malformed read arriving after a newer successful check, which changes nothing.
- `server/test/continuity-preview.test.ts`, one new test: the real server's `accepted` (with
  month) and `refused` answers, and a flagged view, pass the browser's strict validation, so the
  stricter client doesn't reject genuine answers.

All fixtures are finite scripted values. No mutation testing was needed.

```
npm run check        Test Files 40 passed (40); Tests 536 passed (536)
npm run web:build    built (existing chunk-size advisory only)
```

The browser behaviour isn't re-verified. These are controller-level fixes with no page markup
change.
