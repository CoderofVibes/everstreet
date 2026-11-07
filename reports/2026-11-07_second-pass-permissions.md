# Second cold pass, permissions (November 7, 2026, evening)

Reviewer: Claude (Fable 5.1), a cold pass under `reports/2026-11-07_second-pass-permissions-brief.md`.
Read only what the brief allows. Tests are in `server/test/permissions-review-3/` (20 files, 35
tests; `world.ts` is the shared world: the sale world with the intents verifier, the second token,
the solver and the two companions attached, the app remade with their bindings). Each test asserts
the promised behaviour: a **failing** test proves the finding; a passing one records a refusal.

Run one with `npx vitest run server/test/permissions-review-3/<file>`; the folder at once with
`npx vitest run server/test/permissions-review-3/`. Final tally: 14 failing, 21 passing.

Severity as the brief defines it: Critical is another person's money or control, or key material;
High a promise broken in a reachable way; Medium a promise weakened or a leak of existence or
metadata; Low hardening.

---

## 1. The solver fills one deal twice when two quotes are signed at the same moment

**Severity:** High (promise 1: the solver fills at most once per deal).
**Role:** the buyer, alone.

**Steps.** Propose a deal to the buyer. The buyer takes two quotes for it (A and B, both `quoted`),
deposits twice the quoted tALT into the verifier, registers one signing key, and posts
`/api/intents/A/sign` and `/api/intents/B/sign` in the same instant (two tabs, or `Promise.all`).

**Should.** One fill, one `409 already_filled`; the solver's tUSD float moves by exactly one price.

**Happens.** Both answer `200 swapped`. The solver's float moved by two prices (500 tUSD for 625
tALT); the buyer holds 500 tUSD inside the verifier for a 250 tUSD sale.

**Why.** `IntentsFunding.sign` decides "no other fill for this deal" with one SQL read
(`state = 'swapped' OR (state IN ('swapping','unknown') AND deadline_ms > now)`) and only writes its
own claim (`state = 'swapping'`) after four awaited chain reads (`has_public_key`, `mt_balance_of`,
the solver side's `current_salt`, `simulate_intents`). Two requests both pass the read before either
writes. The once-per-deal rule is server memory, checked before an await and not repeated after.

**Proof.** `pr01_two_quotes_signed_at_once.test.ts`, failing (`expected 2 to be 1`).
**Location.** `server/src/intentsFunding.ts` lines 368-380 (the `other` query) and 427 (`swapping`).

---

## 2. The solver fills one deal twice after a lost answer whose quote expired

**Severity:** High (promise 1, the same rule by another door).
**Role:** the buyer, with ordinary network luck (the Nov 6 testnet run in `docs/INTENTS.md` is this
shape: the fill landed, the answer came late, the app stored `unknown`).

**Steps.** Quote A; deposit for two; register the key; sign A. The solver's `execute` lands but its
answer is lost, and the verifier's spent-nonce record isn't readable yet (the transaction isn't
final), so A is stored `unknown`. Nobody reads A again. Wait past A's two-minute deadline. Quote B;
sign B.

**Should.** `409 already_filled`: the verifier spent A's nonce, so this deal was filled.

**Happens.** `200 swapped`: a second fill. 500 tUSD inside for the buyer.

**Why.** The `other` query ignores an `unknown` row once its deadline has passed, and nothing in
`sign` asks the verifier about the deal's *other* quotes. `status()` would have repaired A to
`swapped` on any later read, but only the newest funding is read by the panel (`latest`), so A is
never read again. The fill decision rests on the server's memory of its own answers, not on the
chain's record (promise 2's principle applied to promise 1).

**Proof.** `pr02_lost_response_then_new_quote_after_expiry.test.ts`, failing (`expected 200 to be 409`).
**Location.** `server/src/intentsFunding.ts` lines 368-372; the repair is only in `status()` 474-478.

**Fix for 1 and 2 together.** Claim the deal before the first await (a row per `(business_id,
deal_seq)` in state `swapping`, written in the same synchronous step as the check, or a unique
partial index), and before `execute`, read `is_nonce_used` for every other quote of this deal
whatever its stored state or deadline.

---

## 3. "Delivered" is shown while the price is still inside the verifier

**Severity:** Medium (promise 2: never tUSD shown as delivered that did not leave the verifier).
**Role:** the buyer (or anyone reading the buyer's stage: the demo audience).

**Steps.** After the swap, the buyer withdraws **one base unit** (0.000001 tUSD) of the 250 tUSD from
the verifier. Read `/api/intents/:id`.

**Should.** `swapped` (249.999999 tUSD is still inside; `get.inside` says so in the same answer).

**Happens.** `delivered`. The panel's "Withdraw" step is ticked and the step list moves on to
"Fund escrow".

**Why.** `status()` says delivered when `inside_get < get_amount`, i.e. when *any* amount below the
price is left inside. The comment admits the rule ("once less than the swapped amount is left inside,
the buyer withdrew it"). With 1 unit withdrawn the server contradicts its own `get.inside` field.

**Proof.** `pr04_withdraw_part_shows_delivered.test.ts`, failing (`expected 'delivered' to be 'swapped'`).
**Location.** `server/src/intentsFunding.ts` line 492; `web/src/pages/IntentsFunding.tsx` lines 334-337.
**Fix.** Record the buyer's tUSD inside the verifier at the moment the swap is seen (`inside_get_at_swap`)
and say delivered when `inside_get <= inside_get_at_swap - get_amount`; or require `inside_get === 0`
for this token when the buyer had none before the swap.

---

## 4. An ended buyer learns whether the business has a live deal with someone else

**Severity:** Medium (promise 3: a buyer whose deal ended reads nothing current, not the live deal).
**Role:** ended buyer (Noah, after the seller cancelled).

**Steps.** Noah's deal is cancelled. The sale page correctly shows him `control.live_deal: null`.
Noah posts `/api/sales/:business/intents/quote` (any token). Then the seller proposes a new deal to
Sam. Noah posts the same quote again. Likewise `POST /api/sales/:business/prepare {kind: "fund"}`.

**Should.** The same answer both times (he is no longer a participant of anything live).

**Happens.** Quote: `409 no_deal` while there is none, `403 not_buyer` once a deal with Sam exists.
Prepare fund: `409 no_live_deal` then `409 not_buyer`. The same holds for `cancel`, `expire`,
`accept`, `unfund` previews (`needDeal()` runs before the role check). What the sale page hides,
the quote and prepare routes announce.

**Proof.** `pr07_ended_buyer_quote_reveals_live_deal.test.ts`, both tests failing.
**Location.** `server/src/intentsFunding.ts` lines 271-272 (deal read, then buyer check);
`server/src/saleActions.ts` `previewFrom`, `needDeal()` before each kind's role check (about line
1570 onwards). Route: `app.ts` 773-787 uses `proofContext` (participant gate), not `currentContext`.
**Fix.** Put the quote and sign routes behind `currentContext` (which already answers a past
participant 404), and in `previewFrom` check the viewer's role before touching the live deal.

---

## 5. The former owner reads economics and companions after the close until the record follows

**Severity:** Medium (promise 3; promise 7 allows the window for *running* the business, promise 3
does not for *reading* it, and the fix costs one read the route already makes for everyone else).
**Role:** former owner, session from before the close.

**Steps.** Seller accepts through Everstreet (recorded); buyer funds and accepts; the buyer's
acceptance closes the sale on the contract but its answer is lost (no check runs). The contract says
owner `buyer.near`, generation 2. Before a watcher pass the seller reads `/api/sales/:b/economics`,
`/api/companions/:b`, `/api/businesses/:b/companions` and the sale page.

**Should.** 404, 404, 404; `customer_obligations: null`.

**Happens.** 200, 200, 200; customer totals shown. After one watcher pass all are 404 (so the
window is one pass, 15 seconds in production, longer whenever the watcher isn't running).

**Why.** `currentContext` returns early for `localOwner` *without* the `get_control` read it makes
for the buyer: "current" is `businesses.owner_id` OR the chain, when for the owner it should be AND.
`/api/businesses/:id/companions` uses `ownedBusiness` only.

**Proof.** `pr08_former_owner_before_watcher_pass.test.ts`, failing (`economics … expected 200 to be 404`).
**Location.** `server/src/saleActions.ts` 897-899 (`if (g.localOwner) return g;`); `app.ts` 713-717.
**Fix.** Always read `get_control`; a local owner is current only when `control.owner === g.account`.

---

## 6. A seller who revises and closes with their own wallet keeps Everstreet's record of ownership

**Severity:** High, bordering Critical: the buyer paid the price and owns the business on the
contract, yet the seller keeps every Everstreet surface of it (desk, team, agent switches,
companions, economics) with no way for the buyer to take it.
**Role:** the seller (deliberately), using the exact call Everstreet's own preview shows.

**Steps.** Seller proposes through Everstreet (version 1 is recorded). Seller asks
`/api/sales/:b/prepare {kind: "revise", …}` for the preview (nothing stored) and sends `preview.call`
with their wallet directly: version 2 exists on the contract and is recorded nowhere here. The buyer
funds and accepts version 2 through Everstreet (works: the preview reads the live deal from the
chain). The seller accepts version 2 with their wallet. The contract closes: owner `buyer.near`,
generation 2. Three watcher passes; the buyer reads their sale page (`roles.new_owner: true`).

**Should.** `businesses.owner_id` follows: the seller's companion list, economics, companions and
team answer 404; the buyer's sale page says `local_owner: true`.

**Happens.** The seller keeps all of them (200); the buyer's page says `local_owner: false`,
forever. The recorded version-1 intent resolves `superseded` (`revised_then_closed`) and is never
applied; `V3Intents.record` is seller-only; the buyer's own `check` reconciles only when *their*
acceptance's result was `closed`.

The same with the seller proposing **and** closing by wallet after proposing through Everstreet is
**refused**: the proposal's `effects` recorded version 1 and the watcher applied the close
(`pr09_seller_accepts_with_wallet_record_never_follows.test.ts`, passing). The gap is any version
the seller introduces outside Everstreet.

**Proof.** `pr09b_seller_revises_with_wallet_then_closes.test.ts`, failing (`the former owner's
companion list: expected 200 to be 404`).
**Location.** `server/src/v3intents.ts` `decide` (superseded on `o.version > r.version`), `record`
line 224 (seller only); `server/src/saleActions.ts` `effects` (`res.result === "closed"` only).
**Fix.** Let the buyer's side apply a close the contract shows: when a closed outcome names the
viewer's account as buyer and the business's local owner as the seller named in that outcome (and a
terms document or intent for that `deal_seq` names both), record that version from the outcome and
apply it; or let the watcher treat a closed outcome for a recorded `deal_seq` with matching seller,
buyer and seq as applicable after re-checking the mapping (the price and digest come from the outcome).

---

## 7. A past participant learns which businesses have companions and intents funding

**Severity:** Medium (promise 4: the owner's to know; promise 3: nothing current).
**Role:** ended buyer (passes the sale gate for life through the terms document).

**Steps.** Noah's deal is cancelled. Noah posts `/api/companions/:b/prepare {kind: "feed_move"}` to a
business with companions and to one without. Noah reads `/api/sales/:b/intents` for a business with
intents funding and one without.

**Should.** The same answer for both businesses in each pair (the current readings already are: 404).

**Happens.** Prepare: `409 not_owner` with companions, `404 no_companions` without. Panel: `200`
with the verifier, the token, the offers' rates and the solver's account, `404 no_intents` without.

**Why.** `companions.prepare` checks the binding before the owner; the route sits behind
`proofContext` (any past participant) rather than `currentContext`. The intents panel route is behind
`proofContext` too; it returns configuration to anyone who was ever part of a sale here.

**Proof.** `pr10_past_participant_probes_companions.test.ts`, both tests failing.
**Location.** `server/src/companions.ts` 285-288; `server/src/app.ts` 733-736 and 763-772.
**Fix.** Both routes behind `currentContext` (and the panel for the live deal's buyer only); in
`prepare` check the owner before the binding.

---

## 8. A key holder for an account linked to another person gets a different refusal

**Severity:** Medium (promise 5: every refusal is the same 401; a leak that the account has records here).
**Role:** a wallet holding a full-access key for `stranger.near`, which is Sam's chain account here
through a fixture link (customer-use linking), never a sign-in.

**Steps.** Verified identity. Challenge, sign it correctly, verify as `stranger.near`. Compare with a
verify whose signature doesn't check.

**Should.** Identical 401 bodies.

**Happens.** `{"error":"That sign-in was refused","code":"sign_in_refused"}` versus
`{"error":"That sign-in couldn't be verified; start again","code":"sign_in_signature"}`. The status
is the same; the body tells the key holder the account is already bound to someone here. (The
review-2 fix made the *status* the same; the message and code still differ. The other `deny()` codes
also differ from one another, `sign_in_invalid`, `sign_in_binding`, `sign_in_challenge`,
`sign_in_recipient`, `sign_in_signature`, `sign_in_key`, `sign_in_cancelled`; those name the
caller's own mistake and not another person, so they are a note.)

**Proof.** `pr11_sign_in_linked_account_same_refusal.test.ts`, first test failing (deep-equal of the
two bodies). The second test (a key the chain doesn't list as full-access, a replayed challenge, a
preview session in verified mode) passes.
**Location.** `server/src/store.ts` `personForAccount` line 325; `server/src/identity.ts` `deny`.
**Fix.** Throw the identical message and code (`sign_in_key`, say), or return null from
`personForAccount` and let `verify` deny.

---

## 9. A stale quote fills after the seller revised the deal

**Severity:** Low (promise 1 names the deal, the buyer and the escrow; the version isn't in it, but
the quote no longer funds this sale's price).
**Role:** the buyer.

**Steps.** Quote at version 1 (price 250). The seller revises to version 2 (price 100). The buyer
signs the version-1 quote.

**Should.** Refused: the quote's version and price aren't the live deal's.

**Happens.** `200 swapped`: 250 tUSD for 312.5 tALT at the quoted rate. The buyer then funds 100 and
keeps 150 tUSD; `funded` can never be reached for that row (`escrow !== get_amount`). No money is
lost by anyone, but the fill isn't for the deal's terms.

**Proof.** `pr03_sign_stale_quote_after_revise.test.ts`, failing.
**Location.** `server/src/intentsFunding.ts` 354-367 (seq, buyer, escrow; not `version`/`price`).
**Fix.** Add `d.version === r.version && d.price === r.get_amount`.

---

## 10. A signed-out probe of the operator's writer-history routes answers 404 before 401

**Severity:** Low (promise 6 names bookings, payments and deals, which all pass; this is the one
other connection-dependent route that answers its configuration first).
**Role:** signed-out visitor.

**Steps.** `GET /api/operator/writer-history`, `POST /api/operator/writer-history/check`, no cookie.

**Should.** 401. **Happens.** `404 Not found` (not configured here); a configured server would
answer 401 to the same probe, so the answer tells whether writer history is configured.

**Proof.** `pr12_signed_out_probes_every_route.test.ts`, third test failing; the 35 bookings,
payments, deals, team and helping probes, and the sale, companion and intents routes with real and
missing ids, all 401 (first two tests passing).
**Location.** `server/src/app.ts` 366-373. **Fix.** `me(c)` before the configuration check.

---

## 11. The external role is reported at the new generation while its move is still pending

**Severity:** Low (promise 2: not shown as moved before the other chain finalized it; the synthetic
port only, and one of the two pages handles it).
**Role:** new owner; the demo audience.

**Steps.** After the close the new owner prepares and sends the feed move; `sent` relays it:
`external_pending`, the registry double says `pending` (3 blocks to final). Read `/api/companions/:b`.
Then ask to prepare the move again.

**Should.** `controller_generation: 1` while pending (the Closing Ledger's "Feed controller" row
reads this field alone: it would say "Generation 2's address"); a second request refused as
`move_pending`.

**Happens.** `controller_generation: 2` with `move.state: external_pending`; the second request is
refused as `already_moved`. The Sale Room's "first shift" item checks `pending` before `moved` and
is right; the Closing Ledger row isn't.

**Why.** `Companions.view` takes `evm.controller()` as the fact; the synthetic `RegistryDouble`
answers the controller at inclusion (`submit` sets it at once) while the testnet port reads at
`finalized` (`evmRpc.ts` line 73). `prepare` checks `already_moved` before `move_pending`.

**Proof.** `pr18_external_role_shown_moved_before_final.test.ts`, both tests failing.
**Location.** `server/src/companions.ts` 198-216 and 307-310; `server/test/companion-chain.ts`
`RegistryDouble.submit`/`SyntheticEvm.controller`; `web/src/pages/ClosingLedger.tsx` 296-300.
**Fix.** In `view`, while a move is `external_pending` and the controller equals its `to_address`,
report the from generation (or null with the pending move); swap the two `prepare` checks; or make the
double answer the controller at finality.

---

## Tried and refused

One line per attack the server stopped, with the function that stops it (test, passing).

- Signed-out probes of 35 bookings, payments, deals, team and helping routes → 401 before any
  connection check: `me(c)` inside `needBookings`/`needPayments`/`needDeals` (`app.ts`); pr12.
- Signed-out probes of sale, economics, intents, quote, proof, receipt, prepare, companions,
  companion prepare, companion list, members, agent switches, funding status/sign, companion `sent`,
  with real and missing ids → 401: the `me(c)` first line of each route; pr12.
- A stranger with real ids: sale page, economics, companions, companion list, intents panel, quote,
  companion prepare, fund prepare, proof, members, agent switches → 404, byte-equal to a missing id:
  `SaleActions.gate`, `Store.ownedBusiness`, `Members.list`; pr13.
- A stranger or the buyer with another person's funding id (status, sign) or companion request id
  (`sent`) → 404: `IntentsFunding.row` and `Companions.action` select by `person_id`; pr13.
- The owner marks a request sent with a hash of a different transaction → `409 not_this_request`:
  `Companions.sent` compares receiver, signer and method; pr13.
- Ended buyer after a cancel, an expiry, a new deal to another buyer, a sale to another buyer:
  economics, companions, companion list → 404; sale page `live_deal`, customer totals, inventory,
  readiness null; outcomes only their own: `SaleActions.currentContext` (chain read), `setup`
  (`current`), `handoverView`; pr14.
- Former owner after the record followed: economics, companions, companion list, members, agent
  switches, business → 404; `live_deal` null; `feed_move`/`allowance_grant` → `not_owner` from the
  contract's `get_control`: `Companions.prepare`; proof and receipt kept: `proofContext`; pr15.
- Former owner's quote → not 200; the panel carries no other person's funding: `IntentsFunding.quote`
  (`d.buyer !== who.account`); pr15.
- The solver's private key (base64, hex, base64url) and the key-file field names appear in no panel,
  quote, status, sign answer, stored error, or `/api/env`; the solver is named by account and source
  only: `IntentsFunding.status`/`offers`; pr16.
- The live deal's buyer prepares a companion request → `not_owner`: `Companions.prepare`; pr17.
- The seller's approval prepared before the close and sent after → the allowance contract refuses
  `E_NOT_OWNER`, shown `refused`, the invoice still awaiting: `Companions.sent` reads the
  transaction's own outcome; pr17.
- The seller prepares a feed move after the close, before the record follows → `not_owner` from
  `get_control`, nothing signed: `Companions.prepare`; pr17.
- A solver whose `execute` answers a hash without moving anything → `unknown`, then `expired`;
  never `swapped`: `sign` reads `is_nonce_used` after execute; `status` reads it again; pr05.
- Quote, seller cancels, sign → `409 no_deal` and the row marked refused; the untouched old quote
  after a re-proposal (new seq) → `no_deal`; a signed-again refused quote → its stored refusal, nothing
  attempted; a funded escrow → `funded` for a new quote and for an older quote's signature; two quotes
  signed one after the other → `already_filled`: `IntentsFunding.sign` re-reads `get_control`; pr06.
- Signing before registering the key with the verifier → `key_not_registered`: `has_public_key`; pr00.
- Verified sign-in: a key the chain doesn't list as full-access → 401; the same challenge replayed
  → 401; a preview session in verified mode → no person: `AccountSignIn.verify`,
  `Store.consumeChallenge`, `Store.personForToken`; pr11.
- Seller proposes through Everstreet and closes with their wallet → the record follows on the next
  watcher pass (the proposal's `effects` recorded the version): `V3Intents.watchPass`/`reconcile`; pr09.

## Summary

Findings: **Critical 0 · High 3 · Medium 5 · Low 3** (11 findings; 14 failing tests, 21 passing,
in `server/test/permissions-review-3/`).

- High: (1) two quotes signed at once both fill; (2) a lost answer plus an expired quote fills again;
  (6) a seller who revises and closes with their wallet keeps Everstreet's record of ownership and
  the buyer cannot take it.
- Medium: (3) "delivered" at any partial withdrawal; (4) an ended buyer learns whether a live deal
  exists through quote and prepare; (5) the former owner reads economics and companions until the
  watcher pass, because `currentContext` trusts the local owner without the chain read it makes for
  everyone else; (7) a past participant learns which businesses have companions and intents funding;
  (8) a linked-account sign-in refusal differs in message and code.
- Low: (9) a stale quote fills after a revision; (10) writer-history 404 before 401; (11) the external
  role reported moved while pending (synthetic port; Closing Ledger row).

**The one change first:** let the close follow the contract from the buyer's side, finding 6: when
a closed outcome names the viewer as buyer and the local owner as its seller, record that version from
the outcome and apply it (or let the watcher apply a closed outcome for a recorded `deal_seq` whose
seller, buyer and seq match). Everything promise 7 says about the former owner depends on that record
following; today one wallet call outside Everstreet pins it to the seller for good. Next: claim the
deal before the first await in `IntentsFunding.sign` and read `is_nonce_used` for the deal's other
quotes before executing (findings 1 and 2).
