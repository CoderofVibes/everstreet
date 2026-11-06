# Direction C: Business cards and handover

## The idea

Each business is one tall card that answers "how is it doing, who runs it, and could it be
handed over tomorrow?" (its own revenue and compute charts, quality or desk figures, customers,
credits, team, rehearsal, ownership on NEAR). Above the cards, the Signalwatch sale is the hero:
a state, not a transaction (price, escrow held, "neither yet" accepted, expiry, a five-step
progress line where pending steps are outlined and never filled) with "customers keep what they
paid for" as the reassurance, because the handover is what makes Everstreet different.

## What's on the page

1. Shell: env strip ("Demo founder · Simulated history"), glass header with Discover / Build /
   Operate / Acquire, a "Fictional · Simulated history" chip, "Acting as Delphine Marsh".
2. The month at a glance: five figures, each with its source and freshness (contract block,
   runtime records, app records, treasury observation time). Network fees: "not recorded".
3. Hero: the Signalwatch → Noah Brandt sale. Terms as four tiles (escrow tile green = funded;
   "Accepted by" tile dashed = pending), a stepper (done = filled cobalt, your step = outlined
   cobalt, later steps = dashed outline), what carries over, Review / Decline.
4. Rail: "Needs you today" (the three `attention` items with where to act) and an "Ownership on
   NEAR" table (owner account, generation, transfers; Signalwatch marked "sale pending: no change
   yet").
5. Three cards on one shared revenue scale (0–6 TUSD a day) so they compare honestly; the
   Ledgerline card marks "Release 2" on Oct 15 with a labelled dashed line; compute cost is a
   separate slate chart in cents under each revenue chart ("its own chart and unit: never added
   to or compared with TUSD"); Relaydesk says "no model cost" in words. Each chart has a
   `role="img"` label and a "Daily figures as a table" disclosure with every day's numbers.
   Ledgerline gets the quality bar (55 delivered / 15 refused / 10 incomplete, colour + pattern +
   legend); Relaydesk the desk (received, assigned, resolved, median 47.6 h); Signalwatch a short
   sale note linking to the hero. "Ready to hand over?" rows: rehearsal, obligations, ownership.
6. Footnote: the fictional notice and the API's own definitions.

## What changed after looking at it

- Round 1 (desktop): per-delivered compute read "$0.00" (218,181 microcents rounds to nothing at
  two decimals) → sub-cent amounts now print as "0.22¢". Two legend swatches were missing (a
  class name collision) → fixed. The hatched compute bars read as noise at 10 px wide → solid
  slate, one series per chart, so no colour-only distinction is needed. The compute title wrapped
  into the big figure → shortened, the "never added to TUSD" line moved under the chart.
- Round 1 (phone): the first 390 px render was a 500 px layout cropped on the right. Headless
  Chrome clamps its window to 500 px wide, so `shot.mjs` cannot really render at 390. I rendered
  through a scratch wrapper page whose `<iframe>` is exactly 390 px wide (the mockup's media
  queries then apply); `phone.png` comes from that. Nothing outside `design/dashboard/c/` was
  changed; the wrapper lives in the session scratchpad.
- Round 2: the rail had dead space under the hero → the ownership table now fills it (and gives
  the brief's "Ownership" content one place on the page as well as in each card). The compute
  axis mixed "$0" with "¢" → one style. The release-marker legend got its own line. The page
  had outgrown the capture height twice → desktop is 1440×2600, phone 390×7120.

## What the data made awkward

- **Shared revenue scale.** Relaydesk's best day is 6.00 TUSD, Ledgerline's 2.00: on one scale
  Ledgerline's chart is short. Kept, because per-card scales would make 22 TUSD look like 63.
- **Compute is tiny.** Known compute is $0.15 for the month; daily values are fractions of a
  cent, so the compute axis is in cents and the exact microcents are printed beside it.
- **Customers across businesses.** 3 + 4 + 2 may double-count one person; the glance says
  "counted per business" rather than claiming nine distinct people. Returning (9) equals active
  (9) for every business, which looks like a mistake but is what the records say.
- **Runway.** Signalwatch's 2,702 days reads as "over a year"; 141 and 208 days as "about 5 /
  7 months".
- **Buyer identity.** The data has `buyer.near`; the brief names Noah Brandt. Both are shown.
- **Rehearsal is `null`** for two businesses: shown as "Not rehearsed yet" with an empty dashed
  ring, never as a failure.
- **Seller's step.** `seller_accepted` is false, so "You accept" is the highlighted next step;
  the spec's rule that the buyer's acceptance is never shown as the seller's task is kept ("Buyer
  accepts · Not yet", dashed).
