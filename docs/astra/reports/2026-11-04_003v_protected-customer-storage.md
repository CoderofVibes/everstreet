# 003v Protected customer storage: report

Job: `docs/astra/jobs/2026-11-04_003v_protected-customer-storage.md`.

**Commits:**
- `bc49b5c`: Astra's five dispatch paths, committed after `npm run check` passed.
- `e50d34e`: the design (`docs/design/PROTECTED_STORAGE.md`, with a pointer from
  CUSTOMER_USE_RUNTIME).
- `da404a0`: the adapter, the callers and the tests.

**Status: in review.** This is one real adapter. It is not wired in `main`, and there is no
production key, live NEAR or provider evidence, or full M3.

## What exists now

**`server/src/protectedStore.ts`: `ProtectedStore implements InputProtection`.**
- **Encryption.** AES-256-GCM from `node:crypto`, with a random 12-byte IV and a fixed 16-byte tag
  (`authTagLength` on both sides). The AAD is `[label, scheme, key_id, ref, kind, person_id,
  request_id]`, rebuilt from the CALLER's context on every read. Unauthenticated output is
  zero-filled and never returned.
- **Storage.** Its own SQLite file in an operator-given existing absolute directory; neither the
  directory nor the file may be a link. `STRICT` tables, size checks, `UNIQUE(key_id, iv)`. A
  rollback journal, `synchronous=FULL`, `secure_delete=ON`.
- **Keys.** Injected only: no default and no generation. Refused: aliasing, constant
  placeholders, wrong sizes and an unknown active id. Each key id is pinned by an HMAC check
  value, so a wrong key under a known id is never used.
- **Rotation.** New objects use the active key, and older ones stay readable under their own id.
  Nothing is rewritten. A missing key gives an honest `key_missing`.
- **Bounds.** 256 KiB per object, 100,000 objects, 512 MiB in total.
- **Admission.** One `BEGIN IMMEDIATE` transaction (see Astra's findings below).
- **Configuration.** One path, `protectedStoreFromConfig`, with placeholder text refused. It reads
  no files, environment or secrets, and nothing calls it.

**The `InputProtection` interface evolved deliberately.** `load(ref, ctx)` and `delete(ref, ctx)`
take the expected `{ person_id, request_id, kind }`, plus optional `list` and `readiness`. The test
double `SyntheticProtection` stays test-only and now enforces the same context rule.

**Every caller in `customerUse.ts` takes its context from the persisted `customer_requests`
row.** That row names the customer person, which never changes, so a sale changes nothing:
- `protectInput`, including its losing concurrent copy;
- protected-input execution;
- `keepResult`, including the late-copy cleanup;
- `result`;
- batch `expireResults` and `expireInputs` (queries now join `person_id`; batch result deletion is
  now also fenced on `result_ref`);
- single-item `deleteResult` and `deleteInput`.

**The publication gap** (design §5):
- **Windows.** Each kind has an explicit publication window that only ever closes. The input CAS
  now also requires an open request and no earlier deletion.
- **Sweep.** `sweepProtected` (maintenance phase `orphans`) deletes an unreferenced copy only once
  its window is closed. It never uses age or process assumptions, so a slow writer is safe.
  Anomalies (a context that disagrees, or a reference held by ANOTHER row) are kept and counted.
- **Behavior change.** An input deleted by retention is no longer re-protected by a same-key
  retry.

**Readiness.** The owner's readiness item is unavailable when the active key is wrong. When an
older key is missing or wrong, it says that kept documents can't be read and names the operator
action. It never shows a key, key id or reference.

## Astra's in-progress findings (`2026-11-04_ProtectedStorageImplementationReview.md`): all corrected

1. **Capacity admission raced across connections.** Reproduced first, with my own regression: two
   worker threads, each on its own real connection, a barrier outside the critical section, and a
   150 ms test-only hold after the capacity read.
   - **Before:** both stored, for both the object-count and the byte ceiling (2 failures).
   - **After** (`BEGIN IMMEDIATE` before the read): exactly one is stored and readable, and the
     other gets `store_full`.
2. **The restart test's original handle was left open, and cleanup errors were swallowed.**
   - The test now captures the original store and closes it BEFORE reopening, so it is a real
     restart, and asserts it is closed.
   - Closers are idempotent, and any cleanup failure now fails the test.
   - **Six stale temporary directories** from my runs before this fix had been left in `%TEMP%`
     (fictional `app.db` files only). I removed exactly those six. Runs after the fix, including
     the full check, left none.
3. **Readiness hid missing historical keys.** Fixed as above. A route test covers a missing older
   key, a wrong older key with a valid active key, and restoration.

## Evidence (real crypto, temporary files, ephemeral random keys, fictional canaries)

**`server/test/protected-store.test.ts`, 12 tests:**
- round trip, with the store file free of the canary and of the key (raw, hex and base64);
- restart with the right, wrong and missing key;
- rotation without rewriting;
- unsafe key configurations refused;
- tampered ciphertext, tag, IV and key id, and a moved envelope;
- a swapped reference, including relabelled rows (`authentication_failed`);
- the bounds;
- 200 concurrent writes with distinct IVs and ciphertexts;
- idempotent, confirmed deletion;
- the configuration parser;
- two-connection admission for both ceilings.

**`server/test/customer-protected-store.test.ts`, 10 tests, real app routes, only the protection
seam real:**
- prepare → execute → result → retention, with no canary or key at rest and nothing in app
  records;
- a full restart of the app DB (original connection closed) and the store;
- wrong, missing and pinned keys, and rotation;
- readiness disclosure and clearing;
- swapped references across customers (results, input execution, maintenance deletion, then the
  sweep, with the anomalies kept);
- a sale (customer 200, buyer and former owner 404, deletion afterwards with the customer's
  context);
- a late result copy whose delete fails, then removed by the sweep;
- the publication gap (kept while publishable, removed after the retry publishes, then retention);
- a failed retention delete, retried;
- a full store (not delivered, exactly one provider call);
- the supervisor's orphan phase.

**Unchanged existing suites.** The customer, unit, maintenance and freshness suites pass. One
schedule test now counts LIVE timers, because the new phase's operation deadline is always cleared;
its "no schedule re-armed" intent is kept.

**Checks:**
- **`npm run check`:** exit 0, lint and types clean, 1181 passed and 1 skipped (1182), across 124
  passed and 1 skipped files.
- **`npm run web:build`:** 871.93 kB, unchanged.

**Not evidence of:**
- live NEAR or the model provider (the chain and the extractor are still the labelled doubles);
- production sign-in;
- `main` wiring;
- a multi-process deployment (admission is tested across threads on separate connections, not
  processes).

## Limits, honestly (design §1, §6, §8)

- **It is encryption at rest.** The authorized runtime and the provider see the plaintext, and a
  compromised process holding the keys reads everything. It is not end-to-end encryption.
- **Deletion is logical.** Copies may survive in free space, flash, snapshots and backups. It is
  not a secure wipe.
- **Metadata stays visible.** Sizes, counts and the person and request ids in the store's rows are
  not hidden.
- **Key loss is data loss.** There is no KMS, escrow, provisioning, or backup and restore tooling.
  The operator must keep every key id that backed-up objects use.
- **Known costs.**
  - Each write counts the table.
  - The sweep's anomaly check scans `customer_requests` (bounded to 25 per pass).
  - The sweep's scan position is per process (a restart starts from the beginning, which is safe).

All six milestones remain open, as do 001k, 003w, 004b, 005c, 005d and 006a; I did not start any
of them. Astra's newer files are untouched and uncommitted:
- `ApplicationIdentityBoundaryReview`;
- `ProtectedStorageImplementationReview`;
- `WorkerHostSetupProposal`;
- the `INDEX` edit;
- the `003w` brief edit.
