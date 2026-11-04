# 003q report: customer product workspace

Claude, 2026-11-04. Job: [003q](../jobs/2026-11-03_003q_customer-product-workspace.md).
Commit `cf9e5f8`. Design: `docs/design/CUSTOMER_WORKSPACE.md`. After 003o1 (`4d59127`).

## What exists

- **Pages:**
  - `/b/:slug` gains **Use a product**, shown only for a published business with active offers;
  - `/use/:offer` is the workspace;
  - `/uses/:id` is a durable resume link;
  - `/activity` gains **My products** and **Recent uses** ahead of the legacy sections (bookings,
    needs, follows and messages are unchanged);
  - Home's cost line is corrected: operating costs are founder-entered, and the runtime AI cost
    is recorded from reported usage where a runtime is connected.
- **API reads, all bounded:**

  | Route | Behaviour |
  |---|---|
  | Public offers by business | Published businesses only; an unpublished one is 404 |
  | Public offer by id | 404 unless active and published; no guessing |
  | `GET /api/customer/uses` | The caller's own requests, at most 50. No envelope, salt, signatures, input or result; retired offers still listed. |

  The request view now carries its offer's public summary.
- **The workspace:**
  - one primary next action (`nextStep`);
  - a consent review: product, document size and digest, exactly one unit, the exact price in
    base units and asset, retention, account and network, and the authorize-by time;
  - **the browser's own check** before the authorizer is called: WebCrypto, the contract
    encoding, input commitment, fingerprint, both messages, envelope digest, terms, key and
    deadline;
  - a result shown as readable fields, with notes, issues, problems and refusal reason;
    customer-initiated copy and download;
  - the unit shown as the contract's view reported it (`free`/`consumed`, block height and time).
  - Distinct plain words for running, saving, unavailable, unknown, charged, returned, conflict
    and not-known. Unknown states offer "check again", never a second request.
- **Authorization.** `customerAuthorizer.ts` uses only a page-provided
  `window.__everstreetAuthorizer`. Production has none, and says so (`AUTHORIZATION_UNAVAILABLE`).
  **The normal bundle has no key or signer.** A scan of `web/dist` for the seed-1 public key, the
  PKCS8 prefix, `/__preview/sign` and the preview label finds nothing.
- **The controller** (`customerWorkspace.ts`):
  - one action at a time;
  - a generation counter, so late answers land nowhere;
  - routes keyed by the acting person;
  - the draft separate from the accepted document;
  - same-key retry after a lost prepare answer;
  - only `{key, request id}` in session storage (no document or envelope; tested);
  - strict answer parsing, so a malformed answer changes nothing;
  - a 404 clears the request, result and draft.

## Preview for Astra's browser review

```
npm run web:build
npx tsx scripts/preview-customer.ts
```

- **Site:** `http://127.0.0.1:8812/b/ledgerline`.
- **People:** Cara (the customer, 100 units), Ava (the owner), Noah (the buyer after `/sale`),
  switched with the acting-context menu.
- **Controls** on `http://127.0.0.1:8813/`:

  | Control | Effect |
  |---|---|
  | `POST /lose/prepare` (or `confirm`, `execute`, `units`) | The next such answer is lost after the server acted |
  | `/storage/fail` | The next result protection fails |
  | `/hold/expire` | The clock moves on 11 minutes |
  | `/key/revoke` | Revokes the customer's key |
  | `/provider/fail` | The next run fails at the provider |
  | `/authorizer/off` (or `on`) | Switches the preview authorizer |
  | `/sale` | Ava's business goes to Noah |
  | `GET /` | The state |

- **Cleanup:** Ctrl+C; it is all in memory.
- **What it is.** Fictional and synthetic throughout:
  - the real app with the labelled chain double, the scripted extractor and in-memory
    protection;
  - a preview-only signer injected into the preview's own HTML.

  No wallet, model, RPC, credentials or runtime database.
- **Not launched here.** I did not start the two listeners in this session (starting a loopback
  listener needs approval). The scenario they serve is driven end to end through its site's fetch
  in `server/test/customer-preview.test.ts`.

## Tests and checks

- **Envelope** (`web/test/customerEnvelope.test.ts`):
  - the contract fixture's hold and use bytes;
  - a real envelope accepted;
  - every alteration refused: another document (exact reason), another key, too late, price,
    units, serve time, message, salt, digest, account, a malformed registration.
- **Controller (8)**, against the real API:
  - review → authorize → run → result → settle → next (one provider call, one settle, the double
    charged 1, `hold_seq` 2 next);
  - typing ahead doesn't change the request;
  - a lost prepare answer: same key, one row;
  - a reload resumes from storage and needs the same document;
  - no authorizer: the review works, authorizing is unavailable, nothing is sent;
  - a wrong key is never asked to sign;
  - a malformed answer changes nothing, and access loss clears everything;
  - a late answer after retirement lands nowhere;
  - a retired offer can't start, but one's own request resumes.
- **Reads (3):**
  - unpublished: 404 by list and id;
  - published: exact terms, and retirement hides it;
  - the list is own-only, bounded, with no private fields; others, the owner and no session see
    nothing; retired offers still listed.
- **Preview scenario (2):**
  - 100 → one use → 99, with the envelope checked as the page does; the result is still Cara's
    after the sale; Ava and Noah get 404; the next use leaves 98;
  - a lost answer recovers the same request, and the authorizer can be switched off.
- **Mutants**, one at a time, each restored with an empty diff:

  | Mutant | Caught by |
  |---|---|
  | Input-commitment check | Survived at first: the fingerprint check also refused. I pinned the exact reason, and then it was caught. |
  | Retry key | The lost-answer test |
  | Check gate before signing | The wrong-key test |

```
npm run check        Test Files 55 passed (55); Tests 679 passed (679)
npm run web:build    built
```

No contract or fixture change in 003q, so no Rust run.

## Limits, and what's next

- **Visual review is still to come.** Layout, keyboard order and screen-reader announcements are
  implemented but not reviewed in a browser by me. That's Astra's preview pass.
- **Production authorization.** It needs a wallet integration, separately authorized.
- **After a reload,** a still-prepared request needs the same document pasted again before
  authorizing.

## Session outcome

003o1 and 003q are both in review.

| Commit | What |
|---|---|
| `a232aae` | Astra docs |
| `4d59127` | 003o1 |
| `77dcb03` | 003o1 report |
| `cf9e5f8` | 003q |

No push, live call, signing, deployment, spending or research access. No milestone is claimed.
Stopping for Astra's browser review.
