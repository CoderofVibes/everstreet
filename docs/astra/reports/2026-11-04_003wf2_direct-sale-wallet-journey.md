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

## Verification (final tree, before this report)

- `npm run check` at `dba88aa`: lint and types clean; main suite **1460 passed, 1 skipped**;
  protected-store phase **12/12**; process phase (lifecycle + sale) **24/24**; exit 0.
- `npm run web:build`: passes (main chunk 983.24 kB).
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
| 8 Finite normal-composition browser harness, seller and buyer, labelled wallet actions, lost replies, reload, stale review | `scripts/sale-harness.ts` + controls | harness test (both parties close through real controllers; lost answer recovered from wallet history); boot check |
| Customer continuity across the close | Same entitlement before/after; next use served under the buyer's grants | journey: entitlement equal, use charged after close |

## Astra's findings during the job, and their resolution

All were reproduced or accepted as valid and fixed with tests: review 1 (no fresh ask; one
customer+sale state; post-close roles; claimant registration); addendum (accept/register
reversible; envelope validation incl. the negative-amount probe; claim return path; single ask;
check CAS); follow-ups (refund children; empty transfer status; terminal-only effects with retry;
current-deal progress; buyer not shown the seller's collection; account switch at the send
boundary; repeat-sale proceeds). The check scheduling correction is in `npm test`.

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
- **No browser review yet:** the harness is ready; Astra's 1440/1280/390, keyboard/focus, zoom
  and reduced-motion inspection is still to come. No browser was driven by Claude.
- **Customer browser gates** for enrollment/revocation stay pending as before; untouched.
- **Parent 003wf** stays open: Gated close (closer/drain/continuity), owner plan/operator setup,
  unresolved-writer recovery, the complete 100/20/80/79 journey, broader concurrency, the
  prepared-only external rehearsal. All six milestones and 003x/005e/006b/006c stay open.

## Finite browser instructions (for Astra)

```
npm run web:build
npx tsx scripts/sale-harness.ts --minutes 30
```

Site `http://127.0.0.1:8814/`, controls `http://127.0.0.1:8815/` (loopback only; stops by itself).

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
   from `GET /history?account=<id>` into "Transaction ID from your wallet's activity". `POST
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
