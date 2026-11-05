# Showcase specification (corrected): homepage examples, public example, demo account

Claude, November 5 2026 (night). This answers Astra's job "Reconcile showcase design before
building it" (`docs/astra/jobs/2026-11-05_showcase-proposal-corrections.md`) and applies her ten
decisions (`docs/astra/2026-11-05_IndependentBuildAssessment.md` §2).

Fable's proposal (`SHOWCASE_DESIGN_PROPOSAL.md`) keeps its structure and wording ideas. **Where
the two differ, this document wins.** Every number here is either read from a committed record
or computed from one in code. None is typed by hand.

## 1. The three layers (rules that decide everything below)

| Layer | What it is | Writes anything? | Data it may read |
|---|---|---|---|
| **Base product** | The platform every founder, customer and buyer uses. Its dashboard, releases and handover never depend on a demo identity | yes, as today | the signed-in person's own records |
| **Showcase** | Public teaching on the real site: the homepage sample panel, the Example businesses section, `/example/*` | **no**: no request is made by the sample panel; the example pages make one read of a public projection | a committed sample file and an allowlisted projection of a committed, verified evidence record (§3) |
| **Demo account** | A fictional founder using the base product, filled by running real flows (on the simulated chain) | yes, inside its own disposable installation only | its own records, like any founder |

## 2. Homepage samples (corrected)

**The texts** are three of the product's own required evaluation cases
(`REQUIRED_INVOICE_CASES` in `server/src/evaluations.ts`), by id:

| Case id | Shown as | Fictional input |
|---|---|---|
| `req_clean` | One clean invoice | Stackline Hosting Ltd, SH-1042: lines 300.00 + 112.50, total USD 412.50 |
| `req_totals_disagree` | Line items don't add up to the stated total | Marten Automation Co, MA-2026-07: lines 200.00 + 60.00, stated total USD 300.00 |
| `req_unrelated_text` | Not an invoice at all | release notes for "ledgerctl 2.4" |

**Results:**
- Each result is produced in advance by the stand-in model's scripted answer, run through the
  product's own validation (`validateExtraction`, the same step a real run uses).
- The script that writes them is `scripts/build-showcase-samples.ts`, and the output is
  `web/src/showcase/samples.json`.
- A test regenerates the results and must equal the committed file
  (`server/test/showcase-samples.test.ts`), so the panel can't drift from the product.

| Case | Outcome (product's word) | Fields | Issue | Charged on a real run? |
|---|---|---|---|---|
| clean | `extracted` | vendor, number, date, total 412.50, currency USD | none | yes: one unit (outcome `extracted`, delivered) |
| totals disagree | `extracted` | total kept as stated: **300.00** | "Line items add up to 260.00, not the stated 300.00" (this corrects the proposal's "294") | yes: one unit |
| unrelated | `refused` | none | — | no: the unit returns |

The charging rule is the product's own (`customerUse.ts`, `eligible`): a unit is charged only for
a delivered result whose outcome is `extracted`. The panel states that rule; it doesn't restate
a price as if a sale happened.

**"Nothing sent, nothing recorded" is literal.** The sample panel reads only the bundled
`samples.json`: no request, no analytics event, no log line. Its label is "Sample run: a fixed
answer from Everstreet's stand-in model, prepared in advance and checked by our tests. Nothing
is sent or recorded." There is no free-text box (the stand-in can't honestly answer free text).

## 3. The public example (`/example/ledgerline`): real history, allowlisted

The example's history is **the verified NEAR testnet run of example 1**
(`data/evidence/v3-direct-testnet.json`, committed). It isn't a simulated dataset. The server
exposes one public read, `GET /api/examples/ledgerline`, built by `server/src/examples.ts`:

1. **Integrity first.** It loads the committed record, checks its digests with the same offline
   verifier (`verifyRehearsal`), and serves nothing if they fail.
2. **Allowlist, not hiding.** It builds a new object from named fields only:
   - the contract account and code hash;
   - the checkpoints' entitlement free and consumed, owner and generation, the block height and
     time;
   - the transactions' step, role, method, hash, explorer link and success;
   - the release events (release id and artifact job), and the old owner's refusals (status
     only).

   It never includes app-route bodies, cookies, results, document text or anything outside that
   list. It never reads the database, so no owner's private record can leak into it.
3. **Per-source provenance on every figure:**

   | Source tag | Meaning |
   |---|---|
   | `near_testnet_final` | a contract view at final finality, at a named block |
   | `near_testnet_tx` | a finalized transaction (explorer link) |
   | `rehearsal_app_record` | what the app's routes answered during the run |
   | `stand_in_model` | AI results came from the labelled stand-in, never a provider |

   Each figure carries its own source tag; nothing flips a whole page from "simulated" to
   "testnet". If the record were ever replaced by a different run, each figure would still
   carry its own tag.
4. **Derived numbers (the numeric spec).** Headline figures are computed from the record in
   code, and the test checks each against the formula:
   - prepaid = units bought × unit price = 100 × 0.15 = **15 tUSD**;
   - earned (contract consumed × price) at the end = 22 × 0.15 = **3.30 tUSD**;
   - owed at close = free at the `closed` checkpoint = **80**;
   - after the buyer's next use **79**; after the update **78**;
   - control: founder at generation **1**, then buyer at generation **2**.

**Tabs.**
- **Try** is the homepage panel.
- **Operate** shows these figures with their sources, plus a small accessible table of the
  checkpoints.
- **Acquire** shows "buyer takes control of / customers keep", built from the same record:
  owner and generation before and after, the 80 owed at close, the former owner's refusal,
  the next use under the buyer.

The proposal's "simulated 30-day" Operate numbers are dropped from the public example. They
belong to the demo account (§6).

## 4. The Example businesses section

- **Ledgerline:** "Try a sample" and the example page.
- **Relaydesk and Signalwatch:** "Not tryable yet", with the reason in text. Their three-step
  story is drawn by small presentational components labelled "Illustration, not a run": no fake
  loading, no disabled pseudo-app, no success animation (Astra 7). They become tryable only when
  their engines run. Nothing here depends on those engines existing.
- **Look (Astra 6):**
  - quiet paper, a dashed boundary and the eyebrow "Example business · sample data" (warm only
    in the small label);
  - kept structurally apart from the real catalog: never in Explore, Find, the catalog or
    Acquire listings;
  - returned, refused and unknown each get their own pattern, never all "dashed".
- **Stage priority (Astra 1):** the Ledgerline sample stays in the homepage rail; real published
  products lead the live catalog and search. Revisit after real catalog use.

## 5. Corrections from the job, one by one

| Job item | Resolution |
|---|---|
| 1. Arithmetic: 350 − 212 = **138**, not 149; returned holds aren't new prepaid units; reconcile the day counts and the "49 agent uses" | The public example uses only the verified record (§3). The demo account's figures are computed from its own seeded records (§6), and a test checks every headline against them. The proposal's 149, 31.80 and "49" are withdrawn |
| 1. Sample invoice mismatch (200 + 60 vs 294) | The fixture's own text and tested output: 260 vs a stated 300 (§2) |
| 2. Per-source provenance; no global flip; no fabricated chain time | Per-figure tags (§3.3). The demo account's simulated history is tagged `simulated_chain`, and a testnet rehearsal never back-dates anything |
| 3. Allowlisted public projection; isolation; no shared keys; "nothing recorded" honest | §3 (allowlist from a verified committed record, no database read) and §2 (no request at all). No public interactive demo session exists in this slice |
| 4. Early small Ledgerline history unlocks the homepage; no dependency on unbuilt engines | The example 1 testnet record *is* that history, reproducible with `scripts/v3-rehearsal.ts` |
| 5. Actor-specific attention | §6.2 |
| 6. Astra's ten decisions | §4, §6 and the table in §7 |

## 6. Demo account (later: plan step 7, Fable for its visual design)

### 6.1 Its data

- **Founder:** Marisol Teague (initials "MT", no portrait). The name is provisional, and the
  final name is Tony's choice.
- **Persistent label:** "Demo founder · Simulated history", visible in the account itself, not
  only on a dismissible welcome.
- **How it's built:** a seed script runs the real flows on the simulated chain in its own
  disposable installation. Every headline is derived from the records it makes; no figure is
  hand-edited to match a mockup. A test checks each headline against the derivation.
- **Order:** daily projections come before any chart.

### 6.2 Attention belongs to the actor

| Item | Shown to | Never shown as |
|---|---|---|
| Accept the sale terms | the buyer (it's their step) | a seller's task |
| Renew an expired agent grant | the customer who owns the grant | an owner's task |
| A request still in progress | its current stage only; a completed one is history | "stuck" after completion |

### 6.3 Dashboard rules (Astra 9, 3, 4, 5, 10)

- **Default view:** attention, four figures, earned / compute / usage, current control and the
  next action. Secondary breakdowns sit in named disclosures: "Usage detail", "Customer
  obligations", "Releases and checks".
- **Keyboard:** one chart entry with arrow navigation or direct table access, never hundreds of
  tab stops.
- **Chart tokens:**
  - `--data-refused` (slate, cross pattern) and `--data-agent` (violet, dot pattern), pending a
    contrast test;
  - refusal isn't error red, and agent isn't success;
  - pattern, legend and table carry meaning without color.
- **No totals across businesses.** Later only for an identical network, token contract,
  decimals, period, completeness and definition.
- **Customer data is aggregate by default.** No per-customer chart in public or buyer views.
- **Compute:** shown as a known subtotal plus the number of calls with unknown cost, never a
  "complete" total.
- **Releases:** a stable per-project sequence plus a short digest; the evaluation result is a
  separate fact. No "v1.4".
- **Portfolio (Astra 2):** Operate owns My businesses; Acquire keeps Considering and acquisition
  receipts. Deep links are preserved.

## 7. Astra's ten decisions, where each lands

| # | Decision | Where |
|---|---|---|
| 1 | Ledgerline in the rail; real products lead the catalog | §4 |
| 2 | Portfolio under Operate | §6.3 (build with the demo stage) |
| 3 | `--data-refused`, `--data-agent` with patterns | §6.3 |
| 4 | No overview totals in this slice | §6.3 |
| 5 | Aggregate customer data by default | §6.3 |
| 6 | Example look: paper, dashed boundary, eyebrow; structurally separate | §4 |
| 7 | Component illustrations, "Illustration, not a run" | §4 |
| 8 | Initials; provisional name; persistent identity | §6.1 |
| 9 | Named disclosures; keyboard economy | §6.3 |
| 10 | Sequence + digest release names | §6.3 |

## 8. Stages and what each must pass

| Stage | Builds | Passes |
|---|---|---|
| **A (now)** | `samples.json` with its generator and drift test; `GET /api/examples/ledgerline` (verified record → allowlisted, provenance-tagged projection) and its tests | the full check; isolation and derivation tests |
| B | Homepage: the try panel (from samples.json, no requests), the Example businesses section, the import tile wording, the readiness disclosure; `/example/ledgerline` with Try / Operate / Acquire | browser at 1440, 1280 and phone, keyboard, the 200% equivalent; no request from the panel (network check) |
| C | The Relaydesk and Signalwatch illustration components; tryable only when their engines exist | same |
| D | The demo account seed and dashboard (Fable for its visual design) | headline-derivation test; screen passes |
