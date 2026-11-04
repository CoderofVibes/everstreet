# Helper read authority (job 005b)

Claude, 2026-11-04. Authority: [005b](../astra/jobs/2026-11-04_005b_helper-read-authority.md).
Reproduction: [HelperReadAuthorityReview](../astra/2026-11-04_HelperReadAuthorityReview.md).
Existing model: [AUTHORITY](../AUTHORITY.md) (helpers are contract operators).

**Not changed:** helper roles, grants, contract capabilities, keys and accounts. Nothing new is
granted.

## The defect

`GET /api/helping/:id` admitted anyone who had *ever* been on the business's team. It then
returned every inquiry (text, sender, person ids) and every paid or delivered order (customer
names, amounts), whatever the contract said. A revoked helper, or a helper from before a sale,
got the full private payload next to `authorized: false`.

## Policy

A helper's view is assembled per **capability**. The capabilities are the ones
`addHelper` appoints and the contract checks:

| Capability | Read it allows | Write it allows |
|---|---|---|
| `support` | Customers' messages: text, kind, time, the reply, and the sender's name as the customer chose to share it (first name when contact isn't shared). No person ids or other fields. | Reply to a message (once; a repeat is refused, see below) |
| `fulfillment` | Paid and delivered orders: customer display name, amount, session time, status and receipt links | Mark delivered (the contract decides, unchanged) |

A capability's private fields are returned **only if all of these hold**, in this order:

1. **Current record.** Everstreet *currently* records the person as a helper (`team.revoked_at IS
   NULL`), and the appointment includes that capability. Historical appointment alone is never
   enough.
2. **The contract confirms it now.** `operatorCheck(business, helper, capability)` says
   `authorized`.
3. **Nothing changed while the check ran.** The helper's record (appointment time and
   revocation) and the business's ownership generation are compared before and after the
   awaited check. Any change means `409 access_changed` and no private fields.

### Access states (always explicit, never an empty list in disguise)

| `access` | When | Private fields |
|---|---|---|
| `active` | At least one capability authorized | Only the authorized capabilities' fields |
| `denied` | Recorded as a helper, but the contract refuses every capability (revoked on the contract only; capability not granted) | None |
| `unconfirmed` | The contract couldn't be asked (unreachable, error) and none is authorized | None; retry |
| `ended` | Was a helper, now revoked in Everstreet, including every helper of a former owner after a sale | None; the business's name only |

- **Never a helper:** `404` (unchanged).
- **Fields:** `inquiries` and `orders` are `null` (not `[]`) when their capability isn't
  authorized, so "not allowed" never reads as "nothing to do".
- **Per-capability state:** each capability reports `authorized | denied | unconfirmed | ended`
  with a reason.

### Writes

- **Reply.** Requires all three conditions for `support`, checked the same way and fenced across
  the await. A message that already has a reply is refused with `409 already_replied`, so a retry
  after a lost response never overwrites or duplicates the answer. The client re-reads to show
  what is recorded.
- **Deliver.** Unchanged: it needs a current team row, and the contract decides on its own
  account.

### Continuity

- **Customers** keep their own messages, orders and history (the customer routes don't change).
- **The owner and a buyer after a sale** see everything through the owner desk, as before. Their
  successor authority is unchanged.
- **A newly appointed (or re-appointed) helper** gets current access through the same rules.
  Nothing carries over from an earlier generation: a sale revokes every helper row (existing
  behaviour), and the new owner must appoint anew.

## Client (Helping page)

- **Keying.** The page is keyed by actor and business (as other private pages are). An account or
  business switch unmounts it, and a late answer for the earlier key changes nothing.
- **Sequenced reads (`latestLoader`).** Only the newest answer lands, and an action's answer
  invalidates older reads.
- **What is shown** (pure rules, `web/src/helperView.ts`):
  - `active`: only the allowed sections.
  - `ended` or `denied`, or a refused read (401/403/404): an honest ended or denied message, with
    no private section in the DOM. **Reply drafts are cleared.**
  - `unconfirmed`, a transient failure, or `409 access_changed`: no private section, and Try
    again. **Drafts are kept** in memory, so a successful retry in the same authorized context
    restores them. They are never shown without current authority.
- **Action outcomes.**
  - Refused (403/404): re-read the access.
  - Conflict (409): re-read and show what is recorded.
  - No answer (network): *outcome unknown*. The page re-reads instead of resending, and says so.

## Tests and preview

- **Routes** (`server/test/helper-read.test.ts`):
  - authorized;
  - owner revoke (Astra's case);
  - contract-only revoke;
  - Everstreet revoke while the contract still authorizes;
  - each capability alone;
  - unreachable contract;
  - never a member;
  - a revocation landing while the check is in flight;
  - re-appointment;
  - customer continuity.
- **The sale case:** `deals.test.ts` (the former helper's direct URL after a close).
- **The client's rules:** `web/test/helperView.test.ts`.
- **Preview:** `scripts/preview-helper.ts`, with fictional controls for authorized, revoke,
  re-grant, contract-only revoke, support-only, outage and restore, and a real FakeChain sale
  for an owner change.

## Not in this job

- delegated-operator rights for digital products (studio, release, customer results);
- new grant scopes;
- live chain checks (FakeChain only here);
- the expert-help workflow (005c).

All six milestones remain open.
