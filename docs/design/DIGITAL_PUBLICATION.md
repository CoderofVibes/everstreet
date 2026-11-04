# Publishing a digital product (job 001d)

Claude, 2026-11-04. Authority: [001d](../astra/jobs/2026-11-04_001d_digital-product-publication.md).
Written before the code. It is a local feature only. Nothing is published outside this computer.

## Draft and live are separate

A new table, `public_profiles`, has one row per business:
- **draft:** the owner's working copy, with its revision (`draft_rev`);
- **live:** the snapshot customers see, with its revision (`live_rev`), `published_at` and the
  owner generation it was published under.

Saving a draft never changes the live snapshot. Publishing copies exactly the reviewed draft
revision into live.

**Draft fields:**

| Field | Limit |
|---|---|
| headline | 3–120 characters |
| summary (what it does) | 10–400 characters |
| audience (who it helps) | up to 200 characters |
| capabilities | up to 6 lines of up to 120 characters |
| featured products | up to 6, each one of this business's own product projects |

Text is trimmed, and every list is bounded.

**Product labels.** At publish, each featured product's public name and family come from
immutable released facts. The name is the active release's artifact spec name, and the family is
the foundation label. A product without a release is captured as "In development", with the
foundation label. No draft brief, prompt, conversation or provider configuration is read into the
public view.

## Routes

All routes are owner-only. They check control before the reads and again before any write.

**`GET /api/businesses/:id/public-profile`** returns:
- the draft and its revision;
- the live snapshot and its revision;
- the page state;
- the exact public preview the draft would produce;
- whether it can be published, with reasons.

**`PUT .../public-profile/draft`** with `{ base_rev, draft }`:
- saves the draft as the next revision;
- **a stale `base_rev`:** returns 409 with the current draft, so the editor can keep unsaved
  edits;
- **a retried save** whose content equals the stored draft is accepted, so a lost reply is
  harmless.

**`POST .../public-profile/publish`** with `{ draft_rev }`:
- publishes only the revision that was reviewed. A different current revision returns 409;
- the same revision already live answers "already";
- sets the business page's `published_at`;
- does **not** publish the legacy offering or idea, need a legacy title, change the stage,
  create a sale listing, or touch releases, prices, plans or authority.

**Unpublish:** the existing unpublish hides the page, the profile and its public offers. The live
snapshot is kept for a later republish. Customers keep their existing uses and results.

**Ownership:** the profile belongs to the business and moves with a sale. A former owner gets 404
on every route.

## Public view

`publicBusiness` gains a `digital` section, present only when the page is published and a live
snapshot exists:
- the headline, summary, audience and capabilities;
- products, each with its name and family. Each has a **Use** target only when that project has
  an active customer offer right now. Otherwise it reads "Not open for use yet".
- an availability flag (available or coming soon), derived the same way;
- the published time.

**Never in it:** no draft fields, ids beyond the active offer id the existing customer route
needs, customer counts or costs, acquisition listing, asking price or buyer.

**Discovery** (`discover`) searches the live headline, summary and capabilities too.

**Pages and cards:**
- The page and the discovery cards lead with the digital section: an availability pill instead
  of the old stage label, and the headline instead of an offer title.
- A mixed business also shows its published legacy offering, labelled "Also offered".
- A legacy business is unchanged.

## Browser

**Editor** at `/desk/:id/public`, linked from the desk and the studio:
- the route is keyed by actor and business;
- the draft keeps unsaved edits across reloads and conflicts;
- a server-computed preview of exactly what customers would see;
- Publish this version, using the reviewed revision;
- the live status, and Unpublish through the existing route.

## Preview

`scripts/preview-publication.ts`, labelled synthetic:
- Ava's digital business starts unpublished, with a released and offered product;
- Bea is brief-only, and can publish a coming-soon profile;
- Dee runs a legacy class business, published the old way;
- a test drives draft, review, publish, discovery and Use through the site's fetch.
