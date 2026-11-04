# 005b Helper read authority: report

Builder: Claude (Opus 5.5, high), sole writer.
- Job: `jobs/2026-11-04_005b_helper-read-authority.md`.
- Policy first: `docs/design/HELPER_READ_AUTHORITY.md` (capability map, conditions, access
  states, writes, continuity, client rules).

## Reproduced first (real routes, previous code)

`server/test/helper-read.test.ts` uses fictional Mara (owner), Ellis (helper), Sam (customer,
with a fictional private canary) and Bea (unrelated), on the FakeChain contract double. On the
previous code, **9 of 11 failed**; the two that passed are expected (never-member 404, customer
continuity).

- **Astra's case.** After Mara revoked Ellis, `GET /api/helping/:id` answered 200 with
  `"active_in_everstreet":false`, `"authorized":false` **and Sam's canary message and order**.
- **Also leaking:**
  - contract-only revoke;
  - an Everstreet revoke while the contract still authorizes;
  - each single capability (support-only still got orders; fulfillment-only still got messages);
  - an unreachable contract;
  - a revocation landing while the check was in flight;
  - re-grant semantics.
- **After a sale** (`deals.test.ts`, the real close on the double): the former helper's direct
  URL answered 200 with the business's orders and no access state.

Astra's browser note stands: the normal Ellis→Bea menu switch navigates Home and was safe. No
test here claims it leaked.

## Fix

- **`payments.helperDesk`** assembles the view per capability. A capability's private fields are
  returned only if:
  1. Everstreet *currently* records the helper and the appointment includes it;
  2. the contract confirms it now;
  3. the helper's record and the business's ownership generation are unchanged across the
     awaited checks. Otherwise it answers `409 access_changed` and shows nothing.
- **Access states:** `active` (some capability confirmed), `denied`, `unconfirmed` (contract
  unreachable; never treated as permission) or `ended` (revoked, including every former-owner
  helper after a sale).
  - `inquiries` and `orders` are `null` unless their capability is confirmed.
  - A never-a-helper request stays a 404.
- **Minimal projections.**
  - Messages: `id, kind, message, share_contact, from_name, reply, created_at, replied_at`. No
    person ids, and the sender's name as the customer shared it (first name when contact isn't
    shared).
  - Orders: unchanged fields, only with fulfillment.
- **Helper reply (`payments.helperReply`):** the same conditions for support, fenced. A message
  that already has a reply is refused with `409 already_replied`, so a retry after a lost
  response neither overwrites nor duplicates it.
- **Deliver:** unchanged (current team row, then the contract decides).
- **Client.**
  - `Helping` is keyed by actor and business in `App.tsx`.
  - Reads are sequenced (`latestLoader`), and an action's answer invalidates older reads.
  - `helperPatch` drops data on a failed read, so a retry never re-shows older private data.
  - `helperShown` shows private sections only for confirmed capabilities.
  - Ended, denied and refused show an honest message and **clear reply drafts**. Unconfirmed,
    failed and `access_changed` hide private sections, **keep drafts** and offer Try again.
  - An action with no answer is "outcome unknown": the page re-reads and says it didn't resend.
  - 403/404 and 409 outcomes are told apart.
- **Continuity:**
  - Customers' own messages and orders are unchanged (tested through `/api/inbox`).
  - The owner's and buyer's desks are unchanged.
  - Re-appointment restores access through the same rule.
  - After a sale, every former helper is ended, and the new owner appoints anew (existing
    revocation on close).
  - No role, grant, key or capability was added.

## Verification

- **`server/test/helper-read.test.ts`** (13 tests):
  - authorized (both sections);
  - owner revoke;
  - contract-only revoke (denied);
  - Everstreet revoke while the contract still says yes (ended, and the reply refused 403);
  - support only (messages, no orders; deliver refused by the contract);
  - fulfillment only (orders, no message text);
  - unreachable contract (unconfirmed, nothing private);
  - never a member (404);
  - **revocation while the check is in flight (409, nothing private)**;
  - re-appointment (active again);
  - customer continuity;
  - minimal message fields (no person ids);
  - a reply sent once (a repeat is 409, the stored reply unchanged).
- **`server/test/deals.test.ts`:** after the real close, the former helper's direct URL is
  `ended`, with no orders and no customer name.
- **`server/test/helper-preview.test.ts`:** every preview control in turn, through the preview
  site's fetch, with an 80-request ceiling.
- **`web/test/helperView.test.ts`** (8 tests, real `latestLoader` sequences with held answers and
  a request cap):
  - capability-scoped sections;
  - nothing private for ended/denied/unconfirmed/failed/refused;
  - which states keep or clear drafts;
  - a failed re-read drops older data;
  - a revoked-between-reads answer and the older active answer arriving late;
  - access loss drops everything;
  - a closed page ignores late answers;
  - action outcomes.
- **Existing helper write tests** (`value.test.ts`) pass unchanged.
- **Mutants**, each run alone with a time ceiling, all killed:
  1. messages returned without support;
  2. no before/after fence;
  3. a revoked Everstreet record falling through to the contract;
  4. an unreachable contract treated as authorized;
  5. reply-once removed;
  6. a failed read keeping older data (client);
  7. drafts kept after access ended (client).
- `npm run check`: lint and types clean, **1069 tests / 108 files passed**.
- `npm run web:build`: passed (833.23 kB bundle; same size advisory as before).

## Preview for Astra (fictional, in memory; not started or left running by me)

```
npm run web:build
npx tsx scripts/preview-helper.ts     # site 127.0.0.1:8852, controls :8853; Ctrl+C ends it
```

Act as Ellis Grant at `/help/<business>`. Controls are `POST :8853/` followed by one of:
- `revoke` and `regrant`: through the owner's real routes (Mara, or Ana after the sale);
- `contract-revoke`, `support-only`, `outage` and `restore`: on the contract double only,
  labelled as such;
- `sale`: Mara accepts the co-op's deal, which is a real close on the double.

`GET :8853/` shows the state. There is a 2,000-request ceiling.

## Proof versus pending

- **Proven here:** the route policy and the client rules, on the FakeChain double, through the
  real routes.
- **Pending Astra's browser review:**
  - the helper page while revoked while open, then refreshed;
  - the direct URL as a former helper;
  - re-grant;
  - outage and Try again with a typed draft;
  - an unrelated identity;
  - keyboard and the 390 layout.
- **Not covered:**
  - a live NEAR contract (no RPC or wallet here);
  - delegated-operator rights for digital products;
  - expert help (005c).

All six milestones remain open.

## Notes

- **Astra's concurrent files:** they appeared during this pass and were left unstaged:
  `docs/astra/INDEX.md`, `2026-11-04_BooksRecoveryReview.md`, `books-stale-period-2026-11-04.jpg`
  and `jobs/2026-11-04_001h1_books-refresh-disclosure.md`.
- **Searches:** all searches used `git grep` with explicit paths or the scoped search tool on
  named directories. No shell `grep`, no unscoped `git grep`, no filter chains.
- **Scope:** 001i, 001j, 004b, 005c and 001h1 were not started. No provider, RPC, wallet,
  signing, deploy, push or spending.
