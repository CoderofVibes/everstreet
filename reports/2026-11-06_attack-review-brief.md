# Attack review brief: the business contract (business-v3)

You are reviewing a NEAR smart contract as an attacker would. You have not seen this project
before and you should not look for earlier reviews, reports or test names; read only what is
listed under "What you may read". Your job is to break it, not to confirm it works.

## What the contract is for

One contract per small online business. Customers prepay units of a plan in a test token and
spend them with their own signed holds and uses. The owner earns from settled uses and can
withdraw what is not owed to anyone. The business can be sold: the seller proposes terms to
one buyer, the buyer funds escrow, both accept one digest, and control moves to the buyer at a
new generation. Customers must be untouched by a sale.

The product makes these promises to people. Each is a target:

1. Escrow can't be taken. A buyer's escrow goes to the seller only if the sale closes on the
   agreed terms; otherwise it returns to the buyer.
2. The seller gets paid exactly the agreed price when the sale closes, and only then.
3. After a sale, the old owner and old operators have no power; only the operators the buyer
   agreed to keep carry over.
4. Customers keep what they paid for: unused units are always refundable at the plan price,
   and a sale changes nothing about their units, keys or holds.
5. Units are spent only with the customer's own signature, never more than they authorized.
6. The owner can withdraw only money nobody else is owed.
7. Nobody can change the code or take the account (no access keys).
8. A failed payout never loses money; it becomes a claim for the right person.

## Who you play

Work through each role in turn, and write findings as you go (see "Output").

- **Buyer** trying to get the business without paying, pay less, or get escrow back after
  closing.
- **Seller** trying to keep both the escrow and the business, change terms after acceptance,
  or drain customer money before or during a sale.
- **Former owner or operator** trying to act after the sale.
- **Operator** trying to exceed its capabilities (spend customer units, withdraw, appoint).
- **Customer** trying to get refunds twice, spend someone else's units, or block others.
- **Outsider** calling every public method, including callbacks and the token receiver with
  a fake token contract.
- **The network**: failed or delayed receipts, a callback that fails after state changed,
  running out of gas partway, two transactions racing in one block, storage running out.

NEAR-specific things to check deliberately: callbacks callable by anyone; state changed before
a cross-contract call that later fails; `ft_on_transfer` from a contract other than the
configured token; attached-deposit checks (1 yoctoNEAR confirmations); gas ceilings on
promises; storage staking (can anyone make the contract unable to pay for its storage?);
integer overflow and rounding; signature replay across plans, customers, contracts or key
epochs; deadlines and block timestamps.

## What you may read

- `contracts/business-v3/src/lib.rs` (the contract)
- `docs/design/BUSINESS_V3_CORE.md` and `docs/design/BUSINESS_V3_SALE.md` (what it is meant to do)
- `docs/AUTHORITY.md` (the authority model; parts of it describe older versions)
- `contracts/business-v3/Cargo.toml`

Do **not** read `contracts/business-v3/src/tests.rs`, anything in `reports/` or `docs/astra/`,
or any other review. You may read near-sdk source if you need to know what a macro does.

## Proving a finding

A finding is strongest with a test that performs the attack. Do not edit the repository.
Instead, copy `contracts/` (without any `target/` folder) into your scratch folder and add tests
there. Build and run in WSL Ubuntu:

```
wsl -e bash -lc 'cd <your copy, as /mnt/c/...>/contracts && CARGO_TARGET_DIR=$HOME/everstreet-attack-target cargo test -p business-v3 --lib <test name>'
```

Write new tests in a new file (for example `src/attack_tests.rs`, added with
`#[cfg(test)] mod attack_tests;` in your copy of `lib.rs`). A first build takes several
minutes. A test that shows the attack succeeding is the proof; if the attack fails, say so
briefly and move on. Unit-test hosts can't run real cross-contract calls, so for failed
receipts simulate the callback result the way near-sdk's testing utilities allow.

No network access is needed. Do not use NEAR testnet or mainnet, and do not touch
`.near-credentials`.

## Output

Write `<scratch folder>/attack-review.md` and append to it as you go, one finding at a time,
so nothing is lost if you stop early. For each finding:

- **Number and title**
- **Severity**: Critical (money or control taken), High (a promise above broken in a reachable
  way), Medium (a promise weakened, or funds stuck), Low (hardening), Note (worth knowing).
- **Role** that performs it
- **Steps**: exact calls in order
- **What should happen** and **what happens**
- **Proof**: test name and file, and whether it passed (attack worked) or failed (attack refused)
- **Location**: function and line in lib.rs

At the end, add a section "Tried and refused": the attacks you tried that the contract stopped,
one line each with the function that stops it. This list matters as much as the findings.

Finish with a summary: counts by severity, and the one change you would make first.
