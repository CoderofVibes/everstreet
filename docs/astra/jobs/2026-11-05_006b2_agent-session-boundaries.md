# 006b2: bind pending agent controls to the session that started them

P0/S–M. Correction to 006b1. Review baseline `f817fef`.

The customer should be able to sign out with a create pending and sign in again without seeing the previous session's one-time token. In the independent component probe, sign in as Ava, start Create access, hold its response, sign out and sign back in as Ava without unmounting the page, then deliver the old response. The page displays its token. Comparing only `person.id` cannot distinguish these sessions. The existing cross-account test passes.

Fence read and write completions to the active session and, for the owner switch, the active business. Old completions must not set a token, announce an outcome, retry a read for the wrong scope, or release a newer request's pending guard. Check the owner switch's GET when the business changes without remounting: `useActorRead` keeps its initial getter and the switch currently closes over `businessId`. Use the actual requested business and cover a delayed prior response. If a write response is lost, say the outcome is unknown until readback. Preserve focus, confirmed revocation and the semantics for reserved work.

Add failing-first regressions for same-account sign-out/sign-in and in-place business change. Keep the existing cross-account, expiry, cap and revoke tests. Run the full check and web build, and verify keyboard switch/readback at desktop and phone widths.
