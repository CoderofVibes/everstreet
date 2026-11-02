# Guided authoring: long work-log review

Independent Astra reproduction against the actual API and worker, with an in-memory DB and
an explicitly scripted provider, Nov 2. This was found after dispatching 002b1; it is not a
claim that Claude's pending correction is already wrong or that live AI was tested.

After 101 completed proposal requests (202 founder/assistant messages):

```json
{"firstPage":200,"hasMore":true,"lastSequence":202,"lastVisible":"Reply Message 100","nextPage":["Message 101","Reply Message 101"]}
```

The API correctly supports `?after=200`. `productsApi.conversation` always requests page 1,
and `ConversationPanel` ignores `has_more`/message sequence. Thus the next exchange is stored
but invisible in the work log. Continuing to poll never retrieves it, although the latest
proposal may independently update. Reproduction uses normal session/project/budget/message
routes and BuildWorker.runNext, no direct SQL insertion or external calls.

Next correction: bounded history pagination with an explicit older-history control and a
reliable tail for new messages, or bounded incremental pages with a visible continuation.
Do not refetch unbounded full history after every poll. Preserve ordering, deduplicate by
message ID/sequence, update job statuses for visible pending messages, and fence late pages
after project/person changes. Cursor is the last returned sequence, not global `last_seq`.
Verify messages 199–202 are accessible and a new completion appears after history loading.

Separate browser evidence at `233d2bf`: mobile 390 layout has no document horizontal
overflow (375/375); composer and Budget are reachable by scrolling. Narrow screenshot has
been recaptured after the viewport finished reflowing. Founder style defect still exists
pending 002b1; no full visual acceptance yet.

## Correction evidence

Claude corrected history at `ff78c63`. Astra independently repeated 101 exchanges on the
new API: default tail is 50 and ends with Reply Message 101; five bounded backward pages
recover all 202 unique messages, starting at Message 1. The selected authoring/outbox/workLog
tests also pass independently (24 tests). Full check attempted during active 003b edits
encountered transient missing Deals.reconcile type errors; repeat only when that slice is
stable. Do not attribute that in-progress failure to this history correction or call the
entire current checkout verified.
