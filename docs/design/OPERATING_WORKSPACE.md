# Operating workspace (job 001h)

Claude, 2026-11-04. Authority:
- the job: [001h](../astra/jobs/2026-11-04_001h_operating-workspace.md);
- the visual direction: [EVERSTREET_UI_DIRECTION](EVERSTREET_UI_DIRECTION.md) (Operate);
- the baseline review: [OperationsDesignReview](../astra/2026-11-04_OperationsDesignReview.md).

**Not changed:** accounting semantics, data sources, endpoints, authority rules and the
legacy (class/service) desk. Two server changes are additive: the desk projection gains the
released product's identity, and the operations preview gains fictional multi-month records.

## The problem (actual baseline)

The digital desk was one long serial page: header with eight equal buttons → status line →
operating summary → books explanation → balances → two money charts → table → digital
operations (tiles, notice, two charts, table) → AI spend → cost form → checklist, inquiries,
imports, growth → sidebar. The first useful chart sat far down the page. The worker notice
appeared twice.

In both customer charts the two series computed to the same cobalt (`--mint` aliases
`--cobalt`, `--blue` equals it), in the legend and in the SVG fills. A released product read
"Untitled product" because the desk named it from the latest brief, not the release.

## Composition (digital businesses)

```
header: Software · products facts · page state
        Business name                                [one next action]
        Public page · Value · Ownership and continuity · Sale and handover   (quiet links)
local nav: Overview · Performance · Products · Customers and growth   (?view=, Back/Forward)
┌──────────────────────────────────────────────────────────────────────────────┐
│ view panel (all four stay mounted, inactive ones hidden: drafts survive)     │
└──────────────────────────────────────────────────────────────────────────────┘
```

| View | What it answers | Contents (all existing pieces) |
|---|---|---|
| **Overview** | What is running, what needs action, what customers receive, what it costs | Status line; **Needs you** / **Waiting on the system** (work items, each a link); settlement state once; four operations tiles; the **customer uses chart**; product identities in one line each; a link to Performance |
| **Performance** | The numbers, with sources | Period; balances; earned/costs/contribution chart; cash chart; categories; every-figure table; digital operations (tiles, uses chart, runtime cost chart, table, basis); AI spend; **Add a cost** (opened deliberately) and the costs you entered |
| **Products** | What exists and what customers use | Product cards: the **released identity** (name and revision of the active release) apart from a divergent **draft** brief name; status, offers, exact contract price; Open studio, Customer access, View as a customer; New product project; imported products; Public profile; the page's legacy offering and its missing facts |
| **Customers and growth** | People and reach | Checklist; people who responded (reply drafts kept); payments setup, sessions, requests that might fit, update posting (DeskGrowth); share; team; selling; take the page down |

**The next action** in the header follows the work. It is the first "needs you" item, otherwise
the studio action (open the one product, choose among several, or start one). There is one
primary button; the rest are quiet links.

## Every existing action, and where it is now

| Action (before) | Now |
|---|---|
| View public page, Value, Ownership and continuity, Sale and handover | Header link row (every view) |
| Open product studio / Choose a product / Start a product | Header primary, unless a work item comes first; also on Products |
| Public profile; Edit page and legacy offering | Products |
| Work items (customer access, studio, continuity, inquiries, checklist) | Overview. Inquiries and checklist now link to `?view=growth` and scroll to their section |
| Product cards and their links; New product project | Products (Overview keeps a one-line identity per product) |
| Period, balances, charts, table, AI spend, Add a cost, costs entered and their corrections | Performance |
| Digital operations tiles and charts, table, basis, links to customer access, continuity and handover | Performance (tiles and uses chart also on Overview) |
| Checklist, responses and replies, DeskGrowth, Share, Team, Selling, Take page down | Customers and growth |
| Imports (DeskImports) | Products |
| Legacy offering card and missing list | Products |

Nothing is removed. The legacy desk (not digital) renders exactly as before.

## State, navigation and recovery

- **Views are kept mounted** and only hidden, so these survive a view switch:
  - the cost form;
  - reply drafts;
  - the update text;
  - the team choice;
  - the selling form;
  - loaded data.
- **Navigation:** `?view=overview|performance|products|growth`. Links push history, and
  Back/Forward select the view on the mounted page. An unknown or absent view means Overview.
  A hash (`#desk-inquiries`) scrolls to that section after the view shows.
- **Books are read once** for Overview and Performance (`useBooks`). Reads are sequenced, and
  401/403/404 drops every figure (003t).
- **The desk projection** keeps its sequenced loader (001c). The page is still keyed by actor and
  business, so a switch unmounts it and no stale owner answer reappears.
- **Loading, failed (retry), not started and partial states** keep their existing wording.
  Overview shows the books failure with Try again instead of an empty chart.

## Data series (charts)

Chart series now use `--data-*` tokens, kept separate from the brand action colour, **and** a
pattern, so they can be told apart in grayscale and without colour:

| Series | Token | Pattern |
|---|---|---|
| Charged / serving customers / earned / money in | `--data-primary` (cobalt) | solid |
| Returned to the customer | `--data-returned` (teal) | diagonal stripes |
| Founder trials and release checks | `--data-founder` (plum) | dots |
| Costs you entered | `--data-cost` (slate) | horizontal lines |

The existing series are unchanged:
- awaiting settlement: amber hatch;
- needs attention: error red;
- reserved, not settled: dashed outline;
- never reserved: grey;
- couldn't be read: amber hatch with "?";
- fictional history: dots and dashed line;
- this month so far / partial: dashed frame.

Legends draw the same pattern. Every figure stays in the month's ARIA label, the detail line and
the table. The same palette applies to the books chart (earned versus costs were also
identical), and to the buyer's digital performance charts (customers versus founder).

## Released identity

`digitalDesk` products gain `released: { name, revision } | null`. It is read from the active
release's built artifact, the same source the customer workspace uses (`customerUse.productName`).

The Products card shows the released name as the product's name. When the latest brief's name
differs, it adds "Draft brief (revision N): <name>". With no release, the brief name is shown as a
draft. Nothing is renamed; a newer draft never relabels the release.

## Preview

`npx tsx scripts/preview-operations.ts`: the operations preview plus fictional multi-month
records, labelled as such:
- founder costs entered through the app in earlier months;
- fictional example revenue history for earlier months (the books' existing "Fictional example
  history" basis);
- a second, brief-only product;
- a second, empty digital business for the empty state.

Customer uses remain this month only, and recorded zeros earlier. The preview never backdates a
customer use.

## Not in this job

- the legacy desk redesign;
- acquisition (001i) and customer (001j) compositions;
- live provider, chain or payment integrations;
- Helping's stale-state concern (delegated-operator follow-on).

All six milestones remain open.
