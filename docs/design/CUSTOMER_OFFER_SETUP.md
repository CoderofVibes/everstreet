# Customer offer setup (job 003r)

Claude, 2026-11-04. Authority: [003r](../astra/jobs/2026-11-04_003r_owner-customer-offers.md).
Builds on [CUSTOMER_WORKSPACE.md](CUSTOMER_WORKSPACE.md) and
[CUSTOMER_USE_RUNTIME.md](CUSTOMER_USE_RUNTIME.md). Nothing here is wired to a live wallet,
provider or NEAR endpoint. Nothing publishes a page or changes an integration.

## Where it is

It lives in the product studio (`/build/:project`) → **Service** tab → **Customer offer**, below
**Checks and release** (`web/src/pages/CustomerOffers.tsx`, controller `web/src/offerSetup.ts`).

## Four separate things

| Thing | Where it shows | What it is not |
|---|---|---|
| Tested release | "Tested release: configured here" | not an offer |
| Customer offer | "Customer offer: configured here", plus the Offers list | not proof that use works |
| Business publication | "Business page: configured / unavailable" | not created by an offer |
| Operating service | Only a customer's completed use shows it | never claimed by this page |

## Readiness: local facts, in order, never all green

`GET /api/businesses/:id/customer-offer-readiness?project=` is owner-only and reads nothing
remote. It lists items in this order:

1. release;
2. page;
3. contract binding;
4. plan;
5. NEAR reader;
6. metering;
7. protected storage;
8. runtime;
9. customer authorization;
10. offer.

Each item is `configured`, `unavailable` or `unknown`, and each missing one has a concrete next
step. No step asks for credentials in the app.
- **Plan** is always `unknown` here. It becomes `observed` on the page only from a fresh
  inspection, with the block it was read from.
- **Customer authorization** is always `unavailable` on the server, because the app ships no
  signer. The page shows "configured · preview only: synthetic test key, not a wallet" only when
  the disposable preview injected its labelled authorizer.

The page counts "N of M set on this server" and says that configured is not proven live.

## Plan inspector

`POST /api/businesses/:id/customer-offer-inspections {release_id, plan_id, retention_days}` is
owner-only. It does one bounded read (`get_control`, `get_treasury`, `get_plan` at one pinned
block) and writes nothing. It is capped at 12 per business per minute (429 after that), with the
memory it uses bounded.

**Refusals.** A failed read is refused, never guessed. Each case has its own code:

| Case | Code |
|---|---|
| Plan doesn't exist | `no_such_plan` |
| Block too old by the server clock | `evidence_too_old` |
| Clocks disagree | `clock_uncertain` |
| Malformed answer | `read_malformed` |
| Mixed blocks | `read_mixed_blocks` |
| Endpoint unreachable | `read_unavailable` |
| No reader | `customer_use_unavailable` |
| Release changed during the read | `release_not_active` |
| Binding changed during the read | `binding_changed` |
| Ownership changed during the read | 404 or 409 |

**What it returns.**
- the product name and revision;
- the plan in base units (no decimals are invented and nothing is converted to dollars);
- the asset;
- the retention;
- the block;
- whether the contract lets the platform meter;
- whether an active offer already exists;
- `terms_digest` = sha256 of {release id, artifact digest, network, account, plan id, decoded
  plan, asset, retention, owner generation}.

There is no plan list on the contract, so the founder types a plan number. Technical identifiers
are kept under "Technical details".

## Create: exactly what was reviewed

`POST /api/businesses/:id/customer-offers` now requires `reviewed_terms`. In order:

1. **Replay.** An identical request with the same key returns the original exactly as it is now
   (`created: false`). That includes a retired offer: a retry never reactivates it.
2. **Fresh read and checks.** One fresh read follows, with the same post-read checks as
   inspection. The recomputed digest must equal `reviewed_terms`, otherwise `409
   terms_changed` and nothing is created. So a changed price, retention, binding or ownership
   needs a fresh review. A buyer can't reuse a seller's review, because it names the former
   ownership generation.
3. **Inside the write transaction.** The replay runs again, so a simultaneous duplicate makes
   one offer. The owner epoch, the active release with the same digest and the same binding are
   checked again. The cap and the one-active-offer-per-release-and-plan rule still apply.

**Retire** targets one exact offer id and can be repeated safely. It stops new uses only.
Customers keep their requests, results and units.

## The controller (`OfferSetup`)

- **Draft and review are kept apart.** The draft is what is typed. The inspection is the review
  of exactly the inspected values; editing either value sets the review aside.
- **Lost answers.** A create that isn't answered (network failure, 5xx or a malformed answer)
  keeps its exact body apart from the draft. The page then shows **Recover my original
  request**. While it's unanswered, **Create** says "recover it first".
- **Reload.** The pending body (owner terms only, no secret or customer data) is kept in
  session storage, so it can be recovered after a reload. Denied storage never blocks anything.
- **Definite refusals.** A definite 4xx clears the pending create. `terms_changed` also clears
  the review.
- **Retiring** needs a second, confirming click.
- **Access checks.** A 404 is checked against ownership, so it is never assumed to mean lost
  access. Lost ownership clears readiness, offers and review ("You no longer manage this
  business"). Late answers after the page closed land nowhere.

## Preview (disposable, synthetic)

```
npm run web:build
npx tsx scripts/preview-customer.ts                (founder setup first)
npx tsx scripts/preview-customer.ts --with-offer   (003q's quick start)
```

As Ava, open `/build/<project>`, choose Service, then Customer offer:
1. inspect plan 1;
2. review it, then create;
3. open the customer page.

As Cara, use the product once. As Ava, retire the offer. As Cara, the history and result stay
(`/activity`, `/uses/:id`). Then call the `/sale` control. As Noah, manage the offers; Ava is out.

New controls on :8813:
- `POST /lose/offer` and `POST /lose/retire` (the server acts, its answer is lost);
- `POST /plan/price/:units` (the synthetic plan's price changes after a review);
- `POST /read/fail` (the next contract read fails).

Listeners are on 127.0.0.1 only, and Ctrl+C ends them. The journey is also driven without a
listener by `server/test/customer-preview.test.ts`.

## Still not done

- A live wallet authorizer, provider, protected storage, metering writer and NEAR reader.
  Readiness lists each one as unavailable in main.
- Browser verification of 1280/1440/390 widths, keyboard and focus, which is left for Astra's
  review.
- A contract plan list. The inspector reads one number at a time on purpose.
