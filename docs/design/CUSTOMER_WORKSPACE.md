# Customer product workspace (job 003q)

Claude, 2026-11-04. Authority: [003q](../astra/jobs/2026-11-03_003q_customer-product-workspace.md).
It builds on [CUSTOMER_USE_RUNTIME.md](CUSTOMER_USE_RUNTIME.md). This is the first
customer-facing integration of the customer-use API. It is not wired to any live wallet,
provider or NEAR endpoint.

## Routes

| Path | What |
|---|---|
| `/b/:slug` | The public page gains **Use a product**, shown only when the published business has active offers |
| `/use/:offer` | A new use of one offer |
| `/uses/:id` | A durable link back to one of the customer's own requests |
| `/activity` | Gains **My products** and **Recent uses**, ahead of the existing bookings, requests, follows and messages, which are unchanged |

New API reads, all bounded:

| Route | Returns |
|---|---|
| `GET /api/public/businesses/:slug/customer-offers` | A published business's active offers, at most 10. An unpublished business is 404. |
| `GET /api/public/customer-offers/:offer` | An offer, only while it is active on a published business. Guessing an id finds nothing else. |
| `GET /api/customer/uses?limit=n` | The caller's own requests, at most 50, as a summary. No envelope, salt, signature, input or result. Retired offers still show: it is the customer's history. |
| `GET /api/customer/requests/by-key/:key` (003q1) | The caller's own request under that idempotency key, as the normal status view; 404 otherwise. |

The customer's own request view now carries its offer's public summary: the product, its fields
and the exact terms.

## The journey

1. **Review.** The customer pastes a document and asks to review one use. That prepares a request.
   Nothing is reserved or charged by preparing.
2. **The browser checks it itself.** `customerEnvelope.ts` uses WebCrypto and the contract's own
   encoding (checked byte-for-byte against `customer-signing.json`). It recomputes:
   - the input commitment from the document in front of the customer;
   - the fingerprint, both contract messages and the envelope digest;
   - the terms against the public offer (product, network, contract, price, asset, retention,
     exactly one unit);
   - the key against the authorizer's own;
   - the signing deadline.

   Any difference refuses, with a plain reason.
3. **Authorize.** Only after the check passes are the two digests passed to the authorizer
   (`customerAuthorizer.ts`). **The app ships no signer and no key.** In production there is no
   authorizer, and the page explains that authorizing isn't connected. A page may provide
   `window.__everstreetAuthorizer`; only the disposable preview does, and it is labelled synthetic.
4. **Run, then the result.** The run happens once. The result is shown as readable fields, with
   notes, noticed issues, refusal reasons and problems. Copy and download happen only on the
   customer's action and contain only that result.
5. **The unit.** "Settle my unit" runs the existing unit step. The page shows reserved, charging,
   returning, used one, returned or unknown, with the contract's own `free`/`consumed` and the
   block height and time it was read from. Balances are never summed locally.
6. **What next.** There is always one primary action (`nextStep`). Unknown and conflict states
   offer "check again", never a second request to hide a lost answer.

## Safety in the browser (`customerWorkspace.ts`)

- **One action at a time.** A late answer after the page closed, the person changed or a new
  request started is dropped (a generation counter). Routes are keyed by the acting person, so a
  switch unmounts everything.
- **Draft versus accepted.** The draft (what is being typed) is separate from the accepted
  document the request was prepared from. After a reload the document isn't in the browser, so
  the customer pastes the same document and it must match the stored digest and length.
- **Lost answers (corrected in 003q1).** An unanswered prepare (network failure, 5xx or a
  malformed answer) keeps its original key and document in memory. The customer then sees
  **Recover my original request**, which resends exactly that key and document, whatever the
  draft now says. While an attempt is unanswered, **Review** never creates a second key: a
  different, empty or oversized draft gets "recover it first" and stays as typed. A definite
  refusal (4xx) clears the attempt.
- **After a reload.** Session storage holds only `{key, request id}` per person and offer, and
  is written before the request is sent. If only the key is known, the page asks
  `GET /api/customer/requests/by-key/:key`, which finds only the caller's own request (another
  person's identical key is never matched). A 404 means the server never recorded it, and the
  page says so. If storage is denied, nothing blocks: recovery still works in memory.
- **Statuses tell the truth (003q1).** The unit projection is `not_held` for prepared,
  cancelled, expired and refused requests, and `reservation_pending` while an authorization
  waits for the contract. Only a confirmed reservation reads as reserved. Every view and list
  item carries a `headline` that composes request, execution and unit facts. For example, a
  charged request reads **Completed**, not "Reserved"; the protocol state stays `reserved` as
  a historical fact. The workspace, Recent uses and Activity all show the same headline.
- **After cancelling (003r1).** A cancelled or expired request's authorization stays valid on
  the contract until its accept deadline. Its unit allocation stays guarded until that block
  time has passed, or until the contract shows the sequence used (`skip_hold_seq`). The barrier
  is unchanged.
  - The view now carries `next_use`: `wait` until the deadline, by the server clock, or `check`.
  - The page offers **Check again** (a read; nothing is signed or created) instead of a new
    request, and says until when.
  - A new request refused inside the window returns `409 previous_window_open` with `{request_id,
    until_ms}`. The page keeps the typed draft and offers **Check again and review**.
  - There is no polling and no automatic replacement. At the deadline exactly, a request is
    still refused.
- **Public page.** When a published business has released digital offers, the storefront no
  longer says "No offer published yet" beside them. It says the product is offered above and
  nothing else is open to book. No readiness is inferred.
- **Strict answers.** A malformed answer changes nothing. A 404 on one's own request clears the
  request, result and draft.
- **Accessibility.** Status changes are announced (`role="status"`, `aria-live`). The layout is
  three columns on wide screens, two at 1240 px, one at 760 px, with long names and outputs
  wrapping. Motion follows the existing reduced-motion rule.

## Composition and states (job 001j)

Claude, 2026-11-04. Authority: [001j](../astra/jobs/2026-11-04_001j_customer-product-composition.md).
Baseline: [CustomerCompositionReview](../astra/2026-11-04_CustomerCompositionReview.md) and its
two screenshots.

**Not changed:** `CustomerWorkspace`, the API, the envelope check, the authorizer, units, retention
and every recovery rule. This job changes composition and wording. The rules for the active step are
pure (`web/src/customerView.ts`).

```
header   business · product · what it does: input → output · each use · results kept
steps    1 Your document · 2 Review and authorize · 3 Run · 4 Your result   (status in words)
grid     [ active step: document / review / run / recover, ONE primary action,
           provenance note ]  [ result ]  [ your unit ]
                                                       [ recent uses ]
phone    active step → your unit → result → recent uses (DOM order; no visual reordering)
```

**The steps (`customerSteps`).** Each step is Completed, Current, Waiting, Stopped or "Needs
checking", always as a word plus a distinct outline:

| Step | Completed | Current | Stopped / Needs checking |
|---|---|---|---|
| Your document | a request exists | no request yet (also: recovering a lost one) | — |
| Review and authorize | the contract holds one unit (`reserved`) | prepared and checked; or sent and awaiting the contract | Stopped: the browser check failed, or the request was refused, unresolved, cancelled or expired |
| Run | the run completed | reserved and not run; running (never run twice) | Stopped: failed, cancelled or unknown; or the unit was returned without running |
| Your result | a complete extraction is shown | a result is ready to show or being saved | Needs checking: an incomplete, refused or unusable answer is shown. Stopped: no result, or removed after retention |

"Completed" for the result means every required field was found (`extracted`). An incomplete or
refused answer is never styled or worded as success.

**One home per fact:**
- **Preview provenance:** one short note in the active step card, beside the action it qualifies.
  The app shell's preview strip stays. The large dark banner is removed.
- **Offer summary** (header, from the offer only): input is pasted text up to `max_chars`; output
  is the declared fields; each use is one unit of exact base units of the asset; the result
  retention.
- **Review terms:** all kept (product, document, one unit, price, retention, account and network,
  authorize-by, browser check). Hashes, the contract account, the hold number and the serve/settle
  deadlines move into an expandable "Technical details"; the browser still computes and checks them.
- **Retention** is worded as this product's policy for the result you can open here, not a claim
  about copies kept elsewhere.
- **Units:** the existing source-qualified states, read with block and time; "not read yet" is not
  zero.
- **Empty result:** a compact placeholder naming the declared fields; no 360px blank card.

## Disposable preview

```
npm run web:build
npx tsx scripts/preview-customer.ts
```

- **Site:** `http://127.0.0.1:8812/b/ledgerline` (Use this product), or the printed `/use/<offer>`.
- **People:** switch with the acting-context menu (local preview):
  - **Cara Okafor**: the customer, 100 units on the chain double;
  - **Ava Chen**: the owner;
  - **Noah Fenn**: the buyer after `/sale`.
- **Controls** on `http://127.0.0.1:8813/`:

  | Request | Effect |
  |---|---|
  | `GET /` | The state |
  | `POST /lose/prepare` (or `confirm`, `execute`, `units`) | The next such answer is lost after the server acted |
  | `POST /storage/fail` | The next result protection fails |
  | `POST /hold/expire` | The clock moves on 11 minutes |
  | `POST /key/revoke` | Revokes the customer's key |
  | `POST /provider/fail` | The next run fails at the provider |
  | `POST /authorizer/off` (or `on`) | Switches the preview authorizer |
  | `POST /sale` | Ava's business goes to Noah, with the platform's METERING regranted |

- **Cleanup:** Ctrl+C. Everything is in memory; nothing remains, and nothing is ever sent.

**Everything is synthetic.** The preview uses:
- the real app and routes;
- the labelled TypeScript chain double, seeded from contract JSON;
- the scripted extractor and in-memory protection from `server/test/customer-world.ts`;
- a preview-only signer (`/__preview/sign` on the preview server, not the app) holding the
  contract tests' seed-1 key, injected into the preview's own HTML only.

It is not a live NEAR transaction, a wallet or a model.

## Limits

- **Production signing and identity are unavailable** by design. Wallet sign-in and live wiring
  are later, separately authorized work.
- **The input is never stored in the browser.** After a reload, the same document must be pasted
  again before authorizing a request that is still only prepared.
- **Product summaries** come from the released artifact's declared fields and input limit only.
