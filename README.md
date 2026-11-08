# Everstreet

**Build, run, and sell a digital business. Hand it over intact.**

Everstreet is a platform for founders building AI tools, SaaS products, and agent services.
Shape a product in the studio, publish it for people to find, serve paying customers, and run
the business from one workspace. When it changes hands, the buyer takes over its managed
operations and the customers keep what they already paid for.

**Ledgerline, our example invoice API, has changed hands three times on NEAR testnet.**
In the recorded snapshot after the third sale, its first customer has **78 unused uses and
22 used of the 100 they bought**.

| The sale closes | The former owner is refused | The customer keeps their uses |
|---|---|---|
| Ledgerline moves to its next owner, at generation 4. | Ledgerline's contract refuses the former owner's owner actions with `E_NOT_OWNER`. Control is unchanged. | All 100 uses are accounted for after three sales. |
| [Closing transaction](https://testnet.nearblocks.io/txns/3psBJvLE3EBq9BNMF7ZZQub9EZab77L7je5U8x8zcSet) | [Refused owner action](https://testnet.nearblocks.io/txns/ZWJP4nst8L6Syx52WkyZ7fmCuHZJSoER6j5oD7f8zyb) | [Customer snapshot](data/evidence/ledgerline-after-sales-testnet.json) |

[Try Everstreet](#try-everstreet) · [Follow the proof](#follow-the-proof) · [Check the build](#check-the-build)

Built at NEAR HACKATHON, November 2026. Fictional businesses and people, NEAR testnet and
Ethereum Sepolia, and test tokens with no monetary value.

## From an idea to the next owner

**Build something people can use.** Start with an idea or a request on the need board. Shape
the product in the studio, keep its revisions, run checks, and release a customer offer.
Published businesses can be found by people searching for a solution. The examples span
Ledgerline's invoice extraction, Relaydesk's case workflow, and Signalwatch's changelog analysis.
The AI examples use a labeled stand-in model.

**Run the business.** The owner's desk brings together customer activity, team access,
releases, revenue, and costs. People and agents can buy prepaid uses. An agent with its own
account receives an HTTP 402 purchase offer and pays as a customer. A business can also give
an agent a supplier budget with spending limits and owner approval for larger payments.

**Prepare it for someone else to own.** A buyer can discover an acquisition, request access
to evidence, inspect the economics, and agree to exact sale terms. Everstreet carries the
business's projects, releases, and customer records through the handover. The buyer's first
shift is to confirm control, set up their team, and serve the people who already paid.

The studio and service run in the app. **For each business, one NEAR contract decides who is
in charge. The companion contracts ask it before they act.** The business contract holds prepaid units,
customer claims, treasury balances, and sale escrow. At close it changes the owner and authority
generation together. Everstreet follows the finalized result, and the buyer completes any
separate companion actions.

## How NEAR is used

- **One contract per business decides who is in charge.** `business-v3` holds the owner and an
  authority generation, operators and their capabilities, each customer's prepaid units, the
  treasury, and sale escrow. A sale closes only on the exact terms both sides accepted, and the
  close changes the owner and the generation in one step.
- **Customers and agents pay as NEAR accounts.** They buy prepaid uses with a NEP-141 test token
  (`ft_transfer_call` to the business contract). Each use settles against units the contract
  holds for that customer, so the units survive a sale. People sign in with a NEP-413 signed
  message.
- **Companion contracts ask the business contract before they act.** The supplier-budget
  companion pays suppliers within the owner's limits. The asset-key companion uses NEAR Chain
  Signatures (`v1.signer-prod.testnet`) to sign for an Ethereum address derived for each
  generation, and moves a role in a Sepolia registry to the buyer's address.
- **NEAR Intents funds the escrow.** A buyer swaps another token through NEAR's intents verifier
  and funds escrow with the proceeds.
- **Anyone can check the chain side.** The business, companion, and verifier contracts were
  deployed with no access keys from reproducible builds, the recorded runs re-read testnet
  with `--live`, and a light-client proof checks the closing transaction against a block
  header.

## Try Everstreet

Requires Node 24 or later.

```sh
npm install
npm run demo
```

Open the [demo portfolio](http://127.0.0.1:8820/portfolio), choose **Continue with Synthetic
demo wallet**, and pick a person. This local walkthrough uses a synthetic wallet and chain.
Its mid-sale business is Signalwatch. Sign out and back in to switch roles.

1. As **Delphine Marsh**, open Signalwatch from **Needs you today** and accept the sale terms.
2. As **Noah Brandt**, accept and close. Follow the first-shift checklist into the business
   you now control.
3. As **Delphine**, collect the proceeds and choose **Try an owner action**. The synthetic
   contract refuses her attempt to appoint herself.
4. As **Cara Okafor**, use Signalwatch with the prepaid entitlement she bought before the sale.

Explore the studio and the other businesses from Delphine's portfolio. The demo uses ports
8820 and 8821 and stops after two hours. Use `npm run demo -- --port 8840` to move the ports
or `npm run demo -- --minutes 300` for a longer session.

The recorded Ledgerline proof is also available in the running app at
[/proof/ledgerline](http://127.0.0.1:8820/proof/ledgerline), with the attack docket at
[/attacks](http://127.0.0.1:8820/attacks).

To view just the recorded proof as a static site, after installing dependencies, run the
following and open the [proof copy](http://localhost:8830).

```sh
npm run proof-site
npx vite preview --config web/vite.proof.config.ts
```

This builds the same proof pages from committed evidence into `web/dist-proof/`.

## Follow the proof

Ledgerline's first sale left its customer with 80 unused uses. The first buyer served the next
use, leaving 79, then released an update and served another, leaving 78. Two later sales took
the business to generation 4. The final customer snapshot still accounts for all 100 uses.
The later sale records and that snapshot are separate observations. [First sale and buyer's
update](data/evidence/v3-direct-testnet.json) · [Second sale](data/evidence/v3-ext-testnet.json) ·
[Third sale](data/evidence/v3-s4-testnet.json) · [Final snapshot](data/evidence/ledgerline-after-sales-testnet.json)

After the third sale, the former owner signed two owner-only calls and sent them straight to
the business contract, with no app in between: appointing itself as an operator and withdrawing
profit. The contract refused both with `E_NOT_OWNER` and control did not change.
[Former-owner record](data/evidence/former-owner-probe-testnet.json)

Each claim below has a test or verifier and its recorded evidence. App tests use synthetic
chains unless the row names a local NEAR node or testnet run.

| Claim | Test or verifier | Recorded evidence | Where to look |
|---|---|---|---|
| The buyer serves a customer who prepaid before the sale, including on a new release. | [Full application journey](server/test/flagship-journey-process.test.ts) | [NEAR close](https://testnet.nearblocks.io/txns/24RLpPg2CdVbPRUtLSKUL1fhFqP4TP2FhkarZWEoreGi), [Direct record](data/evidence/v3-direct-testnet.json) | `next_use_under_buyer` and `after_update` checkpoints |
| The business contract refuses the former owner's owner actions after the third sale and leaves control unchanged. | [Contract attack tests](contracts/business-v3/src/attack_tests3.rs) | [Refused appointment](https://testnet.nearblocks.io/txns/ZWJP4nst8L6Syx52WkyZ7fmCuHZJSoER6j5oD7f8zyb), [refused withdrawal](https://testnet.nearblocks.io/txns/5GHE62Gn8futiMAsjBiU1GDLeyeDr3y9oYiLPDyN2gzF) | `before` and `after` checkpoints in the [former-owner record](data/evidence/former-owner-probe-testnet.json) |
| The former owner's supplier grant is refused after the third sale. | [Companion on a local NEAR node](contracts/spend-allowance/tests/sandbox.rs) | [Failed grant](https://testnet.nearblocks.io/txns/6wPkYAYDvcyQGZtmqyC4EXe75Cc5zrj9Nr9iytuN625f), [series 4 record](data/evidence/v3-s4-testnet.json) | `former_owner_grant_refused` |
| A Gated sale returns an outstanding reservation and resumes service under the buyer. | [Gated application journey](server/test/flagship-gated-journey.test.ts) | [Gated testnet record](data/evidence/v3-gated-testnet.json) | `request_during_gate` and the closing checkpoints |
| A buyer funds escrow from another token through NEAR Intents. | [Verifier and business on a local NEAR node](contracts/intents-funding/tests/sandbox.rs) | [Withdrawal from the verifier](https://testnet.nearblocks.io/txns/CdoArhZoAVJ6b6Cn5xEvr2MfEZae3uEwr4gY4hQJFgWk), [escrow funding](https://testnet.nearblocks.io/txns/CvmiCw4NpvT8k6H2jQPeRTJ7CfCDYxjTUB1EsuhSB95a) | [Recorded swap, recovery, and funding](data/evidence/v3-ext-testnet.json) |
| The buyer moves a Sepolia role through Chain Signatures to an address derived by the companion. | [Asset key on a local NEAR node](contracts/asset-key/tests/sandbox.rs) | [Final Sepolia transaction](https://sepolia.etherscan.io/tx/0x512803af90ad082206987398a933fc9ae84184498715d1fcb56a9cae264c2934) | `move_destination_derived` and `role_move_final_gen4` in [series 4](data/evidence/v3-s4-testnet.json) |
| A registration paid by the owner causes that customer's revenue to be flagged as linked. | [Revenue attribution tests](server/test/revenue-sources.test.ts) | [Owner-paid registration](https://testnet.nearblocks.io/txns/BrRgXa3Sjj71rB2SuVsozocyyDRSb3a2GCovFWW4sscQ) | `revenue_by_source` in the [recorded application view](data/evidence/linked-revenue-testnet.json) |
| Agents receive purchase terms through HTTP 402 and get units after a confirmed purchase. | [HTTP 402 tests](server/test/payment-402.test.ts) | [Synthetic demo flow](scripts/lib/demo/agents.ts) | The owner's Agent purchases page |
| A failed sale-proceeds transfer restores the seller's claim, which can be collected later. | [Contract payout tests](contracts/business-v3/tests/sandbox.rs) | [Failed transfer and restored claim](https://testnet.nearblocks.io/txns/BeTTPWocGTCCjm84iPyWcAc5mm9cRKsQPgCCmQWosrFB), [successful retry](https://testnet.nearblocks.io/txns/GAKRgxD9BZ19f2hBi538zfHsjELHeq5Kxz7J2UNELZLm) | [Recovery record](data/evidence/v3-recovery-testnet.json) |

The Intents run uses NEAR's verifier built from published source, with Everstreet acting as
the solver. The recorded swap recovered from a lost response by checking spent nonces before
the buyer withdrew the proceeds and funded escrow. [Intents flow and build](docs/INTENTS.md)

The latest companion run uses the fixed, reproducibly built series 4 contracts. It records
the old agent grant being refused, the buyer's new grant working, and the seller's held
pre-signed publish being refused by Sepolia's RPC after the buyer's role move consumed its
nonce. [Series 4 run](data/evidence/v3-s4-testnet.json) · [Deployment and build hashes](docs/BUILDS.md)

## Check the build

The featured NEAR business contracts, fixed companions, and Intents verifier were created with
**no access keys**. Their reproducible builds record the source commit, pinned build image,
and code hash. Anyone can rebuild them and compare with the deployed code. [Build instructions
and deployments](docs/BUILDS.md)

| On testnet | What it is |
|---|---|
| [`ledgerline-v3-3b.everstreet.testnet`](https://testnet.nearblocks.io/address/ledgerline-v3-3b.everstreet.testnet) | Ledgerline's business contract (Direct sales; three sales recorded) |
| [`ledgerline-gated-v3-3.everstreet.testnet`](https://testnet.nearblocks.io/address/ledgerline-gated-v3-3.everstreet.testnet) | The same business contract, Gated sale |
| [`ledgerline-payout-v3-3.everstreet.testnet`](https://testnet.nearblocks.io/address/ledgerline-payout-v3-3.everstreet.testnet) | The same business contract, failed-payout recovery |
| [`feed-key-v3s4.everstreet.testnet`](https://testnet.nearblocks.io/address/feed-key-v3s4.everstreet.testnet) | Asset-key companion (Chain Signatures), fixed build |
| [`budget-v3s4.everstreet.testnet`](https://testnet.nearblocks.io/address/budget-v3s4.everstreet.testnet) | Supplier-budget companion, fixed build |
| [`intents-v3s3.everstreet.testnet`](https://testnet.nearblocks.io/address/intents-v3s3.everstreet.testnet) | NEAR's intents verifier, built from its published source |
| [`tusd.everstreet.testnet`](https://testnet.nearblocks.io/address/tusd.everstreet.testnet) | Test token (NEP-141), no monetary value |
| Sepolia [`0x3b093ebdf5e727766c128df85d1f4540d84de269`](https://sepolia.etherscan.io/address/0x3b093ebdf5e727766c128df85d1f4540d84de269) | Example registry whose role moves to the buyer |

Separate cold AI reviewers attacked the contracts and the application's permissions. Their
findings include companion vulnerabilities that were fixed and deployed in series 4, and an
in-flight authority window documented below. The reports retain the findings and the tests
that reproduce them. [Contract reviews](docs/SAFETY_CASE.md) ·
[Application permissions review](reports/2026-11-07_permissions-review.md)

The recorded application attack suite contains **27 cases, each refused or flagged**, plus
**5 deliberately planted faults, all caught by its checks**. It runs through the real
application routes over a synthetic chain, and the record names the commit it ran at
(`7fa7a32`, with no uncommitted changes). Separate testnet records pair permitted actions with
attacks.
[Suite record](data/evidence/attack-suite.json) · [Testnet pairs](data/evidence/attack-pairs-testnet.json) ·
[Additional testnet pairs](data/evidence/attack-pairs-extra-testnet.json)

Checks run from the repository root.

```sh
npm run check
npm run attacks -- --check
npx tsx scripts/verify-rehearsal.ts data/evidence/ledgerline-after-sales-testnet.json
npx tsx scripts/verify-light-client.ts data/evidence/light-client-close.json
```

The rehearsal verifier checks the record's digests offline. Add `--live` to read the current
testnet code hash, access keys, owner, and customer balance without signing a transaction.
The light-client verifier checks the closing transaction and receipt against a recorded
block header.

For contract tests, run in WSL Ubuntu from `contracts/`.

```sh
CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --lib
CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v3 --test sandbox -- --nocapture
```

The sandbox suite runs the real contract on a local NEAR node, including failed payouts,
retries, gas limits, and a sale closing while a refund is in flight.
[Recorded sandbox output](data/evidence/v3-sandbox-payouts.txt)

## Not claimed

- **Production readiness.** This is a hackathon build using fictional data and test tokens.
  The recorded testnet participants use separate accounts whose keys are held by the rehearsal
  operator. The local demo uses synthetic accounts and a synthetic chain.
- **Model quality.** The AI examples and recorded runs use a labeled stand-in model. They
  demonstrate the build, release, payment, and handover paths.
- **An automatic transfer of every business asset.** The sale transfers managed operating
  rights. Legal entities, IP, domains, hosting accounts, and other third-party assets need
  their own transfer evidence. The Sepolia example transfers a role in an example registry.
- **Instant enforcement everywhere.** Contract ownership changes at close. The server follows
  observed final state. Companion actions already in flight can finish using a control read
  taken before the sale. The external role move is a separate buyer action, and Gated sales
  pause new uses during closing.
- **Trustless hosting or complete revenue attribution.** The app's operator controls its
  service and database. Revenue attribution checks known account, team, operator, and
  registration-payer links. Money routed through other wallets, hidden relationships, and
  off-platform reimbursement can escape those checks.
- **An independent security audit or a fully verified light-client head.** The cold reviews
  were performed by AI models. The light-client proof is checked against a supplied block
  header whose validator signatures this verifier does not check.

The remaining contract assumptions and failure windows are documented in the
[safety case](docs/SAFETY_CASE.md) and [authority model](docs/AUTHORITY.md).

## Explore the repository

| Path | What it contains |
|---|---|
| `web/` | Studio, customer workspace, owner desk, sale room, and proof pages |
| `server/` | Application routes, managed product runtimes, permissions, and reconciliation |
| `contracts/business-v3/` | Owner authority, customer units, treasury, escrow, and closing |
| `contracts/asset-key/`, `contracts/spend-allowance/` | Chain Signatures and supplier-budget companions |
| `contracts/intents-funding/` | Local-node tests of the Intents funding flow |
| `data/evidence/` | Recorded runs, transactions, checkpoints, and attack results |
| `scripts/` | Rehearsals, read-only verification, demo, and static proof build |

The earlier OpenSeat booking and v2 sale examples remain in the
[feature reference](docs/FEATURES.md), with their [handoff](data/evidence/handoff-testnet.json)
and [sale](data/evidence/sale-testnet.json) records. Configuration for the normal application
entry is documented in [application composition](docs/design/APPLICATION_COMPOSITION.md).

## How it was made

- **Built at NEAR HACKATHON.** The first commit is November 1, 2026, inside the hackathon
  window, which opened October 19.
- **AI-written code.** The code and docs were written by AI coding agents directed by Tony:
  Claude (Anthropic) builds and verifies, and Astra (an OpenAI Codex agent) leads concept,
  story, and visual direction. The cold reviews were also done by AI models.
- **Libraries.** Contracts: near-sdk and near-contract-standards, tested with near-sandbox and
  near-api, built with cargo-near. App: Hono, React, Vite, near-api-js, NEAR Wallet Selector,
  and noble curves and hashes. Tooling: TypeScript, Biome, and Vitest.
- **Third-party contract.** NEAR's intents verifier, built unmodified from
  [github.com/near/intents](https://github.com/near/intents) (MIT) at commit `32cd1f97`.
  [Build and deployment](docs/INTENTS.md)

## Team

DadMod — Tony Langford, with AI collaborators Astra and Claude.

Everstreet is a separate project from the same team's other hackathon entry, Day One, an AI
purchasing assistant. The projects share no code, data, accounts, or deployments.
<!-- TODO before submitting: link Day One's public repository in the sentence above. -->
