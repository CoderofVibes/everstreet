# Authority model (gate 1)

What the first close proves, who can do what, and what is fixture, sandbox or live testnet.
Brand-neutral by design: the contract, tables and identifiers never say "Everstreet".

## The claim

Operating control of one business (OpenSeat) changes hands on NEAR in a single contract call,
and a customer who booked under the seller finishes under the buyer with the same booking
reference. The recorded gate-1 run demonstrated rejection of the founder's old access by
the contract, OpenSeat and the queued worker after they observed the close. Contract control
changes atomically; offchain enforcement depends on observing final state. A command checked
before the close can still finish afterward in the current service (see the November 2
[characterization report](astra/reports/2026-11-02_003a_characterize-credit-and-close.md)).

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
generation it was issued under. The contract refuses old authority in its current state;
OpenSeat refuses it when its authority check observes that generation. These checks remove
the need to revoke each old grant individually, but do not make a chain read and a later
service write atomic. The proposed managed close protocol addresses stronger administration
fencing before close; it is not built or deployed, and it does not change the evidence already
recorded for gate 1.

Two different guarantees, kept apart:

- **Atomic close (contract).** Owner and generation change together in one contract call. This
  is the only atomic step.
- **Observed-finality reconciliation (Everstreet's records, job 003b).** Everstreet follows a
  close only after reading it from the contract, and only when the closed deal matches the
  recorded terms (digest, version, buyer, seller) and control is at exactly the next
  generation for this buyer. It applies the change once: a compare-and-set inside one local
  transaction moves the deal to closed and writes the owner, ownership entry, team, listing,
  access and sale event together, or nothing. It never replaces a newer local owner. A lost
  acceptance response or an unreadable contract leaves the deal open with "pending" or
  "unknown", never "failed"; a close that doesn't match is marked "needs reconciling" and is
  not applied automatically. This is idempotent and monotonic, not atomic with the chain: the
  app can lag the contract, and it is proven in unit tests against an in-memory chain double,
  not yet on testnet.
- **Companions read control at the moment of the call, two receipts before they act.** The
  external-asset key and the supplier allowance (`contracts/asset-key`, `contracts/spend-allowance`)
  hold no authority of their own: each request asks the business contract `get_control()` and acts
  in a callback with the answer it was handed. A sale that closes between that read and the
  callback lets one payment, withdrawal or signature the seller started land after the close (the
  November 7 attack review, finding 2). The window is a block or two and the amounts are bounded
  by the budget's caps, but it is real: the buyer's first shift drains the budget and moves the
  external role, and a buyer who cares checks both before accepting.

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
