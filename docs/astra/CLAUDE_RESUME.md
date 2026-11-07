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

- **Next build IN PROGRESS** (Nov 6 late; Tony: "Go ahead and get started. Before the review stop and let me know so I can change to fable"). Tony chose Closing Ledger, Continuity Receipt, Case Docket (design/sale-proof/DECISION.md, defaults for the 4 open questions there). DONE and committed: Continuity Receipt 6a28793 (/sales/:id/proof, close snapshot, sources, 2-provider agreement, receipt + scripts/verify-receipt.ts; demo controls on :8821 /sale/accept-both, /use/signalwatch, /provider-b/disagree|agree); Closing Ledger bcefc28 (inventory, signed Gated readiness); Case Docket 15622db (npm run attacks, /attacks); contracts a7c994b asset-key (Chain Signatures, gen-N path) + test-signer, 7d64675/e2cfc10 spend-allowance, both tested on a local node with real business-v3; e20e16b server/src/evm.ts (same bytes as the contract); 8f41905 companions in the app (ledger rows, first-shift move/re-grant, /desk/:id/allowance, demo Signalwatch feed + budget); 3a7744a /sales/:id/economics; d14bf2b /proof/ledgerline (recorded testnet run in the proof layout); light-client proof (server/src/lightClient.ts, scripts/verify-light-client.ts [--live], data/evidence/light-client-close.json: the recorded close tx and closing receipt proved against a later head; shown on /proof/ledgerline since 4b6167b); attack suite 35515d8/3d4622a now 21 attacks incl. 6 companion cases + 5 planted faults. Tony's answers (Nov 7): G 402 = agent pays from its OWN account as its own customer (customer pre-auth judged too much design); D download APPROVED. Docker INSTALLED (Tony ran it Nov 6 evening; server 29.1.3, tony in docker group). D DONE (see docs/INTENTS.md): verifier built from NEAR source (contracts/defuse 0.4.5 at 32cd1f9, non-reproducible, sha256 3ca782c5...ace2; the prebuilt releases/defuse-0.2.10.wasm reports 0.2.9 with no build info, NOT used); contracts/intents-funding local-node test (nearcore 2.14.0) runs the whole flow and 8 failure/attack cases with real business-v3; NEP-413 bytes match NEAR's Rust tooling (vector in both test suites); server/src/intentsFunding.ts (stages quoted/deposited/swapped/delivered/funded, failures expired/refused/refunded/unknown resolved by spent nonce), routes /api/sales/:id/intents[/quote], /api/intents/:id[/sign]; server/test/intents-chain.ts synthetic verifier, tALT, solver; web/src/pages/IntentsFunding.tsx in the Closing Ledger escrow card (buyer only); demo wired (Noah holds tALT); attack suite now 25 cases (4 intents). Reproducible verifier build DONE (sha256 257b53c5...93c8, 1,297,007 bytes; local-node test passes with it). G DONE: HTTP 402 on customer prepare (src/paymentOffers.ts; agent signs in with its own account, pays from it; units only from units_bought), owner page /desk/:id/agent-purchases, demo agents (scripts/lib/demo/agents.ts), docs/design/AGENT_ACCESS.md section. NEXT: reproducible business-v3 + companions rebuild; testnet series 3 (EVM test gas from Tony, real MPC request shape checked against v1.signer-prod.testnet, verifier deploy needs ~13+ NEAR storage). STOP before the fresh Fable reviews and tell Tony. Private plan: session scratchpad everstreet-execution-plan-nov6.md (never in repo).
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
