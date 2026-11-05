# 003w-d Customer chain writer: report

Job: `docs/astra/jobs/2026-11-04_003wd_customer-chain-writer.md`.

**Commits:**
- `9aad6f1`: Astra's six dispatch paths, committed after the check passed (1235 passed and 1
  skipped).
- `43a823a`: Astra's CompositionFirstSliceReview update and CustomerWriterReview, with INDEX.
- `77a272a`: the modal correction.
- `99cba15`: the writer, the interface change, configuration, tests and APPLICATION_COMPOSITION §8.

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

## 2. The writer: design first (APPLICATION_COMPOSITION §8)

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

- **Fresh nonce.** Only allowed when those exact bytes' **first** broadcast was refused at
  admission for a used nonce or an expired block hash.
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

## 4. Evidence

**`server/test/customerWriter.test.ts`, 17 tests.** A synthetic JSON-RPC testnet independently
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
- **`npm run check`:** exit 0, lint and types clean. 1259 passed and 1 skipped (1260), across 130
  passed and 1 skipped files.
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
- **`needs_reconciliation` has no operator UI or procedure yet.** The customer-use readback still
  decides the request, and maxSubmissions bounds resends. That procedure belongs in 003w-f.
- **003w-e** (wallet NEP-413 sign-in in the browser; device use-key authorization) is next. Astra's
  `jobs/2026-11-04_003we_wallet-and-customer-authorization.md` brief is present and left
  uncommitted for its own dispatch.
- **Unchanged gates.** The worker stays off (002f partial, 002f1 queued). 004b, 005c, 005d, 006a and
  all of M6 are retained.
- **Launcher.** Replacing the double-click launcher with the composed preview remains a routine
  follow-up once it covers the useful legacy workflow (CompositionFirstSliceReview).
