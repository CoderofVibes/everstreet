# 005a1 report: the original request stays recoverable, and request metadata is bounded

Claude, 2026-11-03. Job: [005a1](../jobs/2026-11-03_005a1_demand-recovery-and-inputs.md).

| Commit | What |
|---|---|
| `1fac1fe` | Server boundary: `server/src/needConstraints.ts` (new), `community.ts`, `opportunities.ts`, `projectSource.ts`, `store.ts`, `app.ts`, `db.ts`, `server/test/opportunities.test.ts` |
| `dab5a0d` | A formatting-only follow-up to the same test file |
| `0dd476a` | Web: `web/src/opportunityReview.ts`, `web/src/pages/Opportunities.tsx`, `web/src/opportunitiesApi.ts`, `web/src/api.ts`, `web/src/pages/ProductStudio.tsx`, `web/test/opportunityReview.test.ts` |

One process slip. I committed `1fac1fe` in the same command as a check whose formatter step had
just failed: the commit was chained with `;`, so it ran anyway. Its tests and types passed; only
the formatting of that test file was off. `dab5a0d` fixes it, and the full check passed before
that commit. I now read the check output before each commit.

## Both findings reproduced, then fixed

### Input and projection boundary

Before the fix, the API tests below failed the way Astra described. `POST /api/needs` stored
whatever `constraints` it was given, and 005a copied that into project sources. I confirmed this
by temporarily restoring raw storage as a mutant: 3 tests fail.

**One definition.** `server/src/needConstraints.ts` holds it:

| Field | Allowed |
|---|---|
| `family` | `class`, `service`, `product` or `software` |
| `max_price_cents` | A safe whole number of cents, from 0 to 100 000 000 |
| `online` | `true` or `false` |
| `confirmed_only` | `true` or `false` |

`community.ts` and `projectSource.ts` now use this definition; their duplicate interfaces are
gone.

**New requests** go through `parseNeedConstraints`:

- Wrong shapes are refused: a scalar, an array, a nested value, the wrong type.
- Unknown keys are refused.
- Negative, fractional, unsafe or over-limit amounts are refused.
- Each refusal is a 400 with `code: "invalid_constraints"` and a useful message. A huge key is cut
  to 40 characters in the message, never echoed in full.
- A `false` flag is simply not stored.

**Stored rows** go through `projectNeedConstraints`, which applies to older rows too:

- **Where it applies:** the board, the review step, the poster's own view, the project created
  from a request, and every display of a project's source.
- **Only allowed, valid fields survive.**
- **Anything else is unreadable.** It is named in `constraints_unreadable` (a field name, or
  `other` for unknown keys or an unparseable row) and is never shown.
- **An unreadable limit isn't used.** It is never treated as met or as zero; the page says "a price
  limit was stated but can't be read, so none is assumed".
- **Bad rows can't crash a view.** A malformed or non-JSON row doesn't crash anything.
- **Project snapshots.** They now store only the canonical fields, plus a new
  `project_sources.constraints_unreadable` column, added with `ALTER` for existing databases.
  Snapshots written by 005a with extra fields are projected again whenever they are shown.

A customer's price limit is still only that: it never becomes a product price, a cost or income.

### Recovery

Before the fix:

- Editing while a Create was unanswered dropped the same-request recovery.
- The copy both promised the same request and said "new request".

I rewrote `ReviewController` with these rules:

- **The original stays recoverable.** An unanswered Create is kept as the original request (its
  exact key and input), separate from the editable draft. Typing never removes it.
- **Check original request resends exactly that.** It always resends exactly the original, never
  the newer text. Repeated checks that get no answer keep the same key.
- **No accidental second project.** While the original is unresolved, Create is not offered and
  sends nothing.
- **Recovery never discards edits.** A project that is found or made opens only if the draft
  still matches what was sent. Otherwise the newer edits stay on the page, with **Open the
  project** and an explicit **Make a separate project from my edits** (a new key). The same rule
  covers a success that arrives while the founder is typing.
- **A refusal is not an unknown.** The server's `code` decides "gone" (`request_closed`,
  `request_expired`, `request_removed`, `request_unavailable`). Text matching on messages is gone,
  and `ApiError` carries the code. If the request closed before a project was ever made, the check
  says so plainly. If the server had already made it, the exact retry still returns it after
  closure; that is tested on the server.
- **Reads are fenced.** Each read is sequenced: an older read finishing last is ignored, and once
  a request is gone no read reopens it. Leaving the page, or another person acting (the route is
  keyed by person), still drops late answers.
- **Choice lists fail visibly.** Foundations and businesses load through the controller. A failure
  shows a message and Try again; it never shows an empty list as if the founder had no businesses.
  Create needs the foundation list, so no invisible default foundation is ever sent.
- **Shorter copy.** The request, the price-limit line, reply permission and the actions come
  first. The classification and "What the project keeps" are behind expandable details. The
  opportunities list gained a Try again after a load error.

## Evidence

**`server/test/opportunities.test.ts`: 20 tests, 6 new.**

- **15 invalid constraints are refused.** Each gets a 400 with its code, and nothing is stored.
  The cases:
  - a scalar, a string or an array;
  - a nested `family`, or an unknown `family`;
  - a 10 000-character `family`;
  - a fictional contact field;
  - a 10 000-character key;
  - a price that is -1, 12.5, 2⁵³, 10¹² or the string "5000";
  - `online: "yes"`, or `confirmed_only: 1`.
- **Valid values are stored exactly:** a zero limit, full constraints, an empty object, and
  `online: false`.
- **A legacy row is projected.** The row has a negative price, `online: "yes"`, a fictional
  contact and a 10 000-character payload. The board, the review, a new project's source, the
  stored snapshot and the poster's activity show only `{ family: "software" }` with
  `unreadable: [max_price_cents, online, other]`. Neither the contact nor the payload appears
  anywhere.
- **Bad rows don't crash.** Unparseable and array rows break nothing: not the board, the review,
  the poster's view or creation.
- **A 005a snapshot with extra fields** is cleaned when shown.
- **Codes:**
  - `request_closed`, `request_expired`, `request_removed`, `key_reused` and `request_unavailable`
    each come back as their code;
  - a committed retry after closure returns the same project;
  - there is one project and no responses afterwards.
- **Legacy workflows still pass:** the Phase 2 needs, respond and close tests, and the full server
  suite.

**`web/test/opportunityReview.test.ts`: 15 controller tests, 10 new.** They cover:

- a committed-but-lost reply with typing before and after: the exact original is resent, the edits
  are kept, and the page doesn't navigate;
- direct open when there are no edits;
- repeated unanswered checks keeping the key;
- a late success while typing, then an explicit separate project with a new key;
- source closure: found if it was already made, otherwise a coded refusal;
- codes rather than wording deciding "gone";
- reordered reads, and gone staying gone;
- foundation and business list failure, then retry;
- out-of-order choice-list answers.

**Mutation checks** (each reverted):

| Mutant | Failing tests |
|---|---|
| Check sends the current draft | 1 |
| Newer edits ignored at success | 2 |
| Raw constraint storage | 3 (server) |

```
npm run check        Test Files 37 passed (37); Tests 480 passed (480)
npm run web:build    built (existing chunk-size advisory only)
```

## For Astra's browser repeat

I didn't use a browser. Things to check:

- Create, then stop the API, type, and **Check original request**. You should see the link, the
  kept edits, and the separate-project choice.
- A legacy malformed need on the board and in the review step.
- A failing foundations or businesses call.
- The 1440, 1280 and 390 widths. The layout and classes are unchanged; only the copy and the
  notices moved.
- Keyboard selection of the foundation radios. I didn't verify it, and Astra noted it was
  unconfirmed.

Full M5 stays open.
