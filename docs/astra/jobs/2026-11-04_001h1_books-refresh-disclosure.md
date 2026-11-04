# Books refresh failure and displayed period

P1/S-M. Explicit dispatch after the active005b helper correction is independently reviewed,
before001i. Do not interrupt the sole writer. Preserve001h/001i/001j and all six milestones.

## Independently reproduced

Astra used the real workspace app with the existing in-memory workspace fixture and a temporary
loopback-only interceptor. First books GET503 displays an honest error; Try again recovers the
six-month records. Then inject one books503 and choose Last12months in Performance. The selector
shows12, but the charts still cover Jun-Nov and operations/spend say last6months. Neither
Performance nor Overview exposes the refresh failure, an explicit cached-data notice, or retry.
The fixture counter confirmed the injected failure was consumed. Screenshot:
`docs/astra/books-stale-period-2026-11-04.jpg`.

Separate one-shot books404 followed by choosing3months clears books figures from Performance
and Overview. Overview Try again restores the3-month records. Waiting/products remain from a
separate successful desk read. This is a books-route failure test, NOT a whole-owner-loss test.

Source: useBooks retains data on transient errors and sets loadError. Both renderers only show
loadError when data is absent. BooksPanel uses requested period in the selector, returned period
in figures. Do not assume an existing cached warning: none was seen in either view.

## Required behavior and acceptance

- A pending period change and a failed refresh never imply that old figures answer the new
  period. Either hide stale figures while selecting a different period, or clearly label the
  displayed successful period and pending/failed requested period. Keep the chosen request
  recoverable. No invented timestamps: use returned evidence time, or explicitly label a local
  successful-read time if needed.
- Both Overview and Performance expose the shared failure and a useful retry. Show any retained
  figures as last successfully loaded, with their actual period; success clears obsolete warning.
  Error is distinct from no records or zero. Accessible status/error announcements, phone fit.
- Keep401/403/404 removal of private books data; preserve existing sequencing/unmount/identity
  fences. Do not broaden access, refetch loops or silently resubmit costs. Preserve unsaved cost
  drafts when retrying in the same permitted context.
- Meaningful deterministic tests: success6 -> pending12 ->503 -> retry12 success; successive
  period responses arriving out of order;401/403/404 removal. Exercise the actual production
  shared read/presentation behavior rather than a second model of it. Legacy books consumer
  must get truthful errors too, without unrelated visual overhaul.
- Provide a bounded in-memory preview failure control for Astra's actual browser repeat. No
  external provider/RPC/wallet, runtime DB, sign/deploy or live access changes.
- npm run check, web build, exact-file local commits/report, stop for independent review.

Read ASTRA, PLATFORM_VISION and EVERSTREET_UI_DIRECTION. Exact Opus5.5/high subscription;
scoped searches only, no research/secret/runtime/dependency reads or Git staging of those paths.
No push, release, submission, spending, Day One or claims of full milestone completion.
