# Studio workspace and navigation (job 001b)

Claude, 2026-11-04. Authority: [001b](../astra/jobs/2026-11-04_001b_studio-workspace-and-navigation.md).
It reorganizes existing capabilities. No endpoint, authority rule or stored record changed.

**Superseded in part by [CANVAS_STUDIO](CANVAS_STUDIO.md) (job 001g).** The left editor is now
the conversation companion only. The brief and screen controls are context tools beside a
Try/Edit stage. Everything below about the query links, the Service tasks, the status records
and the summary line still holds.

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

## Corrections in 001b1

- **Status follows actual events.** `StudioRecords` (`web/src/studioRecords.ts`) holds the
  releases and offers the status is derived from.
  - **Signatures.** Builds, Service (releases, candidates, checks, the latest run) and the offer
    setup each report a small signature of what they now show, after reloading their own records
    following an action.
  - **When it re-reads.** On a real change, the store reads both records again. A panel's first
    report counts as its load, not a change. A failed action changes no signature, so it triggers
    no read.
  - **Reading rules.** Reads are sequenced and coalesced: at most one in flight and one queued,
    however many events arrive. They are dropped after the page closes. A 404 clears the records
    and stops reading. Other failures read "unknown".
  - **Triggers.** Load, a save, or a reported change. Tab switches no longer read; there is no
    polling.
  - Retiring an offer now updates "Customer offer" at once.
- **Density.**
  - **The summary line.** The step rail and the status cards are gone. One line under the header
    shows **Release** and **Customer offer**. **Progress and status** is a native
    `<details>`/`<summary>` disclosure holding every status item, plus brief checks and the
    business page, each going to its view.
  - **Still visible:** unsaved, pending and error indicators (the save state and Save, banners,
    Service task badges).
  - **On desktop** the canvas starts right after the header, the summary line and the tab bar.
  - **At 1000 px and below:**
    - the editor is opt-in for every view (kept mounted, shown with **Show the editor**);
    - tabs scroll horizontally;
    - the chosen view and its first control come right after the header and the summary line.
  - **The editor toggle** moved out of the tablist into a tab bar.
- **Query-only navigation.** The router tracks the query as well as the path. Routes match the
  path, so `/build/:id?view=…&task=…` (including Back/Forward) keeps the studio mounted and only
  selects the view and task (`viewFromSearch`). A plain URL returns to Preview and leaves the
  Service task unchanged.

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
- **Mobile layout.** Since 001b1, the editor on narrow screens is opt-in for every view.
- **Not verified by tests:** browser layout at 1440/1280/390, 200 % zoom and the menu's keyboard
  behaviour. They need Astra's visual and keyboard review; the tests are structural and logical.
- **Handover status.** No aggregate handover status is shown in the studio: the strip links to
  Sale and handover rather than summarizing it.
- **Milestones.** M1 and M2 are not complete. All six milestones stay open.
