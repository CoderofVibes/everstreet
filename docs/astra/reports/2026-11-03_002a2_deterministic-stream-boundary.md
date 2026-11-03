# 002a2 report: the flooding-stream test proves the stream cap again

Claude, 2026-11-03. Job: [002a2](../jobs/2026-11-03_002a2_deterministic-stream-boundary.md).
Commit `7f53e32`. Test files only:

- `server/test/builds-boundary.test.ts`
- `server/test/builds.test.ts`
- `server/test/authoring.test.ts`
- `server/test/runtime-world.ts`

No production code changed. The full diff over `server/src` is empty.

## Cause

Every build-test worker was created with `msPerSecond: 1`, so a build's 60-second budget became a
real 60 ms deadline. The flooding test sends events until the worker stops at its 300-event cap.
Under full-suite load the worker can't process 300 events within 60 ms, so the deadline fires
first and the job ends as `timeout`. That is what Astra saw and what I saw earlier.

Both guards were working correctly; they were racing each other. In production the deadline is
60 real seconds and the cap is 1 000 events, and nothing was wrong there.

**Reproduced deterministically.** I gave the flood test a deadline below the time the stream
takes (`msPerSecond: 0.02`, about 1.2 ms). The run failed with "expected `stream_limit`, received
`timeout`", the same failure. That edit was temporary and is reverted.

**The same class of race elsewhere.** Three other tests let a real-time guard race the 60 ms
deadline:

- a cancel sent over HTTP after a usage report;
- a heartbeat noticing an owner change;
- a heartbeat noticing a cancel recorded by another process.

The cancel-while-streaming test also races it. Any of these could flake the same way under load.

## Change

- **The default scale is now the production one.** Test workers use the production time scale
  (1 000 ms per budget second). The deadline is `unref`'d and cleared when the attempt ends, so a
  test that finishes isn't slowed. A deadline that can't elapse can't win a race it isn't the
  subject of.
- **Only the deadline tests use a short scale.** They ask for 1 ms per budget second explicitly:
  - the slow provider in "keeps the reservation after an error or timeout with partial usage"
    (`SHORT_DEADLINE`);
  - "stops at the time limit" in `builds.test.ts`.
- **Other harnesses.** The same default change applies to the authoring and runtime harnesses,
  which have no deadline tests.
- **Unchanged:**
  - every assertion, including `stream_limit`, the 5 + 5 bounded event rows and the 25-row
    ceiling;
  - usage and reserve accounting;
  - every production limit.

  Nothing was skipped, and no test accepts either failure reason.

The separate runtime timeout test (`runtime-invocations`, `timeoutMs: 20`) uses its own timer and
is unaffected.

## Evidence

- **Mutation check.** With the stream cap disabled, the flood test fails (it hits vitest's 5 s
  limit). It no longer passes by way of another guard.
- **Focused run.**

  ```
  npx vitest run builds-boundary, builds, authoring, runtime-invocations, runtime-extract
  → 5 files, 82 passed, 1.07 s
  ```

  The two deadline tests still end as `timeout`.
- **Full check, three runs in a row.**

  ```
  npm run check (3 consecutive runs): Test Files 37 passed (37); Tests 468 passed (468), each run
  ```

Three clean runs are evidence, not proof, for an intermittent failure. The mechanism that produced
it is gone, though: in these tests the deadline is now about 60 s, roughly a thousand times the
time the guarded work takes.
