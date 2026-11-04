# 001c report: the digital business desk

Claude, 2026-11-04. Job: [001c](../jobs/2026-11-04_001c_digital-business-desk.md). Commit
`b9c2b51`, on top of `724220e` (003t1). Not pushed. No contract, `main.ts`, package, provider,
wallet or chain-writer change. No new mutation, authority or public disclosure. The design was
written first: [DIGITAL_DESK.md](../../design/DIGITAL_DESK.md).

## What the founder sees now

A business counts as **digital** when it has a product project or an imported product, or
declares the `software` family. A digital business's desk now has:

- **Header:**
  - **Pills:** the products' facts ("2 products · 1 released · 1 offered to customers") in place
    of the old "Shaping" stage, and "Page published"/"Page private" as a separate pill.
  - **Status line** from the actual work, e.g. "3 things need you · 2 waiting on the system".
    It is never "You're all caught up" while work exists.
  - **Actions:** Open product studio (one product) or Choose a product (several, jumps to the
    list); Ownership and continuity; Sale and handover.
  - **Renamed:** the old `/studio` brief is now "Edit page and legacy offering", so it stays
    reachable.
- **Full-width operating canvas:**
  - **Operating summary:**
    - **Product cards:** the saved brief's name, foundation, brief revision, release
      (active since / retired / none), active and retired offers, and the exact contract price
      as recorded (base units of the asset, no dollar conversion). Each card links to Open
      studio, Customer access and View as a customer.
    - **"Waiting now" list:** "Needs you" kept apart from "Waiting on the system", each item a
      link. It covers customer uses needing attention, paused metering authority, unanswered
      messages, briefs without a release, released products not offered, open checklist items,
      uses waiting on the worker, and preparations awaiting a customer signature.
    - **Worker sentence:** from 003t1's worker health.
    - **"As of" time.**
  - **The Books card** with Digital operations, keeping its single period control.
- **Below, unchanged and reachable:** the checklist (formerly "Today"), inquiries with unsent
  replies kept, imported products, growth panels, share, team and selling.
- **Legacy offering:** the sidebar card appears only when that offering has a title or price,
  labelled "Your page's legacy offering". Otherwise the empty "Your offer's title appears here /
  Price not set / not decided" card is gone.
- **Legacy businesses:** the desk is unchanged.

## Data, bounds and privacy

`GET /api/businesses/:id/digital-desk`:
- **Fence:** control is checked before and after the reads.
- **Bounds:** products are capped at 12 (newest first, with the true total), each read in one
  query.
- **Work:** current customer work reuses `currentCustomerWork` from 003t1, now shared with the
  books, as of one instant.
- **Nothing private:** no customer identity, document or result (tested).

Browser:
- **Loader** (`web/src/deskLoad.ts`): only the newest load lands, a closed loader ignores
  answers, and 401/403/404 clears both reads. React's effect re-run is handled by `open()`.
- **Keying:** the desk stays keyed by actor and business (003t).

## Preview

```
npm run web:build
npx tsx scripts/preview-desk.ts
```

- **Setup:** site on :8822, controls on :8823, 127.0.0.1 only. It is built on the
  operations preview and carries its synthetic label.
- **Ava's digital business:**
  - an active release with recorded uses and waiting work;
  - a second, brief-only product, "Reply Drafter";
  - an imported product;
  - a configured legacy offering.
- **Bea:** a brief-only founder.
- **Dee:** a legacy class business.
- **All created through the app's routes.** Nothing is backdated or invented as activity.
- **Test:** `server/test/desk-preview.test.ts` drives it through the site's fetch.
- No listener was left running.

## Checks

- `npm run check`: **840 tests in 80 files**, lint and types clean (824/76 before).
- `npm run web:build`: passes (769.30 kB, the existing size advisory).
- **New tests:**
  - `digital-desk.test.ts` (8):
    - a working business's status, price, waiting work and privacy;
    - an overdue worker;
    - several products with a retired offer and a brief;
    - a brief-only founder;
    - a legacy class business, then an import and a configured offering;
    - the 12-product bound;
    - another founder or a customer getting 404;
    - the actual reconciliation (buyer has the same products and work, former owner 404).
  - `desk-preview.test.ts` (1).
  - `web/test/digitalDesk.test.ts` (4) and `web/test/deskLoad.test.ts` (3): late answers, access
    loss, closed and re-opened loader.
- **Mutants**, one at a time and each restored. All 5 were killed:
  1. imports ignored for kind;
  2. an active offer not counted;
  3. an overdue worker labelled as running;
  4. "all caught up" while system work exists;
  5. the loader ignoring load order.

## Limits

- **No browser check:** no browser tool was available in this session. Nothing was checked at
  1440/1280/390, with the keyboard or at 200% zoom. The responsive rules are CSS only: the
  summary goes to a single column below 900px, and the desk grid already does.
- **Astra's pending browser sale-intent step** was not performed or substituted.
- **The share kit** in the sidebar still builds its invitation from the legacy offering's fields.
  For a digital business with no legacy title, the message is thin. Left as it was.
- **"View as a customer"** opens the existing `/use/:offer` workspace. There is no separate
  public product page.
- **Customer work links** go to the newest offered product's Customer access. With several
  offered products, per-product work isn't split.
- **No component-render tests.** The rules are covered as pure functions and the loader.
- **All six milestones stay open.** This is M1/M3/M5 integration, not completion.
