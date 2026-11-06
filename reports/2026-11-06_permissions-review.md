# Permissions review: Everstreet server and app (off-chain), 2026-11-06

Cold review against the eight promises in `reports/2026-11-06_permissions-review-brief.md`.
Read: `server/src/**`, the test worlds in `server/test/*.ts` (no `.test.` files), the listed design
docs. Tests live in `server/test/permissions-review/`; each asserts the promised behaviour, so a
**failing** test is a finding and a passing test is a refused attack. Run one with
`npx vitest run server/test/permissions-review/<file>`.

Worlds used: `sale-world.ts` (Direct v3 sale over the synthetic chain; Ava sells to Noah; Cara and
Dana are customers; Sam is a stranger), `deal-world.ts` (v2 deals over FakeChain; Mara sells to
Ana's co-op), `handoverWorld.ts` (verified NEP-413 sign-in over a synthetic RPC).

## Findings

### 1. The seller keeps running the business after the contract has made the buyer owner

- **Severity:** High (promise 8, and through it promise 1)
- **Role:** Former owner (seller) with an open session; Direct sale.
- **Steps:**
  1. Seller proposes; buyer registers, funds and accepts (all confirmed through `/api/sales/...`).
  2. Seller's wallet sends `accept_sale`. The contract closes the sale: `get_control` now names
     the buyer as owner at generation 2. The browser never calls
     `POST /api/sales/actions/:id/check` (tab closed, answer lost, or the seller simply doesn't).
  3. Seller, with the same session: `PATCH /api/businesses/:id {name}`,
     `POST /api/businesses/:id/members {person_id, role}`,
     `POST /api/businesses/:id/customer-offers/:offer/retire`,
     `PUT /api/businesses/:id/customer-offers/:offer/agent-access {enabled:true}`,
     `GET /api/businesses/:id`.
- **What should happen:** Everstreet never acts on a state the chain contradicts: once the contract
  says the buyer owns the business, the seller's owner reads and writes are refused.
- **What happens:** All succeed (200/201). `businesses.owner_id` is still the seller; every
  ownership check (`Store.ownedBusiness`, `isOwnerOf`, `controlEpoch`, `Members.staff`) reads that
  local field only. Nothing reconciles a Direct close except a participant's own `check` (which
  calls `SaleActions.effects` → `V3Intents.reconcile`) or an explicit
  `POST /api/businesses/:id/v3/intents/:intent/reconcile`. No scheduler does it; the Gated-mode
  `armHandover` gate is not armed for a Direct sale. The one place that knows is the sale room:
  `GET /api/sales/:business` answers `roles.seller=false, former_seller=true`, while every other
  route treats the seller as owner. The window lasts until the buyer notices (their
  `/api/me/v3/handovers` receipt stays "recorded") and reconciles by hand.
- **Proof:** `pr02_seller_acts_after_chain_close_before_reconcile.test.ts`, both tests **failing**
  (writes 200/201; `GET /api/businesses/:id` 200).
- **Location:** `server/src/store.ts` `ownedBusiness`/`isOwnerOf`/`controlEpoch` (local owner
  only); `server/src/saleActions.ts` `effects` (reconcile runs only inside `check`);
  `server/src/v3intents.ts` `reconcile` (route- or coordinator-driven only);
  `server/src/compose.ts` (no Direct-mode reconciler).
- **Fix shape:** on any owner-gated request for a bound business whose newest recorded live deal
  is accepted by both parties (or whose last `accept` action is `requested`), read `get_control`
  (or the recorded observation) and refuse / reconcile when `control.owner` ≠ the local owner's
  account; or run `V3Intents.reconcile` for every `recorded` intent on a short timer, as the
  handover coordinator does for Gated sales.

### 2. The former owner reads the sale room, and so the new owner's next sale and the treasury

- **Severity:** Medium (promise 1 and 5; the figures are also readable from the public contract,
  so this is a leak of a business's private Everstreet view, not of a secret)
- **Role:** Former owner, after the close is applied locally.
- **Steps:**
  1. Complete the Direct sale (seller `check`s; `businesses.owner_id` = buyer).
  2. New owner proposes a fresh sale to a third party at a new price.
  3. Former owner: `GET /api/sales/:business`.
- **What should happen:** 404, as for every other business route and as a stranger gets.
- **What happens:** 200 with `control.live_deal` (the new owner's price, buyer, floor, grants,
  expiry), `customer_obligations` (prepaid_unused, reserved_in_use, available, asset),
  `control.operators`, `handover` (state, orders, closer attempts, service readiness),
  `terms`, `token`. `SaleActions.gate` admits anyone who ever had a `sale_actions` row, a
  `sale_terms_docs` row or a `v3_intents` row naming them for that business, for ever; `setup`
  then returns the whole reading, filtering only `outcomes` and `payouts` by account.
- **Proof:** `pr01_former_owner_reads_sale_room_after_close.test.ts`, both tests **failing**
  (`200`; `control.live_deal.price === "999000000"`, `customer_obligations` present).
- **Location:** `server/src/saleActions.ts` `gate` (~L829) and `setup` (~L1006).
- **Fix shape:** for a viewer who is not the local owner, not the buyer of the current live deal and
  not a claimant, return only their own `actions`, `intents`, `outcomes` and `payouts` (the receipt
  `V3Intents.mine` already gives) and omit `control.live_deal`, `customer_obligations`, `handover`
  and `terms`.

### 3. A cancelled sale leaves the buyer's evidence room open

- **Severity:** Low (promise 4 weakened: the sharing outlives the sale it was granted for; the
  seller can still revoke by hand and the grant expires on its own)
- **Role:** Buyer (representative or evidence-role member).
- **Steps (v2 deal world):** seller grants the co-op's access request (financials, 7 days); seller
  cancels the deal (`POST /api/deals/:id/cancel`, contract status Cancelled); buyer
  `GET /api/acquire/rooms/:request` and `/export`.
- **What should happen:** The sale is over; the room, export and scenarios refuse.
- **What happens:** 200 with the full financials. `Acquisitions.grantFor` checks only the request's
  own status and expiry; `Deals.cancel` touches no `access_requests` row (only `reconcile` on a
  close revokes them).
- **Proof:** `pr03_buyer_keeps_room_after_cancel_revoke_expiry.test.ts`, test "the deal's
  cancellation ends the buyer's reading" **failing** (200). The revoke and expiry tests pass.
- **Location:** `server/src/deals.ts` `cancel` (~L739); `server/src/acquire.ts` `grantFor`
  (~L1643).

### 4. Two private list routes answer a signed-out visitor with 200

- **Severity:** Low (promise 6/7 hardening; the body is an empty list)
- **Role:** Outsider, signed out.
- **Steps:** on a composition without payments (the default test and customer compositions),
  `GET /api/deals`, `GET /api/helping` with no cookie.
- **What should happen:** 401 "Sign in first", as for every other private route.
- **What happens:** 200 `{deals: []}` / `{businesses: []}`. The handlers are
  `deals?.mine(me(c)) ?? []` and `payments?.helping(me(c)) ?? []`: optional chaining skips the
  argument, so `me(c)` never runs. Harmless today; the pattern will leak the moment one of those
  methods gains a default branch.
- **Proof:** `pr09_signed_out_lists_answer_200.test.ts` **failing** (200).
- **Location:** `server/src/app.ts` L1544 and L1591.

### 5. Deal ids reveal their existence to any signed-in account

- **Severity:** Low (promise 5, existence leak; ids are random UUIDs)
- **Role:** Outsider, signed in as an unrelated account.
- **Steps:** `POST /api/deals/:id/fund` (also `/test-dollars`, `/withdraw-hold`, `/items/:key`)
  with another team's deal id, and with a made-up id.
- **What should happen:** 404 for both.
- **What happens:** 403 "Only the team's accepting account funds the deal" for a real deal, 404
  for a made-up one. `fund`, `testDollars`, `withdrawHold` and `markItem` compare the viewer with
  the representative before any party check; `view`/`accept`/`cancel` go through `party()` and
  answer 404.
- **Proof:** `pr13_deal_id_existence_leak.test.ts` **failing** (403).
- **Location:** `server/src/deals.ts` `fund` (~L545), `testDollars` (~L594), `withdrawHold`
  (~L618), `markItem` (~L1031).

### Notes (worth knowing, no promise broken)

- N1. `Members.list` in local preview returns the first 50 people's names to any owner
  (`server/src/members.ts` ~L181). Preview only (`invite_by: "person"`); absent in verified mode.
- N2. A former helper keeps `GET /api/helping/:id` → 200 with the business's name and slug and an
  honest `access: "ended"` (`payments.ts` `helperDesk`, designed in HELPER_READ_AUTHORITY.md).
  Nothing private is returned; the former-helper test passes.
- N3. After a v2 close the seller keeps `GET /api/deals/:id` (their own deal, by design), `claim`
  and `former-owner-check`; `first_shift` (pre-sale orders, customer first names) is withheld from
  the seller. `GET /api/sales/:business` is the v3 analogue and is finding 2 because it returns the
  business's live state, not a receipt.
- N4. A customer's use prepared under the seller continues to be admitted and served after the
  contract's close and before local reconciliation (continuity is the stated design; noted here
  because it runs under finding 1's stale owner).
- N5. Sessions are `SameSite=Lax`, there is no CSRF token, and no state-changing GET route was found,
  so cross-site requests carry no cookie. `/api/agent/mcp` checks `Origin` against the platform
  origin when configured.

## Tried and refused

One line each; the function that stops it.

- Former owner (v3, after local reconcile) on 46 business, project, studio, member, offer, agent,
  value, books, listing, rehearsal, record, intent and sale-prepare routes: 404/409
  (`Store.ownedBusiness`, `Products.owned`, `Members.list/invite/revoke`, `V3Intents.list/record`,
  `SaleActions.prepare` `not_seller`). `pr02` sweep in the probe; `pr12` for v2.
- Former owner (v2) reading money, team, sessions, listing, books, inbox or replying to inquiries:
  404 (`Payments.owner`, `Store.ownedBusiness`, `Store.reply`); `Store.inbox` drops the business.
  `pr12` passing.
- Former team member after the sale: 404 on cases and workspace; `/api/me/teams` empty
  (`Members.active` keyed on `owner_generation`). Probe and `pr10` passing.
- Invitation issued before the close, accepted after: 409 `control_changed` and no membership
  (`Members.respond`). `pr10` passing.
- Seller's pre-close `appoint` action signed after the close: contract refuses; no operator
  recorded (`SaleActions.check` resolves refused). `pr10` passing.
- Former helper after a v2 close: desk `access: "ended"`, `inquiries/orders: null`; reply 403
  (`Payments.capabilityNow` reads the revoked `team` row; `helperStamp` fences). `pr12` passing.
- Revoked member's next read, workspace, case: 404; re-accept and leave: 404
  (`Members.staff`/`respond`/`leave`). Viewer moving a case: 403 `member_role`
  (`Members.staff`). Member on owner-only routes: 404. `pr07` passing.
- Pending invitee reading the board: 404; someone else accepting the invite: 404
  (`Members.addressedTo`). `pr07` passing.
- Buyer after revocation and after expiry: room, export, try, scenarios 403
  (`Acquisitions.grantFor` + `withGrant` re-check). Research-role member: 403; stranger: 404
  (`Acquisitions.role`). Room shows only granted categories (`scopeRoom`). `pr03` passing parts.
- Another customer, the owner and a stranger on a customer's use: status, result, case, cancel,
  execute, execution/cancel, reconcile, units/reconcile, release, confirm all 404
  (`CustomerUses.own`, `WorkflowCases.forCustomer`). `by-key` finds only the caller's
  (`CustomerUses.byKey`). Grants: list scoped, revoke 404 (`AgentAccess.revoke`). A customer
  without an entitlement can't prepare (`CustomerUses.prepare` readback). `pr04` passing.
- Agent token after revocation: 403 on prepare, status, result, execute, confirm
  (`AgentAccess.authorize`). Agent reaching the customer's own use: 404 (`ownUse`). Second use past
  `max_uses`: 403 `agent_used_up`; owner switch off: 403 `agent_access_off`. `pr06` passing.
- Foreign child ids under one's own business or project (`retire`, `agent-access`, member
  `revoke`/`role`, intent read/reconcile, release rollback, app-version): all 404
  (`CustomerUses.retireOffer`, `AgentAccess.setSwitch`, `Members.ownersMember`, `V3Intents.row`,
  `Releases.rollback`, `AppChecks.version`). Builds, evaluations by id: 404 (`Builds.ownedJob`,
  `ManagedRuntime.project`). `pr05` passing.
- Signed out: unpublished page, its offers, a public offer id, the agent describe: 404
  (`Store.publicBusiness`, `CustomerUses.publicOffers/publicOffer`); private routes 401 (`me`);
  guessed pass/app/preview addresses 404 (`servePass`, `serveFree`, `AppVersions.serve`);
  discover omits the draft. Follow/inquire on a draft: 404 (`Community.businessIdForSlug`,
  `Store.inquire`); founder's public profile with nothing published: 404 (`Community.profile`).
  `pr08` passing.
- Sign-in: proof moved to another browser 401 (`Store.consumeChallenge` binding hash); replay 401
  (`used_ms`); a non-full-access key 401 (`reader.isFullAccessKey`); another account's key naming
  the founder 401; planted preview session in verified mode never authenticates
  (`Store.personForToken` mode check); name-only join 403; `/api/people` and `/api/session/as`
  404; logout deletes the server session (`Store.endSession`). `pr11` passing.

## Summary

| Severity | Count | Findings |
|---|---|---|
| Critical | 0 | |
| High | 1 | 1 (seller acts after the chain's close, before anyone reconciles) |
| Medium | 1 | 2 (former owner's sale room shows the new owner's live deal and the treasury) |
| Low | 3 | 3 (room outlives a cancelled deal), 4 (`/api/deals`, `/api/helping` 200 signed out), 5 (deal ids 403 vs 404) |
| Note | 5 | N1–N5 |

The business-scoped authority model is consistent and well fenced: every owner, member, buyer,
customer and agent route I tried re-derives authority from the current row at request time, and
the awaited paths re-check after the await. The gaps are at the seam between the contract and the
local owner field, and in the one room that was built as a "participant's picture" rather than an
owner's record.

**The one change I would make first:** close the Direct-sale reconciliation gap (finding 1).
Either run `V3Intents.reconcile` for every `recorded` intent on the same timer the handover
coordinator uses, or make `Store.ownedBusiness` (or a wrapper on owner writes for v3-bound
businesses) consult the latest recorded `get_control` observation and refuse when its owner is
not the local owner's account, prompting reconciliation. That one change turns finding 1 into a
refusal and removes the stale-owner window that finding 2's sale room currently exposes.

## Status (builder, Nov 6)

Every finding was checked against the code before anything changed. The reviewer's tests are in
`server/test/permissions-review/` (13 files, 29 tests, part of `npm run check`); each now
asserts the behaviour as fixed or as kept by design.

1. **Fixed.** `V3Intents.watchPass` reads every recorded v3 intent from fresh chain evidence,
   through the same checks as a participant's own reconcile, and applies a proven close. The
   composed entry runs it every 15 s (the demo too), so a sale that closed on the contract
   without anyone telling Everstreet moves the business to the buyer within one interval, and the
   seller is then refused everywhere. The window is one interval, not zero: a per-request chain
   read on every owner route would cost an RPC call per request. pr02 drives one pass and checks
   the seller is refused; a third test shows a pass changes nothing while the sale is open.
2. **Fixed, differently from the reviewer's expectation.** The former seller must still reach the
   sale room, because that is where proceeds are collected. A past participant (not the owner,
   not named in the live deal) now gets their own claims, payouts, actions and outcomes only:
   no live deal, operators, customer totals or handover. pr01 checks both, and that the new
   deal's buyer does see it.
3. **Kept by design.** The evidence room follows the seller's grant (purpose and days), not a
   deal: a cancelled deal can be renegotiated, and the seller ends the room by revoking it, or it
   expires (both refused at once, in the reviewer's own tests). pr03's first test now records that
   cancelling alone leaves the grant.
4. **Fixed.** Both routes check sign-in first.
5. **Fixed.** `fund`, `test-dollars`, `withdraw-hold` and `items/:key` answer anyone outside the
   deal (seller, accepting account, buying team) with the same 404 as a missing deal.

Notes N1–N5: no change. N4 is closed by finding 1's fix in the same interval.
