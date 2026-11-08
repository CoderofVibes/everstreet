# Safety case: what the business contract promises, and how we tried to break it

Everstreet sells a running online business without breaking what its customers paid for. The
promises below are enforced by one contract per business (`contracts/business-v3`), not by
Everstreet's servers. On 2026-11-06 a reviewer who had never seen the project attacked that
contract cold, playing buyer, seller, former owner, operator, customer, outsider and the network.
It got only the contract and its design notes, not our tests. This page summarizes what it found,
what we fixed and what stays open.

This is an **adversarial review with reproducible attack tests, not a security audit.** The
reviewer and the builder are both AI models; nobody independent has audited the contract.

## The promises, and what holds them

| Promise | What enforces it | Tried and refused (examples) |
|---|---|---|
| Escrow goes to the seller only if the sale closes on the agreed terms; otherwise it returns to the buyer | Escrow is its own bucket; the price becomes the seller's claim only in the closing call; cancelling, expiring or revising credits the buyer | Accept without funding; fund less, twice, or from another account; accept an old version or digest after a revision; point funded escrow at another buyer; cancel after funding to keep it |
| The seller is paid exactly the agreed price, once | The proceeds claim is written once at close and paid through a bounded payout | Claim twice; claim with nothing owed; a second sale touching the first seller's claim |
| After a sale the old owner and operators have no power; only operators the buyer agreed to keep carry over | One generation counter moves with the owner in the same call; every grant is stamped with its generation | Withdraw, appoint, revoke, propose or settle customer usage as the former owner or an old operator |
| Customers keep what they paid for; a sale changes nothing about their units, keys or holds | Customer records live apart from owner control; unused units are refundable at the plan price | The customer record compared byte for byte before and after a close; existing customer signatures still settle under the new operator; on a local NEAR node, a sale closing between a refund's start and its callback, and the refund still reaching the customer |
| Units are spent only with the customer's own signature, never more than authorized | ed25519 signatures bound to business, plan, customer, registration, key epoch and hold | Inflate signed units; move a use to another slot; replay a closed hold; reuse a revoked key; exceed a key's daily cap; weak (small-order) keys |
| The owner withdraws only money nobody else is owed | One accounting identity: held = customers' unused units + held units + available + pending + claims + escrow | Withdraw customer money or escrow; drain below the agreed floor before closing |
| Nobody can change the code or take the account | The contract account has no access keys and no method that adds keys or redeploys | The testnet rehearsal stops if the business account has any key (`scripts/v3-rehearsal.ts`) |
| A failed payout never loses money; it becomes a claim for the right person | Money moves to pending before a transfer; a private callback settles it or turns it into the beneficiary's claim. The callback reserves 10 TGas and was measured using at most 2.4 | Every payout kind failing (refund, profit, escrow return, sale proceeds); replayed or foreign callbacks; on a local NEAR node, refunds sent with every amount of gas from 5 to 300 TGas (each failed whole or completed, none stuck); also shown on testnet with a real failed transfer |

The review lists about 50 attack lines refused, each naming the function and error that stops it
(`reports/2026-11-06_attack-review.md`, "Tried and refused").

## What the review found and what we changed

Four findings, all fixed on 2026-11-06 (the reviewer rated each low; ratings describe this
review, not a guarantee):

1. **A former owner could delete customers' unbought sign-ups after a sale** if they had paid for
   them. Paying for a sign-up now gives no power. The current owner or a current operator can
   clear an unbought sign-up, and the deposit still goes to whoever paid.
2. **A customer's key could lock the business's sign-up deposit for good.** The same fix lets the
   business clear an unbought sign-up, keyed or not.
3. **Many customer accounts could fill every payout slot** and briefly stall the owner's
   withdrawals. Customers together now hold at most 14 of the 16 slots.
4. **Setup accepted the business's own account as its owner or closer**, which would make a
   business that can never act or never sell. Setup now refuses it.

Seven notes were left as design facts or checked in the app. For example, the sale page now marks
a seller who stays on as an operator, and it no longer warns that an offer expired once both sides
have accepted and the sale is closing.

## The second review (2026-11-07)

A second cold reviewer, again with only the contracts and their design notes, attacked business-v3
and its two companions (`contracts/asset-key`, `contracts/spend-allowance`), playing buyer, seller,
former owner, operator, the budget's agent, a supplier, a customer, an outsider and the network
(`reports/2026-11-07_attack-review.md`). business-v3 held every promise: 39 attacks, every one
refused. The companions did not:

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | asset-key signs `setController` for any address at any nonce the caller names, so a seller can pre-sign a hand-over of the external registry and broadcast it at the close, racing the buyer | Fixed in source: the request names no destination (the companion derives the current generation's address through the signer's `derived_public_key`), a generation can't move to itself, and a path signs at most one nonce past the highest it signed. A seller can still pre-sign transactions one at a time to delay the buyer's move, never to keep the role. On testnet since series 4 (`data/evidence/v3-s4-testnet.json`) |
| 3 | High | spend-allowance's `approve` changes no state before its cross-contract call; a retried approve pays an invoice twice and corrupts the books | Fixed in source: `Approving` before the control call; only the grant's maker may start an approval. On testnet since series 4 (`data/evidence/v3-s4-testnet.json`) |
| 2 | Medium | Both companions act on a control reading two receipts old; a payment, withdrawal or signature the seller starts just before the close lands after it | Documented window: the buyer's first shift drains the budget and moves the role; stated in `docs/AUTHORITY.md` |
| 4, 5, 6 | Medium | The agent can freeze the budget with reviewable invoices (no owner reject); invoices grow storage nobody pays for; a failed signer receipt keeps the caller's deposit | Fixed in source: an owner `reject` and a 7-day expiry anyone may apply; `pay` charges its storage to the agent; a failed signature returns the deposit. On testnet since series 4 (`data/evidence/v3-s4-testnet.json`) |
| 7, 8 | Low | Anyone can reserve the budget for two blocks; a refused invoice can't be retried; an oversized period bricks `pay` | Fixed in source: a withdrawal reserves only after the owner check; a refused invoice can be paid again; the period is bounded and its arithmetic saturates. On testnet since series 4 (`data/evidence/v3-s4-testnet.json`) |

The reviewer's 60 tests are in the repository (`attack_tests3.rs` in business-v3, `attack_tests.rs`
in each companion). Each companion finding's test now asserts its fix; the two finding-2 tests are
kept as `*_documented_*`. The fixed companions pass their unit and local-node tests in WSL. The
fixed companions run on testnet as `feed-key-v3s4` and `budget-v3s4` (series 4, Nov 7,
reproducible builds in `docs/BUILDS.md`). Their record shows, on chain: an owner's request for a
nonce two past the highest signed refused (`E_NONCE`); a hand-over from the current generation
refused (`E_GENERATION`); a paid invoice submitted again refused (`E_REPLAY`); a payment without
its storage deposit refused (`E_STORAGE`); a stranger's approval and early expiry refused; an
invoice rejected by the owner; after the sale, every request of the former owner refused and the
old grant's waiting invoice refused under the new owner (`E_GRANT_ENDED`); the buyer's role move
to the address the companion derived (the request named none), final on Sepolia; and the one
publish the seller had signed and held before the close refused by Sepolia afterwards (its nonce
was used by the move). The series-3 companions (`feed-key-v3s3`, `budget-v3s3`) keep the earlier
code and records.

## Reproduce it

The reviewer's tests are in the repository, with the five that proved findings 1–4 turned around
to show the fix. In WSL Ubuntu, from `contracts/`:

```
CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --lib attack_tests
```

The full contract suite (our tests plus the reviewer's, 195 tests) is the same command without
`attack_tests`. The payout breaks on a real local NEAR node (downloads the sandbox node once):

```
CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --test sandbox -- --nocapture
```

## What stays open

- **Callback gas is measured, not proven.** A payout whose callback ran out of gas would stay in
  flight with no way to free it. On a local NEAR node with the real test token, the callback
  used at most 2.4 of its 10 reserved TGas across every payout kind, succeeding and failing (a
  4x margin), and a refund sent with too little gas failed whole before any money moved. A future
  change to NEAR's gas prices for storage could narrow that margin; rerun the check after any
  protocol upgrade (`data/evidence/v3-sandbox-payouts.txt`).
- **Customer accounts can still slow other customers' refunds** for a block or so (never lose
  them).
- **A revoked key's already-signed uses** still settle until the hold's grace deadline (at most
  10 units and one hour).
- **New usage pauses while a gated sale is closing** (up to the agreed window); refunds and
  settlement continue.
- **Not covered:** the real token's behaviour, on-chain storage costs, and off-chain services
  (Everstreet's own records follow the contract and are tested separately).
- **Which code ran on testnet.** Series 3 (2026-11-06) ran the Direct sale, the Gated sale and
  the recovery examples on the reproducible build of the fixed contract (code hash
  `H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw`, `docs/BUILDS.md`), with the companions and
  NEAR's intents verifier beside it (`data/evidence/v3-*-testnet.json`). Series 4 (2026-11-07)
  sold the Direct example's business once more with the fixed companions beside it
  (`data/evidence/v3-s4-testnet.json`). A later run had its owner pay for a new customer's
  registration; the contract records her as the payer, and the sale's economics show that
  customer's revenue as linked to the seller (`data/evidence/linked-revenue-testnet.json`). Series 2 ran the same
  source as a plain build (`3Ptn4BCWZuji2HaGawwHWZ1wpMTF3QA4fjLZF2sLNLM6`,
  `data/evidence/v3-series-2/`); series 1 ran the earlier code (`data/evidence/v3-series-1/`).
- **What the recorded refusals are.** The proof page's handover strip shows, for each of
  Ledgerline's three testnet sales, the former owner's first refused call after the close. Each
  of those is a companion's refusal (the feed key or the budget contract, which asked the
  business who the owner was), not the business contract refusing its former owner directly;
  two of the three are the call's answer inside a transaction that succeeded. The strip names
  the receiver and the kind of refusal. The business contract's own refusal of a former owner is
  covered by its tests and the synthetic chain, and the app refuses such a call before it is
  sent; it has not been recorded on testnet (a cold review on 2026-11-07,
  `reports/2026-11-07_fable-review-123.md`, found this and the rest of that page's claims sound).
- **Everstreet's own server** follows the contract rather than enforcing it. Two cold reviews
  covered its permissions (`reports/2026-11-06_permissions-review.md`,
  `reports/2026-11-07_permissions-review.md`). The first found a sale closed on the contract while
  Everstreet still showed the seller as owner; that window is now at most 15 seconds. The second
  found the solver filling an intents swap that no longer funded a sale, two quotes for one deal
  both filled, and a former owner still reading the business's economics and companions; all fixed
  the same day, with the review's 47 tests kept (`server/test/permissions-review-2/`).
