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
| Customers keep what they paid for; a sale changes nothing about their units, keys or holds | Customer records live apart from owner control; unused units are refundable at the plan price | The customer record compared byte for byte before and after a close; existing customer signatures still settle under the new operator |
| Units are spent only with the customer's own signature, never more than authorized | ed25519 signatures bound to business, plan, customer, registration, key epoch and hold | Inflate signed units; move a use to another slot; replay a closed hold; reuse a revoked key; exceed a key's daily cap; weak (small-order) keys |
| The owner withdraws only money nobody else is owed | One accounting identity: held = customers' unused units + held units + available + pending + claims + escrow | Withdraw customer money or escrow; drain below the agreed floor before closing |
| Nobody can change the code or take the account | The contract account has no access keys and no method that adds keys or redeploys | The testnet rehearsal stops if the business account has any key (`scripts/v3-rehearsal.ts`) |
| A failed payout never loses money; it becomes a claim for the right person | Money moves to pending before a transfer; a private callback settles it or turns it into the beneficiary's claim | Every payout kind failing (refund, profit, escrow return, sale proceeds); replayed or foreign callbacks; also shown on testnet with a real failed transfer |

The review lists about 50 attack lines refused, each naming the function and error that stops it
(`reports/2026-11-06_attack-review.md`, "Tried and refused").

## What the review found and what we changed

Nothing critical, high or medium. Four low findings, all fixed on 2026-11-06:

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

## Reproduce it

The reviewer's tests are in the repository, with the five that proved findings 1–4 turned around
to show the fix. In WSL Ubuntu, from `contracts/`:

```
CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --lib attack_tests
```

The full contract suite (our tests plus the reviewer's, 195 tests) is the same command without
`attack_tests`.

## What stays open

- **Callback gas.** If a payout's callback ran out of gas, that payout would stay in flight with
  no way to free it. The unit-test host doesn't meter gas, so this needs a measurement on a local
  NEAR sandbox and a safety margin. It's the next check.
- **Customer accounts can still slow other customers' refunds** for a block or so (never lose
  them).
- **A revoked key's already-signed uses** still settle until the hold's grace deadline (at most
  10 units and one hour).
- **New usage pauses while a gated sale is closing** (up to the agreed window); refunds and
  settlement continue.
- **Not covered:** the real token's behaviour, on-chain storage costs, and off-chain services
  (Everstreet's own records follow the contract and are tested separately).
- The fixes are in the contract source. Testnet rehearsals recorded before 2026-11-06 ran the
  earlier code; the next rehearsal deploys a new business account.
