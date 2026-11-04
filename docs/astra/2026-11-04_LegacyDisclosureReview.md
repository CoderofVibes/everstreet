# Legacy customer disclosure follow-up

Astra, November4 15:52 UTC heartbeat. Claude90429 remains the sole implementation writer,
currently001e. Source review of completed001d1 a3ba11c and independent legacy-disclosure analysis
advance review without changing the files Claude is editing. No additional builder launched.

## Completed publication correction: review so far

Report and source show review identity now binds draft revision plus product snapshot/release;
publish refuses changed identity. Live metadata stays reviewed and Use targets match the reviewed
release. Old snapshots without release identity retain an explicit compatibility path. The report
records the original failing recipe before fixing it,896 tests/91files and build791.64kB.
These are builder results, not an independent full-suite/browser pass at this heartbeat.001e
actively changes publication source and frontend, so a fresh full acceptance run is deferred
until the writer finishes. Standalone latestLoad tests passed6/6 in225ms, including invalidating
older reads. Required post-doc npm check was attempted during active implementation: exited1
at lint (31 errors/2 warnings, including current control-character regex and partially edited
PublicPage JSX); types/tests did not run. This is a moving worktree result, not a completed-job
regression claim. Leave those files to the active writer; check afresh after001e completes.

## Additional bounded finding: the older customers scope

Source: server/src/acquire.ts, Acquisitions.customers() and suppress(), inspected against
ac09247. Unlike the corrected digital_performance projection, this older scope independently
hides each count1or2 but publishes totals and other cells. Its note says this prevents anyone
being singled out, which overstates the protection.

Concrete source-derived counterexample:

- Four payment rows in included statuses; three delivered, one refunded.
- Public rows are Paid orders4, Delivered3, Refunded `Fewer than 3`.
- The included statuses are mutually exclusive. Any hidden refund count must be positive and
  no greater than4minus3, even allowing extra paid/kept rows. The only possible refund count is1.
- An independent bounded enumeration of delivered/refunded/other each0..8 (729 partitions)
  subject to these published constraints returns the singleton{1}.

This is a source-derived algebraic proof, NOT a new full API/browser regression. It shows an
exact small cell can be recovered from the complete published output, not customer identity by
itself. Prior customer-scope privacy is not proven by digital_performance tests. Payment and
booking metrics must keep their existing meanings; do not silently merge them with digital uses.

## Proposed next bounded job after current work

Reproduce with four fictional payment rows through an isolated fixture and real granted room/
export routes. Use conservative whole-output withholding or another defensible coarsening rule;
test possible inputs against complete outputs, including paying/repeat-customer constraints,
status counts, bookings and relevant combined grants. Remove categorical anonymity wording.
Do not widen existing permissions or expose previously hidden fields. Room/export parity and
revoke/expiry/owner-change fences remain required. No real transactions, no new live wiring.

Not yet dispatched or added to JOBS while Claude is working. Next review should reconcile the
stale historical `permission pending` phrases in JOBS (Tony approved and Astra completed those
tests), add this pass to INDEX, then decide the next bounded implementation ordering. All six
milestones and live integration gates remain open. No research reading/assessment, Git writes,
spending, signing, external publishing or Day One access.

Files changed this pass: this independent review note, its INDEX row and ignored BUILD_STATE.
Claude must review/commit them later; no production code change by Astra.
