# The digital business desk (job 001c)

Claude, 2026-11-04. Authority: [001c](../astra/jobs/2026-11-04_001c_digital-business-desk.md).
Written before the code. It changes the desk's layout and adds one read-only, owner-only
projection. It adds no new authority, mutation, public disclosure, contract change or `main.ts`
change.

## One owner-safe projection

`GET /api/businesses/:id/digital-desk` calls `digitalDesk(db, businessId, asOf, service)` in
`server/src/digitalDesk.ts`.
- **Ownership:** control is checked before and after the reads, as for the books.
- **Bounds:** every query is bounded by the business. Products are capped at 12, newest first,
  with the true total. No per-product fan-out from the browser.

**Kind** comes from the records plus the declared family, never from names or fixtures:
- `digital`: the business has a product project or an imported product, or its family is
  `software`;
- `legacy`: otherwise, for a class, service or physical-product business;
- a legacy business keeps today's desk unchanged.

**Products.** Each product carries:
- its name from the saved brief, or the honest fallback "Unnamed product";
- its foundation label and saved brief revision;
- its release: `active` (with the activation time), `retired_only`, or `none`;
- its customer offers (active and retired) and the newest active offer's id, plan and contract
  price: exact base units and asset, with no dollar conversion;
- **status**, exactly one of:
  - `brief_only`: a saved brief, no release;
  - `released`: an active release, not offered to customers;
  - `offered`: an active offer;
  - `offer_retired`: offers were made, none is active now.

A saved brief is never called a release. A published page is never called a working service.

**Imports:** a count only (the existing list stays below).

**Legacy offering:** `configured` only when it has a title or a price. An empty offering is never
shown as the business's product.

**Work** comes from current records, in priority order. Each item is labelled "needs you" or
"waiting on the system", with a link and no mutation:
- customer uses that need attention;
- obligations paused by authority (metering not appointed);
- unanswered inquiries;
- uses awaiting settlement, or reserved and not yet settled (the system's work). The worker's
  observed health qualifies them; a worker that isn't running is its own item;
- products with a brief but no release (build and test), and released products without a
  customer offer (offer it);
- open checklist tasks.

The current customer work reuses 003t1's exclusive groups and the worker health, as of the same
instant. No call goes to the provider, wallet, chain writer or worker.

## Layout

- **Digital businesses:**
  - **Header:**
    - the page's state (published or private) apart from the products' state (releases, offers);
    - the work line from the projection, never "all caught up" while work exists;
    - actions: Open product studio (one product), or Choose a product (several, jumping to the
      list); Customer access; Ownership and continuity; Sale and handover; and "Edit page and
      legacy offering", the renamed old `/studio` brief.
  - **Main canvas, full width:** an Operating summary (product cards and a prioritized work
    list), then the existing Books card with Digital operations and its single period control.
  - **Below, the existing two-column desk:** inquiries, checklist, imported products, growth
    panels and the sidebar.
  - **Sidebar:** the legacy OfferCard appears only when that offering is configured, titled as
    the page's legacy offering. Its "not decided" list stays with it.
- **Legacy businesses:** unchanged.
- **Privacy:**
  - The desk stays keyed by actor and business (003t).
  - The projection load is sequenced and ignored once the view has changed.
  - A 401/403/404 clears it.
  - Unsent inquiry replies live in the desk page and survive panel reloads.

## Preview

`scripts/preview-desk.ts` builds on the operations preview:
- a digital business with an active release, recorded uses and pending work, plus a second,
  brief-only product (multiple products), an imported product and a configured legacy offering,
  all created through the app's routes;
- a brief-only founder;
- a legacy class business.

Everything is labelled fictional and synthetic.
