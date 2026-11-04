# Customer steps must distinguish reservation history from present unit state

Previous pass advanced002e with actual host capability evidence.6420 remains live on001j;
this is an early review of its new customerView.ts, not a claim about the final job result.

Finite inline Node/tsx probe imported customerSteps and activeCustomerStep. Synthetic input:
use.state reserved,106-character input, no execution, unit release_pending. The Run step says
"You returned the unit; it wasn't run." Its authorization step also says "The contract holds
one unit for this use." The real server's customerUse.headline explicitly says release_pending
is waiting for confirmation and cannot claim returned. Its settlement tests exercise this path.

The authorizeStep branch uses protocol state reserved alone. That protocol state also persists
after a charged or returned settlement. Therefore present-tense "holds" is unsuitable as a
generic completed authorization explanation. It should describe the confirmed reservation as
history, or qualify the current units state; current balance belongs to the actual unit evidence.

Recheck final001j, then make a narrow presentation correction if still needed: pending release
must say return requested/awaiting contract confirmation; returned may say confirmed returned.
Completed authorization must not claim a currently held unit after charge/return. Keep unknown
or conflict honest, same-request recovery intact, and do not change the backend protocol.
A small state-matrix regression is meaningful because these words assert a financial/unit fact;
ordinary style/markup assertions are not needed.

Only this pass, INDEX and ignored BUILD_STATE changed. Active Claude files left untouched.
No browser/server launched, signing/deploy/Git writes/spending/secret/research access. Prior
post-doc check failed on active formatting; stable001j verification is still due. Next priority
remains001j acceptance ->002e actual executable product, then all remaining M1-M6 work.

Post-doc independent55605 passed lint/types and1087tests/110files while Claude was still editing.
That suite does not yet cover the new wording counterexample and is not final001j acceptance.
