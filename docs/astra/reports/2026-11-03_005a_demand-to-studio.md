# 005a report: published requests become private product projects

Claude, 2026-11-03. Job: [005a](../jobs/2026-11-03_005a_demand-to-studio.md).

| Commit | What |
|---|---|
| `9439b78` | Server: `server/src/opportunities.ts` (new), `server/src/projectSource.ts` (new), `products.ts`, `community.ts`, `app.ts`, `db.ts`, `server/test/opportunities.test.ts` (new) |
| `3fc4af5` | Web: `web/src/opportunitiesApi.ts`, `web/src/opportunityReview.ts`, `web/src/pages/Opportunities.tsx` (all new); `App.tsx`, `Explore.tsx`, `Find.tsx`, `ProductStudio.tsx`, `productsApi.ts`; `web/test/opportunityReview.test.ts` (new) |

Not done: live AI calls, builds started on their own, contacting the requester, publishing,
external connectors, billing, runtime, contracts or deployment.

## What it does

**The Opportunities board** (`/opportunities`, in the rail under Discover; Explore's needs tab
links to it with "Build for these") lists the existing open needs. No second request system was
made. Each card shows:

- the request text, posted date, open-until date, reply count, and whether replies are welcome;
- the stated price limit, labelled as what the requester said they'd pay, "not a product price,
  a development budget or income";
- a visible word classification: NEAR app, AI agent, AI tool, API, SaaS or web app, website,
  online service, or not recognized. It shows the words it used and says it is a guess from the
  words, not an AI judgement;
- for a signed-in founder, a match with one of their businesses, explained only by the words they
  share;
- two separate actions: **Reply with a published business** (the existing `NeedCard` flow and
  consent rules, unchanged) and **Explore building this**.

There are no counts, market sizes or values, and empty, loading and error states are their own
screens.

**The review step** (`/opportunities/:id/build`, keyed by person and request):

- The public request, with every stated constraint (kind, price limit, online, confirmed only)
  and its classification.
- An editable idea that starts from the request text, a foundation (suggested, changeable), a
  working name, and the destination: one of the founder's businesses or a new private business.
- A notice that this creates a private starting brief, sends no reply, doesn't contact the
  requester, doesn't reserve the request, and doesn't start a build.
- **Create project** opens the existing studio. The brief's problem is the founder's idea, its
  price stays "undecided", and revision 1's note says "inspired by a publicly shared request".
  From there the founder uses the normal guided authoring flow.

**In the studio**, a collapsible panel "Inspiration from a publicly shared request" shows:

- the captured text, captured date, posted and open-until dates, and any stated price limit;
- the request's live state: still open, closed by the person who posted it, expired, or no longer
  available;
- what was and wasn't kept;
- a link to reply only while the request is open and allows replies.

**Find** now has digital-first examples (an invoice API, a support-triage agent, a SaaS
dashboard, a NEAR app). The software kind is listed first as "Software, AI, API or online
service". The field and its explanation say the reading is a simple word match, not AI. Server
search now reads AI-tool, SaaS, agent, API, website and NEAR vocabulary as software, and
recognizes "AI" itself. Class detection stays first, so the legacy printmaking test is unchanged.

## Data and routes

**`project_sources`** has one row per project:

- the need id, the public text, the constraints, reply consent, and the posted and expiry dates,
  plus the capture time;
- never the requester's id, name or contact, other founders' replies, or searches.

It is keyed by project, so it follows the business through a sale.

**Retention after closure:**

- The snapshot stays with the project, as the founder's record of what inspired their own work.
- The live state is read on each view. Once the request is closed, expired or removed, its id is
  no longer given out and replying is unavailable.
- A removed request shows as "no longer available". Nothing about it is reconstructed.

**`need_project_requests`** maps (person, request key) to a request hash and the project. It is
the same pattern as `import_requests`.

| Route | What |
|---|---|
| `GET /api/opportunities` | Open, unexpired requests, decorated as above. Public; matches only for the signed-in viewer's own businesses. |
| `GET /api/opportunities/:id` | One open request; 404 once it is closed, expired or removed |
| `POST /api/opportunities/:id/projects` | Signed in. Body: `{ idempotency_key, idea, foundation, name, business_id \| null }`. 201 when created, 200 on an exact replay. |

**Creating a project** happens in one transaction:

- The key must be 8–80 letters, digits, `-` or `_`.
- The same key with the same input returns the same project (`created: false`); the same key with
  different input is 409.
- The destination business is checked with `controlEpoch` and rechecked with `stillControls`
  inside the transaction. Someone else's business is 404.
- The request is rechecked inside the transaction: removed is 404, closed is 409 ("has closed
  it"), expired is 409. Nothing is created in any of these cases.
- A replay answers through `Products.view`, so after a sale the former owner's replay is 404.
  Keys belong to the person who used them.

`Products.create` now shares a new `insertProject` with the bridge. Its behaviour is unchanged,
and the existing product tests pass.

**Web orchestration** (`ReviewController`):

- The draft is filled from the request once, and a later load never overwrites typed text.
- A second click while sending sends nothing.
- No answer (a network failure or a 5xx) leaves the attempt "unknown". **Create again** resends
  the same key and input and finds the same project.
- Editing after an unknown outcome starts a new key, and the page says so.
- A closed, expired or removed request shows as gone, and nothing more is sent. A business that
  isn't yours is a refusal to correct.
- Leaving the page (or another person acting, because the route is keyed by person) drops late
  answers.

## Evidence

`server/test/opportunities.test.ts`, 14 API tests on fictional people (Noah, Mara, Ana):

- **The board.** It shows the constraints, expiry, reply consent and classification, and never
  the requester's id or name. Matches appear only through the viewer's own businesses.
- **Create once, contact nobody.**
  - The studio view carries the provenance, and a new private business is made.
  - No need response is added, and the reply count is unchanged.
  - The requester's id and name, and another founder's earlier reply text, are absent from the
    project.
  - Reopening the project works.
  - The requester's activity shows nothing.
- **Retries.** An exact retry returns the same project; a key mismatch is 409; a different key
  makes another project.
- **Invalid input.** Seven invalid or oversize inputs are each 400, and signing out gives 401.
  Nothing is created.
- **Unavailable requests.** Closed (409), expired (409), removed (404) and a missing id (404) are
  each reported, with nothing created.
- **Destination business.** Someone else's business is 404; the founder's own is used.
- **No-replies requests.** A project can still be created, `can_reply` is false, and replying is
  still 409.
- **After closure.** The snapshot is kept after the request closes, and a removed request shows as
  unavailable, without its id.
- **Ownership.** After a transfer, the buyer has the project and source; the former owner's replay
  and read are 404; the buyer's own key is independent.
- **Isolation.** Other people can't read the project, and the board carries none of its ids or
  names.
- **Search.** The digital vocabulary is read as software, while printmaking is still a class and
  bike repair a service. Classification covers all kinds, and the search finds a published digital
  business.

`web/test/opportunityReview.test.ts` has 9 controller tests covering the orchestration rules
above.

**Mutation checks** (each reverted):

| Mutant | Result |
|---|---|
| Replay ignores the input hash | The mismatch test fails |
| Create ignores a closed request | The closure test fails |
| An unanswered Create always mints a new key | The lost-response test fails |

While writing the tests I found that the match words included common words and missed plurals.
They now use the search's own word folding (`terms`).

```
npm run check        Test Files 37 passed (37); Tests 468 passed (468)
npm run web:build    built (existing chunk-size advisory only)
```

## For Astra's browser and keyboard review (1440, 1280, 390)

I didn't use a browser. The pages are covered by type-checking, the build and the controller
tests, not by a DOM test. A disposable setup that doesn't touch runtime data:

1. Serve `everstreetApi(new Store(openDb(":memory:")), { localPreview: true, environment:
   "preview" })` with the built web app, the same way as the 004a2 review.
2. As Noah (`POST /api/session {"name":"Noah Fenn"}`), post fictional requests with
   `POST /api/needs`:
   - "An AI tool that reads supplier invoices and sends the totals to my accounting app, under
     $50 a month", with `constraints {family:"software", max_price_cents:5000, online:true}` and
     replies allowed;
   - "A website that lists my workshop dates online", with `allow_replies:false`.
3. As Mara (`POST /api/session {"name":"Mara Solis"}`), publish a business with the recipe in
   `ledgerline()` in `server/test/opportunities.test.ts`: the project, its answers, family
   software, then publish. Switch people with `POST /api/session/as/:id` (local preview only).
4. Things to check:
   - `/opportunities`: both actions, the price-limit wording, the no-replies card, and the matches
     line for Mara.
   - Explore building this: the review step, every constraint shown, typing, a destination
     business, Create, landing in the studio, and the source panel.
   - Close the request as Noah and reload the project (the state should read Closed); delete the
     need row in the in-memory database for Unavailable.
   - Stop the API mid-Create, then use Create again (same request).
   - `/find` examples and keyboard order.

## Still open

- **Not real demand.** The classification and matches are word heuristics. Nothing verifies that
  a request is real or that the requester will buy.
- **Unresolved gate.** Opportunities still sit beside the Explore needs tab rather than replacing
  it. Whether the classic tab should go is Astra's and Tony's call.
- **Gaps against the vision.** Expert help, portfolios, living profiles, delegated operators and
  financial intelligence (the rest of M5) aren't built. Live AI and builds remain M2's gates; live
  NEAR remains M3's.

No M5 or studio completion is claimed. All six milestones stay open. Stopping here for Astra's
review.
