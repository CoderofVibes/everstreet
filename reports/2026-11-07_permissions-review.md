# Permissions review 2: Everstreet's own server and app, off-chain (November 7, 2026)

Cold review from the brief `reports/2026-11-07_permissions-review-brief.md`. Read: `server/src/**`,
`web/src/**`, the listed docs and the non-`.test.` helpers in `server/test/`. Tests live in
`server/test/permissions-review-2/` (a shared `world.ts` builds the sale world with the companions
and the intents verifier attached). Each test asserts the promised behaviour: a failing test is a
finding, a passing one a refused attack. Run one with
`npx vitest run server/test/permissions-review-2/<file>`.

Findings are appended in the order they were made.

## Findings

### 1. The solver fills a swap that no longer funds a sale (quote checked, sign not)

- **Severity**: High (promise 9: "only while the escrow is unfunded"; "nobody can make the solver
  pay for a swap that doesn't fund a real sale"). The solver's own tokens move for a swap the sale
  can't use. At the configured rate the swap is value-neutral for the solver, so no money is lost
  outright; the solver's float is spent and its gas burnt for nothing, on the buyer's say-so.
- **Role**: Buyer.
- **Steps**:
  1. Seller proposes, buyer registers. `POST /api/sales/:business/intents/quote {token}` as the
     buyer: 200, stage `quoted` (the quote checks `live_deal.buyer` and `escrow === "0"`).
  2. The buyer deposits the tALT and registers a key with the verifier.
  3. Before signing, the buyer funds the escrow with the ordinary fund request (or the seller
     cancels the deal). The contract now shows `escrow = price` (or no live deal).
  4. `POST /api/intents/:id/sign {public_key, signature}` within the two-minute quote.
- **What should happen**: 409; the solver signs nothing, the verifier spends nothing.
- **What happens**: 200, stage `funded` (case 1: the swap went through and the stage reads
  "funded" from the escrow the buyer funded another way) or `swapped` (case 2, deal cancelled).
  The solver's tUSD float dropped by the price; the buyer now holds the sale's price in tUSD
  bought from the solver, with no sale to fund.
- **Proof**: `pr01_intents_sign_after_escrow_funded.test.ts`, both cases **failing**; the control
  case (plain quote, deposit, sign) passes.
- **Location**: `server/src/intentsFunding.ts`, `IntentsFunding.sign` reads the row, the verifier's
  key and balance and runs `simulate_intents`, but never re-reads the business contract's
  `get_control` (`this.deal(b)`) to confirm the deal is still live, the buyer is still the buyer
  and the escrow is still `0`; only `quote` does.

### 2. Two open quotes for one sale: the solver fills both

- **Severity**: High (promise 9). A buyer can take as many fills from the solver as they can
  afford deposits for, while one deal is live; only the last can ever fund the sale.
- **Role**: Buyer.
- **Steps**: `POST .../intents/quote` twice (two rows, two nonces); deposit twice the amount;
  sign quote 1 (200, `swapped`); sign quote 2.
- **What should happen**: the second sign is refused (the newer quote supersedes the older, or a
  swapped funding for this deal already exists).
- **What happens**: 200, `swapped`; the solver's float is down by two prices; the buyer holds two
  prices of tUSD inside the verifier.
- **Proof**: `pr02_intents_double_fill.test.ts` "two open quotes for one sale don't both get
  filled", **failing**. (The concurrent double sign of ONE quote is refused by the verifier's
  nonce rule: passing; see "Tried and refused".)
- **Location**: `server/src/intentsFunding.ts`, `quote` inserts a new row without expiring the
  person's earlier open quotes for the deal; `sign` checks only its own row's state.

### 3. A former owner, or a buyer whose deal ended, keeps reading the business's economics and companions

- **Severity**: High (promise 1: the seller's reads stop at once, "including the companions'
  owner pages"; promise 4: a buyer reads only while the sharing is live). `/api/sales/:id/economics`
  shows Everstreet's own records of the business after the sale: settled uses, `uses_last_30_days`,
  earned revenue, supplier cost per use and margin, founder-entered costs. `/api/companions/:id`
  shows the allowance's grant, balance, awaiting invoices and recent supplier payments, and the
  external role's addresses and pending move. Both keep answering the seller after the close and
  the named buyer after the deal is cancelled, indefinitely.
- **Role**: Former owner; buyer after the deal ended.
- **Steps**: propose, register, fund, both accept (the close is applied here: `businesses.owner_id`
  is the buyer, `GET /api/businesses/:id` is 404 for the seller). Then as the seller
  `GET /api/sales/:id/economics` and `GET /api/companions/:id`. Or: propose, register, seller
  cancels; as the ex-buyer, the same two reads.
- **What should happen**: 404 (what the sale page itself does for a past participant: its
  `live_deal` and `customer_obligations` are withheld).
- **What happens**: 200 with the full economics (including uses settled under the new owner) and
  the full companion view (`you_own_it: false`, everything else present).
- **Proof**: `pr04_former_owner_after_close.test.ts` "the former owner no longer reads the
  business's economics or companions" and "a buyer whose deal was cancelled no longer reads
  economics or companions", both **failing**. The owner-route sweep in the same file (33 reads,
  16 writes) passes: every other owner route is 404 to the seller once the close is applied.
- **Location**: `server/src/app.ts` routes `/api/sales/:business/economics`,
  `/api/companions/:business`, `/api/sales/:business/intents` use `sales.proofContext`, whose
  `gate` (`server/src/saleActions.ts`, `SaleActions.gate`) admits anyone with a `sale_terms_docs`,
  `v3_intents` or `sale_actions` row for the business, past or present; neither route then narrows
  by `localOwner` or a live role the way `SaleActions.setup` does ("Permissions review, finding 2").

### 4. Between the close on chain and the next reconcile, the seller still runs the business here

- **Severity**: Medium (promise 8, weakened: the server acts on its own owner field while the
  contract already names the buyer). Documented in `docs/AUTHORITY.md` as observed-finality lag,
  and bounded by the demo's 15-second watcher, so Medium rather than High; but every owner route
  (edits, publish, invitations, offers, agent switches, the agent-purchases desk) accepts the seller
  during the window, and an invitation made then survives until the next generation check.
- **Role**: Former owner with an open session (the buyer accepted; the seller's own closing
  acceptance was sent from a wallet whose answer never reached Everstreet).
- **Steps**: propose, register, fund, buyer accepts (checked); seller accepts with the answer lost
  (no `check`). The contract shows owner `buyer.near`, generation 2. As the seller:
  `PATCH /api/businesses/:id`, `POST .../members`, `GET .../customer-offers`,
  `GET .../agent-purchases`.
- **What should happen**: 404 (the chain says the buyer owns it).
- **What happens**: 200 / 201 / 200 / 200. After `reconcileRecordedSales()` (the watcher) every one
  is 404.
- **Proof**: `pr05_owner_field_lags_the_chain.test.ts`, **failing** (the watcher part passes).
- **Location**: `server/src/store.ts` `ownedBusiness`/`controlEpoch`/`stillControls` read only
  `businesses.owner_id` and `ownership`; `server/src/v3intents.ts` `watchPass` is the only thing
  that moves them without a participant's check.

### 5. Any signed-in account learns which businesses have companions, by id

- **Severity**: Medium (promise 5/6: a leak of configuration and existence through another
  business's id; the same route answers `{asset:false, allowance:false}` for a missing id, so a
  `true` confirms both that the id exists and that it has a bound external asset or allowance).
- **Role**: Outsider (any signed-in account; signed out is 401).
- **Steps**: `GET /api/businesses/<someone else's id>/companions`.
- **What should happen**: 404, the same as for a missing id.
- **What happens**: 200 `{ "asset": true, "allowance": true }`.
- **Proof**: `pr06_companions_existence_and_queued_requests.test.ts` "a stranger learns nothing
  from /api/businesses/:id/companions", **failing**; `pr11_outsider_sweep.test.ts` "a missing id and
  someone else's id answer alike", **failing** on exactly this route.
- **Location**: `server/src/app.ts`, `app.get("/api/businesses/:id/companions")`: `me(c)` only, no
  `store.ownedBusiness` or `sales.proofContext`.

### 6. The intents stage is read from the solver's own answer, not the verifier: a swap the verifier never spent shows as "delivered"

- **Severity**: Medium (promise 8: "showing a swap as done that the verifier did not spend").
  Not reachable by a buyer alone: it needs the solver's RPC to answer success for a transaction
  the verifier didn't execute (a misreporting or substituted endpoint, a dropped or reorganised
  transaction). But when that happens the buyer's panel says the tUSD was delivered to them.
- **Role**: Buyer, with a solver whose `execute` resolves without the verifier having moved
  anything (in the test, a `SolverPort` returning a hash and touching nothing).
- **Steps**: quote, deposit, register key, sign. `execute` "succeeds". `GET /api/intents/:id`.
- **What should happen**: the stage comes from the verifier's record: `is_nonce_used` is false and
  the deposit is still inside, so `deposited` (or `unknown`), never a done stage.
- **What happens**: `stage: "delivered"`, `give.inside` still the whole deposit, `get.inside` 0,
  `exec_hash` the fabricated hash. Two causes: `sign` stores `state = "swapped"` from the
  solver's response, and `status` only ever promotes to `swapped` on `is_nonce_used` (never
  demotes); then "delivered" is inferred from `own >= get_amount`, the buyer's TOTAL tUSD balance
  (Noah holds 1,000 tUSD of his own), not from a withdrawal of the swapped amount.
- **Proof**: `pr16_swap_shown_done_without_verifier.test.ts`, **failing**.
- **Location**: `server/src/intentsFunding.ts`, `IntentsFunding.sign` (`this.set(id, { state:
  "swapped", exec_hash })` on the response) and `IntentsFunding.status` (the `swapped`/`delivered`
  branch; `used` is consulted only to promote).

### 7. Routes behind an unconnected service answer 409 before checking sign-in

- **Severity**: Low (promise 6, weakened: a signed-out probe of `/api/businesses/<id>/money`,
  `/sessions`, `/team`, `/deals/snapshot`, `/api/helping/<id>`, `/api/deals/<id>`,
  `/api/payments/<id>`, `/api/wallet`, `/api/public/sessions/<id>/pay` and the matching POSTs learns
  "Payments are not connected in this environment" / "Deals need payments on NEAR" instead of 401.
  No record is read; it tells an outsider how the server is composed. `/api/deals` was fixed
  earlier ("Permissions review, finding 4"); the others weren't.)
- **Role**: Outsider, signed out.
- **Steps**: any of the routes above without a cookie.
- **What should happen**: 401.
- **What happens**: 409 with the environment message.
- **Proof**: `pr15_public_and_unconnected_routes.test.ts` "sign-in is checked before the
  environment's connections", **failing**; also the 409 lines of `pr11_outsider_sweep.test.ts`.
- **Location**: `server/src/app.ts`, `needBookings()`, `needPayments()`, `needDeals()` are called
  before `me(c)` in those handlers.

### 8. Sign-in refusals say which check failed, and whether an account is already someone's here

- **Severity**: Low (promise 7 holds: every forged, replayed, cross-browser or unproven sign-in is
  refused, see `pr13_sign_in.test.ts`, all passing). The 401 carries a `code` naming the failed
  step (`sign_in_binding`, `sign_in_challenge`, `sign_in_signature`, `sign_in_key`), and a wallet
  that proves a full-access key for an account already linked to another person's records
  (`chain_accounts`, e.g. a preview-linked customer) gets 409 `account_linked`: the refusal is
  right, but it confirms to the key holder that the account has records here.
- **Role**: Outsider with a wallet.
- **Steps**: `POST /api/session/challenge`, then `POST /api/session/verify` with a valid signature
  for an account linked to another person.
- **What should happen**: a fixed 401.
- **What happens**: 409 "That account is already linked here".
- **Proof**: `pr13_sign_in.test.ts` "an account already linked to another person here can't be
  claimed by signing in" (passing: refused; the status and message are the note).
- **Location**: `server/src/identity.ts` `AccountSignIn.verify` (`deny(code)`),
  `server/src/store.ts` `personForAccount`.

### 9. Notes (worth knowing, no promise broken)

- **The buyer-team choice is remembered per browser, not per account.** `web/src/api5.ts` keeps
  `es.buyer` in `localStorage` without the person or account in the key; after signing in as
  another account in the same browser the client asks for the previous person's buying team and
  the server answers 403/404 (`Acquisitions.role`). Harmless, but it is a cache keyed without the
  account, and it is the only one: device keys are per (network, contract, plan, account) in
  IndexedDB, studio drafts per person and owner epoch, sale drafts in `sessionStorage`.
- **Person ids are public identifiers.** `/api/public/discover` and `/api/public/businesses/:slug`
  return the founder's `person.id` (a UUID) beside the display name; `/api/public/people/:id` serves
  it. Nothing treats a person id as a secret (every private route resolves the person from the
  cookie), and `POST /api/session/as/:id` exists only with `localPreview`, which the composed and
  demo applications don't set. Fine as long as that stays true.
- **The public docket and the recorded proof show nothing private.** `/api/public/attacks` is the
  committed `data/evidence/attack-suite.json`: fictional accounts (`founder.near`, `buyer.near`,
  `solver.synthetic.near`), a commit hash and testnet explorer links; `/api/examples/ledgerline`
  is an allowlisted projection of a committed testnet run: testnet accounts, the contract's
  account and code hash, transaction hashes, counts and figures. All of it is public chain data or
  committed to the repository. Checked against the running demo on 127.0.0.1:8820 (read only).
- **The former owner's sale page.** `GET /api/sales/:id` deliberately keeps answering a former
  seller (their outcomes, claims and payouts), with the live deal, customer obligations and
  current roles withheld (`SaleActions.setup`, "finding 2" of the earlier review). This is right;
  findings 3 and 5 are the two sibling routes that didn't get the same treatment.
- **Client gating mirrors a missing server check.** `web/src/pages/AllowanceDesk.tsx` hides the
  approve and re-grant buttons behind `you_own_it`, but the data under them comes from
  `/api/companions/:id`, which any past participant can still read (finding 3).
- **Released web apps and passes.** `/a/:app/*` and `/p/:token/*` are served on the preview origin
  (`compose.ts`: `appOrigin = origins.preview`) under a CSP `sandbox allow-scripts` with
  `connect-src 'none'`, so an app can't call the platform API with the customer's cookie; pass
  tokens are stored hashed and shown only in the customer's own result.

## Tried and refused

One line per attack the server stopped, with the function that stops it (test in brackets).

- Concurrent double sign of one intents quote: the second `execute_intents` is refused by the
  verifier's spent-nonce rule; the row heals to `swapped` from `is_nonce_used` (`VerifierDouble.run`
  nonce check; `IntentsFunding.status`) [pr02].
- Quote by a stranger or a customer: 404 (`SaleActions.gate`); by the seller: 403 `not_buyer`
  (`IntentsFunding.quote`); an unoffered token: 400 [pr03].
- Reading or signing another person's funding id: 404 (`IntentsFunding.row`, person-scoped) [pr03].
- Signature by a key not registered with the verifier: 409 `key_not_registered`; over another
  message: 400 `bad_signature` (`IntentsFunding.sign`, `verifyNep413`) [pr03].
- The solver's key in any response: never; only `account` and `source` are serialized
  (`IntentsFunding.status`/`offers`; `solverKeyFrom` reads the file and returns an `OperatorKey`)
  [pr03].
- Every owner read (33) and write (16) by the seller once the close is applied: 404
  (`Store.ownedBusiness`, `controlEpoch`, `stillControls`; `Members.staff`; `V3Observations`;
  `Releases`/`ManagedRuntime.project`) [pr04].
- A former owner preparing a companion request: 409 `not_owner` against the contract's owner
  (`Companions.prepare`) [pr04].
- A companion request prepared before the close and sent after: the companion contract refuses
  `E_NOT_OWNER`; the row goes `refused` (`Companions.sent`, `AllowanceDouble.ownerCall`) [pr06].
- Acting on the new owner's companion request id, or sending its call from the wrong wallet:
  404 (`Companions.action`) / 409 `not_this_request` (`Companions.sent` signer check) [pr06].
- Team: an invitee reads nothing before accepting; another person can't accept the invitation
  (`Members.respond` `addressedTo`); a viewer can't move a case: 403 `member_role`
  (`Members.staff`); a member is not an owner (every owner route 404); revoke ends access at once;
  the seller's members and pending invitations end with the sale (`Members.active` owner
  generation; `respond` 409 `control_changed`) [pr07].
- A customer's request, result, case, key, purchase and grant against another customer, the owner
  and a stranger: 404 (`CustomerUses.own`, `WorkflowCases.forCustomer`, `CustomerPurchases.own`,
  `AgentAccess.revoke`); device keys and purchase pictures are read for the caller's own account
  (`accountOf(viewer.id)`) [pr08].
- 402: the purchase is confirmed only by the agent's own account's transaction
  (`resolveFromTx`: `signer_id === customer_account`); another customer naming that hash gets
  `matched: false`, nothing credited; the owner's desk shows each 402 on its own account; the
  agent is never the owner (`PaymentOffers.forOwner` → `ownedBusiness`) [pr09].
- Agent access: off by default (`AgentAccess.requireAgentsAllowed`); a customer can't flip the
  owner's switch (`setSwitch` → `controlEpoch`); a bad bearer 401; a grant's uses are counted
  (`agent_used_up`); a retry of the same key returns the same use; another customer's agent gets
  404 on the use (`ownUse`); a revoked grant 403 at once (`authorize`); the owner's switch off
  refuses new preparations; a bearer token opens no cookie route [pr10].
- Outsiders against every private GET (52) and POST (33) with real ids: 401 signed out and 404 as a
  stranger, except finding 5 and the 409s of finding 7 [pr11].
- RPC allowlist: 29 disallowed methods/argument shapes refused `unsupported` before any request;
  allowed calls send exactly the normalized arguments at the pinned block; mainnet and
  credentialed endpoints refused at configuration; the observation transport knows five views; the
  key reader one documented query (`TestnetCustomerRpcTransport.checkedArgs`, `validateRpcConfig`,
  `TestnetAccessKeyReader.isFullAccessKey`) [pr12].
- Sign-in: replayed proof 401 (`Store.consumeChallenge`); another browser's binding 401 without
  spending the challenge; a thief's own key for Ava's account 401 `sign_in_key`
  (`AccessKeyReader`); wrong recipient or callback 401 (`verifyNep413`, issued variants only); a
  name-only session 403; preview session rows are nobody in verified mode (`Store.personForToken`
  mode column); expiry by the server clock; signing in as another account replaces the session;
  sign-out ends it on the server [pr13].
- Evidence room: pending 403; granted shows only the granted kinds; another team's member and the
  seller get nothing from the request id; the buyer can't widen the grant (`sellerOf`); expiry and
  revoke close it, with no private field in the refusal; the sale closes it (`grantFor` stamp
  includes the owner) [pr14].
- Unpublished business: page, offers, product and agent description 404 and absent from discover
  (`Store.publicBusiness`, `CustomerUses.publicOffer(s)`) [pr15].
- Proof, economics, intents, companions and operator routes: 401 signed out, `Cache-Control:
  no-store` on every API answer [pr15].
- A 402 asked for with a malformed `install`: the purchase preview is served without it or refused
  (`parseInstall` on the purchase route; the 402 path tolerates it) [pr15].
- Helpers (v2): never-a-helper 404; a helper is not the owner; a contract-only revoke shows
  `denied` with nothing private and refuses replies; the owner's revoke shows `ended` with the
  business's name only; the sale ends every helper (`Payments.helperDesk`, `capabilityNow`,
  `helperReply`; the v2 reconciler revokes `team`) [pr17].
- A seller's `appoint` reviewed before the close and sent after: the contract refuses; the check
  records `refused`/`no_longer_possible` (`SaleActions.check`, `stillPossible`) [pr18].
- Session cookies: `HttpOnly`, `SameSite=Lax`, the sign-in binding scoped to `/api/session`
  (`app.ts` `startSession`, `/api/session/challenge`) [pr18].

## Summary

Counts: **Critical 0 · High 3 · Medium 3 · Low 2 · Note 1 (five notes)**.

- High: 1 (the solver fills after the escrow was funded or the deal ended), 2 (two open quotes,
  two fills), 3 (a former owner or ended buyer keeps reading economics and companions).
- Medium: 4 (owner field lags the chain until the watcher), 5 (companions configuration readable
  by id), 6 (the swapped/delivered stage trusts the solver's answer and the buyer's total balance).
- Low: 7 (409 before sign-in on unconnected routes), 8 (sign-in refusal codes and `account_linked`).

Tests: 18 files, 47 tests; 11 failing tests prove findings 1 to 7; 36 passing tests are the
refused attacks above.

**The one change I would make first**: in `IntentsFunding.sign`, re-read the business contract
before signing the solver's side and refuse unless the deal is still live, its buyer is still this
person's account, its escrow is still `0`, and no other funding row for this deal is `swapping` or
`swapped` (and have `quote` expire the person's earlier open quotes for the same deal). That one
check closes findings 1 and 2, the only ones where someone else's tokens move. Second: give
`/api/sales/:business/economics` and `/api/companions/:business` the same current-participant
narrowing `SaleActions.setup` already has (finding 3), and put `store.ownedBusiness` on
`/api/businesses/:id/companions` (finding 5).

