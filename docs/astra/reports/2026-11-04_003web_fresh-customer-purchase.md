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
| `6aa4979` | Design §10.7, this report and JOBS (handoff) |
| `4786023` | Astra's handoff review, browser review and INDEX |
| `627946d` | **Contract test:** accepted, validly emptied and removed, then the same request returned |
| `d858a3c` | Affirmative transaction success; a replaced registration never closes a purchase as not accepted |
| `841ef1c` | Design §10.7, this report and JOBS (handoff corrections) |
| `1762843` | JOBS: the browser-review continuation taken |
| `0d10687` | Astra's purchase refresh review and its probe |
| `fa321c0` | Browser-review corrections: units refresh, original-transaction recovery, plainer copy, setup first; stale setup readings fenced |
| `a378154` | Design §10.7, this report, JOBS and INDEX (browser-review continuation) |
| `2362107` | JOBS: harness wallet-history test support taken |
| `12c6ab7` | Astra's purchase browser repeat |
| `30d1593` | Harness: read-only synthetic wallet history on the control listener; the comma-operator lint warning removed |
| Final | This report, JOBS and INDEX |

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
- **A readback never closes a purchase as not accepted** (Astra's handoff review). The contract's
  own test shows a purchase that was accepted, then its registration validly emptied and
  removed, after which the same request is returned. So a request that names its registration
  becomes `registration_replaced` when that registration reads as gone: it no longer blocks a
  purchase for a new registration, and it stays checkable by its own transaction. A request that
  names no registration (from before the binding) stays open and blocking. An earlier version's
  `not_accepted` record is kept as it is and checkable, with its old reading kept as
  `evidence.earlier` once proven.
- **The bounded explicit check:** "a purchase with this sequence is recorded, but it can't be
  shown to be this one", or "not recorded yet".
- **The identical resend** is its own reviewed consent (`RESEND_CONSENT`: at most one is
  accepted, a duplicate is returned whole, and its gas is spent).
- **It survives a restart**, and the earlier table is upgraded in place.

**6. Wallet evidence.**
- **The transaction hash comes only from the pinned adapter's answer**
  (`FinalExecutionOutcome.transaction.hash`); otherwise it is null and the outcome unknown.
- **The resolver** needs FINAL, an affirmative top-level `SuccessValue` equal to the token
  resolution's value (no `Failure` field alone is not proof), `transaction_outcome.id` equal to the hash,
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
- a replaced registration (`registration_replaced`: not blocking, still checkable, returned if
  it executes);
- an unbound earlier request (stays open and blocking; the new registration accepts it);
- an earlier `not_accepted` record (checkable and confirmed by its own transaction; unbound
  ones block);
- on the actual page, a lost answer and then a replaced registration: listed as an earlier
  purchase with an unknown outcome, and a new purchase offered;
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

## The browser-review continuation (Astra's PurchaseBrowserReview and PurchaseRefreshReview)

**1. The device panel follows the contract's units.** Reproduced first on the actual page: after
a lost reply that landed, the purchase panel showed 100 uses, but the device panel still said
there were none to enroll for. The purchase panel only notified the page on a confirmed purchase
or a new registration. Now any fresh reading that shows the registration or units changed
notifies it, and the device panel re-reads the contract itself, without a remount and with only
its newest reading applied. The open purchase still says its outcome is unknown, and that the
uses shown don't say whether it is among them.

**2. Recovery by the original transaction ID.** The open purchase, and each earlier unresolved
one, takes a transaction ID from the wallet's activity. The wallet is never asked. The server
refuses a malformed ID, verifies with the same strict resolver, and records the ID only when it
matches (it used to store a named ID before verifying it). It answers whether it matched. Tested
on the actual page after a lost reply and a reload: a malformed ID, the customer's own
registration transaction and another account's transaction each change nothing and record
nothing, then the original confirms it, with no wallet request at any point. Controller tests
cover one check at a time, and a late answer after the flow is retired (an account switch)
applying nothing. A route test covers the server's side.

**3. Copy.** Prices lead with token amounts (the header now reads "One unit: 0.05 TUSD").
Base units, bytes, the terms version and the request are in one "Exact details" disclosure. The
registration review says the deposit comes back if the record is later removed once it holds no
uses (`unregister` refunds the storage payer). The purchase review no longer promises a refund
from the contract's refusal alone. A returned payment is announced as shown by the token's own
records. The open purchase says a new one isn't offered while it might still go through, instead
of "so you can't pay twice". The stated quote basis is plain words.

**4. Placement.** "Before your first use" is a full-width section between the steps and the
workspace, holding the purchase and device panels side by side when there is room (one column
on a phone) and no card inside a card. The document draft stays editable. Once this device is
ready, it folds to "Your uses and this device" with a Show button, unless it was needed earlier
in the same view. The panels stay mounted when folded.

**Refresh review (Astra's new probe, both cases failing at first):** only the newest setup
reading applies, the quantity is never taken from a reading, a review whose reading was
superseded reads once more, and a retired flow reads nothing. Positive cases cover an edit made
during a review's read being the quantity reviewed.

**Not covered here:** device enrollment through the page was not exercised by any new test (the
pending approval for that browser action is respected). The fold once a device is ready is
therefore not covered by an automated test; it is for Astra's browser repeat. Layout at
1440/1280/390 and keyboard order were not measured in a browser here (jsdom has no layout); the
page test checks only that getting ready precedes the document in document order.

## Harness wallet history (Astra's PurchaseBrowserRepeat, test support only)

`/lose-next` rightly withholds the transaction ID from the app, so a browser reviewer had no way
to get the original ID that a customer would copy from their wallet's activity. The control
listener now has a read-only history:

- **`GET http://127.0.0.1:8815/history`** (optionally `?account=dana.near`): newest first, at most
  50 entries. Each is `{ id, signer, receiver, method, status }`, projected from the
  transactions the in-memory chain double actually recorded. Nothing is computed or added, and
  there are no arguments, keys, signatures, signed bytes, documents or results. `status` is the
  transaction's own (`success` or `failure`), as a wallet lists it, not whether a purchase was
  accepted: a returned purchase is still a successful transaction.
- **It is only on the control listener** (a separate origin), not an app route. The page's CSP
  (`connect-src 'self'`) and the no-outbound policy are unchanged, and the harness still stops
  itself at its time bound.
- **Device-key calls** (`install_key`, `revoke_key`) don't appear, because the harness applies
  them without a recorded transaction.
- **Tests** (`server/test/wallet-history.test.ts`, 2 cases) drive the library's control routes
  directly. They cover: the ID withheld by `/lose-next` listed exactly as recorded; only the five
  fields; no key or arguments; no such route on the app's site; a refused transaction listed as
  failed; the account filter; and the bound. The control routes moved into the library
  (`harnessControl`) unchanged, so the test drives the same code the script serves.
- **Not run as a listener here:** I didn't start the harness (no preview was requested). The
  script only wires `harnessControl` to port 8815, and the type check covers that.

Lookup for the recovery repeat:
1. `npm run web:build`, then `npx tsx scripts/wallet-harness.ts --minutes 10`.
2. Register, choose the uses, then `POST http://127.0.0.1:8815/lose-next` before approving the
   purchase.
3. `GET http://127.0.0.1:8815/history?account=dana.near`: the newest `ft_transfer_call` entry's
   `id` is the original transaction.
4. Paste it into "Transaction ID from your wallet's activity" and check it. A
   `sponsor_shell` entry's ID is a real, unrelated transaction to try first; it should change
   nothing.

## Astra's probes, all passing now

| Probe | Coverage |
|---|---|
| `astra-purchase-resolution-review` | 9 cases: optimistic status, failed receiver, failed resolution, a disconnected receipt, another transaction's graph, gas, top-level failure, a status of `{}` |
| `astra-purchase-recovery-review` | 4 cases: set-aside then late inclusion; no replacement; no expiry before the wallet signs; recovery after a later missing registration |
| `astra-purchase-consent-review` | 4 cases: the create answer changing recipient, deposit or customer sends nothing |
| `astra-purchase-migration-review` | 2 cases: an old unknown row recovers; an old abandoned row blocks a fresh payment |
| `astra-purchase-refresh-review` | 2 cases: a delayed setup answer can't replace a newer entitlement or an edited quantity |

## Checks

- **Contract** (WSL Ubuntu, `CARGO_TARGET_DIR=~/everstreet-target`, local tests only): 74
  passed (the fixture test now records the history case), and the wasm build exits 0. Nothing
  was deployed.
- **`npm run check`:** one run with nothing concurrent, on the final code (`30d1593`'s tree).
  Exit 0, lint (404 files) with no warnings (the comma operator Astra found in
  `purchase-flow.test.ts` is gone), and types clean. **1407 passed and 1 skipped (1408)**,
  across 155 passed and 1 skipped files. An earlier run in this step stopped at a type error in
  the new test; I fixed it, and the run above is after that. (Earlier: 1405 passed and 1 skipped
  at `fa321c0`; 1396 at `d858a3c`.)
- **`npm run web:build`:** not rerun for this step, since nothing in `web/` changed. It last
  exited 0 at `fa321c0`: main chunk 940.95 kB, CSS 73.40 kB. The direct-eval warning is from a
  dependency and isn't new.
- **Contract:** unchanged in this continuation (74 passed at `627946d`).
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

- **Astra's browser repeat** (`2026-11-04_PurchaseBrowserRepeat.md`) verified the four corrections
  at 1440/1280/390. Still open: positive recovery by the original transaction ID in an actual
  browser, using the harness history above (until now only the in-process page test showed it);
  device enrollment, first use and the fold once a device is ready. Those wait on the pending
  approval for the enrollment browser action, which isn't bypassed here.

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
