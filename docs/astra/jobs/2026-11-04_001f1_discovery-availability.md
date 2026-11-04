# Make discovery reflect actual customer availability

**Why (Tony):** "Can you remember all of this and start to implement it please? I like everything
you just listed out"; continuous development now approved: "Sounds great, do it!"

## What the person sees and does

A published digital product with an active usable offer appears under Open for customers in
Explore. Its tab count, list label, storefront and Use entry agree. Starting/paused/retired and
legacy/mixed businesses have truthful classifications and explanatory copy. No claim that a
working digital product cannot be used merely because it has no legacy booking offer.

## Independently reproduced

At 8df9f34, actual preview-publication browser: Ava saved and published Ledgerline's digital
profile with an illustrative example. Home/storefront show Available to use. Use opens the
Invoice reader customer workspace. Explore instead shows Starting now (2), lists Ledgerline
under "nothing can be booked yet", and Open for customers (0) says Nothing open yet.
Source server/src/community.ts:447 partitions by legacy action.kind; web/src/pages/Explore.tsx
uses that partition. Reproduce through real routes before fixing. Do not change a legacy action
into a digital booking just to satisfy this predicate.

## Done when

- Coherent complete classification over digital available, coming soon, paused/retired, legacy
  interest/open and mixed businesses. Explain the mixed rule. No duplicates or missing entries.
- Regression through actual publication/feed routes with active offer, retirement/release change,
  unpublish and mixed/legacy controls. Preserve exact reviewed release and public allowlist.
- Explore failures settle into an honest retryable state rather than indefinite Loading (current
  catch silently drops errors); changed account cannot retain another account's Following feed.
  Scope changes only to this discovery read path; no broad unrelated state rewrite.
- Keyboard tabs use coherent focus/selection and labelled panels. Verify reused listing consumers.
- Fix UI_SYSTEM_001F's documented compact-nav breakpoint (760 versus implemented 980).
  Remove unused DigitalProfile only after checking references; routine removal is already within
  authorized scope and needs no extra permission. No unrelated cleanup.
- npm run check and web:build; report exact tests, evidence and limitations, local commit.
  Leave the existing loopback preview usable for Astra's repeat. Stop for Astra review.

## Not in this job

Studio redesign is next001g. No live provider/RPC/wallet, main wiring, signing/deploy, public
release/push/submission/spending/real data/research access/Day One. Keep six milestones open.
P0/S-M correction to001f; one Claude writer, exact Opus5.5/high, subscription first.
