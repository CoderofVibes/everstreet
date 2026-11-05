# Purchase design review before acceptance

Source review at design0ed7557 and contract fixturee3949c4;25599 is sole active003web writer.
The initial findings were design requirements. The resolver probe below now independently
reproduces four implementation failures while the job is still in progress.
It complements FreshCustomerPlanning's registration replacement hypothesis. No contract/app edits
or live transaction by Astra. Review this before accepting the resulting purchase controller.

## Required distinctions

1. **Registration at execution.** Section10 says same sequence accepts at most one request.
   Scope that claim to one unchanged registration. Buy currently has no reg_id, and unregister
   plus sponsor_shell can reset purchase_seq to0 under a new reg_id. Reproduce the old-buy/new-shell
   interleaving in Rust and bind execution appropriately before claiming reviewed registration.
   The intent uniqueness key and recovery reads must also distinguish registrations.
2. **Rejection is not verified return of tokens.** Section10.4 currently makes a business
   purchase_returned log decide returned. That only states the business's intended unused amount;
   the token's resolution is a distinct step. Require exact successful finalized resolution and
   supported token behavior for a completed-return claim. Missing/failed/inconsistent resolution
   stays unresolved or reports rejection with refund unconfirmed. Apply the same care to accepted
   units: confirm the exact receiver outcome committed and the required funds evidence agrees.
3. **Logs are not enough.** Verify exact transaction hash, account, target, allowed complete action
   list and encoded call; tie the relevant successful receipt outcomes to that transaction and
   expected executors. Reject failed receipts with matching logs, unrelated or contradictory
   receipts, incomplete graphs and incomplete finality. Do not find any matching event in a list
   and treat it as proof. Use the pinned RPC response shape; docs may describe newer node APIs.
4. **Abandonment cannot cancel an admitted payment.** A lower sequence read does not prove the
   original transaction will never execute. Section10.4's abandon then replace must retain that
   unresolved original operation and cannot present it as cancelled or expose a fresh-sequence
   payment. Same sequence also cannot promise every duplicate's actual refund. Define exact
   permitted recovery and explicit wallet consent, including possible extra debit/gas, or refuse
   another payment while authoritative resolution is missing. Distinguish proven never-sent
   preparation from wallet-requested/unknown state, including crashes at that boundary.
5. **Exact quote capability.** The measured811+customer-length storage model is useful evidence
   for the tested contract/storage layout. State how the running contract is identified as that
   supported version/code before using it as an exact quote. Similar view output alone does not
   prove the serialized storage layout. Unsupported identity must be unavailable or use a
   demonstrably safe supported quoting capability; do not silently apply the fixture constant.
6. **Consent survives the create response.** The in-progress browser `confirmPurchase` verifies
   the preview, then sends `purchase.call` returned later by create without comparing the complete
   returned purchase to that review. Bind account/network/offer/registration/sequence/units/token/
   amount/gas/deposit/complete action to the reviewed immutable snapshot immediately before send.
   A changed or malformed create response must not become a different wallet request. Apply the
   same review discipline to explicit resend; a recovered open row is not itself new consent.
   The independent consent probe below now reproduces this in the actual browser controller.
7. **A wallet ask is not a transaction-validity anchor.** The new requested_height plus86400+2000
   block branch cannot establish non-execution: the wallet may wait for approval, then construct
   its transaction with a newer reference block. Nor is transaction admission validity a bound on
   all already-generated asynchronous receipts. Keep unknown unless exact authoritative evidence
   excludes the original effect; no extra margin fixes a missing identity/bound. Registration
   replacement similarly proves a guarded future buy will be refused, not that an earlier buy was
   never accepted and consumed before unregister. Preserve prior-payment/refund uncertainty.

## Primary documentation checked independently in this pass

The FT standard separates the receiver's unused amount from the token's resolution of the
transfer. This supports keeping purchase rejection and completed token return separate.
[NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md), ft_resolve_transfer section.

The RPC documentation distinguishes FINAL from executed/included states and describes receipt
detail availability by method/node version. Validate actual returned status and identity, not
only the requested wait level.
[NEAR transaction RPC](https://docs.near.org/api/rpc/transactions).

These are independently consulted official references for the active build, not copied local
research material. No dependency version upgrade is proposed by reading current documentation.

## Concrete verification

Use actual Rust interleavings for registration replacement and contract outcomes. In the real
purchase service/transport tests, independently vary receiver acceptance, token resolution,
receipt success, identity and finality; a positive event paired with failed resolution must not
say funds returned. Exercise concurrent identical and different intents, reopen/crash after wallet
request, stale lower-sequence reads, same sequence in a replacement registration, and changed
contract layout. Keep exact values and old uncertainty rather than forcing success for the UI.

## Independent resolver probe — 18:41 Pacific

Added `server/test/astra-purchase-resolution-review.test.ts`, calling the actual exported
`resolveFromTx` with synthetic RPC envelopes; no signing, keys, network or production edits.
Targeted Vitest run exited1: positive successful-purchase control passed, four negatives failed.
The actual resolver confirmed an optimistic (not FINAL) answer, confirmed a matching event in a
failed receiver receipt, declared returned funds despite failed token resolution, and confirmed
an event in a receipt disconnected from the transaction outcome graph. These are observations
of the in-progress implementation, not a claim about a shipped release or live chain.

Correct the resolver and preserve meaningful positive controls. The registration, unknown-payment
abandonment and quote-version concerns above still require their own evidence; this probe does
not establish those. Required `npm run check` (exec10046) exited1: types passed,
1342 tests passed,1 skipped,4 failed (the four resolver reproductions). Lint had one warning in
Claude's in-progress production resolver plus three non-null-assertion warnings in Astra's test.
Astra replaced those test assertions with an explicit fixture guard; the exact test file's
Biome check is now clean. No production correction or passing full-check claim yet.

## Independent unanswered-payment recovery probe — 18:44 Pacific

Added `server/test/astra-purchase-recovery-review.test.ts` through actual purchase routes and the
existing fictional chain double. Fresh Dana creates a shell, reviews/stores100 units, marks the
wallet requested, and checks while the observed sequence is still0. Both targeted tests fail:

- After abandon, the original payment is synthetically included and its exact hash supplied to
  check. The API leaves it terminal `abandoned` rather than recovering the confirmed purchase.
- After abandon with that original still unanswered, another reviewed purchase is accepted201
  instead of retaining the unresolved original and refusing replacement409.

This reproduces the unsafe recovery behavior at the actual API boundary. It does not prove a
live-chain double spend or exercise actual token refund mechanics. Keep the original trackable;
do not use a current lower sequence as cancellation proof. Preserve a separate proven-never-sent
preparation cancellation if appropriate, with the wallet-request boundary durable first.
Exact-file Biome clean. The targeted run exited1 with2 failures. Updated required full check24559
exited1: types passed, one in-progress production lint warning,1359 tests passed/1 skipped/6 failed.
The failures are exactly the4 resolver and2 recovery reproductions; no acceptance claim.

## Independent purchase-consent probe — 18:47 Pacific

Added `server/test/astra-purchase-consent-review.test.ts`: actual PurchaseFlow with actual routes,
an intercepted create response and a recording synthetic wallet (no signing or network). The
unchanged positive control asks for exactly the reviewed call. Three negatives fail: changing the
returned token recipient, changing the attached deposit from1 to10^24 yocto, or returning a
different customer still reaches the wallet. The review was captured before changing the response.
Targeted result1 pass/3 failures; own optional-chain lint warning corrected before full check.
The subsequent full check stopped at types while implementation was changing: the new required
`PurchaseRow.asks` field was absent from Astra's fixture, and Claude's purchase-flow test had an
invalid `never` cast. Astra aligned its fixture with one wallet ask (`asks:1`); Claude owns the
other file. That interrupted check is not a test-suite result or passing validation.
After aligning the fixture, the three independent review files ran together at18:48:2 positive
controls passed and9 negatives failed (4 resolution,2 recovery,3 consent); exact-file lint clean
for the changed resolver/consent tests. Do not rerun an unchanged broad suite until corrections
or the handoff justify it. Production remains Claude's sole writer scope.

Require immutable reviewed identity and complete call comparison after create and immediately
before wallet dispatch; reject/renew review on changed answers. This is a local consent-boundary
finding, not evidence of an actual malicious server or real transaction.

## Contract progress observed during Claude's active job

Claude added optional `Buy.reg_id`, rejecting a mismatched current registration, plus
`get_purchase_terms(customer)` with version1, exact shell bytes/byte cost and registration-binding
capability. The Rust fixture now compares the view to measured storage growth, shows a guarded
old-registration buy returned, the current-registration buy accepted, and the legacy unguarded
form accepted after replacement. Source inspected; Claude's recorded tool outputs show the
targeted fixture test1/1 and complete contract suite74/74 passing. This is observed builder-run
evidence, not an independently rerun suite or live deployment. Still inspect strict client use
of this capability/no silent legacy fallback and complete the outstanding resolver/UI gates.

## Independent late-wallet regression — 18:54 Pacific

Extended the recovery test with a pending wallet ask,100000 synthetic blocks passing before
approval, then the same reviewed call accepted under the current contract rules. The intermediate
check incorrectly labels the purchase `not_accepted`; the receipt supplied afterward remains
behind that terminal decision. The ask's block does not identify the transaction a wallet may
create later. This is a route/chain-double reproduction, not a real chain timing experiment.
The official [transaction anatomy documentation](https://docs.near.org/protocol/transactions/transaction-anatomy)
identifies the transaction's own recent BlockHash as its validity anchor. Applying that to the
controller is an inference: an earlier application-side wallet-ask height does not establish
which block the wallet eventually chose. No particular wallet delay behavior was live-tested.
The [nearcore receipt-congestion guide](https://near.github.io/nearcore/architecture/how/receipt-congestion.html)
also describes accepted transactions producing work that continues through queued receipts.
This independently supports separating transaction admission from completion of its receipt graph;
the application has not established any receipt-completion deadline from its requested_height.

Combined review files now show10 passes/2 failures: the4 resolver cases and original2 recovery
cases pass; new late-wallet case fails, and the consent positive control fails while browser
registration-bound calls are still being updated. Do not count the three negative consent passes
as proof while the positive control cannot send. Exact recovery-file lint clean. Required full
check then stopped at Claude's in-progress purchase-flow formatting (five warnings elsewhere),
before typecheck/tests; no passing full-check claim. Await corrected implementation before repeat.

## Independent correction checkpoint — 18:56 Pacific

After Claude's changes, all three Astra review files pass:12/12, including positive consent and
resolver controls and the delayed-wallet test. The unsafe height-expiry closure was removed.
This narrowly verifies those reproductions; registration-replacement/history semantics, schema
migration, full configured/harness behavior, complete checks and actual browser review remain.
Do not infer the whole feature or any milestone is accepted from this targeted pass.

## Actual earlier-schema recovery regression — 18:58 Pacific

`astra-purchase-migration-review.test.ts` reconstructs the exact table/index from committed
e6375d2 in disposable in-memory SQLite, preserving one fictional unknown purchase and its terms.
Constructing current CustomerPurchases then recording its newly available transaction hash fails
with `no such column: asks`. CREATE TABLE IF NOT EXISTS does not upgrade the existing records.
Targeted test1 failure; no user/runtime database opened. Add a transactional idempotent migration
covering the old state constraint and fields, preserving every intent/term/hash/evidence. Unknown
historical ask counts are not proof of zero or exactly one attempt; do not grant fresh-payment or
full-refund certainty from a default counter. Preserve previously abandoned uncertainty too.

This adds an independent migration test to the changed-file list. Required full check exited1
at two formatting errors in Claude-owned in-progress purchase-flow/purchase builder tests, with
three warnings; types/tests did not run in that command. The targeted migration failure remains
the current evidence. Do not modify Claude's active files to clear transient formatting.

At19:00, after9138fe1, all four independent review files pass13/13 including migration. This
supersedes the targeted migration failure above. Full checks/build and actual UI remain pending;
inspect migration's treatment of unknown historical asks and abandoned rows as part of handoff.

At19:02 the migration source review found an unresolved legacy row deliberately excluded from
fresh-purchase blocking. Added a real-route test using the migration's documented
`legacy_abandoned`/asks2 output as fixture input: a replacement is accepted201, expected409.
The migration test file now1 pass/1 failure, exact-file lint clean. Do not preserve the old unsafe
permission to pay again merely because it was previously allowed. Multiple legacy rows may
coexist; retain them and expose their recovery, with an application-level gate if the one-open
unique index cannot include them. Old unguarded calls may also outlive a registration replacement.
The earlier13/13 report remains historical before this added case. Required full check again
stopped before types/tests at the same two Claude-owned in-progress formatting errors and three
warnings; no passing full-suite result. Do not repeat until implementation/checkpoint changes.

At19:04, completing requirement3's exact-evidence review added three resolver regressions:
transaction_outcome.id from a different transaction, changed gas on the call, and contradictory
top-level Failure with otherwise successful child receipts. All incorrectly return confirmed.
Resolver file now5 pass/3 fail, including its unchanged positive control; exact-file lint clean.
Validate root identity/status and the complete reviewed call, not just the linked child event.
These synthetic malformed-response probes do not assert a live node emitted such a response.
Required full check stopped at3 formatting errors/3 warnings/2 informational notices in active
Claude work (including the page-test debug code), before types/tests. Leave those active paths
to Claude; the resolver targeted result above is the authoritative new behavioral evidence.

At19:07 all four review files passed17/17 after the exact-call/root and legacy blocking fixes.
Completing the previously documented requirements3/7 at19:08 added two final regressions:
- status:{} (no affirmative top-level success) still confirms from child outcomes;
- an accepted original transaction cannot be recovered by its exact hash after a later injected
  null-entitlement reading made the record terminal not_accepted.
The second test injects a later read observation; it does not claim to execute consumption and
unregister. Source unregister permits the customer to remove a fully emptied entitlement, so
current absence is not historical nonacceptance proof. Actual Rust lifecycle evidence remains a
separate builder responsibility if claiming that interleaving is covered.
These two files show11 pass/2 fail; exact-file lint clean. The earlier17/17 predates the two added
cases. Require affirmative consistent success and keep historical payment recovery possible.
Required independent check11807 exited1:lint/types clean,1388 tests passed/1 skipped/2 failed,
exactly these two new cases. Claude's reported earlier clean1388+1skip run predates them; it
does not supersede this check. No additional scope or live transaction introduced.

While waiting on the sole builder, Astra corrected stale dispatch wording in the already queued
002f1 brief (it still named001k as active and said its existing JOBS row was not registered).
Its worker gates and authorization remain unchanged; it is not dispatched and the worker stays
disabled. Include that documentation-only correction in the next safe review/commit handoff.

Changed this review, FreshCustomerPlanning pointer, independent resolver/recovery/consent tests and ignoredBUILD_STATE.
INDEX registration waits for the safe003web handoff. Claude owns production correction and commits.
