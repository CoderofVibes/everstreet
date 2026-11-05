# 003web A fresh customer buys and uses the product: report

Job: `docs/astra/jobs/2026-11-04_003web_fresh-customer-purchase.md`.
Design: APPLICATION_COMPOSITION §10, plus §10.7 for the corrections made during the job.

**Status: in review**, for Astra's actual browser pass. 003we stays partial until that is
accepted. 003wec (contract-guarded revocation) is queued next, and 003wf comes after all 003we
children.

## Commits

| Commit | What it holds |
|---|---|
| `67232e0` | `usePhoneLayout.test.ts` removed, after the check passed (1336 passed and 1 skipped) |
| `9d0ed26` | Astra's acceptance, INDEX, ACCEPTANCE and JOBS |
| `1d7ff99` | JOBS: 003web taken |
| `e3949c4` | The contract fixture: measured shell storage and the buy outcomes |
| `0ed7557` | Design §10, **written before the purchase code**, after its contract fixture |
| `e6375d2` | First server reads and calls, intents, the resolver, routes and the contract-anchored double |
| `cb740e0` | **Contract:** registration-bound buys and `get_purchase_terms` (not deployed) |
| `90659d2` | Corrected resolution and recovery (Astra's review and probes) |
| `9138fe1` | Purchase-table upgrade, the Buy uses panel, the fresh-customer harness |
| `b1a2cf3` | The actual page buying through the real Wallet Selector path; prices in tokens |
| `4ed1417` | The resolver binds the whole transaction; a legacy set-aside blocks a fresh payment |
| `4aa5963` | Astra's design review, four probes, capability extensions and queued 003x, 005e, 006b, 006c |
| Final | Design §10.7, this report and JOBS |

## The brief, item by item

**1. The read and transaction sequence** (`GET …/purchase-setup`). It is authenticated and
reads the caller's own linked account only, at one pinned final block:
- the plan, compared with the offer's reviewed plan;
- the entitlement: registration id, `purchase_seq`, free and held units;
- `get_purchase_terms`;
- the token's `ft_metadata` (validated: `ft-1.0.0`, decimals 0–38, a plain symbol);
- `ft_balance_of`;
- both `storage_balance_of`s (customer and business);
- `storage_balance_bounds`.

Every amount is an exact u128. Anything malformed, oversized, mixed-block or mismatched refuses
the read, and unknowns are never shown as zero. The transport allowlist gained exactly these
token views and `get_purchase_terms`, with their exact arguments.

**2. The shell storage quote.**
- **Exact, from the running contract** (`get_purchase_terms`): 811 + the customer account's
  length, in bytes, times the contract's byte cost.
- **Measured by the contract's own test** for customer lengths 2, 9 and 64 and payer lengths 2,
  12 and 64; the payer never matters.
- **The basis is shown.** Any excess is refunded; less is refused.
- **A contract without the view is unavailable** for purchase, as an upgrade.

**3. The token.**
- **The balance and both registrations are read.** The exact `storage_deposit` (with
  `storage_balance_bounds.min`) is offered when the customer isn't registered, with the plain
  note that their tokens are still their own.
- **The business not being registered** is an owner action, and nothing is sent.
- **No faucet, bridge or other account's balance.**

**4. Exact purchase preparation.**
- u32 units within the per-purchase cap;
- a BigInt total below 2^128;
- the outstanding cap (free + held + units);
- a sequence below the u32 maximum;
- the registration id **bound in the message**;
- optional install constraints (slot not active, 64-hex key, plan hold limit, 1–65535 per day).

The reviewed terms digest is re-derived from a fresh read; a change gives `terms_changed` with
the new preview to review. In the browser, `PurchaseFlow` re-derives the call from its terms, and
requires the stored request to **equal** the reviewed one before sending (Astra's consent
probe). A separate purchase followed by enrollment works with no key added (tested). Buy with
install is supported in the API and contract and is tested at route level; there is no UI toggle
for it yet.

**5. The durable intent and recovery** (`customer_purchases`). It stores public identifiers and
terms only.
- **One open purchase per account, contract and plan**, enforced by a unique index; an
  unresolved legacy set-aside also blocks.
- **The ask is recorded before each wallet request.**
- **No sequence increment is taken as this purchase.**
- **A requested purchase is never set aside or replaced**, and no time window closes it (Astra's
  probe: the wallet picks the reference block when it signs).
- **The only closure without a transaction** is a replaced registration, giving `not_accepted`.
- **The bounded explicit check:** "a purchase with this sequence is recorded, but it can't be
  shown to be this one", or "not recorded yet".
- **The identical resend** is its own reviewed consent (`RESEND_CONSENT`: at most one is
  accepted, a duplicate is returned whole, and its gas is spent).
- **It survives a restart**, and the earlier table is upgraded in place.

**6. Wallet evidence.**
- **The transaction hash comes only from the pinned adapter's answer**
  (`FinalExecutionOutcome.transaction.hash`); otherwise it is null and the outcome unknown.
- **The resolver** needs FINAL, no top-level failure, `transaction_outcome.id` equal to the hash,
  one action with the complete reviewed call (method, deposit, gas, arguments), and the receipt
  graph: transfer → receiver and resolution, each succeeded.
- **Confirmed** needs `units_bought` with 0 unused and the whole amount used. **Returned** needs
  `purchase_returned` and the resolution to have succeeded using none.
- **The server only verifies and reads.** There is no customer signer anywhere.

**7. Tests from nothing**, through the real routes and controllers, over the contract-anchored
double:
- the shell, then a purchase of 100 with a newly generated device key installed in the same
  call;
- confirmed from its own transaction;
- one real use prepared, confirmed and executed, and its unit **charged** (free 99, consumed 1).

The double applies the actual calls by lib.rs's rules. `purchase-world.test.ts` replays every
contract fixture case and matches its exact logs, returned amounts and entitlement JSON:
- shells for every customer length;
- accepted and refused purchases (wrong amount, stale sequence, both caps, no shell, occupied
  install);
- install;
- registration replacement;
- the terms view.

Also covered:
- insufficient funds;
- stale terms;
- a wallet cancellation;
- accepted with the answer lost (unknown, then confirmed by its own transaction);
- returned (another purchase took the sequence);
- a failed token resolution (never "returned");
- an unrelated transaction hash;
- malformed metadata;
- the business unregistered with its token;
- a replaced registration;
- an older contract without the view;
- concurrent tabs (one intent);
- another person (404);
- a restart on the same file;
- old-owner continuity (after a sale: same units, the next sequence).

**8. Harness:** `npx tsx scripts/wallet-harness.ts [--minutes N] [--seeded]`.
- It now defaults to a **fresh customer**: Dana, with no units and no key, holding her own
  fictional test tokens.
- Its synthetic wallet module applies `sponsor_shell`, `storage_deposit` and `ft_transfer_call`
  through the same contract-anchored double, and answers with the transaction outcome.
- **The actual page,** under jsdom, with the real Wallet Selector and the harness's own module
  script: registration (0.0082 NEAR, 820 bytes), then 100 uses for **5 TUSD (5000000 base
  units)**, confirmed (`purchasePanel.test.tsx`).
- **The UI leads with token amounts.** The product header shows "One unit: 0.05 TUSD (50000 base
  units of tusd.near)" once the validated metadata is read. No fiat appears anywhere.

## Astra's probes, all passing now

| Probe | Coverage |
|---|---|
| `astra-purchase-resolution-review` | 8 cases: optimistic status, failed receiver, failed resolution, a disconnected receipt, another transaction's graph, gas, top-level failure |
| `astra-purchase-recovery-review` | 3 cases: set-aside then late inclusion; no replacement; no expiry before the wallet signs |
| `astra-purchase-consent-review` | 4 cases: the create answer changing recipient, deposit or customer sends nothing |
| `astra-purchase-migration-review` | 2 cases: an old unknown row recovers; an old abandoned row blocks a fresh payment |

## Checks

- **Contract** (WSL Ubuntu, `CARGO_TARGET_DIR=~/everstreet-target`, local tests only): 74
  passed, and the wasm build succeeds. Nothing was deployed.
- **`npm run check`:** one run with nothing concurrent, at `4ed1417`. Exit 0, lint (402 files)
  and types clean. 1388 passed and 1 skipped (1389), across 153 passed and 1 skipped files.
- **`npm run web:build`:** exit 0. The main chunk is 935.68 kB (it was 917.28 kB; the purchase
  flow and panel). CSS is 73.02 kB.
- **Bounded harness smoke:** the ports were free, and the fresh account `dana.near` was served.
  The published offer answered and the page carried the CSP `connect-src 'self'`. It stopped
  itself after one minute, and the ports were free afterwards.

**Nothing live:**
- no real wallet, transaction, deployment, provider, host action, credential, push, spending,
  research, Day One or legacy main;
- every key is newly generated;
- every chain outcome is the labelled double's.

The worker stays disabled.

## Remaining gates (stated)

- **Astra's actual browser pass on the harness:**
  - the fresh customer at 390 and 1440, keyboard and focus;
  - the review copy and token amounts;
  - cancellation, lost answers and late answers through the controls;
  - the resend review;
  - an account switch.
- **Buy-with-install from the UI:** the API and contract support it, but the panel enrolls
  separately. A UI toggle is a small follow-up.
- **The contract change needs a deployment:** a new business account, which is Tony's decision.
  Existing deployed businesses stay "upgrade required".
- **Live:** the real token's metadata and behaviour, and real wallet answers (whether
  MyNearWallet returns a FinalExecutionOutcome with the hash) belong to the rehearsal packet.
- **003wec** (guarded on-chain revocation) is queued next. **003wf** comes after all 003we
  children: the normal composition, concurrency, restart and the 100/20/80 acquisition.
- **Also queued:** 003x, 005e, 006b, 006c, 002f1, 004b, 005c, 005d, 006a and the M6 jobs. All
  six milestones are open.
- **The harness's signed-out Home** label isn't evidence about discovery; coherent
  publication, discovery and use belong to 003wf.
