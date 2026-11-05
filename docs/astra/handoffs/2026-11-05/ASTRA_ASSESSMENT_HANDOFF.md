# Handoff to Astra: independent assessment of the November 5 direct build

From Claude Code (Opus 5.5), for Tony to give to Astra. Written November 5, 2026, after commit
`13b2c8c`. Read `docs/ASTRA.md` first; it still governs your seat.

## What Tony is asking for

An **independent assessment**, not more building. Tony gave Claude one long autonomous build
today (`handoffs/2026-11-05/CLAUDE_START_PROMPT.md`, `HANDOFF_STATE.md`,
`VISION_AND_BUILD_PLAN.md`) while your automatic goal was paused. Everything in it is
**builder-verified only**: Claude ran its own evidence. Nothing is independently accepted and no
milestone is closed. Tony wants your read before the next building phase begins.

Three things, in this order:

1. **Assess the build** against the vision and build plan: is it right, is it honest, does it
   hold up? Accept narrowly, accept with corrections, or reject, per item.
2. **Shape the showcase design** (Fable's proposal, below) and answer its open questions.
3. **Confirm or correct the agreed plan** for what comes next.

## Where everything is

| What | Where |
|---|---|
| The review packet: commits, exact checks, requirement/evidence matrix, browser findings, open items | `docs/astra/reports/2026-11-05_bulk-build-review.md` |
| Claude's live state and Tony's agreed plan (order of the remaining work) | `docs/astra/CLAUDE_RESUME.md` |
| Fable's showcase design proposal (homepage example businesses, demo account, dashboard) | `docs/design/SHOWCASE_DESIGN_PROPOSAL.md` |
| Tony's dashboard mockup | `docs/astra/handoffs/2026-11-05/everstreet-portfolio-mockup.png` |
| Design notes for each feature | `docs/design/` (WRITER_HISTORY, CONNECTED_SOURCE, EXPERT_HELP, PORTFOLIO, AGENT_ACCESS, WORKER_READINESS_002F1, EXTERNAL_REHEARSAL_PACKET) |

Commits to assess: `a0bbde8..13b2c8c` on `main` (18 commits, all local, nothing pushed).

## 1. The build assessment

**What was built today** (details and evidence per row are in the packet's matrix):
- **Phase A:** the flagship journey in one configured server process: the founder makes the
  product through the real routes; a fresh customer buys 100 and uses 20; a Direct sale; 80 at
  close; 79 after the buyer's next use; the buyer's update reaches the same customer. Plus the
  operators' writer-history procedure.
- **Phase B:** Studio Checks state real build/evaluation/release evidence, and manual checks are
  recorded. 002f1 stage 1 is in the repository only; no host was touched.
- **Phase C:** 004b connected source inspection (fictional GitHub fixture; no live call).
- **Phase D:** 005e economics, 005c expert help, 005d portfolio.
- **Phase F:** the 003x control sheet, portable handover record and offline verifier; 006b agent
  access (plain API and MCP 2026-07-28).
- **Phase G:** polish from Claude's own browser review.
- **Hardening (`13b2c8c`):**
  - a restart and concurrency matrix around the whole journey: the server is killed at the
    purchase check, at a lost hold answer, at a lost charge answer, at the close check and
    mid-model-call;
  - a Gated close inside the journey;
  - agent access across a sale, with a new owner switch per offer, off by default.

**What to check, in particular:**
- **Vision alignment:** does each feature serve "start a business, be found, hand it to a buyer
  without breaking customer obligations"?
- **Honesty:**
  - observed vs claimed vs verified (004b);
  - unknown never shown as zero or negative (005e);
  - nothing converted or summed across currencies;
  - self-reported expert profiles;
  - "Simulated" labels.
- **Authority:**
  - every new owner write is fenced and refused during a managed handover (the route guard
    `server/test/handover-routes.test.ts`);
  - the agent can't exceed its grant;
  - the seller loses control at close.
- **Test realism:** the process tests use synthetic chain, wallet and model doubles. Do they
  prove what the packet claims, and are any assertions vacuous?
- **Your own repeat:**
  - an independent `npm run check` (expect exit 0; main 1660 passed / 1 skipped; protected 12;
    process 63);
  - a real-browser pass of the pages Claude only partly covered: 1440, keyboard-only, zoom,
    reduced motion, `/agent-access`, the new "Agent use" switch, the portfolio at a narrow
    width.

**Known open items** (already in the packet, not news):
- base units instead of readable token amounts on offer and customer pages;
- narrow Checks cards at 1280;
- portfolio text overflow at narrow width;
- 006a, more product families, 006c, team/co-op ownership;
- the real worker host;
- live NEAR and live GitHub.

## 2. The showcase design (Fable's proposal)

Tony approved one Fable 5.1 design session for two pieces; **you own visual direction**, so it
comes to you to shape before Claude builds it. Read `docs/design/SHOWCASE_DESIGN_PROPOSAL.md`.

**How Tony understands the layers** (confirmed in chat):
1. **The base build is the product:** what any real founder, customer or buyer uses.
2. **The showcase layer sits on the real public site,** where a newcomer sees what Everstreet is
   about in a minute:
   - the homepage "try a sample" with three sample invoices on a labelled stand-in model, with
     nothing charged or recorded;
   - the "Follow it" view of the example business from the owner's and the buyer's side;
   - the Example businesses section (Ledgerline, Relaydesk, Signalwatch), kept visually apart
     from real listings.

   Your homepage note started this, and Tony agreed.
3. **The demo account is the platform shown in action:**
   - a **fictional** founder (Fable proposed Marisol Teague; Tony said not to use his name) with
     three businesses and 30 days of history;
   - the history is produced by running the real flows on the simulated chain and labelled
     "Simulated history";
   - it feeds the demo video and judges' walkthroughs.

   The dashboard is a real feature every owner gets; the demo data only fills it.

**Fable's open questions for you** (section 9 of the proposal):
- Stage priority against a real published product.
- Should Portfolio move from Acquire to Operate?
- Two new series tokens for charts: refused and agent.
- Same-asset totals across businesses.
- Privacy of per-customer credit burn-down.
- The "example" visual language.
- Static or component-built illustrations before the engines exist.
- The founder's name and avatar.
- Panel density: a disclosure or a long scroll.
- Release naming.

## 3. The agreed plan (Tony, Nov 5): confirm or correct

In order:
1. Hardening (done in `13b2c8c`).
2. The homepage with Ledgerline, followed into Operate and Acquire.
3. A product-type framework on trusted Everstreet-owned engines (no generated code), then
   Relaydesk (SaaS workflow) end to end.
4. Signalwatch (agent service) end to end.
5. 006a web apps:
   - immutable releases, rollback and retire;
   - a sandboxed customer origin;
   - free access or a time-based access pass;
   - real releases disabled until the worker host passes.
6. Team/co-op ownership, then 006c.
7. The demo account and the full dashboard.
8. Readable token amounts everywhere and full screen passes, then your review, then Tony's
   walkthrough.

Tony's decisions so far:
- web apps: free access plus a time-based pass;
- "Try a sample" uses the labelled stand-in, not a live provider;
- the demo founder is fictional;
- Fable was used only for the design session.

## Still waiting on Tony (don't decide these)

- The external testnet rehearsal: whether to deploy business-v3, the NEAR budget, a provider
  spend ceiling, who signs wallet steps, and whether Gated is in scope.
- A live read-only GitHub token for 004b.
- Dispatching 002f1 stage 2 on the worker host (it needs your dispatch and Tony's yes).
- Anything public: hosting, the video, submission.

## What to write back

Following `docs/ASTRA.md`:
- a pass file `docs/astra/2026-11-05_<Topic>.md` with a per-item verdict (accept narrowly /
  accept with corrections / reject), each with its evidence or reproduction;
- the corrections as jobs in `docs/astra/jobs/` with rows in `JOBS.md`;
- your answers to the showcase questions;
- any change to the plan's order.

Leave code changes uncommitted for Claude to review and commit; Claude makes every commit.

## Rules that still hold

- No push, posting, mainnet, spending, deployment, real signing or submission without Tony's
  explicit yes.
- Fictional data only.
- Never open `docs/research/`, keys, `.env` or `data/runtime/`.
- Day One stays separate.
- Never weaken isolation, receipt checks, encryption, authority fencing or verification gates to
  get a green result.
- The worker engine stays disabled.
