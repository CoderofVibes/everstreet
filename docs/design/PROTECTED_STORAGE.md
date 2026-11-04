# Protected customer storage (job 003v)

Status: **one real adapter, implemented and tested locally**. It is not live, nothing in `main`
uses it, and no production key exists.

**Code:**
- `server/src/protectedStore.ts` (the adapter);
- `server/src/customerUse.ts` (the callers);
- `server/src/maintenance.ts` (the orphan phase).

**Tests:**
- `server/test/protected-store.test.ts`;
- `server/test/customer-protected-store.test.ts`.

## 1. What it is for, and what it is not

**What it does.** A customer's document (input) and result must outlive a business sale without
becoming readable by the seller or the buyer. The platform must also run the authorized service
without keeping plaintext in its ordinary records. This adapter keeps both at rest as
authenticated ciphertext in its own file. The application database holds only opaque references.

**What it protects against:**
- **A copy of the store file or its backups without the keys.** The contents are unreadable.
  Tampering with the ciphertext, the tag, the IV or the key id is detected.
- **A copy of the application database.** It holds references and hashes only, never document
  text (this predates 003v and is kept).
- **A swapped or relabelled reference.** Request B's row pointing at request A's object is
  refused, and so is a row edited to claim a different person, request or kind (§4).
- **Owners, former or new.** Every owner route still answers 404 for customer results. The
  stored context names the customer person, never an owner.

**What it does NOT protect against (said plainly):**
- **The authorized runtime sees the plaintext.** It runs on the decrypted document, and the model
  provider receives it. This is **not end-to-end encryption**.
- **A compromised platform process holding the keys can read everything.** The same goes for an
  operator with the keys.
- **Metadata is visible.** Sizes, counts, timing and the person and request identifiers in the
  store's rows are not hidden. They are needed to check context before decrypting and to sweep.
- **Deletion is logical, not a secure wipe** (§6).

## 2. The envelope (AES-256-GCM, node:crypto)

**Scheme.** `aes-256-gcm/v1` is the stable scheme and format version recorded with every
reference (`input_scheme` and `result_scheme`). Rotating keys never changes it. The key id is
separate and per object.

**Per object:**
- **`ref`:** `ps1_` plus 128 random bits in hex. It is never chosen by a caller, and it is never
  a path.
- **`iv`:** 12 bytes from `crypto.randomBytes`, so a fresh random nonce for every object.
  `UNIQUE(key_id, iv)` turns a (practically impossible) repeated nonce into a failed write, never
  a reuse.
- **`tag`:** the full 16 bytes. `authTagLength: 16` is passed to BOTH `createCipheriv` and
  `createDecipheriv`, so a truncated tag can't be accepted.
- **AAD:** the canonical JSON array `["everstreet-protected-object", scheme, key_id, ref, kind,
  person_id, request_id]`. On a read it is **rebuilt from the caller's expected context and the
  reference**, not from the row.

**Node API assumptions** (pinned runtime: `engines.node >=24`, verified on v24.22.1; see the Node
[crypto API](https://github.com/nodejs/node/blob/main/doc/api/crypto.md)):
- `setAAD` is called before `update`, and `setAuthTag` before `final`.
- `decipher.final()` throws if authentication fails.
- `decipher.update()` may return unauthenticated plaintext. The adapter returns output only after
  `final()` succeeds, and zero-fills the partial buffer otherwise.
- `randomBytes` is the CSPRNG.

**Nonce budget.** Random 96-bit IVs are safe well below 2^32 messages per key (NIST SP 800-38D).
The store holds at most 100,000 objects. Rotate the active key long before any key approaches that
budget, for example each year or each million writes.

## 3. Keys

**How keys arrive.** Keys are **injected at construction**, as `{ active, keys: { id: 32 bytes }
}`. There is one supported configuration path, `protectedStoreFromConfig`:

```json
{ "root": "/absolute/operator/dir",
  "active_key_id": "k2026a",
  "keys": { "k2026a": "<32 random bytes, base64>" } }
```

That is a placeholder, and the placeholder text is refused.

**What the adapter never does:**
- It never reads files, the environment or secrets itself.
- Nothing calls it in `main`.
- There is no default key, no generated key and no plaintext fallback.

**What it refuses:**
- a missing configuration;
- a constant key (e.g. all zero);
- a key of the wrong size;
- an active id that isn't among the keys;
- **two ids with the same bytes (aliasing)**.

**Keys are never stored.** Neither the keys nor anything they could be recovered from are kept
with the ciphertext, or anywhere else this platform writes.

**Key checks.** Per key id, the store records a check value, `HMAC-SHA256(key, fixed label)`. It
is not the key, and with a 256-bit key it gives no practical way to guess one.
- A configured key whose check differs from the first-seen value under that id is **wrong**. It is
  never used to write or read: `wrong_key`, and readiness is unavailable when it is the active
  key.
- A key id therefore names its bytes for the life of the store. A mistyped key needs a new id.

**Rotation.**
- Add the new id and make it active. New objects use it.
- Older objects stay readable under their own id. Nothing is rewritten, re-encrypted or aliased.
- Removing an id makes its objects `key_missing`: honestly unavailable. Readiness reports
  `key_missing_for_stored_objects`.
- **Key loss is data loss.** No escrow or recovery exists here; that is an operator requirement
  (§8).

## 4. Context binding (every load and delete)

**The interface.** `InputProtection` now has `load(ref, ctx)` and `delete(ref, ctx)`, where
`ctx = { person_id, request_id, kind }`. The adapter refuses (`context_mismatch`) unless the row's
stored context equals the caller's. It does this **before decrypting or deleting anything**.
Because the AAD is rebuilt from the caller's context, an attacker who edits the row's context
columns to match still gets `authentication_failed`.

**Where every caller takes its context: the persisted `customer_requests` row.** Its
`person_id` is the customer, which never changes, so a sale changes nothing here. The context
never comes from an HTTP viewer or a business owner.

| Caller | What it does |
|---|---|
| `protectInput` (prepare and same-key retry) | Protects with the request's own context. A losing concurrent copy is deleted with that context. |
| `execute` | Loads the protected input with the request's context. A mismatch is `input_unavailable`, and nothing runs. |
| `keepResult` | Protects the result with the request's context. A late copy is deleted with that context. |
| `result` | Loads with the request's context. The caller, retention and reference are rechecked after the await, as before. |
| `expireResults`, `expireInputs`, `deleteResult`, `deleteInput` | The queries now join or read `customer_requests.person_id`. Batch result deletion is now also fenced on `result_ref`. |
| `sweepProtected` | Deletes with the object's own context, after checking it against the persisted request. |

## 5. Publication protocol: the write-to-reference gap

**The gap.** `protect()` writes the object, and only then does the caller publish the reference
by a compare-and-swap in the application database. A crash, a lost reply or a lost race can
leave a stored object that nothing references. A slow writer may still be about to publish, so
an age-only sweep would be unsafe.

**The publication window.** Each kind has an explicit window, decided from persisted records
alone:
- **Input.** Open while the request is open (`prepared`, `reserve_*` or `reserved`) AND
  `input_ref IS NULL` AND `input_deleted_at IS NULL`. The publication CAS itself now requires all
  three, so a slow writer can't publish onto a terminal request or one whose input was already
  deleted.
- **Result.** Open while the execution's delivery is undecided (`delivery` is NULL or
  `protecting`, and `result_state = 'pending'`). It closes when the decision becomes final. An
  undecided decision is finalized by the existing `deliveryTimeoutMs` recovery, which the sweep
  also applies.

**The windows only close.** Every condition changes one way only, so once a window is closed no
writer can ever publish into it.

**What the sweep does with each object:**
- **Referenced by its own request:** kept.
- **Unreferenced, window open:** kept. A slow writer may still publish it.
- **Unreferenced, window closed:** an orphan, deleted with its own context. No age threshold or
  process assumption is needed.
- **Anomaly:** its request names another person, or ANOTHER request's row references it (records
  edited by hand). Kept and counted, never swept.

**Sweep bounds.** At most 25 objects per call, in reference order. It runs as the maintenance
supervisor's `orphans` phase, which keeps its scan position in memory (a restart starts again
from the beginning, which is safe).

| Case | Outcome |
|---|---|
| Crash or lost reply after `protect`, before the CAS | The copy stays unreferenced. It is kept while the request can still publish, and deleted once a retry publishes another copy or the request ends. |
| A losing concurrent input copy | The caller deletes it. If that fails, the sweep does (the winner's reference closed the window). |
| A late result copy (decision already final) | The caller deletes it. If that fails, the sweep does. Never delivered or charged. |
| A crash after the CAS | Already referenced. Nothing to do. |
| Protection fails (full store, wrong key) | No reference, so the input is resupplied, or the result is `not_delivered`. Storage never retries a provider call. |

## 6. Retention and what deletion means

**Deletion.**
- Deletion goes through the existing retention passes and maintenance phases. It is idempotent:
  an absent object counts as deleted.
- It is **confirmed**: the adapter re-reads after `DELETE` and reports `unavailable` if the row
  remains.
- A failed deletion keeps the reference, is counted as failed and is retried. It is never
  reported as completed.

**What "deleted" means:**
- the row is gone;
- with `PRAGMA secure_delete = ON`, SQLite overwrites the freed content in the main database
  file;
- the store uses a rollback journal (not WAL) with `synchronous = FULL`.

**What it does not mean.** Earlier copies may survive in:
- the filesystem's free space;
- SSD or flash remapped blocks;
- operating-system or hypervisor snapshots;
- backups and journal remnants.

So this is **logical deletion, not a secure wipe or universal erasure**. Removing a key id is the
only cryptographic erasure lever, and it applies to every object under that key, not to one
record.

## 7. Storage bounds and layout

**Layout.** One SQLite file, `protected-objects.sqlite`, in an operator-chosen **existing absolute
directory**. Neither the directory nor the file may be a symbolic link. Parent path components
are the operator's responsibility. No caller ever chooses a path.

**Bounds:**
- plaintext 256 KiB per object (a 20,000-character input is at most 80 KB);
- 100,000 objects;
- 512 MiB of ciphertext in total.

Exceeding them is a protection failure (`too_large` or `store_full`).

**Format.**
- `STRICT` tables, with checks on reference, IV and tag sizes.
- The format version is recorded, and an unknown version is refused.

**Concurrency and admission (corrected after Astra's review).**
- **The defect.** Astra reproduced two separate connections both admitted past the ceilings: the
  capacity read and the insert were separate steps.
- **The fix.** Admission is now ONE transaction that takes SQLite's write lock before the capacity
  read (`BEGIN IMMEDIATE` → count and sum → insert → `COMMIT`). Encryption happens before it,
  outside the lock.
- **Contention is finite.** A second connection waits up to `busy_timeout` (5 s) and then sees the
  winner's object (`store_full`). If it still can't get the lock, it fails with `unavailable`.
- **Evidence.** The regression uses two worker threads, each with its own real connection. They
  are released together by a barrier outside the critical section, and each is held 150 ms after
  its capacity read by a test-only hook (`afterCapacityRead`). It covers both the object-count
  and the byte ceiling.
  - On the old code, both were stored.
  - Now exactly one is stored and readable, and the other gets `store_full`.

**Readiness (corrected after Astra's review).** `readiness()` gives fixed codes
(`active_key_wrong`, `older_key_wrong`, `key_missing_for_stored_objects`). The business's
customer-offer readiness item:
- shows **unavailable** when the active key is wrong (nothing new can be kept);
- stays **configured** when only an older key is missing or wrong (new work is still protected),
  BUT says that some kept documents and results can't be read, with the operator action "restore
  the older protected storage key";
- returns to no action once the key is restored.

Neither the item nor any error names a key, a key id, a reference or content.

## 8. Limits and what remains

**Not done:**
- not wired in `main`;
- no production configuration;
- no key provisioning, KMS or escrow;
- no backup or restore tooling. The operator must back up the store file AND keep every key id
  that backed-up objects use, or those objects are lost.

**Known costs:**
- The capacity check counts the table on each write.
- The sweep's anomaly check scans `customer_requests` for the reference (there is no index on
  `input_ref`; it is bounded to 25 objects per pass).

**Not addressed:**
- **Multiple processes.** They share one file through SQLite locking. Admission is serialized
  across connections (tested with two threads, each on its own connection, not two processes).
  The publication-window rule is process-independent, but the whole lifecycle has not been tested
  with two processes.
- **Metadata privacy** (§1).

**Behavior change.** An input deleted by retention is no longer protected again by a same-key
retry: it can never be needed again (the 003n1 rule).

**Evidence (all local, with ephemeral random test keys and fictional canaries).**
- **Unit tests** (`protected-store.test.ts`):
  - round trip; the stored file contains neither the canary nor the key;
  - restart with the right, wrong and missing key;
  - rotation without rewriting;
  - refused key configurations;
  - tampered ciphertext, tag, IV and key id, and a moved envelope;
  - a swapped reference, including relabelled rows;
  - the size bounds;
  - capacity admission across two real connections, for both ceilings (the old code over-admits;
    the fixed code stores exactly one);
  - 200 concurrent writes with distinct IVs;
  - idempotent, confirmed deletion;
  - the configuration parser.
- **Real-route tests** (`customer-protected-store.test.ts`):
  - prepare → execute → result → retention;
  - a full restart: the original app connection is closed, then the same file is reopened, and
    the store too;
  - wrong, missing and pinned keys;
  - readiness disclosing a missing or wrong older key, and clearing on restoration;
  - rotation;
  - swapped references across customers, for reads, execution and maintenance deletion;
  - a sale (customer still served, both owners 404, deletion afterwards with the customer's
    context);
  - a late copy whose cleanup fails, then the sweep;
  - the publication gap, with a slow-writer-safe keep;
  - a failed retention deletion, then its retry;
  - a full store (one provider call, not delivered);
  - the supervisor's orphan phase.

  Any test cleanup failure (an unclosed handle, an unremovable temporary directory) now fails the
  test instead of being swallowed.

  The chain and the extractor are still the labelled doubles: this is not live NEAR or
  model-provider evidence.
