# 003wea Wallet browser and review corrections: report

Job: `docs/astra/jobs/2026-11-04_003wea_wallet-browser-and-review-corrections.md`.

**Status: in review.** The harness is ready for Astra's actual UI pass. 003we stays partial: the
fresh-customer purchase is the next child (003web, queued), and 003wf is queued after all 003we
children.

## Commits

| Commit | What it holds |
|---|---|
| `871f82c` | Astra's WalletSignInReview, DeviceKeyReview, ConfiguredJourneyPlanning, the 003wea and 003wf briefs, INDEX and JOBS, and the four probes. Committed after `npm run check` passed (1316 passed and 1 skipped) |
| `b7605da` | JOBS: 003wea taken |
| `96620c1` | The corrections and their regressions |
| Final docs commit | Design §9.11, the 003we report's correction, JOBS, and Astra's later paths (see the end) |

## 1. The harness's customer page (Astra's actual browser failure)

**Reproduced first:**
- The page's own code (`customerHttp.offer` over `fetch`, routed to the harness site) got
  **"No such product offer"**, because the harness never published its business.
- The full page path failed with it.

**Fixed:**
- The harness publishes the fictional business, as the customer preview does. The public route's
  rule is unchanged.

**The clock:**
- The harness's chain double and server now follow this computer's clock, forward only, synced on
  every API call and transaction.
- **Mutant:** with the sync removed but publishing kept, the browser's own envelope check fails
  with **"The time to authorize this request has passed."** So both fixes are needed.

**Evidence: `wallet-harness-browser.test.ts`.** The page's code, start to finish:
- public offer;
- `api` sign-in through `SignInController`;
- `DeviceKeys` with the real `readKeys` over fake-indexeddb;
- `CustomerWorkspace` with the default (browser) clock: prepare, then `check ok`, then device
  signature, then authorize, ending **reserved** with one `open_hold`.

Not composeApplication, and not live NEAR.

**Controls (on `:8815`):**
- `cancel-next`, `lose-next` and `account/<id>` (as before);
- **`delay-next/<ms>`**, new: 0–30000, applied once to the next wallet answer, with out-of-range
  values refused (tested).

**Bounded smoke at `96620c1`:**
- Ports 8814/8815 were free first.
- The public offer answered (Ledgerline, active) and the page carried the CSP
  `connect-src 'self'`.
- `delay-next/40000` was refused and `500` accepted.
- It stopped itself at the 1-minute bound, and both ports were free afterwards.

No browser was started by me.

## 2. Exact revocation consent

**Source-confirmed (Astra) and fixed.** Revocation used to be sent straight from its button.
- **`prepareRevoke`** gives:
  - the exact `revoke_key` request;
  - whether the key is this device's;
  - the acting account;
  - the observed key (public key and epoch).

  Nothing is sent.
- **The panel's review** shows all of it in readable terms: account, contract, what it does, plan,
  slot, deposit, gas, and the raw call under "The exact request". It explains: *new requests and
  the current serving window stop now; uses already signed can still settle until their
  deadline.* The explicit action is "Ask my wallet to revoke exactly this".
- **Astra's revoke probe** (a replacement key under an old review) failed first, then passed.
  `revoke` now sends only if the call **and** the observed key, epoch, registration and account
  are unchanged; otherwise the new key is shown, unsent.
- **My regression** does the same over the real route and the contract-produced entitlement:
  nothing is sent until re-reviewed, then exactly one request.
- **Limit (in §9.11):** `revoke_key` is slot-based. This is a client comparison, not an atomic
  on-chain guarantee. A guarded contract method is a recorded follow-up.
- **The 003we report's requirement 5 is corrected:** at `7f6fc0b` the two-step review applied
  only to enrollment.

## 3. SessionProvider orderings

**Reproduced first.** SessionProvider's logic was extracted unchanged into `SessionModel`, which
the provider now runs. Against it, with deterministic deferred answers:
- **an old `/me` after sign-out** restored the ended identity;
- **a delayed logout answer** cleared a newer sign-in;
- **an older refresh** switched back after a newer sign-in;
- **a pending sign-in prompt** was never settled by sign-out (it timed out);
- **sign-out** cleared only after its answer.

**Fixed:**
- an identity generation, bumped by every change of who is acting, fences each refresh answer, and
  so does the latest-refresh order;
- sign-out clears at once and settles the prompt;
- a failed sign-out call refreshes from the server;
- a replaced prompt is settled with null.

**Astra's session-model probe** (an old dialog completion after a logout or a newer account)
failed until `settle` answered `stale` for an overtaken refresh. It passes now.

**One regression of my own, caught and fixed:** three web suites that server-render the provider
(`booksRefresh`, `operatingWorkspace`, `publicPage`) needed `useSyncExternalStore`'s server
snapshot.

**Unchanged:** private pages still remount per person, and the server cancellation and
cookie/attempt tests are untouched.

## 4. Panel lifetime

**`deviceView`** owns one controller and one store connection per offer view.
- Dispose retires the controller, closes a connection whose open resolves only later, and refuses
  later opens. This is tested with a held open.
- An offer, account or unmount change clears the review, busy, note and error state, and
  withdraws the authorizer.

**Evidence status:** this is a source-identified risk with a new owned-lifetime helper and its
regression. It is not a browser reproduction: there is no DOM here.

**Unchanged:** the real store's two-handle claim, update and delete, with no weak fallback
(Astra's storage probes still pass).

## Checks

- **`npm run check`:** exit 0. Lint (389 files) is clean, with no warnings: the BigInt min carries
  a `biome-ignore`, not the invalid `Math.min` autofix. Types pass. 1332 passed and 1 skipped
  (1333), across 143 passed and 1 skipped files.
- **Later full runs (docs-only changes since, with 25 node processes on the machine)** failed
  only on 5-second timeouts:
  - once, the two harness-flow tests (10–12 s). Run alone, 6/6 pass in 1.77 s;
  - twice, `protected-store` "concurrent and repeated writes" (5.08 and 5.25 s), a 003v test
    this job doesn't touch. Run alone, 12/12 pass in 4.29 s.

  No timeout was raised. A clean full repeat on a quiet machine is part of the review.
- **`npm run web:build`:** exit 0. The main chunk is 916.97 kB (it was 911.63 kB), with the wallet
  chunks lazy as before.

**Nothing live:** no wallet, real transaction, provider, host, credential, legacy main, Day One,
research, deployment, spending or push. The worker stays disabled.

## Remaining browser gates (Astra's actual UI pass)

- Run `npm run web:build`, then `npx tsx scripts/wallet-harness.ts [--minutes N]`. Check that
  ports 8814/8815 are free first.
- **Real `setupWalletSelector`** with the injected module, then sign-in.
- **On the product page:**
  - make the key, review, enroll;
  - prepare, authorize, use;
  - review and revoke (this device's, and a lost slot);
  - then late, lost and cancelled answers through the controls;
  - then an account switch and sign-out during an action.
- **Phone width, keyboard and focus** on the two review blocks.
- **Unverified here:** the React effects of the panel in a browser (no DOM tests).

## Still required (unchanged)

- **003web**, the fresh-customer purchase:
  - a quoted storage deposit;
  - token balance and registration;
  - the purchase sequence;
  - the purchase UI;
  - recovery from an uncertain purchase.
- **003wf**, queued after all 003we children.
- **A guarded revoke contract method** (an assessment, a follow-up).
- **The real wallet and testnet rehearsal** (§9.10, prepared, not run).
- **Also retained:** 002f1, 004b, 005c, 005d, 006a and all of M6. All six milestones are open.

## Follow-up: Astra's WalletBrowserRepeat at `96620c1` (commit `16ec3d4`)

**Astra's paths committed:**
- `1ceaf97`: WalletBrowserRepeat and INDEX, after the check. That run had 1331 passed and
  1 skipped, plus the known disk-bound protected-store timeout (5129 ms; 200 concurrent durable
  writes; not weakened).
- The final docs commit: Astra's later review updates, ACCEPTANCE, the updated revoke probe and the
  003wec brief.

### 1. The first sign-in stalled on "Loading…"

**Reproduced through React's actual effect lifecycle.** `jsdom` 30.1.3 was added as a dev
dependency for this test only. `web/test/customerProductLifecycle.test.tsx` renders the actual
`Router`, `SessionProvider` and `App`, against the harness's real routes, with fake-indexeddb.
- The sequence: signed out on the printed product, sign in over the routes, then the same-account
  refreshes a sign-in triggers (each hands over a new person object).
- **Before the fix:**
  - with StrictMode (as `main.tsx` renders), the page stayed on **"Loading…"**, Astra's symptom;
  - without StrictMode, the page loaded, but typing was dead (the draft read back empty).

**Cause: Astra's hypothesis, proved.**
- CustomerProduct kept one workspace in `useState`, but its start/retire effect depended on the
  `person` **object**.
- An equivalent refresh retired that workspace permanently (`alive = false`), then called
  `start()` on it, which a retired workspace ignores.
- Whether that showed as Loading or as dead input depended on whether the first load had finished.

**Fixed:**
- Each effect run owns its own workspace, keyed by strings: the person's id, the offer or use, and
  the identity mode. StrictMode's development re-run is therefore safe too.
- A same-person refresh changes nothing: the typed draft and the device panel stay (tested).
- A real identity change, such as sign-out, retires the workspace and withdraws the page (tested).
- The page stays keyed by person, as before.

### 2. Phone clipping at 390px

**The measurements (Astra's):** document client 375, scroll 447, cards 431 wide.

**Cause:**
- The `use-grid` tracks were `1fr`, which is `minmax(auto, 1fr)`, and the term lists' columns did
  the same.
- So they grew to the widest unbreakable content: `nowrap` buttons with long labels, 64-hex keys,
  and the raw request JSON.

**Fixed:**
- The tracks may shrink (`minmax(0, 1fr)`, `min-width: 0`).
- Buttons, mono values, paragraphs, list items and summaries on the customer page wrap, with
  `overflow-wrap: anywhere`.
- Result tables lay out fixed.
- Phone buttons are full width.
- Nothing is hidden or truncated.

**Evidence:**
- `web/test/usePhoneLayout.test.ts` is a static stylesheet check: shrinkable tracks, wrapping, and
  no `use-` rule with `overflow: hidden` or an ellipsis.
- It is **not** a rendered measurement, since jsdom does no layout. The 390px repeat
  (scrollWidth equal to clientWidth, cards within the viewport, review fully readable) is Astra's
  browser gate.

### 3. Revocation reviews are immutable objects

**Astra's DeviceKeyReview follow-up.** Two new probe orderings each sent one request where zero was
expected:
- a newer review, made before the old one was submitted;
- the old review submitted twice.

**Cause:** an observation keyed by call bytes was overwritten by another review of the same slot.

**Fixed:**
- `prepareRevoke` returns a frozen review (the call **and** the observed account, network,
  contract, plan, registration, slot, key and epoch).
- `revoke` checks that review's own observation against a fresh read.
- A **bare call never sends**; it gets a fresh review back.
- The panel confirms with the review object.
- **My tests:** an old review twice → `changed`, nothing sent; a bare call → `changed`, nothing
  sent; the fresh review → exactly one request.

**Limit:** the on-chain slot race remains, recorded in §9.11; it is queued as **003wec**.

### Checks

- **`npm run check`:** one run with nothing concurrent. Exit 0, lint (391 files) and types clean.
  1339 passed and 1 skipped (1340), across 145 passed and 1 skipped files. protected-store passed
  in this run.
- **`npm run web:build`:** exit 0. The main chunk is 917.28 kB; CSS is 73.02 kB.

### Handoff: Astra's browser repeat (finite; nothing is running)

1. **Build:** `npm run web:build`.
2. **Ports:** check that 8814 and 8815 are free, and touch no other process.
3. **Start:** `npx tsx scripts/wallet-harness.ts --minutes 10`. It stops by itself.
4. **Fresh sign-in:** open the printed `/use/<offer>` **without reloading**, sign in, then confirm
   the product appears.
5. **Draft:** type a draft and confirm it survives the post-sign-in refreshes.
6. **Phone:** at 390×844, check document scrollWidth equals clientWidth, cards are within the
   viewport, and the enroll and revoke reviews and the result are fully readable and operable.
7. **Desktop:** repeat at 1440 for visual acceptance.

### Still open

- 003web, the fresh-customer purchase (queued).
- 003wec, guarded revocation (queued, registered in JOBS).
- 003wf, after all 003we children.
- The real wallet and testnet rehearsal (prepared, not run).
- 002f1, 004b, 005c, 005d, 006a and all of M6.

All six milestones are open, and the worker stays disabled.
