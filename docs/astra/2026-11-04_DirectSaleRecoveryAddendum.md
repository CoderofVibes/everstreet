# Read before implementing sale replacement admission

Claude:604d889 committed the latest DirectSaleDesignReview, but ec1b7f8's DIRECT_SALE.md still
contradicts its22:21 follow-up. Please read that follow-up before implementing the TypeScript
replacement/no_longer_possible paths. The two counterexamples are in existing source:

1. business-v3 unfund clears buyer_accepted without advancing the deal version. Acceptance of
   that same version can succeed again after funding again. An accepted flag is reversible.
2. test-token implements storage_unregister. Registered state is reversible; registration_only
   does not make register:token:account a lifetime at-most-once identity.

Remove replacement for those two kinds under the current methods. Original-transaction recovery
remains required. Only irreversible evidence may mark an unknown call permanently inapplicable;
acceptance may use a later version or that deal's end, but not just its accepted flag.
Registration must not use current registered state for that transition. Do not silently strand
or discard the original request/history. Other allowed replacements need the exact immutable
call/action digest, not just the shared control/payout guard identity. Keep separate results for
each transaction, including an original receipt arriving after a replacement or local reconcile.

These are already requested design corrections, not new scope. Amend the design and cover the
counterexamples with focused behavior tests as the application is built. Retain the rest of003wf2
and its full acceptance gates. No extra writer, contract feature or external action is requested.

Astra verified the source statements and observed604d889 plus the completed three-phase check
reported in the stream (1428+1skip,12,21; exit0). This note makes the outstanding corrections
visible after that checkpoint; it is not independent execution evidence or final acceptance.

## Independent encoder check

After server/src/saleTerms.ts appeared, Astra read its encoder and the corresponding Rust
digest function, then ran a finite, keyless Node/tsx check against the committed direct-sale
fixture. All34 live-deal snapshots across5 distinct deal versions produced the exact Rust
digest. Changing each snapshot's price by one base unit changed the digest. Exit0; no files,
wallets, network calls or signing used. This verifies that encoder slice against synthetic
contract evidence; it does not verify admission, recovery, receipt resolution, UI or a chain run.
The source is still being developed by Claude, and the replacement corrections above remain.

## Synthetic wallet-envelope reproduction

Astra read the new sale-chain.ts and ran a finite Node/tsx probe against its current walletCall.
Starting from startFromFixture(direct-sale.json), register buyer.near and the business in the
synthetic token ledger, give the buyer100 units, then send ft_transfer_call to the configured
token with receiver_id=business, amount="-1", deposit="1", gas="100000000000000" and
msg={fund_deal:{deal_seq:"1",version:1,price:"-1",expected_control_seq:"3"}}.
Observed: buyer balance rises by1 and the returned FINAL status is SuccessValue of JSON "0".
This is a reproduced defect in the in-progress TEST DOUBLE, not a production token vulnerability
or chain execution. A real U128 envelope cannot contain a negative amount.

Before any ledger or business mutation, validate the supported encoded envelope and numeric
domains, including canonical U128 token amount/price/deposit, U64 sequences, supported gas range
and object/method/receiver shape. Use the contract's actual
JSON integer representations rather than coercion with String/BigInt. Do not claim gas execution
is modelled; validating the envelope is separate. Malformed or unsupported calls must leave
both token and business state unchanged. Add focused negative/overflow/wrong-type/unknown-shape
tests, and keep the49-step Rust fixture replay and real customer/sale journey checks required.
Resolve this along with the recovery corrections before using the double as acceptance evidence.

Astra independently ran `npx vitest run server/test/sale-chain.test.ts` at22:32: all4 tests
passed (exit0), covering the49-step replay, starting views, digest comparisons and the existing
unsupported-call/deposit cases. The malformed negative-token probe above remains a separate
failing behavior not covered by those4 tests. A green replay is necessary but insufficient for
strict boundary correctness or the complete configured acquisition journey.

## Payout receipt return-path reproduction

The new resolveSaleTx requires the first business receipt to have SuccessValue before reaching
its claim branch. But claim_party_guarded returns start_payout's transfer(...).then(on_payout)
Promise (lib.rs:1786,2931,2960), so its returned result follows the callback receipt.
The synthetic wallet currently fabricates an immediate empty SuccessValue for that first
receipt, masking this mismatch.

Astra replayed the fixture through its first failed-transfer claim using SaleChain.walletCall,
then passed the exact claim call/review/hash to resolveSaleTx. Its current fabricated receipt
resolved confirmed/restored. Changing ONLY the first receipt's status to
SuccessReceiptId=<existing callback id>, retaining the connected receipts, matching payout
event and final false callback value, changed resolution to null. This is a finite keyless
receipt-shape reproduction, not a live-network run.

Support the actual returned-promise path for claims and make the double emit it. Validate the
referenced return receipt and graph, matching payout id/slot/amount/recipient, callback result
and final transaction result. Missing, disconnected or mismatched callbacks stay unproven;
do not turn SuccessReceiptId alone into paid. Cover paid and restored paths, pending callback,
wrong pointers, contradictory statuses and duplicate receipt ids. Preserve strict exact-call
matching and do not weaken the existing checks simply to accommodate the old double.

Primary references checked for this inference: [NEAR SDK Promise semantics](https://docs.rs/near-sdk/latest/near_sdk/struct.Promise.html)
describe forwarding a returned promise's result; the [NEAR runtime source](https://docs.rs/near-runtime/latest/src/near_runtime/lib.rs.html)
maps ReturnData::ReceiptIndex to SuccessReceiptId and returned values to SuccessValue.
The repository's actual5.29.1 contract return type and promise chain establish the relevant call
path; these references do not imply a dependency upgrade or deployment authorization.

## Wallet ask admission reproduction

Astra instantiated SaleActions with a disposable in-memory SQLite database and one synthetic
prepared register row, then called production requested(viewer,id,{}) twice. The calls returned
requested/asks1 and requested/asks2. No wallet was invoked. The current endpoint permits repeated
ask recording on the same row and exposes no single-winner admission result; the controller/UI
must not interpret both responses as permission to invoke the wallet.

Make the no-hash ask transition a conditional prepared -> requested claim, with one winner across
tabs/processes and an explicit result the controller obeys before invoking the wallet. A lost
response after that claim stays recoverable/unknown; it does not authorize another send of that
row. Recording a returned hash is separate and does not grant a fresh ask. An explicitly allowed
replacement has its own row and its own one-time ask, under the corrected identity/digest rules.
Test concurrent and repeated ask admission plus lost-response/reload behavior through the actual
controller, without conflating an incremented asks counter with duplicate-send prevention.

## Concurrent receipt lookup can overwrite a settled action's hash

Astra used production SaleActions.check with one requested synthetic registration row in an
in-memory SQLite database and two manually controlled reader.txOutcome promises. Both lookups
started while tx_hash was null. Hash B (44 copies of "3") returned an exact matching successful
FINAL envelope first: row became confirmed with B. Hash A (44 copies of "2") then returned an
exact matching failed FINAL envelope with E_ARGS. Observed final row: still confirmed with the
registered evidence from B, but tx_hash overwritten to A. Both replies were synthetic; no wallet
or network was used. This reproduces a consistency race, not an executed payment.

check's hash update currently runs unconditionally before settle's state-conditional update;
the latter prevents the late state change but does not protect the hash. Commit transaction
identity, result/evidence and state together under a current-row compare-and-set after the await.
If another check already finalized the row, return that coherent stored outcome rather than
the stale computed result. Invoke local effects only for the authoritative confirmed result,
with safe retry of an already-confirmed effect when needed. Cover both reply orders and a
cross-process race; state/identity/evidence must always describe the same accepted transaction.

## Correction verification in progress

At22:47 Astra reran the exact negative-token probe after Claude added envelope validation.
It now refuses the call and preserves both token balances (exit0). This verifies that reproduced
case only; broader malformed-input tests, payout graph, ask admission and check-CAS corrections
remain under implementation/review. The earlier fixture replay and encoder evidence still have
their stated scope. No whole-job acceptance is implied.

At22:51 Astra independently reran the production-method probes on the updated source:
requested grants only the first call (second returns already_asked; asks stays1), and the late
failed check preserves the winning confirmed hash/evidence and returns that stored resolution.
Both passed in disposable in-memory SQLite, closed afterward. The updated synthetic claim
receipts now follow the callback promise; both restored and paid resolve correctly. This is
narrow in-process verification; controller and actual-process evidence remains due.

Two follow-up receipt probes still fail the intended behavior:

- Starting from either valid paid or restored callback graph, add one distinct gas-refund child
  to the first receipt, with its outcome executed by the signer and SuccessValue="". Resolution
  becomes null because resolveClaim requires exactly two children. NEAR's runtime can add gas
  refunds to the generated receipt list, so child count is not the business's promise count.
  Preserve the unique required callback/transfer paths and permit valid extra refund receipts;
  reject ambiguous required paths instead of assuming an exact total of two. See the same
  [runtime source](https://docs.rs/near-runtime/latest/src/near_runtime/lib.rs.html):
  generate_refund_receipts appends refunds before the outcome's receipt IDs are collected.
- Starting from the valid paid graph, change ONLY the token-transfer receipt status to {}.
  It still resolves confirmed/paid because transferOk means "no Failure". Require affirmative,
  well-formed success of the expected transfer; unknown/empty/contradictory status proves no
  payout. Keep strict callback and top-level agreement. Add this exact mutation plus conflicting
  success/failure fields and malformed values to the negative graph cases.

These are independent keyless graph probes over the new code, not live RPC observations. Correct
both before accepting the claim resolver or using its browser result as payment evidence.

At22:54 Astra independently ran sale-chain.test.ts and sale-journey.test.ts together:20/20
passed, exit0. Read coverage includes malformed envelopes,49-step replay, real-route economic
continuity, reversible-state recovery, one-winner asks and both lookup-race reply orders. The
gas-refund-child and empty-transfer-status follow-up cases above are not covered by those20
tests and remain unresolved in the inspected source. This is still in-process synthetic
evidence; actual-process and browser requirements remain open.

## Independent correction and process verification — 22:59 Pacific

Astra reviewed eb25e15 and independently reran sale-chain.test.ts plus sale-journey.test.ts:
20/20 pass, exit0. The extended cases now cover both reproduced follow-ups: valid additional
refund children preserve paid/restored resolution; empty, malformed or contradictory transfer
statuses prove no payment. Source now requires affirmative statuses and unique required paths.
This narrowly resolves the two follow-up findings above; it is synthetic graph evidence only.

Astra then read caad2da and independently ran sale-process.test.ts. The first sandbox attempt
could not connect to localhost (EACCES), so it provides no behavioral result. The same bounded,
keyless tests with loopback permission passed2/2, exit0: original-transaction recovery after an
actual killed/restarted process, and two live processes admitting one action and one wallet ask.
Children and disposable files are cleaned by the harness. No external chain/provider was used.

Remaining evidence includes the requested cross-process check-result race (these two process
tests cover admission/restart, not competing lookup completion), actual controller and browser
flows, and all parent003wf acceptance requirements. The test's documented simultaneous-start
migration contention must remain an explicit outstanding limitation until reproduced/corrected
in a bounded lifecycle follow-up; sequential startup is not verification of concurrent startup.
No whole-job or milestone acceptance, and no Gated implementation dispatch, is implied.

## Follow-up recovery gap: temporary reconciliation result cached as finished

Astra's finite in-memory real-route probe at23:04 reproduced this sequence:
propose -> register buyer -> fund -> buyer accept -> seller accept (wallet reply lost), using
saleWorld and actual stored calls. Before checking the seller's exact close transaction, set only
w.v3.transport=null (transaction lookup remains available). Check confirms closed, while its local
effect returns reconcile.state=unavailable/code=no_transport. Restore the original observation
transport, then check the same action again. It returns the old unavailable effect without a new
read, and the local owner is still the seller (buyerApplied=false). SQLite closed; exit0. No real
wallet, chain or customer data involved.

Cause: effects() persists every non-error object, including reconciliation's transient unavailable
or pending result; stored() retries only if effects is null. A returned nonthrowing unavailable is
not a finished ownership transition. Preserve the confirmed transaction independently, but make
explicit Check again retry unfinished reconciliation through V3Intents and update its displayed
result. Classify terminal versus retryable effects deliberately; do not turn a failed read into a
terminal result, and do not bypass existing authority/CAS. Concurrent retry results must not let
a late unavailable response overwrite a successfully applied result. Add this exact failed-read /
restored-transport route test, plus the competing-result ordering test, before browser acceptance.
The UI should plainly distinguish confirmed on-chain close from local handover still needing a
check, with a working recovery action. The older separate reconciliation page is not a substitute
for making this wallet journey's own advertised retry work.

## Early controller review: current sale, payout evidence and account switch

Astra reviewed the in-progress saleFlow.ts before UI acceptance and ran finite probes at23:08.
These findings concern the current uncommitted controller, not a shipped or accepted interface.

1. **Historical close completes a new sale.** Through saleWorld's actual routes/calls, complete
   deal1, then have its buyer (now owner) propose deal2 to the former seller. The new live deal is
   seq2 with escrow="0", but saleSteps(currentSetup) returns done for every step, including escrow,
   both acceptances, apply and aftercare. It chooses any historical closed outcome even when a
   different live deal exists. Derive one exact current deal/version/digest context for progress,
   primary action and sentence; show earlier outcomes only as history. Cover the actual second
   proposal, revised versions and ended latest deal after an older closed deal. Preserve the
   established CurrentSaleAccepted/001i1 invariant in this new surface.

2. **Buyer view claims seller's proceeds collected without payment.** Immediately after deal1's
   close/apply, before any claim, the seller's sale_proceeds_claim is250000000. The buyer's setup
   nevertheless makes the final step "Buyer operates · proceeds collected" done: it checks the
   viewing buyer's zero claim/payouts. Zero owed to this viewer proves nothing about the seller's
   payment, and zero current claim is not evidence of a specific payout. Separate buyer operation
   from the seller's collection; only exact relevant affirmative payout evidence supports paid.
   Show unknown/not-visible where this participant has no evidence, without broadening privacy.
   Test both parties before payout, pending, restored and confirmed paid.

3. **Account switches during admission still reach send.** Use the real sale routes for buyer
   registration and the actual SaleFlow. A wallet stub reports buyer.near to accounts(); after
   the requested endpoint returns, change its selected account to stranger.near. confirm() invokes
   send(storage_deposit) with stranger.near selected. Probe only records the call; it signs/sends
   nothing. walletFor checks too early, before create/requested awaits. Revalidate the connected
   account at the send boundary and fence account changes/retirement during preparation, ask
   recovery and connection. Test delayed prepare/create/requested and actual wrapper onChange
   behavior. A late account change must never invoke the wrong participant's wallet; keep the
   original durable row recoverable and do not silently replace it. Also retain the one-invocation
   proof for new ask_id retry behavior and reviewed-call verification on resumed preparations.

All probes used disposable in-memory SQLite, closed afterward, exit0. No browser permission gate,
real wallet, network transaction or customer data was involved. Correct and add focused controller
coverage before the finite UI handoff; existing frontend work may naturally address these findings.

## Follow-up verification — 23:09 Pacific

Astra independently ran the initial sale-controller.test.ts:6/6 pass (23:06:58), exit0. These
initial cases cover ordinary close, initial account mismatch, cancelled/lost wallet response,
preview digest, lost ask response, reload and retirement. They do not yet cover every new finding.

The exact temporary-reconciliation probe now passes on the updated source: first check confirms
closed with unavailable/finished=false; restore the observation transport; the next check returns
applied/finished=true and buyerApplied=true. SQLite closed, exit0. This verifies sequential retry,
not the competing-result completion order.

The updated buyer setup now shows seller collection as unknown/not shown rather than done.
Source now derives progression from the live deal or newest ended outcome. Remaining source
concern: paidEvidence still matches ANY confirmed category2 claim in s.actions, without linking
the relevant close/claim incarnation. An older payout plus a zero current balance is not proof
that this sale's proceeds were paid. Preserve the requested exact relevant payout evidence,
including later sales by the same seller and an unconfirmed new claim; aggregate categories may
need an honest separate claim-history presentation instead of assigning payment to a sale.

An exploratory real-route round trip completed the first sale and seller collection, then the
return sale, but the third sale attempt returned read_failed on acceptance. The probe ended exit1
and closed its SQLite handle; therefore it did NOT verify the intended third-sale payout case.
Sequence: Ava sells to Noah; Ava registers/collects category2; Noah sells back to Ava; Ava proposes
to Noah, registers only if needed, funds and accepts. Investigate this with a focused fixture/
view-decoding test before claiming repeat-sale support; do not treat the incomplete probe as a
confirmed cause or final-code failure while source is still changing.
