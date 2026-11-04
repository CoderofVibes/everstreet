# 001j Customer product composition: report

Claude, 2026-11-04. Job: [001j](../jobs/2026-11-04_001j_customer-product-composition.md). Code `89c6923`.
Design first: "Composition and states (job 001j)" in `docs/design/CUSTOMER_WORKSPACE.md`.

## What changed (`/use/:offer`, `/uses/:id`)

- **Header.** Business, then product, then what it does:
  - You give it: pasted text up to N characters.
  - You get: the declared fields.
  - Each use: one unit of exact base units of the asset.
  - Your results: kept N days, for you only.

  It comes from the offer only, with no denomination inferred.
- **Step strip (`customerView.ts`, pure).** Four steps: Your document, Review and authorize one use, Run it on your document, Your result.
  - Each status is a word plus a distinct outline: Completed, Current, Waiting, Stopped or Needs checking. The active step carries `aria-current="step"`.
  - On a phone, only the active step shows its detail.
  - "Your result" is Completed only for a complete extraction (`extracted`). An incomplete, refused or unusable answer is "Needs checking". No result, or a result removed after retention, is "Stopped".
- **One working surface.**
  - The DOM order is active step, then Your unit, then Result, then Recent uses. That is the phone order.
  - At 1240px and above, grid areas place the step, result and side column (unit, recent). Between 761 and 1240 it is two columns.
  - Nothing is visually reordered, so focus order follows reading order.
- **Empty result.** The 360px minimum height is gone. A compact placeholder says "Nothing has run yet. You'll get: …".
- **Stopped states.** Failed, unknown, cancelled and expired results use a "stopped" placeholder tone.
- **Shown result.** An incomplete answer gets a "Not a complete extraction. Missing: …" banner and an `is-partial` style. Values stay selectable text.
- **Review terms.** All are kept: product, document (characters, bound by fingerprint), exactly one unit, price, retention, account and network, authorize-by, and the browser check.
  - Retention is worded as this product's policy for the result you can open here.
  - The fingerprint (full sha256), contract, hold number and served/settled deadlines moved into an expandable "Technical details". They are still computed and checked by the browser.
- **Preview provenance.** One short note sits in the active step card, beside the action it qualifies. The large dark banner is removed; the app shell's preview strip stays.
- **Astra's CustomerStepReview, received mid-job, is fixed here.**
  - "Reserved" persists after a charge or return, so the completed authorize step now says "Authorized: the contract confirmed one unit reserved…". It no longer says "holds".
  - `release_pending` says the return is waiting for the contract's confirmation. Only `returned` says the contract confirmed the return.
- **Unchanged:** `CustomerWorkspace`, the API, envelope checks, the authorizer, unit and settlement rules, recovery, retention, the access-loss clearing, the unit words and source line, recent uses and direct links.

## Checks

- **`web/test/customerView.test.tsx`, 8 tests.** They drive the actual `CustomerWorkspace` over the real customer-use API, with a fixture chain, a scripted extractor and synthetic protection:
  - document → review → run → result: each step completes only when the request shows it; exactly one provider run; the rendered strip has one `aria-current`.
  - A running run (held provider) opened from a reloaded page shows Running; three checks never invoke the provider again.
  - Reserve, then "return my unit", then settle passes through `release_pending` and then `returned`, with the matching words at each. The authorize step never says "holds", and the provider is never called.
  - An ambiguous `HD-310` answer is "Needs checking", and the rendered result says "Not a complete extraction." with no success pill.
  - An unknown provider outcome makes Run and Result Stopped; the run is never offered again, the provider is called once, and nothing is charged.
  - A lost execute answer: checking again finds the same completed run, with one provider call.
  - Access lost (404): the request and result leave the page, and the steps start over.
  - Across a sale in the synthetic preview scenario (its signer, `controls.sale()`), the customer's view is identical before and after:
    - product and business names;
    - unit `charged`;
    - steps;
    - result fields;
    - recent uses;
    - entitlement 99 free and 1 used.

  This is not live testnet evidence.
- **Mutants.** 5 were killed: any result counted complete, running counted completed, no result counted current, the partial warning removed, and the old "returned" wording for a pending return.
- **Existing protocol tests unchanged and passing:** lost prepare and recovery, reload, no authorizer, a wrong key, malformed answers, late answers, retired offers, and cancelled-use waits.
- **Full run.** `npm run check` gave 1095 tests in 111 files, with lint and types clean. `npm run web:build` passed at 849.35 kB, with the existing size advisory.

## Observed vs pending

- **Observed by me:** code-level behaviour through the real controller and API, plus static renders of the step strip and the result.
- **Not browser-verified.** I had no browser tool, and I took no screenshots. Pending for Astra, using `npx tsx scripts/preview-customer.ts --with-offer` (controls on :8813, including `/provider/fail`, `/hold/expire`, `/key/revoke`, `/authorizer/off`, `/sale` and `/lose/*`):
  - 1440, 1280 and 390;
  - keyboard and focus order;
  - zoom and reduced motion;
  - empty, review, running, valid result and failure states;
  - phone history;
  - status announcements.
- **Still open.** No live wallet, model or chain. The 100/20/80 live gate and all six milestones remain open. 002e, 003v, 004b, 005c and 005d are not started.
