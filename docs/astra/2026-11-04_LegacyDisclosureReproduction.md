# Legacy customer-count disclosure reproduced through real API

Astra independent review while Claude39464 implements001f1. The previous goal turn made
progress (continuous Goal activation, paused timer, actual UI review and bounded dispatch).
This pass confirmed39464 remains live and performed separate acquisition-evidence verification;
no duplicate writer or application changes.

## Observed result

The earlier source-derived concern in LegacyDisclosureReview is now reproduced through the
actual application's granted room and JSON export routes. A finite disposable in-memory fixture
uses fictional seller/buyer/business and a customers-only grant. Four seeded payment rows:
three delivered, one refunded, all for one fictional customer. No chain/provider/real data.

Both room and export return the same customer rows:

| Field | Returned value |
|---|---|
| Paying customers | Fewer than 3 |
| Paid orders | 4 |
| Delivered | 3 |
| Refunded | Fewer than 3 |
| Customers with 2 or more orders | Fewer than 3 |
| Bookings through OpenSeat | 0 |
| Upcoming sessions | 0 |

The complete output determines refunded=1: it is positive, below3, and no greater than4-3 even
allowing remaining paid/kept rows. Exhaustively enumerating delivered/refunded/other0..8
(729 finite combinations) leaves only {1}. The current note says nobody can be singled out;
that categorical promise is not justified. This shows exact-count inference, not proof that
customer identity is exposed.

The source label additionally describes NEAR testnet payments and connected OpenSeat although
this isolated route fixture has neither configured. Distinguish actual configured/observed source
from stored imported/test records; do not fabricate origin certainty. Review source label as part
of the bounded correction without confusing this legacy scope with digital customer-use metrics.

## Reproduction and bounds

Temporary probe: everstreet-astra-legacy-disclosure-20261104.mts under the OS temporary directory.
Imports everstreetApi/openDb/Store directly, only :memory:. Thirteen requests through app.request;
hard25-request ceiling,200k-character response bound,15-second independent process deadline.
Node process exited0 within3seconds. Seller creates/answers/publishes a fictional legacy profile,
buyer creates a strategic profile, seller privately invites it; buyer requests customers scope,
seller grants; seed four payment rows with one person; GET room and export. Assertions confirm
4/3/Fewer than3 and singleton{1}. No server listener, external network or signed transaction.

## Required correction

Whole-output disclosure protection, conservative withholding if necessary; test paying/repeat,
payment status partition, booking and combined-scope constraints. Remove categorical anonymity
wording, keep room/export parity and revocation/expiry/role/owner fences. Do not widen grants or
silently redefine historical metrics. Queue a bounded003u2 after the current UI correction; Studio
001g remains next approved composition work and must not be lost to review-only iterations.

Astra added this note, its INDEX row and jobs/2026-11-04_003u2_legacy-customer-disclosure.md;
the JOBS row waits until Claude releases that actively edited file. Checkpoint updated. No production code or Git
writes. Required npm check during this pass stopped at one formatter error in Claude's active
explore-availability test; types/tests not reached. This is a moving-tree observation; leave
his implementation untouched and run the stable final check after completion. Research remains unread/local-only.

