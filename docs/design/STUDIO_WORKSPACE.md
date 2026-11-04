# Studio workspace and navigation (job 001b)

Claude, 2026-11-04. Authority: [001b](../astra/jobs/2026-11-04_001b_studio-workspace-and-navigation.md).
It reorganizes existing capabilities. No endpoint, authority rule or stored record changed.

## Navigation

**Desktop.** The ink rail is unchanged, plus a **Buy and hand over** group with Acquisitions and
**Handovers** (new in the rail).

**At 1000 px and below**, the rail becomes a compact sticky bar: the wordmark and a **Menu**
toggle.
- The toggle is labelled and carries `aria-expanded` and `aria-controls`, and shows the unread
  Inbox count.
- Opening it shows the grouped links, at least 44 px tall each, and moves focus to the first link.
- Escape closes it and returns focus to the toggle. Any route change closes it.
- While it's closed the links are `display: none`, so they aren't in the tab order. The open list
  scrolls inside itself, with no scroll trap.
- The acting-context bar is no longer sticky on narrow screens, and drops its "Acting as" prefix
  (the name and avatar stay).
- The environment strip and a preview's label strip stay.

**Routes.** The router now ignores a query when matching routes, so links like
`/build/:id?view=service&task=customers` work. This also fixes `/build?business=…`, which
previously matched no route.

## Studio: shaping and operating

| Kind | Tabs | Layout |
|---|---|---|
| Shaping | Preview, Proposal, Brief, Checks, Versions | Assistant/brief/screens editor beside the canvas, as before |
| Operating | Builds, Service, Continuity | The canvas takes the whole width; **Show the editor** (`aria-expanded`, says "(unsaved)" when there are unsaved edits) brings the editor back |

- **The editor is hidden, never unmounted** (`StudioBody`). The conversation's unsent text and
  outbox, the unsaved brief and the save bar keep their state. The header always shows the save
  state and the Save button.
- A global `[hidden] { display: none !important }` makes hidden panels stay hidden whatever their
  class's display.

**Service is organized into three tasks**, as a segmented control:

| Task | What it holds |
|---|---|
| **Try** | Trials, the runtime budget, your requests |
| **Evaluate and release** | Release checks, checks and release, the latest check |
| **Customer access** | The offer setup |

- All three stay mounted; the others are only hidden.
- A summary above them states the active version, whether running products is available here,
  and the runtime budget.
- **Each task's button names what it holds that mustn't be lost:**
  - "needs a check": an unresolved trial;
  - "running": a trial in flight;
  - "check running";
  - "needs attention": an offer create without an answer, unconfirmed access, or a retire
    waiting for confirmation.
- Offer readiness is now a summary (the count, plus the first next step), with every row under
  "All N readiness items".

## Version and capability truth

The hardcoded project-wide "Prototype" chip is gone. `projectStatus` (`web/src/studioStatus.ts`)
derives the chip, a status strip and the header's next step from actual records:
- the studio view: the head revision and whether building is available;
- `GET .../releases`: candidates, their latest check and the active release;
- the business's customer offers for this product.

| Chip | When |
|---|---|
| Released build | There is an active release |
| Built, not released | There are candidates but no release |
| Prototype only | There is no build |
| Status unknown | The records couldn't be read |

**The strip.** It lists the brief revision (or unsaved changes), the build (with its source
revision), the checks, the release, the customer offer and Sale and handover. Each item takes you
to the existing view, the Service task or the route.
- An active release names its build's revision, and says when the brief has changed since. A
  newer brief never relabels the release.
- A release carries the note that it doesn't show a live provider, wallet or network.
- Failed or unchecked builds never read as released. Unreadable records are "Couldn't be read
  just now".

**The step rail** reads: Shape, Choose, Build, Test, Release, Customers, Continuity, Business.
Build, Test, Release and Customers take their state from the same records. The header's next
step follows the brief's own to-dos first, then the status's next step.

**When records are re-read.** On mount, on each tab change and after a save: one releases read and
one offers read. There is no polling.

**Entry points.**
- The business desk's product rows link to **Releases** and **Customer access** directly.
- The buyer's handover receipt lists each owned product with a **Customer access** link (read
  through the owner's own project list).

## Preview

```
npm run web:build
npx tsx scripts/preview-studio.ts      # site 127.0.0.1:8816, controls :8817
```

As Ava (released with a newer brief, failed check, brief only):
- `/build/<released>`, `/build/<failed>` and `/build/<draft>`;
- `?view=service&task=customers`;
- `/desk/<business>`.

Building is deliberately not connected in the served app; trials run on a scripted runtime. The
controls are `GET /` state, `POST /lose/…` and `POST /provider/fail`. The amber label strip says
it is synthetic.

## Remaining gaps

- **Builds unmount.** The Builds view still unmounts when you leave its tab, as before. Its jobs
  are server-side and reload.
- **Mobile layout.** On narrow screens the studio's shaping tabs still put the editor above the
  canvas.
- **Not verified by tests:** browser layout at 1440/1280/390, 200 % zoom and the menu's keyboard
  behaviour. They need Astra's visual and keyboard review; the tests are structural and logical.
- **Handover status.** No aggregate handover status is shown in the studio: the strip links to
  Sale and handover rather than summarizing it.
- **Milestones.** M1 and M2 are not complete. All six milestones stay open.
