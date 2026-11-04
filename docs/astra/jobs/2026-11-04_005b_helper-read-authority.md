# Helper read authority after revocation and handover

P0/M. Next explicit dispatch after the current001h sole writer is reviewed. Do not interrupt or
start a duplicate writer. This corrects existing delegated support; it does not add broad digital
operator rights or replace the full M5 network milestone.

## Reproduced problem

Astra ran real app routes against in-memory Store, FakeChain and OpenSeat TestDoubleAuthority,
with fictional Ava(owner), Ellis(helper), Bea(outsider), Sam(customer). A legacy-shaped business
with fictional API-onboarding service was activated only on FakeChain. Sam sent an inquiry:
FICTIONAL PRIVATE CANARY: invoice integration question. Ava appointed Ellis, then revoked him.
GET /api/helping/:id before revocation:200, chain_check.authorized=true, one inquiry.
After DELETE /api/businesses/:id/team/:person: GET still200, authorized=false,
active_in_everstreet=false, and the entire private inquiry message is present. Bea receives404.
11 bounded API calls; no real wallet/provider/chain/network transaction or runtime database.

payments.ts helperDesk admits anyone ever in team, even revoked, and gathers inquiries/orders
regardless of the fresh chain check. Existing value.test.ts proves writes are refused after
revocation but does not assert the private read projection. Existing sale tests check the helper
list, which is weaker than checking the old direct URL.

Source concern also exists in Helping.tsx: id-only loader, retains private data after errors,
no actor/epoch sequencing. Actual normal menu switch Ellis->Bea navigates Home and unmounts;
direct help URL denies Bea. Do NOT claim that tested switch leaked. Investigate remaining
late read/action, business-id, signout/signin and lost-authority boundaries with meaningful tests.

## Expected behavior

An actively authorized helper sees only data needed for currently allowed work. A revoked helper
or prior-generation helper after a sale gets an honest ended-access state, with no customer
names, contact, inquiry text/replies, order detail, or other private records in JSON or DOM.
Unreachable/uncertain authority must not expose a fresh private payload or imply permission.
Historical appointment alone is never sufficient authority. Use current local and contract
facts conservatively; document the capability mapping for support versus fulfillment reads.
Do not conflate missing authority with an empty customer list.

Preserve strict write checks and the old owner's/helper's loss of authority. Current buyer and
newly authorized helper can work within the intended scopes. Customers keep access/history.
No new key, permission, account, grant scope or automatic reconnection is implied.

Client clears private state and reply drafts when identity/business/access epoch changes; drops
late successes and errors from an earlier epoch; handles denied and uncertain reads explicitly.
Retry of a transient failure is possible without reusing stale authorization. Same-authorized-
context ordinary view retries should not casually discard a useful draft. Distinguish a successful
reply/delivery with lost response from permission to repeat it. Maintain honest mutation status.

## Acceptance

- Reproduce the route defect before fixing. Regression asserts body privacy after local revoke,
  contract-only revoke/stale local team, sale generation change, unavailable authority and never-
  member. Include fresh denied answers and a concurrent revocation during an in-flight check.
- Assert support/fulfillment capability-scoped reads and writes; define policy before code.
  Read result must not accidentally disclose fields from an ungranted capability.
- Client tests for delayed read/action across actor/id/access changes, explicit uncertainty/retry,
  fresh sign-in, retained permitted draft and denied cleanup. Current normal menu switch verified
  safe by Astra; retain it and do not write a test merely mirroring implementation.
- Actual disposable preview: authorized messages, revoke while open, refresh/denied, direct former
  helper URL, regrant and unrelated identity, keyboard/390 layout. Can supply synthetic finite
  controls for Astra; no real chain/signing. Clearly distinguish fixture proof from live proof.
- npm run check and web build; local exact-file commits and report. Stop for independent review.

Read ASTRA/PLATFORM_VISION/EVERSTREET_UI_DIRECTION/AUTHORITY. Scope searches before reading;
no docs/research, secrets, runtime/dependency dirs, unrestricted grep. Exact Opus5.5/high subscription
only; no push/public release/submission/Day One/new spending/provider/wallet/sign/deploy/main wiring.
Keep all six milestones and current001h/001i/001j/004b scope; no broad access redesign hidden here.
