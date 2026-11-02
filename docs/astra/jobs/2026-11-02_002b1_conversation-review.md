# Guided studio browser corrections

**Why (Tony's words):** "Please do your best to keep the work going in the meantime so there isn't downtime."

## What the person sees and does

Preserve the founder's next thought while sending the current message, and make the work
log readable. Astra independently reviewed UI commit `233d2bf` against an isolated in-memory
server with an explicitly scripted provider. No live model calls or chain transactions.

1. **Typed-ahead message is lost.** Delay the POST conversation response by ten seconds
   (after normal API handling), send message A, then type message B while "Sending..." is
   visible. When A resolves, B disappears. `ConversationPanel.send` unconditionally calls
   `setText("")` after awaiting. Preserve later edits; keep immutable request text and request
   key together for an uncertain-response retry. Do not send changed text under the old key,
   erase later edits on success/error, or allow a duplicate request on fast repeated clicks.
   Give an understandable retry path when the previous outcome is unknown.
2. **Founder message layout collides with existing styles.** `.msg.founder` inherits the
   older `.founder { display:flex; gap:16px; ... }` profile rule. At 1280px the name renders
   almost one letter per line, beside message and cost columns. Scope the work-log classes
   or explicitly set the appropriate layout without damaging public founder profiles.
3. **Applied proposal copy.** After "Use this version" creates revision 2, the disabled
   button still has "Makes revision 3" beside it. Show the actual applied revision and
   preserve the already-applied state on reload.

Also review stale same-project conversation loads and cancellation errors while touching
this component. Actor/project switches already remount the studio; preserve that boundary.
Do not claim untested suspicions as fixed bugs.

## Underneath

Confirmed through browser UI: create idea → set $1 fictional budget → send → proposal →
apply creates revision 2. The budget distinguishes $0.0210 computed cost from $0.03 counted
against the limit. Document width fits 1280 (1265/1265) and 390 (375/375); narrow visual and
keyboard review remains pending. Independent `npm run check`: 158 tests passed; web build
passed (bundle size warning, not failure).

Internal screenshot directory:
`C:/Users/antho/.codex/visualizations/2026/11/02/01a19d2e-29f9-7722-8592-187bac300246/`
Files `m2b-proposal-1280.jpg`, `m2b-conversation-mobile.jpg` (narrow capture needs recheck).

## Done when

Run `npm run check` and `npm run web:build`. Report actual checks; Astra repeats the delayed
browser send and visual review. Meaningful request-state tests if feasible with existing
tooling. Do not add a DOM test dependency merely to mirror state setters.

## Not in this job

No live AI, credentials, chain calls, publishing or Git push. M2 remains incomplete.

## Priority and size

P0 / S. Before further studio features. Independent acquisition jobs may follow while Astra
reviews this correction; one code writer remains the rule.
