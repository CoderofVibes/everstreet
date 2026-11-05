# Portfolio (005d, M5)

November 5, 2026, Claude, under Tony's direct build mandate. Acquire → Portfolio (`/portfolio`),
`GET /api/me/portfolio`, `PUT /api/me/portfolio/:businessId/note`.

## Data authority map

| Section | Who it's for | Source | Shown |
|---|---|---|---|
| Owned | businesses the viewer controls now (`owner_id`) | `ownership` (how control arrived), products/releases/offers counts, `economics()` for this month and obligations, `currentCustomerWork` | identity; founded vs received (with the recorded close's tx or deal); products; this month per asset in exact base units; prepaid uses owed (unknown when not derivable); attention items and the first as the next action |
| Considering | listings the viewer's buyer teams shortlisted (owner or member) | `shortlist`, `listings`, `buyers` | named listings: the business's name; anonymous or private: "An anonymous listing" with no business id or name |
| Former | businesses the viewer passed on (`ownership.from_id`) | `ownership` | when and to whom control moved. No figures, products or customer data |
| Notes | the viewer only | `portfolio_notes`, `portfolio_note_history` (append-only) | a label (core, watch, improve, exit, research) and a note, version-checked |

**Rules:**
- Figures stay in each business's own units: nothing is summed across currencies, and no
  valuation or profit is made.
- A figure that can't be read is `null` ("unknown"), never 0.
- A note can be set only for a business in the viewer's portfolio; everyone else gets 404.
- Changing hands moves the business between Owned and Former immediately; the buyer sees it as
  "received".
- Team roles in buyer organisations see shortlists they are members of; removing a member removes
  that view (it is read live from `buyer_members`).

## Evidence

`server/test/portfolio.test.ts` (2), through the real routes:
- owned/considering/former: founded vs received by close; an anonymous listing stays anonymous;
  the former entry's keys are history only;
- notes: versioning, conflict, append-only history, an unrelated person refused, privacy.

## Not done

- A comparison table across owned businesses beyond the cards.
- Filters.
- Live portfolio composition of buyer-side open sales (v3 offers in progress).
- The 1440/1280/390 browser passes.
