# Attack review brief: the business contract and its companions (November 7, 2026)

You are reviewing NEAR smart contracts as an attacker would. You have not seen this project
before and you should not look for earlier reviews, reports or test names; read only what is
listed under "What you may read". Your job is to break them, not to confirm they work.

## What the contracts are for

**business-v3**: one contract per small online business. Customers prepay units of a plan in a
test token and spend them with their own signed holds and uses. The owner earns from settled uses
and can withdraw what is not owed to anyone. The business can be sold: the seller proposes terms
to one buyer, the buyer funds escrow, both accept one digest, and control moves to the buyer at a
new **generation**. Customers must be untouched by a sale.

Two **companion** contracts hang off a business and take their authority from it, by asking the
business contract `get_control()` at the moment of each call. Neither has an owner of its own.

- **asset-key**: control of one external asset on an EVM chain (a registry contract with a single
  `controller` role) follows the business's owner. It asks NEAR's MPC signer (Chain Signatures) to
  sign one narrowly typed EVM transaction built inside the contract, from a derivation path that
  contains the business's generation (`gen-<generation>`), so each owner has their own address on
  the other chain. A buyer moves the registry's controller from the seller's address to their own
  after a close; the seller, no longer owner, can't ask for anything.
- **spend-allowance**: an operating budget an agent can pay approved suppliers from, within caps,
  for one generation only. The grant is bound to the generation at grant time and ends when control
  moves. Customer money never enters it.

The registry on the EVM side is hand-assembled bytecode (no compiler): `controller()`, `latest()`,
`publish(bytes32)` and `setController(address)`, the last two controller-only.

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
9. **Companions follow the business.** After a close, the former owner can't publish, move the
   external role, grant or approve from the budget, and the old grant pays nothing. The buyer can
   take the external role without the seller's help. No one but the business's current owner can
   make a companion sign or pay.
10. **The budget pays only approved suppliers, within caps, each invoice once**; a refused token
    transfer becomes the supplier's claim, never lost and never paid twice.
11. **The companion signs only the transaction it built.** A caller can't smuggle their own
    calldata, destination, chain id or derivation path into the MPC request.

## Who you play

Work through each role in turn, and write findings as you go (see "Output").

- **Buyer** trying to get the business without paying, pay less, or get escrow back after
  closing.
- **Seller** trying to keep both the escrow and the business, change terms after acceptance,
  or drain customer money before or during a sale; or to keep the external role or the budget
  after the close (including transactions signed before the close and sent after it).
- **Former owner or operator** trying to act after the sale, on the business or a companion.
- **Operator** trying to exceed its capabilities (spend customer units, withdraw, appoint, make
  a companion act).
- **Agent** (the budget's agent) trying to pay an unlisted supplier, exceed a cap, pay an invoice
  twice, pay across a generation, or get an approval to cover a different invoice.
- **Supplier** trying to be paid twice or claim what isn't theirs.
- **Customer** trying to get refunds twice, spend someone else's units, or block others.
- **Outsider** calling every public method of all three contracts, including callbacks, the
  token receiver with a fake token contract, and a fake business contract or fake signer answering
  a companion's cross-contract call.
- **The network**: failed or delayed receipts, a callback that fails after state changed,
  running out of gas partway, two transactions racing in one block, storage running out, a
  control change landing between a companion's `get_control()` read and its action.

NEAR-specific things to check deliberately: callbacks callable by anyone; state changed before
a cross-contract call that later fails; `ft_on_transfer` from a contract other than the
configured token; attached-deposit checks (1 yoctoNEAR confirmations) and deposits kept on
refusal; gas ceilings on promises; storage staking (can anyone make a contract unable to pay for
its storage?); integer overflow and rounding; signature replay across plans, customers,
contracts or key epochs; deadlines and block timestamps; for the companions, the time between
the authority read and the action, and what a stale `generation` lets through.

## What you may read

- `contracts/business-v3/src/lib.rs`, `contracts/asset-key/src/lib.rs`,
  `contracts/spend-allowance/src/lib.rs` (the contracts; their module comments are their
  specification), and their `Cargo.toml`
- `contracts/test-signer/src/lib.rs` and `contracts/test-token/src/lib.rs` (test doubles of the
  MPC signer and the token, so you know what the companions expect of them)
- `docs/design/BUSINESS_V3_CORE.md` and `docs/design/BUSINESS_V3_SALE.md` (what business-v3 is
  meant to do)
- `docs/AUTHORITY.md` (the authority model; parts of it describe older versions)
- `scripts/lib/feedRegistry.ts` (the EVM registry's bytecode, opcode by opcode) and
  `server/src/evm.ts` (how the app rebuilds the same EVM transaction bytes the contract signs)

Read the contracts from the copy described below, which has every existing test removed. Do
**not** read anything under `contracts/*/src/tests.rs`, `contracts/*/src/attack_tests*.rs`,
`contracts/*/tests/`, `contracts/intents-funding/`, `reports/`, `docs/astra/`,
`docs/SAFETY_CASE.md`, or any other review or test. You may read near-sdk source if you need to
know what a macro does. NEAR's intents verifier (used elsewhere to fund escrow from another token)
is NEAR's own contract and out of scope; the business contract sees only an ordinary escrow
funding from it.

## Proving a finding

A finding is strongest with a test that performs the attack. Do not edit the repository. A copy of
`contracts/` with every existing test removed is ready for you at

`<scratch>/attack/contracts` (your scratch folder is given to you with this brief)

Add tests there. Build and run in WSL Ubuntu:

```
wsl -e bash -lc 'cd /mnt/c/<the scratch path>/attack/contracts && CARGO_TARGET_DIR=$HOME/everstreet-attack-target cargo test -p business-v3 --lib <test name>'
```

(`-p asset-key` and `-p spend-allowance` likewise.) Write new tests in a new file (for example
`src/attack_tests.rs`, added with `#[cfg(test)] mod attack_tests;` at the end of your copy of
`lib.rs`). A first `cargo test` takes several minutes. A test that shows the attack succeeding is
the proof; if the attack fails, say so briefly and move on. Unit-test hosts can't run real
cross-contract calls, so for failed receipts and companion callbacks simulate the callback result
the way near-sdk's testing utilities allow (`testing_env!` with promise results).

No network access is needed. Do not use NEAR testnet, Sepolia or mainnet, and do not touch
`.near-credentials` or `.evm-credentials`.

## Output

Write `reports/2026-11-07_attack-review.md` (in the repository, the one file you write there) and
append to it as you go, one finding at a time, so nothing is lost if you stop early. For each
finding:

- **Number and title**
- **Severity**: Critical (money or control taken), High (a promise above broken in a reachable
  way), Medium (a promise weakened, or funds stuck), Low (hardening), Note (worth knowing).
- **Contract and role** that performs it
- **Steps**: exact calls in order
- **What should happen** and **what happens**
- **Proof**: test name and file, and whether it passed (attack worked) or failed (attack refused)
- **Location**: function and line

At the end, add a section "Tried and refused": the attacks you tried that the contracts stopped,
one line each with the function that stops it, grouped by contract. This list matters as much as
the findings.

Finish with a summary: counts by severity, and the one change you would make first. Reply with
that summary.
