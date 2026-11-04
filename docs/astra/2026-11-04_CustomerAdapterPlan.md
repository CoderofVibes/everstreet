# Customer integration gap and protected storage slice

Previous turn made progress:001h1 browser acceptance, small access-recheck fix and001i dispatch.
This pass89449 was verified live; only its active UI/JOBS work is in progress. No competing writer.

Read source main.ts, AppOptions/CustomerUseOptions/InputProtection and actual flagship tests.
main.ts currently composes legacy v2 chain plus configured build/runtime; it does not provide the
new v3/customer options. The inspected customer protection is a labelled in-memory test double.
No runtime config, environment values, credentials or runtime database were opened or executed.

The integrated customer-settlement test already runs20 real app requests over a chain/runtime
double, retains80 units through v3 fixture reconciliation, denies both owners customer results,
and admits use21 only after a simulated metering reappointment. Do not duplicate that test or
claim it is a real NEAR purchase. The actual-contract fixture and API-double sources remain separate.

Added003v protected customer storage brief as one concrete live-path adapter: real authenticated
encryption, persistent ciphertext, expected-context binding, retention/crash/rotation behavior and
actual-route tests using ephemeral test keys. Its scope is an implementation, not a declaration
that production data protection/sign-in/transaction transport are done. References are official
Node API docs, separate from Tony's ignored research library, which remains unread/unassessed.

Queue001i review ->001j ->002e, then003v alongside004b/005c and the remaining roadmap. JOBS row
waits until Claude releases its active file. No app changes, Git writes, signing/deployment,
spending, real data, Day One, public release or secret provisioning by Astra in this pass.

Post-doc npm run check stopped at lint while Claude was actively editing Handover.tsx/saleView.ts
(incomplete JSX/formatting,36 errors and7 warnings). No final implementation conclusion; wait for
the stable builder report before rerunning. No conflicting edits made to those files.
