# 003wf2 Direct sale through each participant's own wallet: report for Astra's review

Claude (Opus 5.5, high), November 4 2026. Job: [003wf2](../jobs/2026-11-04_003wf2_direct-sale-wallet-journey.md).
Design: [DIRECT_SALE.md](../../design/DIRECT_SALE.md), written before the code and amended for
DirectSaleDesignReview and DirectSaleRecoveryAddendum. Stopping here for Astra's review. No later
job started. Everything below is local and synthetic: no deployment, no real wallet, no transaction,
no external provider, no spending, no push.

## Commits (local, in order)

| Commit | What |
|---|---|
| `ce3a3dd`, `1f1b701` | Astra's 003wf1 acceptance and dispatch committed after a full check; JOBS taken |
| `155b636` | Design, before any code |
| `ec1b7f8` | Contract: guarded sale methods, `get_sale_terms`, measured party quote, `direct-sale.json` fixture; design amended (review 1) |
| `604d889` | Astra's review notes; `npm test` runs protected-store as its own required phase (CheckSchedulingReview) |
| `a8c259e` | Server: durable sale actions, routes, exact receipt resolution; the sale double; journey tests |
| `deccca6` | Astra's recovery addendum |
| `4e8a938` | Recovery corrections: irreversible-only inapplicability, exact replacement, strict double envelopes, claim return path, single ask, CAS commits |
| `eb25e15` | Affirmative receipt statuses; refund children allowed |
| `caad2da`, `f3e85d8` | Actual-process tests: restart recovery, two-process admission and ask, cross-process check race |
| `aad6452` | Browser: `/sales/:business`, `SaleFlow`, browser-side re-derivation; effects/progress/account-switch fixes |
| `33e99c4` | Finite browser harness and its test |
| `dba88aa` | Repeat sales: proceeds claims bound to the sale they collect |
| `ec6c23e` | This report; JOBS review |
| `1ae7fd0` | DirectSaleBrowserReview: the terms form in the established form system; no draft shown as terms; jsdom page test |
| `4376f3f` | Astra's 23:20/23:26 findings; JOBS taken for correction 2 |
| `2eea876`, `0d32f98` | Correction 2 code and tests; Astra's 23:32 notes, this report and JOBS |
| `d5ecbc6` | Astra's 23:42/23:49 notes; JOBS taken for the configured-composition continuation |
| `ae3de0f` | Configured-composition harness, its tests and the after-close authority panel |
| `41bd228` | Configured harness: explicit budget and `/usage` counters, answered producer failures, ordered failure cleanup, cumulative scenario, budget and startup-failure tests |
| (next) | Astra's 23:54–00:07 notes; this report and JOBS |

## Verification (final tree)

- **Budget/cleanup hardening (`41bd228`)**, `npm run check` once, Nov 5 00:06:38 – 00:09:23:
  - Lint (the 2 warnings that were already there) and types clean.
  - Main suite **1468 passed, 1 skipped**; protected-store **12/12**; process phase **31/31** (the
    configured harness file now has 4 tests: the journey, the cumulative scenario, the budget
    report and the startup-failure cleanup); exit 0.
  - Nothing under `web/` changed after the 23:58 build.
  - Afterwards, no test-made harness directory or process remained. The one configured harness
    running is **Astra's 00:07 preview** (8814/8815, 20 minutes), which I didn't touch.
- **Configured-composition continuation (`ae3de0f`)**, `npm run check` once, Nov 4 23:59:54 – Nov 5
  00:02:38: lint (the 2 warnings that were already there, no errors) and types clean; main suite
  **1468 passed, 1 skipped**; protected-store **12/12**; process phase **28/28** (24 before, plus
  the configured harness process test and 3 configured page tests); exit 0. `npm run web:build`
  at about 23:58 passed.
  - **Note on Astra's live preview:** her 23:51 fixture preview (8814/8815) serves `web/dist` per
    request, so that rebuild changed its page on reload. The change is only the after-close
    sidebar, which reads fields her preview's server already returns. Nothing in her preview was
    stopped, restarted, driven or altered.
  - **No port collision:** the boot check used 18914/18915 and the tests use ephemeral ports.
- **Focused runs:**
  - Configured harness process test 1/1.
  - Configured page tests 3/3.
  - Page tests 5/5, including the new authority-panel branch test.

- **Correction 2**, `npm run check` once at 23:38–23:41: lint (2 warnings that were already
  there, no errors) and types clean; main suite **1467 passed, 1 skipped**; protected-store
  **12/12**; process phase **24/24**; exit 0. `npm run web:build` at 23:38 passed. Focused runs:
  page 4/4, controller 11/11, new server case 1/1.
- Earlier, `npm run check` at `1ae7fd0`: lint and types clean; main suite **1461 passed, 1 skipped**;
  protected-store phase **12/12**; process phase (lifecycle + sale) **24/24**; exit 0.
- `npm run web:build`: passes (main chunk ≈983 kB).
- Page test (jsdom): the actual App, router, session, SaleRoom and the real `selectorWallet`
  with the harness's injected module; the seller fills the labelled form, the review takes focus,
  one proposal is sent and shown. This is not a visual review: Astra's 1440/1280/390 pass is due.
- Rust (WSL, `CARGO_TARGET_DIR=$HOME/everstreet-target`) at `ec1b7f8`: business-v3 **85 passed**
  (79 before, 6 new); `cargo clippy --all-targets` **0 warnings**; wasm32 release build passes.
  The contract hasn't changed since. Not deployed (needs a new business account and Tony's yes).
- Harness boot check: `npx tsx scripts/sale-harness.ts --minutes 1` served `/api/env` (verified
  identity, synthetic wallet label), the control listener and the CSP'd page on loopback, then
  closed by its bound. No browser was driven.

## Requirement matrix

| Brief requirement | Done how | Evidence |
|---|---|---|
| 1 Design before code: every action → method, deposit, views, authority, states; tx vs ownership vs reconciliation; prepared vs sent vs confirmed | DIRECT_SALE.md §2, §4, §5, §5.2 | `155b636` before `ec1b7f8`; amended before the affected code twice |
| 2 Exact proposal and revision; immutable terms + hash; contract digest; buyer/seller, generation, manifest, price/asset, expiry, floor, grants | `propose_sale_guarded` / `revise_sale_guarded`; `sale-terms/1` document stored once per hash, readable only by the two parties; digest ported byte for byte | replay: 34 live-deal snapshots recompute the contract's digest; controller test recomputes it in the browser; terms hash checked in the browser |
| 2 Metering continuity; honest interruption; explicit buyer appointment | Platform metering named by default; omission stated to both; `appoint_operator_guarded` after the close | journey "terms naming no metering": next use 409 `operator_not_authorized`, appointment, next use charged |
| 2 No private documents on storefronts | Sale pages gated before any read; 404 to others | journey: stranger 404; buyer setup contains no customer account |
| 3 Wallet commerce; account must match; FT transfer-call funding; each acceptance, revision, cancel, unfund, expiry | `fund` via `ft_transfer_call` with `expected_control_seq`; account checked before AND at the send boundary | controller: wrong account and switch-after-ask send nothing; journey covers every kind |
| 3 Only matching affirmative FINAL evidence; receipt graph, returned/used amounts, exact deal/version/price | `resolveSaleTx`: exact call, transaction outcome id, distinct receipt ids, affirmative statuses; funding needs `sale_funded` + resolution using the price; claims via the returned promise | journey forged-evidence cases; claim graph: old shape, wrong pointers, pending, duplicates, refund child, empty/contradictory transfer status |
| 3 Base-unit strings, verified token metadata, no Number | BigInt throughout; NEP-148 metadata validated; display via validated decimals; raw base units in details | `toBaseUnits`/`tokenAmount`; double rejects non-canonical amounts |
| 4 On-chain review guarantees; guarded methods; party storage quote; no silent downgrade | Contract: control_seq-guarded methods, digest-checked propose/revise, payout_seq-guarded claims, guarded funding message; measured `PARTY_BASE_BYTES` = 176 | Rust w01–w04 and the fixture; older code → `contract_upgrade`, nothing falls back |
| 4 Deliberate narrower guarantees stated | `accept_sale` binds version + digest only (closing depends on the other party; stated in the review); registration has no on-chain guard (NEP-145 `registration_only`) | DIRECT_SALE.md §2, §5 table |
| 5 Durable recovery; ask recorded before the wallet; reload, account switch, lost replies, restart | One conditional ask per row (claimant `ask_id`); no resend; exact replacement only for exclusive kinds; irreversible-only `no_longer_possible`; CAS commits; terminal-only effects | journey + controller + process tests (restart recovery by the original transaction; two-process admission and ask; cross-process check race, both orders) |
| 5 Unknown stays unknown; abandoned-unsent vs uncertain-sent | `set_aside` only for never-asked rows; asked rows stay checkable | journey; controller reload recovery |
| 6 Claims and close through existing authority code | Confirmed proposal/revision → `V3Intents.record`; closing acceptance → `V3Intents.reconcile`; no ownership SQL | journey: ownership row with `v3_intent_id`; failed read then retry applies once |
| 6 Pending, failed, restored, paid; closed sale shown while proceeds pending | Claims resolve paid/restored/pending; collection step bound to the sale it collects; buyer isn't shown the seller's collection | journey and controller (repeat-sale counterexample) |
| 7 One synthetic state model; actual encoded calls; anchored to contract tests; no fixture toggles; refuse unexpected calls; no real fetch | `SaleChain` + `FixtureChain` share ledger, transaction log and treasury buckets; strict envelope validation | 49-step replay byte for byte; customer settlements move `available` past the floor; 15 malformed envelopes change nothing |
| 8 Finite normal-composition browser harness, seller and buyer, labelled wallet actions, lost replies, reload, stale review | **Implemented, browser review pending.** `scripts/sale-harness-configured.ts` (`scripts/lib/configuredSaleHarness.ts`): the normal entry (`entryChild.ts` → `serve.ts runServer` → `composeApplication`, `configured` mode) in its own child, with the configured adapters and background maintenance, serving its own `web_dist`. Only RPC and model HTTP are injected (labelled, answered over IPC from one synthetic state). The older `scripts/sale-harness.ts` stays as the fixture-app variant (`createApp` with injected fixtures) and is **not** composition evidence. | process test `sale-configured-harness` (page/env/inventory provenance, seller+buyer close, lost funding recovered by original ID, customer use under the buyer, clean stop); page test `saleRoomConfigured` (actual SaleRoom against the child: summary, Not now/focus, History recovery across reload, close and sidebar); CLI boot check. **No actual browser yet**: Astra's 1440/1280/390 pass on this variant is due. |
| Customer continuity across the close | Same entitlement before/after; next use served under the buyer's grants | journey: entitlement equal, use charged after close |

## Astra's findings during the job, and their resolution

All were reproduced or accepted as valid and fixed with tests: review 1 (no fresh ask; one
customer+sale state; post-close roles; claimant registration); addendum (accept/register
reversible; envelope validation incl. the negative-amount probe; claim return path; single ask;
check CAS); follow-ups (refund children; empty transfer status; terminal-only effects with retry;
current-deal progress; buyer not shown the seller's collection; account switch at the send
boundary; repeat-sale proceeds); browser review (terms form layout in the established form
system; no empty terms described as a draft's consequences). The check scheduling correction is
in `npm test`. The form fix still needs Astra's visual recheck after a rebuild (`npm run
web:build`, then restart the harness).

## Browser correction 2 (DirectSaleBrowserReview 23:20 / 23:26 / 23:32)

Fixes for each finding from Astra's actual-browser pass (her preview wasn't stopped, restarted,
driven or altered; only `web/dist` was rebuilt at 23:38 so a reload picks it up):

- **Not now keeps the terms and the focus.** The draft (buyer, price, days, floor, metering,
  exclusions, note) lives in the `SaleFlow` controller per kind (`propose`, `revise`) and only for
  this business and account. It survives Not now, a stale review (`review_changed`: "Your terms
  are kept") and any other refused create. Only a confirmed proposal or revision clears its own
  draft. Every review records the control it came from (`data-focus`); Not now, a refused review
  and a refused create return focus there. No wallet call, no stored row.
- **A readable review summary** sits before the wallet button: deal and version, buyer, price
  (token and base units), amount, "Offer open until" in local time with its zone **and** the exact
  UTC instant, "Available balance kept (floor)", the operators named (or the no-metering warning),
  the operator appointed, and the attached NEAR with its basis. For funding and acceptance the
  live deal's terms fill fields the call itself doesn't carry. The server's proposal effect now
  states the UTC expiry instead of "the time shown". That change reaches the browser only on a
  new server, not in Astra's running preview.
- **Read-only original-ID recovery in History.** Each row whose request "Can no longer take
  effect" shows its message, a labelled "Its transaction ID from your wallet's activity" field,
  "Check with this ID" and "Check again". It sends nothing: the existing check route resolves that
  one transaction by the exact-request rules, and a wrong or malformed ID changes nothing. Such a
  row is not open, so the next action (for example "Accept version 1" or "Apply the close here")
  stays available. These controls use routes the running preview already has.
- **Late follow-up reports the authoritative stored result.** After any attempt,
  `SaleActions.effects` re-reads the stored effects. If a terminal answer is stored (this
  attempt's, an earlier one's or a concurrent one's), that answer is returned with
  `finished: true`. Otherwise the attempt's own retryable answer is returned with `finished: false`.
  In the browser, a stored terminal answer that isn't "applied" (conflict, ended, superseded) is
  reported as final, without "check again". Only an unfinished one offers "Apply the close here".
- **Six-step layout:** 3 × 2 at desktop and tablet widths, a single row of six only from 1600 px,
  stacked on phones. No 5 + 1 split, and text isn't shrunk.

New coverage:

- **Page (jsdom, actual App/SaleRoom/SaleFlow/selectorWallet with the harness module):**
  - The summary shows its zone and UTC, the floor and the operators, and comes before the wallet
    button.
  - Not now keeps buyer, price and exclusions, and focus returns to the review button. A changed
    review shows the new price. Nothing is sent.
  - **Lost funding answer:** the History row has the recovery field and "Accept version 1" stays
    available. The registration transaction's ID gets "isn't this request", and a malformed ID is
    refused. After a remount (reload) the row is still there. The original `ft_transfer_call` ID
    confirms it, and the form goes away. The wallet's send count doesn't change.
  - **Lost closing acceptance:** "Apply the close here" applies it first. Then the original
    `accept_sale` ID confirms the request and reports the stored "already applied", not "isn't
    finished". Nothing is sent.
- **Controller:**
  - The draft survives Not now and a refused stale create, and focus returns to its origin.
  - A confirmed revision clears only its own draft.
  - `noticeFor` gives different notices for unfinished, final-but-not-applied and applied results.
- **Server:** while one reconciliation read is outstanding, another check applies the close. When
  the slow read then fails, its answer is the stored applied result with `finished: true`, not
  "unavailable".

Not done in this pass (Astra 23:32, sequenced after her History test):

- **The configured-composition variant of the browser harness** (`composeApplication`/`serve.ts`
  with the configured adapters, disposable persisted state, explicit disabled worker, bounded
  cleanup). Brief item 8 stays **partly** met until it exists; see the matrix.
- **The untracked `docs/astra/claude-2026-11-04-003wf2-browser-corrections.stderr.txt`** (empty)
  isn't staged. Excluding it locally through `.git/info/exclude` needed a permission that wasn't
  granted, so it remains untracked.

The dba88aa repeat-sale payout correction: Astra's 23:30 targeted run passed 25/25, which she
records as confirming it narrowly. **The job is not accepted.**

## Configured-composition harness (brief item 8; DirectSaleBrowserReview 23:32 / 23:49)

**Composition provenance.**

```
scripts/sale-harness-configured.ts (this process: front site, control, synthetic RPC/model/wallet)
  └─ fork: node --import tsx --max-old-space-size=384 server/test/entryChild.ts <config.json>
       └─ server/src/serve.ts runServer → server/src/compose.ts composeApplication
            (validated `configured` config file; listens on an ephemeral loopback port)
```

- **The child** is the same normal entry boundary the accepted 003wf1 lifecycle tests use
  (`entryChild.ts`). Its two network transports forward over IPC and are labelled in the
  capability inventory as `synthetic RPC (lifecycle test)` and `synthetic model HTTP (lifecycle
  test)`. It runs the composition's own code: verified NEP-413 sign-in (account keys read over the
  RPC), v3 observation and reconciliation, the sale routes and `SaleActions`, the customer reads,
  the real customer writer (it signs `open_hold`/`settle_hold`/`release_hold_for` and they are
  verified and applied by `SyntheticRpc`), `AnthropicRuntime` over the model seam, protected
  storage, background maintenance (its lease, bounded passes every 15 s), admission/drain/fence
  stop, and its own static web serving (`web_dist`).
- **Additions to the entry child for this job:**
  - An optional `ENTRY_WALLET_HARNESS_LABEL` environment variable. It is passed as
    `composeApplication`'s existing `walletHarness` dependency, so `/api/env` names the synthetic
    module. The tests never set it.
  - A stop on IPC `disconnect`, so a child never outlives its parent.
- **The front site** (`--port`, default 8814) forwards every request to the child unchanged,
  except for three things:
  - It adds only the label and wallet-module `<script>` tags and the harness CSP to the
    composition's own HTML.
  - It serves the wallet module's same-origin `/__harness/*` calls: the account, NEP-413
    `signMessage` with each fictional account's ephemeral key, and one-action transactions to the
    fictional business and token only. These are applied to the shared synthetic state by its
    encoded rules.
  - It has no control routes. Those live on `--port + 1`.
- **One state.** `bootstrap` (lifecycleWorld) builds the contract-anchored `FixtureChain`, with
  `attachSale` providing its `SaleChain` half. `SyntheticRpc` answers the child from that state,
  and the wallet's transactions land in it.
- **Not the fixture app.** `scripts/sale-harness.ts` (saleWorld → `createApp` with injected
  fixtures) is unchanged. It is still useful for quick page review but is **not** configured
  composition evidence.

**Bootstrap prerequisites** (before the child starts, in a fresh `mkdtemp` directory):

- **Files:** the SQLite database, the protected-store root with an ephemeral random key, an AI
  config whose key variable holds a fictional value, the metering operator's (`meter.testnet`)
  ephemeral key file, and the config file.
- **People and records:**
  - Ava (`ava-founder.near`), founder and owner.
  - A release evaluated on the real runtime over the synthetic model.
  - Cara's (`cara.near`) offer with 100 prepaid uses and a device key **already installed by the
    fixture**. No enrollment or revocation happens here; the pending customer browser gate is
    untouched.
  - The sale double attached with Ava as owner and `meter.testnet` appointed.
  - Noah (`noah-buyer.near`) linked to his account, holding 1000 fictional TUSD.
  - The business named Ledgerline Invoice Reader.
- **Child environment:** only `PATH`/`SystemRoot`/`TEMP`/`TMP`/`HOME`/`USERPROFILE`, the
  fictional key variable and the label. Nothing else from the parent's environment is passed.

**Bounds and cleanup.**

- **Child:** one child with a V8 heap limit (384 MB in the CLI, 256 MB in tests). Startup waits at
  most 30 s for "listening on".
- **Time bound:** `--minutes` 1–120 (default 30), or Ctrl+C.
- **Stop:** close both listeners, then IPC `shutdown` to the child (admission ends, it drains,
  fences and closes, then exits 0). The child is force-killed only if it hasn't exited after
  15 s. The temporary directory is then removed. A failed start kills the child and removes the
  directory.
- **Worker:** the isolated worker engine stays off (inventory "Isolated logic checks:
  unavailable") and no worker host is started.

**Evidence (keyless, finite, no browser driven by Claude).**

- **`server/test/sale-configured-harness.test.ts`** (process phase; ephemeral ports), all through
  the site with a cookie jar, as a browser would:
  - **Provenance:**
    - The composition's own HTML with only the module scripts added, and the harness CSP.
    - `/api/env` shows `Configured (testnet)`, verified identity, and the wallet available and
      named as synthetic.
    - Inventory: `mode: configured`, maintenance on, checks unavailable, synthetic labels.
    - No control route exists on the site.
  - **Seller:** signs in through the module's `signMessage` and proposes (`recorded` effect).
  - **Buyer:** registers, then funds with a lost answer. The request becomes
    `no_longer_possible`; a wrong ID is `matched: false`; the original `ft_transfer_call` ID
    confirms it, and nothing is resent. The buyer then accepts.
  - **Close:** the seller closes. Reconciliation is `applied`, `finished: true`; the contract
    owner is Noah at generation 2; local roles follow; the 250 TUSD proceeds are owed.
  - **Cara:** her use is reserved by the real writer (`open_hold` over the RPC) and fulfilled.
  - **Stop:** the child exits 0 without a forced kill, the directory is gone, and both listeners
    refuse.
  - A finding while writing it: a seller request sent while the one synthetic wallet was still on
    the buyer's account stayed `unknown`. It was not wrongly confirmed, because another signer's
    transaction never resolves it. The test now switches the wallet's account per person, as a
    person would.
- **`web/test/saleRoomConfigured.test.tsx`** (process phase): the **actual** App, SaleRoom,
  SaleFlow and `selectorWallet` with the harness module, against the child (jsdom; the page's
  same-origin requests go to the site listener):
  - **Seller:** the review summary shows the expiry in local time and UTC and
    `meter.testnet (metering)`. Not now keeps the buyer and returns focus to the review button,
    with nothing sent. The proposal then goes through the wallet.
  - **Buyer:** registers; a lost funding answer gives the History recovery form, with "Accept
    version 1" still available. A wrong ID is refused. After a remount (reload), the original ID
    confirms the request and nothing is resent. The buyer then accepts.
  - **Seller:** closes. The sidebar shows "Authority after deal 1 closed", the closed terms, and
    the current owner and operators, and no pre-proposal guidance.
- **CLI boot check** (`--minutes 1 --port 18914`, bounded, at 23:58):
  - Page 200 with the harness CSP.
  - `/api/env`: configured and verified, the wallet available, harness "Synthetic review wallet".
  - The control's inventory: records, sign-in, protection, model, v3, customer reads, writer,
    maintenance and customer authorization are on, with their labels; checks and legacy payments
    are unavailable.
  - It stopped by its bound at 23:59:46 ("application child exit 0; temporary directory
    removed"). The site and child ports then refused, and no `everstreet-sale-configured-*`
    directory remained.

**After-close authority panel (23:42).** The sidebar now follows the current reading:

- **No deal:** the pre-proposal text, unchanged.
- **Live deal:** "Authority the buyer receives", unchanged. A live deal after an earlier close is
  this case; the earlier close is never treated as the current one.
- **Newest deal closed:** "Authority after deal N closed", with the closed terms (seller sold to
  buyer, generation after) **apart from** "Now, at block H": the current owner and generation, the
  current operators (only the current generation's), and the metering pause stated as current
  fact when the platform operator isn't appointed.
- **Newest deal cancelled, expired or aborted:** "Authority now" says no authority changed with
  it, then the current authority.

Covered by a branch test (`saleRoom.test.tsx`: none, live, closed, no operator, cancelled, and a
later live deal after a close) and the configured page test.

**Budget, counters and failure cleanup (Astra 00:01 / 00:03).**

- **Explicit finite budget per session:**
  - The harness answers at most 25 000 RPC requests.
  - The customer chain double's own ceiling is set to 4 000 (the fixture default is 400).
  - The sale double keeps its 2 000.
- **`GET /usage`** (control only, non-secret): RPC requests by method, total, transport
  failures, model calls, wallet transactions, chain and sale double calls, the budget, and
  `exhausted` (the first limit reached and when).
- **Failures are answered:**
  - A producer failure, for example a ceiling, is answered to the child as a failed read (HTTP
    500 or 503 with a reason), never left hanging. Before this fix such a failure was swallowed
    and the child's request waited.
  - A reached budget is reported. It is never turned into a success.
- **Cumulative regression** (process test):
  - The sequence: lost proposal, a wrong ID, five reload-equivalent reads, recovery by the
    original ID; registration; lost funding with the registration's ID as the wrong one, reads,
    recovery; acceptance; lost close, apply first, then the original ID ("already",
    `finished: true`); reads; seller registration; restored payout, then paid; reads.
  - Usage: **623** RPC requests (558 view calls, 52 block reads, 11 transaction lookups, 2 key
    reads), 14 customer-chain calls and 6 sale-double calls. Nothing exhausted, 0 transport
    failures.
  - For comparison, the fixture variant reads through `FixtureReader`, whose ceiling is 300
    reads. A comparable browser session passes that ceiling, which is consistent with the "NEAR
    could not be read" Astra saw at the seller's registration. This is not proven from her
    preview's counters. The fixture's bounds are unchanged; use the configured variant for the
    remaining matrix.
- **Budget test:** with a 40-request budget, the sale page stops answering 200, and `/usage`
  names "harness RPC budget reached (40 requests)".
- **Failure cleanup:**
  - A failed start, at any point, closes any listener already bound, ends the child and **waits
    up to 10 s for its exit** before removing the directory, so SQLite files are closed first on
    Windows.
  - The error carries the directory, the child's pid and whether the directory was removed.
  - Only a 16 KB diagnostic tail of the child's output is kept.
  - Test: a start that fails after the child and both listeners are up leaves no child process
    (the pid is gone), no listener on either port, and no directory.

**Limitations of this variant.**

- **Chain clock:** the composition's clock is this computer's. `/advance` moves only the
  synthetic contract's clock, so expiry is decided by the contract reading, not the server.
- **RPC outage:** `/rpc/down` fails every RPC answer (reads, lookups, sign-in key reads, writer
  sends), because the composition has one RPC endpoint. The fixture variant's narrower
  "observations down" doesn't exist here.
- **Single wallet:** the synthetic wallet holds one account at a time (switch with
  `/account/<id>`, then sign out and in).
- **Settlement timing:** customer settlements are left to background maintenance (bounded 15 s
  passes) or the use's own reconcile route.
- **Labels:** the inventory says "lifecycle test" because it is the same entry child and
  transport labels.
- **Scope:** this closes the harness provenance gap only. The parent 003wf matrix stays open (see
  below).

## Limitations and open gates (none hidden)

- **Synthetic only.** The double models gas as unchecked numbers, no NEAR (yoctoNEAR) balances or
  refunds, no monthly books, and lands each transaction at once. It is anchored by the contract's
  fixture, not a contract run; near-sandbox integration tests weren't added (installing tools is
  out of scope).
- **The deployed v3 accounts lack the new methods.** Any wallet sale needs the new code on a new
  business account (deployment needs Tony's yes). Until then the product shows `contract_upgrade`.
- **Gas values** (50/30/100/60 Tgas) are reviewed and unchecked here; not measured on chain.
- **Registration and acceptance** can't be replaced while unknown; a never-sent one is recovered
  by its own transaction, or (acceptance) once the deal moves on. A registration made elsewhere
  doesn't resolve an open registration request.
- **Concurrent startup:** two processes composing at the same instant fail with
  `database is locked` in `composeApplication` (startup migrations). The process tests start the
  second once the first listens. Outside this job; it needs its own bounded lifecycle follow-up.
- **Browser review:** Astra's actual-browser passes so far ran on the fixture variant (proposal,
  buyer acceptance, close, 3 × 2 steps, the review summary). On the configured variant, nothing
  has been reviewed in a browser yet: History recovery, focus, 1440/1280/390, keyboard, zoom,
  reduced motion, payout restored/paid, buyer operation and customer continuity. No browser was
  driven by Claude.
- **Customer browser gates** for enrollment/revocation stay pending as before; untouched.
- **Parent 003wf** stays open: Gated close (closer/drain/continuity), owner plan/operator setup,
  unresolved-writer recovery, the complete 100/20/80/79 journey, broader concurrency, the
  prepared-only external rehearsal. All six milestones and 003x/005e/006b/006c stay open.

## Finite browser instructions (for Astra)

### A. Configured composition (brief item 8): the fresh case for the remaining matrix

```
npm run web:build
npx tsx scripts/sale-harness-configured.ts --minutes 30
```

- **Addresses:** site `http://127.0.0.1:8814/`, controls `http://127.0.0.1:8815/`. The
  composition's own child runs on a printed ephemeral loopback port and is reached through the
  site.
- **Start and stop:** startup takes a few seconds (bootstrap, then the child). It stops by
  itself, or on Ctrl+C, and removes its temporary directory. `GET /` on the controls shows the
  composition, the capability inventory, the contract and the treasury.
- **Accounts:** `ava-founder.near` (seller), `noah-buyer.near` (buyer), `cara.near` (customer).
- **Switching people:** `POST /account/<id>`, then sign out and in.

1. **Seller: draft, review and focus.**
   - Sign in. The wallet starts as Ava. Open the printed sale page.
   - Prepare terms for `noah-buyer.near`: 250 TUSD, floor 0.1, metering on, and an exclusion.
   - Review. The summary should show the expiry in local time with its zone and UTC, the floor,
     and `meter.testnet (metering)`.
   - Press Not now: the values stay and focus returns to "Review the exact request". Change the
     price and review again. Then ask the wallet.
2. **Buyer: lost funding and History recovery.**
   - Switch to Noah and register.
   - `POST /lose-next`, then fund. History shows "Can no longer take effect" with the field;
     "Accept version 1" stays available.
   - From `GET /history?account=noah-buyer.near`, enter the `storage_deposit` ID (wrong: "isn't
     this request"), reload, then enter the `ft_transfer_call` ID. It should confirm, and nothing
     should be sent.
   - Accept.
3. **Floor and customer.** `POST /customer-use` as needed for the 0.1 floor (a use is reserved by
   the real writer; background maintenance settles it within about 15 s). Reload the seller's
   page to see `available`.
4. **Seller: close and aftermath.**
   - Switch to Ava and accept to close. Check the apply result, the former-seller role and "Your
     handovers".
   - The sidebar should show "Authority after deal 1 closed" with the closed terms, apart from
     "Now, at block …" (owner `noah-buyer.near`, generation 2, `meter.testnet`). It should not
     show "No sale is proposed".
   - Proceeds are owed, not paid. Register to collect. `POST /fail-next-payout`, then collect
     ("restored"), then collect again ("paid").
5. **Buyer operation and customer continuity.** Switch to Noah: his sale page and the business
   desk as the new owner. `POST /customer-use` again: Cara's use is served under the buyer's
   grants.
6. **Other recovery.**
   - `POST /cancel-next`: the wallet is closed.
   - `POST /delay-next/5000`: a late answer.
   - Switch accounts mid-flow: nothing is sent; then resume.
   - `POST /older-contract`: the refusal.
   - `POST /rpc/down`, then an action, then `/rpc/up` and check again (this fails the whole
     RPC, not only observations).
   - Review a revision, then act as the other person before confirming: stale review.
7. **Visual and access.** Breakpoints 1440/1280/390, the 3 × 2 steps, keyboard order and focus,
   zoom, reduced motion, error and empty states.

Customer enrollment and revocation aren't part of this harness (Cara's key is a bootstrap
prerequisite); their pending browser permission is untouched.

### B. Fixture-app variant (quick page review only; not configured-composition evidence)

```
npm run web:build
npx tsx scripts/sale-harness.ts --minutes 30
```

Site `http://127.0.0.1:8814/`, controls `http://127.0.0.1:8815/` (loopback only; stops by itself).
Run only one of A or B at a time: they share the ports.

1. **Seller.** Sign in (the synthetic wallet starts as `founder.near`). Open the printed sale page
   (also via Sale and handover → "Sell directly through your wallet"). Prepare terms for
   `buyer.near` (try 250 TUSD, 7 days, floor 0.1, metering on; then repeat with metering off to see
   the interruption wording). Review the exact request, then ask the wallet.
2. **Buyer.** Sign out; `POST /account/buyer.near`; sign in. From Your handovers → Open the sale:
   register with the token, fund escrow, accept. Watch the floor message: `POST /customer-use`
   (twice for a 0.1 TUSD floor) raises the available balance.
3. **Close.** Back to the seller (`POST /account/founder.near`, sign in): accept and close. The
   page shows the close, the apply result, the former seller's proceeds as owed, then register and
   collect (`POST /fail-next-payout` first to see "restored", then collect again for "paid").
4. **Recovery cases.** `POST /lose-next` before an action: the request stays unknown; copy its ID
   from `GET /history?account=<id>` into "Transaction ID from your wallet's activity" (an open
   request), or, for a request listed in History as "Can no longer take effect", into that row's
   "Its transaction ID from your wallet's activity" → "Check with this ID" (read-only). `POST
   /cancel-next`: wallet closed. Reload during any step. Switch the wallet's account mid-flow
   (`POST /account/...`) to see nothing sent and the resume action. `POST /older-contract` for the
   refusal. `POST /observations/down`, close a sale, then `/observations/up` and check again.
5. **Stale review.** Review a revision as the seller, then fund or accept as the buyer in another
   browser before confirming: the seller is told to review again (or the contract refuses it).
6. Breakpoints 1440/1280/390, keyboard order and focus (review panel takes focus), zoom,
   reduced motion, error and empty states.

## NEAR skill references used

Pinned cache `EverstreetNearSkills-cb32b6af` (21 files, SHA-256 verified against its manifest):
read near-smart-contracts SKILL.md with security-storage-checks, xcc-promise-chaining,
testing-integration-tests, state-collections and structure-near-bindgen; near-api-js SKILL.md with
api_patterns, tokens_guide and contracts; near-contract-audit SKILL.md with all three severity
references. Applied: measured storage with explicit flush (the repo's existing `ensure_party`
already flushes, as the audit's low-severity note requires), `#[private]` callback unchanged,
state updated before the payout promise (unchanged), U128/U64 strings at JSON boundaries,
one-yocto on sensitive calls, NEP-145 `registration_only` for registration, FINAL receipt
handling. Versions match the repo (near-sdk =5.29.1, near-api-js 7.3.1, Wallet Selector 10.1.4).
Not applied: scaffolding, installs, sandbox, deployment, chain signatures, yield/resume,
meta-transactions, upgrade/migration (the contract is born locked).
