# 001g1 Canvas phone tools: report

Builder: Claude (Opus 5.5, high), sole writer. Job: `jobs/2026-11-04_001g1_canvas-phone-tools.md`.

## Cause

`.ps-savebar` kept `position: sticky; bottom: 0` from 001b, when it was the footer of the
side editor. In 001g it moved into the context tools. On a narrow canvas (container ≤ 880 px)
`.ctx-tools` becomes `position: static`, so the save bar stuck to the bottom of the viewport. It
then covered whatever sat above it, including the focused `#ctx-first`. That matches Astra's
`elementFromPoint` result (Save revision) at 390 px.

A related desktop issue found while fixing it: the sticky tools card used `top: 12px`, but the
site header is sticky too. When scrolling, the tools' heading (and Done) could slide under the
header.

## Fix (CSS and focus only; no state or behaviour change)

- **Save bar:** `.ps-savebar` is no longer sticky at any width. It sits in normal flow at the
  end of the tools: undo/redo, note, Save, Discard. On wide screens it is the last row of the
  sticky tools card, below the body, which scrolls inside the card (flex column), so it can't
  overlap the editor. The header's Save stays available on every view.
- **Narrow canvas:** the tools are ordinary page content: heading and Done, the editor, then the
  save bar. `.ctx-body` gets `overflow: visible`, so long tools (features, pricing, choice
  options, whole-screen editors) scroll with the page, and focus scrolls the page itself.
- **Header clearance:** a studio variable, `--studio-clear-top` (116 px on desktop, 136 px for
  the compact two-row header):
  - places the sticky tools card below the sticky site header, with
    `max-height: calc(100vh - offset - 12px)`;
  - sets the scroll margins of tool controls, stage picks and view tabs, so anything focused or
    scrolled to lands clear of the header.
- **Focus:** a new `reveal(el)` helper focuses with `preventScroll` and then scrolls only as far
  as needed (`scrollIntoView({ block: "nearest" })`, which honours the margins). It is used for
  Enter (moving into the tools), Escape and Done (back to the stage), and the header's Next.
- **Not done:** the optional Try-mode rail simplification. It would change the desktop
  composition, and the brief says it must not delay this correction.

Unchanged: drafts per scope, selection, sample state, conversation, Undo/Redo, recovery,
desktop composition, and the keyboard model (Enter, Escape, Done, arrow keys on the view tabs).

## Verification

- `web/test/canvasPhoneTools.test.ts` (5 tests) reads the actual `styles.css`:
  - no rule makes `.ps-savebar` sticky or fixed;
  - the narrow container block makes `.ctx-tools` static with `max-height: none` and
    `.ctx-body` `overflow: visible`;
  - the sticky tools card uses `--studio-clear-top`, defined for both header sizes at
    104 px or more and 125 px or more;
  - picks and tool controls carry the scroll margin;
  - `reveal` focuses without the browser's own jump, then scrolls to the nearest position.
- Existing canvas tests (`canvasEdit`, `canvasStudio`, `studioLayout`) pass unchanged.
- **Mutants**, each run alone with a time ceiling, all killed:
  1. the sticky save bar restored (the original bug);
  2. the tools scrolling inside themselves on a narrow canvas;
  3. the tools card sticky at `top: 12px`.
- `npm run check`: lint and types clean, **1028 tests / 102 files passed**.
- `npm run web:build`: passed (820.01 kB bundle; same size advisory as before).

## Browser gates I cannot check (no browser tool): for Astra's repeat

Use `npx tsx scripts/preview-studio.ts` (8816/8817), as Ava, on the released project.

- **390×844:**
  - Preview → Edit, Enter on a field. `#ctx-first` should be fully visible, with
    `elementFromPoint` at its centre being the input itself.
  - Edit it by keyboard and by touch; Done and Escape return to the field.
  - Save makes a revision; the release and customer offer don't change.
  - Repeat with long brief features, pricing, a choice field's options and a whole-screen
    editor.
- **1440 and 1280:** scroll a long page. The tools card should stay below the site header, its
  body should scroll inside it, and the save bar should stay at its end without overlapping.
- **Zoom (200 %):** the tools should drop under the stage with no overlap.
- **Tab overflow:** arrow keys across the scrolling view tabs at 390 px.
- **Header estimate:** the 136 px compact-header clearance is an estimate of the two-row header
  (wordmark plus Menu, then the destinations). With the Menu open the header is taller; a
  focused control could then sit under the open menu until it is closed.

## Scope

001g stays in review until Astra repeats it. 003u2, 001h, 001i, 001j and 004b were not started.
All six milestones remain open. No provider, RPC, wallet, signing, deploy, push or spending.
Searches used tracked-file `git grep` on named paths only.
