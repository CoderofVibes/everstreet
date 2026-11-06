# Permissions review brief: Everstreet's own server and app (off-chain)

You are reviewing a web application as an attacker would. You have not seen this project before.
Do not look for earlier reviews, reports or the project's own tests; read only what is listed under
"What you may read". Your job is to break the permissions, not to confirm they work.

## What Everstreet is

People start small online businesses, sell to customers, and can sell the whole business to a
buyer. Ownership and money live in one NEAR contract per business (already reviewed separately;
out of scope here). Everything else lives in Everstreet's own server (`server/src`, Hono + SQLite)
and web app (`web/src`, React): sign-in, business records, customer requests and cases, team
members, helpers, AI agent access, the sale room, the buyer's evidence room, the handover record,
published pages and app passes.

The contract review covered on-chain promises only. This review covers whether the server keeps
the same promises in its own records and routes.

## The promises (each is a target)

1. **Only the current owner runs a business.** After a sale closes, the seller's open session,
   team members, helpers, agent keys, invitations and anything they queued before the close stop
   working for that business, at once.
2. **A customer sees only their own** purchases, requests, results, cases and device keys.
3. **Team members and helpers see and do only what their role allows**, only while their grant is
   live, and never after it is revoked or the business changes hands.
4. **A buyer sees only what the seller shared** for that sale, only while that sharing is live,
   and nothing private from other sales or businesses.
5. **One business's private records are never reachable through another business's id**, or
   by guessing ids, tokens or addresses.
6. **Signed-out visitors see only published pages.** Drafts, unpublished businesses, studio
   projects and private app passes stay private.
7. **Signing in proves control of the account.** No replayed, forged, cross-site or reused sign-in;
   a session belongs to one account.
8. **Everstreet never shows or acts on a state the chain contradicts** (for example, treating the
   seller as owner after the contract says the buyer is).

## Who you play

Work through each role in turn and write findings as you go.

- **Former owner** with a session that was open before the sale closed: read private records,
  change offers, release versions, withdraw, invite, appoint, reply to customers.
- **Former team member or helper**: use a role after revocation or after the sale.
- **Queued action**: something prepared or requested before the close (a sale action, a release,
  an operator command, an invitation, a maintenance job) that completes after it.
- **Buyer**: before acceptance, read more than the evidence room shares; after a grant expires or
  the sale is cancelled, keep reading.
- **Customer**: read or act on another customer's records; act on a business they never bought from.
- **Agent** (AI agent access): exceed its scope or outlive its revocation.
- **Outsider**, signed out or signed in as an unrelated account: call every `/api/*` route with
  other people's ids; guess tokens and pass addresses; forge sign-in.

Check deliberately: routes that check sign-in but not ownership; checks done before an await and
not repeated in the write; ids taken from the request body instead of the session; list endpoints
that filter in the client; error messages that leak existence or contents; caches keyed without
the account; the owner generation from the contract vs the server's own owner field.

## What you may read

- `server/src/**`, `web/src/**`
- `docs/AUTHORITY.md` and in `docs/design/`: `TEAM_AUTHORITY.md`, `HELPER_READ_AUTHORITY.md`,
  `AGENT_ACCESS.md`, `DIRECT_SALE.md`, `MANAGED_HANDOVER.md`, `ACQUISITION_WORKSPACE.md`,
  `CUSTOMER_WORKSPACE.md`, `WEB_APP_RELEASE.md`, `APPLICATION_COMPOSITION.md`, `DEMO_ACCOUNT.md`
- `scripts/demo.ts`, `scripts/lib/demo/**`, `scripts/sale-harness.ts`, `scripts/lib/walletHarness.ts`
- Test helpers in `server/test/` whose names do **not** contain `.test.` (worlds and fixtures such
  as `customer-world.ts`, `sale-world.ts`, `handoverWorld.ts`, `fake-chain.ts`)

Do **not** read any `*.test.ts` or `*.test.tsx` file, anything in `reports/` or `docs/astra/`,
`docs/SAFETY_CASE.md`, or any other review.

## Proving a finding

A finding is strongest with a test. Write tests only in a new folder
`server/test/permissions-review/` (create it; edit nothing else in the repository). Each test
asserts **the promised behaviour**, so a **failing** test proves the finding and a passing test
means the attack was refused. Name them `pr<NN>_<what is attempted>`. Build worlds with the
helpers above. Run one file with:

```
npx vitest run server/test/permissions-review/<file>
```

You may also run the local demo, which is fictional and uses a synthetic wallet and chain:
`npm run web:build` once, then `npx tsx scripts/demo.ts --minutes 120` in the background. The site
is http://127.0.0.1:8820; `POST http://127.0.0.1:8821/account/<account>` switches who the synthetic
wallet signs as (`delphine.near` owner, `buyer.near` buyer, `cara.near` and others customers,
`rosa.near` newcomer). Its Signalwatch sale is proposed and funded but not accepted, so you can
finish it to get a former owner. Stop the demo when you're done.

No network access is needed. Do not use NEAR testnet or mainnet, do not touch `.near-credentials`,
and do not run anything that calls a paid AI model.

## Output

Write `<your scratch folder>/permissions-review.md` and append as you go, one finding at a time.
For each finding:

- **Number and title**
- **Severity**: Critical (another person's money or control, or any private record of a business
  you don't run), High (a promise above broken in a reachable way), Medium (a promise weakened, or
  a leak of existence or metadata), Low (hardening), Note (worth knowing)
- **Role**
- **Steps**: exact requests or calls in order
- **What should happen** and **what happens**
- **Proof**: test name and file, failing (finding) or passing (refused)
- **Location**: file and function

At the end add "Tried and refused": one line per attack the server stopped, with the function that
stops it. Finish with a summary: counts by severity and the one change you would make first.
