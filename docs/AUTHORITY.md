# Authority model (gate 1)

What the first close proves, who can do what, and what is fixture, sandbox or live testnet.
Brand-neutral by design: the contract, tables and identifiers never say "Everstreet".

## The claim

Operating control of one business (OpenSeat) changes hands on NEAR in a single contract call,
and a customer who booked under the seller finishes under the buyer with the same booking
reference. After the close the founder's old access fails at every authority boundary: the
contract, the OpenSeat service, and queued worker jobs.

The claim is about **managed operating rights** recorded by one contract. It is not a transfer
of a legal entity, IP, domains, premises or third-party accounts. Those are separate transfer
items with their own evidence (one is simulated in the demo and stays pending after the close).

## Three kinds of party

| Party | Where it lives | What it can do | What it cannot do |
|---|---|---|---|
| **Owner** (one account) | `owner` in the business contract | appoint and revoke operators, register monetary obligations, withdraw the treasury's *available* amount, propose and accept a sale | withdraw reserved funds; act after a sale; change code or keys |
| **Operator** (any number) | `operators` map, each grant stamped with the generation it was issued in | the capabilities it was granted (`fulfillment`, `support`, `release`, `obligations`) while its generation is current | anything once the generation moves on |
| **Customer** | the OpenSeat service (bookings, waitlist, entitlements) | book, join a waitlist, cancel, fetch its seat and calendar file with its own reference | anything operator-only; it never needs to know who owns the business |

Customer rights and operator rights are stored in different places and checked separately, so a
change of operator never touches a booking.

## Authority generation

The contract keeps a `generation` counter, starting at 1. A sale increments it in the same call
that changes the owner. Every operator grant and every signed operator command carries the
generation it was issued under, and both the contract and OpenSeat refuse one that is not
current. That is how stale sessions, API tokens, queued jobs and direct contract calls from the
former founder all fail at once, without anyone having to find and revoke them one by one.

## Who can change the rules (inspected at deployment)

| Power | Who holds it | How to check |
|---|---|---|
| Replace contract code | **nobody**: `setup:testnet` creates the account, funds it, deploys and calls `new` in one transaction without ever adding a key, and the contract has no method that adds keys or redeploys (the sandbox test instead deletes its genesis key; same end state) | `near account list-keys <contract> network-config testnet now` → no keys |
| Rotate or recover the contract account | nobody (same reason; a NEAR parent account has no power over a sub-account's keys) | same |
| Change owner | only a finalized sale both parties accepted | `get_control` view |
| Mint demo credits | the named `issuer` (the platform's demo faucet), fixed at `new`; it can credit any account **except** the business contract itself, so it cannot inflate the treasury or touch obligations, owner or deals | `get_config` view, contract source |
| Alter payout or sale terms | the seller, only by revising a deal, which voids every earlier acceptance | `get_deal` view |

If a deployment ever keeps a full-access key on the contract account, the founder-revocation claim
fails and the README must say so. `npm run inspect` (gate 1) prints the keys and fails if any
remain.

## Exactly what the sale covers

Covered (enforced by the contract):

1. The `owner` role of the business contract, with all owner powers above.
2. The right to appoint operators for the next generation (old grants die with the old generation).
3. Control of the business treasury's **available** balance. The treasury itself stays in the
   contract; sale proceeds are paid from the buyer's separate balance to the seller.

Carried over unchanged (protected, not transferred to anyone):

4. Registered monetary obligations (fixture: 20 of the treasury's 45 demo credits are earmarked
   for promised customer credits). They stay reserved; the new owner can withdraw only 25.
5. Customer service obligations in OpenSeat (bookings, waitlist places, calendar entitlements).
   These live in the service, not the contract, and are honored under whoever operates it.

Not covered (separate transfer items, tracked outside the contract):

6. The simulated external asset (a domain/billing account stand-in) that stays **pending** after
   NEAR finality, with an owner, a required action and its own completion evidence.
7. Anything unregistered. There is no "all liabilities protected" claim.

## Execution modes, labeled at the point of use

| Mode | What runs | Used for |
|---|---|---|
| **Seeded demo** | dated fixture events in `fixtures/` | operating history, revenue figures, studios |
| **Sandbox** | the real contract wasm on a local NEAR node (near-sandbox in WSL); OpenSeat locally | contract integration tests, offline deterministic handoff run, rehearsals |
| **Live testnet** | the real contract on NEAR testnet; OpenSeat checks authority against testnet RPC | the observed close, the refused former-owner transaction, key inspection |
| **Simulated** | in-process stand-ins for external providers | the external handoff item |

A recorded testnet run may be replayed offline only when it is labeled as a recording.
