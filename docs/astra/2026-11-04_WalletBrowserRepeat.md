# Wallet browser repeat at 96620c1

Tony authorized continued implementation and synthetic permission/sale tests. Dedicated worker
approval is already recorded and exercised; this pass does not reinstall or start that host.

## Actual browser evidence

Astra used the finite wallet harness, real product routes/controllers, actual Wallet Selector
with its explicitly synthetic module, and the IAB. No real wallet, RPC, payment or provider.
Preview 86418 had an eight-minute bound and 768 MiB Node heap; it exited 0. Ports 8814/8815
were confirmed free afterwards. Agent tab 60 is closed and the viewport override reset.

At the printed product, sign-in authenticated Cara Okafor but left **Loading...** indefinitely.
Repeated state/screenshot observations stayed loading, with no console warnings/errors. Reload
recovered the product. This blocks acceptance: a customer should not need to reload after sign-in.

After that reload, the following actual UI journey passed:
- Make this device's key, review account/contract/plan/slot/deposit/gas/limits, explicitly enroll.
- Enter a fictional Stackline Hosting invoice, review one use and authorize the exact document.
- Run, retrieve the scripted extraction, settle and explicitly check settlement again.
- Completed balance: **99 free, 1 used**. This began with the harness's seeded entitlement;
  it does not prove fresh-customer purchase or the flagship 100/20/80 acquisition journey.
- Review revoking this device's slot 1, inspect its observed key/epoch and consequences.
- Set the documented /lose-next fixture control, confirm revocation, and observe readback
  with this device's key gone while the preexisting fixture key at slot 0 remains.
  The lost wallet answer did not cause another wallet request.

At viewport 390x844, cards and text were clipped horizontally. Read-only rendered DOM metrics:
document clientWidth 375, scrollWidth 447; compose/unit/result/recent cards ran from x16 to447
(431 wide), nested device card from x39 to424 (385 wide). Screenshot confirmed the clipping.
No 1440 visual acceptance is claimed from the final cleanup call whose image was not reviewed.

## Required 003wea follow-up

1. Reproduce first-sign-in loading through the actual React lifecycle. Source hypothesis:
   CustomerProduct keeps one workspace in useState, but its start/retire effect depends on
   the person object. Same-account session refresh can supply another object, retire that same
   workspace permanently, then try to start it. CustomerWorkspace.retire sets alive false.
   Bind lifetime to actual account/offer ownership; preserve drafts and readiness on equivalent
   identity refresh, fence actual identity changes. Prove the cause, not just a reload workaround.
2. Correct phone min-content/grid/button wrapping so exact review and result content remains
   readable and operable. Do not hide overflow or truncate transaction meaning as a substitute.
3. Add meaningful regression evidence for lifecycle, run check and web build, then provide
   a bounded handoff for actual fresh sign-in and phone repeat. Existing passing session,
   device-store, authorization and lost-response tests must remain intact.

003wea stays in review. 003web remains queued next; 003wf follows all 003we children. Guarded
on-chain revocation remains a separate recorded limitation; client readback is not atomic chain
protection. Worker remains disabled, all six milestones open and the complete roadmap retained.

Files changed this pass: this review records evidence and corrections; BUILD_STATE and INDEX
link the current handoff. No application changes or Git writes by Astra.

Further independent audit while Claude9680 corrects the browser: expanded
server/test/astra-revoke-review.test.ts and appended DeviceKeyReview with two reproduced
observation-map lifetime failures. Fullcheck83328 lint/types pass,1331pass/1skip/3fail (those two
plus known protected-store5s timeout). Claude owns fixes and commits; no concurrent full check.

Prepared jobs/2026-11-04_003wec_guarded-device-revocation.md from actual revoke_key/install_key
and Rust s04b source, to close the separate acknowledged transaction-inclusion race. Queued after
003web, before003wf, not dispatched. JOBS registration deferred to safe handoff because Claude
owns that file during003wea. This preserves the exact reviewed-key promise; no contract edits,
deployment or external action by Astra.

Updated ACCEPTANCE's current checkpoint to link later narrow acceptances and unresolved wallet,
worker and integration gates; older entries remain historical. This prevents stale early review
notes from being mistaken for present milestone acceptance. No broader completion claim added.
