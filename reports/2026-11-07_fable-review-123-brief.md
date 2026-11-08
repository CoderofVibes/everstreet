# Cold review of three new pieces (November 7, 2026, late)

You are reviewing three pieces of work added to Everstreet today, a NEAR hackathon entry. Your
job is to find what is wrong, misleading or weaker than it claims: code, evidence, screens and
wording. **Review and report only: do not build, fix or change anything.**

## Rules

- **Do not edit, create, move or delete any file** except your report and your screenshots (paths
  below). No commits, no branches, no pushes, no `npm install`.
- **Do not send any NEAR or Sepolia transaction.** Read-only chain reads are fine, including
  `npx tsx scripts/verify-rehearsal.ts <record> --live`. Do not run any script under `scripts/`
  that sends transactions (`series*.ts`, `linked-revenue-testnet.ts`, `setup-*.ts`, `*-rehearsal.ts`,
  `attack-pairs.ts`, `ledgerline-after-sales.ts` writes a file: don't run it either).
- **Never open, print or copy key files**: `.near-credentials/`, `~/.near-credentials/`,
  `.evm-credentials/`. Don't print environment variables.
- Don't open anything in `reports/` other than this brief. Don't edit `README.md`.
- Stay on `127.0.0.1` / `localhost` in the browser. Explorer links point at public testnet
  explorers: note where they point, don't follow them.
- You may read any code, docs, tests and evidence in the repository, and run `npm run check`,
  `npx vitest run <file>`, `npm run attacks -- --check` (writes nothing with `--check`) and
  `npm run proof-site` (it only writes the ignored folder `web/dist-proof/`).

## What was built

1. **The handover strip** on the recorded-proof page (`/proof/ledgerline`). For each recorded
   testnet sale of the example business Ledgerline it shows the close (block, transaction), the
   former owner's first refused call after the close (said to be a chain transaction), and the
   customer's unused uses where that run read them; then a read-only snapshot after the last sale.
   Only records whose digests verify are read.
   Code: `server/src/examples.ts` (`handoversOf`), `web/src/pages/RecordedProof.tsx`,
   `scripts/ledgerline-after-sales.ts`. Evidence: `data/evidence/v3-direct-testnet.json`,
   `v3-ext-testnet.json`, `v3-s4-testnet.json`, `ledgerline-after-sales-testnet.json`.

2. **Revenue by source** on a sale's economics page (`/sales/:id/economics`, for the owner and a
   buyer in a live deal). Earned revenue is split into independent customers and customers linked
   to the seller, each linked one with its reason; a customer whose registration payer couldn't be
   read is counted apart; what isn't checked is stated. The buyer's projection on the same page is
   said to start from independent customers' uses. Also: one attack-suite case, a demo setup, and a
   testnet run.
   Code: `server/src/revenueSources.ts`, `server/src/useEconomics.ts`,
   `web/src/pages/UseEconomicsPage.tsx`, the case "Seller pays its own business" in
   `scripts/attack-suite.ts`, `scripts/lib/demo/world.ts`, `scripts/linked-revenue-testnet.ts`,
   `scripts/lib/testnetRun.ts`. Evidence: `data/evidence/linked-revenue-testnet.json`,
   `data/evidence/attack-suite.json`.

3. **A static copy of the recorded proof**, built locally and not yet published: the proof pages
   served with no Everstreet server behind them, their data written at build time.
   Code: `web/src/proofSite.tsx`, `web/proof.html`, `web/vite.proof.config.ts`,
   `scripts/build-proof-site.ts`.

The contract (`contracts/business-v3`) and how authority works (`docs/AUTHORITY.md`) are context;
you aren't reviewing them.

## What to check, for each piece

- **Does each claim hold?** Read the code and the evidence; try to make it say something false.
  Would a careful judge reading the screen come away believing something the evidence doesn't
  support?
- **Correctness and edge cases**: missing or malformed records, resumed runs, several sales,
  unusual accounts, unknown values shown as zero or as fact.
- **Permissions and privacy**: who can see what, and whether anything is shown to someone who
  shouldn't see it (customer identities, other people's data, anything from the database on a
  public page).
- **The evidence**: do the records verify (offline and `--live`)? Does what the screens show
  match them? Is anything simulated presented as if it happened on chain?
- **The static copy**: is anything in it that shouldn't be public (keys, tokens, private data,
  internal paths)? Does every route work from a plain static host? Does anything depend on a
  server?
- **Tests**: do the tests actually pin the claims, or would they pass with the claim broken?
- **Screens**: look at the pages at **1440 px** and **390 px** wide with the browser pane.

## Running it

- The demo (fictional people, synthetic chain): http://127.0.0.1:8820/ with wallet control on
  http://127.0.0.1:8821/. If it isn't answering, start it with the browser pane's `preview_start`
  and the name `demo`, and wait about a minute. Restarting resets it.
- Signing in as someone: `curl -s -X POST http://127.0.0.1:8821/account/<account>`, then sign in on
  the site with the synthetic wallet. Accounts: `delphine.near` (the seller; owns Signalwatch),
  `buyer.near` (the buyer in Signalwatch's live sale), `cara.near` (a customer), `rosa.near`
  (new, nothing yet).
- Signalwatch's sale economics: find Signalwatch's id from the seller's portfolio, then
  `/sales/<id>/economics`.
- The static copy: `npm run proof-site`, then preview it with the browser pane's `preview_start`
  and the name `proof-site` (http://localhost:8830/), or
  `npx vite preview --config web/vite.proof.config.ts`.

## Report

Write `reports/2026-11-07_fable-review-123.md`:

1. A verdict per piece in one or two sentences: does it hold, and how strong is it?
2. Findings, most severe first. For each: severity (high / medium / low), the piece, what is wrong,
   how to reproduce it or where (file and line), and why it matters to a judge or a user. Mark
   anything you're unsure of as a question rather than a finding.
3. What you checked and found sound, briefly, so the next reader knows what was covered.

Screenshots, if you take any: `reports/first-use-shots/2026-11-07-review-123/`.
