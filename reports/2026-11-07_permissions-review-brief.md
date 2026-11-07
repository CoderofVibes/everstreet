# Permissions review brief: Everstreet's own server and app, off-chain (November 7, 2026)

You are reviewing a web application as an attacker would. You have not seen this project before.
Do not look for earlier reviews, reports or the project's own tests; read only what is listed under
"What you may read". Your job is to break the permissions, not to confirm they work.

## What Everstreet is

People start small online businesses, sell to customers, and can sell the whole business to a
buyer. Ownership and money live in one NEAR contract per business (reviewed separately; out of
scope here), with two optional companion contracts (an external-asset key and a spending
allowance) that ask the business contract who owns it. Everything else lives in Everstreet's own
server (`server/src`, Hono + SQLite) and web app (`web/src`, React): sign-in, business records,
customer requests and cases, team members, helpers, AI agent access, the sale room, the buyer's
evidence room, the handover record, published pages and app passes, and, new since the last
look:

- **Companions** configured through `appConfig` (`companions`: an EVM testnet RPC and per-business
  bindings). `server/src/companions.ts` reads them, prepares the owner's wallet calls, and relays
  an MPC-signed EVM transaction through `server/src/evmRpc.ts`. The owner's page is
  `/desk/:id/allowance`.
- **Escrow funding from another token through NEAR's intents verifier**, with Everstreet acting as
  the solver (`appConfig.intents`: verifier, solver account and the solver's **key file**, bindings).
  `server/src/intentsFunding.ts` runs the stages (quoted, deposited, swapped, delivered, funded;
  failures expired, refused, refunded, unknown); `server/src/solverRpc.ts` signs the solver's side
  with that key and submits both sides. Routes: `/api/sales/:business/intents`,
  `/api/sales/:business/intents/quote`, `/api/intents/:id`, `/api/intents/:id/sign`.
- **HTTP 402 agent purchases**: an AI agent with its own account gets `402 Payment Required` with
  the exact purchase when it has no units (`server/src/paymentOffers.ts`); the owner's view is
  `/desk/:id/agent-purchases` and `/api/businesses/:id/agent-purchases`.
- **Proof pages**: `/sales/:id/proof` (the closing receipt and its sources),
  `/sales/:id/economics`, `/attacks` (a public docket of attack cases with testnet pairs,
  `/api/public/attacks`) and `/proof/ledgerline` (a recorded testnet run with a light-client proof,
  `server/src/lightClient.ts`).
- **The RPC allowlist** (`server/src/v3rpc.ts`): the app forwards only fixed contract views with
  exact arguments, now including the companions' views and five of the intents verifier's.

The contract review covered on-chain promises only. This review covers whether the server keeps
the same promises in its own records and routes.

## The promises (each is a target)

1. **Only the current owner runs a business.** After a sale closes, the seller's open session,
   team members, helpers, agent keys, invitations and anything they queued before the close stop
   working for that business, at once. That includes the companions' owner pages and wallet
   requests.
2. **A customer sees only their own** purchases, requests, results, cases, device keys and 402
   offers.
3. **Team members and helpers see and do only what their role allows**, only while their grant is
   live, and never after it is revoked or the business changes hands.
4. **A buyer sees only what the seller shared** for that sale, only while that sharing is live,
   and nothing private from other sales or businesses.
5. **One business's private records are never reachable through another business's id**, or
   by guessing ids, tokens, intent ids or addresses.
6. **Signed-out visitors see only published pages.** Drafts, unpublished businesses, studio
   projects, private app passes, other people's sale proofs and economics stay private. Decide
   for yourself what a public attack docket and a recorded proof page may show, and flag anything
   on them that looks private.
7. **Signing in proves control of the account.** No replayed, forged, cross-site or reused sign-in;
   a session belongs to one account.
8. **Everstreet never shows or acts on a state the chain contradicts** (for example, treating the
   seller as owner after the contract says the buyer is; showing a swap as done that the verifier
   did not spend; showing an external role as moved before the other chain finalized it).
9. **Only the sale's buyer can quote, sign or fund the intents flow for that sale**, only while the
   escrow is unfunded; the solver signs only its own side, only for a quote it issued, only
   once per quote; the solver's key never leaves the server (not in any response, log, error,
   config echo or evidence file); nobody can make the solver pay for a swap that doesn't fund a
   real sale.
10. **The RPC allowlist stays an allowlist.** No route lets a caller choose a contract, a method
    or arguments outside the fixed set, or point a read at another business's companions or a
    different verifier.
11. **An agent that gets a 402 pays from its own account** and gets exactly the units it bought;
    its purchases never land on another customer or let it act as the owner.

## Who you play

Work through each role in turn and write findings as you go.

- **Former owner** with a session that was open before the sale closed: read private records,
  change offers, release versions, withdraw, invite, appoint, reply to customers, publish to the
  external asset, grant or approve from the budget.
- **Former team member or helper**: use a role after revocation or after the sale.
- **Queued action**: something prepared or requested before the close (a sale action, a release,
  an operator command, an invitation, a maintenance job, an intents quote, a companion request)
  that completes after it.
- **Buyer**: before acceptance, read more than the evidence room shares; after a grant expires or
  the sale is cancelled, keep reading; quote or sign an intent for a sale you're not the buyer of,
  or after escrow is already funded; reuse a quote; get the solver to fill twice.
- **Customer**: read or act on another customer's records; act on a business they never bought from.
- **Agent** (AI agent access, and a 402-paying agent): exceed its scope or outlive its revocation;
  spend units it didn't buy; have its purchase credited elsewhere.
- **Outsider**, signed out or signed in as an unrelated account: call every `/api/*` route with
  other people's ids; guess tokens, intent ids and pass addresses; forge sign-in; probe the RPC
  allowlist and the proof routes; look for the solver key or any key material in any response.

Check deliberately: routes that check sign-in but not ownership; checks done before an await and
not repeated in the write; ids taken from the request body instead of the session; list endpoints
that filter in the client; error messages that leak existence or contents; caches keyed without
the account; the owner generation from the contract vs the server's own owner field; what the
server trusts from its own config vs from the chain; what a stage transition in the intents flow
is read from (a response the solver got, or the verifier's own state).

## What you may read

- `server/src/**`, `web/src/**`
- `docs/AUTHORITY.md`, `docs/INTENTS.md`, `docs/BUILDS.md` and in `docs/design/`: `TEAM_AUTHORITY.md`,
  `HELPER_READ_AUTHORITY.md`, `AGENT_ACCESS.md`, `DIRECT_SALE.md`, `MANAGED_HANDOVER.md`,
  `ACQUISITION_WORKSPACE.md`, `CUSTOMER_WORKSPACE.md`, `WEB_APP_RELEASE.md`,
  `APPLICATION_COMPOSITION.md`, `DEMO_ACCOUNT.md`
- `scripts/demo.ts`, `scripts/lib/demo/**`, `scripts/sale-harness.ts`, `scripts/lib/walletHarness.ts`,
  `scripts/attack-suite.ts`
- Test helpers in `server/test/` whose names do **not** contain `.test.` (worlds and fixtures such
  as `customer-world.ts`, `sale-world.ts`, `handoverWorld.ts`, `fake-chain.ts`,
  `companion-chain.ts`, `intents-chain.ts`)

Do **not** read any `*.test.ts` or `*.test.tsx` file, anything under `server/test/permissions-review/`
(an earlier folder; do not open it), anything in `reports/` or `docs/astra/`, `docs/SAFETY_CASE.md`,
or any other review.

## Proving a finding

A finding is strongest with a test. Write tests only in a new folder
`server/test/permissions-review-2/` (create it; edit nothing else in the repository). Each test
asserts **the promised behaviour**, so a **failing** test proves the finding and a passing test
means the attack was refused. Name them `pr<NN>_<what is attempted>.test.ts`. Build worlds with the
helpers above. Run one file with:

```
npx vitest run server/test/permissions-review-2/<file>
```

You may also use the local demo, which is fictional and uses a synthetic wallet and chain. It is
already running at http://127.0.0.1:8820 for another reviewer who is using the browser pane, so
**do not use the browser pane** and do not restart the demo; use plain HTTP (`curl` or `fetch`)
against it. `POST http://127.0.0.1:8821/account/<account>` switches who the synthetic wallet signs
as (`delphine.near` owner, `buyer.near` buyer, `cara.near` and others customers, `rosa.near`
newcomer); `POST http://127.0.0.1:8821/sale/accept-both` closes the Signalwatch sale, so you can
get a former owner (that changes what the other reviewer sees; prefer your own demo for it). The
demo's buyer holds the other test token for the intents flow, and its verifier, token and solver
are synthetic. For a demo of your own, start one with
`npx tsx scripts/demo.ts --minutes 120 --port 8840` (controls on 8841) and stop it when done.

No network access is needed. Do not use NEAR testnet, Sepolia or mainnet, do not touch
`.near-credentials`, `.evm-credentials` or any key file, and do not run anything that calls a
paid AI model.

## Output

Write `reports/2026-11-07_permissions-review.md` (in the repository) and append as you go, one
finding at a time. For each finding:

- **Number and title**
- **Severity**: Critical (another person's money or control, or any private record of a business
  you don't run, or key material exposed), High (a promise above broken in a reachable way),
  Medium (a promise weakened, or a leak of existence or metadata), Low (hardening), Note (worth
  knowing)
- **Role**
- **Steps**: exact requests or calls in order
- **What should happen** and **what happens**
- **Proof**: test name and file, failing (finding) or passing (refused)
- **Location**: file and function

At the end add "Tried and refused": one line per attack the server stopped, with the function that
stops it. Finish with a summary: counts by severity and the one change you would make first. Reply
with that summary.
