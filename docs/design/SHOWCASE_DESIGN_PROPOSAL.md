# Showcase design proposal: homepage example businesses and the portfolio dashboard

Fable 5.1, 2026-11-05. One design session, as agreed in `docs/astra/CLAUDE_RESUME.md` (plan items
2 and 7). This is input for Astra, who owns visual direction, to shape before Opus builds. It
respects `EVERSTREET_UI_DIRECTION.md` (luminous, stage and rail, mono for evidence), the tokens in
`web/src/styles.css`, and the data rules already in `server/src/economics.ts` and
`docs/design/PORTFOLIO.md`. Nothing here is built. Where a panel needs data the server does not
record today, it says **new data needed**.

All people, businesses, customers and amounts below are fictional. The demo founder is not Tony.

---

## 1. Summary

Two things, one story.

**The homepage lets a visitor run something within ten seconds.** Ledgerline, a fictional AI
invoice API, sits on the stage. The visitor picks one of three sample invoices, runs it against a
clearly labelled stand-in model (fixed rules, no AI provider, nothing charged or recorded), and
sees the fields come back. Under the result, two doors open on the same business: *Operate* (what
those runs look like to the owner: uses, compute in USD, credits owed) and *Acquire* (what a buyer
takes control of, and what customers keep). Two more example businesses, Relaydesk (SaaS support
workflow) and Signalwatch (agent that reads changelogs), stand beside it. Until their engines exist
they are shown as honest illustrations, not runs. Example businesses look different from real
listings and say so.

**The demo login opens a portfolio of three businesses owned by one fictional founder, Marisol
Teague.** Her 30 days of history were produced by running Everstreet's real flows on a simulated
chain, and every screen says "Simulated history". Ledgerline is mid-sale to a buyer. The dashboard
is per business first (Tony's mockup, corrected so compute in USD never shares an axis or a sum
with TUSD revenue), with an "All businesses" comparison view that never adds across currencies or
businesses. Every figure carries its unit and its source. When the same script later runs on NEAR
testnet, the labels flip to "NEAR testnet" and every transaction gets an explorer link.

---

## 2. Homepage

### 2.1 Structure, top to bottom (desktop, 1280 and up)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Everstreet   Discover  Build  Operate  Acquire                 My activity  Inbox  ◯ │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ STAGE                                                                                │
│ ┌ main ────────────────────────────────────┐ ┌ rail: EXAMPLE BUSINESS · SAMPLE DATA ┐ │
│ │ BUILD, RUN AND HAND OVER DIGITAL          │ │ Ledgerline        AI invoice API     │ │
│ │ BUSINESSES                                │ │ Paste an invoice; get the fields     │ │
│ │ What do you want to build?                │ │ back, exactly, or an honest refusal. │ │
│ │ AI tools, SaaS, APIs, agents and online   │ │                                      │ │
│ │ services. Shape it here, open it to       │ │ Try a sample                         │ │
│ │ customers, and if you ever sell, hand it  │ │ (•) A clean hosting invoice          │ │
│ │ over on NEAR without breaking what        │ │ ( ) Lines that don't add up          │ │
│ │ customers were promised.                  │ │ ( ) Not an invoice at all            │ │
│ │ ┌───────────────────────────────────────┐ │ │ [ Run the sample ]                   │ │
│ │ │ Describe the idea…                    │ │ │ Stand-in model: fixed rules, no AI   │ │
│ │ │                               [Start] │ │ │ provider. Nothing is charged or      │ │
│ │ └───────────────────────────────────────┘ │ │ recorded.                            │ │
│ └───────────────────────────────────────────┘ └──────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ WAYS IN                                                                              │
│ [Start building] [Bring an existing product and see what it needs to launch or       │
│                   transfer.] [Explore acquisitions] [Find a solution]                │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ EXAMPLE BUSINESSES                                                                   │
│ Three fictional businesses you can follow from a customer's first use to a sale.     │
│ Sample data; simulated outcomes. Not for sale and not real listings.                 │
│ ┌ Ledgerline ───────────────┐ ┌ Relaydesk ────────────────┐ ┌ Signalwatch ─────────┐ │
│ │ AI invoice API            │ │ SaaS support workflow     │ │ Agent service        │ │
│ │ Founder: Marisol Teague   │ │ Founder: Marisol Teague   │ │ Founder: M. Teague   │ │
│ │ 1 unit per delivered read │ │ 1 unit per request sent   │ │ 1 unit per delivered │ │
│ │ [Try a sample]            │ │ [Not tryable yet]         │ │ [Not tryable yet]    │ │
│ │ Operate ▸  Acquire ▸      │ │ See the planned flow ▸    │ │ See the planned run ▸│ │
│ └───────────────────────────┘ └───────────────────────────┘ └──────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ CONTINUE BUILDING (signed in only; unchanged)                                        │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ON EVERSTREET NOW  Real businesses published on this computer.      [All][Software]… │
│ editorial list (unchanged)                                                           │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ WHAT PEOPLE ARE ASKING FOR (unchanged)                                               │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▸ What works on Everstreet today  (small disclosure; the six-stage readiness list)   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ BUILT TO CHANGE HANDS INTACT  (dark band, unchanged)                                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

What changes against `web/src/pages/Home.tsx` today:

| Today | Proposed |
|---|---|
| Stage rail: the featured *published* product, or the six-stage readiness list | Stage rail: the Ledgerline **try panel** (always runs). See open question 1 for what to do when a real published product with an example also exists. |
| Four entry tiles; import lead "Inspect its package.json and see what handing it over would take…" | Same four tiles; import lead becomes **"Bring an existing product and see what it needs to launch or transfer."** |
| No example section | New **Example businesses** section, visually apart from real listings (2.4). |
| Readiness list is a stage-sized aside | Readiness becomes a `<details>` disclosure, **"What works on Everstreet today"**, below the catalog. Same six rows, same Works now / Partly / Later tags. |
| "On Everstreet now: Published businesses on this computer, software first." | Heading sub-line sharpens to **"Real businesses published on this computer."** so the contrast with the examples is explicit. |

### 2.2 The try panel (stage rail)

**Idle.** Three radio choices, one button. Each choice has a one-line "why this one matters",
borrowed from the evaluation cases' habit of saying why (`server/src/evaluations.ts`):

- *A clean hosting invoice*: every promised field is read.
- *Lines that don't add up*: the stated total is kept and the disagreement is reported, not
  corrected.
- *Not an invoice at all*: refused, and a refused run is never charged.

There is **no free-text box on the homepage**. A stand-in with fixed rules would give misleading
answers to free text. "Use it for real" (2.3) goes to the real customer workspace when a real
Ledgerline offer is published on this server; otherwise the link is not shown.

**Running.** The button reads "Checking the sample…" and is disabled. No progress bar, no
spinner that implies a model is thinking; the stand-in answers in well under a second. Motion
rule from the direction: motion explains a real state change, nothing more. The result replaces
the picker in place (the picker stays reachable with "Try another sample").

**Result.**

```
┌ rail ──────────────────────────────────────────────────┐
│ SAMPLE RUN · STAND-IN MODEL · NOTHING CHARGED           │
│ A clean hosting invoice                                 │
│                                                         │
│ Outcome   [ Extracted ]                                 │
│ ┌──────────────────┬──────────────────────────────────┐ │
│ │ Vendor           │ Lantern Cloud Services           │ │
│ │ Invoice number   │ LC-2208                          │ │
│ │ Invoice date     │ 2026-10-21                       │ │
│ │ Total            │ 103.60                           │ │
│ │ Currency         │ USD                              │ │
│ └──────────────────┴──────────────────────────────────┘ │
│ Issues noticed: none                                    │
│                                                         │
│ ▸ Show the invoice text                                 │
│                                                         │
│ WHAT A REAL RUN WOULD RECORD                            │
│ · One unit reserved, then charged because a result was  │
│   delivered. (0.15 TUSD on the demo plan.)              │
│ · Compute cost: reported by the AI provider in USD      │
│   after the call. The stand-in has none.                │
│ · The customer keeps the result for the offer's         │
│   retention period, readable only by them.              │
│                                                         │
│ [ Follow it into Operate ]  [ Follow it into Acquire ]  │
│ Try another sample · Use it for real (when published)   │
└─────────────────────────────────────────────────────────┘
```

The field table mirrors the real `Extraction` shape (`server/src/extract.ts`): outcome, fields
with notes, missing, problems, reason, issues. The three sample results are **pre-checked** (the
build tests assert them), so the panel never shows a surprising answer.

Outcomes per sample:

| Sample | Outcome pill | Fields | Issues / reason | "Would be charged?" |
|---|---|---|---|---|
| Clean hosting invoice | Extracted (success tint) | all five | none | Yes, one unit |
| Lines that don't add up | Extracted (success tint) | all five, total **as stated** | "Line items sum to 294.00; stated total is 300.00. Kept as stated." | Yes, one unit |
| Not an invoice | Refused (neutral, not error red) | none | reason: "The text is release notes, not an invoice." | No. The unit is returned. |

The exact charging rule text should be read from the real offer code (`customerUse.ts`
eligibility) at build time, not retyped here.

**Error.** If the stand-in bundle fails to load or throws, the rail shows "The sample couldn't
run just now. Nothing was charged or recorded. [Try again]". Never an empty rail.

**Loading (page).** The rail renders its idle state immediately; it depends on no server read.
This is the point of putting the example on stage: it works when the catalog read fails.

### 2.3 Following the run into Operate and Acquire

Both doors open a **public, read-only example route**, `/example/ledgerline`, with three tabs:
Try · Operate · Acquire. The route renders the demo founder's simulated Ledgerline dataset (the
same records the portfolio dashboard reads, section 4), stripped to what a visitor may see. The
visitor's own sample run is **not** appended to those records; it is carried as a worked-example
strip at the top, "Your sample run, if it were real", so nothing simulated leaks into history.

**Operate tab** (what it teaches: a run becomes a use, a cost and an obligation; nothing is
guessed):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ EXAMPLE BUSINESS · SIMULATED HISTORY (30 DAYS)       Try · [Operate] · Acquire │
│ Ledgerline, as its owner sees it                                         │
│                                                                          │
│ Your sample run, if it were real → +1 charged use, +1 provider call      │
│ (cost in USD once reported), 1 fewer prepaid unit owed to that customer. │
│                                                                          │
│ ┌ Earned ──────────┐ ┌ Compute ─────────┐ ┌ Credits owed ───┐           │
│ │ 31.80 TUSD        │ │ USD 0.93          │ │ 149 units        │           │
│ │ 212 charged uses  │ │ 1 call cost unknown│ │ to 3 customers   │           │
│ │ Source: simulated │ │ Source: runtime   │ │ Source: this     │           │
│ │ contract readback │ │ records (provider)│ │ server's records │           │
│ └───────────────────┘ └───────────────────┘ └──────────────────┘           │
│ Runs per day: charged / returned / refused before sending   (chart 4.3c)  │
│ Compute per day (USD)                                       (chart 4.3b)  │
│ ▸ Every figure, with its basis (table)                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**Acquire tab** (what it teaches: a sale moves control, not customers' rights):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ EXAMPLE BUSINESS · SIMULATED HISTORY         Try · Operate · [Acquire]   │
│ If Ledgerline were sold                                                  │
│                                                                          │
│ ┌ The buyer takes control of ──────┐  ┌ Customers keep ───────────────┐  │
│ │ · the business account on NEAR   │  │ · access: the same offer, the  │  │
│ │   (owner key, operators)         │  │   same use keys                │  │
│ │ · the product project and every  │  │ · past results, readable only  │  │
│ │   revision and release           │  │   by them, for the retention   │  │
│ │ · the active customer offer and  │  │   period                       │  │
│ │   its plan                       │  │ · unused prepaid units: 149    │  │
│ │ · the treasury (test tokens)     │  │   today, exactly as the        │  │
│ │ · operating records: uses, costs │  │   contract holds them          │  │
│ │ The seller loses administrative  │  │ The buyer cannot read customer │  │
│ │ control at the confirmed close.  │  │ documents or results.          │  │
│ └──────────────────────────────────┘  └────────────────────────────────┘  │
│ Not transferred by the sale: external accounts (hosting, provider keys)  │
│ are listed as transfer items and are not called transferred until        │
│ verified.                                                                │
│ Ledgerline is mid-sale in the demo: see the ownership timeline (4.3k).   │
│ [ Explore real acquisitions ]                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

Both columns are composed from the existing control-sheet sections in
`server/src/handoverRecord.ts` (ownership generation, releases, offers, obligations, import
transfer duties), filtered to the public-safe statements. Nothing is invented; if a section has
no record, the line reads "none recorded".

### 2.4 Example businesses section

Three cards in one row (stack on phone). They must read as *examples* at a glance and in text:

- Eyebrow on the section and on each card: **EXAMPLE BUSINESS · SAMPLE DATA**.
- A different surface from real listings. Suggestion for Astra: `--surface-2` fill with a
  `--line-strong` **dashed** rule and the warm tint (`--warm-soft`) only in the eyebrow chip
  (`--warm-ink` text), never as the card fill. Real listings stay on paper with fine solid rules.
  Dashed = sample is already the chart convention for "fictional example history" in
  `FinanceChart.tsx`, so the language is consistent.
- No price, no availability pill, no "Open for customers": those belong to real listings. Instead
  one line on pricing *shape* ("1 unit per delivered read") so the visitor learns the model.
- Founder line names the fictional founder, with no avatar photo (initials in a circle).
- The three cards never appear in Explore, Find, the catalog, or Acquire listings. They live only
  on Home and at `/example/*`.

Card states:

| State | Ledgerline | Relaydesk / Signalwatch before their engine | After their engine |
|---|---|---|---|
| Primary | **Try a sample** (opens the stage panel, focus moves there) | **Not tryable yet** (disabled look, with the reason in text under it: "Relaydesk's workflow engine isn't built yet. The planned flow is shown as an illustration.") | **Try a sample request** / **Try a sample changelog** |
| Secondary | Operate ▸ Acquire ▸ | See the planned flow ▸ (opens `/example/relaydesk`, Illustration tab) | Operate ▸ Acquire ▸ |

### 2.5 Mobile (390)

```
┌────────────────────────────┐
│ Everstreet          Menu   │
│ Discover Build Operate Acq │
├────────────────────────────┤
│ What do you want to build? │
│ lede (2 lines)             │
│ [ Describe the idea…     ] │
│ [ Start ]                  │
├────────────────────────────┤
│ EXAMPLE BUSINESS·SAMPLE DATA│
│ Ledgerline · AI invoice API│
│ Try a sample               │
│ (•) A clean hosting invoice│
│ ( ) Lines that don't add up│
│ ( ) Not an invoice at all  │
│ [ Run the sample ]         │
│ Stand-in model, no AI      │
│ provider. Nothing charged. │
├────────────────────────────┤
│ Ways in (4 stacked tiles)  │
├────────────────────────────┤
│ Example businesses         │
│ (3 stacked cards)          │
├────────────────────────────┤
│ On Everstreet now          │
│ filter chips (wrap)        │
│ list                       │
├────────────────────────────┤
│ ▸ What works today         │
├────────────────────────────┤
│ Built to change hands…     │
└────────────────────────────┘
```

Rules: the composer stays first (the page's one promise); the try panel is second, full width,
radios stacked (no horizontal chip strip). The result's field table becomes a two-row definition
list per field. The "What a real run would record" strip stays, since it is the lesson. Nothing
scrolls sideways except charts on the example Operate tab, which use the existing `Scroll`
region.

---

## 3. Sample business stories

One founder, three businesses, so the demo login and the homepage tell the same story. The
founder is **Marisol Teague**, a fictional bookkeeper-turned-builder. Everyone else is fictional
too; none of the names are real companies.

### 3.1 Ledgerline: AI invoice API

- **Promise.** "Paste an invoice; get the fields back, exactly, or an honest refusal."
- **Who pays.** Small accounting practices and finance tools that need vendor, number, date,
  total and currency from pasted invoices without a human retyping them.
- **Pricing.** Prepaid units; 1 unit per delivered read (0.15 TUSD on the demo plan). A refusal
  or a failed call returns the unit. This matches the existing offer model (one unit reserved,
  charged only on a result).
- **Customers in the demo.** *Ridge Analytics* (first customer, buys 100 units on day 2), *Copperline
  Analytics* (buys 200 on day 7, later grants an agent), *Fieldnote Outdoor Co* (buys 50 on day
  16). Copperline's agent, labelled `copperline-recon` in its grant, runs 50 uses on a 14-day
  grant from day 15.
- **Sample input** (the homepage's "clean hosting invoice"; the first line keeps the fictional
  header outside the vendor line, as the evaluation fixtures do):

  ```
  FICTIONAL EXAMPLE - not a real company or invoice
  INVOICE
  Lantern Cloud Services
  Invoice no. LC-2208
  Invoice date: 2026-10-21
  Bill to: Ridge Analytics
  Object storage, October     USD 84.00
  Egress                      USD 19.60
  Total: USD 103.60
  ```

- **Sample output.** Outcome Extracted; vendor "Lantern Cloud Services"; invoice_number
  "LC-2208"; invoice_date 2026-10-21; total "103.60"; currency USD; issues none.
- **Second sample** ("Lines that don't add up"): same shape, vendor *Marten Automation Co*,
  invoice MA-2026-07, lines 200.00 + 60.00, stated total 300.00. Output keeps total "300.00"
  and reports the disagreement in `issues`. (This is the fixture `req_totals_disagree`; reusing
  it keeps the stand-in honest to a case the real release policy checks.)
- **Third sample** ("Not an invoice"): release notes for a fictional tool. Output Refused with
  the reason; no fields; "the unit is returned".
- **In Operate.** 212 charged, 9 returned, 6 refused before sending over 30 days; one model call
  on day 8 with unknown cost (so that week's cost per run is "unknown", with the reason).
- **In Acquire.** Mid-sale to *Halden Partners* (buyer team; contact *Jonah Petrakis*). Terms
  version 2 recorded on the simulated chain on day 29; awaiting buyer acceptance on day 30. The
  149 unused units are listed as what customers keep.

### 3.2 Relaydesk: SaaS support workflow

- **Promise.** "A support request goes in; it is assigned, answered and closed, with every step
  on the record."
- **Who pays.** Small online services that need a shared inbox with accountability but not a
  help-desk suite.
- **Pricing.** 1 unit per submitted request (0.50 TUSD on the demo plan), charged at intake.
  Resolution does not cost extra. (From the agreed plan: "1 unit per submitted request".)
- **Engine.** A trusted Everstreet-owned workflow engine with three stages, intake → assigned →
  resolved, and no generated code and no AI call. Because it is deterministic, "Try a sample
  request" can run the real engine in a throwaway sandbox once built, and the label can say
  "Sample run on Relaydesk's workflow engine · nothing charged or kept".
- **Customers in the demo.** *Fieldnote Outdoor Co* (buys 50 requests day 6), *Quillmark*
  (buys 30 day 19).
- **Sample input** (a support request):

  ```
  From: a customer of Fieldnote Outdoor Co (fictional)
  Subject: Order FN-3310 shows "shipped" but no tracking number
  I ordered on 2026-10-18. The order page says shipped on the 20th but there is no
  tracking link. Can you send it, or tell me the carrier?
  ```

- **Sample flow and output.** Intake 09:12 (request REQ-0417 created, 1 unit charged) →
  Assigned 09:14 to "Billing and orders" queue → Resolved 10:03 with the reply "Tracking
  added: carrier Northstar Parcel, ref NP-55210; sorry for the gap." Time to resolve 51 min.
- **Before the engine exists** the card shows this as a three-step illustration strip with the
  label "Illustration, not a run", and the primary action is "Not tryable yet".
- **In Operate.** Requests by stage per day; time to resolve; one request stuck in Assigned for
  more than 48 h on day 18 (Needs attention). 61 requests over the period.

### 3.3 Signalwatch: agent service

- **Promise.** "Give it a changelog; it tells you what changed, why it matters to you, and what
  to do."
- **Who pays.** Teams that depend on a handful of upstream tools and miss breaking changes.
- **Pricing.** 1 unit per **delivered** analysis (2.00 TUSD on the demo plan). An analysis the
  provider does not finish is not delivered and not charged. (From the agreed plan: "charge only
  delivered analyses".)
- **Engine.** Runs on the AI runtime (same provider path as Ledgerline). The homepage sample uses
  a **stand-in analyser** with fixed rules over the one sample changelog; labelled the same way
  as Ledgerline's stand-in.
- **Customers in the demo.** *Quillmark* (buys 30 analyses day 14), *Ridge Analytics* (buys 10
  day 22).
- **Sample input** (a changelog for a fictional library):

  ```
  FICTIONAL EXAMPLE - not a real project
  ledgerctl 2.4.0 (2026-10-28)
  - Breaking: `export --format csv` now writes ISO dates; the old locale format is removed
  - Deprecated: `sync --fast` (will be removed in 3.0)
  - Added: `--dry-run` for every write command
  - Fixed: timezone handling in exports (results could shift by one day)
  - Security: updated the bundled TLS library after an advisory
  ```

- **Sample output.** Five flags, each with severity, why it matters, and a proposed action:

  | Flag | Severity | Why it matters to you | Proposed action |
  |---|---|---|---|
  | CSV date format changed | High | Your import expects the old locale format | Update the import parser before upgrading |
  | `sync --fast` deprecated | Medium | Your nightly job uses it | Switch to `sync` and time it |
  | `--dry-run` added | Low | Lets you rehearse the migration | Try it on the staging ledger |
  | Export timezone fix | Medium | Earlier exports may be off by a day | Re-export October before closing the month |
  | TLS library updated | High | Security fix | Upgrade this week |

  "Why it matters to you" needs a short profile of the customer's usage; the sample uses a
  fixed one ("You use `export --format csv` and `sync --fast` nightly"), shown above the result
  so the reasoning is not magic.
- **In Operate.** Analyses per day: delivered / not delivered; flags by severity. One analysis on
  day 26 times out and is not charged.

---

## 4. Dashboard

### 4.1 Information architecture

The portfolio (`/portfolio`, `web/src/pages/Portfolio.tsx`, data from `server/src/portfolio.ts`)
becomes the dashboard. Two levels:

1. **All businesses** (the overview). A comparison, not a total. One row per business with its
   own figures in its own units. No grand "portfolio revenue" number, even when the assets match:
   adding across businesses invites adding across currencies next, and PORTFOLIO.md already
   forbids that. (Open question 4 asks Astra whether a same-asset total is wanted later.)
2. **One business** (Tony's mockup). The switcher at the top chooses it; the URL carries it
   (`/portfolio/:businessId`) so a deep link and Back work.

Where it lives in the header: today Portfolio is under **Acquire**. The mockup puts it under
**Operate**, which matches what it is for an owner. Proposal: Operate → "My businesses" opens
the dashboard; Acquire keeps "Considering" (the buyer side of the same data) as a tab. Open
question 2.

Header chips (as in the mockup, with honest wording): a **data basis** chip, "Simulated history"
or "NEAR testnet", and the account chip, "Marisol Teague · Demo founder".

### 4.2 Per-business view

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Everstreet  Discover Build [Operate] Acquire     ◌ Simulated history   Marisol T. ▾ │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Portfolio                                                                            │
│ Your businesses, from launch to handover.                                            │
│ [ ▣ Ledgerline · AI invoice API · Owner, selling ▾ ]  [ Last 30 days ▾ ]  3 businesses│
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Earned revenue        Compute expense        Network fees        Customer credits    │
│ 31.80 TUSD            USD 0.93               Unknown             149 units owed      │
│ 212 charged uses      +1 call, cost unknown  The simulated chain 3 customers         │
│ Source: contract      Source: provider usage doesn't report fees Source: this        │
│ readback (simulated)  in runtime records                         server's records,   │
│                                                                  checked against the │
│                                                                  contract            │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ Earned revenue by day (TUSD) ─────────────────────┐ ┌ Needs attention ──────────┐  │
│ │ bars; release markers ▲R1 ▲R2 on the x axis        │ │ ● Buyer awaiting your     │  │
│ │ "so far" day outlined                              │ │   acceptance of terms v2  │  │
│ └────────────────────────────────────────────────────┘ │ ● 1 model call with       │  │
│ ┌ Compute by day (USD) ─────────────────────────────┐ │   unknown cost (day 8)    │  │
│ │ bars; hatched marker on the unknown-cost day       │ │ ● Agent grant for         │  │
│ │ Separate chart, separate unit. Never overlaid.     │ │   Copperline expired;     │  │
│ └────────────────────────────────────────────────────┘ │   49 of 50 uses made      │  │
│ ┌ Runs per day ─────────────────────────────────────┐ └───────────────────────────┘  │
│ │ stacked: charged / returned / refused before send  │ ┌ NEAR ownership ───────────┐  │
│ └────────────────────────────────────────────────────┘ │ Current owner  Marisol T. │  │
│ [Invoice reads 212 charged] [Release 2 · 10/10 checks] │ Generation 1 · acct       │  │
│                                                        │ ledgerline.sim (simulated)│  │
│ ┌ Credits owed to customers over time ──────────────┐ │ Sale: terms v2 recorded,  │  │
│ │ step line: prepaid in (cumulative) vs earned      │ │ awaiting buyer            │  │
│ │ (cumulative); the gap is what is owed             │ │ Customer access carries   │  │
│ └────────────────────────────────────────────────────┘ │ over: 149 units stay      │  │
│ ┌ Human vs agent uses ───┐ ┌ New vs returning ──────┐ │ View handover timeline ▸  │  │
│ │ stacked by week         │ │ customers, by week     │ │ ┌ Handover preview ─────┐ │  │
│ └─────────────────────────┘ └────────────────────────┘ │ │ Buyer control →       │ │  │
│ ┌ Cost per successful run ───────────────────────────┐ │ │ Customer entitlements │ │  │
│ │ Oct 7–13: USD 0.0041 · Oct 14–20: unknown (1 call  │ │ └───────────────────────┘ │  │
│ │ cost unknown) · …                                  │ └───────────────────────────┘  │
│ └────────────────────────────────────────────────────┘ ┌ Contract activity ────────┐  │
│ ┌ Releases and checks ───────────────────────────────┐ │ mono list, newest first   │  │
│ │ timeline: R1 day 1 10/10 · R2 day 10 10/10 (after  │ │ block · what · digest     │  │
│ │ a 9/10 run on day 9, not released)                 │ └───────────────────────────┘  │
│ └────────────────────────────────────────────────────┘                                │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Your businesses                                                                      │
│ Business     Kind                  Ownership        Period uses   Next action         │
│ Ledgerline   AI invoice API        Owner · selling  212 charged   Accept terms v2     │
│ Relaydesk    SaaS support workflow Owner            61 requests   Check REQ-0431      │
│ Signalwatch  Agent service         Owner            27 delivered  —                   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▸ Every figure on this page, with its basis (tables)                                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Corrections to the mockup, with reasons:

1. **Compute is USD, not TUSD, and gets its own chart.** The mockup's "36.20 TUSD" compute line
   on the revenue axis would say the two are comparable. They are not (economics.ts:
   "No profit or margin: revenue is in each offer's token and cost in USD"). Two charts, one
   above the other, same day axis, different unit axes. The headline tile reads "USD 0.93".
2. **Network fees in NEAR only when they are read.** Nothing today records per-transaction fees
   (new data needed, 8.2). On the simulated chain the tile honestly says "Unknown · the simulated
   chain doesn't report fees". On testnet it shows the summed gas fees of the business's recorded
   transactions in NEAR, with "Source: NEAR transaction receipts" and a link to each.
3. **Customer credits source is two-state.** "Source: this server's records" by default; "checked
   against the contract at block N" when a current v3 observation exists. Never "Source: NEAR
   contract" unless the number literally came from a contract view.
4. **Release chips.** Releases have ids and digests, not "v1.4". Show "Release 2 · 10/10 checks ·
   7f3a…" (sequence per project, evaluation score, short digest). A founder-entered release label
   is new data (8.3).
5. **"Earned" is charged uses × unit price**, as economics.ts defines it; prepaid-not-yet-used is
   an obligation and never shown as revenue.

### 4.3 Panels, each with source, chart and label

Chart components reuse the house style: SVG with `viewBox`, one keyboard stop per bar/day with
its full text in `aria-label`, a `fin-detail` live line, patterns from `SeriesPatterns.tsx`,
and the sideways `Scroll` region on phones (`FinanceChart.tsx`, `RoomPerformance.tsx`). Every
chart has a table under "Every figure".

| # | Panel | Source (today) | Chart and why | Label line | Empty state |
|---|---|---|---|---|---|
| a | Headline tiles (4) | economics() by_asset earned, compute known_microcents + unknown calls, obligations outstanding_units; fees: none | Four figures, unit inside the figure, source line under each | "Last 30 days · UTC" | A tile that can't be read shows "Unknown" with the reason, never 0 |
| b | Earned revenue by day (TUSD) | customer_requests × settlements(charged) × offer plan unit_price, **daily bucket (new, 8.1)** | Bars per day. Bars because days are discrete and sparse days should look sparse, not smoothed; release markers as labelled triangles on the axis | "Charged uses × unit price · exact base units, shown as TUSD" | "No charged uses in this period" |
| c | Compute by day (USD) | runtime_invocations purpose=customer_use, charged_microcents, daily | Bars; a hatched marker (existing "couldn't read" pattern) on any day with unknown-cost calls, with the count | "Provider-reported cost · USD · calls with unknown cost are marked, not zeroed" | "No customer calls in this period" |
| d | Runs per day | operations.ts outcome groups: charged, returned (not charged), not sent (refused before sending) | Stacked bars, three series with patterns; totals in the table | "Each use in the day it was requested; its current recorded outcome" | "No uses requested" |
| e | Earned vs prepaid not yet used | economics obligations (all-time) + purchases by day (new daily bucket) | Two cumulative step lines; the vertical gap is what is owed. Step, not curve, because purchases are events | "Prepaid is an obligation until used, not income" | "No purchases recorded" |
| f | Credits owed over time | same as e, as a single line of outstanding units per day | Line of units (not value); an optional per-customer table under "Every figure" (open question 5) | "Units, as recorded here; the contract's entitlements are the authority" | "Nothing owed" |
| g | Cost per successful run | economics cost_per_success and reason, **weekly (new)** | A row of weekly figures in mono, not a chart: a figure that is often "unknown" should not be a line with holes | "Only when every call that week has a known cost" | "No successful uses" |
| h | Human vs agent uses | customer_requests joined to agent_grant_uses(use_id) (006b) | Stacked bars by week; two series | "Agent uses are made under a customer's grant: one offer, a use cap, an expiry" | "No agent grants yet" |
| i | New vs returning customers | customer_requests.person_id; first request ever for this business = new | Stacked bars by week | "A customer is new in the week of their first request here" | "No customers yet" |
| j | Releases and checks | runtime_releases.activated_at + eval_runs passed/failed/errors/total; failed runs not released | Timeline strip; each release a labelled node; a non-released evaluation a hollow node. Also mirrored as markers on b and d | "A release is a checked artifact; a failed check is shown and was not released" | "Nothing released" |
| k | Ownership and handover timeline | ownership (generation, tx, at), deals (terms versions, state), v3_observations (block, digest) | Horizontal timeline: founded → releases → sale opened → evidence granted → terms v1 → terms v2 → awaiting acceptance → (close pending) → (confirmed). Pending steps are outlined, never filled: "Do not visually confirm a close from intent alone" | "Simulated chain" or "NEAR testnet · block N · explorer ▸" | "Founded here; never changed hands" |
| l | Contract activity feed | v3_observations, ownership, settlement evidence (block, digest, observed_at) | Mono list, newest first, 20 rows, "Show more" | same as k | "No contract activity read yet" |
| m | Needs attention | portfolio.ts attention + economics.recovery + open sale state (seller side, **new 8.6**) + stuck Relaydesk requests + expired grants + releases to review (buyer side) | List with one next action each, linked to the page that resolves it | — | "Nothing needs you" |
| n | Your businesses | portfolio owned/considering/former + kind + period uses + next action | Table (sortable later) | — | "You don't control a business yet" |
| o | Relaydesk: requests by stage; time to resolve | **new data (8.4)**: request events with stage timestamps | Stacked bars by day (intake/assigned/resolved as of now); a dot strip of hours-to-resolve per resolved request with the median written | "A request is charged at intake" | "No requests" |
| p | Signalwatch: analyses and flags | **new data (8.4)**: analyses (delivered or not) and flags with severity | Stacked bars by day: delivered / not delivered; a second small stacked bar of flags by severity (high/medium/low) | "Only delivered analyses are charged" | "No analyses" |

Panels o and p render only for a business of that kind; a, b, c, d, j, k, l, m apply to all.
Panels e, f, g, h, i apply to Ledgerline and Signalwatch (prepaid-unit products) and to Relaydesk
once its units are the same model.

### 4.4 All-businesses overview

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [ All businesses ▾ ]  [ Last 30 days ▾ ]                                             │
│ Needs attention across your businesses (panel m, merged, business named per item)    │
│                                                                                      │
│ Ledgerline        31.80 TUSD earned · USD 0.93 compute · 149 units owed · Selling     │
│   ▁▂▃▃▅▆▆▇▇▇▇▆▆▇ (runs per day, small)        Release 2 · terms v2 awaiting buyer     │
│ Relaydesk         30.50 TUSD earned · no compute (no AI) · 19 requests open           │
│   ▁▁▂▂▃▃▃▄▄▅▅▄▄▅                               Release 2 · 1 request stuck > 48 h     │
│ Signalwatch       54.00 TUSD earned · USD 0.61 compute · 13 units owed                │
│   ▁▁▁▁▁▁▁▁▁▂▂▃▃▂                               Release 1 · 1 analysis not delivered   │
│                                                                                      │
│ No totals are shown across businesses: each business's figures are its own, in its   │
│ own units.                                                                           │
│ Ownership across businesses (panel k, three lanes)                                   │
│ Your businesses (panel n)                                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

One row per business: its four headline figures inline, a small runs-per-day sparkline (same
data as panel d, with a text alternative "212 charged over 30 days, busiest day 14"), and its
single next action. Clicking a row opens the per-business view.

### 4.5 Date range

"Last 30 days" is the default and the demo's whole history. Also "This month" and "Last 3
months" (monthly buckets via `economics()` as today). The range is in the URL. Days before the
business existed render as "before this business opened" (the existing `beforeOpening` dash),
never as zero.

### 4.6 Demo login

- A "Try the demo" entry in the acting-context menu (the existing local fictional-person
  switch) and a quiet link under the Example businesses section: "Sign in as the demo founder".
- Signing in lands on `/portfolio/ledgerline` with a one-time banner: "You are Marisol Teague, a
  fictional founder. Her 30 days of history were produced by running Everstreet's real flows on
  a simulated chain. Nothing here is live. [Got it]".
- Credentials live in the seed file (never in chat, never in docs). The demo founder can't push
  a sale to close by accident: the "Accept terms" action for the buyer side belongs to the buyer
  persona, which is a second demo account the operator switches to on purpose.

---

## 5. Demo storyline (30 days)

Days are relative to "today" at seed time (D30 = today, "so far"), so "Last 30 days" always
ends on the current day. All three businesses use the same simulated chain and the same
fixture clock. Unit prices: Ledgerline 0.15 TUSD per delivered read; Relaydesk 0.50 TUSD per
submitted request; Signalwatch 2.00 TUSD per delivered analysis. Compute cost: about USD 0.004
per Ledgerline call and USD 0.02 per Signalwatch analysis (whatever the stand-in provider
reports; the seed must record the provider's number, not this one).

| Day | Ledgerline | Relaydesk | Signalwatch | What it shows on the dashboard |
|---|---|---|---|---|
| D1 | Founded. Build, evaluation 10/10, **Release 1**, plan 0.15 TUSD/use, offer open | — | — | Timeline start; release marker R1 |
| D2 | Ridge Analytics buys 100 units; 6 uses | — | — | First purchase step; first charged bars |
| D3–D4 | 5–8 uses/day; D4 one "not an invoice" refused before sending | — | — | Refused series appears |
| D5 | 7 uses | Founded; engine configured; **Release 1**; 0.50 TUSD per request | — | Second business on the overview |
| D6 | 9 uses | Fieldnote Outdoor Co buys 50 requests; 3 submitted | — | Relaydesk stages chart starts |
| D7 | Copperline Analytics buys 200 units; 11 uses | 4 requests | — | Prepaid step; credits owed jumps |
| D8 | 10 uses; **one model call's answer never arrived: cost unknown**, unit returned | 2 requests | — | Hatched marker on compute chart; recovery item; cost per run "unknown" that week |
| D9 | Evaluation of a draft update: **9/10, not released** | 3 requests | — | Hollow node on releases timeline |
| D10 | Fixed; evaluation 10/10; **Release 2**; 12 uses | 5 requests | — | Release marker R2 on charts |
| D11–D13 | 8–12 uses/day | 2–4/day; first resolved within the hour | D12 founded; D13 **Release 1**, 2.00 TUSD per delivered analysis | Third business |
| D14 | 13 uses | 3 requests | Quillmark buys 30 analyses; 2 delivered | Signalwatch flags chart starts |
| D15 | Copperline grants agent `copperline-recon`: 50 uses, 14 days; 4 agent + 9 human uses | 3 requests | 1 delivered | Human vs agent split begins |
| D16 | Fieldnote buys 50 units; 7 human + 5 agent | 4 requests | 2 delivered | New customer in panel i |
| D17 | 8 + 4 | 2 requests | 1 delivered | — |
| D18 | 9 + 4 | **REQ-0431 stuck in Assigned > 48 h** | 1 delivered | Needs attention item |
| D19 | 10 + 4 | Quillmark buys 30 requests; 3 submitted | 2 delivered | — |
| D20 | 7 + 4 | 4 requests; REQ-0431 resolved (61 h) | 1 delivered | Time-to-resolve outlier dot |
| D21 | 9 + 3 | 3 requests | 2 delivered | — |
| D22 | **Marisol lists Ledgerline for sale** (named listing); grants Halden Partners scoped evidence (economics, digital performance); 8 + 4 | 2 requests | Ridge Analytics buys 10 analyses; 1 delivered | Timeline: sale opened, evidence granted; "Selling" badge |
| D23 | 9 + 4 | 3 requests | 2 delivered | — |
| D24 | 8 + 3 | 2 requests | 1 delivered | — |
| D25 | Halden shortlists and asks for terms; 10 + 4 | 3 requests | 2 delivered | Timeline: terms requested |
| D26 | 7 + 3 | 2 requests | **One analysis times out: not delivered, not charged**; 1 delivered | Not-delivered bar; no charge |
| D27 | **Terms v1 recorded** on the simulated chain; 9 + 4 | 3 requests | 2 delivered | Timeline node with block and digest |
| D28 | Halden asks for a revision (retention of the evidence grant after close); 8 + 2 | **Release 2** (assignment rules); 4 requests | 1 delivered | Relaydesk release marker |
| D29 | **Terms v2 recorded**; agent grant expires (49 of 50 used); 9 human | 2 requests | 2 delivered | Agent series ends; attention item "grant expired" |
| D30 (today, so far) | 6 uses; **awaiting buyer acceptance of v2** | 1 request | 1 delivered | Outlined "pending" node; the demo ends here |

Totals the seed should land on (so the figures in sections 2 to 4 agree): Ledgerline 212 charged,
9 returned, 6 refused before sending, of which 49 agent uses; prepaid 350 units, 149 still owed
(100 + 200 + 50 − 212 + 9 returned… the seed computes this; the number here is only the shape).
Relaydesk 61 requests, 19 still open at D30. Signalwatch 28 analyses attempted, 27 delivered.

After the walkthrough, the operator can switch to the buyer persona (*Jonah Petrakis*, Halden
Partners) and accept terms v2 to show the close: Marisol's portfolio moves Ledgerline to
**Former** immediately, Jonah's shows it as **Received**, and the customers' 149 units are
unchanged on both sides. This is the flagship 100/20/80 lesson told with three customers.

---

## 6. Labels and honesty rules

Fixed wording, so the build and the tests can assert it.

| Where | Label (exact) |
|---|---|
| Home example section and cards | **Example business · sample data** |
| Try panel, idle | "Stand-in model: fixed rules, no AI provider. Nothing is charged or recorded." |
| Try panel, result | **Sample run · stand-in model · nothing charged** |
| Pre-engine Relaydesk/Signalwatch | **Illustration, not a run** and the primary action **Not tryable yet** with the reason in text |
| Post-engine Relaydesk sample | **Sample run on Relaydesk's workflow engine · nothing charged or kept** |
| Example Operate/Acquire tabs | **Example business · simulated history (30 days)** |
| Dashboard header chip, simulated | **Simulated history** (hover/expand: "Produced by running Everstreet's real flows on a simulated chain. Not NEAR.") |
| Dashboard header chip, testnet | **NEAR testnet** (hover/expand: "Test tokens, no value. Every transaction links to the explorer.") |
| Every money tile | the unit inside the figure (31.80 TUSD / USD 0.93 / 0.018 NEAR) and a source line under it |
| Unknown figure | **Unknown** plus the reason; never 0, never a dash alone |
| Pending chain step | outlined node + the word **Pending**; filled only on a recorded close |

Rules:

1. Never sum TUSD, USD and NEAR. Never sum across businesses on the overview. Never draw revenue
   and compute on one axis.
2. "Source: NEAR ledger / contract / transactions" appears only when the figure was read from
   the chain. On the simulated chain the source says "simulated contract readback".
3. The homepage stand-in never records a use, a cost, a request or an observation. Its results
   are fixed and tested.
4. The example route reads the demo founder's data read-only; the visitor's sample run is a
   worked-example strip, not a record.
5. Nothing is tryable unless it runs. "Not tryable yet" is a visible state with a reason, not a
   greyed button alone.
6. Example businesses never appear among real listings (Explore, Find, Acquire, catalog) and
   are never for sale to real buyers; the mid-sale is between two demo personas.
7. Release and evaluation facts come from `runtime_releases` and `eval_runs`; a failed check is
   shown as a failed check.
8. The demo founder is fictional and named as such on first sign-in. The buyer is fictional.
   No real employer, product or company name anywhere in the seed.

---

## 7. Mobile and accessibility

**Phone (390).** Dashboard order: switcher (full-width select) → date range → data-basis chip
(moves from the header into the page top on phones) → Needs attention → the four tiles in a
2×2 grid → charts one per screen, each in the sideways `Scroll` region with its detail line →
NEAR ownership → Your businesses as stacked rows (name, kind, ownership pill, next action) →
"Every figure" tables. The overview sparklines drop on phones; the text alternative stays.

**Tablet (768–980).** Two columns: charts left, Needs attention and ownership right, as on
desktop, with the tiles in 2×2.

**Keyboard.** Every bar/day/node is a tab stop with its full sentence in `aria-label` (the
existing `fin-point` pattern). The switcher and range are native selects. The try panel's radios
are a fieldset with a legend; the result is announced through `aria-live="polite"` on the
outcome line.

**Not color-only.** Series use the existing `--data-*` tokens plus patterns from
`SeriesPatterns.tsx`; two new series are needed (refused-before-sending, agent) with their own
pattern and token (open question 3). Unknown is the hatched amber marker with a "?" and text.
Release markers are labelled triangles, not just a colour tick. Pending ownership steps are
outlined with the word "Pending". Simulated vs testnet chips differ in text and icon, not only
tint.

**Text alternatives.** Each `<figure>` has a `<figcaption>` that states what is drawn and its
unit; each chart has a table under "Every figure"; sparklines carry a sentence. The timeline
(panel k) is also an ordered list in the DOM.

**Motion and zoom.** Transitions only on panel open/close (160–220 ms), removed under
`prefers-reduced-motion`. Charts scroll rather than shrink at 200% zoom. Glass header keeps its
opaque fallback.

---

## 8. Data the build needs that doesn't exist yet

1. **Daily buckets.** `economics()` is monthly. Panels b–f, h, i need a `dailySeries(businessId,
   from, to)` over the same tables (customer_requests, customer_settlements, customer_offers,
   customer_purchases, runtime_invocations), with the same definitions and the same unknown
   handling. Weekly cost-per-run (panel g) is the same series rolled up.
2. **Network fees.** No table records gas or fees per transaction. Needs a per-tx fee readback
   from receipts on testnet (store beside `ownership.tx` and settlement evidence). On the
   simulated chain either model a fee and label it "simulated fee" or show "Unknown". This doc
   proposes "Unknown".
3. **Release labels and sequence.** `runtime_releases` has ids and digests. Add a per-project
   sequence number in the projection (derivable) and an optional founder label (new column).
4. **Relaydesk and Signalwatch engines and records.** Request events with stage timestamps
   (intake, assigned, resolved) and queue; analyses with delivered/not delivered and flags with
   severity, reason and proposed action. Both are plan items 3 and 4 already.
5. **Stand-in extractor and analyser for the homepage.** Deterministic, bundled with the web
   app or served by a small route, producing the real `Extraction` shape for exactly the three
   samples (and the Signalwatch five-flag table). Tests assert the outputs.
6. **Seller-side open sale in the portfolio.** PORTFOLIO.md lists buyer-side open sales as not
   done; the owner's "Selling · terms v2 awaiting buyer" state needs the deal/listing state
   joined into `portfolio.view()`.
7. **Data-basis flag.** Every dashboard and example API answer carries
   `basis: "simulated" | "testnet"` and, for testnet, an explorer URL template, so the UI never
   guesses the label.
8. **Public example route.** A read-only projection of the demo founder's businesses for
   `/example/:slug` (Operate and Acquire tabs), using the existing public-safe statements from
   the control sheet and the economics definitions, with customer identities removed.
9. **The seed and the clock.** A seed script that creates the three demo personas (founder,
   buyer, and the customers), runs the real flows day by day on the simulated chain with the
   fixture clock advancing, and lands on the totals in section 5. Credentials written to the
   seed file only. The same script should accept a testnet target later without changing the
   storyline.
10. **Attention items** for expired agent grants and stuck Relaydesk requests (simple queries once
    4 and 006b records exist).

Already available and only needing a projection: human vs agent (agent_grant_uses.use_id),
new vs returning (customer_requests.person_id), releases and checks (runtime_releases ×
eval_runs), ownership and observations (ownership, v3_observations), recovery items
(economics.recovery), obligations (economics.obligations).

---

## 9. Open questions for Astra

1. **Stage priority.** When a real published product with an owner-written example exists on
   the server, does the Ledgerline try panel still own the stage rail, with the real product
   leading "On Everstreet now"? This doc says yes, because the example always runs; the
   direction says Discover shows real published content. Your call.
2. **Where Portfolio lives.** Move it from Acquire to Operate ("My businesses"), keeping
   "Considering" under Acquire? The mockup implies Operate.
3. **Two new data series.** Refused-before-sending and agent uses need a token and a pattern
   each, in the `--data-*` family. Candidates to contrast-test, not a claim.
4. **Totals across businesses.** This doc shows none. If you want a same-asset total on the
   overview later, it needs a visible "same token, same ledger" rule and a test.
5. **Per-customer credit burn-down.** The owner may see per-customer unit balances (they serve
   those customers), but it is more than the mockup asks. Aggregate only, or a table under
   "Every figure" with customer accounts shortened?
6. **The "example" look.** Dashed strong rule + quiet paper + warm eyebrow chip is proposed so
   examples and sample series share one visual language (dashed = fictional, as in the charts).
   Shape this; keep warm out of card fills and text on paper.
7. **Pre-engine illustrations.** A three-step strip (intake → assigned → resolved; changelog →
   flags → action) drawn in the house style, labelled "Illustration, not a run". Should these
   be static SVGs or composed from the same components that will later show real runs?
8. **The founder persona.** Initials only, no portrait, as proposed? And is "Marisol Teague"
   acceptable as the fictional founder's name (Tony's choice in the end)?
9. **Dashboard density.** The per-business view has 14 panels. Should the lower panels (e–j)
   sit behind a "More charts" disclosure by default, or is long-scroll with a sticky section
   nav the better bento here?
10. **Release naming.** "Release 2 · 10/10 checks · 7f3a…" or a founder label? The mockup's
    "v1.4" needs the label field (8.3).
