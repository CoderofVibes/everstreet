# Claude resume note (direct build, November 5 2026)

Sole current execution note for Tony's direct build (handoffs/2026-11-05). Updated in place.
Builder: Claude Code, claude-opus-5-5, high, subscription. Astra's automatic goal stays paused.

## Agreed plan (Tony, Nov 5 afternoon; build in this order)

1. Hardening: restart/kill matrix around the whole flagship journey; Gated close inside the
   journey; 006b agent access in the configured child across a sale + owner on/off per offer.
2. Homepage: Ledgerline featured example (try a sample invoice with the LABELLED stand-in model,
   follow it into Operate and Acquire); Example businesses section, visually apart from real
   listings, sample/simulated labels; readiness in a small disclosure; import tile lead "Bring an
   existing product and see what it needs to launch or transfer."; desktop + phone check.
3. Product-type framework on trusted Everstreet-owned engines (no generated code), then
   Relaydesk (SaaS workflow: intake, assignment, resolution; 1 unit per submitted request) end
   to end, added to the homepage.
4. Signalwatch (agent service on the AI runtime: changelog -> flags, why, proposed action; charge
   only delivered analyses) end to end, added to the homepage. Client portal later.
5. 006a web apps: immutable releases with roll back/retire, separate sandboxed customer origin,
   pricing = free access or a time-based access pass (charged when access starts). Real releases
   stay disabled until the worker host passes (stand-in labelled).
6. Team/co-op ownership, then 006c successor rehearsal.
7. Demo login: a FICTIONAL founder (not Tony) with Ledgerline, Relaydesk, Signalwatch (one
   mid-sale); history produced by running the real flows on the simulated chain over 30 days,
   labelled "Simulated history"; the script can later run on testnet if Tony approves the
   rehearsal. Credentials in the seed file, never in chat. Rich portfolio dashboard from Tony's
   mockup (handoffs/2026-11-05/everstreet-portfolio-mockup.png) with more charts; never sum
   across currencies.
8. Readable token amounts everywhere; full screen passes (1440/1280/phone, keyboard, zoom,
   reduced motion); then Astra's review; then Tony's walkthrough.

Models: Opus 5.5 builds. Fable 5.1 does ONE design session for the homepage example businesses
and the dashboard (docs/design/SHOWCASE_DESIGN_PROPOSAL.md); it goes to Astra to shape (Astra owns
visual direction), then Opus builds.

## Now

- **GUIDED TOUR (Nov 11; Tony):** the static site is now the app itself (App.tsx unchanged) answering from a recording of the demo, with a seven-step guide docked below (web/src/tour: replay.ts, steps.ts, Guide.tsx; entry web/src/proofSite.tsx). Record with `scripts/record-tour.ts` (launch config "tour-recorder", in front of the demo) into `data/tour/recording.json`; `npm run proof-site` ships it as `data/tour.json` and stops if a guide stop isn't in the recording. Viewers: delphine, cara, noah. Hosting and Friday's steps: docs/RELEASE.md. Decision: docs/DECISIONS.md (2026-11-11).
- **AGENT HIRES AGENT (Nov 7, late; Anthony yes):** demo: Signalwatch's agent (signalwatch-agent.demo.near, also holds Signalwatch's budget) buys and uses an invoice read from Ledgerline over 402 (`agentHiresAgent`, scripts/lib/demo/agents.ts; the wallet lists it). Testnet: `scripts/agent-hires-agent-testnet.ts` deployed `signalwatch-v3s8` (born locked, same code), owner wes-v3s8 appointed signalwatch-agent-v3s8 (METERING, gen 1), the agent bought 2 and used 1 at Ledgerline; `data/evidence/agent-hires-agent-testnet.json` (resumed once: a short request key), verify --live OK, 4.93 NEAR (mostly storage). README opening realigned (launchpad for the agentic economy), For agents section, claims rows. Realignment note: `docs/astra/2026-11-07_AgenticEconomyRealignment.md`.
- **AGENT OVER HTTP 402 ON TESTNET (Nov 7, late; Tony yes):** `scripts/agent-402-testnet.ts`: agent-buyer-v3s7 gets 402, pays its own registration and a 2-use purchase, the contract confirms, it uses one (1 unused, 1 used); the owner sees the 402 and the confirmed purchase. `data/evidence/agent-402-testnet.json`, verify --live OK, 0.309 NEAR. README claims row now points at it. Next (Tony): video shot list around "a launchpad for the agentic economy, on NEAR"; README opening draft for Tony and Astra.
- **README SESSION (Nov 7, late; Tony: Astra's pass complete, decisions 1 to 3 yes):** Astra's
  README committed as written (77a7838). Revenue by source names a linked customer only for links
  on chain (owner, operator, registration payer); a link only in Everstreet's records shows its
  reason and use count, never the account (9ecd293). Testnet (81f512d): the business contract
  refuses its former owner directly (`scripts/former-owner-probe-testnet.ts`, two `E_NOT_OWNER`
  failures, control unchanged, gas only; `data/evidence/former-owner-probe-testnet.json`); linked
  revenue re-run with wren-v3s6 and block-pinned checkpoints (0.308 NEAR; first run kept as
  `linked-revenue-first-testnet.json`). README: the strip's middle cell and a claims row use the
  business contract's own refusal; How NEAR is used; testnet accounts table; How it was made
  (disclosures); Built at; demo port 8840; Day One link left as an HTML TODO. Next: fresh-clone
  rehearsal from the README only. The strip shows the business contract's own refusal under sale 3 (`business_refused`); README Team line is Anthony Langford.
- **COLD REVIEW OF 1 TO 3 DONE (Nov 7 late, Fable 5.1):** one cold reviewer on the strip, revenue
  by source and the static copy (`reports/2026-11-07_fable-review-123.md`: 0 high, 3 medium, 8 low;
  all three hold), triage `reports/2026-11-07_triage-123.md`, fixes in small commits (208e4c4 the
  strip names which contract refused the former owner, a companion each time, and whether as the
  call's answer or a failed transaction; "Closed" block relabelled as the new owner's read; the close
  found by the contract's `sale_finalized` event, two-sale test; cd1ad74 economics: "the owner's
  side", payer read per plan, scenario from zero; 1c137c8 docket "refused or flagged", uncommitted
  mark, Revenue attribution as group 9 and planted faults as group 10; 7fa7a32 static copy 404.html,
  read test follows the bundle, linked-revenue script records blocks; 996001e suite re-recorded at a
  clean commit), then a second cold pass (`reports/2026-11-07_second-pass-123.md`: 0 high, 3 medium,
  4 low; its real find was my own: the re-recorded suite broke the suite test's group count, fixed;
  disposition at the end of the triage; the after-sales snapshot re-taken read-only, still 78/22/100).
  Safety case: a bullet on what the recorded refusals are. OPEN, Tony's decisions (asked in chat):
  (a) record one `owner_probe` by a former owner against ledgerline-v3-3b on testnet so the strip has
  the business contract's own refusal (one small transaction, new record); (b) whether a buyer is
  shown linked customers' account ids, and whether the Everstreet-only reasons (owner here, team
  here) name the account at all; (c) optional: re-run the linked-revenue testnet script so its record
  carries blocks (~0.3 NEAR). README: NOT touched by Claude; Astra left a README draft and
  `docs/astra/2026-11-07_READMEDraft.md` uncommitted in the tree for Tony. LESSON: run the full
  check before every commit, records included. NEXT: Tony's answers, then the README session.
- **AGREED LIST (Tony, Nov 7 evening), in order:** (1) the handover strip on /proof/ledgerline:
  DONE (each of Ledgerline's three testnet sales at the close: block and transaction, the former
  owner's first refused call on chain, the customer's units; then a read-only snapshot after the
  last sale, `scripts/ledgerline-after-sales.ts`, `data/evidence/ledgerline-after-sales-testnet.json`:
  78 unused, 22 used of 100). (2) "Seller pays its own business": DONE on the sale's economics
  (`/sales/:id/economics`, owner and buyer; `server/src/revenueSources.ts`): earned revenue split
  into independent customers and customers linked to the seller (the owner or an operator on the
  contract; the owner's or team's accounts or person here; the contract's registration payer),
  an unread registration counted apart, and what isn't checked (money routed through other
  accounts, recruited third parties). Demo: Delphine paid for Theo's Signalwatch registration, so
  Noah sees 28 TUSD independent and 28 linked. Attack suite 27/27 ("Seller pays its own
  business"). The buyer scenario now starts from independent uses (87d9787). Testnet run DONE (Tony: "if
  this adds to our case, do it"): `scripts/linked-revenue-testnet.ts` (shared plumbing in
  `scripts/lib/testnetRun.ts`): ines-v3s4 paid for wren-v3s5's registration (sponsor_shell; the
  contract names her as payer), Wren bought 2 uses and used 1 through the app, and the owner's
  economics show Wren's 0.15 tUSD as linked (registration paid by the seller) and Cara's 22 uses
  independent; `data/evidence/linked-revenue-testnet.json`, verify --live OK; 0.31 NEAR spent. (3) Static proof site:
  BUILT LOCALLY, NOT PUBLISHED (Tony: publish with the repo, probably Nov 12). `npm run
  proof-site` writes `web/dist-proof/` (ignored): web/src/proofSite.tsx (landing, /proof/ledgerline,
  /attacks, /example/*; any other /api read answers 404), data files from the server's own
  projections, `_redirects` and `vercel.json` for SPA routes, a manifest of file hashes. Preview:
  launch config "proof-site" (port 8830). Optional private preview online behind Cloudflare Access
  needs Tony's sign-in. (4) README with Astra (Tony
  has the prompt; competitor names stay out of the repo). THEN a cold Fable review of 1 to 3 only.

- **SERIES 4 DONE (Nov 7; Tony: "Yes on the testnet deploy")**: the fixed companions on testnet.
  Reproducible builds of 24ac5fb, each built twice byte-identical (asset-key e123359c...,
  spend-allowance 3bb09676...; `docs/BUILDS.md`), local-node tests pass on those exact files
  (sandbox tests take WASM_<CRATE>; helper `data/runtime/sandbox-recorded.sh`, run with
  MSYS_NO_PATHCONV=1). `scripts/series4.ts setup|run|resume`: feed-key-v3s4 (G9qsYK...) and
  budget-v3s4 (521EJE...) born locked beside ledgerline-v3-3b; new Sepolia registry
  0x3b093ebdf5e727766c128df85d1f4540d84de269 (first controller gen-3); agent/supplier-v3s4 and
  buyer ines-v3s4. Run complete (43 steps, resumed once: the app correctly couldn't read the
  registry before Sepolia finalized it): every fix refused on chain as expected, sale noor-v3s3 to
  ines-v3s4 (generation 4), buyer's move to the derived address final, the seller's held publish
  refused by Sepolia, re-grant. Records `data/evidence/v3-s4-setup-testnet.json`,
  `data/evidence/v3-s4-testnet.json` (verify --live OK; the Direct and ext records now report the
  later sale). Spend 6.15 of the approved 8 NEAR; ~0.004 test ETH. App records copied to
  `data/runtime/rehearsal-s4` (series 3's stay as they were). LESSON: a new Sepolia contract
  reads as empty at "finalized" for ~15 min; wait before the app reads it. Grok's three points
  answered in chat (customers protected: yes, lead with it; "one contract covers the whole life":
  inaccurate, use "one contract decides who is in charge; companions ask it"; checkable handoff:
  yes, the seller-loses-rights moment could be one line). NEXT: README session, Tony gives the
  instructions.

- **ROUND 3 DONE (Nov 7 evening; Tony: "1 go ahead and fix, 2 fix, 3 skip dark theme, 4 keep the
  picker; fix the Try tab, badges, studio labels and the rest of the second first-use pass")**:
  e2b187e companion contracts fixed in source (asset-key derives the move's destination, nonce
  discipline, deposit returned on a failed sign; spend-allowance Approving state, owner reject,
  7-day expiry, pay charges its storage, withdraw reserves after the owner check), WSL 13/12/234
  plus both local-node tests; 18d4132 app follows the new companion API, attack suite 26/26,
  Rosa's demo contract (POST /api/businesses/:id/demo-contract, demo only; checked end to end in
  the browser to an active offer), studio Try form, labels and the second-pass sweep. NOT DONE,
  needs Tony: deploying the fixed companions to testnet (new accounts feed-key-v3s4 and
  budget-v3s4 bound to ledgerline-v3-3b at generation 3, a new Sepolia registry, a sale to a new
  buyer, then the companion moves, grant, approve and reject recorded; reproducible builds first;
  a series-4 script still to write). Read-only balances Nov 7: root 16.8 testnet NEAR, Sepolia key
  0.039 test ETH. Skipped with reasons (told Tony): invoice description (the contract keeps only a
  digest), authorize and run as two steps (deliberate), exact base units on approval reviews
  (amount provenance), studio first-screen density and the board panel's placement (Astra), the
  demo's stand-in model refusing invoices it doesn't know (a real model is Tony's call).

- **FABLE FULL REVIEW DONE (Nov 7; Fable 5.1 ran it)**. Four cold reviewers (first use, contract
  attacks, permissions, judge from a clean clone), briefs and reports in `reports/2026-11-07_*`,
  triage in `reports/2026-11-07_triage.md`; then fixes in small commits (7f96af0 server and judge
  items, 01bd0e6 the 60 attack tests kept, 37b0511 and 7d7ed3a first-use fixes, then the
  second-pass fixes); then a second cold pass (first use, permissions, judge) recorded in
  `reports/2026-11-07_second-pass.md`, with its eleven permissions findings and six first-use
  blockers fixed the same evening (35 more tests in `server/test/permissions-review-3/`).
  business-v3 held every attack (39/39). OPEN, Tony's decisions (asked in chat, no answer yet):
  (1) the companion contracts' findings (asset-key: any address/nonce in `SetController`, a seller
  can pre-sign the hand-over; spend-allowance: a retried `approve` pays twice; plus 4 medium, 2 low):
  fix in source and redeploy both companions as new testnet accounts and re-run the ext series?
  Their `*_finding_*` tests pass while the attacks succeed; `docs/SAFETY_CASE.md` says the
  companions are demonstrations, not promises, until fixed. (2) Rosa's "Start building" route ends
  at a missing contract (now explained plainly; the desk item waits on the operator): should a new
  business get its own contract on the demo's synthetic chain? (3) No dark theme at all: build one
  with Astra or state light-only. (4) The demo wallet picker names each person's role. Still open
  from the second pass: the studio's Try tab asks for JSON for a workflow product (needs a small
  form from the intake fields); the studio's label long tail; the example page's Operate badges.
  README: NOT touched (stale series-2 facts, no mention of series 3, companions, Sepolia, intents or
  the second review; both judges listed the exact lines: triage D1, second-pass judge's eight).
  NEXT: Tony's answers above, then the README session (Tony, Astra, Claude). `docs/DEMO_HTTP.md`
  explains driving the demo over HTTP. Pushed to the private origin after the final check.
- **Next build IN PROGRESS** (Nov 6 late; Tony: "Go ahead and get started. Before the review stop and let me know so I can change to fable"). Tony chose Closing Ledger, Continuity Receipt, Case Docket (design/sale-proof/DECISION.md, defaults for the 4 open questions there). DONE and committed: Continuity Receipt 6a28793 (/sales/:id/proof, close snapshot, sources, 2-provider agreement, receipt + scripts/verify-receipt.ts; demo controls on :8821 /sale/accept-both, /use/signalwatch, /provider-b/disagree|agree); Closing Ledger bcefc28 (inventory, signed Gated readiness); Case Docket 15622db (npm run attacks, /attacks); contracts a7c994b asset-key (Chain Signatures, gen-N path) + test-signer, 7d64675/e2cfc10 spend-allowance, both tested on a local node with real business-v3; e20e16b server/src/evm.ts (same bytes as the contract); 8f41905 companions in the app (ledger rows, first-shift move/re-grant, /desk/:id/allowance, demo Signalwatch feed + budget); 3a7744a /sales/:id/economics; d14bf2b /proof/ledgerline (recorded testnet run in the proof layout); light-client proof (server/src/lightClient.ts, scripts/verify-light-client.ts [--live], data/evidence/light-client-close.json: the recorded close tx and closing receipt proved against a later head; shown on /proof/ledgerline since 4b6167b); attack suite 35515d8/3d4622a now 21 attacks incl. 6 companion cases + 5 planted faults. Tony's answers (Nov 7): G 402 = agent pays from its OWN account as its own customer (customer pre-auth judged too much design); D download APPROVED. Docker INSTALLED (Tony ran it Nov 6 evening; server 29.1.3, tony in docker group). D DONE (see docs/INTENTS.md): verifier built from NEAR source (contracts/defuse 0.4.5 at 32cd1f9, non-reproducible, sha256 3ca782c5...ace2; the prebuilt releases/defuse-0.2.10.wasm reports 0.2.9 with no build info, NOT used); contracts/intents-funding local-node test (nearcore 2.14.0) runs the whole flow and 8 failure/attack cases with real business-v3; NEP-413 bytes match NEAR's Rust tooling (vector in both test suites); server/src/intentsFunding.ts (stages quoted/deposited/swapped/delivered/funded, failures expired/refused/refunded/unknown resolved by spent nonce), routes /api/sales/:id/intents[/quote], /api/intents/:id[/sign]; server/test/intents-chain.ts synthetic verifier, tALT, solver; web/src/pages/IntentsFunding.tsx in the Closing Ledger escrow card (buyer only); demo wired (Noah holds tALT); attack suite now 25 cases (4 intents). Reproducible verifier build DONE (sha256 257b53c5...93c8, 1,297,007 bytes; local-node test passes with it). G DONE: HTTP 402 on customer prepare (src/paymentOffers.ts; agent signs in with its own account, pays from it; units only from units_bought), owner page /desk/:id/agent-purchases, demo agents (scripts/lib/demo/agents.ts), docs/design/AGENT_ACCESS.md section. Nov 6 evening: author email rewritten to 335249403+CoderofVibes@users.noreply.github.com on all commits (Tony chose; backup C:/Dev/everstreet-before-email-rewrite.bundle; old->new in data/evidence/commit-map.tsv); repo pushed to PRIVATE GitHub CoderofVibes/everstreet (Tony: push fine; public later when ready). Reproducible builds DONE (docs/BUILDS.md, commit aff17cf; wasm copies in WSL target/near and ~/everstreet-builds). Sepolia test key .evm-credentials/sepolia-deployer.json (0xC3b8195b6B7913f11A196C0A4017ED95Ee90dEa8, 0.05 test ETH from Tony via Google faucet). SERIES 3 (Nov 6 night, in progress): root topped up from faucet accounts everstreet-fund-6..10 (spend file data/runtime/rehearsal-spend-s3.json, ceiling 45, ~42.2 used). DONE on testnet with the reproducible business-v3 (code hash H1bHmRMX...): Direct (ledgerline-v3-3b; first attempt ledgerline-v3-3 stopped on an RPC 500 that lost a landed purchase hash, record in data/evidence/v3-series-3-stopped/; liveEnv.wallet now uses sendAs), Gated (ledgerline-gated-v3-3), recovery (ledgerline-payout-v3-3; resumed once: shared buyer ran short of tUSD; resume now skips recorded steps); all three verify --live. Series 2 records moved to data/evidence/v3-series-2/. Light-client proof regenerated by NEW scripts/light-client-close.ts (verifies --live). NEW: configured-mode companions + intents (appConfig `companions` {evm Sepolia only, bindings} and `intents` {verifier, solver key file, bindings}; server/src/evmRpc.ts EvmRpcPort reads at Sepolia "finalized"; server/src/solverRpc.ts TestnetSolver; v3rpc allows the verifier's 5 views); Sepolia registry hand-assembled in scripts/lib/feedRegistry.ts (tested in a mini EVM, server/test/feed-registry.test.ts), deployed 0x888188bc8e06c2f05d29092c1745fa5337736cfd. LESSON: Sepolia now prices new state far higher (creation ~690k gas, transfer to a fresh address >21k, first publish ~130k): always estimate and check receipt status. scripts/series3.ts setup-ext / setup-intents done (feed-key-v3s3, budget-v3s3, intents-v3s3 verifier 3XKA3x..., talt-v3s3, solver-v3s3, noor-v3s3); run-ext DONE (record data/evidence/v3-ext-testnet.json, 48 steps, resumed once after the solver's answer was lost and recovered by spent nonce; final: noor-v3s3 owns at gen 3, registry controller = gen-3 address finalized, allowance granted for gen 3). Attack pairs DONE (7 cases, data/evidence/attack-pairs-testnet.json, shown on /attacks). SERIES 3 COMPLETE and committed 44e2391 (full check exit 0: 1863+1skip/12/70), pushed to private GitHub. NEXT: Tony switches to Fable for the fresh reviews. README testnet section still says series 2: Tony (Nov 6): leave the README until the Fable full review and its fixes are done; then Tony, Astra and Claude do the README together. STOP before the fresh Fable reviews and tell Tony. Private plan: session scratchpad everstreet-execution-plan-nov6.md (never in repo).
- **Astra's three checks DONE** (Nov 6, Tony: "do the whole job"; 482486e): sandbox test contracts/business-v3/tests/sandbox.rs (on_payout <= 2.4 of 10 TGas, no contract change; evidence data/evidence/v3-sandbox-payouts.txt); cold permissions review (reports/2026-11-06_permissions-review.md; High fixed: V3Intents.watchPass every 15 s in compose and demo, Direct only; sale room narrowed for past participants; 29 tests server/test/permissions-review/); series 2 on testnet (new accounts *-v3s2 / ledgerline-*-v3-2, code hash 3Ptn4B..., all three examples complete; series 1 in data/evidence/v3-series-1/; faucet accounts everstreet-fund-4/5 topped up the root; series spend 16.73/20; reads through dRPC). README opening per Astra's order; `npm run demo`. Judge rehearsal (cold, fresh clone) brief reports/2026-11-06_judge-rehearsal-brief.md.
- **Judge demo items DONE** (Nov 6, Tony: "Yes, build them"): synthetic wallet account picker (GET /__harness/accounts, POST /__harness/use-account in scripts/demo.ts; picker in WALLET_SCRIPT, shown only when a harness lists 2+ accounts); sale kind `owner_probe` (former seller appoints self, contract refuses E_NOT_OWNER; FormerOwnerCheck card on SaleRoom; test in sale-journey); FirstShift card for the v3 new owner; chainWords() says "the synthetic chain" under a harness; README route + docs/FEATURES.md. Launch config "demo" runs tsx directly: run `npx vite build --config web/vite.config.ts` after web edits.
- **Contract attack review DONE** (Nov 6, Tony asked): cold Fable 5.1 reviewer on contracts/business-v3 (brief reports/2026-11-06_attack-review-brief.md, report reports/2026-11-06_attack-review.md): 0 critical/high/medium, 4 low fixed (sponsor rule in unregister; customers capped at 14 payout slots; new refuses self as owner/token/closer), reviewer tests kept as src/attack_tests.rs (195 contract tests). Sale page marks a seller kept as operator; no expiry warning while closing. Safety case draft docs/SAFETY_CASE.md; Astra debrief docs/astra/reports/2026-11-06_ReviewDebrief.md. NEXT (Tony to confirm): sandbox breaks incl. on_payout gas measurement; then screens-vs-testnet comparison. Contract fixes need a new testnet business account at the next rehearsal.
- **First-use review FIXED** (Nov 5-6): 78 of 81 fixed (5e47252, e96a82d, 6139da8, c4bd45c); 3 carry-overs from the interrupted first run: restart the demo before each review.
- **Portfolio owner pass BUILT** (Nov 5 late, Tony): no narration on product pages (labels, values, actions; (i) only where a term is not obvious). /portfolio: "Acquisitions in process" (rows, each expands to steps Proposed · Escrow funded · Accepted · Buyer accepted · Ownership; acceptance "In process" with an info tip; nothing repeated from the row); a Costs section in USD (customer use, testing, unbilled, tokens, operating, network fees not recorded; compute by business; model, per call, per delivered, budget this month, build); business cards open /portfolio/:id in a new tab (description, performance, clients, compute, operating costs, operations). Server: GET /api/me/dashboard adds compute and operating_costs; GET /api/me/dashboard/businesses/:id adds clients and about. Demo records fictional operating costs. MIT LICENSE added (Tony chose MIT). NEXT: phase 2 (history secrets scan), then phase 3 (cold Fable first-use review of the whole site).
- **Step 7 dashboard BUILT** (Nov 5 late): Fable made three mockups (design/dashboard/a,b,c); **Tony chose C with changes** (design/dashboard/DECISION.md: handover prominent while it needs a decision; one larger chart switching portfolio/single business; short cards). Built on /portfolio: web/src/pages/Dashboard.tsx + web/src/dashboardView.ts, test web/test/dashboard.test.tsx; businesses now carry a tagline. Browser pass on the demo at 1440 and 375 (no sideways scroll). NEXT: Fable visual pass on the real page; Astra review row; then step 8.
- **Step 7 data side BUILT** (5cc3c26): `npx tsx scripts/demo.ts` (launch config "demo", port 8820, controls 8821) runs Delphine Marsh's 30 simulated days through the real routes (138 requests; Ledgerline v2, Priya joins Relaydesk, rehearsal, Signalwatch sale funded) and serves it with synthetic-wallet sign-in. Dashboard data: GET /api/me/dashboard (server/src/dashboard.ts). NEXT: Fable mockups (2-3 directions, screenshots desktop+phone) for Tony to choose; then the real dashboard page.

- **Step 7 data plan written:** docs/design/DEMO_ACCOUNT.md (founder Delphine Marsh, chosen Nov 5 after Tony asked for another name than Marisol Teague; 3 businesses, Signalwatch mid-sale; 30 simulated days through the real flows; synthetic chain needs a multi-contract router; one portfolio dashboard read before visual work). Building next.

- **Step 7 design process (Tony, Nov 5 late):** Fable (separate agent, model fable; this session stays Opus 5.5) starts from Tony's mockup, Astra's visual direction, styles.css and the dataviz rules; makes 2-3 static directions with fictional data, renders and screenshots them (desktop + phone) and revises; **Tony chooses the direction himself**; then it is built on the real simulated history and Fable does the visual pass on the real pages. Data side first.

- **006c successor rehearsal BUILT (plan step 6, part 2)** (db92082): docs/design/SUCCESSOR_REHEARSAL.md (§5 as built). Plan step 6 is complete; both parts returned for Astra review. NEXT: plan step 7 (the demo account with the fictional founder and the rich dashboard; Fable for its visual design).

- **Team and cooperative authority BUILT (plan step 6, part 1)** (195f19b): docs/design/TEAM_AUTHORITY.md (§5 as built). Business teams (invite by account, accept, case worker/viewer on the case board, revoke, sale ends the team) and buying-team representative, positions and history. Returned for Astra review in JOBS.md. NEXT: 006c successor rehearsal (plan step 6, part 2).

- **006a web apps BUILT (plan step 5)**: see docs/design/WEB_APP_RELEASE.md §7 "as built". Free access at a stable address or an N-day pass (one unit, charged when access starts) pinned to the bought release; update, rollback, withdrawal; real releases closed until the worker passes, stand-ins labelled (harness/tests only). Evidence: web-app-release.test.ts, web-app-sale.test.ts, webAppPass.test.tsx; harness `--product quote-app`. Commits 59d1de9, 3c6f8d1; browser pass done (limits in JOBS.md); 006a returned for Astra review. NEXT: plan step 6 (team/co-op ownership, then 006c).

- **Astra's three correction jobs returned for review** (Nov 5 late): 006b2 session boundaries (d502c78), Relaydesk versioned cases + bounded compiler (d3fb77f), amount provenance (9412446), and the Stage C browser pass fixes (fc9165a) on the new relaydesk harness (`--product relaydesk`). Browser limits recorded in JOBS.md (no real browser zoom or reduced-motion emulation in the pane). NEXT after Astra's review: 006a web apps (plan step 5).

- **Signalwatch built end to end (plan step 4)** on the analysis engine (docs/design/AGENT_ANALYSIS.md, §7 "as built"): an agent service compiles to an immutable `analysis_spec` (no build model); requests run on the AI runtime with a fixed analysis request (`analysis-prompt/1`) and closed schema; `analysis-validator/1` refuses any flag whose evidence is not a verbatim quote of the submission; 5 required checks; one unit per delivered analysis (also when nothing is flagged), refusals returned, malformed submissions refused before sending. Studio compile/Try/checks, customer form + flags answer, /example/signalwatch tryable (stand-in, drift-tested). Evidence: configured-child journey (checks 5/5, delivered + refused + restart + quiet + Direct sale + buyer serves). Stand-in analyst only: NO real model run (spending needs Tony). NEXT: Astra's three correction jobs (006b2 P0, Relaydesk versioned cases P0, amount provenance P1), then 006a.

- **Relaydesk built end to end (plan step 3)** on Everstreet's own workflow engine (docs/design/WORKFLOW_ENGINE.md, §8 "as built"). There is no model and no generated code. A SaaS workflow revision compiles to an immutable `workflow_spec` in the request, with no budget. Required engine checks need no model. Release, offer and customer requests work as before (1 unit per accepted request; refused requests are returned). Each accepted request opens one case. The current owner moves it one stage at a time, every move is append-only, and the customer sees the history. After a sale, the buyer works the cases. Studio: Compile button; workflow-aware Service tab (Try, checks, no budget). Desk: case board. Customer: request form and case track. Showcase: /example/relaydesk is tryable (the real engine decides in advance; drift test). Evidence: the process journey (server/test/relaydesk-journey-process.test.ts) runs in the configured child. It covers 1 refused + 2 accepted requests, a restart (no double case or charge), a Direct sale, the buyer working cases with the seller refused, and ZERO model calls. Browser (scratch preview, port 8811): sample page, Studio compile, Try, checks 6/6, release, desk board. NOT checked in a browser: the customer purchase and request path, which needs a configured chain (the process test covers it). NEXT: Signalwatch (plan step 4).

- Showcase: corrected spec docs/design/SHOWCASE_SPEC.md; stage A (6ab958f, 5052685) and stage B (e1e5848) built and checked (1685/12/66). Live on the scratch preview (everstreet-scratch, port 8811): homepage rail sample panel, Example businesses, /example/ledgerline. NEXT per Astra: stage C needs the Relaydesk and Signalwatch engines (product-type framework), then 006a, team/co-op + 006c, then stage D (demo account; Fable for its visual design).

- **ALL FOUR business-v3 examples VERIFIED ON NEAR TESTNET** (Nov 5 evening): Direct (6a4d8c8),
  Gated (aee32f1), lost purchase response + failed token payout (344ca90); README d40134f. Spend
  16.73 of 20 testnet NEAR (root everstreet.testnet ~6.2 NEAR left). Evidence data/evidence/
  v3-{direct,gated,recovery}-testnet.json (+ setup files); verify with scripts/verify-rehearsal.ts.
  Operational lessons: FastNEAR free tier 429s -> later runs used dRPC
  (NEAR_RPC=https://near-testnet.drpc.org); dRPC 500s on FINAL-waiting sends -> the script wallet
  now signs first (hash known), sends async, polls final status, re-broadcasts the same bytes;
  an exhausted settle stays unknown by design (writer history proves nothing) -> after the
  contract's settle deadline anyone may release_hold_for (the customer did; recorded as an
  operator note); explorer API listed no activity -> the original hash was found by reading
  public blocks (scratch script, not in repo). Runtime dirs data/runtime/rehearsal-* hold the
  run DBs and device keys (gitignored). NEXT (Astra's order): showcase proposal corrections job,
  then the homepage with Ledgerline, engines, 006a, team/co-op, Fable for the dashboard (step 7).

- **Example 1 (Direct) VERIFIED ON NEAR TESTNET** (6a4d8c8; evidence data/evidence/v3-direct-testnet.json,
  setup v3-setup-testnet.json; `npx tsx scripts/verify-rehearsal.ts <file>`). Spend 6.35 of 20 testnet
  NEAR (root started at 22.89 after two faucet accounts everstreet-fund-1/2). Tooling:
  scripts/v3-rehearsal.ts (setup-direct, run-direct, resume-direct), scripts/rehearsal-child.ts
  (real RPC + labelled stand-in model), scripts/lib/rehearsal/{journey,evidence}.ts; dry run
  server/test/rehearsal-driver.test.ts. Lessons: FastNEAR free tier rate-limits (429 -> app
  read_failed/read_unavailable): keep maintenance at 20 s, retry only read-only or idempotent-key
  routes; persist the device key (data/runtime/.../device-key.pem); seller/buyer token registration
  done in setup makes "register" already satisfied. NEXT: tooling for examples 2 (Gated, fresh
  business + closer FC key), 3 (one-answer drop relay between app and RPC), 4 (separate
  unregistered seller), dry-run each locally, then run live; then README rows.

- **NEAR proof (Tony, Nov 5 evening):** Tony's private handoff (docs/research/near-hackathon/
  analyses/2026-11-05_CLAUDE_NEAR_PROOF_START.md, git-ignored; do NOT open the sibling
  near-depth-handoff.md: outdated, Tony said skip it). Decisions Tony delegated to Claude: NEAR
  preparation right after the evidence-and-presentation job (before showcase corrections);
  read-only testnet RPC queries allowed in preflight; script-held fictional testnet accounts
  (keys only in .near-credentials/), with Tony's explicit approval of the exact plan (budget,
  signing steps, fault injection) before ANY deployment, signing or spending. Order: keyless
  preflight + local rehearsal of all four examples (Direct, Gated, lost purchase response,
  failed token payout) -> approval packet -> Direct live -> review -> Gated + recovery cases.
  Research notes stay out of tracked/public material. Opus 5.5 throughout.
- Evidence and presentation job: browser pass done (see JOBS row). README.md has uncommitted
  v3 example rows NOT written by Claude (author unknown; asked Tony).

- Astra's assessment (docs/astra/2026-11-05_IndependentBuildAssessment.md, committed 244388d) is
  the disposition. Tony: start her correction jobs in her order (006b1, then review evidence and
  presentation, then showcase corrections), Opus 5.5; **Fable for step 7** (the full demo +
  dashboard visual design). Her revised order (section 3) replaces the plan's order below.

- Phases done this session: A (flagship journey, writer history, rehearsal packet), B (Checks
  evidence + manual checks; 002f1 stage 1), C (004b), D (005e economics, 005c expert help,
  005d portfolio), F part (003x control sheet + record + verifier).
  Then Phase G polish (729a4d5) and 006b agent access + MCP 2026-07-28 (4a9300e).
  Remaining (Nov 5 evening): 006a web-app customer release, Relaydesk and Signalwatch engines,
  M6 team/co-op, 006c rehearsal records, showcase/demo. Done since: restart matrix and Gated
  journey (13b2c8c), 006b1 (0b5a6f4), readable amounts and evidence corrections (this job).
  Review packet: docs/astra/reports/2026-11-05_bulk-build-review.md.
- Scratch preview `everstreet-scratch` (port 8811, data/runtime/scratch-review*.db) may be running.
- Running: the sale review harness in the preview pane (`sale-harness`, ports 8814/8815, 90-min
  self-stop). Stop it with preview_stop when browser work ends.
- Approval carried, not executed: synthetic device enrollment for fictional Dana in the in-memory
  localhost preview, one invoice use (HANDOFF_STATE).

## Commits this session

| Commit | What |
|---|---|
| a0bbde8 | Astra pause note + handoff packet (reviewed, docs) |
| ac6831e | Flagship 100/20/80/79 journey in one configured child; harness finalBlock budget record |
| 519ca1a | 003wf slice 3: operators' unresolved writer history (list, own-hash check, audit) |
| 8cb4c74 | Checks states real build/evaluation/release; manual checks; draft-never-alters proof; rehearsal packet |
| 56cd3b0 | 002f1 stage 1: worker readiness corrections in the repo (no host touched) |
| 7fa6deb | 004b connected source inspection (read-only, pinned commit, immutable reports, compare) |
| 7641da5 | Gate new owner routes during a managed handover; classify every new mutation route |
| 41223ba | 005e operating economics + recovery in Operate (per asset, no conversion or profit) |
| 20d8a56, 291388c | 005c expert help (profiles, directory with stated reasons, private requests) |
| d7cd760 | 005d portfolio; 003x control sheet, portable record (v1, digests), offline verifier |

## Evidence (builder-verified; independent review pending)

- Full `npm run check` at ac6831e: exit 0; 1606 passed / 1 skipped; protected 12; process 60.
- Full check at 7fa6deb: 1 failure (route guard: 5 new mutation routes unclassified) -> fixed
  in 7641da5 (gated + exercised during an actual closing).
- Full check on the portfolio tree (just before d7cd760): exit 0; 1653 passed / 1 skipped;
  protected 12; process 60. 003x added after: its tests + route guard pass (11).
- Flagship journey (`flagship-journey-process.test.ts`, ~10 s, SYNTHETIC chain/wallet/model):
  founder build/eval/release/plan/grant/offer; fresh customer buys 100, 20 delivered+charged
  (ops 20/20, compute recorded); Direct sale closes with reconcile; 80 at close; result 1 same;
  seller denied; 79; a use during the buyer's unreleased draft runs on the released artifact;
  buyer release+offer; use on the update (77); durable rows per use; 23 charges; stop exit 0.
- Real browser (built-in, 1280x800, synthetic harness): 003wf4 lost answer -> wrong ID refused ->
  reload -> original ID confirms plan -> offer review pre-filled; Studio Checks shows build,
  10/10 evaluation, release; a manual check recorded.
- Writer history: 14 unit + 1 production-composition test. 002f1: setup-harness all pass,
  conformance self-test, conformance-memory tests (5).

## Browser findings still to fix (Phase G)

1. Offer review/lists and customer pages lead with base units; plan step shows 0.15 TUSD.
2. Studio tab not in the URL (reload returns to Preview).
3. Wrong-ID refusal shown under "Read again", away from the ID field.
4. Raw `no_active_offer` in "Service checks not yet passing".
5. Recovery panel order ("Check it" before the ID field).
6. Unnamed buttons in the Studio progress strip.
7. Checks cards are narrow at 1280 with the companion open.

## Gaps known (not built yet)

- M2: only AI API and web-app bundles execute; no shared functional/prototype label; web-app
  bundles have no customer release (006a).
- 006a web-app customer release; 006c rehearsal records; M6 team/co-op. (006b built; its
  corrections 006b1 await Astra's review.)
- Live GitHub connection (needs Tony's authorization + a read-only token).
- 002f1 stage 2 (host) needs Astra dispatch; VMM pressure method needs review.

## Decisions for Tony (batched at the end)

- External rehearsal packet decisions (docs/design/EXTERNAL_REHEARSAL_PACKET.md): deploy v3 or
  not and NEAR budget; provider spend ceiling; who operates wallet steps; Gated in scope.
