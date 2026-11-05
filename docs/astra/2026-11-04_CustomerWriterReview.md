# Customer writer: unknown outcome must remain unknown

In-progress003wd review, not final acceptance. Tony's continuity promise requires one durable
customer operation to survive outages without inventing success or a new charge attempt.

## Reproduced through the actual writer, no signing or network

The initial customerWriter.ts `resolve` marks a signed attempt invalid and permits a fresh
attempt after either (a) status not_found followed by an InvalidNonce rebroadcast, or (b)
status not_found and height greater than stored height+86400. Neither observation proves the
earlier transaction did not execute. Expiration excludes future inclusion, not past inclusion;
a used nonce can belong to that very transaction. A missing status can reflect unavailable
history. Existing contract idempotency/readback does not justify manufacturing this proof.

Astra exercised public openHold with an in-memory real schema and a seeded pending attempt,
exact matching payload digest, synthetic TxRpc and a fake key whose sign method THROWS. The
stored wire placeholder was not a signed transaction. accessKey returned null, deliberately
stopping before any signing; its call count detects the fresh-attempt branch. Results:

```
invalid_nonce: persisted=invalid, freshAttemptReads=1, syntheticRebroadcasts=1
expired_not_found: persisted=invalid, freshAttemptReads=1, syntheticRebroadcasts=0
actualSignatures=0, networkCalls=0 (both)
```

Recipe: insert operation probe-request|open_hold at attempt1/state signed/block_height1;
digest exact {method,receiver,args}; txStatus returns not_found. In the first case latestBlock
height2 and sendTx returns invalid/nonce. In the second latestBlock height100000. In both,
accessKey increments a counter and returns null. openHold reaches fresh key lookup and returns
refused instead of preserving uncertainty. No ephemeral or real signing was performed.

Correct the durable semantics and add meaningful regressions before acceptance. If allowing a
new attempt after a proven rejection, distinguish an original never-admitted rejection from
an earlier unknown attempt, and require evidence sufficient for that exact operation. Do not
treat all INVALID_TRANSACTION errors as that evidence. Parent003w still requires restart and
real-caller tests; do not solve uncertainty by relabelling the customer request completed.

## Source review requirements

- outcomeOf currently accepts SuccessReceiptId and ignores final_execution_status, transaction
  identity and the returned transaction hash. sendTx/txStatus ask EXECUTED_OPTIMISTIC but the
  comment calls the answer final. Validate exact response identity and the required finality;
  incomplete, unrelated or optimistic answers must not become durable final success/failure.
  These are source observations, not yet independent transport reproductions.
  Follow-up: Astra now reproduced this through actual TestnetTxTransport.txStatus with an
  injected fetch (zero network): matching JSON-RPC request id, but result has
  final_execution_status NONE, transaction.hash WRONG_TRANSACTION and status.SuccessReceiptId.
  Request was for EXPECTED_TRANSACTION. Adapter returned {kind:success}. This independently
  confirms both an incomplete and mismatched reply are accepted by the current parser.
- Persisted attempt lookup uses operation+method but not signer/key. On changed operator/key
  configuration, check stored signer/key before querying under the new sender or broadcasting
  old signed bytes. Record what may be recovered versus requires explicit reconciliation.
- The new custom Borsh codec should have independent compatibility evidence against the actual
  pinned SDK, or use its codec. Do not postpone wire verification to a future live rehearsal.
  Package.json pins7.3.1. Astra import-only inspection confirms root near-api-js exports
  Transaction,createTransaction,encodeTransaction,decodeTransaction,SignedTransaction,
  KeyPairSigner and actions. Import near-api-js/transactions fails ERR_PACKAGE_PATH_NOT_EXPORTED.
  No dependency directory was read. Generated docs drift between versions, so use the pinned
  runtime API as the compatibility reference:
  [official Transaction docs](https://near.github.io/near-api-js/classes/transactions_schema.Transaction.html)
  expose encode/decode, but the page opened as7.4.0; the
  [Signer docs](https://near.github.io/near-api-js/classes/signers_signer.Signer.html)
  opened as7.2.0. These are API orientation, not proof of7.3.1 wire equality.
  Follow-up: import-only/serialization-only Astra probe now confirms one unsigned FunctionCall
  fixture matches the installed SDK byte-for-byte (182bytes,nonzero block hash,nonce41,Unicode
  JSON argument,100Tgas,zero deposit). It calls root Transaction/PublicKey/actions and compares
  sdk.encode() to this module's encodeTransaction. No keys generated, signatures or network.
  This is positive evidence for that codec case; put representative SDK interoperability
  assertions in the maintained tests rather than relying solely on the matching handwritten
  decoder. The result does not resolve the submission/outcome defects above.
- Preserve design-first documentation and actual supported behavior. The initial module points
  to APPLICATION_COMPOSITION section8, which does not yet exist at this review point. Complete
  the operation/nonce/rejection/crash design and test it; do not claim written evidence early.
- Current test heading says "a new process's connection each time", but the tests create new
  connections in the same process and keep old connections alive until afterEach. Describe that
  evidence accurately; actual process restart remains an explicit integration requirement.

Astra changed only this review, INDEX and ignored BUILD_STATE. Claude remains sole37509 writer.
No host/model/wallet/chain operation, research reading, publishing or scope change.

Required check16899 during implementation passed1251 tests+1Linuxskip,lint/types clean. It does
not invalidate the above independent counterexamples and is not final003wd acceptance.

## Independent repeat during correction

After Claude changed the implementation, Astra repeated the same seeded-pending public-call
cases and actual transport probe: both pending cases now return unknown, remain signed and
perform zero fresh-attempt reads; the unrelated/incomplete response now returns unknown. The
invalid-nonce case rebroadcasts only the original dummy bytes once; expired case sends nothing.
Again no signatures or network. Fullcheck11737 during this edit passed lint/types but failed
eight old writer tests (1246pass+1skip); their synthetic outcomes/expiry expectations had not yet
been updated. Require final checks after the corrections and new regressions, not this interimrun.

While37509 remains sole writer, Astra prepared queued003we_wallet-and-customer-authorization.md
from actual identity/authorizer/contract source. It preserves real wallet sign-in, exact callback
binding, separate customer device-use authority, registration/revocation/recovery and fresh-
customer prerequisites. It is not dispatched; register its JOBS row at the safe handoff after
003wd acceptance, as JOBS remains Claude-owned. No account or wallet operation was performed.
