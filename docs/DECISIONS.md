# Decision log

Newest first. Routine engineering choices are Claude's; anything that changes the user promise
goes to Tony and Astra with an alternative.

## 2026-11-01 · Gate 1 (first 48 hours) — done in the first session

**Result.** On NEAR testnet, `openseat.everstreet.testnet` changed owner from the founder to
Northline in one call; the founder's real transactions were then refused on chain; OpenSeat
refused the founder's stale command and the founder-era worker; Northline appointed a new
worker; Sam, waitlisted before the sale, was promoted once under generation 2 and his original
reference `OS-HZ6VB-SBDEA` returns a confirmed seat and a calendar file. Every step and hash:
`data/evidence/handoff-testnet.json`. `npm run inspect` shows 0 keys on the contract account.

Decisions:

1. **One contract per business, born locked.** Root creates the account, funds it, deploys and
   calls `new` in one transaction and never adds a key. No upgrade method. Consequence: a contract
   fix means a new business account (`openseat-v2…`). Chosen because "the founder can't bypass the
   sale" is only true if nobody can redeploy.
2. **Authority generation** instead of revoking things one by one. A sale bumps it; every operator
   grant and signed OpenSeat command names one; both sides refuse a stale one.
3. **Operator commands are signed, not sessions.** OpenSeat has no operator login or API token. A
   command is signed with a key on the operator's NEAR account; OpenSeat checks the key on chain
   (full access, or function-call scoped to this business) and asks the contract
   `operator_check` at final finality. Nothing to keep using after the close.
4. **Two-party acceptance of one digest.** Either side may accept first; the buyer's acceptance
   holds the price; any revision voids both acceptances and returns the hold; the second matching
   acceptance settles, moves control and bumps the generation in the same call. Closing one deal
   voids any racing deal and returns its hold.
5. **Demo credits, not NEAR.** Integer units in the contract's own ledger (`asset()`: DEMO, 0
   decimals). The issuer (platform faucet) can mint to anyone except the business treasury.
6. **Obligations pay only their committed beneficiary** (`sha256(salt|account)`), so neither
   owner can redirect reserved funds to themselves through "fulfilment".
7. **OpenSeat on Node 24's built-in SQLite**, one write transaction per state change, outbox
   events in the same transaction, promotion jobs keyed by the cancellation (redelivery-safe).
8. **Testnet RPC is FastNEAR** (`test.rpc.fastnear.com`); `rpc.testnet.near.org` returned 429
   "deprecated" mid-run. The run resumed from its state file without repeating any transaction.
9. **Chain Signatures probe passed** (read-only): `v1.signer-prod.testnet` answers `public_key` and
   `derived_public_key`. No signature requested yet (that costs a deposit; later gate).
10. **Name.** Repo, docs and testnet root use "Everstreet" (Tony, Nov 1). Contract, tables and
    event names stay brand-neutral (`business_control`, `business-deal/v1`).

Assumptions that weaken the promise (flagged for Tony and Astra):

- **All demo identities' keys are on this one machine.** Founder, buyer and workers are separate
  NEAR accounts, but the demo holds all their keys. A real buyer would hold their own. The README
  must say so.
- **OpenSeat itself is operated by someone.** The contract proves who may operate; whoever hosts
  the OpenSeat process could still edit its database directly. For the hackathon the platform
  hosts it; a real handoff also needs the hosting itself transferred (that is the external
  "pending" item). This is the honest edge of the claim.
- **Finality window.** OpenSeat reads final state, so a command signed in the ~2 s between a
  sale's inclusion and its finality could still pass under the old generation.
- **The founder-era worker's refusal reads "not an operator"**, because the close clears grants.
  Accurate, but "grant is from generation 1" would tell the story better; small contract change
  for the next deployment.

- **Stale comment kept on purpose (Astra caught it, Nov 1).** The header of
  `contracts/business/src/lib.rs` says the deploy deletes the key after `new`; the real deploy
  never adds one (AUTHORITY.md is right). Even a comment change alters the built wasm (cargo-near
  embeds metadata), which would break `npm run inspect`'s "local build matches" check, so the
  comment is fixed with the next contract version.

Not done in gate 1 (next gates): founder launch flow, catalog and search, web UI, evidence room,
rehearsal mode, external simulated asset with its own completion evidence, sandbox replay of
the whole run from TypeScript, Chain Signatures action.

## 2026-11-01 (night) · Launch pad phase 1, desktop

Built from Astra's launch-pad pass, for Tony's computer rather than a phone (Tony, Nov 1).

1. **One local program.** `npm run app` (or `Start Everstreet.cmd`) builds the React app and serves
   it with the API on http://localhost:8800; data in `data/runtime/everstreet.db` (Node's SQLite).
2. **No AI calls yet.** Directions and offer drafts come from templates in `server/src/drafting.ts`
   so nothing is spent without Tony's yes; Astra's design keeps AI behind the same form, and the
   app works the same when AI is off.
3. **Local identities.** A person is created with just a name; the top-right menu can switch
   between local people so one person can try founder and visitor. This is local-preview only
   (`localPreview` flag); real sign-in (NEAR Auth) comes with payments.
4. **Honest actions.** A visitor can only say "Tell me when it opens" until the founder confirms
   date, place and price; then "Ask to book / order / get access". No payment in this phase.
5. **Privacy defaults.** Drafts are invisible to every public route; a founder sees a visitor's
   first name only unless the visitor ticks "share my name and contact"; a business's page address
   follows its name until first published, then never changes.

## 2026-11-02 · Phase 2: being seen, and real bookings

1. **OpenSeat is a real service, not a widget.** It runs in the same process for convenience but
   with its own database and is reached only through its HTTP API (`server/src/bookings.ts`).
   Studios (OpenSeat's customers) sign up, get an API key once (stored hashed), and can only
   see their own classes and rosters. Customer references never appear on public pages.
2. **Waitlist promotions are NEAR-checked in the running app.** `server/src/main.ts` runs
   OpenSeat's `PromotionWorker` as `worker-b.everstreet.testnet` and checks `operator_check` on
   `openseat.everstreet.testnet` before every drain. Without network or the key, promotions wait
   and the waitlist stays truthful. (OpenSeat itself is the business sold to Northline in gate 1,
   so it now runs under the buyer's worker at generation 2.)
3. **Bookings first for classes only.** Other kinds keep honest inquiry actions until their
   adapters exist (Astra's rule: never a buy button without fulfilment).
4. **Needs are anonymous and deliberate.** Private searches are never shown to founders; only
   requests someone posts, with an expiry and a replies on/off choice.
5. **Search is deterministic.** Words → editable constraints (kind, price limit, online,
   confirmed). No AI calls yet, so nothing is spent.
6. **Attribution is coarse and honest.** Own link, discovery, need, follow, or unknown; no
   tracking beyond the page's own link parameter.

## 2026-11-02 · Phase 3: real testnet payments

1. **Contract v2 (`contracts/business-v2`)** implements slices 1 and 5 of `docs/design/BUSINESS_V2.md`:
   one accepted NEP-141 token, paid orders held as customer money until delivered, refunds by the
   rules fixed at creation, prepaid credit, owner withdrawals limited by a reserve, monthly books on
   chain, async payouts that settle or return in their callback, and v1's sale with a token-funded
   hold and seller proceeds. Every unit held is in exactly one bucket, checked after each change.
   19 unit tests; a sandbox test with real token transfers (wrong token refused, duplicate order
   returned, refund, delivery, reserve, sale) checks the token balance against the books each step.
2. **Shared code by hash.** v2 is published once as a global contract by hash
   (`HdJDDpN28ms4XHVZxdSxAc6VF67zSA4kK1zXtwcphyBP`, about 27 test NEAR burned; the root was topped
   up from three faucet accounts, each deleted into it). Each business account uses that hash and
   is born with no keys, so its code can never change, and it costs about 0.3 NEAR to create.
3. **Test dollars** are `tusd.everstreet.testnet`, made from NEAR's standard FT shared code by hash,
   no keys, 6 decimals, supply held by the root as the faucet.
4. **People hold their own testnet accounts**, created on first payment with 0.2 NEAR for fees and
   $200 in test dollars. In the local preview their keys sit in the local database (gitignored),
   and every screen that shows the account says so. NEAR Auth replaces this before real users.
5. **Seat first, then payment.** OpenSeat holds the place; the customer pays with a unique order
   id; the outcome is read back from the contract. "Unknown" outcomes keep the seat and are
   reconciled or re-sent with the same id (the contract takes an order once). A payment that never
   left releases the seat.
6. **Cut for now:** paid waitlists (paid sessions show Full), payments for non-class businesses,
   subscriptions and usage metering (v2 slices 2–4), a relayer for sponsored fees.
