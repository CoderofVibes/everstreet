# Protected storage: independent in-progress review

003v is still being implemented by sole Claude exec10846; this is a concrete early finding,
not final acceptance or a claim that the finished implementation has failed. No overlapping
implementation edits were made. The previous status turn was a verified wait on10846.

## Reproduced: concurrent connections exceed the configured storage ceiling

Inspected the current uncommitted `server/src/protectedStore.ts`. `protect()` reads
`COUNT(*)` and `SUM(length(ct))`, checks the limits in JavaScript, then performs a separate
INSERT. There is no transaction covering that capacity decision and write. Synchronous calls
within one instance do not serialize separate connections/processes.

An independent finite Node probe used the actual ProtectedStore and actual temporary SQLite
database, a random ephemeral key, two worker threads with separate store connections, and
fictional input contexts. It primed/closed the database before starting the two connections.
Configured ceilings: one object and 32 ciphertext bytes. Each input was 24 bytes.

The first successful probe held each real aggregate result until both connections had read it.
Both inserts succeeded: two objects, 48 bytes. To avoid a regression harness whose barrier would
deadlock a correct transactional implementation, a second probe instead synchronized BEFORE
protect(), then paused each completed aggregate read for 150 ms. That also produced:

```json
{"outcomes":[{"i":0,"stored":true},{"i":1,"stored":true}],"limits":{"objects":1,"totalBytes":32},"totals":{"objects":2,"bytes":48},"boundsRespected":false}
```

Both probes exited zero (the diagnostic reports the violated invariant rather than asserting
success). The second took 1.11 seconds. Each had a 10-second outer worker termination deadline,
5-second start-barrier deadline, awaited worker termination, and removed its exact temporary
store afterward. The first attempted harness invocation failed because workers inherited the
parent's ES-module input mode; its temporary store was also removed. Corrected workers use
explicit empty execArgv and the existing tsx CJS hook. No production key, database, model or
chain was used; no generated customer code executed.

### Required correction before acceptance

Make capacity admission and insertion atomic across separate SQLite connections. A transaction
that obtains write exclusion BEFORE the aggregate read, or an equivalently atomic database
admission statement, can enforce the bound. Preserve finite contention behavior and fixed
public errors. Do not merely add a JavaScript mutex around one instance.

Add a meaningful regression using separate real connections and concurrent admission; prove
both object-count and byte limits. Synchronize outside the admission critical section and use
a bounded delay after the count if needed to expose the old interleaving without deadlocking
correct serialization. The winning write must remain readable and cleanup must complete.

This review does not yet accept key rotation, tamper handling, retention, orphan reconciliation,
route integration or path safety. Review those after Claude's finished report and stable tree.

Required independent check16921 passed lint/types and1159 tests, with one Linux-only test
skipped (123 files). Claude remains live and is adding the new real-crypto tests, so this is
the existing-suite checkpoint on a moving tree, not coverage of the reproduced admission race.
At this observation the referenced PROTECTED_STORAGE design file was not present; inspect the
finished design and its stated threat/concurrency model before acceptance.

## Restart-test cleanup: original SQLite handle remains open

In the new in-progress customer-protected-store.test.ts restart case, a cleanup closure reads
`w.state.store.db` at cleanup time. The test later replaces `w.state.store` and also registers
an explicit closure for the replacement. Both callbacks therefore close the replacement;
neither closes the original database. The broad afterEach catch also swallows directory
removal errors, so a passing test does not prove successful cleanup.

A separate finite probe reproduced those exact callback semantics with two actual openDb/Store
instances on its own temporary app.db. After both callbacks ran, SELECT1 on the original
connection still succeeded and rmSync of that exact temporary directory failed EPERM. Exit0
in1.36s; finally closed the ORIGINAL handle and successfully removed the probe directory. No
Claude-owned temporary directories were inspected or removed. This is an actual Windows
cleanup reproduction, not a claim that application restart itself lost data.

Before acceptance, capture/close the original concrete store before replacing it, retain a
separate callback for the new store, and let unexpected cleanup/removal failures fail the test.
Prefer a restart test that really closes the original connection before reopening, matching
the claimed restart evidence. Do not hide every cleanup exception as "already closed".

## Owner readiness hides missing historical keys

After the design arrived, Astra checked the real customer-offer-readiness route with the real
temporary ProtectedStore. Store an object under an ephemeral old key, close, then reopen with
only a different active key. The actual adapter reports a problem but ready:true; the route
ignores the problems list and shows configured with no next action. Actual output:

```json
{"adapter":{"ready":true,"problems":["key_missing_for_stored_objects"]},"ownerItem":{"key":"protection","label":"Protected storage","state":"configured","detail":"Documents and results are protected at rest (aes-256-gcm/v1).","next":null},"loadCode":"key_missing"}
```

Probe exit0 in1.45s, own temporary encrypted store removed and in-memory application closed.
The business/chain were labelled fixtures; no provider or chain call was made, no key/id/ref was
printed. This is a disclosure/readiness defect, not a plaintext leak. Writes under the new key
may remain usable; do not erase that distinction by claiming all storage operations fail.

Expose degraded historical readability and a concrete operator action in the existing readiness
surface whenever missing/wrong older keys affect stored objects. Keep codes free of secrets
and keys out of the UI. Test the actual route for missing old key, wrong old key with a valid
active key, and restoration. The current unit test deliberately returns ready:true for the
missing-old-key case; the route still needs to communicate its problem.

## Design review scope

PROTECTED_STORAGE.md now documents envelope/context binding, logical deletion, publication
windows and the operator's parent-path responsibility. It explicitly leaves multi-process tests
unaddressed, but its hard storage ceilings still need the reproduced cross-connection fix.
Its claimed full app restart must close the original handle before reopening. Neither the
design nor passing existing tests supersedes these three independently reproduced findings.

Independent required check83936 passed lint/types and1178 tests (one Linux-only skipped,
125 files). The test suite's swallowed cleanup errors mean that pass is not evidence of
complete temporary-directory cleanup; do not repeat broad checks until a correction or stable
final review warrants it. The independent probes removed their own exact temporary artifacts.

## Parallel host decision status

The separate WorkerHostSetupProposal was completed and presented to Tony via an asynchronous
approval question during this pass. Approval is pending; no download, install, permission
change or real worker-engine test is authorized by this note.003v and the queued001k/003w work
continue independently. All six milestones remain open; research remains unread and local-only.

## Independent repeats after the three corrections

Claude read this review during10846 and addressed all three findings in the same job. This is
verification on the corrected working tree; wait for the final report/commits before closing003v.

- The original two-connection probe (start barrier outside admission,150ms post-count delay)
  now accepts one24-byte object and refuses the other with store_full. Totals1/24 stay within
  limits1/32; exit0 in1.30s, own temporary store removed. Source now uses BEGIN IMMEDIATE before
  the capacity query, covers the insert in that transaction, and rolls back failures.
- Independent protected-store.test.ts:12/12 pass. Includes separate object-count and byte-limit
  contention cases with distinct real connections, plus reading the winning object afterward.
- Restart test now captures the original Store, closes it before reopening and asserts it is
  closed. Cleanup runs every registered closer/removal and throws AggregateError on any failure.
  Independent customer-protected-store.test.ts:10/10 pass, including the corrected restart and
  surfaced cleanup errors. This proves cleanup for this run, not retroactive cleanup of older runs.
- Actual missing-old-key route probe now includes a concrete warning in detail and next action
  to restore the older key. New writes remain available (configured here is explicitly defined
  by the existing UI as setup, not proof of live function). Existing object still fails key_missing
  until restored. Exit0 in1.17s, own temporary store removed. The10-route suite also covers
  wrong historical key with valid active key and restoration. Existing CustomerOffers renderer
  displays detail/next; no new browser verification claimed in this backend slice.

No new production keys, provider/chain calls, preview, signing or worker installation. Host
approval still pending. Complete stable fullcheck/build/report review before final acceptance.

## Files and safe handoff status

Astra added this review, updated INDEX and ignored BUILD_STATE, and retained the pending host
proposal. Deliver this finding to Claude at the next safe continuation boundary; do not start
a second writer or interrupt the active implementation merely to deliver it. Claude reviews
and locally commits Astra's exact files. No Astra Git writes.
