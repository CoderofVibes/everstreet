# External testnet rehearsal packet (prepared, NOT executed)

003wf parent slice 7. Prepared November 5, 2026 by Claude under Tony's local build authorization.
**Nothing in this packet has been run.** Running it requires Tony's explicit yes in chat for each
decision listed under "Decisions needed". No mainnet, no real customer, no publication.

## 1. What already exists, by kind of evidence

| Kind | What | Where |
|---|---|---|
| Recorded live testnet (legacy) | v1/v2 business contract deployed and sold once (OpenSeat, generation 2); payments smoke; one sale smoke | `config/testnet.json`, `data/evidence/*-testnet.json` |
| Local contract execution | business-v3 core, sale, guarded plan (Rust unit/sandbox tests, clippy, wasm build) | `contracts/business-v3`, Rust tests |
| Synthetic configured process | the flagship 100/20/80/79 journey + buyer update in one configured child; writer, closer, handover, plan-setup process matrices | `server/test/flagship-journey-process.test.ts` and the process group in `npm test` |
| Synthetic browser | 003wf2/003wf4 harness pages driven in a real browser (Astra's earlier sessions; Claude's 003wf4 repeat on Nov 5) | `docs/astra/CLAUDE_RESUME.md`, Astra review notes |
| **Missing** | any business-v3 deployment; any real wallet signature; any live provider call in a customer use; the full journey on testnet; Gated close with a real closer key | this packet |

## 2. Prerequisites (each needs a decision before any action)

1. **Code.** business-v3 with `create_plan_guarded`/`get_plan_terms` and the Direct sale methods,
   built reproducibly (WSL, `CARGO_TARGET_DIR=$HOME/everstreet-target`); record the wasm SHA-256
   and code hash. The contract is born locked: a deployment is one new account, never an upgrade.
   Cost at measurement time: a direct deploy stakes about 1 NEAR per 100 KB of storage; a global
   publish burns about 10 NEAR per 100 KB (Everstreet's Nov 2 measurement for v2: 276 KB).
2. **Accounts (fictional, faucet-funded testnet only).** A new business account per run
   (`<name>-v3-<n>.everstreet.testnet`), the founder, the buyer, one customer, the platform's
   metering operator (function-call key limited to `open_hold`, `settle_hold`,
   `release_hold_for`), and for Gated only the closer (function-call key, `close_sale`). Keys are
   created locally into `.near-credentials/` (gitignored) and never printed.
3. **Token.** The fictional `tusd.everstreet.testnet` (6 decimals). Storage deposits for the
   business, buyer and customer (`storage_deposit`, measured `storage_balance_bounds`), and test
   balances: customer ≥ 15 TUSD (100 × 0.15), buyer ≥ the sale price.
4. **Wallet.** A supported Wallet Selector module (MyNearWallet, pinned 10.1.4) in a real browser,
   operated by Tony. Claude never signs with a person's wallet.
5. **Provider.** An Anthropic key in the configured variable, the AI config's
   `operator_ceiling_cents` and `runtime_operator_ceiling_cents` set to an explicit spend ceiling
   (proposal: 100 cents total), pricing version recorded.
6. **Configuration.** A `configured` config: FastNEAR testnet RPC, v3 binding of the new business
   account, customer writer key file, protected storage, maintenance, `operators.accounts`.

## 3. Ordered actions and expected receipts

Each step names its expected chain evidence; the run stops at the first mismatch (section 4).

1. Deploy+init the business account (one transaction, no keys left). Expect: code hash equals the
   recorded build; `get_control` shows owner = founder, generation 1.
2. Founder signs in (NEP-413) and, in the Studio, revises, builds, evaluates (10 required cases)
   and releases. Expect: build succeeded with recorded usage; evaluation `release_ready`;
   provider spend within the ceiling.
3. Customer access: `create_plan_guarded` (0.15 TUSD, 100 per purchase, guided timing) signed by
   the founder's wallet; `appoint` metering. Expect: `plan_created` event, readback equal to the
   review; operator slot caps 1 at generation 1.
4. Offer created from its own inspection.
5. Customer registers (`ft_transfer_call` shell + key install) and buys 100. Expect: entitlement
   free 100; the exact amount 15 000 000 base units moved.
6. 20 uses through the device key. Expect: 20 `open_hold` + 20 `settle_hold` by the metering
   key; free 80; 20 results readable by the customer only; operations 20/20; compute cost
   recorded per use.
7. Direct sale: seller proposes (metering grant in the terms), buyer registers, funds and accepts,
   seller accepts (close). Expect: `closed` event; control owner = buyer, generation 2; the
   platform's reconciliation applied; free still 80.
8. Former owner refused (customer access, releases); buyer has management.
9. Next use under the buyer. Expect: free 79; the same customer key; settle by the metering key.
10. Buyer releases a reviewed update and offers it; one use on it. Expect: free 78; the use's
    invocation names the new release.
11. Optional, separate decision: a Gated sale on a second fresh business with the closer.

## 4. Abort criteria (stop, record, decide; never retry blindly)

- A code hash, account, network, receiver, method, deposit or amount differs from the review.
- Any writer attempt becomes `needs_reconciliation`: stop customer uses and resolve it only
  through the operators' writer history (its own FINAL status).
- Provider spend reaches the ceiling, or a provider call's cost is unknown.
- The clock check (`clock_uncertain`) or evidence freshness fails twice in a row.
- The total testnet NEAR spent exceeds the decided budget.

## 5. Cleanup

Retire the offers; record final control, entitlement and treasury views to
`data/evidence/rehearsal-<date>.json` (no keys, no customer content); delete the disposable
database and protected storage; keep the accounts (born-locked contracts can't be reused anyway).
Remove local key files for the fictional people after the record is written.

## Decisions needed from Tony (not requested yet)

1. Whether to deploy business-v3 to testnet at all now, and the NEAR budget for it.
2. The provider spend ceiling for the rehearsal.
3. Whether Tony operates the wallet steps in his browser (they are his signatures).
4. Whether the Gated variant is in scope for the first rehearsal.
