# business-v3 on NEAR testnet: approval packet (four examples)

Prepared November 5, 2026 by Claude (Opus 5.5). **Nothing here has been deployed, signed or spent.**
This replaces the decisions section of `EXTERNAL_REHEARSAL_PACKET.md`, as Tony decided on Nov 5:
- script-held fictional testnet accounts sign (not Tony's wallet);
- a labelled stand-in model, so there is no provider spend;
- Direct runs first; Gated and the recovery cases run only after Direct's evidence is reviewed.

## 1. Preflight facts (read Nov 5, read-only, no keys)

| Fact | Value |
|---|---|
| Code commit | `597c497` (the run records the exact commit it uses) |
| Contract | `contracts/business-v3`, 98 Rust tests pass (incl. `payouts_keep_their_category_through_failures_claims_and_duplicates`) |
| WASM | 408,429 bytes. SHA-256 `f2ec5a4bbefc5f01aea349df25ec98b56c3f1c19399b26731620e775997e778f`; base58 (the NEAR code hash to expect) `HMGhGxrpnKJfxBSwovHmvd1zoKv5nw4hSGp3s6qhxM7C`. Built with `cargo near build non-reproducible-wasm`, rustc 1.99.1, cargo-near 0.22.0, in WSL |
| Network | testnet, protocol 88; RPC `https://test.rpc.fastnear.com` |
| Gas price | 100,000,000 yocto per gas: a 300 Tgas transaction costs at most 0.03 NEAR |
| Storage | 10^19 yocto per byte (1 NEAR per 100 KB): the contract stakes about 4.09 NEAR per business account |
| Test token | `tusd.everstreet.testnet`: "Test Dollar (testnet, no value)", symbol tUSD, 6 decimals; registration 0.00125 NEAR; the platform root holds 9,996,000 tUSD |
| Root account | `everstreet.testnet` holds 2.99 NEAR: **not enough; faucet funding is needed** (see the budget) |
| Planned names | `ledgerline-v3-1`, `ledgerline-gated-v3-1` and `ledgerline-payout-v3-1` `.everstreet.testnet`: all free |

**Limit on the code hash.** A judge can check that the deployed code hash equals the hash above,
and rebuild it from the commit with the same toolchain. The build isn't Docker-reproducible:
Docker isn't installed, and installing it is out of scope. That limit is stated in the evidence.

## 2. The four examples

Each runs on its own **new business account** (contracts are born locked; nothing is upgraded).
The people are fictional sub-accounts, and their keys are only in `.near-credentials/`.

| # | Example | Business account | What it proves | Deliberate fault |
|---|---|---|---|---|
| 1 | Direct sale (the flagship) | `ledgerline-v3-1` | Founder releases Ledgerline and opens a prepaid offer; a fresh customer buys 100 and uses 20 (80 left); Direct sale closes; control moves to the buyer at generation 2 with 80 still owed; the old owner's write is denied and the buyer's succeeds; the customer's next use leaves 79; the buyer ships a checked update and a later use names the new release | none |
| 2 | Gated close with work outstanding | `ledgerline-gated-v3-1` | Customer buys 100, uses 5, reserves 1 (94 free / 1 reserved / 5 consumed); a fresh request during the gate is refused (no new hold or charge); the reservation is returned once; the close is finalized once by the closer's restricted key; 95 free / 0 reserved / 5 consumed under the buyer; an earlier result is still readable; one more use leaves 94 / 6 | none (if the gate window is too short to hit reliably, that assertion is labelled local-only, as Astra allowed) |
| 3 | Lost purchase response | `ledgerline-payout-v3-1` (shared with 4) | A purchase lands on chain; the app's readback answer is dropped before it records confirmation; a recheck with the original hash confirms exactly one purchase, one payment and one entitlement increase | a **test-only relay** between the app and the RPC drops exactly one answer: the purchase check's transaction-status read. Not in production code |
| 4 | Failed token payout | `ledgerline-payout-v3-1` | After a small Direct sale, the seller (not registered with tUSD) collects proceeds: the transfer fails downstream and the callback restores the same amount, category and beneficiary; the buyer can't take the seller's claim; the seller registers, rechecks and collects once; a replay pays nothing | natural: the seller simply isn't registered with the token |

### Who signs what (all script-held, fictional)

| Account | Key | Signs |
|---|---|---|
| `everstreet.testnet` (root) | existing full access | create and fund each account; deploy and init each business in one transaction (no key left on the business); tUSD transfers to the customers and buyers |
| `founder-v3` | full access (new) | sign-in (NEP-413 message); plan, metering appointment, sale proposal, close acceptance, claims |
| `buyer-v3` | full access (new) | sign-in; register, fund, accept; after the sale, the update's release steps |
| `cara-v3-1`, `cara-v3-2`, `cara-v3-3` (one per example) | full access (new) | sign-in; registration shell and purchase (`ft_transfer_call`); its device **use key** signs hold and use messages off-chain (ed25519 messages, not transactions) |
| `meter-v3` | **function-call key only**: receiver the business; methods `open_hold`, `settle_hold`, `release_hold_for` | the platform's metering writes (the server's writer key) |
| `closer-v3` (Gated only) | **function-call key only**: receiver `ledgerline-gated-v3-1`; method `close_sale` | the managed close |

Each person signs only the exact call the app prepared and showed: the same receiver, method,
arguments, deposit and gas. A small labelled **script wallet** does this; it's how the tests'
wallet works, but with real keys.

## 3. Budget (testnet NEAR has no monetary value)

| Item | Estimate |
|---|---|
| 3 business accounts: contract storage (staked, not burned) + init margin | 3 × 4.2 = 12.6 NEAR |
| 8 people/operator accounts × 0.5 NEAR | 4.0 NEAR |
| tUSD registrations (about 12 × 0.00125) | 0.02 NEAR |
| Gas: about 120 transactions, worst case 0.03 each (realistically under 0.5 total) | ≤ 3.6 NEAR |
| **Ceiling: the run stops if total spend would pass it** | **20 testnet NEAR** |
| tUSD (customers 3 × 20, buyers 2 × 300) | from the root's existing supply, no cost |
| AI provider | **$0**: the labelled stand-in model; no provider call is made |

**Funding:** the root has 2.99 NEAR, so about 18 NEAR more is needed. The proposal is to create
two new fictional top-level testnet accounts through NEAR's public testnet faucet service and
transfer their NEAR to the root. That is free, and it's the only external service used besides
the RPC.

## 4. Stop conditions (stop, record, decide; never retry blindly)

- A code hash, account, receiver, method, deposit or amount differs from this packet or the
  app's review.
- A write's outcome is unknown: resolve it only through the writer history (the original
  attempt's own final status) before any retry.
- `clock_uncertain` or stale evidence twice in a row.
- Spend would pass the 20 NEAR ceiling.
- Example 1's evidence isn't reviewed and accepted: examples 2 to 4 don't start.

## 5. Evidence (what a judge gets)

One sanitized record per example in `data/evidence/v3-<example>-testnet.json`, with the same
digests as the portable handover record, so the offline verifier checks its integrity. Each step
records:
- the transaction hash and explorer link;
- the downstream receipt outcomes;
- the finalized block;
- before/after views: entitlement free/reserved/consumed, treasury, token balances, control
  owner and generation;
- the deployed code hash;
- the metering and closer keys' receiver, methods and allowance (kept apart from the contract's
  own caps);
- what the app recorded, kept separate from chain facts.

Every fact carries its source: `chain_final`, `app_recorded`, `fresh_read` or `unknown`. Model
results are labelled `stand-in model`, never provider evidence. There are no keys, no customer
document text and no tokens in any record. The README's four rows then say "verified on NEAR
testnet", "reproduced locally" or "pending", with the commit, the evidence link and the steps to
check it.

## 6. Local work before any live step (no approval needed; in progress)

1. The script wallet and a testnet launcher for the configured app: real RPC, the labelled
   stand-in model, the writer and closer keys from `.near-credentials/`.
2. The one-answer drop relay for example 3, used only by the rehearsal script.
3. The evidence recorder and an offline-verifier extension, dry-run end to end against the local
   synthetic harness first.

## Tony's yes is needed for

**One approval covers sections 2 to 4:**
- creating the fictional accounts;
- using the faucet for about 18 testnet NEAR;
- deploying three business-v3 accounts;
- the script-held signing listed above;
- the 20 NEAR ceiling.

Direct runs first, and I report its evidence before running the other three.
