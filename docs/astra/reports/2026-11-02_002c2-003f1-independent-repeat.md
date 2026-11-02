# Runtime recovery and financial corrections: independent repeat

Astra, November 2, approximately 15:06 Pacific. Reviewed through `219976c`. All probes below
use fictional people, in-memory SQLite, FakeChain or scripted model providers. They are not
live provider or NEAR evidence. Claude's implementation reports are separate from these checks.

## Runtime recovery

The browser ran a fictional invoice on the released build. The fixture substituted HTTP500
for the response after the real in-memory API accepted the request; the scripted provider
finished after seven seconds. During the wait, a different next draft was typed and the
canvas changed Brief → Service. The draft survived. After the lost response, recovery stayed
visible with the original text and target identified; new paid work had its explicit label.
Changing the selected target to the build and choosing Check recovered the released request's
result. The changed draft stayed intact. There was one request in history, and recorded spend
remained $0.013500 (eight evaluation calls plus this one trial), with no added reservation.
This accepts the ordinary changed-draft/changed-target correction in 002c2.

One independently reproduced boundary remains: `serviceAttempt.put` retains only the last ten
attempts regardless of state. Eleven explicitly started requests with a simulated lost answer
leave ten unresolved entries, and `recover(requests, "0")` returns null. A single unresolved
request is also evicted by sufficient later answered work. New paid work must not discard an
unresolved recovery record. A bounded refusal when every slot is unresolved is acceptable;
prefer evicting settled history first. Refresh persistence was not added or verified here.

The Build landing page still states “AI generation is not connected yet” unconditionally,
despite the injected build provider being available and the project holding a successful build.
Home has the same static assertion. These notices should reflect actual capability or describe
the initial brief/prototype without claiming the provider is absent.

## Financial server probes

The original five defects now pass independently:

1. A monthly hosting cost ended in September stays ended after another DELETE in November.
   Its `until_yyyymm` remains202609. October has only the separate13000-cent model cost;
   the25000-cent hosting cost is not resurrected.
2. Moving the fixture account opening to September15 yields August before_start/completefalse,
   September first_partial/completefalse, October complete/true.
3. A min_months1 acquisition search returns one listing both before and during a September
   read failure. During failure its history is explicitly unknown, with null months/verified,
   and the reason says it was kept rather than ruled out.
4. Holding the money read, changing ownership, then releasing it yields404/no treasury.
5. Holding scenario creation at its books read, changing ownership, then releasing it yields404
   and zero scenario rows. Ownership-away-and-back is covered by Claude's regression, not
   independently repeated in this pass.

## Financial browser review

Ledgerline Labs fixture: June opening partial, August observed zero, September unavailable,
October positive contribution, November partial/negative; monthly hosting and an October
model cost. Period selection updates charts, table, category totals and AI-spend period text.
Historical partial now says “partial: opened mid-month”; November says “so far”. A missing
adjacent month produces an honest Can't compare notice. Chart keyboard focus reaches months.

Expanded source table: viewport390/document375; charts have560px drawings in298px local
scroll containers and the632px table scrolls within298px. The old704px page overflow is fixed.
1280/document1265 and1440/document1425 also have no page overflow. Screenshots were visually
inspected and saved internally in the task visualization folder (`m3f1-expanded-books-390.jpg`,
`m3f1-chart-390.jpg`, `m3f1-books-1280.jpg`). Axis text remains small; later visual polish should
make it easier to read, and the table could use more compact source/partial labels.

Remaining provenance defect: the observed August zero row labels Sources only “Founder supplied”
(its cost), whereas nonzero observed revenue rows include Verified on NEAR. A zero observation
must retain the observation's source. FakeChain is deliberately isolated/test-labelled; this
does not substantiate an actual testnet observation. Mixed seeded series and private buyer-room
serialization were source/test reviewed but not independently browser-repeated this pass.

## Fixture setup limits

The first restricted QA process could not accept browser connections; it was stopped and
restarted with approved loopback access. The first runtime navigation used the legacy /studio
route and a different same-name fictional session; both fixture errors were corrected. Final
QA uses /build and the original fictional founder. No real runtime data, keys or accounts were
read. See BUILD_STATE for process cleanup and next dispatch.
