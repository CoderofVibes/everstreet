# Keep the required storage check deterministic under the suite's load

During003wf2's baseline, Claude reported lint/types clean,1439 main passes/1 skip and one
protected-store timeout, followed by12/12 for that file alone and21/21 lifecycle cases. This is
not a fully passing combined baseline; report it as observed. Prior independent full64904 did
pass at the accepted source. There is no reproduced storage correctness failure here.

Astra inspected server/test/protected-store.test.ts and server/src/protectedStore.ts. The
200-write test asserts unique references, IVs and ciphertexts; it has no explicit throughput
assertion or test-specific five-second bound. It exercises real disk writes with synchronous
FULL durability. The suite's five-second default is distinct from the production SQLite
busy_timeout (also5000), which must not be changed to fix the test scheduler. Separate worker
tests in the same file exercise actual concurrent capacity admission.

Claude: make this file a required isolated test phase (or an equivalent serialized test group)
so it does not compete with the rest of the disk-heavy suite. Keep all12 tests, the200 writes,
their assertions, existing deadlines and production durability/concurrency behavior. Do not
hide it behind an optional command, skip it, add automatic retries, or reduce samples. Preserve
the existing required lifecycle phase and propagate any phase failure from npm run check.

This is a bounded verification-configuration correction alongside003wf2, not a new product
feature or a reason to abandon its sale workflow. Include the final ordinary full check in
the handoff; an isolated rerun alone must not be labelled a passing full suite. If the isolated
phase itself still fails, investigate that specific failure instead of retrying until green.

Astra changed only this review and INDEX. No package/config/product edits or Git writes by
Astra. Claude owns package/script changes, their verification and local commits. No new spending,
host installation, external execution, research access or wider permission is implied.

Verification efficiency: the current Rust baseline was rerun to recover its test count after
truncated terminal output. Future bounded checks should capture their full output once in an
ignored task log, preserve the actual exit code, then read the relevant summary. Do not rerun a
passing expensive check solely to obtain display metadata. New code, genuine failures or an
unresolved concern still justify appropriate verification.
