# Maintenance fairness and truthful worker health

**Why (Tony's words):** "Seamless purchase and transfer of business/product to the investor/acquirer, on NEAR."
Customer obligations must keep progressing, and the buyer must see who is actually maintaining them.

## What the person sees and does

Keep 002d's automatic return/charge and owner readiness. A standby stopping must not make an
active service appear stopped. Slow reservation or settlement work must not indefinitely delay
expired-result cleanup. No new provider calls, customer consent, authority or sale reconciliation.

## Independently reproduced at 7c9f683

Both probes ran through `maintenanceWorld`, real DB selection and supervisor, in a finite
temporary Vitest file (removed after recording). Two expected failures, 130ms test time:

1. Construct A and B with manual inert timers `{set: () => 1, clear: () => {}}`. A.start();
   await A.runPass(); B.start(); await B.runPass() returns standby; await B.stop().
   `maintenanceHealth(...).worker.state` is **stopped**, although A is still active. Expected running.
   Then stop A and close DB. `status()` writes unconditionally without checking lease holder/gen;
   `start`, `stop` and late `finish` can misreport another instance's health. Also inspect a standby
   repeatedly starting while the actual holder is overdue: it must not manufacture freshness.
2. One actual reserved and executed fixture invoice, advance 31*DAY so its result is due.
   Use real CustomerUses but inject `settleOne = async () => { t.advance(21); return
   'not_decidable'; }`. Supervisor passBudgetMs20, backoffBaseMs1/backoffMaxMs1. Run exactly four
   passes, advancing2ms between. Result stays **stored**, expected deleted. This models a slow
   undecidable settlement; cleanup itself is real. Fixed phase ordering spends every pass budget
   before cleanup. Per-item backoff does not ensure fairness across phases.

Browser 002d happy paths pass: rejected scripted input returned100free/0used; supported invoice
charged99free/1used automatically, one settlement call, no Settle click. Owner readiness shows
running/heartbeat and safe aggregate counts. Preserve these behaviors.

## Done when

- First reproduce both failures. Fence health writes by the durable active generation (or an
  equally strong design). Starting does not prove a completed pass; standby start/stop and late
  callbacks cannot overwrite the holder or conceal overdue status. Correct stop/drain/takeover
  semantics and owner-safe states under two instances, including active A / standby B / B.stop.
- Fairness across all phases under a repeatedly consumed budget, not just within one SQL batch.
  Use durable rotation/cursors or bounded phase allocations with explicit guarantees. Do not
  increase limits, drop the pass deadline, or loop until empty. Restart must not reset fairness
  so a busy early phase can always win. Include cleanup when metering is slow/unavailable.
- Recheck the active lease before publishing pass/backoff outcomes after awaits. Keep per-item
  financial fencing and noncooperative adapter caps. Do not add unit side effects to health reads.
- Finite controlled-clock tests for the two cases, overdue standby, takeover/late finish and
  a continuing backlog across phases. Prove outcomes, not SQL strings. Existing tests, npm check
  and web build pass. Update design/report; commit locally, then proceed to003t.

P1/M. No production main wiring/live calls, signing, deployment, API spend, public push/release,
research access, submission or Day One. Keep all six milestones open.
