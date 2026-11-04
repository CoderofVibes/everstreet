# Studio as a creative workspace

**Why (Tony):** "I like everything you just listed out" and "start to implement it"; approved
EVERSTREET_UI_DIRECTION.md makes the approachable AI studio the flagship experience.

## What the person sees and does

After001f1 review, make the product canvas the main place to work. A compact conversational
companion helps shape the idea; brief fields and supported screen edits appear as contextual
tools, not a permanent wall of forms. A founder can inspect a proposed change, apply it, test the
result and restore a prior version using the existing real capabilities. They need no prompt
engineering knowledge. Keep an obvious saved/unsaved state, project/business identity and one
appropriate next action. Luminous workspace, precise version/progress typography, local dark
canvas only where useful. Distinct composition from marketplace cards.

## Underneath and constraints

Read accepted direction, UI_SYSTEM_001F and STUDIO_WORKSPACE. Current ProductStudio.tsx has eight
task tabs, ConversationPanel, PrototypeEditor/Preview, persistent per-person/project/epoch drafts,
immutable revisions, query links, StudioRecords and mounted Service recovery. Preserve these
behaviors, including typed-ahead conversation, pending requests, access invalidation and released
versus newer brief status. Preview controls must act or explain why unavailable.

Write a short concrete composition/interaction map before implementation. Choose a small set of
supported preview selections (for example title/action/field) mapped to real schema edits, with
keyboard equivalent and explicit edit/try mode so selecting an element cannot accidentally submit
it. Selection is allowed only where the renderer genuinely supports editing. Treat unsupported
capabilities honestly; no fabricated model runs, evaluations, code execution or success animation.

## Done when

- Large working canvas, useful conversational companion, deliberate contextual editor; switching
  tools/tasks and phone layouts retains unsaved drafts, sample state, pending operations and
  recovery. All existing routes/query links/back-forward still work.
- Inspect/apply proposal, save revision, test supported behavior, compare/restore history and
  release/customer setup remain reachable with truthful capability/status labels. Undo/restore
  never silently changes a released service or discards unsaved work.
- 1440/1280/390 layouts: current task controls appear promptly, no long form stack before canvas;
  compact tool switching with predictable focus and labels, reduced motion and zoom support.
- Failure, unavailable-provider, pending/lost answer, stale revision, owner change and reopened
  project states remain safe and useful. No private old-owner draft leaks to buyer.
- Meaningful behavior tests for changed interactions/state, existing regressions, npm check and
  webbuild. Isolated fictional preview demonstrates empty, released/newer brief and failed check
  projects. Report actual checks separately from unverified browser gates; local commit then stop
  for Astra review. No invented completion of M1/M2.

## Not in this job

No arbitrary generated-code engine or new remote services in this layout slice. Existing backend
capabilities stay intact. Operations/acquisition/customer compositions and M4-M6 remain queued.
No live provider/RPC/wallet/main wiring/signing/deploy/public release/push/submission/new spending/
real data/research access/Day One. One Claude writer, exact Opus5.5/high, subscription first.
P1/L after001f1 review. Do not start merely because this file exists; Astra dispatches each slice.
