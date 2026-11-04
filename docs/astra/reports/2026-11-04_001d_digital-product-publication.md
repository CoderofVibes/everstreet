# 001d report: digital product publication

Claude, 2026-11-04. Job: [001d](../jobs/2026-11-04_001d_digital-product-publication.md). Commit
`03f1263`, on top of `5803bb6` (003u1). Not pushed and not published anywhere outside this
computer. No contract, `main.ts`, package, provider, wallet or remote change. The design was
written first: [DIGITAL_PUBLICATION.md](../../design/DIGITAL_PUBLICATION.md).

## What a founder does now

From the desk ("Public profile") or the studio (the status item now reads "Public profile"), the
founder opens `/desk/:id/public`:
1. **Draft.** They write a headline, what it does, who it helps, up to 6 capabilities, and pick
   up to 6 of the business's own products to feature.
2. **Save.** A saved draft is a new revision and never changes what is live.
3. **Review.** The preview beside the draft is the server's exact public rendering of the saved
   revision, using the same component as the public page.
4. **Publish that version.** Publish is disabled while edits are unsaved, while the draft isn't
   eligible (reasons listed), or when this version is already live.

**No legacy offering is needed.** Publishing a digital profile publishes the business page only.
It doesn't publish the legacy offering or idea, change the stage, create a sale listing, or
touch any release, price, plan or authority. The old legacy publish keeps its rule (an offering
title) for legacy businesses.

## What a visitor sees

- **The public page** leads with the profile:
  - an availability pill ("Available to use" or "Not open for use yet") in place of the old
    stage label;
  - the headline, summary, audience and capabilities;
  - the products, each with its released name and family.
- **"Use this product"** appears only while that product has an active customer offer, and links
  to the existing customer workspace (`/use/:offer`). Otherwise the product reads "Released, not
  open for use yet" or "In development".
- **Discovery** (Home and Explore cards, and `discover` search) shows the availability and the
  headline.
- **A mixed business** also shows its legacy offering, labelled "Also offered". **A legacy
  business** is unchanged.

## Safety

- **Owner routes are fenced:** control is checked before the reads and again before any write. A
  former owner gets 404 on view, save and publish after the actual v3 reconciliation (tested).
  The buyer inherits the draft and can edit it; the live profile stays until they publish.
- **Recovery:**
  - a stale save returns 409 `draft_changed`, and the editor keeps the edits and reloads the
    latest alongside;
  - an identical retry after a lost reply is accepted;
  - publishing a revision other than the reviewed one returns 409, and the same one again
    answers "already".
- **The public view is narrow:** product names and families come from released artifacts and
  foundations, never the brief.
- **Canary test:** these were planted and none appear in the public page, discovery or public
  offers output:
  - a private brief edit;
  - a customer's document text;
  - a sale listing (asking price and reason);
  - an unpublished draft edit;
  - the project id.

  The owner's own view does contain the draft canary, which proves it was really planted.
- **Retire and unpublish:**
  - retiring the offer removes the Use target, and the profile reads "Not open for use yet";
  - unpublishing hides the page and its discovery card, and the section itself returns null;
  - the customer's existing result is still readable after both;
  - republishing the same version reopens the page.
- **Bounds:** text lengths (400 over the limit), 6 capabilities, 6 products, own products only
  (`unknown_product`).

## Preview

```
npm run web:build
npx tsx scripts/preview-publication.ts
```

- **Setup:** site on :8826, controls on :8827, 127.0.0.1 only, labelled synthetic. It is built on
  the operations preview.
- **Ava's digital business** is taken down through the route, so its profile starts empty. She
  drafts, reviews and publishes it, and a visitor then finds it on Explore and opens the product.
- **Bea** has a brief-only product, so it can publish only as coming soon.
- **Dee's** legacy class page is published the old way.
- **Test:** `server/test/publication-preview.test.ts` drives draft, publish, discovery, the public
  Use target and the existing customer offer through the site's fetch.
- No listener was left running.

## Checks

- `npm run check`: **887 tests in 90 files**, lint and types clean (874/87 before).
- `npm run web:build`: passes (790.37 kB, the existing size advisory).
- **New tests:**
  - `publication.test.ts` (8): the full flow, draft isolation, retry and conflict, bounds,
    canaries, retire/unpublish/continuity, the sale, and legacy, mixed and brief-only businesses;
  - `publication-preview.test.ts` (1);
  - `web/test/publication.test.ts` (4).
- **Mutants**, one at a time and each restored:
  1. an unreviewed revision published: killed;
  2. the section ignoring unpublished. This first **survived**: the page route already refuses
     unpublished businesses, so the inner check was unreached. I added a direct `digitalPublic`
     assertion, and it was then killed;
  3. a retired offer used as a target: killed;
  4. another business's product accepted: killed;
  5. publishing a dirty draft in the editor: killed.

## Limits

- **Not browser-verified:** no layouts checked at 1440/1280/390, no keyboard pass, no zoom.
- **Unchanged pieces:**
  - the public page still shows the founder, numbers and follow sections as before;
  - the sidebar share kit still uses legacy fields;
  - the legacy studio (`/studio`) still edits the old offering.
- **Discovery** still builds each card from the full public projection (now including the
  digital section). That is fine for the fixture's size, but a large catalogue would want a
  bounded query.
- **Not built:** a separate public product page per product. Use goes straight to the customer
  workspace.
- **Pending:** Astra's Fenn/Ruiz grant and revoke browser step, which I did not perform or
  substitute.
- **All six milestones stay open.** The import, network and broader M6 roadmap is unaffected.
