# Executable Studio still needs the approved canvas composition

The executable product path works through a separate Web app view, but its desktop composition
does not yet fulfill the approved Studio direction. The existing Prototype Preview canvas should
not be mistaken for completion of the executable-app experience. Preserve the functional work
and correct this specific presentation before claiming the Studio finished.

## Actual browser evidence

November4: finite preview2780/tab53, a4a12c9 UI (unchanged by subsequent host-only commits),
actual in-memory app/API and explicitly scripted provider. No engine or real model configured.
Signed in as fictional Ava; opened version2 through the explicit unchecked-preview warning.

- At1440x1000, first view is a full-width instruction form, budget field and version list. The
  generated product is absent until Preview is chosen. After opening it, its iframe starts at
  y848.89 and is480px high, so most of the product is below the initial viewport. The instruction
  textarea is1331.33px wide and88px high. Document1425px fits1440; this is a hierarchy problem,
  not horizontal overflow. Screenshot: `app-studio-desktop-stack-2026-11-04.jpg`.
- At1280, keyboard Enter on Compare works and shows the actual one-line45-to40 change. Document
 1265px fits. Focus stays at Compare; the Close action is earlier in document order. Treat focus
  placement as part of the composition correction, not a claim that keyboard comparison failed.
- Opening Show the companion exposes TWO separate instruction areas: Tell the assistant what
  you want (267.33px wide) and What should change? (871.33px wide). The companion explains brief
  proposals, whereas the other generates app versions. Their distinct effects are not expressed
  by a clear task choice. The app iframe now starts at y914.5 in a900px viewport.
  Screenshot: `app-studio-two-composers-2026-11-04.jpg`.
- Stop removes the frame. Tab closed, viewport reset, preview2780 stopped intentionally (exit1).
  No zoom/reduced-motion acceptance claimed: neither was exercised by changing viewport size.

## Required product result

Make the working app the central stage, with an adjacent compact task composer, clear selected
version and truthful check state. An unstarted/unchecked preview gets a useful stage placeholder
with the existing explicit preview choice; do not silently execute unchecked code. History,
comparison, budget and detailed evidence should be accessible tools, not blocks that push the
product below the fold. Keep all generation recovery, cost/cancel and authority boundaries.

One contextual writing area should own the active task. Clearly distinguish shaping the business
brief from changing executable app code; preserve both drafts and histories when switching.
No fake element editing or claim that the browser view passed isolated checks.

Opened `jobs/2026-11-04_001k_executable-studio-canvas.md`. JOBS is currently Claude-owned for002e2,
so Astra deliberately did not edit it concurrently; register the row at the next handoff. This is
an existing M1/M2/UI requirement, not a new milestone.003v and core integration remain required.
Astra changes: this review,001k brief,INDEX,two screenshots,ignored BUILD_STATE. No app edits.
