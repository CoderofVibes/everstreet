# Brief for Astra: the working foundation, reviewed with Tony

Read `docs/ASTRA.md` first; its rules hold for this whole session.

## Why this session

Your three passes (Platform vision, Launch pad, Intact profiles) have been built into a working
desktop app. Phases 1 to 6 of your eight-phase order are done and verified on NEAR testnet. Tony
wants to **work through the platform with you**: open it, use it, react, and decide together what
it should become next. This is a working session with Tony, not a fresh design from a blank page.

Your job:

1. **Walk the product with Tony.** He runs the app on his computer and uses it; you read the code
   and docs behind whatever he is looking at, explain what is real, and ask what he thinks.
2. **Critique it against his vision** (his words are below). Where the build falls short of your
   own passes or of what he asked for, say so plainly.
3. **Expand, don't redirect.** Tony has corrected drift before: the first pass moved toward
   continuity for established businesses and he rejected that framing. Keep his launch pad at
   the centre and add depth around it.
4. **At the end, write one pass** to `docs/astra/2026-11-02_<Topic>.md` with its row in
   `docs/astra/INDEX.md`: what to change, in priority order, concrete enough for Claude to build
   from, plus the decisions Tony made during the session (quote him).

## Tony's vision, in his words (from the thread)

- Everstreet is "a launch pad for aspiring entrepreneurs, a place where investors or other
  businesses can make acquisitions and a place people can find services, all using NEAR
  protocol."
- Acquirers "search for businesses that match what they want", including by potential valuations:
  "This could be a feature as it's built on NEAR and financials are known!"
- "We also need to make sure NEAR works on the backend."
- Keep the original thesis: a business that can be "securely transferred during its purchase".
  Each business has its own NEAR account, holds its treasury, tracks prepaid customer balances,
  pays its workers, and publishes rules on what a future owner may change. A buyer inspects
  revenue, costs, obligations and performance. A customer cooperative could buy the business.
- "Real revenue, performance numbers, overhead, profit, valuation estimated by Everstreet" is "a
  big thing" for him.
- A "business social media": profiles Everstreet generates and maintains, with business
  overview, performance, customers, about me, financials and valuations.
- Sequencing: "building the platform, then examples, further building out the platform, then once
  we have a good product, finalizing what we give to the judges."
- Desktop, not phone: "build this program for my computer." The UI was always going to be
  reworked later ("we can rework the UI later on").

## What exists now

Everything below runs at http://localhost:8800 (Tony starts it with `Start Everstreet.cmd`). All
businesses and people are fictional; money is test dollars on NEAR testnet. Top-right menu
switches between fictional people in this local preview.

| Phase (your numbering) | What a person can do | Where to look |
|---|---|---|
| 1 Launch pad | Start a business three ways (idea, help finding one, already selling); six-question interview with a live offer preview; publish after a review | `/start`, `/studio/:id`; `server/src/store.ts`, `drafting.ts`; `web/src/pages/Start.tsx`, `Studio.tsx` |
| 2 Seen and used | Public pages, real class bookings through OpenSeat (separate service and database) with a NEAR-checked waitlist worker, search with editable constraints, need board, follows, updates, founder profiles, share kit and "how people found you" | `/b/:slug`, `/find`, `/explore`, `/activity`, `/p/:id`; `server/src/community.ts`, `bookings.ts`; `services/openseat/` |
| 3 Real testnet payment | Founder turns on payments: the business gets its own testnet account running the v2 contract (shared code by hash, no keys), owned by the founder's own account, with refund and reserve rules fixed for good. Customers pay, cancel for refunds by rule; founder marks delivered and withdraws only what's earned | Desk → Money; `contracts/business-v2/`, `server/src/chain.ts`, `payments.ts`; `docs/design/BUSINESS_V2.md` |
| 4 Growth and value | Books by month (chain revenue labelled "Verified on NEAR · testnet", founder-entered costs, seeded history labelled fictional); the Value screen (`scenario-v1`: calculation, every input's source, what changed, what-ifs, version history); opt-in shared numbers on the public page; helpers appointed and revoked on the contract | `/desk/:id/value`, Desk → Books and Team, `/help/:id`; `server/src/books.ts`, `value.ts` |
| 5 Acquisitions | Buying profiles (owner-operator, business, small firm, co-op) with team roles; seller discovery modes (closed, private, anonymous teaser, named); search from a written brief with honest unknowns; shortlist and compare; access requests the seller grants, narrows or declines; an evidence room that ends when access ends | `/acquire`, `/acquire/l/:id`, `/acquire/room/:id`, `/desk/:id/sale`; `server/src/acquire.ts` |
| 6 Deal and handover | Exact terms fingerprinted on the business's contract; buyer funds the price; both accept the same version (revisions clear acceptances); the close changes control on chain once; Everstreet then moves the business to the buyer; seller claims proceeds and can watch the contract refuse them as former owner; buyer's first shift | `/deal/:id`; `server/src/deals.ts` |

Example data in Tony's copy: Juniper Print Studio (Mara; classes, payments on, real testnet
bookings and orders, a helper history), Paperfin API (Nadia; named listing at $195,000, your
worked valuation example), Doorstep Bike Fix (Theo), Small Hours Candles (Ana; anonymous teaser),
Northline Studio Tools (Owen's buying team) and Alder Lane Makers Co-op (Ana's). Juniper is
deliberately **not sold** so Tony can run that sale himself.

Proof on testnet, every step with a transaction link: `data/evidence/handoff-testnet.json` (v1
sale of OpenSeat), `data/evidence/payments-testnet.json`, `data/evidence/sale-testnet.json` (a
full v2 sale through Everstreet's API, 23 steps). Every decision Claude made is logged with its
reasons in `docs/DECISIONS.md` (one section per phase). Tests: `npm test` (52, keyless; you may
run it).

## Known gaps (honest edges)

- Only **class** businesses take payments and can be sold through their own contract. Services,
  products and software (Paperfin) can list and be searched but have no contract yet; that is
  your phase 7.
- **No real sign-in.** People's testnet keys sit in the local database; the screens say so.
- A co-op buys through its **lead's account**; group control on NEAR isn't built.
- The deployed v2 contract can't change: no public notice period before a close, no retained
  operators across a sale.
- Drafting uses **templates**, not AI. Valuation multiples are illustrative, not market data.
- The **UI is a first pass**: one visual system, functional, desktop-first, never designed as a
  whole. Some pages are long and dense (the deal page, the evidence room, the desk).

## Questions worth working through with Tony

Use these if the session needs a start; follow Tony where he goes.

1. Walking in as a new founder, as a customer, as a buyer: where is it clear, where is it
   confusing, where does it feel like a demo rather than a product?
2. The business profile as "business social media": is the public page, plus shared numbers, plus
   updates and follows, the profile Tony imagined? What would make it feel alive?
3. The UI rework: what should the whole visual and navigation system become, now that every
   screen exists? What should the home page say?
4. Phase 7 (services, products, software): which first, and is Paperfin (the API business your
   intact-profiles pass centred on) the one to make sellable?
5. What else in Tony's thread is still missing or thin?
6. When the product is good, what should eventually go to the judges (not now; Tony's sequencing
   rule says later)?

## How to work

- Tony is in the room. Keep turns short and plain; ask before long reads.
- Read only what a question needs; the table above points to the files.
- `git status` before your pass: Claude may be editing; say so if files you discuss have changed.
- Never open `data/runtime/`, `.near-credentials/` or any key file; never run anything that sends a
  transaction (`smoke:*`, `setup:*`, `handoff`, `seed:*`).
- Write only your pass file and its INDEX row.
