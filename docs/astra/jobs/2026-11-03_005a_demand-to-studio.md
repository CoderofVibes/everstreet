# Turn a real customer request into a private product project

**Why (Tony):** Everstreet brings builders, investors and clients together; people should arrive
with an idea and build with AI inside the platform. Connect published demand to the existing
approachable studio without pretending a request is a contract, a customer or verified demand.
This is a first bounded M5 slice alongside the continuing M2/M3 work, not a replacement roadmap.

## What the person sees and does

Make the existing Explore needs board useful to digital builders. Give it a direct, discoverable
Opportunities entry and a clean focused view using existing tokens: request text, stated price
limit/constraints, expiry, response availability and explainable matches. No invented market
size, lead value or revenue. Empty/loading/error states are deliberate, not fake sample activity.

Keep two distinct actions: respond with an existing published business (current consent rules),
or **Explore building this**. The latter opens a review step showing the public request and
editable idea, foundation and destination business (or a new private business). Explain that
this creates a private starting brief, sends no reply and does not reserve the request. After
explicit Create project, open the existing studio with an editable brief and source context.
The founder can inspect/correct assumptions and use the normal guided AI authoring flow; do not
automatically start a paid build. The originating request's budget is a stated customer price
limit, not a product price, guaranteed income or development budget. Never infer a commitment.

The source panel in the project identifies this as inspiration from a publicly shared request,
with captured date and current open/closed/expired/unavailable state. Existing private chats,
requester identity, contact, responses and search history are never copied. Creating the project
does not contact the requester. No automatic publishing, replies or messaging in this task.

Update Find's visible printmaking/bike/carving examples and its search vocabulary for AI tools,
SaaS, agents, APIs, websites, NEAR apps and online services. Preserve legacy class tests/routes,
but make the primary experience fit the authorized audience. Classification remains a visible
editable heuristic, not AI inference or an expertise claim. Do not silently discard budget or
other hard constraints when opening the review step or refining results.

## Underneath

Read Community.openNeeds/postNeed/respond/closeNeed and Products.create, existing Build composer,
Explore/NeedCard, Find, app routes and owner control-epoch helpers. Reuse needs and product
projects; don't make a second request system. Add only the bridge and view needed here.

Persist a bounded provenance record for the project: source need ID, public text/constraint
snapshot and captured time. Associate with the business/project so it follows business control,
not the former owner's account. A removed source is labelled unavailable; don't reconstruct its
identity. No publicly visible link to a private project or creator, and no response-count increase.
Document what snapshot is retained after request closure. The project is the founder's separate
work, not a continuing entitlement to the requester's later information.

Creation must be transactional/idempotent with a bounded request key, exact replay checks and
current source availability check. A lost response/retry must return the same private project,
not create another business/project. Recheck current destination ownership and request status
inside the transaction. Preserve authorization on replay after a sale (former owner cannot
recover the successor's project). Same-key different input is a conflict. Handle closure/expiry
between review and create truthfully; do not silently create from a now-unavailable source.

Fence UI requests on actor/route changes and protect typed-ahead drafts from stale answers.
Prefer extending existing components; avoid unnecessary dependencies. No external connectors,
live AI calls, new billing, runtime execution, seed-runtime writes, contract or deployment work.

## Done when

With fictional API fixtures: publish a digital need, read it without requester identity, review
it into an editable project, create once, reopen with provenance and use the existing studio.
Verify exact retry after lost response, different-key behavior, key mismatch, invalid/oversize
input, missing/expired/closed source, unauthorized business, no-replies request (private ideation
allowed, contacting disabled), no private identity/response leakage, ownership transfer/replay and
independent tenant access. Check search/refinement classification with digital vocabulary while
legacy behaviors remain. Tests should exercise API and orchestration, not only mapping helpers.

Check/build, report route/data changes and actual evidence. Prepare convenient isolated fictional
fixtures or clear API setup instructions for Astra's1440/1280/390 browser and keyboard review;
do not touch runtime data. Local bounded commits. Stop for Astra review after005a. No M5 or whole
studio completion claim. Remaining integrations, experts, portfolio, M6 and live NEAR stay open.

Priority P1/M-L. After004a3 and003h1.
