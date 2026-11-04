# Canvas studio: composition and interaction map (job 001g)

Claude, 2026-11-04. Authority:
- the job: [001g](../astra/jobs/2026-11-04_001g_canvas-studio.md);
- the visual direction: [EVERSTREET_UI_DIRECTION](EVERSTREET_UI_DIRECTION.md) (Studio, flagship);
- the visual system: [UI_SYSTEM_001F](UI_SYSTEM_001F.md).

This job reorganizes the studio's existing capabilities. No endpoint, stored record, authority
rule or runtime behaviour changes. It builds on [STUDIO_WORKSPACE](STUDIO_WORKSPACE.md) (001b,
001b1).

## What changes, in one line

The old studio put a wall of forms on the left (assistant, brief, screens) beside a preview. Now
the product canvas is the main surface. A conversation **companion** sits at its side.
**Contextual tools** open for the one element you select in an explicit **Edit** mode.

## Composition

```
┌ header: Product studio / Business · Product name · foundation · release chip ··· save state · [one next action]
├ summary line: Release · Customer offer · Progress and status ▸            (unchanged, 001b1)
├ banners: kept-draft offer · save error · saved                          (unchanged)
├──────────────┬──────────────────────────────────────────────────────────────────────────┐
│ COMPANION    │ CANVAS TOOLBAR  Shape: Preview Brief Proposal Versions Checks │ Run: Builds Service Continuity   [Try it | Edit]  [Companion]
│ source note  ├───────────────────────────────────────────────┬──────────────────────────┤
│ work log     │ STAGE (local dark surface)                    │ CONTEXT TOOLS            │
│ composer     │  ┌ prototype frame ─────────────────────────┐ │  what is selected        │
│ outbox       │  │ nav │ screen                              │ │  its editor only         │
│              │  └──────────────────────────────────────────┘ │  undo / redo             │
│              │                                               │  note · Save · Discard   │
└──────────────┴───────────────────────────────────────────────┴──────────────────────────┘
```

- **Companion (left, about 320 px).** The source note, then the conversation (work log, composer,
  outbox), always mounted. It isn't a tab of a form panel any more, so the conversation never
  shares space with field lists. Its "Edit the brief yourself" opens the Brief view in Edit mode.
  On the Run views it is hidden (still mounted) unless asked for, as before.
- **Canvas toolbar.**
  - The same eight views, in one tablist, visually grouped as **Shape** (Preview, Brief,
    Proposal, Versions, Checks) and **Run** (Builds, Service, Continuity).
  - The view ids, `?view=` and `&task=` links, and Back/Forward are unchanged.
  - The mode switch appears on Preview and Brief.
- **Stage.**
  - Preview puts the prototype frame on a local dark surface, the one dark area the direction
    allows "where useful".
  - Brief shows the brief as a document.
  - Every other view renders exactly as before, full width.
- **Context tools (right, about 320 px; below the stage when the canvas is narrow).**
  - With an element selected: its editor only.
  - With nothing selected: an outline. On Preview that is the screens (each selectable) and Add
    form / list / model step. On Brief it is the brief's sections.
  - The footer always has the change note, **Save revision**, **Discard changes** and **Undo** /
    **Redo**.

## Try and Edit

| Mode | What the preview does |
|---|---|
| **Try it** (default) | The prototype works as before: forms add sample entries, boards move them, a model step says no model is connected. Nothing is selectable. |
| **Edit** | Nothing submits: no `<form>`, no input that can take sample data. Each supported element becomes a selectable outlined button. Selecting one shows its tools. Sample entries are kept untouched and come back in Try. |

The mode is per studio, not per view: switching between Preview and Brief keeps it.

### Supported selections (each is a real edit to the saved schema)

| Element in the preview | Context tools edit | Schema |
|---|---|---|
| Product name (frame bar or brand) | Product name | `brief.name` |
| A screen in the nav, or its heading | Screen title; for a form its fields and button; for a list its source and stages; for a model step its source and outputs; remove the screen (with the existing guards) | `prototype.screens[i]` |
| A form field | Label, type, choice options, remove (the existing last-field guard) | `screens[i].fields[j]` |
| A form's button | Button text | `screens[i].submit_label` |
| A list's columns or board stages | Stages (comma list) and the form it reads from | `screens[i].stages`, `.source` |
| A model step's result row | Output label, type, remove | `screens[i].outputs[j]` |
| A Brief section (audience, problem, promised result, core features, pricing) | That brief field only | `brief.*` |

**Not selectable, and why** (shown as a short line in Edit):
- *The model step's "No model is connected" notice.* Model behaviour comes from a build, not from
  this schema.
- *Sample entries in lists and boards.* They are Try data in this tab, not part of the design.
- *The foundation and "Where it started".* They are set when the project is made.

### Keyboard

- The mode switch is two buttons (`aria-pressed`).
- In Edit, every selectable element is a real button in reading order, with a visible focus ring
  and its role in its name (for example "Edit field: Invoice file").
- **Enter or Space** selects an element, and focus moves to the first control of its tools.
- **Escape** inside the tools returns focus to the selected element in the stage. The selection
  stays.
- **Ctrl/Cmd+S** saves from anywhere, as before.
- Undo and Redo are buttons. Ctrl+Z is left to the text fields' own undo.

## State that must survive (and where it lives)

| State | Lives in | Survives |
|---|---|---|
| Unsaved brief and screens (draft) | `ProductStudio`, plus this browser (per person, project, owner epoch) | view, mode, selection, companion toggle and narrow layout switches; reload (offered back) |
| Conversation text, outbox, pending or lost request | `ConversationPanel`, mounted once, keyed by scope | every switch; a scope change starts it clean (as before) |
| Sample entries | `ProductStudio` (`sample`) | mode and view switches |
| Mode and selection | `ProductStudio` | view switches; a selection whose element no longer exists (after apply, restore, discard or remove) resolves to nothing, never to a different element |
| Undo history | `ProductStudio`, in memory | until save, discard, restore, apply or reload; bounded at 50 steps; typing in one control coalesces into one step |
| Service (trials, checks, offers) | mounted once opened (002c1) | unchanged |

**Owner fencing is unchanged.** A proposal from before a sale still can't be used, and drafts and
conversation stay keyed by owner epoch.

**Undo is local to unsaved edits.** It never touches a saved revision, a release or a customer
offer. Restoring a revision still creates a new revision and is refused while there are unsaved
changes. The Versions view says the released build doesn't change.

## Layout widths

- **≥ 1281 px:**
  - Shape views: companion, stage and tools side by side.
  - Run views: the canvas takes the full width.
- **1001–1280 px:** the same layout. The tools column narrows, and below an 880 px canvas
  (container query) it moves under the stage.
- **≤ 1000 px (and 390):**
  - The companion is opt-in (**Companion** button, still mounted).
  - The view tabs scroll.
  - The stage comes first and the tools sit right under it. Selecting moves focus there.
- **The save bar (001g1):** it is never sticky; it sits in normal flow at the end of the tools.
  On wide screens the tools card is sticky below the sticky site header (`--studio-clear-top`),
  and its body scrolls inside it. Below the stage the tools are ordinary page content. Focus
  moved into the tools or back to the stage lands clear of the header (scroll margins, and
  `reveal` scrolls only as far as needed).
- **Reduced motion:** no transitions beyond the existing global rule. Nothing animates to imply a
  run or a pass.
- **Zoom:** the tools column becomes a stack under the stage through the same container query.

## Honest gaps (unchanged by this job)

- No arbitrary generated code. The prototype is a schema render and says so. Building, checks,
  release and customer access are the existing Builds/Service views, unchanged.
- No drag-and-drop or reordering of screens and fields (there is no reorder in the schema editor
  today).
- M1 and M2 stay open. Visual approval is Astra's browser review.
