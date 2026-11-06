# Debrief for Astra: the first-use review and the contract attack review (Nov 5–6)

From Claude. Two cold reviews ran this week, one on the product and one on the contract. Both
used the same method, both found things our own reviews had missed, and both are now fixed and
committed. This note covers what we did, what we found, what changed, and what we'd like from
you.

## The method (the same both times)

1. **A reviewer that knows nothing.** A fresh Fable 5.1 agent with only a short brief: no code,
   docs or earlier reviews (the product reviewer used only the browser; the contract reviewer read
   only the contract and its design notes). Neither could confirm what we already believed.
2. **Roles, not features.** The brief listed people with goals: six product personas, then
   seven attacker roles. The reviewer worked through them in order, writing findings as it went
   so nothing was lost if it stopped.
3. **Every finding checked before changing anything.** Claude read the code behind each finding
   first. Most were exactly what the reviewer said; a few had deeper causes.
4. **Proof after the fix.** A re-walk of all personas at 1440 and 390 px for the product; for the
   contract, the reviewer's own attack tests rerun against the fixed code.

Briefs: `reports/2026-11-05_first-use-review-brief.md`, `reports/2026-11-06_attack-review-brief.md`.

## 1. First-use review (product)

**Reviewer's findings:** 81 (7 Blocks, 47 Confuses, 15 Noise, 12 Polish).
`reports/2026-11-05_first-use-review.md` has the findings and a status note on every one.

**Outcome:** 78 fixed in commits `5e47252`, `e96a82d`, `6139da8` and `c4bd45c`. The other three
were left over from the reviewer's first, interrupted run (a judge arriving already signed in as
Rosa, and a "Clausemark" project that run created). Restarting the demo before each run clears
them; Tony was told and didn't ask for more. A 60-page persona walk after the fixes found no
sideways scrolling and no error text.

**Root causes worth knowing for design:**
- **A customer couldn't use Ledgerline (#65).** A request prepared before the device had a key
  named another device's key. The page now asks for device setup first.
- **The studio loop (#19).** It hid a second bug: SaaS workflows and agent services were buildable
  but the studio said they weren't. The next step there is now "Offer it as a service instead".
- **The seller and buyer saw the same token formatted differently (#42, #77).** Now one format.
- **Token revenue counted as $0 (#45, #51).** It is never converted to dollars now: pages say
  "Revenue: in TUSD" and "No estimate · revenue is in TUSD".
- **An empty marketplace (#5, #7, #37).** The demo had published businesses with raw SQL instead
  of the real publish steps.

**What changed across the UI (all following Tony's no-narration rule):**
- One banner instead of two, and explanatory paragraphs removed or behind an (i).
- Every date shows in local time with its time zone (`web/src/when.ts`).
- Desks and the Inbox show waiting customer requests and the sale in progress.
- Sale steps show one current step with plain action labels.

**Kept on purpose, reworded:**
- The wait after cancelling a use (#66).
- The buyer's rights to withdraw escrow or cancel after accepting (#78).
- The sign-in consent facts (#17), now one line.

**#13 (dark scheme):** the app is declared light-only; no dark theme was built. That's a
direction call for you and Tony.

## 2. Attack review (contract, `contracts/business-v3`)

**Reviewer's findings:** none critical, high or medium; 4 low and 7 notes.
`reports/2026-11-06_attack-review.md` has them, backed by 92 attack tests, with a list of about 50
attacks the contract refused.

**Fixed (Nov 6, in the same commit as this note):**
1. A former owner who had paid for customers' sign-ups could delete the unbought ones after a
   sale. Paying for a sign-up now gives no power; the current owner or a current operator can
   clear an unbought one, and the deposit still goes to the payer.
2. A customer's key on an unbought sign-up locked the business's deposit. Fix 1 covers it.
3. Many customer accounts could fill all 16 payout slots and stall the owner. Customers together
   now hold at most 14.
4. Setup accepted the business's own account as owner or closer. Now refused.

The reviewer's tests are now in the repository (`contracts/business-v3/src/attack_tests.rs`). The
five that proved findings 1–4 are turned around to show the fix, and the full contract suite is
195 tests, all passing. `docs/design/BUSINESS_V3_CORE.md` records the new rules.

**Two notes changed the sale page:**
- A seller who stays on as an operator after the sale is now marked "the seller" wherever
  operators are listed (note 10; the buyer still has to accept it in the terms).
- The "offer has passed" warning no longer shows once both sides have accepted and a gated sale is
  closing (note 7).

**Still open:** callback gas (note 8). A payout whose callback ran out of gas would be stuck. The
unit host can't measure gas, so the next check runs the contract on a local NEAR sandbox and gives
the callback a measured margin. The fixes are in source only; the next testnet rehearsal needs a
new business account, and recordings made before Nov 6 ran the earlier code.

## What we'd like from you

1. **Shape the safety case for judges.** `docs/SAFETY_CASE.md` is a plain first draft: the eight
   promises, what enforces each, the attacks refused, the four fixes, how to rerun, and what stays
   open. It deliberately says "not an audit". Tony would like it presentable to judges. Where it
   lives (README section, a page in the app next to the sale, the demo video) and how it reads is
   your call with Tony.
2. **Consider a "tried and refused" moment on the sale page.** Each promise on the sale screen
   ("escrow can't be taken", "old operators lose access", "customers keep what they paid for")
   could link to the attacks that were tried against it. That's a proposal for you to accept or
   drop, not a job yet.
3. **Make the cold review a standing step.** Both reviews found what our own reviews missed. If
   you agree, add it to the review workflow: a cold reviewer on a fresh demo before each major
   capture, with briefs kept in `reports/`.
4. **Decide dark mode** (#13): build it, or keep light-only as a stated choice.

## Follow-up after your take (Nov 6, later)

Tony and you agreed on the order; Tony asked for all of it. Your ask #2 above (a "tried and
refused" link on the sale page) is dropped: the sale screen stays quiet, and the film carries the
moment (the former owner refused, then the customer's use going through).

**Done:**
- **Safety case wording.** The payout promise now states what was measured, not an unconditional
  claim, and the "nothing critical, high or medium" line moved below the promises table, framed as
  this review's ratings.
- **Callback gas, measured on a real local NEAR node** (`contracts/business-v3/tests/sandbox.rs`,
  output in `data/evidence/v3-sandbox-payouts.txt`). The callback used at most 2.4 of its 10
  reserved TGas across every payout kind, succeeding and failing (4x margin). Refunds sent with
  every amount of gas from 5 to 300 TGas either failed whole with nothing changed or completed;
  none stayed in flight. A sale closed between a refund's start and its callback, and the refund
  still reached the customer. No contract change was needed.
- **README opening** reshaped to your sequence: what it is and the problem, video placeholder, one
  route (`npm run demo`), three outcomes linked to evidence, "How we tested these promises", then
  everything else.
- **Permissions across the app** (your check 2), by a second cold reviewer with the same method
  (`reports/2026-11-06_permissions-review.md`, 29 tests in `server/test/permissions-review/`).
  1 High, 1 Medium, 3 Low, 5 notes:
  - **High, fixed:** a Direct sale that closed on the contract while nobody told Everstreet (the
    closing answer lost, or the acceptance sent from another wallet) left the seller in charge
    here until someone checked. A watcher now reads every recorded sale from the chain every
    15 s and applies a proven close. The window is one interval, not zero.
  - **Medium, fixed differently:** a former seller still reaches the sale room, because that is
    where proceeds are collected, but sees only their own claims and the public owner/operators:
    no later deal, customer totals or someone else's handover.
  - **Lows:** two list routes now check sign-in first; deal routes answer non-parties 404.
  - **Kept by design:** a cancelled deal doesn't end the evidence room. The room follows the
    seller's grant, which revokes or expires.
- **Fresh testnet run (series 2)** with the fixed contract: Direct, Gated and recovery all
  complete and verify offline (code hash `3Ptn4B…`). Series 1 is kept in
  `data/evidence/v3-series-1/`. The public RPC dropped one platform charge; the identical signed
  transaction was broadcast again and landed (recorded as an operator note). That's worth knowing
  if the film shows explorer links.

- **Cold judge rehearsal** (your check 3) from a fresh clone, README only
  (`reports/2026-11-06_judge-rehearsal.md`). It got the demo running, walked the whole sale in
  the browser, reproduced the testnet proof by reading the contract live, and said it would trust
  the central claim, with reservations:
  - the reviewers are also Claude;
  - the former owner's refusal it saw was the app hiding the business, not the contract refusing;
  - a customer's charge never settled in front of it.

  Fixed the same day: a way to become the buyer, a port option, `verify-rehearsal --live`, and
  demo maintenance. While checking, I also found the demo's Ledgerline budget was used up, so a
  visitor's own request couldn't run; it gets a fresh budget now.

  Open, and yours and Tony's to decide:
  - an account picker in the demo wallet;
  - a "try an owner action" on the v3 sale page that shows the contract's own refusal;
  - a buyer's first-shift list after a v3 close;
  - the "NEAR testnet" header inside the synthetic demo;
  - shortening "Everything in it".

**For you:** the README's video line is a placeholder. The opening and order are drafted to your
outline; the wording is yours to change.
