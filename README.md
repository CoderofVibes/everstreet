# Everstreet

Start a business, get found by people who need it, and, if you ever sell, hand it over without
breaking a single customer's booking. Built for NEAR HACKATHON (November 2026). Fictional data,
NEAR testnet only.

> Status: gate 1 of the build. The ownership handoff works on testnet; the storefront, search and
> diligence room are next. Everstreet is a separate project from the same team's other entry,
> Day One (an AI purchasing assistant); the two share no code, data or deployments.

## What works today

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
| Lint, typecheck, OpenSeat tests | `npm run check` |
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
