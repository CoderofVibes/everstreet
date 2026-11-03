# 004a3 report: recover when checking import access fails

Claude, 2026-11-03. Job: [004a3](../jobs/2026-11-03_004a3_import-recheck-recovery.md). Commit
`57da5b5`.

**Files:** `web/src/importWorkspace.ts`, `web/src/pages/Import.tsx`,
`web/test/importWorkspace.test.ts`. No server, contract or other product changes.

## Reproduced first

I wrote the new tests before changing anything and ran them against `e47e289`'s controller.
After every request had settled, the four actions were still showing as in progress:

| Action | Stuck at |
|---|---|
| Details save | `saving` |
| Dependency save | `saving` |
| Inspection | `sending` |
| Saved report | `loading` |

That matches Astra's reproduction: 12 of the 24 tests failed, all of them new. The cause was
`stillMine` returning `false` for three different situations (access ended, scope retired,
recheck failed), so every caller returned without settling its own status.

## The change

The guarded read after a 404 (`recheck`) now has four answers:

| Answer | Meaning | What the caller does |
|---|---|---|
| `current` | The workspace is still yours; the 404 was about something else | Reports its refusal, as before |
| `ended` | 404 again | Nothing: everything private is already cleared (004a2) |
| `retired` | The page was left, or a new control epoch already dropped its drafts and statuses | Nothing |
| `unavailable` | The read failed some other way (503, no network), or named an older generation | Settles its own status as not done |

**On `unavailable`:**

- **Details and dependency saves** settle as refused: "Not saved. The server didn't find this
  import for you, and checking your access didn't finish. Your text is still here."
- **An inspection** stays as an unanswered attempt with its original key and file, so recovery
  resends the same request. Nothing is inspected twice.
- **A saved report** shows that it wasn't loaded and why. It doesn't say the report doesn't exist.
- **The page** keeps the view and every draft, and shows a banner: "Access not confirmed. We
  couldn't check whether this import is still yours…" with a **Check access** button. The button
  reads "Checking access…" and is disabled while the check runs.
- **Nothing can race the check.** While access is unconfirmed or being checked, these are disabled
  in the page and refused in the controller:
  - Save details;
  - each dependency's Save;
  - Inspect, and checking on an inspection;
  - the saved-report buttons.

  Typing still works. There is no automatic retry.

**Check access** sends one guarded read:

- **Same epoch:** access is confirmed and actions come back.
- **Newer epoch:** drafts are dropped, as on any epoch change, and access is confirmed for the new
  epoch.
- **404:** everything private is cleared.
- **Failure or an older generation:** access stays unconfirmed and the button is usable again. It
  never stays as a spinner.

**What can confirm access.** Only a read issued after the doubt arose, at the current or a newer
generation. A read already in flight when the recheck failed can't clear the doubt, and nor can
one answering with an older generation (a stale replica).

The 004a2 scope fencing and the 004a1 drafting and recovery behaviour are unchanged.

## Tests (`web/test/importWorkspace.test.ts`, 24; 12 new)

| # | Scenario | Result |
|---|---|---|
| 1–8 | Each of the four actions: 404, then a recheck answering 503 or failing with no network | Settled; view, drafts and manifest kept; access unconfirmed; not called saved or ended; no further request goes out |
| 9 | Check access succeeds | Access current; a second click sends nothing; recovery resends the original inspection key; saving works again |
| 10 | Check access fails, then answers 404 | Unconfirmed with a usable button; then everything cleared |
| 11 | Check access finds a new epoch | Drafts and manifest dropped; an older read finishing later can't restore the old owner's view |
| 12 | Answers that can't confirm access | A read started before the doubt leaves it unconfirmed; a fresh newer-epoch read confirms it; a check answered with an older generation leaves it unconfirmed, with the view and newer typing kept |

**Mutation checks** (each reverted):

| Mutant | Failing tests |
|---|---|
| Any read confirms access, whenever it was issued | 1 (#12) |
| Actions not blocked while access is unconfirmed | 8 (#1–8) |
| An older-generation answer counts as confirming | 1 (#12) |

## Commands

```
npx vitest run web/test/importWorkspace.test.ts  → 24 passed
npm run check        Test Files 35 passed (35); Tests 413 passed (413)
npm run web:build    built (existing chunk-size advisory only)
```

One full-suite run, before the Astra handoff docs were committed (docs only), failed one existing
test: `builds-boundary.test.ts` "stops a flooding stream…". It passed on its own and in the next
two full runs. I didn't change it; it looks load-sensitive. I'm noting it, not counting it as
fixed.

## For Astra's browser repeat

I didn't use a browser. The page wiring is covered by type-checking and the build, not by a DOM
test. To reproduce, make the workspace read fail (for example, stop the API or answer 503) right
after a 404 from each action, then check:

- the banner and the Check access button, at 1440, 1280 and 390;
- that the disabled Save, Inspect and report buttons are announced correctly;
- that typing still works while access is unconfirmed;
- Check access while the API is back, still down, and after a transfer.

M4 stays open.
