# Durable protected customer inputs and results

P0/M-L. Next M3 adapter slice after the current UI rollout and002e execution path, interleaved
with004b/005c rather than replacing them. Explicit dispatch only; never a second shared writer.
Read ASTRA, PLATFORM_VISION, CUSTOMER_USE_RUNTIME and the actual InputProtection callers first.

## Why and present evidence

Customer documents and results must survive a business handover without becoming readable by
the seller or buyer. The customer retains access and promised retention; the operator can run
the authorized service without storing plaintext in the application's ordinary records/logs.

customerUse.ts has an InputProtection interface and correctly refuses execution without it.
The inspected implementation is SyntheticProtection in customer-world.ts: an explicitly labelled
in-memory test Map. main.ts supplies neither customer nor v3 options. Existing100/20/80 integrated
test exercises real routes with chain/runtime/protection doubles, separately from actual contract
unit evidence. None of this proves encrypted durable customer storage is implemented.

## Bounded implementation

- Design first: threat model, encryption envelope, storage/reference format, ownership versus
  customer identity, retention, key lifecycle and crash recovery. State limits plainly: encryption
  at rest does not hide inputs from the authorized runtime or protect a compromised platform
  process holding the key. Do not call it end-to-end encryption or universal data erasure.
- Implement the existing seam with durable ciphertext storage and established authenticated
  encryption from Node's crypto library. A suitable baseline is AES-256-GCM with correctly sized
  random unique IVs, fixed full authentication tags, and authenticated context. No invented cipher.
  Cite the exact pinned-runtime API assumptions in the design. Node documents unique/unpredictable
  IVs and authenticated additional data/tag checks in its
  [crypto API](https://github.com/nodejs/node/blob/main/doc/api/crypto.md).
- Bind the envelope to person/request/input-or-result/schema/reference/key-id, and require the
  caller's expected context on reads and deletion. The present load(ref)/delete(ref) interface has
  no caller context: deliberately evolve it and every caller/test double if needed. Authenticating
  self-described envelope metadata alone is insufficient to detect a swapped valid reference.
  Preserve customerUse's pre/post-await authority and retention checks.
- Operator-configured key material is injected at construction through one supported configuration
  path; do not discover/print real keys or read existing secrets. No insecure default, no plaintext
  fallback, no implicit fresh key on restart that strands prior data. Separate stable scheme/version
  from rotatable key identity. Explicit unavailable state for missing/wrong key or corrupt envelope.
- Store bounded ciphertext records, not caller-selected paths. Define atomic write/reference
  publication and deletion behavior, orphan handling, concurrency, record/total-size ceilings and
  cleanup. Use a reviewed SQLite or filesystem design; file writes stay inside an explicit store
  root with no traversal/link escape. Keys are never stored with ciphertext in the same database.
- Integrate real encryption with prepare/execution/result/maintenance routes under test options.
  Retention deletion is idempotent and retryable; unknown deletion is not reported as completed.
  Define what logical deletion means for backups/WAL/storage media, without false secure-wipe claims.
  Orphan sweep cannot race a pending publication or delete another active request's object.
- Customer identifiers and references are never public preview or log content. Former/new owners
  remain denied customer results; customer identity and reference binding remain stable across
  sale. Costs/aggregates keep their existing scoped projections.
- Keep synthetic protection clearly test-only. No automatic production configuration, real secret
  provisioning, runtime database reads, wallet/chain calls, deployment or provider spending here.
  Add a concrete configuration/readiness seam and examples with placeholders only.

## Acceptance

### Caller integration checklist from Astra's source review

The current `server/src/customerUse.ts` has protection calls in more places than customer result
reads. Cover `protectInput` (including its losing concurrent write), protected-input execution,
`keepResult` (including late-result cleanup), `result`, batch `expireResults`/`expireInputs`, and
single-item `deleteResult`/`deleteInput`. Context for maintenance must come from the persisted
customer request, not a current business owner or an absent HTTP viewer. Those queries currently
select references without customer identity; deliberately join/read the required request fields.
This identity must remain stable across a sale.

The existing `protect` interface has no retention or publication acknowledgement, while callers
publish references only AFTER awaiting protection. Late/losing copies attempt deletion and swallow
cleanup failures. A durable adapter therefore needs explicit crash/orphan handling across the
storage-write/reference-publication gap; do not assume protect() returning proves publication or
that an age-only sweep is safe for a slow active writer. Preserve the caller's result delivery and
retention fences and document how the new protocol resolves abandoned writes.

Use `server/test/customer-world.ts` and the real-route cases in customer-execution.test.ts and
customer-maintenance.test.ts as integration starting points, replacing only the protection seam
with the real adapter where required. Keep the existing synthetic chain/provider labels: actual
crypto/storage tests are not live NEAR or model-provider evidence.

### Required evidence

- Use actual crypto and temporary durable storage with fictional canaries and ephemeral test keys.
  Inspect only those test artifacts: no plaintext canary or key bytes in the stored records/logs.
  Restart/reopen with correct key recovers; missing/wrong key fails; old keyed records remain
  readable under explicit rotation policy, without silent rewriting or key-id aliasing.
- Tampered ciphertext/tag/IV/context and swapped otherwise-valid person/request/kind references
  fail before plaintext is returned. Bound payload/reference/envelope sizes; never return partial
  decrypted output after authentication failure. Concurrency and replay do not reuse IVs.
- Actual route tests use this implementation through prepare -> execution -> result -> retention,
  including failed protection/delete, restart, late result, sale and same-person/new-owner fences.
  Full customer state/units invariants remain unchanged. No provider call is retried by storage.
- Run a finite orphan/retention/crash lifecycle test and explain remaining backup/key-loss recovery
  requirements. Do not require a new paid service for the local implementation.
- npm run check and web build; exact local commits, report and stop for independent review. This
  accepts one real adapter, not live NEAR, production sign-in, complete main wiring or full M3.

Exact Opus5.5/high subscription; no fallback/API spend, Git push, public release/submission,
sign/deploy/mainnet, real data, new spending, Day One or research-library access. Scope searches
before reading. Leave unrelated Astra files and ignored checkpoints/research unstaged.
