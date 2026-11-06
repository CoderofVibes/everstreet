# Portfolio dashboard: design brief (plan step 7)

Three design directions for the founder's portfolio dashboard, as static mockups. Tony chooses
one; it is then built for real on the same data. This brief is the whole assignment.

## Who and what

**Delphine Marsh** (fictional) runs three small digital businesses on Everstreet and opens her
portfolio. Judges of a hackathon will also see this screen in a demo. In ten seconds she should
know: how the month went (money in, work delivered), what needs her today, and whether each
business is ready to hand over: one is in the middle of a sale.

- **Ledgerline**: AI invoice API (reads an invoice, returns fields). 0.40 TUSD per invoice.
- **Relaydesk**: a SaaS support desk (requests become cases worked through stages). 1.50 TUSD per
  request. Has a teammate (Priya, a case worker) and a passed successor rehearsal.
- **Signalwatch**: an agent service (flags what changes in suppliers' release notes). 4.00 TUSD per
  analysis. **Mid-sale:** a Direct sale to Noah Brandt for 180 TUSD, funded in escrow, not yet
  accepted by either side.

## Inputs (read these first)

1. **Tony's mockup:** `docs/astra/handoffs/2026-11-05/everstreet-portfolio-mockup.png`. Its layout
   is the starting point Tony likes (summary figures, a revenue chart, needs attention, NEAR
   ownership, the businesses table). The name in it is Tony's; use Delphine Marsh.
2. **Real data:** `design/dashboard/sample-dashboard.json`: the exact answer of
   `GET /api/me/dashboard` for Delphine's simulated month. Design with THESE numbers and shapes
   (including the awkward ones), not invented ones. Field meanings are in its `definitions`.
3. **The approved visual system:** `docs/design/EVERSTREET_UI_DIRECTION.md` and the tokens at the
   top of `web/src/styles.css` (mineral canvas, blue-black type, cobalt actions, restrained warm
   highlights, `--data-*` chart colours with patterns). Stay inside this family: three directions,
   one brand.
4. **Chart rules:** `docs/design/SHOWCASE_SPEC.md` (search "Not color-only" and the timeline row
   "k"): series are never colour-only, release markers are labelled, pending steps are outlined,
   never filled.

## What a founder wants to see (the content; every direction shows all of it)

- **The month at a glance:** earned revenue (TUSD), delivered requests and the share delivered,
  active customers (new and returning), known compute cost (USD), customer credits still prepaid.
  Each figure says its source (contract, runtime records, app records) and how fresh it is.
- **Revenue over time:** daily earned revenue for the 30 days, per business (or stacked), in TUSD,
  with the Ledgerline v2 release marked where it happened. **Compute cost is USD: its own chart or
  axis, never on the TUSD axis.**
- **Needs attention today:** the `attention` items (open cases, the sale awaiting acceptance, a
  business with no successor rehearsal), each with where to act.
- **Each business:** product type, current release number and date, delivered and success rate,
  customers, credits and how long they last at the current pace (`credits_runway_days`; very long
  runways read better as "over a year"), team, rehearsal status, ownership.
- **The sale in progress (Signalwatch):** price, escrow funded, who has accepted (neither yet),
  expiry, and the reassurance that customers' prepaid uses carry over. Show it as a state, with
  pending steps outlined.
- **Relaydesk's desk:** open cases by stage, resolved this month, median time to resolve.
- **Ledgerline's quality:** delivered vs not charged, and why (`not_charged_reasons`: refused,
  incomplete), because a refused request is never charged.
- **Ownership:** who controls each business on NEAR (owner account, generation), transfers so far.

## Hard rules (these are product rules, not style)

- **Labels:** the page says **"Simulated history"** and **"Fictional"** visibly (it's a demo on a
  synthetic chain with stand-in models). Don't make it look like real money or real customers.
- **Never add different currencies.** TUSD and USD are never summed, compared on one axis, or
  turned into "profit".
- **Amounts are exact:** TUSD values in the data are base units with 6 decimals (`137000000` =
  137.00 TUSD). USD compute is in microcents (1 cent = 1,000,000 microcents; `15120000` = $0.15).
  Show readable amounts; the exact base units can be a detail.
- **Unknown is not zero:** `network_fees` is `null` (not recorded): say "Not recorded", never 0.
  Relaydesk's compute is genuinely 0 (no model; say "no model cost").
- **Accessible:** text contrast meets WCAG AA; charts readable without colour (patterns, labels or
  direct labelling); a sensible reading order for keyboard and screen readers.
- **Phone:** it must work at 390 px wide (no sideways scrolling; charts simplify or stack).

## The three directions (one each; make them genuinely different)

- **A. "Operator's cockpit":** dense and analytical, close to Tony's mockup: a summary strip, a
  large revenue chart with per-business series, a right rail (needs attention, ownership, the
  sale), compact tables. For someone who checks figures daily.
- **B. "Editorial briefing":** calm and narrative: the month told in plain sentences with figures
  inline ("Ledgerline delivered 55 invoices…"), generous whitespace, small-multiple sparklines per
  business, the sale as a story card. For a quick morning read and for judges.
- **C. "Business cards and handover":** each business is a rich card (its own revenue chart,
  health, team, ownership and handover readiness), with the portfolio summary on top and the
  Signalwatch sale given the most visual weight as the hero of the page: what makes Everstreet
  different is the handover.

## Deliverable and process

- `design/dashboard/<a|b|c>/index.html`: ONE self-contained file: inline CSS and JS, the sample
  data embedded as a JS constant (copy it in), charts drawn as inline SVG by small vanilla JS. No
  external fonts, CDNs, images or network requests. Use the app's font stack and tokens.
- Include a top bar like the app's (Everstreet, Discover / Build / Operate / Acquire, "Acting as
  Delphine Marsh") so it reads as part of the product.
- **Look at your work and revise.** Render screenshots with
  `node design/dashboard/shot.mjs design/dashboard/<x>/index.html design/dashboard/<x>/desktop.png 1440 <height>`
  and `... phone.png 390 <height>` (pick a height that shows the whole page), open the PNGs, and
  critique them: hierarchy, alignment, spacing, legibility, chart clarity, label overlap, the
  phone layout. Do at least two improve-and-rerender rounds. Keep the final `desktop.png` and
  `phone.png`.
- Write `design/dashboard/<x>/NOTES.md`: the idea in two sentences, what you changed after looking
  at it, and anything the data made awkward.
