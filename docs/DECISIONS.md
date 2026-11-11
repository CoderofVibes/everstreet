# Decision log
## 2026-11-04 · Continuous development approved

Tony: "Sounds great, do it!" approving continuous work with the same checkpoint verifications.
The continuous Goal is active and the 45-minute continuation automation is paused. Work proceeds
between bounded jobs without a timer: one Claude writer, independent review, concrete corrections,
local commits and durable checkpoints. Capacity/reset and resource limits remain in force; no
new spending or external-release authority. All six milestones and the approved UI direction stay
in scope. Do not restart the timer alongside an active writer. The full creative walkthrough remains
after buildout; ordinary implementation/design decisions do not require repeated approval.

## 2026-11-04 · Everstreet UI direction approved; implementation resumed

Tony: "Can you remember all of this and start to implement it please? I like everything you just
listed out" after Astra proposed the UI replan. The earlier design hold is lifted.
[Accepted direction](design/EVERSTREET_UI_DIRECTION.md) is the durable visual/interaction authority:
premium creative workspace and living marketplace; luminous mineral/paper, blue-black type,
cobalt/warm accents, selective glass, contextual AI canvas, precise data and meaningful motion.
Discover, Studio, Operate, Acquire and customer use have distinct compositions in one system.
Stable navigation and human control take precedence over automatic rearrangement. Astra leads
internal concept/interaction/visual review; Claude builds bounded slices. No new routine approval
needed. All six milestones and central NEAR/customer continuity remain. No external release,
spending or research assessment authorized. This supersedes older dark-rail/mint visual guidance.


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

## 2026-11-02 · Phase 4: books, value, helpers

1. **Books read the chain first.** For months since a business turned payments on, revenue is the
   contract's own monthly books (`get_period`), earned at delivery, labelled "Verified on NEAR ·
   testnet". Costs are founder-entered (once or recurring) because no contract can see rent or
   ink. The examples' earlier months are stored as seeded rows and labelled "Seeded history ·
   fictional" everywhere they appear (`scripts/lib/history.ts`, `npm run seed:history`).
2. **Valuation is a scenario model, not a price.** `scenario-v1` (`server/src/value.ts`): complete
   months only; operating profit minus the founder's replacement work (hours × rate), annualized,
   times per-kind illustrative multiples, rounded to $100. Plan-stage businesses get "what this
   could become" from planned customers. Every input carries its source; missing inputs are listed;
   a snapshot is kept whenever the inputs change, so "what changed" is exact. Astra's worked
   example (Paperfin, $156,000–$234,000) is a test.
3. **Sharing is opt-in.** Public pages show numbers only when the founder ticks "Share my numbers";
   nothing infers that a business is for sale. What-ifs are private.
4. **Helpers are contract operators.** Appointing a helper calls `appoint_operator` with
   `support` and `fulfillment`; revoking calls `revoke_operator`. A helper delivers with their own
   account and key. Verified on testnet with Juniper: Theo was appointed, delivered a paid order,
   was revoked, and his direct `deliver` call then failed on chain with `E_NOT_AUTHORIZED`
   (tx `FRJ8jY3VTPKEbjY8bRAfhZ6TfvgRQ7aYEWiyRnPrwWAM`). Replies to customers are off-chain but
   gated on the live `operator_check` for `support`.
5. **Cut for now:** researched market multiples, accrual adjustments beyond earned-at-delivery,
   helper refunds, the acquisition marketplace (phase 5).

## 2026-11-02 · Phase 5: the acquisition marketplace

1. **A separate index.** Listings live in their own tables and routes (`server/src/acquire.ts`);
   customer search and public pages never read them. Sharing numbers publicly does not list a
   business. Tests check the public page and customer search carry no sale wording.
2. **Four discovery modes** from Astra's table: closed, private introductions (invited buying
   teams only), anonymous teaser, named profile. Anonymous teasers show and filter only by
   coarse bands (revenue, estimate, asking price, owner hours), so exact values can't be found by
   narrowing filters. Undisclosed fields read "Not shared" and no filter reaches them.
3. **Unknowns stay visible.** Only the estimate filter excludes businesses without an estimate,
   and it says how many with a one-click "Include them". Other unknowns stay in results, labelled.
   Estimate filtering is "overlaps" by default or "within"; asking price is a separate filter.
4. **Buying profiles are teams.** Kinds: owner-operator, strategic business, small investment
   firm, cooperative. Roles: research (search, shortlist, compare), evidence (also open rooms),
   approve (also request access). Being on a team is not authority to accept a sale.
5. **Grants are narrow and time-boxed.** A request names categories, purpose and days (1–30). The
   seller can grant fewer categories or days, never more. Every room read rechecks role, status
   and expiry; revoked and expired access returns 403 through the API, not just the UI. Exports
   say that ending access can't recall a downloaded copy. Room opens are logged for the seller.
6. **The room reuses the founder's numbers.** Same books and `scenario-v1` estimate; a buyer can
   reproduce the range from the rows and save team assumptions without changing the founder's.
   The "what a sale would cover" list is preliminary and marks the owner role Blocked when a
   business has no contract yet (Paperfin: payments are only built for classes so far).
7. **Example data** (`scripts/lib/buyers.ts`): Northline Studio Tools (Owen Hart, with Sam as
   research) with a saved brief; Alder Lane Makers Co-op (Ana, with Theo as evidence); Paperfin
   named at $195,000; Small Hours Candles as an anonymous teaser.
8. **Cut for now:** outbound alerts, advanced natural-language briefs, adviser integrations,
   pooled group funding, payment-aware ownership for non-class businesses, and accepting a deal
   (phase 6).

## 2026-11-02 · Phase 6: two people accept a deal and keep serving customers

1. **The contract decides; Everstreet follows.** Deals (`server/src/deals.ts`) use v2's
   `propose_sale`, `revise_sale`, `fund_deal`, `accept_sale`, `cancel_sale`,
   `withdraw_deal_hold` and `claim_proceeds`. After every step Everstreet reads the deal and the
   owner back from the contract. Only when `get_control` shows the buyer as owner does it move
   the business, page and records to the buyer, end old helpers (the contract already voided
   them), revoke evidence grants, close the listing, void competing deals and reset the seller's
   own work and sharing settings. The seller's private what-ifs stay hidden from the new owner.
2. **Exact terms, fingerprinted.** Terms are frozen JSON: parties and accounts, price, expiry,
   control received, what stays, separate transfer items, exclusions, handover, conditions and
   an evidence snapshot. Their sha256 is the contract's `terms_hash`; the contract's digest is
   what both accept. A revision clears both acceptances and the UI lists what changed. A stale
   acceptance is refused by the contract (`E_TERMS`).
3. **One accepting account per buying team.** The team lead's account funds and accepts; other
   members can read the deal. For a co-op this is its representative; group-controlled
   ownership on NEAR is not built and the deal page says so.
4. **Proposals go to teams that asked for access**, one open deal per team; competing deals are
   voided at close and their holds can be withdrawn.
5. **Proof, not a film.** The former owner can send a real `withdraw_profit` from their own key
   and see the contract's `E_NOT_OWNER`; payouts are confirmed by reading `proceeds_of`, and a
   failed one stays visible with a retry.
6. **Test dollars on demand.** The buyer's accepting account can ask the faucet for exactly the
   shortfall for the deal's price (test dollars only).
7. **Verified on testnet** with `npm run smoke:sale` (fresh fictional accounts, separate
   databases): 23 steps, all with transaction links, in `data/evidence/sale-testnet.json`; and
   the same flow clicked through the UI on a second fresh business. Your local Juniper is not
   sold; that is left for Tony to try.
8. **Not in the deployed contract** (it can't change): v2's design called for a public notice
   period before a close and retained operators in the terms. The product shows neither as
   enforced; the buyer appoints their own team in the first shift. Cut for now: financing,
   earn-outs, fractional interests, automated provider transfers, group ownership.

## 2026-11-02 · Tony authorizes the AI-economy platform buildout

Tony clarified that digital builders are the primary audience: AI tools, SaaS, APIs, agents,
websites, NEAR solutions and online services. Both creating with AI inside Everstreet and
bringing an existing product are wanted. Seamless acquisition and operational transfer on
NEAR stays central. The earlier local/craft examples are regression fixtures, not the new
flagship direction.

Tony authorized Astra to drive development with Claude as builder across the six proposed
milestones and additional functions, using Claude Code usage and API credit. Astra may build
within its repo role when Claude usage is exhausted. The first complete creative walkthrough
comes after buildout; seven to ten days is a planning horizon, not a completion guarantee.
Public release, pushing, mainnet, new service spending and billing changes remain unapproved.

See `docs/design/PLATFORM_VISION.md`, `docs/astra/2026-11-02_BuildMandate.md`, and the job queue.

## 2026-11-11 · The hosted copy is a guided tour, then the proof

Tony (Nov 11): the hosted proof site opened on a page that didn't say how to move through it. He
asked for a guide in a limited number of steps: a high-level view of what Everstreet is and what
people do there (builders, investors, customers on the main page; the build workshop; the
portfolio), then the handoff proof, the sale, what we tried to break, and agents.

1. **Seven steps, docked under the app's own pages.** Everstreet's front page, the product
   studio, the portfolio, the handoff proof, the recorded sale, the attack docket, the agent
   desk. The guide carries the explaining, so the product pages are unchanged. Each step says
   where its data comes from: the recorded demo (simulated history), NEAR testnet, or a recorded
   test run.
2. **The app pages are a replay of the demo, not screenshots.** A local proxy
   (`scripts/record-tour.ts`) kept every read the demo's pages made while they were walked, per
   viewer, with the routes walked (`data/tour/recording.json`, committed). The static site answers
   those reads with those bodies, refuses every write, and blocks links to routes nobody walked.
   The proof pages still read the committed testnet evidence.
3. **Three viewers.** Delphine Marsh (founder) for the main line; Cara Okafor (customer) and Noah
   Brandt (buyer) as side doors from step 1, so the three audiences are one click away without
   adding steps.
4. **Flagged:** the recording is of one demo run on Nov 11, so its dates are that day's. Re-record
   after any change to what those pages read (the steps are at the top of the script), and on the
   release commit if the pages changed.
