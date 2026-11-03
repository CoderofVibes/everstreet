# Import browser review and entitlement-core verification

Astra, November 3, against HEAD64ab7ea. Fictional in-memory app on127.0.0.1:8833;
no providers, keys, chain calls or persisted customer data. Built current web assets.

## Independently passed

- npm run check: lint/types and all361 tests,32 files. npm run web:build passes;578.25kB
  JavaScript chunk advisory remains.
- WSL Ubuntu: CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --lib:
  all38 tests passed. Reviewed003e1 report and weak-key install guard using the pinned decoder.
  The suite reproduces the pinned host weakness and rejects weak installs. This is keyless unit
  evidence, not deployed-host validation, gas measurement or a real sale.
- Browser created Invoice Pilot under a new private Ledgerline QA business from supplied JSON.
  Next/React/OpenAI/Stripe facts appeared with0 verified,2 detected,6 unknown; no fabricated
  preview or connection. Name save survived reload. A second manifest switched to Hono/OpenAI;
  live report became1 detected/7 unknown. Report1 still showed Stripe and its saved timestamp.
- Overview at1440 and readiness at1280/390: no observed page overflow; measured page/viewport
  widths1265/1265 and375/375. At390, readiness table scrollWidth713 within clientWidth298.
- Tab ArrowLeft moved Readiness to Dependencies. Actor switch Mara QA -> Noah QA on the same
  private URL displayed No such import and removed the first actor's private workspace.

## Reproduced correction

Type `Invoice Pilot draft` into Overview Name without saving, switch to Dependencies, then
return to Overview: the input has reverted to `Invoice Pilot`. In Dependencies, select Used
for source ownership and type `Mara owns the source organization`, switch to Overview and back:
the declaration reverts to Not said and the draft note disappears. Conditional panel mounting
destroys both panels' local state. It also discards inspection retry keys on tab navigation.
Founders must be able to inspect readiness while drafting without silently losing their work.

## Source-review concerns to reproduce and correct

- The readiness horizontal-scroll wrapper has neither explicit keyboard focus nor an accessible
  name (DOM confirms tabindex/role null). Give it the established labelled focusable region
  treatment and check scrolling by keyboard. Some browsers auto-focus scroll containers;
  do not claim universal keyboard failure from this source observation alone.
- File.text() has no sequence guard; a late file read can replace newer pasted/selected input.
  Inspection completion unconditionally clears manifest, including typed-ahead content.
- One global sequence discards an earlier write response when an unrelated row write starts.
  Verify out-of-order writes reconcile both successes without losing local drafts or implying
  that a discarded result was rendered. Add pending/recovery states instead of hiding ambiguity.
- Historical report selection leaves the previous/live report visible while the new selection
  is pending. Use an explicit loading/error state tied to the selected snapshot.

Opened004a1. M4 remains open;004a is not yet fully accepted.003e1's bounded unit evidence permits
the next undeployed contract slice; integration gates stay open. The003g candidate was read and
reviewed separately in the new003g job, including required corrections before implementation.

The logo was absent in the minimal fixture because its static route served assets only; that
is a fixture limitation, not a reported product defect. Internal screenshot saved outside the
repo as everstreet-import-1280.png in this chat's visualization directory. No walkthrough sent.
