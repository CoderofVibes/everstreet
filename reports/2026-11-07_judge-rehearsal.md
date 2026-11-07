# Judge rehearsal: Everstreet from a clean clone (November 7, 2026)

Cold reviewer playing a NEAR hackathon judge. Fresh clone of `C:/Dev/Everstreet` at commit
`7fda4b4` into a scratch folder; guide was `README.md` and what it links to, nothing else. Another
demo was already on ports 8820/8821, so mine had to move. No browser pane; all demo interaction over
plain HTTP with `curl` and small Node scripts. Times are wall clock (local), appended as I went.

## Timeline

| Clock | Step | Took | Needed help? |
|---|---|---|---|
| 03:49:36 | `git clone` of the local repository | 5 s | No |
| 03:49:41 | Read `README.md` (238 lines) top to bottom | ~3 min | No |
| 03:50:13 | `npm install` | 9 s (exit 0; two "install scripts not yet covered" warnings, harmless) | No |
| 03:50:42 | `npm run demo -- --port 8830 --minutes 60` (the README's documented port flag) | ~40 s to "Demo (simulated history, fictional): http://127.0.0.1:8830/portfolio" | No. Both ports moved together (8830/8831) with the one flag; the README made this easy. |
| 03:51:24 | Learn how to drive the demo without a browser: served page, `/__harness/wallet.js`, the SPA bundle's `/api/...` calls, `/__harness/accounts` | ~2 min | Yes (help 1). The README's route is browser-only; the wallet harness on 8831 self-documents account switching, which saved me. |
| 03:53:05 | Sign in over HTTP as Delphine (`POST /api/session/challenge` -> `POST /__harness/sign-message` -> `POST /api/session/verify`, 201) | ~1 min incl. one false start (I expected 200) | No |
| 03:53:23 | Delphine's dashboard, portfolio, handovers, Signalwatch business + control sheet, sale page, economics | ~2 min | No. Signalwatch shows `sale_in_progress: true`; attention "A sale is in progress: its terms wait for acceptance" -> `/sales/<id>` |
| 03:55:30 | Seller accepts: `prepare accept` -> create action -> `requested` -> synthetic wallet `accept_sale` -> `check` = confirmed, "accepted" | ~2.5 min incl. two guesses (idempotency_key; `requested` must precede the wallet call) | Yes (help 2) |
| 03:57:33 | Buyer (Noah) accepts: same chain in one script; contract log `sale_finalized` generation 2; check = "Both acceptances matched: the contract closed the sale." | 30 s | No |
| 03:58:30 | Buyer's "first shift": sale page (owner buyer.near, gen 2, operators carried at gen 2), `/proof`, portfolio ("received" from Delphine Marsh), handovers (`applied`) | 30 s | No |
| 03:58:49 | Delphine collects proceeds: `claim` refused twice with clear 409s (`bad_category` -> choose 2; `register_first`), `register` (storage_deposit on tusd.near), then `claim_party_guarded` -> `payout_started`, `payout_settled` 180000000, check = "paid" | ~1.5 min | Partly: the 409 messages told me exactly what to do |
| 03:59:48 | Delphine tries an owner action: `appoint` is refused by Everstreet at prepare (409 `not_owner`, never reaches the chain); the README's step is the `owner_probe` kind, which sends `appoint_operator_guarded` to the chain -> `Smart contract panicked: E_NOT_OWNER: only the current owner` -> check = "refused" | ~1 min | Yes (help 3): found `owner_probe` in the bundle |
| 04:00:38 | Cara, customer: uses list, Signalwatch offer, `prepare` a use (two 400s: `idempotency_key`, then `input` not `inputs`) -> use `e074bfbf...` "Prepared ... Nothing is held yet", hold_seq 8 | ~2 min | Yes (help 4) |
| 04:02:30 | Cara's "authorize" needs a pair of ed25519 signatures from "this device's key" (slot 0, held by the browser). The page loads only `label.js` and `wallet.js`; there is no key harness. Stopped here over plain HTTP. | ~1.5 min deciding to stop | Stopped: a no-browser limit, not a README fault |
| 04:03:29 | Former owner after the close: sale page `former_seller: true`, control sheet **404 "No such business"**, portfolio moves Signalwatch to `former` ("You no longer control this business") | 20 s | No |
| 04:03:50 | Read `docs/SAFETY_CASE.md`, `docs/BUILDS.md`, the two review reports, `v3-sandbox-payouts.txt`, `FEATURES.md`, `AUTHORITY.md`; inspect the linked evidence headers | ~4 min (overlapping the runs below) | No, but see the disagreements |
| 04:04:30 | `npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json` (offline) | 1.2 s, OK | No |
| 04:04:44 | Same with `--live` against `https://rpc.testnet.near.org` | 14 s, exit 0, one DIFFERS line (below) | No |
| 04:05:13 | WSL (rustc 1.99.1, cargo 1.99.1, cargo-near 0.22.0 present): `CARGO_TARGET_DIR=$HOME/everstreet-judge-target cargo test -p business-v3 --lib` from `contracts/`, cold target dir | 70 s; **195 passed, 0 failed** (the README says 195) | No |
| 04:08 | Write this report; stop the demo on 8830 | ~6 min | No |

**Total: 03:49:36 to about 04:14, roughly 25 minutes of judging** (about 8 of them waiting on install, build, verifier and cargo), inside the 40-minute budget. Nothing the README told me to run failed. The two things I could not do were both browser-only: the click route itself, and the customer's device-key signature in step 4.

## Where I needed help

1. **Driving the demo without a browser.** The README's "Try it" is entirely click-by-click
   ("choose Continue with Synthetic demo wallet", "Open it from Needs you today", "Try an owner
   action"). With no browser pane I read the served SPA bundle for its `/api/...` calls and
   `/__harness/wallet.js` for the sign-in handshake. What rescued me: `http://127.0.0.1:8831/`
   answers with `"switch": "POST http://127.0.0.1:8831/account/<account>, then sign out and sign in
   again"` and `/__harness/accounts` lists the cast with roles. Fix: a short "Over HTTP" note (README
   or `docs/DEMO_API.md`) with the sign-in handshake and the five calls of a sale action
   (`prepare` -> `actions` -> `requested` -> wallet -> `check`), plus the `kind` names.
2. **Sale action protocol order.** My first `POST /api/sales/actions/:id/requested {"tx_hash":...}`
   returned 200 but `check` then said "Your wallet hasn't been asked for this request yet." The
   order is `requested {}` *before* the wallet sends, then `check {tx_hash}`. The server could
   refuse a `requested` body that carries a `tx_hash`, or say the state did not change (it echoed
   `state: "prepared"`, `asks: 0`, which reads as success).
3. **"Try an owner action" is a special kind.** `prepare {"kind":"appoint"}` is refused by
   Everstreet itself (409 `not_owner`) and never reaches the contract, so the README's "it refuses
   (`E_NOT_OWNER` ...) and the page shows the transaction" was not reproducible until I found the
   `owner_probe` kind in the bundle. Its `prepare` text is excellent ("The owner is buyer.near
   (generation 2), so the contract should refuse it and change nothing"); name the kind in the README.
4. **Customer use body shape.** `prepare` wanted `idempotency_key` and a string `input`, not
   `inputs` per field; both 400s were clear once read. Then the final "authorize" needs a device
   key the browser holds. A judge following the README in a browser would not hit this; I note it so
   the team knows step 4 of the route cannot be done from curl.
5. **Which contract and series am I looking at?** The README names `ledgerline-v3-2`, `3Ptn4...`,
   "series 2, non-reproducible" for a file whose own header says `ledgerline-v3-3b`, `H1bHm...`,
   commit `e2c7c1c` (series 3, reproducible per `docs/BUILDS.md`). I spent about four minutes
   establishing that the README, not the evidence, was stale.

## What ran on testnet vs simulated

**My understanding.** `npm run demo` runs on a synthetic wallet and a synthetic chain on my
machine: every "transaction" I saw (hashes like `99yQ8JiCbU...`, block hashes
`BkhAAAAAAAAAAAAAAAAAAAAAAAAACAAJ`, contract `signalwatch.demo.near`, token `tusd.near`, `/proof`
saying `"source": "synthetic"` and `"code_hash": "synthetic"`) is simulated, but the synthetic
chain applies the real contract's rules (it emitted `business_core` 3.0.0 events and the genuine
`E_NOT_OWNER: only the current owner` panic text). The demo labels this well: the page label reads
"Demo - simulated history - synthetic wallet and chain", the proof marks every synthetic fact, and
the `/sales` payload is honest that `network: "testnet"` is a label. What really ran on NEAR
testnet is the recorded series: separate born-locked business-v3 accounts (`ledgerline-v3-3b`,
`ledgerline-gated-v3-3`, `ledgerline-payout-v3-3` per `docs/BUILDS.md`), driven by script-held
fictional accounts and a stand-in model, plus the older OpenSeat/v2 records. Nothing in `npm run
demo` touches testnet. The README makes the demo/testnet split clear in prose; what it does not
make clear is *which* testnet run its linked files describe.

**Places where the README and its linked files disagree:**

1. **Contract account.** README ("What it proves on NEAR testnet" and the Direct-sale Setup):
   `ledgerline-v3-2.everstreet.testnet`. The linked `data/evidence/v3-direct-testnet.json` header:
   `"account": "ledgerline-v3-3b.everstreet.testnet"`. The string `ledgerline-v3-2` does not occur
   in that file.
2. **Code hash and build.** README: code hash `3Ptn4BCWZuji2HaGawwHWZ1wpMTF3QA4fjLZF2sLNLM6`, wasm
   SHA-256 `2394b224...ce431`, "non-reproducible build". The linked record: `code_hash_expected:
   H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw`, `wasm_sha256: ede1c2f7...a29b4`.
   `docs/SAFETY_CASE.md` and `docs/BUILDS.md` call this the series-3 **reproducible** build (NEAR's
   pinned image, built twice byte-identical).
3. **Series numbering.** README: the top-level `v3-*-testnet.json` files are "Series 2 (Nov 6
   2026)" and series 1 lives in `v3-series-1/`. Safety case: "Series 3 ...
   `data/evidence/v3-*-testnet.json` ... Series 2 ... `data/evidence/v3-series-2/`". The clone has
   `v3-series-1/`, `v3-series-2/` and `v3-series-3-stopped/`; the README mentions only the first.
   "Series 3" does not appear in the README.
4. **Setup record.** README links `data/evidence/v3-setup-testnet.json` as "accounts, the
   deployment and the key scope" for `ledgerline-v3-2`; the file sits beside the series-3 Direct
   record. The account mismatch in item 1 left me unsure which deployment it describes.
5. **Generation today.** README: "the buyer serves the next use ... which is what the contract
   shows today" implies the buyer (generation 2) still owns the Direct-sale contract. Live read:
   `owner noor-v3s3.everstreet.testnet, generation 3 (DIFFERS the record's last checkpoint)`. The
   unlinked `data/evidence/v3-ext-testnet.json` ("external" example, 48 steps) explains it: the
   business was sold a second time to `noor-v3s3`, with an asset key, a spend allowance, NEAR's
   intents verifier (`intents-v3s3`), a solver, a give-token and a Sepolia registry
   (`0x8881...6cfd`). None of that is in the README.
6. **Attack counts.** README: "92 attack tests". Safety case: "about 50 attack lines refused". The
   review report reconciles them (92 tests across `attack_tests.rs`/`attack_tests2.rs`; 50 bullets
   under "Tried and refused"), but a reader of README plus safety case sees two numbers for one thing.
7. **Companions on another chain, and escrow funded from another token.** The brief asked me to
   find these in the README. They are not there. I found them only in `docs/BUILDS.md` (Sepolia
   registry, intents verifier), `docs/SAFETY_CASE.md` ("with the companions and NEAR's intents
   verifier beside it"), the bundle (`/api/businesses/:id/companions`,
   `/api/sales/:id/intents/quote`) and the top commit message. A judge reading only the README
   would not know these exist.
8. **Smaller oddities in the demo (not README conflicts).** The control sheet says "You control
   Signalwatch on this server (owner generation 0)" while its contract line says generation 1.
   After the close, the buyer's `/api/sales/:id` shows `roles.seller: true` alongside `new_owner:
   true` (the former seller's view correctly shows `former_seller: true`). `/proof` says
   "Customers' units at close: 186" and `carried_over.customers: 2, units: 186`, while the sale
   page and portfolio say 389 prepaid units are owed (1556000000 / 4000000); the demo did not tell
   me which count to believe.

## Proof reproduced

`npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json --live` (14 s):

```
OK: data/evidence/v3-direct-testnet.json
  contract ledgerline-v3-3b.everstreet.testnet - expected code hash H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw
  8 checkpoints at final blocks; 8 signed transactions
Live on NEAR testnet (https://rpc.testnet.near.org, final):
  code hash H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw (matches the record)
  access keys: 0 (nobody can redeploy the code or take the account)
  owner noor-v3s3.everstreet.testnet, generation 3 (DIFFERS the record's last checkpoint)
  customer cara-v3s3-1.everstreet.testnet: 78 unused, 22 used (matches the record)
```

Against the README's claims: **matched** the customer's 78 unused uses ("which is what the
contract shows today"), zero access keys, and a code hash equal to the record's. **Did not match**
the README's own account name and code hash (items 1-2) and its implied current owner (item 5). Two
notes on the tool: it printed DIFFERS and still exited 0, so a CI step would not notice; and the
offline half prints digests and links only (keys are checked only live), which is fine but is not
quite what "checks ... that it has no access keys" leads a reader to expect from the first half.
I did not rebuild the wasm: a Docker image pull plus a 5-15 minute build did not fit beside the
unit tests. `docs/BUILDS.md` gives the exact commit and command, which is what I would want.

Also reproduced: `cargo test -p business-v3 --lib` from `contracts/` in WSL: 195 passed, 0 failed,
in 70 s from an empty target directory. Matches the README's "195 tests".

## Would I trust it

Yes, for the two central claims and within the stated boundary. The customer's units are held by
a contract with no access keys, the accounting identity in the safety case is an invariant I can
check, the live read shows 78 unused units surviving two changes of owner, and the cold attack
review and the sandbox output name functions, errors and measured gas rather than adjectives. The
old owner losing control is shown three ways in the demo: the contract panic `E_NOT_OWNER` on the
synthetic chain, the 404 on the former owner's control sheet, and the "former" shelf in her
portfolio. What I would not yet trust: that the README describes the thing I am looking at (it
names a different account and hash than its own evidence), and the off-chain side of "keeps what
they paid for" (the control sheet lists seven items, hosting and customer data among them, that the
NEAR close does not move; honest, but the promise is narrower than the headline). Attack docket:
found and clear (the safety case table plus the report's "Tried and refused", 50 lines). Companions
on another chain: not in the README; only in BUILDS.md and SAFETY_CASE.md, never explained where a
judge is sent. Escrow funded from another token (intents): same; the README never says it exists.

## Top three changes

1. **Make the README agree with its own evidence.** Replace `ledgerline-v3-2`, `3Ptn4...`,
   `2394b224...`, "non-reproducible" and "Series 2" in "What it proves on NEAR testnet" and the
   Direct/Gated/Recovery blocks with the series-3 facts from `docs/BUILDS.md` (`ledgerline-v3-3b`,
   `H1bHm...`, `ede1c2f7...`, reproducible); link `docs/BUILDS.md`; say where series 1 and 2 now
   live. Add one sentence that the contract was later sold again (generation 3,
   `v3-ext-testnet.json`) so the live verifier's DIFFERS line is expected, and make the verifier
   either exit non-zero on a real mismatch or label this one as later history.
2. **Tell the judge the other-chain and other-token stories exist.** One short README section:
   companions on Sepolia (what the registry is for), escrow funded through NEAR's intents verifier
   (what was swapped, which record shows it), with their evidence files and the `--live` command.
   Today the most distinctive work in the repository is invisible from the README.
3. **Name the demo's moving parts for a hurried or no-browser judge.** In "Try it": the four
   accounts and their roles, that `/__harness/accounts` and `http://127.0.0.1:<port+1>/` list them,
   the `owner_probe` action behind "Try an owner action", and that a customer use needs the
   browser's device key. And fix the two counts a judge will trip on: "owner generation 0" on the
   control sheet versus generation 1 on the contract, and 186 versus 389 units at close on `/proof`.
