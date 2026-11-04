# 003r report: owner customer offers

Claude, 2026-11-04. Job: [003r](../jobs/2026-11-04_003r_owner-customer-offers.md).
Commit `c9e6fe9`, on top of 003q1 (`5f99552`, report `44e4745`). Not pushed. No contract change,
no deploy, signing or live call. Design: [CUSTOMER_OFFER_SETUP.md](../../design/CUSTOMER_OFFER_SETUP.md).

## What the founder sees

The product studio (`/build/:project`) → **Service** → **Customer offer**, below Checks and
release:

1. **Where it stands.** An ordered list (release, business page, contract, plan and price,
   reading NEAR, metering, protected storage, running the product, customer authorization,
   customer offer). Each item reads Observed, Configured here, Unavailable or Unknown, with
   plain detail and a next step. A count says "N of M set on this server", and that configured
   means set up, not proven live.
   - Plan is only **Observed** after an inspection, with its block and time.
   - Customer authorization is **Unavailable** in main, because the app ships no signer. The
     disposable preview shows it as configured, labelled "preview only: synthetic test key,
     not a wallet".
   - There is no all-green badge.
2. **Set up an offer.**
   - The page names the released product (and its revision), plus a plan-number field and a
     retention field.
   - **Inspect plan** does one read. It shows the exact terms to review:
     - price per use in base units of the asset;
     - retention: not shown to the customer after that, and deleted by the retention pass;
     - plan limits;
     - whether the contract lets the platform meter;
     - the block and time it was read.
   - Technical identifiers sit under "Technical details".
   - **Create this offer** is disabled if this release is already offered on that plan.
3. **Offers.** Each offer shows product, plan, price, retention and its active/retired state.
   An active offer has **Open customer page** (`/use/:id`) and **Retire…** → **Retire: stop new
   uses** / **Keep it**.

## Underneath

New owner-only routes:

| Route | What it does |
|---|---|
| `GET /api/businesses/:id/customer-offer-readiness?project=` | Local facts only; no remote read |
| `POST /api/businesses/:id/customer-offer-inspections` | One pinned read of control, treasury and plan; writes nothing |

**The inspector.**
- It is fresh by both clocks (`evidence_too_old` / `clock_uncertain`).
- It refuses malformed, mixed-block and unavailable reads without guessing.
- It rechecks owner, release and binding after the read.
- It is capped at 12 per business per minute (429), with bounded memory.
- It returns a terms digest over: release, artifact digest, network, account, plan id, decoded
  plan, asset, retention and owner generation.

**`POST …/customer-offers` now requires `reviewed_terms`.**
- An identical retry returns the original as it is now (`created: false`). A retired offer is
  never reactivated by a retry.
- Otherwise a fresh read must reproduce the reviewed digest, else `409 terms_changed` and
  nothing is created. That covers a changed price, retention, binding or ownership. A buyer
  can't reuse the seller's review.
- Inside the write transaction:
  - the replay runs again, so a simultaneous duplicate makes one offer;
  - the owner epoch, the active release with the same digest and the binding are checked again.
- Offer views now carry the product name, and the owner list is bounded at 50.

**Retire.** It targets one exact offer id, is repeatable, and is refused to a former owner.

**Controller** (`web/src/offerSetup.ts`): strict parsers and a port.
- The draft is kept apart from the review, and an edit sets the review aside.
- An unanswered create (network failure, 5xx or a malformed answer) keeps its exact body.
  **Recover my original request** resends it, and Create says "recover it first" meanwhile.
- The pending body (owner terms only) is in session storage for reload recovery. Denied
  storage never blocks.
- A 404 is checked against ownership before the page clears, so an unknown offer is a plain
  refusal.
- Late answers land nowhere.

`HttpError` also gained 429.

**Fixture change.** The `customerWorld.offer()` helper now inspects, then creates. The two
003m tests present a digest.

## Checks

- `npm run check`: Biome clean, `tsc` clean, **720 tests in 59 files** (694/57 at 003q1).
- `npm run web:build`: built, with only the existing chunk-size warning.
- The bundle scan found no preview key, preview signer route or seed helper in `web/dist`.
- Rust was not rerun: no contract or fixture change.

**New tests**
- `server/test/customer-offers.test.ts` (13):
  - readiness with nothing connected / fully configured / owner-only;
  - inspector terms, metering and digest;
  - missing / aged / malformed / mixed / failed / absent-reader evidence and input bounds;
  - the per-minute cap;
  - reviewed digest required; a changed price, retention or binding (server restarted with
    another account) gives `terms_changed`;
  - release retired during an inspection and during a create;
  - a sale during a create (and the buyer can't reuse the review);
  - a simultaneous duplicate, and a replay after a plan change;
  - repeatable retire, no reactivation, a deliberate new reviewed offer;
  - buyer manages, seller excluded, neither reads customer requests.
- `web/test/offerSetup.test.ts` (12):
  - the full founder journey, including reload and reaching the customer route;
  - a review only of the inspected values, and invalid drafts read nothing;
  - lost create by network / 502 / malformed plus an edited draft, recovered into one offer;
  - recovery after a reload;
  - terms changed → fresh review;
  - denied storage;
  - malformed readiness → retryable;
  - two-click exact retire, repeatable; an unknown offer isn't lost access;
  - a sale during an inspection clears the seller's page and the buyer manages;
  - a late answer after close.
- `server/test/customer-preview.test.ts` (+1): founder setup with a lost create answer, a price
  change needing a fresh review, one customer use, retire with a lost answer, the retired offer
  refusing new uses, the customer's history recovered by list, key and result, then a sale.

**Mutants**, one at a time, each restored, with the diff inspected before running:

1. Digest comparison off: killed (4 tests).
2. Owner generation dropped from the terms: killed.
3. Release recheck after the read removed: **survived** at first (the write transaction checks
   again). The added inspection-race test kills it.
4. Freshness check removed: killed.
5. In-transaction replay removed: killed.
6. Controller recover-first guard off: killed (3 tests).
7. A stale review kept after an edit: killed.
8. Retire without confirmation: killed.
9. Lost ownership keeps the offers shown: killed.

## Preview for Astra

```
npm run web:build
npx tsx scripts/preview-customer.ts            # starts with no offer
```

Sites are `127.0.0.1:8812` and controls `:8813`. Not launched this session; no listener is
running.
1. As Ava, open `/build/<project>` (printed at start), then Service → Customer offer.
2. Inspect plan 1. Optionally `POST :8813/lose/offer` before Create, then **Recover my
   original request**. Or `POST /plan/price/70000` after inspecting, to see the fresh-review
   path.
3. Create, then open the customer page.
4. As Cara, use it once.
5. As Ava, Retire… → Retire (optionally `POST /lose/retire` first).
6. As Cara, check `/activity` and `/uses/:id`: history and result remain, and new uses are
   refused.
7. `POST /sale`, then act as Noah: manage the offers. Ava's page clears.

`--with-offer` keeps 003q's quick start. Other new controls: `/read/fail`.

## Not done / remaining gates

- **Browser checks.** 1280/1440/390 layouts, keyboard, focus and announcements are
  structurally in place (labelled fields, a `role="status"` live region, readiness collapsing
  to one column under 760 px) but **not browser-verified**. That waits for Astra's review.
- **Owner pages.** There is no owner-facing link from the public page to setup. The Desk is
  unchanged.
- **Live adapters.** The wallet authorizer, provider, protected storage, metering writer and
  NEAR reader stay unavailable in main.
- **Plan list.** The contract has no plan-list view, so the inspector reads one number at a time.
- **Deletion.** Retention deletion runs in the worker's `expireResults` pass, which isn't
  scheduled in main. Reads are refused after retention regardless.
- **Milestones.** All six stay open. No milestone is claimed from unit tests.
