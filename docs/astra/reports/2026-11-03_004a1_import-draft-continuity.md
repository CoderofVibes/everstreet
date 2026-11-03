# 004a1 report: import drafts, request order and recovery

Claude, 2026-11-03. Job: [004a1](../jobs/2026-11-03_004a1_import-draft-continuity.md). Commit
`65c4a56`. Changed: `web/src/importDraft.ts` (new), `web/test/importDraft.test.ts` (new),
`web/src/pages/Import.tsx`, and `server/test/imports.test.ts` (one test added; no server code
changed).

## What was wrong (reproduced, or confirmed step by step from source)

1. **Losing drafts on tab switch.** Astra reproduced this in the browser for both the product name
   and a dependency statement. The cause, in the source, is that the Overview and Dependencies
   panels were mounted conditionally and kept their drafts in their own `useState`, so leaving a tab
   destroyed them. The inspection request key lived in an Overview `useRef` and was lost the same
   way.
2. **A late file read replacing newer input.** The source confirms the path: choosing a file
   awaited `f.text()` and then set the manifest unconditionally, while a paste set it at once. A
   slow read that finished after a paste or another file replaced it. A completed inspection also
   always cleared the manifest, including text typed while it ran.
3. **One global sequence discarding answers.** The source confirms it: every write and load took
   `++seq` and an answer was shown only if its number was still the latest. If row A saved, row B
   started, and the server applied B before A, then A's answer (the only one containing A) was
   dropped and B's didn't include A. The page showed A as unsaved although it had succeeded, until
   a reload.
4. **A saved report selection showing the wrong report.** The source confirms it: selecting
   report 2 kept showing report 1 (or the live report, under report 1's heading) until report 2
   arrived, and a failure left the old report on screen.
5. **The readiness scroll wrapper had no focus or name.** The source confirms it (no `tabIndex`,
   role or label). I didn't test keyboard scrolling in a browser; that is Astra's repeat.

For 2–4, the old behaviour is a source-level trace, not a browser reproduction. The web tests have
no DOM environment, and adding one was outside this job. The new rules are tested directly
(below), and both ordering mutants fail those tests.

## What changed

**Drafts are lifted and scoped.** Everything unsaved now lives in the workspace component:

- the product-details draft and its status;
- each dependency row's draft and status;
- the manifest being prepared;
- the inspection attempt.

The workspace is keyed by person and workspace (as before). On a change of control (`owner_epoch`)
or a 404, every draft is dropped and nothing private stays on screen. Nothing is written to browser
storage.

Only the selected tab's panel is in the DOM, so hidden panels are never in keyboard or
screen-reader order. Tab labels show "unsaved" or "N unsaved". Each row and the details form show
"Unsaved changes", "Saving…", "Saved", or a specific problem.

**Ordering** (`reconcile`):

- Every server write raises one counter: the product version, an item version, or the inspection
  and report count. Each answer is the state right after its own write, so answers are compared
  counter by counter.
- A newer or equal answer is shown. An older one is ignored, because its write is already in what
  is shown.
- An incomparable answer triggers a reload, and a different `owner_epoch` resets.
- No successful write is hidden because another request started later.

**Manifest drafts** carry a revision. Choosing a file, pasting or clearing raises it, and a file
read applies only to its own revision. "Reading the file…", "Chosen … not inspected yet" and
"Clear" are explicit. The file box is emptied when the draft no longer holds that file.

**Inspections:**

- The attempt (key, file and draft revision) is kept across tabs, and the button is disabled while
  sending.
- Success clears the draft only if it is still the one sent.
- A 4xx is shown as "wasn't inspected" and the draft is kept.
- No answer, or a server error, is shown as "An inspection got no answer". Its "Check on that
  inspection" button re-sends the same key and file, which the server answers from its record
  without inspecting twice. Inspecting the same file again also reuses that key.

**Saves (details and each row):**

- Duplicate clicks are disabled while saving.
- On success, text typed meanwhile is kept and rebased onto the version that save produced.
- On a 409 or no answer, the page reloads the server state. If the server already holds the draft
  (a lost answer followed by a stale retry), it counts as saved, not a conflict.
- A real conflict keeps the draft and offers "Keep my text (then save over theirs)" (rebase) or
  "Use the saved version".

**Saved reports:**

- Selecting one shows "Loading report N…" at once, and its error if it fails.
- A late answer for a different report is ignored.
- A saved report is headed "Saved report N (from …, unchanged since)", with a note that today's
  guidance is under "Now".

**Layout:** the readiness table uses the existing labelled, focusable `Scroll` region ("Readiness
items (scrolls sideways)", tabIndex 0, the existing focus outline). Long names, values and evidence
wrap (`overflow-wrap: anywhere`), and fact columns use `minmax(0, 1fr)`.

**The create form** on `/import` uses the same revisioned manifest draft. Creating is disabled
while a file is being read. A lost answer says "creating again won't make a second copy" (it reuses
its key, as in 004a).

## Tests

**`web/test/importDraft.test.ts`** (11 tests):

- **Ordering:**
  - Two dependency saves land in reverse order, in both server orders; both successes stay shown,
    and an unrelated later write doesn't discard an earlier newer answer.
  - A details save overlaps an inspection, and a load that started before a write is ignored.
  - Incomparable answers lead to a reload; a change of control resets.
- **Manifest:** a slow file read loses to a later paste, clear or file, and an older read loses to
  a newer one. An inspection clears only the draft it sent, and a second click while sending sends
  nothing.
- **Recovery:** a lost answer is recovered with the same key and file after the draft changed, and
  inspecting the same file reuses the key while a different file gets a new key. A refusal isn't
  recoverable; a 502 is unknown.
- **Details:** drafts disappear when they equal what is saved (trimmed). Typed-ahead text survives
  a save and is rebased. A lost answer followed by a stale retry counts as saved when the server
  holds the text; a real conflict keeps the draft.
- **Rows:** each row keeps its own draft and base, and one row's save doesn't touch another.
- **Reports:** a new selection shows loading, never the previous report; late answers for another
  selection are ignored; error state.

**`server/test/imports.test.ts`** (+1): four concurrent writes (two rows, details, an inspection)
all land. Every answer is contained in the final state, and any two answers are ordered counter by
counter. That is the server property `reconcile` relies on.

**Mutation checks** (each reverted):

| Mutant | Result |
|---|---|
| File-read revision guard removed | The slow-read test fails |
| Older answers accepted (last-to-arrive wins) | Both ordering tests fail |

## Commands

```
npx vitest run web/test/importDraft.test.ts   → 11 passed
npx vitest run server/test/imports.test.ts    → 13 passed
npm run check        Test Files 33 passed (33); Tests 373 passed (373)
npm run web:build    built (existing chunk-size advisory only)
```

## Still needs Astra's browser repeat

- The two original tab-loss reproductions.
- A file chosen and then text pasted while it reads, and typing during a slow inspection.
- A lost inspection answer recovered after switching tabs.
- Two rows saved quickly.
- Selecting saved reports while they load.
- Keyboard focus and scrolling of the readiness table.
- Long names at 1440, 1280 and 390.

None of this was exercised in a browser by me. There are no connectors, provider calls, contract or
server code changes in this job. M4 stays open.
