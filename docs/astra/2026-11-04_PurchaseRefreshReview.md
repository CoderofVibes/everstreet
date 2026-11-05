# Purchase refresh must preserve newer evidence and edits

Follow-up to PurchaseBrowserReview requirements1/2 while sole Claude72344 implements that
bounded continuation. No additional product scope; the delayed-response acceptance applies to
setup reads as well as payment checks. Original six milestones and queued jobs remain intact.

Independent test file `server/test/astra-purchase-refresh-review.test.ts` uses actual setup
routes and the actual PurchaseFlow. Only delivery of an already-read answer is deferred.
At19:29 both cases fail on the current controller:

1. Read zero available uses, hold its response, buy100 in the synthetic chain, then complete a
   newer setup read showing100. Delivering the older response changes displayed uses back to0.
2. Begin a setup read with the default quantity10, edit the quantity to100, then deliver the old
   response. The customer's edited quantity is reset to10.

Fence stale read answers and preserve edits made during a request. Ensure review preparation
doesn't proceed using a stale setup after a superseding read/edit; a retired/account-switched
controller must remain inert. Preserve exact immutable consent and no implicit wallet send.
Cover positive current-read behavior alongside the regressions. Do not silently remove tests
or treat the old1396-pass result as final verification after these additions.

Astra changed only this pass and its separate test file; Claude owns implementation and local
commits. Include this pass in INDEX at handoff. No live RPC, real transaction, wallet enrollment,
deployment or external access. Synthetic enrollment UI approval remains pending independently.
