# 003q1 report: customer workspace recovery and truthful statuses

Claude, 2026-11-04. Job: [003q1](../jobs/2026-11-04_003q1_customer-workspace-recovery.md).
Commit `5f99552`, on top of `4f59aa7`. Not pushed. No contract change.

## Reproduced first

Each finding got a failing finite test before any fix.

| # | Finding | Reproduction (failed before the fix) |
|---|---|---|
| 1 | A prepared request said one unit reserved | `server/test/customer-status.test.ts`: prepared, cancelled, expired and refused requests read `reserved_awaiting_settlement`, and so did an unconfirmed `reserve_unknown` |
| 2 | A charged request still read "Reserved" | Same file: after run → settle → reconcile, the view and list title was "Reserved" while the unit said used |
| 3 | A lost prepare plus a changed draft made a new key | `web/test/customerWorkspace.test.ts` "003q1 recovering the original request": a second Review with draft B was refused as "in progress", with no recovery action; after reload the composer was blank and the original was stranded |
| 4 | The public page said "No offer published yet" below a digital offer | `web/test/publicPage.test.tsx`, static render of `StorefrontView` |

## What changed

**Server (`customerUse.ts`, `app.ts`)**
- Unit projection with no settlement row:
  - confirmed `reserved` → `reserved_awaiting_settlement`;
  - `reserve_requested` / `reserve_unknown` → `reservation_pending`;
  - `unresolved` → `unknown`;
  - everything else (prepared, cancelled, expired, refused) → `not_held`.
  
  Having no settlement row is no longer read as evidence of a reservation.
- New `headline {title, detail}` on every view and list item. It composes the request state,
  execution and unit facts, for example:
  - Ready to review;
  - Reserved;
  - Running;
  - Result ready;
  - Settling your unit;
  - **Completed**;
  - Ended, unit returned;
  - Needs checking.
  
  The protocol `state` and `label` are unchanged; they are historical facts.
- `GET /api/customer/requests/by-key/:key` returns the caller's own request under that opaque
  key, as the normal status view, and 404 otherwise. It matches the exact key and the person;
  it never guesses by product or title.

**Browser**
- `customerApi.ts`: strict parsers for the two new unit states and for `headline`, plus
  `byKey`.
- `customerWorkspace.ts`:
  - An unanswered prepare (network failure, 5xx or a malformed answer) keeps `{key, text}` in
    memory, apart from the draft, and sets `unanswered`. `nextStep` then offers **Recover my
    original request**, which resends exactly that key and text, independent of the draft's
    validation.
  - Review with a different, blank or oversized draft gets "recover it first", and the draft
    stays as typed. Review with the identical text recovers.
  - A definite 4xx clears the attempt.
  - The recent list refreshes after any outcome.
  - `startAnother` never drops an unanswered attempt.
  - After a reload, a stored key without an id is looked up by key. A 404 says the earlier
    attempt was never recorded.
  - `sessionStorage` writes are wrapped, so denied storage never leaves an action busy.
  - Storage still holds only `{key, request id}`.
- `CustomerProduct.tsx` and `Activity.tsx`:
  - the headline is used as the title in the workspace, Recent uses and My products;
  - unit words cover not held and reservation pending;
  - an unanswered notice is announced inside the existing `role="status"` region.
- `PublicPage.tsx`: the offers fetch moved up to `PublicPage`. When released digital offers
  exist, the storefront says "Its digital product is offered above. Nothing else is open to
  book here yet." Nothing is published or inferred.
- `docs/design/CUSTOMER_WORKSPACE.md` is updated.

## Checks

- `npm run check`: Biome clean, `tsc` clean, **694 tests in 57 files** passed (679/55 before).
- `npm run web:build`: built, with only the existing chunk-size warning.
- Contract and fixtures are untouched, so Rust tests were not rerun.
- New or changed tests:
  - `customer-status.test.ts` (6): prepared/cancelled, pending, expired, charged → Completed,
    returned → Ended, refused. It also checks that by-key recovery stays own-only when another
    person used the same key, that the owner gets 404 by key and by id, and that a retired offer
    still recovers.
  - `customerWorkspace.test.ts`: lost prepare by network / 502 / malformed, each recovered as
    the original whatever the draft. Also:
    - recover-first for other, empty and 25,000-char drafts, with the draft kept;
    - one database row only;
    - the list refreshed;
    - reload by exact key, which still needs the same document;
    - another person can't use the key;
    - never-recorded after reload;
    - denied storage;
    - workspace and list statuses agree.
  - `publicPage.test.tsx` (2).
  - The 003q same-text retry test still passes (it now goes through recovery).

**Mutants**, one at a time, each restored, with the diff inspected before running:

1. Completed → Reserved: killed (server and controller).
2. The not-held fallback → reserved: killed (4 tests).
3. The recover-first guard disabled: killed (3 tests).
4. The public-page branch disabled: killed.
5. The by-key person filter dropped: it **survived** at first, because `status()` also enforces
   ownership. The new two-people-one-key test kills it.

## Not done or limits

- **Conflict headline.** "Needs checking" is not asserted in a status test. Existing race tests
  cover the conflict unit itself.
- **Browser behaviour.** Narrow/desktop reading order and the announcements are unchanged in
  structure but not browser-verified this session. That is left for Astra's browser review.
- **Preview.** The listeners were not started this session, and no listener is running.
  Steps to reproduce:
  1. `npm run web:build`;
  2. `npx tsx scripts/preview-customer.ts`;
  3. open `/b/ledgerline`;
  4. Review document A;
  5. `POST :8813/lose/prepare`, then Review;
  6. edit to document B, then click Recover my original request;
  7. reload `/use/:offer`.
- No live wallet, provider, RPC, signing, deploy or spending. Fictional data only. All six
  milestones stay open.
