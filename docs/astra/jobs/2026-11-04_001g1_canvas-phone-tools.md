# Keep phone context tools visible and usable

P1/S-M after001f2.001g is implemented but not accepted: Astra reproduced a phone editing blocker.
Do not broaden this into another Studio redesign. Preserve the approved canvas direction.

## Reproduction and cause

Actual scripts/preview-studio.ts UI at69940a0. Ava, released/newer brief project, Preview -> Edit,
Enter on Edit field: Document or text, change label to Invoice text. Enter correctly focuses
#ctx-first and Escape returns to the canvas. Desktop1440/1280 works. Change to390x844, Enter on
the selected part again. The focused input is covered by the Save/Undo footer. This is not only
a screenshot artifact: document.elementFromPoint at the input center returns Save revision.

Observed focused input viewport y791.8/h34; footer y702.1/h154.5, position:sticky;bottom:0.
.ctx-tools becomes position:static on the narrow container, but its inherited .ps-savebar stays
sticky at bottom0 and shifts upward over the heading/input. Screenshot canvas-001g-phone-2026-11-04.jpg.
Keyboard focus exists but cannot be seen. The full-page image also shows a mostly blank tools card.

## Required result

Selected phone tools, heading, Done and input remain visible and operable together. Save/Undo
must not cover the editor. Choose ordinary document flow or a genuinely nonoverlapping bounded
tools layout; preserve narrow-screen focus return and useful access to save/recovery. Check long
brief/pricing/features, field choice options and screen controls, not just the short label.
At desktop preserve comfortable canvas space and accessible tools. In Try mode an entire empty
editing rail wastes canvas space; consider a compact hint/save state if safe, but do not let this
optional refinement delay the overlap correction.

## Done when

- Actual390 browser repeat shows the focused input unobscured, can edit by keyboard/touch, Done
  and Escape return to target, save persists a revision without altering released service.
-1440/1280 and narrow/zoom-equivalent layout have no overlapping editor/footer; long tools remain
  scrollable with focus visible. Confirm tab-list overflow remains keyboard accessible.
- Preserve per-scope drafts, selections, sample state, typed conversation, Undo/Redo and recovery.
- Meaningful finite check of layout/interaction regression where tooling supports it, npm check
  and webbuild; report which browser checks require Astra. Local commit then stop for review.

No provider/RPC/wallet/main wiring/signing/deploy/push/public release/spending/real data/research/
Day One. Exact Opus5.5/high; one writer. All six milestones and larger roadmap remain open.
