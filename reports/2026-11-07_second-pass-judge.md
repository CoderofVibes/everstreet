# Judge rehearsal, second pass: Everstreet from a clean clone (November 7, 2026, evening)

Cold reviewer playing a NEAR hackathon judge. Fresh clone of `C:/Dev/Everstreet` at commit `7d7ed3a`,
working only from `README.md` and what it links to. No browser pane (another reviewer has it); all
demo interaction over plain HTTP with Node/curl. Demo moved to port 8850 to keep off 8820/8821.

Appended as I went; times are wall clock (local).

## Timeline

| Time | Step | Took | Needed help? |
|---|---|---|---|
| 05:08:38 | `git clone` of the local repo | 2 s | No |
| 05:08:40 | Read `README.md` top to bottom | ~3 min | No |
| 05:11 | `npm install` started (background) | see below | - |
| 05:08:59 | `npm install` (background) | 9 s (warm cache, exit 0) | No |
| 05:09:30 | `npm run demo -- --port 8850 --minutes 300`-style start; used `--port 8850 --minutes 90` | ~25 s to "Demo … http://127.0.0.1:8850/portfolio" | No. The `--port` option is documented one line under the steps; it worked first time and also moved the wallet to 8851 |
| 05:10 | Read `docs/SAFETY_CASE.md`, compared evidence headers with the README's account names and code hashes | ~4 min | No, but this is where the README and its files started to disagree (below) |
| 05:10:56 | `npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json --live` (background) | 14 s, exit 0 | No |
| 05:11-05:16 | Work out how to sign in over HTTP without a browser | ~5 min | **Yes.** The README gives no API or HTTP route. I had to read the built bundle (`web/dist/assets/index-*.js`) for `/api/session/challenge` → `/__harness/sign-message` → `/api/session/verify` with `{account_id, public_key, signature, nonce}`, and find the synthetic wallet's own port (8851) and account list (`/__harness/accounts`). A judge with a browser would not hit this; a judge scripting it would |
| 05:16:56 | Step 1: Delphine accepts the Signalwatch terms (`prepare` → `actions` → `requested` → wallet `tx` → `check`) | 15 s after two guesses (`idempotency_key` rules; `/api/sales/<business id>`, not the intent id) | Yes (route shape; bundle read) |
| 05:17:11 | Step 2: Noah accepts; `check` says `closed`. Owner `buyer.near`, generation 2, `live_deal` null, customers' prepaid 1,556 TUSD unchanged | 10 s | No |
| 05:17:53-05:18:48 | Step 3a: Delphine claims proceeds. First refused `bad_category` (needs `{"category":2}`), then `register_first` (a token registration), then `paid` 180 TUSD | 1 min | Yes: the README says "collect the proceeds" as one step; over the API it is three (category, register, claim). The UI probably hides this |
| 05:19:03 | Step 3b: `owner_probe` as Delphine: `appoint_operator_guarded` → `Smart contract panicked: E_NOT_OWNER: only the current owner`; app shows `refused`, "nothing changed" | 10 s | No, once I guessed the kind name (`owner_probe`; the server's `bad_kind` error does not list the valid kinds) |
| 05:19:23 | Buyer's handover record (`/api/businesses/<id>/handover-record`): releases, offers, 389 outstanding units, 1,556 TUSD owed, external transfers "pending_external" | 5 s | No |
| 05:20:17-05:20:36 | Step 4: Cara uses Signalwatch under the new owner. `purchase-setup` shows 93 free of 100 purchased before the sale. `prepare` made a use (hold 8 reserved) but `confirm` needs two ed25519 signatures with Cara's customer key, which exists only in the browser (`keys` lists public key slot 0; no harness route signs). **Stopped here**, cancelled the use | 1 min | **Blocked** over plain HTTP. Not a defect; the brief said not to work around it |
| 05:21 | Read `docs/BUILDS.md`, `docs/INTENTS.md`, `docs/FEATURES.md`, `docs/AUTHORITY.md`, both review reports' heads, `data/evidence/v3-sandbox-payouts.txt` | ~4 min | No |
| 05:22 | WSL: `CARGO_TARGET_DIR=$HOME/everstreet-judge-target cargo test -p business-v3 --lib` from `contracts/` (background; fresh target) | see end | - |

| 05:21:58 | Contract tests finished: `test result: ok. 234 passed; 0 failed` in 24.5 s (36 s wall; the WSL target dir already had a build cache) | 36 s | No. But the README and the safety case both say **195** tests; the suite has **234** |
| 05:23:42 | Stopped my demo (PID on 8850/8851); 8820/8821 untouched | - | - |

**Total: 15 minutes wall clock (05:08:38 to 05:23:42)**, of which about 6 minutes went on working out the HTTP sign-in and sale-action shapes that a browser would have hidden. Of the README's four demo steps I completed 1, 2 and 3 over HTTP; step 4 (the customer's use) stopped at "prepared" because the customer key signs only in the browser.

## Where I needed help

1. **No HTTP surface in the README.** "Open http://127.0.0.1:8820/portfolio, choose Continue with Synthetic demo wallet" is browser-only. With the browser pane unavailable I had to read the built bundle for the session routes and the synthetic wallet's own port (8851). One line in the README ("the synthetic wallet answers on port+1; `GET /__harness/accounts` lists who you can be") would have halved my setup time. Judges scripting a demo, or on a headless machine, hit this.
2. **"collect the proceeds" is three calls.** `prepare claim` answered "Choose sale proceeds (2), returned escrow (1) or operating profit (0)." and then "Your account isn't registered with the business's token, so a payout to it would fail. Register first." Fine in the UI, I expect, but the README's step 3 reads as one click. A judge watching the browser will still see two wallet prompts (register, claim) for "collect".
3. **"Try an owner action" has no name.** The server's `bad_kind` error says only "kind must be one of the sale actions"; I found `owner_probe` by guessing. Listing the valid kinds in that error is a free fix.
4. **The README's testnet section names accounts that are not in the files it links.** Quoted: "a business-v3 contract born with no access keys (`ledgerline-v3-2.everstreet.testnet`, Nov 6 2026)" and "code hash `3Ptn4BCWZuji2HaGawwHWZ1wpMTF3QA4fjLZF2sLNLM6`". The linked `data/evidence/v3-direct-testnet.json` is `ledgerline-v3-3b.everstreet.testnet`, code hash `H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw`, recorded 2026-11-07 04:12 UTC. I only understood this after reading `docs/SAFETY_CASE.md` ("Which code ran on testnet") and `docs/BUILDS.md`, which describe a "series 3" the README never mentions. The fix is to rewrite the README's testnet paragraphs for series 3 (or link `v3-series-2/` if series 2 is what it means to describe).
5. **Step 4 cannot be done without the browser.** Not a README defect, but one sentence ("the customer's key is created in the browser and signs there") would stop anyone trying to script it.

## What ran on testnet vs simulated

My understanding, from the README, the demo and the linked files only:

- **Simulated (local):** everything in `npm run demo`. The page label says "Demo: simulated history, synthetic wallet and chain"; `/api/env` says `"environment":"Demo: simulated history (fictional)"`; the contract is `signalwatch.demo.near` on a fake chain whose block hashes are counters like `BkhAAAAAAAAAAAAAAAAAAAAAAAAACABE`. The sale, the `E_NOT_OWNER` refusal and the payout I ran were all against that synthetic chain, which the README says "follows the contract's rules". The demo's attack docket (`/api/public/attacks`) is labelled "Fixture results: Everstreet's real routes over the synthetic chain ... Not the contract's own code." All of this was clear.
- **Ran on NEAR testnet (read by me, read-only):** the Direct sale on `ledgerline-v3-3b.everstreet.testnet`: 100 bought, 20 used, close at generation 2 with 80 owed, then 79, then 78. The verifier read the live contract and matched code hash, zero access keys and the customer's 78 unused. The gated and recovery records have the same shape on `ledgerline-gated-v3-3` and `ledgerline-payout-v3-3`; I did not re-verify those live.
- **Ran on testnet but not in the README:** a later sale of the same business to `noor-v3s3.everstreet.testnet` (generation 3), plus two companion contracts (`asset-key`, `spend-allowance`), NEAR's intents verifier and a Sepolia registry, all in `data/evidence/v3-ext-testnet.json`. The verifier told me "owner noor-v3s3 ... changed since this record ... look for a later record of this business"; the README has no such record and never uses the words intents, Sepolia or companion. The README's "which is what the contract shows today" (78) is still true, but "the contract" now has a third owner.
- **Older testnet runs (v1 OpenSeat handoff, v2 pottery sale):** described in the README with their evidence files; I did not verify them.
- **Not run by me:** the v3 reproducible-build compare (`docs/BUILDS.md` gives the command; it needs Docker in WSL and I chose the unit tests instead).

### Where the README and its linked files disagree

| # | README says | Linked file says |
|---|---|---|
| 1 | "What it proves on NEAR testnet": `ledgerline-v3-2.everstreet.testnet`, Nov 6 2026, code hash `3Ptn4BCW...`, "Series 2" | `data/evidence/v3-direct-testnet.json` and `v3-setup-testnet.json`: `ledgerline-v3-3b.everstreet.testnet`, 2026-11-07 04:12 UTC, code hash `H1bHmRMX...`, wasm sha256 `ede1c2f7...`. `docs/SAFETY_CASE.md` and `docs/BUILDS.md` call this **series 3** (reproducible build) and say series 2 is in `data/evidence/v3-series-2/` |
| 2 | Gated sale: "contract `ledgerline-gated-v3-2.everstreet.testnet`" | `v3-gated-testnet.json`: `ledgerline-gated-v3-3.everstreet.testnet` (same code hash as above). The unit counts 94/1/5, then 95, then 94/6 do match |
| 3 | Recovery: "contract `ledgerline-payout-v3-2.everstreet.testnet`" | `v3-recovery-testnet.json`: `ledgerline-payout-v3-3.everstreet.testnet` |
| 4 | "One platform charge was broadcast and then dropped by the RPC ... the identical signed transaction ... was broadcast again, and it landed. The record's operator note gives the hash." | The linked series-3 record has no operator note and no such step; that story is in `v3-series-2/v3-direct-testnet.json` |
| 5 | "business-v3 wasm SHA-256 `2394b224...ce431`, rustc 1.99.1, cargo-near 0.22.0, non-reproducible build" | The linked records' wasm is `ede1c2f7...a29b4`; `docs/BUILDS.md` says the deployed build is reproducible, in `sourcescan/cargo-near:0.22.0-rust-1.97.1` |
| 6 | Contract unit tests "195 tests"; the safety case also says 195 | `cargo test -p business-v3 --lib`: **234 passed**. The safety case's own "second review" section says 60 more tests were added on Nov 7 |
| 7 | Nothing about a later sale, companions, Sepolia or intents | Verifier (live): owner is now `noor-v3s3` at generation 3. `docs/SAFETY_CASE.md` describes companions with two **open High** findings; `docs/BUILDS.md` lists `feed-key-v3s3`, `budget-v3s3`, `intents-v3s3` and a Sepolia address; `docs/INTENTS.md` describes funding escrow from another token. `data/evidence/v3-ext-testnet.json` is not linked from the README |
| 8 | "the four issues it found are fixed" (attack review) | `docs/SAFETY_CASE.md`: the Nov 6 four are fixed, but the Nov 7 review left findings 1 and 3 (**High**) and 4 to 8 **open** in the companion contracts, "demonstrations of the pattern ... not promises". The README's safety section does not mention the second review |

None of these change the three proven claims (80 kept, owner refused, 79 then 78 served), and every number in the README checks out against the files. But a judge who opens the first evidence link and sees a different account, hash and date from the README will wonder what else is stale.

## Proof reproduced

`npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json --live` (14 s, exit 0):

```
OK: data/evidence/v3-direct-testnet.json
  contract ledgerline-v3-3b.everstreet.testnet · expected code hash H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw
  8 checkpoints at final blocks; 8 signed transactions
Live on NEAR testnet (https://rpc.testnet.near.org, final):
  code hash H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw (matches the record)
  access keys: 0 (nobody can redeploy the code or take the account)
  owner noor-v3s3.everstreet.testnet, generation 3: changed since this record (its last checkpoint
    shows buyer-v3s3.everstreet.testnet at generation 2); a later sale moved control, so look for a
    later record of this business
  customer cara-v3s3-1.everstreet.testnet: 78 unused, 22 used (matches the record)
```

Result against the README: the three claims (80 kept at close, owner refused, 78 "today") **match** the record and the live chain. The README's labels for that run (account `ledgerline-v3-2`, hash `3Ptn4...`, Nov 6) **do not match**: the verifier printed `ledgerline-v3-3b` and `H1bHmRMX...`. The "owner ... changed since this record" line is accurate and well worded, but the README gives no pointer to the later record it tells me to look for.

Also run: `cargo test -p business-v3 --lib` in WSL: 234 passed, 0 failed (README: 195).

## Would I trust it

For the central claim, yes, within the stated scope: the customer's units live in a record the owner cannot touch, the owner change and the generation bump happen in the same call, and I watched the former owner's `appoint_operator_guarded` fail with `E_NOT_OWNER` on the demo chain and read the real contract on testnet showing 78 unused units through two changes of owner with zero access keys. What I trust less is everything around the contract: the safety case is honest that both reviewer and builder are AI models and nobody independent has audited it, the companions have two open High findings, and the README is already one run behind its own evidence. On the brief's three items: the **attack docket** is there (92 tests cited, matching the report; the demo also has a fixture-level docket, clearly labelled); the **companions on another chain** and **funding escrow from another token** are in `docs/SAFETY_CASE.md`, `docs/BUILDS.md` and `docs/INTENTS.md` but **not in the README**, so a judge who reads only the README misses both the feature and its open findings.

## Top three changes

1. **Rewrite the README's testnet section for series 3** (accounts `ledgerline-v3-3b`, `ledgerline-gated-v3-3`, `ledgerline-payout-v3-3`; code hash `H1bHmRMX...`; wasm `ede1c2f7...`; reproducible build; 2026-11-07). Drop the series-2 "operator note" story or move it to a series-2 line that links `data/evidence/v3-series-2/`, fix "195 tests" to the real count, and add one line: "A later sale moved this business to a third owner; record: `data/evidence/v3-ext-testnet.json`." Every disagreement above comes from this one stale section.
2. **Add the second review and the companions to "How we tested these promises"**, with their status: business-v3 held all 39 attacks; the two companion contracts have open High findings and are demonstrations, not promises; funding escrow from another token (`docs/INTENTS.md`) and the Sepolia registry exist. Right now the README's safety section reads as "all fixed", and the safety case it links says otherwise.
3. **Give the demo a two-line "without a browser" note**: the synthetic wallet answers on port+1 (`/__harness/accounts` lists the people); sign-in is challenge, sign, verify; sale actions are `/api/sales/<business id>/prepare` with kinds `accept`, `claim {category:2}`, `register`, `owner_probe`; the customer step needs the browser because the customer key signs there. Also make the `bad_kind` error list the kinds. This cost me six of fifteen minutes.
