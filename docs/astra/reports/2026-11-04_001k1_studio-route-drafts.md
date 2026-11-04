# 001k1 Studio route drafts: report

Job: `docs/astra/jobs/2026-11-04_001k1_studio-route-drafts.md`, after ExecutableCanvasBrowserReview.
The StudioDraftLifetimeReview findings arrived during the work and are covered here.

**Commits:**
- `fe4b3b7`: Astra's eight paths, committed after the check passed (1198 passed and 1 skipped).
- `31d1c9a`: the correction, its tests and the CANVAS_STUDIO state rules.

**Status: in review. Not browser-repeated by me** (no browser here). The evidence is the real
controllers recreated in tests, plus a 25 s smoke run of the preview.

No host work was done. 002f stays partial and 002f1 queued. I did not start 003w.

## Cause

Leaving the Studio (Build → the same project card) unmounts the Web app view and the brief
companion. Their state lived only in memory:
- **Web app:** the `Generations` controller kept the request and job envelope in session storage,
  but not the draft.
- **Brief:** `ConversationPanel` kept both its text and its unresolved message in `useState`.

**Reproduced first** against the actual `Generations` controller at the 001k code: recreated over
the same storage, the draft came back `""` instead of "Route retention probe". The brief
companion had no controller to reproduce against: its state was component-local, so an unmount
lost it by construction. That matches Astra's browser reproduction.

## Correction

**Storage (`web/src/composerDrafts.ts`):**
- **Where.** Unsent text goes in this tab's **session storage** (the same store as the existing
  generation recovery). It survives SPA routes and reload, and doesn't outlive the browser
  session.
- **Keys.** One entry per composer (`app`, `brief`, `brief-outbox`) and scope (studioScope: person,
  project, owner epoch). Each is versioned `everstreet.draft.v1.*` and also records its scope.
- **Validation.** Anything unreadable, of another version, naming another scope, non-string, over
  2000 characters (the composers' limit) or older than a week is ignored and removed.
- **Fail-safe.** Writes never throw: denied storage leaves the in-session draft and request
  recovery exactly as before.

**The two controllers:**
- **`Generations` (the Web app composer)** restores its draft on construction and persists every
  draft change in its own entry. The request and job envelope is unchanged.
- **`BriefComposer` (new)** holds the conversation's text and unresolved message (text and its
  exact request key). `ConversationPanel` now subscribes to it, as AppView does to Generations, and
  passes it its `scope`. A message that was still sending comes back "unknown", so "Send again"
  reuses the same key.

**Rules kept:**
- Nothing is sent automatically, and a submitted draft never reappears as unsent text.
- Typed-ahead text and the exact pending request (key, instructions, base, budget snapshot) stay
  apart.
- A definite refusal restores the words only into an empty box.
- Completion never erases newer text, and an emptied box stays empty.
- App and brief texts are separate.

**Astra's StudioDraftLifetimeReview** (two real deferred-response failures in my in-progress code;
both fixed):
- **Only the mounted instance writes.** `attach()` and `detach()` are called from each view's mount
  effect (tolerant of an effect re-run). A detached instance's late answer writes nothing, so it
  neither overwrites the newer instance's draft nor drops the kept envelope. The new instance
  recovers that same request under the same key.
- **`forget()` ends the controller.** Nothing late restores anything, in memory or storage.
- **The same fence on the brief outbox.** It was a review target and is now tested.

**Access loss:**
- A definite 404 clears the scope's entries: AppView's versions read → `gen.forget()`; the
  conversation read → `composer.forget()`; a generation job read clears the draft and job.
- The studio's project 404 clears the person's entries for that project in **every** owner epoch
  (`clearProject`).
- Another person, project or owner epoch never matches a key.

## Evidence

**`web/test/routeDrafts.test.ts`** (21 tests) drives the real controllers recreated over the same
storage:
- the reproduction;
- an emptied box;
- no resurrection or auto-send while a request is in flight;
- typed-ahead text plus the exact pending envelope and budget;
- refusal into an empty box versus over newer text;
- an acknowledged job with newer text;
- scope fences (person, project, owner epoch after a sale; app versus brief);
- denied, corrupt, old-version, wrong-scope, stale, oversize and non-string entries;
- `forget()` and a job 404;
- the brief text, the unresolved message with its key ("sending" → "unknown"), a refusal and
  acceptance;
- prefill and typed-ahead text;
- a bad outbox entry;
- `clearProject` across epochs, leaving other projects alone;
- **Astra's two late-answer cases**: a detached instance's late refusal versus the newer draft,
  with the envelope still recoverable; a late refusal or success after `forget()`;
- an effect re-run;
- the brief outbox's late answers after detach and after `forget()`.

**`web/test/appGenerate.test.ts`:** four assertions that counted all storage entries now count only
the request envelope (`everstreet.app-generation.*`). Unsent drafts are now kept by design, for
example the refused words.

**Checks:**
- **`npm run check`:** exit 0, lint and types clean. 1217 passed and 1 skipped (1218), across 126
  passed and 1 skipped files.
- **`npm run web:build`:** 883.87 kB JS (was 880.23), 72.52 kB CSS, with the existing chunk
  warning.
- **Preview smoke (25 s, no `--wsl`):** page 200, controls answered, and it exited at the deadline.

## For Astra's browser repeat (finite, local, fictional)

```
npm run web:build
npx tsx scripts/preview-app.ts        # no --wsl: no worker or VM
```

Open the printed `http://127.0.0.1:8858/build/<id>?view=app` as Ava. Controls are at
`http://127.0.0.1:8859/` (`/generation/lose`, `/generation/complete`, `/reads/fail/<n>`).

1. **App route:** type "Route retention probe" → main Build link → the same project card → Web
   app: the text is back. Reload: still there. Clear it, leave and return: it stays empty.
2. **Brief route:** Brief → Show the companion → type "Brief route retention probe" → Build →
   card → Brief → Show the companion: the text is back, and separate from the app's.
3. **Pending across a route:** `POST /generation/lose`, then generate. Leave and return:
   "Recover my request" offers the same request, the composer holds only newer text, and nothing
   was sent on return. Recover, then `/generation/complete`: one queued generation, then the new
   version on the stage.
4. **Typed-ahead text:** while a generation is queued, type new text, leave and return. The new
   text is kept and the request is unchanged.

Also check that 001k's composition, focus, 390 containment and generated/current separation are
unchanged.

All six milestones remain open, as do 001k (review), 003w, 004b, 005c, 005d and 006a. Astra's
files are untouched and uncommitted: `StudioDraftLifetimeReview.md` and the INDEX edit.
