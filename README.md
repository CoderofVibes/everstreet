# Everstreet

Start a business, get found by people who need it, and, if you ever sell, hand it over without
breaking a single customer's booking. Built for NEAR HACKATHON (November 2026). Fictional data,
NEAR testnet only.

> Status: the launch pad (phase 1) runs on your computer, and the ownership handoff works on
> testnet. Payments on NEAR, real numbers on profiles, and the acquisition marketplace are next
> (design: `docs/astra/`, `docs/design/BUSINESS_V2.md`). Everstreet is a separate project from the
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
- **Switch people** from the top-right menu (local preview only) to see each side. Try: as Theo,
  cancel his Nov 14 place in My activity; within seconds Ana (waiting) gets it.

Not yet: payments, financials and valuations on profiles, the acquisition marketplace (its page
says so), AI drafting (drafts come from templates today), sign-in with a real identity.

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
| Lint, typecheck, all tests (16) | `npm run check` |
| Contract unit tests (WSL, `contracts/`) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business --lib` → 21 tests |
| Contract on a local NEAR node (WSL) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business --test sandbox` |
| Build the wasm (WSL, `contracts/business/`) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo near build non-reproducible-wasm` |
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
