# Everstreet

Start an online business, get found by the people who need it, and, if you ever sell, hand it to a
buyer without breaking what customers already paid for.

Small online businesses (an AI API, a SaaS workflow, an agent service) are hard to sell. Customers
have prepaid credits, keys and open requests, and today a sale means trusting the seller to hand
everything over and stop using it. On Everstreet each business runs on its own NEAR contract. The
contract holds customers' prepaid units, refuses the old owner the moment the sale closes, and lets
the buyer serve the very next request.

Built for NEAR HACKATHON (November 2026). Fictional people and data, NEAR testnet only, test tokens
with no value. Everstreet is a separate project from the same team's other entry, Day One (an AI
purchasing assistant); the two share no code, data or deployments.

**Watch:** demo video (link added at submission).

## Try it

Requirements: Node 24+.

```
npm install
npm run demo
```

Open http://127.0.0.1:8820/portfolio, choose **Continue with Synthetic demo wallet**, and pick
who to be. The demo runs entirely on your machine with a synthetic wallet and chain; the same sale
on real NEAR testnet is recorded below. One route through it (sign out and in again to switch):

1. **Delphine Marsh**, the seller: Signalwatch is mid-sale. Open it from "Needs you today" and
   accept the terms.
2. **Noah Brandt**, the buyer: accept and close the sale. The sale page then shows your first
   shift: control, customers' uses, customers' prepaid units, your team.
3. **Delphine** again: collect the proceeds, then **Try an owner action**. Her own wallet asks
   the contract to appoint her; it refuses (`E_NOT_OWNER`, here on the synthetic chain, which
   follows the contract's rules) and the page shows the transaction.
4. **Cara Okafor**, a customer who paid before the sale: use Signalwatch under its new owner.

The demo uses ports 8820 and 8821 (`npm run demo -- --port 8830` moves it), and stops by itself
after two hours (`-- --minutes 300` for longer).

## What it proves on NEAR testnet

The Direct sale example ran through Everstreet's own routes on a business-v3 contract born with no
access keys (`ledgerline-v3-2.everstreet.testnet`, Nov 6 2026):

1. **The customer keeps what they bought.** A customer bought 100 uses and used 20. At the close,
   their 80 unused uses stayed on the contract, unchanged.
2. **The former owner loses authority.** In the same transaction that closed the sale, the
   contract moved control to the buyer at a new generation. Everstreet then refused the seller's
   owner view and release (404). The contract refuses owner calls from anyone but the current
   owner (`E_NOT_OWNER`, shown in the contract tests below and in step 3 of the demo).
3. **The buyer serves the next use.** The customer's next request ran under the buyer, leaving 79.
   A later use on the buyer's own update left 78, which is what the contract shows today.

Every transaction, with explorer links: [data/evidence/v3-direct-testnet.json](data/evidence/v3-direct-testnet.json).
Check it: `npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json --live`
checks the record's digests offline, then reads the contract on public testnet (read-only, no
keys): its code hash, that it has no access keys, its owner, and the customer's units.
Details of all four v3 examples are [further down](#business-v3-handover-and-recovery-examples).

## How we tested these promises

- **[Safety case](docs/SAFETY_CASE.md):** the eight promises the contract makes, what enforces
  each one, and the attacks that were tried against it and refused.
- **Cold attack review:** a reviewer that had never seen the project attacked the contract as
  buyer, seller, former owner, operator, customer, outsider and the network. Its 92 attack tests
  are in the repository; the four issues it found are fixed
  ([report](reports/2026-11-06_attack-review.md)).
- **A real local NEAR node:** payouts failing and retried with a real token, every amount of
  attached gas, and a sale closing while a refund is in flight
  ([output](data/evidence/v3-sandbox-payouts.txt)).
- **Permissions in Everstreet's own server:** a second cold review attacked the app as a former
  owner, former helper, buyer, customer, agent and outsider. One gap was real: a sale closed on
  the contract without anyone telling Everstreet left the seller in charge here until someone
  checked. A watcher now reads every recorded sale from the chain every 15 seconds. Its 29 tests
  run with `npm run check` ([report](reports/2026-11-06_permissions-review.md)).
- **What isn't covered** is listed in the safety case and under [Limitations](#limitations-honest-edges).

Reproduce (WSL, from `contracts/`): `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3`.

## Everything in it

Besides selling a business: a product studio, starting and publishing a business, search with
constraints, a need board, bookings and payments on NEAR testnet, books and a value estimate,
helpers appointed on the contract, buying profiles, acquisition search, evidence rooms and the
earlier (v2) deals. Each one, with what runs only in the legacy local preview and other ways to
start it: [docs/FEATURES.md](docs/FEATURES.md).

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

The same sale now runs through Everstreet itself on the token-backed v2 contract: a fictional
pottery studio was sold to a customer co-op on testnet, with a revision that cleared both
acceptances, the buyer's stale acceptance refused, the old hold returned, the close, the former
owner and old helper refused, the new owner serving a customer who paid before the sale, that
customer's refund honoured under the original rules, and the seller's proceeds claimed. Every
step: [data/evidence/sale-testnet.json](data/evidence/sale-testnet.json).
Who can do what, and what the sale does and does not cover: [docs/AUTHORITY.md](docs/AUTHORITY.md).

### Business v3 handover and recovery examples

The testnet records above cover the earlier contracts. All four examples below have local test
coverage and were run on NEAR testnet through the app's normal routes, each on its own
born-locked business-v3 contract. They used fictional script-held accounts and a labelled
stand-in AI model. Every write's outcome was read from its own finalized transaction. Testnet
NEAR has no value.

**Series 2 (Nov 6 2026)** reran the examples on new accounts with the contract as fixed after the
attack review (code hash `3Ptn4BCWZuji2HaGawwHWZ1wpMTF3QA4fjLZF2sLNLM6`, business-v3 wasm
SHA-256 `2394b224…ce431`, rustc 1.99.1, cargo-near 0.22.0, non-reproducible build). **Series 1
(Nov 5)** ran the earlier code (code hash `HMGhGxrpnKJfxBSwovHmvd1zoKv5nw4hSGp3s6qhxM7C`); its
records are kept in [data/evidence/v3-series-1/](data/evidence/v3-series-1/).

Series 1 hit two faults from the public RPC, both recorded in its evidence:
- **Rate limit:** FastNEAR's free tier rate-limited the runs (HTTP 429). Later runs read
  through dRPC, NEAR's listed public testnet endpoint.
- **Lost charge:** one platform charge couldn't be confirmed and was never re-sent. The chain
  showed it never executed, and the customer released that hold after the contract's
  deadline, so that use was delivered and not charged.

Series 1 also caught a real lost purchase response (the provider answered 500 to the wallet's
send). The app answered "unknown" until the customer's original transaction ID confirmed the
purchase once. Series 2 repeats that recovery with a controlled fault (below).

**Direct sale: verified on NEAR testnet (series 2, Nov 6 2026).**
- **Setup:** contract `ledgerline-v3-2.everstreet.testnet` was deployed born locked (no access
  keys), with code hash `3Ptn4BCWZuji2HaGawwHWZ1wpMTF3QA4fjLZF2sLNLM6`. The platform's metering
  account holds only a function-call key for `open_hold`, `settle_hold` and `release_hold_for` on
  that contract.
- **Before the sale (final views):** a fresh fictional customer bought 100 uses and used 20,
  leaving 80 free and 20 consumed.
- **The sale:** the Direct sale closed. Control moved from the founder (generation 1) to the buyer
  (generation 2) with 80 still owed, and the former owner's owner view and release were refused
  (404).
- **After the sale:** the customer's next use under the buyer left 79. The buyer's checked
  update was released, and a later use on its offer was charged, leaving 78.
- **Labels:** AI results came from a labelled stand-in model, not a provider. The public RPC
  stopped the run twice (FastNEAR's free tier answered `read_failed`; later reads went through
  dRPC). One platform charge was broadcast and then dropped by the RPC, and the app left it
  unknown by design. Before the contract's deadline the identical signed transaction (same nonce
  and hash, so it can only execute once) was broadcast again, and it landed. The record's
  operator note gives the hash.
- **Evidence:**
  - [data/evidence/v3-direct-testnet.json](data/evidence/v3-direct-testnet.json): every
    transaction with its explorer link, and the views at each checkpoint;
  - [data/evidence/v3-setup-testnet.json](data/evidence/v3-setup-testnet.json): accounts, the
    deployment and the key scope.
- **Verify:** `npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json --live`.
  It checks the digests and that no keys are present, then reads the contract on testnet and
  compares it with the record. The explorer links show each transaction.

| Example | What the local check covers | Reproduce locally |
|---|---|---|
| Direct sale (also verified on testnet, above) | A customer buys 100 uses, consumes 20 and retains 80 at close. The seller loses control, the buyer serves the next use, and the customer has 79 left. | `npx vitest run server/test/flagship-journey-process.test.ts`; the rehearsal driver's dry run: `npx vitest run server/test/rehearsal-driver.test.ts` |
| Gated sale (also verified on testnet, below) | The closer returns one outstanding reservation, closes once and reopens service under the buyer. The customer retains 95 unused units and access to earlier results. | `npx vitest run server/test/flagship-gated-journey.test.ts`; dry run `npx vitest run server/test/rehearsal-examples.test.ts` |
| Lost purchase response (also verified on testnet, below) | The payment lands in the chain fixture before the app loses its readback. Rechecking the original transaction confirms one purchase without adding units twice. | `npx vitest run server/test/flagship-restart-matrix.test.ts` |
| Failed token payout (also verified on testnet, below) | Contract tests simulate a failed transfer callback, check that the claim keeps its category and beneficiary, and exercise a successful retry and duplicate callback. | `cargo test --manifest-path contracts/business-v3/Cargo.toml payouts_keep_their_category_through_failures_claims_and_duplicates` |

**Gated sale: verified on NEAR testnet (series 2).**
- **Setup:** contract `ledgerline-gated-v3-2.everstreet.testnet`, in Gated mode. Its closer
  account holds only a function-call key for `close_sale` on that contract.
- **At the seller's acceptance (final views):** 94 free, 1 reserved and 5 consumed. A second
  customer's fresh request during the gate was refused by the app (`handover_pause`): no hold,
  no charge.
- **After the managed close:** the reservation was returned once, leaving 95 free, 0 reserved and
  5 consumed. The buyer is at generation 2 and the former owner's release is refused (404).
- **Under the buyer:** the next use left 94 free and 6 consumed.
- **Evidence:** [data/evidence/v3-gated-testnet.json](data/evidence/v3-gated-testnet.json);
  [setup](data/evidence/v3-gated-setup-testnet.json).

**Lost purchase response and failed token payout: verified on NEAR testnet (series 2).**
- **Setup:** contract `ledgerline-payout-v3-2.everstreet.testnet`.
- **Lost purchase response, controlled fault:** a test-only drop of the app's readback answer.
  The app answered "unknown", then the recheck with the original transaction confirmed one
  purchase: 10 units for exactly 1.5 tUSD, listed once.
- **Failed token payout, after a small Direct sale:**
  - The seller was owed 10 tUSD and unregistered from the token after the app's review: the
    deliberate fault.
  - The claim's downstream token transfer failed, and the contract restored the same 10 tUSD sale
    proceeds claim to the same seller. The buyer's attempt to claim was refused (nothing owed).
  - The seller registered again and collected exactly 10 tUSD.
  - A replay was refused by both the app and the contract, so nothing more was paid.
- **Evidence:** [data/evidence/v3-recovery-testnet.json](data/evidence/v3-recovery-testnet.json);
  [setup](data/evidence/v3-recovery-setup-testnet.json).

Verify any record with `npx tsx scripts/verify-rehearsal.ts <file> --live` (drop `--live` to
stay offline), then follow its explorer links.

## Run it

Requirements: Node 24+. For the contract: WSL Ubuntu with Rust and `cargo-near`.

| Task | Command |
|---|---|
| Install | `npm install` |
| The demo (fictional, synthetic wallet and chain) | `npm run demo` → http://127.0.0.1:8820/portfolio |
| Build and run the app (legacy local preview) | `npm run app` → http://localhost:8800 |
| Run the normal composed entry (003w) | `npm run entry -- --config <absolute path to a config>` |
| Review the composed entry in a browser (temporary, no network) | `npm run web:build`, then `npx tsx scripts/preview-entry.ts configured` → http://127.0.0.1:8870 |
| Fill an empty local database with fictional examples | `npm run seed:demo` (`-- --reset` starts over; stop the app first) |
| Work on the UI with live reload | `npm run serve` and, beside it, `npm run web:dev` → http://localhost:5173 |
| Add the examples' fictional history, buyers and listings to an existing local database (no reset) | `npm run seed:history` |
| Lint, typecheck, all tests | `npm run check` |
| Contract unit tests (WSL, `contracts/`) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --lib` → 195 tests, the attack review's included (v3); `-p business-v2 --lib` (v2); `-p business --lib` (v1) |
| Contract on a local NEAR node (WSL) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --test sandbox -- --nocapture` (v3 payouts, gas and a close mid-refund); `-p business-v2 --test sandbox`; `-p business --test sandbox` |
| Build the wasm (WSL, `contracts/business/` or `contracts/business-v2/`) | `CARGO_TARGET_DIR=$HOME/everstreet-target cargo near build non-reproducible-wasm` |
| Publish v2 as shared code and create test dollars (needs `everstreet.testnet`'s key) | `npm run setup:v2` |
| Run the payment path on testnet (needs the root key) | `npm run smoke:payments` → `data/evidence/payments-testnet.json` |
| Run a whole sale on testnet through Everstreet's API, fresh fictional accounts (needs the root key) | `npm run smoke:sale` → `data/evidence/sale-testnet.json` |
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
