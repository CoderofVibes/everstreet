# Second cold pass, permissions (November 7, 2026, evening)

You are reviewing a web application as an attacker would. You have not seen this project before.
Do not look for earlier reviews, reports or the project's own tests; read only what is listed under
"What you may read". Your job is to break the permissions, not to confirm they work.

## What Everstreet is

People start small online businesses, sell to customers, and can sell the whole business to a
buyer. Ownership and money live in one NEAR contract per business (out of scope here), with two
optional companion contracts (an external-asset key and a spending allowance) that ask the business
contract who owns it. Everything else lives in Everstreet's own server (`server/src`, Hono + SQLite)
and web app (`web/src`, React). This pass concentrates on five areas:

- **Escrow funding from another token through NEAR's intents verifier**, with Everstreet as the
  labelled solver (`server/src/intentsFunding.ts`, `server/src/solverRpc.ts`; routes
  `/api/sales/:business/intents`, `/api/sales/:business/intents/quote`, `/api/intents/:id`,
  `/api/intents/:id/sign`; config `appConfig.intents` with the solver's key **file**).
- **The companions and the business's economics** (`server/src/companions.ts`,
  `server/src/useEconomics.ts`; routes `/api/companions/:business`, `/api/companions/:business/prepare`,
  `/api/companions/actions/:id/sent`, `/api/sales/:business/economics`,
  `/api/businesses/:id/companions`).
- **Sale participants over time** (`server/src/saleActions.ts`: `gate`, `proofContext`,
  `currentContext`, `setup`): who may read what before, during and after a sale, and after a
  cancelled deal.
- **Sign-in** (`server/src/identity.ts`, `server/src/store.ts` `personForAccount`,
  `/api/session/*`).
- **Routes behind services this composition doesn't connect** (bookings, payments, deals in
  `server/src/app.ts`: `needBookings`, `needPayments`, `needDeals`).

## The promises (each is a target)

1. **Only the sale's buyer can quote, sign or fund the intents flow for that sale**, only while the
   deal is live, the buyer is still the buyer and the escrow is unfunded; the solver fills at most
   once per deal; the solver signs only its own side, only for a quote it issued; the solver's key
   never leaves the server (no response, log, error, config echo or evidence file).
2. **Everstreet never shows a swap as done that the verifier did not spend**, nor tUSD as delivered
   that did not leave the verifier, nor an external role as moved before the other chain finalized
   it; the stages come from the chain's records, not from the solver's own answer or the server's
   memory.
3. **A former owner, and a buyer whose deal ended (cancelled, expired, or a later sale), read
   nothing current** about the business: not its economics, not its companions, not its live deal.
   A past participant keeps only their own receipts (their outcomes, claims, payouts).
4. **Which businesses have companions is the owner's to know**; another signed-in account learns
   nothing from a business id, and a missing id answers the same as someone else's.
5. **Signing in proves control of the account**; every refusal is the same 401, including for an
   account already linked to someone else here.
6. **Sign-in is checked before anything else**: a signed-out probe of any private route is 401,
   whatever services the composition connects.
7. **Only the current owner runs a business**; after a sale closes the seller's open session,
   members, helpers, agent keys and queued actions stop working for it (the server's record follows
   the contract within one watcher pass, every 15 seconds; a participant's own check applies it at
   once).

## Who you play

- **Buyer**: quote, then fund the escrow another way, then sign; quote twice and sign both; quote,
  let the seller cancel, then sign; sign for a deal that was re-proposed with a new sequence; make the
  solver's execute answer lie (a `SolverPort` that returns a hash without the verifier moving
  anything) and see what the stages say; withdraw part of the tUSD and see what "delivered" says.
- **Former owner** with a session from before the close: economics, companions, live deal, the
  intents panel, the proof, the receipt; prepare and send a companion request.
- **Ended buyer**: after a cancel, after expiry, after a later sale to someone else.
- **Stranger and signed-out visitor**: every route named above with real ids and with missing ids.
- **A wallet holding a key** for an account linked to another person here.

Check deliberately: what each route reads from the chain versus the server's own tables; checks
done before an await and not repeated after; ids from the body instead of the session; whether
"current" is decided from `businesses.owner_id`, from `get_control`, or both; what a reconcile or
watcher pass changes.

## What you may read

- `server/src/**`, `web/src/**`
- `docs/AUTHORITY.md`, `docs/INTENTS.md`, `docs/BUILDS.md`, `docs/DEMO_HTTP.md`, and in
  `docs/design/`: `DIRECT_SALE.md`, `MANAGED_HANDOVER.md`, `ACQUISITION_WORKSPACE.md`,
  `TEAM_AUTHORITY.md`, `AGENT_ACCESS.md`, `DEMO_ACCOUNT.md`
- `scripts/demo.ts`, `scripts/lib/demo/**`, `scripts/lib/walletHarness.ts`
- Test helpers in `server/test/` whose names do **not** contain `.test.` (`customer-world.ts`,
  `sale-world.ts`, `fake-chain.ts`, `companion-chain.ts`, `intents-chain.ts`, `sale-chain.ts`)

Do **not** read any `*.test.ts` or `*.test.tsx` file, anything under `server/test/permissions-review/`
or `server/test/permissions-review-2/` (earlier folders; do not open them), anything in `reports/`
or `docs/astra/`, `docs/SAFETY_CASE.md`, or any other review.

## Proving a finding

Write tests only in a new folder `server/test/permissions-review-3/` (create it; edit nothing else).
Each test asserts **the promised behaviour**, so a **failing** test proves the finding and a passing
test means the attack was refused. Name them `pr<NN>_<what is attempted>.test.ts`. Build worlds with
the helpers above (the sale world plus the companion and intents attachments). Run one file with:

```
npx vitest run server/test/permissions-review-3/<file>
```

A demo may be running on 8820/8821 for another reviewer: leave it alone (read-only requests are
fine). For a demo of your own: `npx tsx scripts/demo.ts --minutes 120 --port 8840` (controls on
8841), stopped when done. No network. Do not touch `.near-credentials`, `.evm-credentials` or any
key file, and run nothing that calls a paid AI model.

## Output

Write `reports/2026-11-07_second-pass-permissions.md`, appending one finding at a time: number and
title; severity (Critical, High, Medium, Low, Note as in any permissions review: Critical is another
person's money or control, or key material; High a promise above broken in a reachable way; Medium a
promise weakened or a leak of existence or metadata; Low hardening); role; steps; what should happen
and what happens; proof (test name and file, failing or passing); location. End with "Tried and
refused" (one line per attack the server stopped, with the function that stops it) and a summary:
counts by severity and the one change you would make first. Reply with that summary.
