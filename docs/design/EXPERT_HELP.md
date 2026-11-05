# Expert help (005c, M5)

November 5, 2026, Claude, under Tony's direct build mandate. Human expert engagement, separate
from the AI companion and from acquiring a business. Fictional people in every preview.

## Where it lives (no fifth destination)

- **Build:** subnav "Expert help" (`/experts`): the directory, then a profile with its request
  form (`/experts/:id`).
- **Operate:** subnav "Help requests" (`/expert-help`): the person's requests (sent and received)
  and their own expert profile; a thread at `/expert-help/:id`.
- **Contextual:** the Operate products view links "Find expert help" carrying
  `?business=<id>`; the request form preselects that business.

## Profiles (opt-in, self-reported)

- **Fields:** headline, offer, skills (from 6 fixed areas), availability, capacity (open, limited,
  full), pricing basis (fixed, hourly, quote, unknown) with a note, and up to 5 of the person's own
  public Everstreet businesses. Unpublished businesses are dropped at read.
- **Visibility:** draft, then published or unpublished. Only published profiles are listed or
  readable by others.
- **Labelling:** every view says "Everything here is what this person says about themselves.
  Everstreet doesn't verify it."
- **No invented signals:** no ratings, badges, verification, AI scores or counts.
- **No new accounts:** an expert needs no business, and the existing person identity is used.

## Directory

Filter by skill, search the headline and offer, and optionally only "Taking new work". Each
result lists its reasons from stated fields only ("Lists AI evaluations and testing", "Their
offer mentions …"). No ranking by AI, ratings or popularity.

## Requests

- **Snapshot.** Title, task, outcome, deliverables, timing, an optional budget with unit ("A
  budget, not an agreed price") and an optional context (one business the requester controls
  NOW, and optionally one of its projects, by name only). "Preview what's shared" shows exactly
  what the expert receives before sending. Nothing else attaches: no customer documents or
  results, costs, source connections, credentials or conversations.
- **State machine** (one row per request, version-counted; an append-only trail
  `help_request_events`):

  | From | Action | By | To |
  |---|---|---|---|
  | requested | accept / decline | expert | accepted / declined |
  | requested, accepted | withdraw | requester | withdrawn |
  | accepted | deliver (a note is required: the expert's account) | expert | delivered |
  | delivered | complete (the requester's acknowledgement) / reopen | requester | completed / accepted |

  Either participant can message in requested, accepted or delivered. declined, withdrawn and
  completed are terminal. No funds move and no contract is signed.
- **Idempotency.**
  - Creating is keyed by (requester, key): a retried lost answer returns the same request.
  - Each action is keyed by (request, actor, key): a key reused for a different action is
    refused (409).
  - The thread keeps one key per intended action and text across retries.
- **Authority.** Discussing or accepting grants no access to the business, its studio, customers,
  source, wallet or treasury; this is stated on every request. A delegated operator slice must ask
  for narrow access separately.
- **Ownership change.** A business-linked request records the owner generation. If the business
  changes hands, the request is **paused**:
  - no transitions or messages, only reading and withdrawing by the former requester;
  - the new owner never sees it (it's the two participants' thread) and can send their own.

  Creating a business-linked request refuses while that business is changing hands.
- **Privacy.** Only the two participants can read a request; everyone else gets 404.

## Evidence

- `server/test/expert-help.test.ts` (3), through the real routes:
  - the full flow, covering unpublished invisibility, reasons, exact preview, an idempotent
    create retry, strict roles, delivery note, completion, the append-only trail and no granted
    access;
  - the pause on a sale (new owner sees nothing; withdraw only);
  - refusals for someone else's business, oneself and an unpublished expert.
- `handover-routes`: the 6 new mutation routes are classified (not_business; the business link is
  gated inside).
- Real browser (scratch preview, fictional people, 1280): directory with a stated reason, profile,
  form, exact preview, send, thread.

## Not done

- Notifications.
- Scope-change review beyond messages.
- 390 and keyboard passes of these pages.
- Linking a request to a later delegated-operator grant.
