# Direction A: "Operator's cockpit"

## The idea

A founder who checks figures every morning gets one dense screen: six source-stamped figures
across the top, a stacked daily revenue chart with one series per business (colour and pattern
follow the business everywhere on the page), and a right rail that is her to-do list: what needs
her today, the Signalwatch sale as a stepper with the pending steps outlined, and who controls
each contract. Below, an eight-column businesses table and two operational panels (Relaydesk's
desk, Ledgerline's quality) keep the detail readable without disclosures, and the USD compute
chart sits in its own card with its own axis so TUSD and USD never share a scale.

## Files

- `index.html`: the mockup (one file; the sample JSON is embedded as `DATA`; charts are inline
  SVG built by small vanilla JS; hover and arrow-key reading of each day; a "Daily figures as a
  table" disclosure under each chart).
- `desktop.png` (1440 × 2060) and `phone.png` (390 × 5300): final renders.
- `phone.html`: a 390 px iframe around `index.html`, used only for the phone render. Headless
  Chrome on Windows will not open a window narrower than 500 px, so
  `shot.mjs ... phone.png 390 H` on `index.html` alone crops a 500 px layout (checked with a
  probe page: `innerWidth` was 500). `shot.mjs design/dashboard/a/phone.html ... 390 5300`
  gives the honest 390 px layout.

## What changed after looking at it

Round 1 (first desktop and phone renders):
- The six summary figures wrapped their source and freshness into a three-line tangle; the
  source tag now sits on its own line with the freshness under it.
- The "TUSD" axis title sat on the top tick and "US cents" was clipped on the compute chart;
  axis titles moved to the top-left corner with more headroom.
- The "today" label collided with "Nov 5"; the partial day is now a hatched column explained by
  a legend item ("Today, partial") and the chart footer, not an axis label.
- The release marker crossed the Oct 15 column; it now stands at the start of that day (the
  release went live at 11:58, so the whole column ran partly on release 2), labelled
  "Ledgerline release 2 · Oct 15".
- "Needs attention" ran title and detail together and put the link in the icon column; each item
  is now title, where to act, link, in one text column.
- The nine-column businesses table overflowed; Team and Rehearsal became one "Rehearsal · team"
  column, ownership became a short "Control" column, and the phone found that the first
  render was actually a 500 px layout (see `phone.html`).

Round 2:
- The table still clipped its last column: product only under the business name (the founding
  date lives in the Ownership card), smaller table type, and a 336 px rail. All eight columns
  fit at 1440.
- Phone: table cells were nowrap and clipped ("Rehearsal passed Oct"); they wrap on phone.
  Small-multiple ticks were odd (3.75, 1.25); short charts use two divisions.
- Phone: the compute chart had drawn a single slate total that did not match its per-business
  legend; it is now the same two-business stack at every width (two series, so it stays
  readable at 7 px columns).
- Phone: "Needs attention" moved from the bottom to right under the summary figures (the rail
  becomes `display: contents` in one column and that card takes `order: -1`).
- Ledgerline's quality bar drew the delivered segment solid while its legend swatch was dotted;
  one set of pattern classes now draws both swatches and segments.
- Compute chart on desktop went back to four axis divisions.

## Product and accessibility rules, as applied

- "Simulated history" and "Fictional" appear in the environment strip, a header pill, the
  as-of line and the footer. The buyer is shown as "Noah Brandt" with `buyer.near` beside it
  (the data has only the account).
- TUSD and USD are never added or on one axis: revenue is one card, compute another (its own
  axis in US cents), and the footer says so. No "profit" anywhere.
- Exact units: 137,000,000 base units and 15,120,000 microcents are in the footer and in
  `title` tooltips on the big figures and per-business credits.
- Unknown is not zero: network fees say "Not recorded" with the reason; Relaydesk's compute says
  "no model cost"; unknown-cost calls are shown as a count (0) beside every compute figure.
- Series are never colour-only: Relaydesk solid cobalt, Signalwatch teal stripes, Ledgerline
  magenta dots (the app's `--data-*` tokens and patterns); the stack order teal → cobalt →
  magenta was chosen with the dataviz palette validator so every adjacent pair stays apart under
  colour-vision deficiency. The quality bar uses the slate cross pattern for refused and plain
  slate for incomplete; the stage bar is one hue, two steps, with labels.
- Pending sale steps are outlined (the next one dashed cobalt), done steps filled; the close is
  never shown as confirmed.
- Keyboard: each chart is one tab stop; arrow keys, Home, End and Escape walk the days and read
  them in a live region; the daily table under each chart is the direct-table route. Text
  contrast uses the app's measured text tokens (`--text-3` on white ≈ 5.5:1).
- Phone: no sideways scrolling at 390 px; the revenue chart becomes three small multiples
  (each with its own labelled scale and month total), the table becomes labelled blocks.

## What the data made awkward

- Nov 6 is a partial day (as-of 02:13 UTC, every value 0): shown as a hatched "today" column
  and marked in the table and tooltip, so the dip at the right edge is not read as a bad day.
- Customers are counted per business (`customers.active` is per business); the "9 active"
  figure says "counted per business" because a customer of two businesses would be counted twice.
- "Delivered" as a share needs a denominator: delivered + not charged (110 of 135, 81%),
  which only Ledgerline really has (25 not charged); the others are 100%.
- Compute is tiny ($0.15 for the month, 0.22¢ per delivered invoice): the chart is in cents
  with sub-cent ticks, and the dollar figure carries the exact cents beside it.
- Signalwatch's 2,702-day runway reads as "over a year"; Ledgerline's 141 days as "about
  5 months" (rounded from the 7-day pace).
- The sale's `expires_at` is 15 days after as-of; the stepper has no timestamps for the two
  done steps because the data has none (it shows the terms instead).
- The release digest is shown as its first seven characters beside the sequence number.
- Small multiples on the phone use independent y-scales (Ledgerline peaks at 2 TUSD, Relaydesk
  at 6, Signalwatch at 4); a shared scale flattened Ledgerline to a few pixels. Each chart
  labels its own scale.

## Not done

- Hover and keyboard behaviour were reviewed in code, not exercised in a browser (no browser
  pane in this pass).
- The "Open records", "Open the desk", "Review terms" and "Rehearse handover" links point at the
  data's `link` paths or `#`; nothing is wired.
