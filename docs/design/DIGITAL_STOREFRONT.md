# The digital storefront and owner-reviewed examples (job 001e)

Claude, 2026-11-04. Authority: [001e](../astra/jobs/2026-11-04_001e_digital-storefront-experience.md).
Written before the code. It changes local product functionality and presentation only. Nothing is
published outside this computer.

## One storefront for a digital business

When a business has a published digital profile, its public page (`/b/:slug`, same URL) leads
with one header:
- an eyebrow with the kind (the first product's family);
- the business name as the only `h1`, with the published headline as its promise beneath it;
- who it helps;
- "by" the founder, linked as before;
- one availability pill;
- one primary action:
  - **Use \<product\>** on the first product with a Use target (the actual `/use/:offer` route);
  - otherwise **Follow for updates**, when nothing is open.

After the header, in order:
1. the **example**, if published;
2. **capabilities**;
3. **products** (each with its own Use action or honest status);
4. the existing sections, unchanged in meaning: about, updates, who runs it (including the
   ownership history), numbers (only if the founder shared them) and report;
5. on a mixed business, its legacy offering as **Also offered**, with its booking and question
   flow intact.

**Removed for digital pages:**
- the separate small profile card;
- the duplicate hero, title and status;
- the "Use a product above / Nothing else is open to book here" placeholder;
- the zero-follower line (the follower count shows only when above 0);
- the "Numbers … if the founder chooses" placeholder.

No acquisition terms appear on the customer page.

**Unchanged:** legacy pages and their routes.

## The example: deliberate, fictional, text only

The draft gains an optional `example`:

| Field | Limit |
|---|---|
| product | one of the draft's featured products |
| input | plain text, up to 1,200 characters, newlines kept, other control characters removed |
| outputs | 1–8 rows: a label up to 40 characters and a value up to 200 |

It is authored by the owner in the editor, with guidance to use invented content. It is never
filled automatically from customer documents, results, evaluation fixtures, prompts, drafts or
artifacts. It is text rendered as text: no HTML, links, images or code execution. **Remove
example** sets it to null.

It is part of the snapshot, so 001d1's review identity covers it. Saving changes only the draft,
publishing shows exactly the reviewed example, and removing it and publishing takes it down.
Publicly it carries the product's reviewed name and a fixed label: "Illustrative example written
by the business. Not a live run; results from the real product can differ."

**Storefront control:** two tabs, **Example input** and **Example result**.
- They are a real tab list with arrow-key, Home and End support and a visible focus.
- The result is a definition list of the owner's rows.
- There is no animation and no "running". The **Use** action beside it is the real route.

## Discovery and the editor

- **Discovery cards** (Home and Explore) show the live headline, the availability and the first
  capability. They show an "Example included" chip only when an example is published. No stats
  are invented.
- **The editor** adds an Example section:
  - choose a featured product, write the input, add or remove result rows, or remove the example;
  - a **View live page** link appears when the page is published (the owner view gains the
    business `slug`);
  - "Saved version N / Live version M" stays visible.

## Preview

The publication preview keeps its states:
- Ava: digital, unpublished at start, to draft an example and publish it;
- Bea: brief-only, coming soon;
- Dee: legacy.

A test drives creating an example, publishing it, finding it, Use, editing the draft privately,
removing the example and republishing.
