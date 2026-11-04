# Scoped digital performance for an acquirer

**Why (Tony's words):** "One key function ... seamless purchase and transfer of business/product
to the investor/acquirer, on NEAR." A buyer needs inspectable evidence of the digital service
before buying, and the owner must choose what is shared.

## What people see

Extend the existing buyer evidence-room workflow with an explicitly requested and owner-granted
digital-performance scope. Clearly explain the aggregate customer use/outcome history, runtime
cost breakdown, time range and limitations the grant reveals. Existing grants must not silently
gain access. A buyer with the new scope sees useful charts/source tables for those records;
without it they see a precise access explanation. Room and export agree. No extra public listing
statistics, direct customer identities/documents/results, private storage refs or raw diagnostics.

Keep acquisition evidence and buying connected: a buyer can assess actual recorded usage,
unsettled/unknown work and cost of serving customers separately from founder testing/building.
These figures are not complete revenue, cash, profit, a valuation, testnet verification or
proof of real provider execution. Reuse003t's metric definitions and unknown/as-of provenance.

## Checked foundation

server/src/acquire.ts has CATEGORIES financials/costs/customers/operations, SCOPE_VERSION3,
version-preserving disclosure, grantFor(), withGrant() and scopeRoom(). withGrant checks current
membership/role/grant/expiry before and after awaits; room/export/scenarios share this gate.
customerOperations() is the owner aggregation; currentCustomerWork/maintenance health exist.
Buyer evidence deliberately received none of003t. Existing suppression uses "Fewer than3".
Never serialize the owner BooksView/CustomerOperations object wholesale into a room.

## Requirements

1. Short design first: exact new scope text, request/grant version semantics, allowlisted fields,
   access fence, metrics/provenance and suppression rules. A new dedicated category is preferable
   to broadening old financials/customers/operations grants. Preserve old grants exactly under
   their wording; migration must not grant anything. Explicit scope request plus owner approval
   is necessary. Do not auto-add it to pending requests, default selections or existing grants.
2. Reuse the authoritative aggregation with a dedicated scoped projection. No duplicate counting
   or second financial model. Bounded period choices/queries; exact decimal cost text, unknown
   cost/reservation state, request cohort versus current outcome. Disclose observation time.
3. Privacy includes indirect disclosure: inspect whether bucket totals, complementary categories,
   selected periods or costs reveal suppressed small groups. Keep a coherent conservative
   suppression strategy with explicit limitations. No identifiers, links to customer requests,
   owner-only mutation endpoints or hidden private payload in charts/tooltips/exports.
4. Access changes apply to every response after async reads: expiry/revocation, team-role loss,
   grant-version change, actor/business switch and ownership reconciliation. Late frontend
   responses must not resurrect revoked figures; retry should be possible when access is merely
   unconfirmed. Existing room/export audit behavior and limits remain. Do not log private payload.
5. Room UI uses existing visual tokens/charts with an accessible table, explanatory empty/unknown
   states and a clear distinction between not granted and no recorded activity. Current owner
   controls what is shown. Buyers cannot edit operations, settle units or grant themselves access.

## Done when

An isolated labelled preview demonstrates named buyer request -> owner deliberately grants the
new scope -> buyer sees only allowed aggregate performance; narrow/old/expired/revoked grants
show none; room and export match; later owner change ends stale access. Current owner's records
and customer private result remain unchanged. Preserve pre-existing grants and legacy businesses.

Finite tests cover old scope versions, requested-vs-granted categories, missing/zero/unknown,
small groups, exact tiny costs, multiple businesses/buyers, revocation/expiry/ownership during
awaits, export same allowlist, and browser late-answer fencing. Responsive/keyboard review and
explicit synthetic preview instructions. No real remote calls or external accounts required.
npm check/webbuild, local commits/report; stop for Astra review. P1/L after002d2.

No production main/provider/RPC/wallet wiring, signing/deploy, real transactions, new spend,
public push/release/submission, research access/assessment or Day One. All six milestones remain
open; preserve M2 creation, M4 imports, M5 network and M6 broader products/ownership roadmap.
