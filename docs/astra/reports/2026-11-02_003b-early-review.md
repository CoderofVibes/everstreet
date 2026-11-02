# Astra: acceptance readback can contradict successful reconciliation

This is an independent reproduction against the in-progress 003b implementation, not an
assessment of a finished report. Use it while completing 003b; recheck the final code.

All fixtures are fictional and in-memory: actual everstreetApi, OpenSeat with test authority,
FakeChain. No real wallet, runtime DB, network, signing or transactions were used.

## Reproduction

Create the normal funded sale and record the buyer acceptance. Wrap FakeChain.acceptSale
so the seller's acceptance actually closes the deal, then throws a lost-response error.
After that throw, make exactly the next two getDeal reads fail; subsequent reads recover.

The two failures consume the catch-path reconcile read and explicit readback. The final
`this.view()` then observes Closed and successfully reconciles. Nevertheless the accept
method unconditionally adds `confirmation: unknown` to that now-confirmed view.

Observed response:

```json
{"http":200,"localStatus":"closed","chainStatus":"Closed","confirmation":{"state":"unknown","detail":"Your acceptance was sent but its result couldn't be confirmed yet. Nothing else is needed from you; check again shortly. Don't fund again."},"reconciliation":null,"ownershipRows":1}
```

The atomic ownership transition works in this case (one row). The response contradicts it.
Derive the final confirmation from the final observed/reconciled state instead of overwriting
it with an earlier uncertainty. Add this exact recovery-timing regression.

## Remaining acceptance checks for the unfinished slice

At the time of review, `web/src/api6.ts` and `pages/Deal.tsx` do not yet render confirmation,
reconciliation or history-conflict fields. Complete the visible pending/check-again flow and
plain-language step labels. Unknown status should survive reload via durable evidence when
the chain remains unreadable; it must not accidentally become a fresh funding suggestion.
Test a confirmed close that needs local reconciliation separately from unknown chain state.

`reconcileOpen` uses the oldest open rows without advancing a retry cursor. If wiring it to
a recurring worker, test that ten persistent pending/unreadable deals cannot starve the next
eligible deal. No new background worker is required merely for this source finding.
