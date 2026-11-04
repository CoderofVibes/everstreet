# Protected storage: preserve the whole customer lifecycle

Before003v dispatch, Astra reviewed the actual InputProtection interface and its callers in
`server/src/customerUse.ts`, plus the named integration fixtures/tests. Claude remains the sole
writer on002e2; no implementation was changed by this pass.

The existing003v brief already requires authenticated context and safe orphan handling. Added a
concrete caller checklist so these requirements cover maintenance and losing/late writes, as well
as ordinary reads. Batch and single-item deletion must derive customer/request context from the
persisted request. Binding data to the current owner would break the promised sale continuity.

The source also confirms the storage-write/reference-publication gap: protect() returns before
the application records the reference, and losing/late references have best-effort deletion. The
new durable implementation must handle those crash/retry cases explicitly. This is a requirement
for003v, not a claim that a new adapter exists or a new runtime defect was reproduced today.

Files changed:003v job brief, this pass,INDEX and ignored BUILD_STATE. No contract, script,
configuration, Git write, wallet/provider call, real data or research-library access. All six
milestones,001k and the other queued implementation jobs remain unchanged. Check outcome is
recorded in BUILD_STATE;002e2's moving worktree must not be mistaken for final acceptance.
