# Studio draft lifetime review

Tony's dedicated worker approval is already recorded and exercised under 002f. This pass
does not repeat setup or enable the worker. Sole Claude execution 93559 is implementing 001k1;
its initial handoff commit is fe4b3b7. No overlapping Astra application edits.

## Independently reproduced on the in-progress 001k1 code

Two finite Node/tsx probes drove the real Generations controller with a deferred synthetic
port and in-memory storage. No server, model, worker, payment or chain operation ran.

1. Create controller A for a scope; set draft `original sent text`; submit and hold the answer.
   Recreate controller B over the same scope/storage (ordinary route remount); type
   `newer route draft`. Reject A's original request with ApiError(400, `refused`). B still
   displays `newer route draft`, but a third recreated controller restores `original sent text`.
   A's late refusal overwrites the newer persisted draft using its stale, empty local draft.
2. Create another controller; type `private unsent words`, submit and hold the answer.
   Call forget() to represent definite access loss, then reject the request with the same 400.
   Its draft becomes `private unsent words` again after it was explicitly cleared.

Observed JSON:

```json
{"visibleNewer":"newer route draft","reloaded":"original sent text"}
{"afterForget":"private unsent words","persisted":2}
```

The second storage count includes both synthetic scopes; the evidence is the restored private
draft, not a claim that exactly two records belong to the cleared scope. The probe bypassed
server budget validation with a synthetic port; it tests asynchronous client persistence only.

## Required correction before acceptance

Fence stale controller responses and permanent access-loss cleanup. A late refusal must not
overwrite text typed in a newer mounted instance or recreate anything after definite access
loss. Preserve exact pending request/job recovery and typed-ahead text; no auto resend.
Review brief outbox callbacks under the same remount/access-loss pattern as well. This last
item is a review target, not yet an independently reproduced brief-composer failure.

Add real-controller deferred-response regressions for these two observed cases. Repeat them
independently after correction, then complete the planned SPA/reload browser checks. 001k1,
001k and all six milestones remain unaccepted. Next integration job is still 003w; queued
002f1 host corrections remain separate.

Files changed by Astra this pass: this review, INDEX row and BUILD_STATE checkpoint only.
No new job is needed: these are within 001k1's draft preservation/access-loss acceptance.

Required npm run check attempted during the in-progress implementation: exit1 at lint, due to
an unused ApiError import and formatting in Claude's unfinished routeDrafts.test.ts. No Astra
fix to that owned file. Types/tests did not run in this invocation; final checks remain required.

## Follow-up while attach/detach correction is being implemented

A third finite real-controller probe reproduced a remaining late-read path: create a queued
job; call refresh() with its read deferred; detach() the controller as the component does on
unmount; recreate for the same scope and type `newer draft after return`; reject the old read
with ApiError(404, `gone`). The new controller still displays its text, but reopening restores
an empty draft. Output: `{"visible":"newer draft after return","reloaded":""}`.

The direct clearScope in refresh's 404 path bypasses the new writable fence. The same clear
in forget() deserves a detached-instance guard because old page-load callbacks can call it.
Fence every persistence write/deletion from a detached controller, including clearing. Keep
active, current access-loss cleanup intact. Test this observed deferred-read case as well.
