# Fresh-customer purchase browser review

Internal review of the built 003web UI from handoff 6aa4979, while sole Claude correction
exec95705 was active. Disposable wallet harness exec50017, ten-minute self-stop and 768 MiB
Node heap cap; in-memory fictional Dana, no real wallet, network transaction or money.
The running preview predates the concurrent corrections. Do not claim those corrections were
browser-verified from this run. All six milestones remain open.

## Observed behavior

- Product sign-in completes without reload. Price is 0.05 TUSD/use, initial balance 10 TUSD.
- Exact registration review quotes 0.0082 NEAR, 820 bytes; synthetic approval creates the
  registration. Reviewing 100 uses states 5 TUSD, account/network/recipient/deposit/gas.
- A deliberately cancelled wallet retains the original purchase and offers explicit recovery.
  Resending requires a separate review explaining temporary token movement and additional gas.
- At viewport390 the expanded exact transaction wraps; document client/scroll widths375/375.
  Desktop1440 composition is readable, but new-customer setup is buried below the document
  input in a narrow nested card, with large empty result space alongside it.
- On explicit resend, the synthetic transaction lands but the reply is deliberately lost.
  Buy uses correctly reports current100 available uses and5 TUSD balance while retaining an
  unknown historical payment. Check its outcome preserves uncertainty without inventing proof.
- The device panel STILL says no units exist, even after Check its outcome. Its own manual
  Check the contract again then reveals device setup. This is a reproduced UI inconsistency.
- Device key generation reaches exact enrollment review. Enrollment submission was rejected
  by automatic approval review; a narrow user question is pending. No enrollment/use completion
  claimed. Earlier synthetic sale/access approvals were not accepted as covering this action.

## Bounded corrections before browser acceptance

1. Refresh dependent entitlement/device views when freshly read registration/free-unit evidence
   changes, including an unknown payment with observed available units. Preserve the distinction
   between spend evidence and current entitlement. No extra manual refresh, duplicate send,
   stale-account update or refresh loop. Reproduce through the actual page with a lost reply.
2. Provide an explicit original-transaction recovery path when the wallet reply omitted its hash.
   The controller already accepts an optional hash in checkOpen, but this built UI offers only
   checking without it or another wallet send. Let the customer supply the original transaction
   ID from wallet history; validate/bind it through the existing strict server resolver, reject
   unrelated transactions, retain unknown on insufficient evidence. No implicit resend or claimed
   success from entitlement alone. Verify reload/recovery and expose unresolved history truthfully.
3. Simplify setup copy. The shell review currently exposes source/test internals verbatim
   (get_purchase_terms/version/tests/sponsor_shell), and ordinary price lines repeat base units.
   Keep human-readable token/NEAR totals and the decision-relevant explanation first; put exact
   units, bytes, version and method details in an accessible disclosure. Do not promise a refund
   has completed from receiver rejection alone. Replace "so you can't pay twice" with precise
   wording about preventing a new purchase while the previous outcome remains unresolved.
4. Bring the first required setup action into the main customer workflow, without burying it below
   an empty document input or turning every stage into another nested card. Keep an editable draft
   and exact consent available. This is a small composition correction within the approved UI
   direction, not a new visual redesign or backend rewrite. Verify1440/1280/390 and keyboard.

After current bounded server corrections finish, dispatch this as a separate bounded continuation
of003web. Do not overlap writers or start003wec until purchase acceptance. Review new code and
actual browser behavior, run meaningful page/controller tests plus required check/web build,
update report/JOBS/INDEX, and commit locally through Claude. Research remains ignored/local-only.
