# Direct sale design review at155b636

Astra reviewed DIRECT_SALE.md against the dispatched003wf2 brief, the approved platform/UI
direction, current wallet adapter and v3 sale/claim paths. Claude81990 remains sole writer;
contract/lib and tests are already being edited by Claude and are untouched by Astra.

The overall direction is sound: immutable terms, execution-time review guards, measured party
storage, exact transaction evidence, existing reconciliation, explicit metering grants and a
distinct acquisition workspace. Preserve that scope and finish all of the dispatched journey.
The following are design corrections, not claimed reproductions of unfinished application code.

## 1. Unknown actions cannot rely on a generic fresh wallet ask

Section5 says asking again for identical arguments is safe because the guards make duplicates
fail. That proof does not hold for every action:

- claim_party_guarded(category, expected_amount) guards a value, not a unique claim incarnation.
  After one payout, that category can receive a later credit of the same amount. Reusing the
  earlier request can then collect a different claim while purporting to recover the first one.
- Funding is identified by deal/version/price. The buyer can unfund and then fund the same
  unchanged version again; control_seq changes, but the funding message does not guard it.
  An identical fresh request can therefore have another effect after an intervening unfund.
- Token storage registration also needs its own idempotency proof; repeating storage_deposit
  without registration_only behavior must not be assumed effect-free on every supported token.

Keep unknown actions recoverable by their original transaction identity. Do not offer a blanket
fresh wallet ask for requested/unknown actions. Either restrict resend to proven identical signed
transaction bytes/identity, or provide and test a genuine operation identity/idempotency guarantee
for each supported retry. If the wallet gave no hash, retain the original request and explain
original-transaction recovery; do not turn a new transaction into proof of what the old one did.
A new action after definitive refusal/restoration is distinct from an unknown-action retry.
Test delayed originals, intervening same-value state changes and overlapping tabs explicitly.
This enforces the brief's durable-recovery requirement without requiring a new product feature.

## 2. One coherent customer/sale economic state in the synthetic journey

Section6 excludes customer settlement moving available while calling SaleChain one state model.
The brief requires actual encoded calls and coherent customer continuity. A sale-only treasury
with customer activity in a disconnected balance model cannot verify the available-floor and
post-sale service interaction. Connect the relevant customer reservation/settlement/release and
sale treasury state, or use the existing shared model with those effects implemented. Test a
customer operation affecting the sale's floor/obligations and service continuing under the new
owner's actual grants. Preserve separately labelled Rust fixtures and in-process/process evidence.
The larger parent100/20/80/79 matrix remains later; this does not pull all of that parent into
this child, but this child's demonstrated customer/sale history must be internally coherent.

## 3. The completed sale and payout recovery remain usable

The next-action order puts a seller with no live deal before closed-but-not-applied and claims.
Define former seller/current owner roles and prioritize the proven close, reconciliation and
owed proceeds appropriately. An ended deal must not accidentally show a new proposal or an
accept/fund action for a nonexistent live deal. Include old seller, new owner and expired/cancelled
states in controller and browser evidence.

Token registration is currently a buyer-only action in the table. A seller collecting proceeds
may also lack token registration. Make the correct recipient's registration prerequisite
actionable for claims, with an exact separate review, and retain pending/restored/paid truth.
Do not confuse a business-v3 party record with a token-contract account registration.

Amend the design before implementing the affected browser/recovery behavior. Resolve these
points in the report with actual tests; no acceptance from the document alone. Continue the
same bounded003wf2 job; do not start another writer or later job. Keep all existing permissions,
pending browser approvals, remaining parent groups and six milestones intact.

## Source review follow-up, 22:16 Pacific

Astra independently read the new guarded-method diff and all six added Rust tests, including
the scripted history, against the existing digest, party-storage, funding and invariant helpers.
Proposal/revision digest comparisons occur before party creation or escrow changes. Control
guards share the existing action paths; claim reservation still happens before its asynchronous
payout. Party quotes are checked against measured, flushed storage growth, including a
64-character buyer. The scripted history covers repricing, stale acceptance, returned funding,
failed/restored payouts, Direct close, former-owner refusal and explicit new-owner metering.
This supports the chosen contract direction, but does not establish application or browser
acceptance. The same-version unfund/fund step also demonstrates why a generic fresh send cannot
be called recovery of the original transaction.

Claude reports85 Rust tests passing, clean clippy and a successful wasm build; Astra has not
independently rerun those checks. The source remains an in-progress working diff. Underfunded
storage uses a should-panic unit case and explicitly does not prove VM rollback; do not call it
a sandbox rollback test. The fixture is a contract-unit synthetic history, not external-chain
evidence. The original three design corrections and required application/process/browser gates
remain open until their implementation and evidence are reviewed. Claude's stream confirms it
has read this review and CheckSchedulingReview before proceeding.

Read-only process inspection found one exact active session, PID43156, about285 MiB working set;
the two other matched Node processes were about100 and110 MiB. This is a current snapshot, not
an explanation of the earlier15-GB screenshot. No duplicate writer or new preview was launched.

## Amended recovery design review, 22:21 Pacific

The amended design now adds funding's expected_control_seq and claims' expected_payout_seq,
connects customer treasury movements, and fixes post-close roles/recipient registration. These
address the earlier direction; their implementation evidence remains due. The proposed
no_longer_possible/replacement mechanism needs one further correction before application code:

- Token registration is reversible. contracts/test-token/src/lib.rs:89 implements
  storage_unregister. A final read saying "registered" cannot establish that an old unknown
  storage_deposit will never have an effect: unregister can follow, then the delayed old deposit
  can register again. registration_only refunds when already registered, but does not provide a
  lifetime exclusivity identity. Do not classify that action as permanently impossible from
  registration state or offer replacement based only on register:token:account. Keep the unknown
  registration tracked and recover its original transaction, unless a stronger independently
  proven transaction-expiry/identity guarantee is implemented. No need to expand scope to build
  such a guarantee; disable this replacement path and explain original-transaction recovery.
- For other allowed replacements, require the exact immutable call/action digest as well as the
  guard identity. A control sequence alone spans different methods and different terms. Do not
  silently allow revised terms or another action to be presented as replacing the same request.
  Preserve both distinct transaction records and establish each one's result separately.
- Acceptance also lacks the claimed lifetime identity. At ec1b7f8, lib.rs:2044 clears
  buyer_accepted when escrow is taken back WITHOUT changing the deal version. The sequence
  fund -> buyer accepts -> unfund -> fund -> same buyer acceptance can therefore succeed twice
  with the same deal/version/account. An accepted flag alone cannot prove the original call can
  never take effect again, and accept:deal:version:account cannot justify a replacement. Keep
  acceptance recovery tied to the original transaction; only genuinely irreversible evidence
  (that exact deal ended, or its version advanced) can make it permanently inapplicable under
  the current method. Alternatively add a proven execution-time incarnation guard with its own
  tests, without silently changing the conditional-close experience. Do not add that complexity
  merely to retain an optional replacement feature. Include this unfund/refund counterexample
  in the recovery tests. Existing immediate E_ALREADY_ACCEPTED coverage does not prove this case.
- For monotonic guards, a final read may prove no future effect, but it still cannot establish
  whether the earlier transaction succeeded. Keep that distinction in API state/history and UI.
  Include late original receipts after replacement and after reconciliation in the tests.

This is a source-grounded design finding, not a claimed application regression. Continue003wf2;
no new writer or external actions. The updated shared-economics and role ordering are consistent
with the review and should proceed to implementation and behavioral verification.

## Files changed by Astra

Added this review and its INDEX row. NEARSkillReferences records complete local reference reads;
CheckSchedulingReview separately addresses the recurring baseline harness timeout. No contract,
script, configuration, product code, Git write or external operation by Astra. Claude reviews
and commits the notes with its applicable checks.
