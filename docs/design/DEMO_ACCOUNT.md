# Demo account and portfolio dashboard: the data side (plan step 7)

Plan step 7 (CLAUDE_RESUME.md): a demo sign-in for a FICTIONAL founder (not Tony) who runs
Ledgerline, Relaydesk and Signalwatch, one of them mid-sale. The history is produced by running the
real flows on the simulated chain over 30 days, labelled "Simulated history". The dashboard follows
Tony's mockup (`handoffs/2026-11-05/everstreet-portfolio-mockup.png`), with more charts, and never
sums across currencies. The visual design comes after the data (Fable mockups; Tony chooses).

## 1. Who and what (all fictional)

- **Founder:** Delphine Marsh, signed in through the synthetic
  wallet as `delphine.near` in the demo harness. No password: the "credential" is the harness's
  ephemeral key, which lives in the demo's own directory and is never printed.
- **Businesses:** Ledgerline (AI invoice API, extraction on the labelled stand-in model),
  Relaydesk (SaaS workflow), Signalwatch (agent service on the stand-in analyst). Each has its own
  synthetic business contract and offer.
- **Mid-sale:** Signalwatch, with a Direct sale proposed and funded by a fictional buyer, not yet
  accepted.
- **Customers:** a few fictional customers per business, with prepaid uses, using the products
  on most days.

## 2. How the history is made (derived, not hand-edited)

A demo world script (`scripts/demo.ts`, like the review harness) builds the businesses through
the real routes over the synthetic stack (customer world, sale chain, reconciler), then runs **30
simulated days**:
- each day, the synthetic clock advances one day; customers send requests (some refused, so not
  charged), units are charged when results are delivered, and the owner works cases;
- along the way: a release update with checks (Ledgerline v1 to v2), a case history, a team
  member invited and accepted (Relaydesk), a successor rehearsal (Relaydesk), the Signalwatch sale.

Every figure on the dashboard is then **read back from the records those flows wrote**: revenue
from charged units, compute expense from runtime usage, network fees and customer credits from the
synthetic contract. Nothing is typed in to match the mockup; if a number looks wrong, the flow is
fixed, not the number.

**Simulated time.** Records are timestamped with the process clock, so the demo runs in its own
process on a simulated clock: it starts 30 days before the real present and advances one day at a
time, so every record a flow writes carries the simulated day it happened on; the synthetic chain
follows the same clock (its blocks are timestamped by it). The clock ends at the real present and
then runs in real time while the same process serves the demo (the synthetic chain lives in its
memory). Nothing is backdated after the fact.

**The other engineering change:** the synthetic customer world binds one business contract today. The
demo needs three contracts in one database, so the synthetic chain grows a router (one synthetic
contract per business account behind the same reader, writer and sale transports).

## 3. The dashboard's data (before any visual work)

From the mockup, per business and per period (last 30 days, by default), each figure with its
source and units:
- earned revenue (token units, "NEAR ledger" = the synthetic contract's settlements), compute
  expense (runtime records, in the runtime's currency), network fees (NEAR), customer credits
  remaining (contract);
- daily revenue and expense series (one per currency; never summed across currencies);
- needs attention (a release to review, a pending charge, handover evidence to prepare);
- NEAR ownership (current owner, customer access carries over, handover history);
- the businesses table (role: owner, mid-sale).

These come from existing records (economics, operations, releases, ownership, the handover
record) through one portfolio dashboard read, built before any visual design.

## 4. Labels and limits

Everything on the demo is labelled **"Simulated history"** and **"Fictional"**: a synthetic
chain and wallet, stand-in models, fictional people and tokens. It runs locally only (no hosting
without Tony's yes). The script could later run on testnet, but only if Tony approves that
rehearsal.
