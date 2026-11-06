# Direction B: "Editorial briefing"

## The idea

The month is told to Delphine as a short morning read: a dateline, one headline, two paragraphs
with the figures inline, then four numbered chapters (Today, Day by day, The three businesses,
On NEAR), each a narrative column with the dry facts in a margin column beside it. Charts are
small multiples, one labelled row per business on a shared TUSD scale and a separate USD row for
compute, and the Signalwatch sale is a story card whose pending steps are drawn as outlined,
dashed circles that only fill when a side actually accepts.

## Files

- `index.html`: the mockup, self-contained; the sample JSON is embedded as `DATA` and every
  figure on the page is derived from it at load (no hand-typed numbers except the three unit
  prices and the people's names, which the JSON does not carry).
- `desktop.png` (1440 x 4620) and `phone.png` (390 x 7900).
- `phone-frame.html`: headless Chrome will not open a window narrower than 500 px (verified:
  `--window-size=390` gives a 500 px viewport cropped to 390), so the phone shot goes through this
  frame, which holds the mockup in a 390 px iframe:
  `node design/dashboard/shot.mjs design/dashboard/b/phone-frame.html design/dashboard/b/phone.png 390 7900`.
  Without it, every "390 px" screenshot from `shot.mjs` is really a 500 px layout.

## What changed after looking at it

Round 1 (desktop 1440, phone 390):

- The headline orphaned "month." on its own line; the measure was widened so it sits on one line.
- The glance strip's small sub-lines wrapped mid-phrase ("9 6 new · 9 / returning"); the unit now
  sits beside the number and the qualifier is its own line, and the captions were cut to source
  and freshness only.
- "Not recorded" at headline size wrapped to two lines; it is set smaller, in the secondary text
  colour, so it reads as an absence rather than a figure.
- The small multiples sat in the narrow narrative column and Ledgerline's 2 TUSD days were
  slivers; the chart section now spans the full width, rows are taller, and "How to read it"
  moved from the margin to a three-column note beneath.
- The Relaydesk desk's fourth box ("Median to resolve") wrapped to a second line; it is a four-up
  grid now (two-up on the phone) without arrows.
- The sale card's four-column facts list was cramped and showed "180000000 base units" inline;
  it is two columns and the base units moved to a hover detail and the "About" footer.
- A sentence said "your 386 customers' prepaid analyses"; 386 is analyses, not customers. Fixed.
- The phone screenshot was secretly a 500 px layout (see `phone-frame.html`).

Round 2 (phone crops and a scroll-width probe):

- The ownership table was 400 px wide at a 390 px viewport (sideways scroll). On the phone the
  generation column and "(you)" are dropped, padding and the mono account are smaller, and the
  state chips are shorter ("Not rehearsed", "Rehearsed", "Sale proposed"). A probe confirms
  `scrollWidth` is 390 with no element past the edge.
- The phone headline and lede were a size down from the desktop's 46/20 px.
- Desk box labels shortened ("of 42 opened", "hours") so they stop wrapping.

## What the data made awkward

- **The last day is empty.** `as_of` is Nov 6, 02:13 UTC, so Nov 6 has zeros everywhere; the
  chart note says "Nov 6 is only 2 hours old" so the trailing tick is not read as a bad day.
- **Signalwatch went quiet.** No analyses from Nov 1 to Nov 6. The text states it plainly
  ("nothing since Oct 31") rather than hiding it; it is the kind of thing a buyer will ask about.
- **Returning equals active** for every business (3/3, 4/4, 2/2) while "new" is 2, 3 and 1, so a
  new customer is also a returning one. The lede says "every one came back on more than one day"
  instead of a new-vs-returning split that would not add up. Customers are also counted per
  business: the 9 could be fewer people. The glance caption says "per business".
- **Compute is tiny.** $0.15 for the whole month and 0.22 cents per delivered invoice. Shown as
  cents where a dollar figure would round to nothing, with the microcents in the footer.
- **Runways** of 141, 208 and 2702 days: shown as "about 5 months (141 days)", "about 7 months
  (208 days)" and "over a year".
- **The buyer** is `buyer.near` in the data; the brief names him Noah Brandt, so both appear.
- `network_fees` is `null`: "Not recorded" everywhere it would otherwise sit, with "not 0" in the
  glance caption. Relaydesk's compute is a real 0: "No model cost".
- The spec's `--data-refused` / `--data-agent` tokens are not in `styles.css` yet; the quality bar
  defines a local slate cross-hatch for refused and an amber diagonal for incomplete, both
  labelled with counts so they read without colour.

## Not done / to check when built

- Contrast is from the measured token pairs in `styles.css`; the two local pattern colours
  (refused slate, incomplete amber on their soft fills) have not been measured.
- Keyboard: one tab stop per chart is satisfied (SVGs are `role="img"` with a text alternative,
  plus one `<details>` daily table), but no screen reader run was made.
- A serif display face would push the editorial feel further; the brief says to stay on the
  app's stack, so this uses Segoe UI Variable Display.
