# Preserve the reviewed publication and recover edits

**Why:** Tony wants approachable building and showcasing inside Everstreet. The owner must
publish what they actually reviewed and retain work through slow answers and failures.

## Reproduced before handoff

Astra at 295ec50 ran a finite 10-second keyless test; it failed in 75ms:

1. `maintenanceWorld()`; PATCH business name to Fictional review test.
2. PUT `/api/businesses/:id/public-profile/draft` base_rev0, valid headline/summary and
   products `[t.w.f.project]`. Saved preview product name is `Invoice reader`.
3. `t.w.rw.build(t.w.f.ava, t.w.f.project, {...INVOICE_SPEC,
   name: "A different unreviewed public product name"})`, then `t.w.rw.release(t.w.f, job)`.
   These use the existing actual build/evaluation/release routes with bounded fixture providers.
4. POST public-profile/publish with the saved draft_rev only. It returns200 and publishes
   `A different unreviewed public product name`, despite no new profile review. Expected either
   the exact reviewed metadata or409 requiring a fresh review. Temporary Astra test removed.

Cause: view computes `snapshot()` from the then-active release; publish recomputes it but fences
only draft_rev. Fix immutable reviewed public content identity, not just the string in this test.
Define which offer availability facts remain deliberately dynamic and say so beside the review.
Check release A offer versus release B name coherence; a stale offered version must not be
misrepresented by a different product's public metadata. No changes to unit/release economics.

## Editor recovery findings from source (reproduce before fixing)

- `save()` captures local, awaits, then unconditionally `setLocal(v.draft)` while inputs remain
  editable: likely overwrites text typed during the save. Preserve typed-ahead edits and show
  which version was actually saved; do not publish unsaved edits.
- `Take the page down` silently catches failures and does not enter busy. Surface failed or
  uncertain outcomes, fence response order and actor/business changes, preserve the draft and
  offer a meaningful status/retry path. Same for stale view versus save/publish replies.
- Success after saving version2 of an already-live profile says `nothing is public yet` even
  though version1 remains live. Distinguish this draft from the public page.
- Product picker displayed `Untitled product · offered` while its saved preview identifies
  `Invoice reader`. Give an identifiable owner-facing selection label and accurate state.

## Done when

First reproduce the release-change failure and applicable deferred-response failures. Meaningful
bounded regression tests for exact review identity, retry, release change, snapshot immutability,
typed-ahead draft preservation, unpublish error/lost reply/access loss and late-answer fencing.
Preserve private canaries, old-owner denial, customer history and legacy/mixed publication.
Update design/report honestly. npm run check and web:build, local commit; then001e. Fix the
nonblocking Math.max lint warning in performance-disclosure.test.ts if still present.

P0/M. No live provider/RPC/wallet/main wiring, signing/deployment, external publication/push,
spending, research reading/assessment or Day One. All six roadmap milestones stay open.
Tony's Fenn/Ruiz local permission test approval is resolved and the tests completed by Astra.
