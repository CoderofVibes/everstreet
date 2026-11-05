# 003w-d Customer chain writer: report

Job: `docs/astra/jobs/2026-11-04_003wd_customer-chain-writer.md`.

**Commits:**
- `9aad6f1`: Astra's six dispatch paths, committed after the check passed (1235 passed and 1
  skipped).
- `43a823a`: Astra's CompositionFirstSliceReview update and CustomerWriterReview, with INDEX.
- `77a272a`: the modal correction.
- `99cba15`: the writer, the interface change, configuration, tests and APPLICATION_COMPOSITION §8.
- `0a80cef`: Astra's overlap appendix, the queued 003we row and its brief (003we is not dispatched).
- `47649b7`: the overlap correction (§3a).
- `0a3f01c`: this report and JOBS for §3a.
- `a6b4343`: Astra's "Overlap correction repeat and actual old-schema migration" appendix,
  committed after the check passed (1261 passed and 1 skipped).
- `373a17c`: the upgrade correction (§3b), its regressions and design §8.

**Status: in review.** The 003w parent stays **partial**: 003w-e (wallet and device use key) and
003w-f (the integrated 100/20/80 restart journey and the rehearsal packet) are required next.

## 1. Modal correction (the first a/b/c fix)

Astra's actual browser finding:
- focus stayed on the background "Sign in or join" button;
- Tab reached Home;
- Escape did nothing.

Both sign-in dialogs now use `Modal`, with the rules in `web/src/modal.ts`:
- **open:** focus moves to the marked control ("Not now", or the name field in preview);
- **Tab and Shift+Tab:** wrap at the edges, and stray focus is brought back inside;
- **Escape:** closes;
- **on close:** focus returns to the opener.

Preview sign-in behaviour is otherwise unchanged. `web/test/modal.test.tsx` tests the pure key
rules, including the exact reproduced case, and the rendered initial-focus target. There is no DOM
test environment. Astra's mounted browser repeat (CompositionFirstSliceReview, preview 94285)
confirmed it.

## 2. The writer (APPLICATION_COMPOSITION §8)

Honest order: the callers and contract methods below were read before coding, but §8 itself was
appended after the first module and then corrected three times, after Astra's counterexamples
(§3, §3a and §3b). It describes the final behaviour.

**Callers read.**
- `CustomerUses.submit` and the unit step mark intent "unknown" under their lease, and treat the
  writer's answer as an event. Exact readback decides.
- They resend the **identical payload**, bounded by `maxSubmissions`, while readback shows it not
  yet done.

So durable identity belongs in the writer. `CustomerChainWriter` calls now carry `operation` (the
request id), and both callers pass it.

**Contract methods read** (`contracts/business-v3/src/lib.rs`):
- `open_hold(customer, plan_id, auth{hold_seq, units, serve_until_ms U64, key_slot, key_epoch}, sig)`;
- `settle_hold(customer, plan_id, hold_seq, uses[{slot, fingerprint, sig}], close)`;
- `release_hold_for(customer, plan_id, reg_id U64, hold_seq)`, which checks the registration.

None is payable, so the deposit is 0 and gas is 100 Tgas. There is no unguarded release.

**Durable protocol.**
- **One attempt row per transaction** (`chain_tx_attempts`), written before broadcast. Its nonce is
  allocated under `BEGIN IMMEDIATE` with the per-key `chain_tx_nonces`, and `(signer, key, nonce)`
  is unique.
- **Repeats:**

  | The newest attempt | What a repeat does |
  |---|---|
  | `success` | Answers `already`. |
  | `failure` | Answers `refused` with its `E_` code. |
  | `signed` | Reads its own **FINAL** status by hash, or rebroadcasts the **same bytes** while valid. Otherwise it **stays unknown** (`needs_reconciliation` after the validity window). |

- **Fresh nonce.** Only allowed when a used-nonce or expired-hash admission refusal reached the
  **sole** sender of those bytes. Every send is durably claimed first (`broadcasts`), and `invalid`
  is a compare-and-set requiring a counted row with `broadcasts = 1` (§3a, §3b). Every attempt
  of the operation must be such a counted `invalid`.
- **Refusals before effects:**
  - a changed payload: `E_PAYLOAD_MISMATCH`;
  - a changed signer or key: `E_SIGNER_CHANGED`;
  - a key that can't call the method: `E_SIGNER_KEY`.
- **Outcomes** need `final_execution_status: FINAL` and the exact transaction hash.

## 3. Astra's CustomerWriterReview: all four corrected

1. **Unknown stays unknown.** My first version made a fresh attempt after "not found and expired"
   and after an InvalidNonce rebroadcast; Astra reproduced both. Neither proves non-execution.
   Both now stay unknown, and the regressions include Astra's exact counterexample.
2. **Outcome parsing.** An optimistic, partial or wrong-hash answer was accepted (reproduced through
   `TestnetTxTransport.txStatus`). It is now unknown unless it is FINAL and has the exact hash,
   with `wait_until: FINAL`, and `SuccessReceiptId` is no longer success.
3. **Stored attempts under another signer or key** are refused with no reads (tested).
4. **Wire compatibility** is now evidenced against the pinned SDK, near-api-js 7.3.1, through its
   public exports only:
   - `createTransaction` plus `encodeTransaction` give byte-identical output;
   - `decodeSignedTransaction` of our signed bytes re-encodes identically.

   No package files were read.

**§8 status.** Design §8 is written and matches the code.

## 3a. The second counterexample: overlapping first broadcast (after `99cba15`)

**What Astra showed.** My "first broadcast, so nothing else had the bytes" was false: the attempt
row is visible before the first send is awaited.
1. A concurrent retry reads it, finds no status, and rebroadcasts the identical bytes.
2. Its copy lands, but its answer is lost.
3. The first send's late InvalidNonce then marked the attempt invalid, and the next call signed a
   **fresh** transaction.

**Reproduced first** through the public writer, on two independent connections with the
synthetic chain holding the first send. Before the correction the next call sent a third
transaction with a new nonce.

**Corrected:**
- Every send of an attempt's bytes, by any connection or process, first claims it durably
  (`UPDATE … SET broadcasts = broadcasts + 1 WHERE state = 'signed' RETURNING broadcasts`). A
  crash after the claim counts as a send.
- `invalid` (the only route to a fresh nonce) is a compare-and-set requiring `broadcasts = 1`, by
  the sender whose claim was that one. With another copy sent, the refusal proves nothing, and the
  attempt stays unknown.
- A sender whose claim finds a terminal state doesn't send.
- `success`, `failure` and `invalid` are written only over `signed`. A late reply answers from the
  durable state and never undoes it.

**Regressions:**
- the exact overlap (now unknown, then the landed transaction is found: one nonce, two sends of
  the same bytes);
- a late first-send InvalidNonce after a success recorded meanwhile (the success stands; no third
  send).

The earlier 17 still pass, including the sole-sender proof.

## 3b. The third counterexample: upgrading an earlier records file (after `47649b7`)

**What Astra showed.** The upgrade added `broadcasts` with `DEFAULT 0`, so a pending row that an
earlier writer may already have sent looked never sent. Astra made an actual old-schema file,
closed it, reopened it through `openDb` and called `openHold` twice (status not found, then
InvalidNonce). The result was `migratedBroadcasts=0`, `persisted=invalid` and
`freshAttemptReads=1`.

**Reproduced first.** I used a temporary probe, deleted afterwards, against the committed
`47649b7` writer and migration. It had the 99cba15 table with one pending row and placeholder
bytes, an ephemeral key whose `sign` throws, and a synthetic RPC that returns `null` for the
access key.
- **Before:** `migratedBroadcasts 0`, the first answer `invalid_nonce`, the second answer reached
  the fresh path (`E_SIGNER_KEY`), `persisted invalid`, `freshAttemptReads 1`, `signatures 0`.
- **After the fix, the same probe:** `history uncounted`, both answers `invalid_unproven`,
  `persisted signed`, `freshAttemptReads 0`, `signatures 0`. Its own placeholder bytes were sent
  twice.

**The upgrade policy** (in `db.ts` and design §8). It runs once, in one write transaction.
- **Every row present at the upgrade becomes `uncounted`.** Its count never proves a sole
  sender. It is still resolved by its own status and its own bytes, never by a fresh
  transaction. The writer's own new rows are `counted`.
- **Every `invalid` row present is flagged `reconcile = legacy_invalid`.** The old
  classification may come from the reproduced unsafe exception, so it is kept, with its code, but
  not trusted.
  - A flagged row sends nothing. Only its own exact FINAL status resolves it, and success or
    failure is then recorded and the flag cleared.
  - Otherwise it answers `unknown: needs_reconciliation`.
  - It blocks fresh attempts for its operation, and stays flagged for the operator even when a
    later attempt resolves.
  - Nothing is silently marked complete.
- **Recorded `success` and `failure` stand.** Every committed writer recorded them only from a
  FINAL status for the exact hash.
- **It is conservative.** A 47649b7 file whose rows really were counted from creation is still
  treated as uncounted. No deployed records file exists.

**In the writer:**
- the `invalid` compare-and-set requires `history = 'counted'` and `broadcasts = 1`;
- a fresh attempt requires every attempt of the operation to be a counted `invalid`, which is
  re-checked under `BEGIN IMMEDIATE`.

**Regressions.** All five use actual earlier files: really signed rows rewritten into the 99cba15
and 47649b7 schemas, closed, then reopened through `openDb`.
1. **A pending old row, for each schema.**
   - A used nonce plus a missing status stays `signed` and unknown. There is no fresh read, and
     only its own bytes are sent.
   - It is found once it has landed.
   - A new row in the same upgraded file keeps the sole-sender proof.
   - Reopening doesn't upgrade again.
2. **An old `invalid` row.**
   - It is flagged, sends nothing and reads only its own status (`tx` twice), answering
     `needs_reconciliation`.
   - It is corrected to `success` when its FINAL status shows it executed, then answers `already`.
3. **A later attempt behind an old `invalid` one.** The later attempt resolves by its own bytes,
   and the old one stays flagged.
4. **Old success and failure** answer with no RPC at all.

**Mutation checks** (temporary, reverted):
- dropping the `counted` guard from the compare-and-set fails both pending-row regressions;
- making the fresh-attempt check always true fails the old-`invalid` regression.

All the earlier overlap, finality, signer-mismatch and sole-sender tests pass unchanged.

## 4. Evidence

**`server/test/customerWriter.test.ts`, 24 tests** (17, plus the two overlap regressions, plus
the five upgrade regressions in §3b). A synthetic JSON-RPC testnet independently
decodes Borsh, verifies the ed25519 signature, and checks the nonce and inclusion. Keys are newly
generated; the database is disposable, over separate connections.
- **Exact transactions:**
  - exact serialization and signing for all three methods, with exact arguments;
  - only the allowlisted RPC methods are used;
  - bad network, account, signature, operation and key permission are refused before any read or
    signature;
  - failed reads persist nothing.
- **Durable identity:**
  - a duplicate gives `already`, with one send;
  - a payload mismatch is refused;
  - **negative control:** deleting the durable record makes the same operation send twice, so the
    duplicate assertions detect double dispatch;
  - concurrent same-operation calls on two connections give one transaction; different operations
    get distinct nonces;
  - a contract refusal is final and gives no resend.
- **Crash and unknown boundaries:**
  - a crash after persist, before broadcast: the restart sends the same bytes exactly once;
  - landed but unanswered: the restart reads the status, with no resend;
  - dropped, then expired: the same hash while valid, then it stays unknown, never a fresh
    transaction;
  - Astra's rebroadcast-InvalidNonce counterexample stays unknown;
  - a first-broadcast InvalidNonce leads to a fresh nonce;
  - optimistic and wrong-hash replies are never recorded;
  - a signer change is refused.
- **SDK byte compatibility**, and **operator key** validation (the secret never in JSON).

**`server/test/composition.test.ts` (+3).**
- An explicit key file for the metering account turns the writer on, with provenance "synthetic RPC
  (test)". Status carries no key or path.
- A key file for another account fails composition, and the unwind frees the database file.
- A writer is refused outside configured mode.

**Checks:**
- **`npm run check`** (final, at `373a17c`'s content): exit 0, lint (367 files) and types clean.
  1266 passed and 1 skipped (1267), across 130 passed and 1 skipped files.
- **`npm run web:build`:** 886.08 kB JS, 72.52 kB CSS.

**Nothing live.** There was no live endpoint, wallet, existing key, credential, `.env`, runtime
database, model, worker host or legacy `main`. Temporary test directories were cleaned up by the
tests (checked).

## 5. Remaining gaps (stated, not hidden)

- **Not yet proven:**
  - separate **processes** racing for nonces (separate connections in one process are tested);
  - the writer driven through `CustomerUses` routes against a coherent synthetic chain, with a
    restart;
  - real endpoint behaviour (the validity window and the error causes `UNKNOWN_TRANSACTION`,
    `INVALID_TRANSACTION` and `TIMEOUT_ERROR`).

  These belong to **003w-f** and its testnet rehearsal packet, which is prepared, never run, by
  this job.
- **`needs_reconciliation` and `legacy_invalid` have no operator UI or procedure yet.** The
  customer-use readback still decides the request, and maxSubmissions bounds resends. The
  procedure belongs in 003w-f.
- **The upgrade's cross-process behaviour** is not separately tested: it runs in one `BEGIN
  IMMEDIATE` transaction at `openDb`.
- **003w-e** (wallet NEP-413 sign-in in the browser; device use-key authorization) is next. Its
  JOBS row and Astra's brief (`jobs/2026-11-04_003we_wallet-and-customer-authorization.md`) were
  committed in `0a80cef` as queued, not dispatched.
- **Unchanged gates.** The worker stays off (002f partial, 002f1 queued). 004b, 005c, 005d, 006a and
  all of M6 are retained.
- **Launcher.** Replacing the double-click launcher with the composed preview remains a routine
  follow-up once it covers the useful legacy workflow (CompositionFirstSliceReview).
