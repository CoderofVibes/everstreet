# Job 003p report: evidence stays within the seller's disclosure choices

Claude, 2026-11-02. Job: [003p](../jobs/2026-11-02_003p_evidence-access.md). Built on Astra's
[reproduction](2026-11-02_evidence-access-review.md) and the
[financial integration review](2026-11-02_financial-integration-review.md) §3.

## Evidence kind

**Unit evidence only.** Results come from `npm run check`: the real `everstreetApi`, an
in-memory database, OpenSeat with test authority and the in-memory `FakeChain`. Monthly reads
(`period`) are held on a gate while access changes. There was no network, signer, transaction,
deployment or runtime database. **No browser run:** the browser rules are unit-tested as a pure
module, and Astra's identity-switch browser review is still needed.

## The fix Astra reproduced

Room, export and try authorized before their asynchronous reads and never checked again. Every
evidence read now goes through one gate, `Acquisitions.withGrant`:

1. Check the grant: team role at evidence level or higher, status, expiry and required category.
2. Run the reads.
3. Check the grant again after the last await, before anything private is serialized or
   written.

The grant is captured as a stamp: `access_version`, status, granted kinds, expiry, scope
version, role, business and owner. If any of it changed, the answer is a 403: "Access changed
while this was loading, so nothing was shown. Open the room again." A grant that ended or
expired returns its usual refusal. `access_version` (new column) increases on every decision:

- grant, decline, revoke and withdraw;
- the close's bulk revoke and withdraw (`deals.ts`).

So a revoke followed by a re-grant with identical fields is still caught.

The room, its export, try and save all use the gate. Room and export share one scoping
function, `scopeRoom`. No chart endpoint for buyers exists yet; any future one should use
`withGrant` and `scopeRoom`, not a second serializer. Save rechecks the financials category
after the reads, then writes synchronously with no await between the check and the insert.

## Disclosure model (versioned, nothing silently changed)

**Listings** (`disclose_version`, new column; existing rows are 1):

| Choice (wording 2) | Shows |
|---|---|
| Everstreet estimate (the range only) | the range |
| How the estimate is calculated (shows monthly revenue, costs and operating profit; needs revenue and profit shared too) | the calculation lines |

- Choosing the calculation without both revenue and profit is refused (400). An unchecked
  revenue or profit choice can no longer contradict a calculation that shows them.
- A version-1 listing with `value` keeps showing the calculation it was agreed under. The
  seller sees both boxes checked and a note: "Saved under the earlier wording 'Everstreet
  estimate and its calculation'…".
- Saving other fields keeps version 1; choosing disclosures again applies wording 2.

**Grants** (`scope_version`, new column; existing rows are 1):

- New grants use wording 2: operations is "Owner work, helpers, customer promises and what
  transfers (no balances)", and financials includes the contract's balances (`balances` in the
  room).
- An operations-only grant shows promises and the manifest. The customer-money manifest line
  reads "Amount shown with financials access".
- A version-1 grant keeps its balances under operations and shows a `scope_note`.

**Scenarios:** new saved scenarios store only the team's overrides and the resulting
low/high. Older rows still hold the full estimate in the database, but only low/high is ever
returned, and only through the gated room. They were not rewritten.

**Sorting:** anonymous listings sort by their band's low edge (asking and value). Ties keep
listing order, so the order inside a band reveals nothing.

**Caching:** every `/api/` answer carries `Cache-Control: no-store`, including refusals, books,
value and deals. The web client also fetches the room with `cache: "no-store"`.

## Sale terms (after 003b; v3 terms design not assumed)

- New terms use `everstreet-deal/2`. Financial figures are **off by default**:
  `evidence: { included: false, note }`.
- `obligations.customer_money` is always included, because the buyer takes it on.
- The seller can tick "Include a financial snapshot in the terms". It shows a preview
  (`GET /api/businesses/:id/deals/snapshot?buyer_id=`) of the exact figures, who sees them
  ("The seller and the buying team named in these terms") and retention ("…Ending evidence
  access later stops new reads; it does not recall these terms").
- A snapshot is allowed only while that team holds a current financials grant (checked after
  the reads), otherwise 409.
- `changes()` reports a snapshot being added or removed.
- **Format-1 terms are untouched:** stored bytes and hash are unchanged, they still render and
  compare, and the first shift reads customer money from either format.

## Browser (`web/src/evidenceView.ts`, `AcquireRoom.tsx`)

- Each load is tagged with person, room and a load number.
- Switching person or room hides evidence immediately; render also checks the tag, so another
  session's data is never drawn even for one frame.
- An older load's answer is ignored, and the previous request is aborted.
- A 401/403/404 or a network failure clears the room and explains why, with Check again on
  failure.
- The room rechecks access on `visibilitychange`.
- A refused try or save reloads the room, which clears it.
- The page states that an exported copy can't be recalled (the existing permitted-export
  limitation is kept).
- The listing editor shows the earlier-wording note. Both terms forms offer the previewed
  snapshot choice.

## Tests

`server/test/evidence-access.test.ts` (43):

- **In flight**, for each of room, export, try and save (7 × 4 = 28 cases), the change happens
  while the reads are held:
  - revoked;
  - expired;
  - narrowed on the same request;
  - revoked and re-granted identically (version only);
  - the reader removed from the team;
  - the reader's role dropped below evidence;
  - the business changed hands.

  Each asserts a refusal, no private keys in the body, and no scenario row written.
- **Controls:** the same held reads succeed when nothing changes.
- **Concurrent:** four reads by two members, one revocation, all refused.
- **Sequential:** after revocation every read is refused. A fresh narrower grant shows only
  costs, and scenarios need financials on it too.
- **Disclosure:**
  - minimal saved scenario;
  - operations-only without balances;
  - financials with balances;
  - legacy grant keeps balances with a note;
  - value-only listing (no calculation, revenue and profit not shared);
  - calculation needs revenue and profit (400);
  - legacy listing neither narrowed nor widened, labelled, version kept on unrelated saves.
- **`no-store`** on room, export, try, save, books, value and a 403.
- **Anonymous sorting:** two asking prices in one band keep listing order (exact sorting would
  reverse them).
- **Terms:**
  - default has no figures;
  - snapshot refused without a grant, previewed and included with one, unchanged after
    revocation;
  - a format-1 row keeps its bytes and hash, renders, and reports "Financial snapshot removed"
    on revision.

`web/test/evidenceView.test.ts` (6):

- a person switch hides the room;
- a delayed answer for the previous person doesn't repopulate it;
- an older load is ignored;
- the room stays visible during a recheck and clears on 403;
- a network error clears it;
- another room never shows it.

**Mutation check:** with the after-await recheck disabled in `withGrant`, 29 of the 43 tests
fail. All 28 in-flight cases fail, and so does the concurrent case. The recheck was restored.

## Checks

- `npm run check`: lint, typecheck, 20 files / 233 tests passed.
- `npm run web:build`: passed, 56 modules (chunk-size advisory only).

## Not done / for review

- **No browser run.** Astra should switch identity during a delayed room read, revoke while
  the tab is hidden and return to it, and check the listing note and the snapshot preview.
- **Other financial review findings stay with 003f:** missing vs zero, units, sources and
  precision. Only the §3 privacy paths were in scope.
- **Defaults are Tony's decision.** Listing defaults still share revenue and profit; only the
  calculation is now separate.
- **The earlier-wording note is the only migration UX.** There is no bulk re-consent flow.
- **No rewrite of old data.** Older saved scenarios keep their full stored estimate (never
  returned).
