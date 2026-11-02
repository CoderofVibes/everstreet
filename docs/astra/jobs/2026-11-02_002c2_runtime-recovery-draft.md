# Recover an earlier runtime request while drafting the next one

**Why (Tony's words):** "a good solution for building within a platform that will then
showcase their product".

## What the person sees and does

After a lost response, Check on the earlier request stays available even when the founder
has changed the next draft or chosen another version. It recovers the previous request and
preserves their current draft. New paid work is explicitly labelled and never silently replaces
the unresolved attempt. An old result is visibly identified as belonging to an earlier request.

## Underneath

Read002c1-independent-repeat. `serviceAttempt.nextAction` and ServiceView currently hide
recovery on changed text/target. Retain separate draft and pending attempt identities; recover
from the attempt's stored fields, without requiring a match to the editable draft. Support an
empty next draft as well. Keep existing actor/project/epoch fences and bounded polling.

## Done when

With a delayed request whose response is lost, type ahead, change tabs and target, then recover:
one invocation for that attempt, same result, draft unchanged. A new paid request needs the
explicit new-work action. Meaningful helper/state tests plus check/web build; Astra browser repeat.

## Not in this job

No live model call, new spend policy, contract, deployment or billing changes.

## Priority and size

P0 / S. Before002c UI acceptance; financial corrections can follow.
