# Everstreet

Start a business, get found by people who need it, and, if you ever sell, hand it over without
breaking a single customer's booking. Built for NEAR HACKATHON (November 2026). Fictional data,
NEAR testnet only.

> Status: the launch pad, real bookings, real testnet payments, books, valuations, scoped
> helpers and the acquisition marketplace run on your computer, and the ownership handoff works
> on testnet. Accepting a deal on the token-backed contract is next (design: `docs/astra/`,
> `docs/design/BUSINESS_V2.md`). Everstreet is a separate project from the
> same team's other entry, Day One (an AI purchasing assistant); the two share no code, data or
> deployments.

## Open it

Double-click **`Start Everstreet.cmd`**, or run `npm run app`, then open http://localhost:8800.
The first run installs and fills in four fictional example businesses. Close the window to stop.

What you can do today:

- **Start a business** three ways: with an idea, with help finding one (four questions → three
  small directions), or from something you already sell.
- **Shape the offer** in a six-question interview while the customer's view of your offer fills in
  beside you; anything still undecided is listed and shown to customers as undecided.
- **Make it yours**, **preview** exactly what a visitor sees, then **publish** after a plain review of
  what publishing does. Drafts stay private until then.
- **Find a solution**: search everything published, with the words each result matched. Nobody
  pays to rank higher.
- **Respond as a visitor** ("Tell me when it opens", or ask to book / order / get access once the
  founder confirms the details). Contact details are shared only if the visitor ticks the box.
- **Run it from your desk**: responses arrive as tasks, replies go back to the visitor's inbox, and
  the first-week plan ticks itself off as you fill in what was missing.
- **Take real bookings** (classes): the founder opens dated sessions; places, the waitlist and
  automatic moving-up live in **OpenSeat**, the booking service, which runs beside Everstreet with
  its own database. Its waitlist worker acts only when OpenSeat's contract on **NEAR testnet**
  says it is authorized, and the customer's booking shows who moved them up and under which
  authority generation.
- **My activity**: a customer's bookings (live status, calendar file, cancel), the requests they
  posted and founders' replies, messages, and updates from businesses they follow.
- **Explore**: Starting now, Open for customers, What people need, Following.
- **Need board**: when search can't find it, post the request (anonymously, with an expiry);
  founders whose offer fits see it on their desk and reply.
- **Search with constraints**: "class under $40, online" becomes removable chips; hard limits
  filter first, each result says why it is there, and an empty result says which limit ruled
  things out with a one-click relax and a way back.
- **Be seen**: founder profiles, updates for followers, a share kit with a trackable link, and
  "how people found you" (own link, Everstreet, a request, unknown). Pages can be reported.
- **Take real payments on NEAR testnet**: the founder turns payments on and chooses the promises
  the business keeps (refund window, reserve). That creates the business's own testnet account
  running the v2 contract from shared code by hash, born with no keys, owned by the founder's
  own account. Customers "Pay $35 and book" from their own testnet account in test dollars
  (tUSD, no value). The contract holds customer money until the founder marks the order
  delivered, refunds a cancellation inside the window by itself, and never lets the owner
  withdraw customer money or the reserve. The founder's **Money** panel is read from the
  contract: customers' money, earned, withdrawable, this month's books, each order with its
  transaction links, and withdrawals. A dropped connection is reconciled from the chain
  (an order id is paid at most once).
- **Books**: month by month, revenue (what was delivered, not what was paid in advance), direct
  costs, overhead and profit. Revenue since payments went on is read from the business's
  contract and labelled "Verified on NEAR · testnet"; costs are what the founder enters (once or
  every month); the examples' earlier months are labelled "Seeded history · fictional".
- **Value**: what the business could be worth, as an explainable scenario model (`scenario-v1`):
  operating profit minus the work a successor would have to do or pay for, annualized, times
  illustrative multiples. The full calculation, every input with its source, what the estimate
  doesn't know yet, exactly what changed since last time, every past version, and private
  "Try a change" what-ifs. It is an estimate, not an appraisal, an offer or advice.
- **Share my numbers** (off by default): last month's revenue, costs and profit, and the estimate
  with its labels, on the public page.
- **Hand off a task**: a founder appoints someone to answer customers and mark orders delivered.
  They are appointed on the business's contract with their own account and never get the
  founder's key; they work from "Businesses you help". Revoke, and the contract refuses them.
- **Buying profiles**: an owner-operator, a business buying a business, a small investment firm,
  or a customer cooperative sets up a buying profile under their own account, says how they'd
  own it, and adds teammates with research, evidence or approve roles.
- **Sell on your terms**: a founder chooses closed, private introductions (invited teams only),
  an anonymous teaser (coarse bands, no name) or a named acquisition profile, sets an optional
  asking price, and picks which numbers buyers see. Customers never see any of it, and sharing
  numbers on the public page does not list a business.
- **Search acquisitions**: a written brief fills the same visible filters (kind, remote, asking
  price, estimate range that overlaps or fits within yours, months of history, owner hours,
  verified on NEAR). Each result says why it matches and what is unknown; businesses without an
  estimate are set aside only by the estimate filter, which says how many and lets you include
  them. Asking price and estimate are always separate. Shortlist and compare up to three.
- **Evidence rooms**: a buyer asks for specific evidence, for a purpose and a number of days;
  the founder sees the team and grants, narrows or declines. The room shows only what was
  granted: monthly books with sources, the estimate with a button to reproduce it from the rows,
  the team's own private assumptions, customer activity in aggregate (small counts suppressed),
  and a preliminary list of what a sale would cover and its status. Access is checked on every
  visit; when the founder ends it or it expires, the room stops working. The founder sees how
  often it was opened.
- **Switch people** from the top-right menu (local preview only) to see each side. Try: as Theo,
  cancel his Nov 14 place in My activity; within seconds Ana (waiting) gets it. Then as Mara,
  turn on payments on Juniper's desk, and as another person pay for the Nov 7 session.

Not yet: agreeing and accepting a deal on the token-backed contract, researched market multiples, AI drafting (drafts come from templates today), sign-in with a real identity (people's
testnet keys are kept on this computer in the local preview), paid waitlists, and payments for
kinds other than classes.

## The ownership handoff on NEAR testnet

A sample business, **OpenSeat** (class booking with a waitlist), is controlled by a NEAR contract.
On testnet, its founder sold control to a buyer, Northline, and:

- the sale settled in one transaction: owner changed, the seller was paid 100 demo credits, and the
  business treasury kept its 20 credits reserved for customers;
- the founder's later transactions failed on chain (`E_NOT_OWNER`), and OpenSeat refused their
  stale commands and their old worker;
- a customer who joined the waitlist before the sale was promoted under the buyer's new worker and
  still uses the same booking reference.

Every step with its transaction link: [data/evidence/handoff-testnet.json](data/evidence/handoff-testnet.json).
Who can do what, and what the sale does and does not cover: [docs/AUTHORITY.md](docs/AUTHORITY.md).

## Run it

Requirements: Node 24+. For the contract: WSL Ubuntu with Rust and `cargo-near`.

| Task | Command |
|---|---|
| Install | `npm install` |
| Build and run the app | `npm run app` → http://localhost:8800 |
| Fill an empty local database with fictional examples | `npm run seed:demo` (`-- --reset` starts over; stop the app first) |
| Work on the UI with live reload | `npm run serve` and, beside it, `npm run web:dev` → http://localhost:5173 |
| Add the examples' fictional history, buyers and listings to an existing local database (no reset) | `npm run seed:history` |
| Lint, typecheck, all tests (47) | `npm run check` |
| Contract unit tests (WSL, `contracts/`) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business --lib` → 21 tests (v1); `-p business-v2 --lib` → 19 tests (v2) |
| Contract on a local NEAR node (WSL) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business --test sandbox` (v1); `-p business-v2 --test sandbox` (v2 with real token transfers) |
| Build the wasm (WSL, `contracts/business/` or `contracts/business-v2/`) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo near build non-reproducible-wasm` |
| Publish v2 as shared code and create test dollars (needs `everstreet.testnet`'s key) | `npm run setup:v2` |
| Run the payment path on testnet (needs the root key) | `npm run smoke:payments` → `data/evidence/payments-testnet.json` |
| Check who can still change the contract (no keys needed) | `npm run inspect` → expects 0 access keys |
| Check testnet and the Chain Signatures signer (read-only) | `npm run probe:signer` |
| Create accounts and deploy (needs `everstreet.testnet`'s key) | `npm run setup:testnet` |
| Run the handoff on testnet (needs the demo keys) | `npm run handoff` |
| Run OpenSeat on its own | `OPENSEAT_BUSINESS=openseat.everstreet.testnet npm run openseat -- --seed` |

## Limitations (honest edges)

- Every demo identity is a real, separate testnet account, but this machine holds all their keys.
- The contract proves who may operate OpenSeat. Whoever hosts the OpenSeat process could still
  change its database directly; moving the hosting is a separate transfer item.
- Amounts are demo credits with no value. No mainnet, no real money.

## About the team

DadMod: Tony Langford (founder) with two AI collaborators.
