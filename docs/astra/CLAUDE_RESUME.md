# Claude resume note (direct build, November 5 2026)

Sole current execution note for Tony's direct build (handoffs/2026-11-05). Updated in place.
Builder: Claude Code, claude-opus-5-5, high, subscription. Astra's automatic goal stays paused.

## Now

- Active phase: A (flagship journey) -> moving to the browser/visual findings, then phases B-F.
- Running: the 003wf4 sale review harness via the preview pane (`sale-harness`, port 8814/8815,
  90-minute self-stop). Stop it with the preview tools when browser work ends.
- Approvals carried: synthetic device enrollment for fictional Dana in the in-memory localhost
  preview, one invoice use (HANDOFF_STATE). Not yet executed.

## Done this session

| Item | Evidence |
|---|---|
| Astra pause note + handoff packet reviewed, committed | a0bbde8 |
| 003wf4 finalBlock exhaustion (Astra 06:28) recorded; per-budget wording; sale-chain budget watched | `sale-harness-recovery.test.ts` (2 new tests fail before, pass after) |
| 003wf4 B gates in a REAL browser (built-in browser, 1280x800, harness): lost answer -> "unknown, recover by its own ID"; wrong ID refused, nothing recorded; reload keeps the unresolved request as the step; original ID confirms plan 2 with readback; "Review the offer for plan 2" pre-fills and focuses the plan field; inspection still required | builder-verified (browser); independent review pending |
| Flagship 003wf parent journey in ONE configured child: founder revision, budgets, build, 10-case evaluation, release, plan, grant, offer; fresh customer buys 100, 20 uses delivered+charged (ops 20/20, compute recorded, none unknown); Direct sale propose/register/fund/accept/close+reconcile; 80 at close; result 1 identical; seller denied; 79 after the buyer's use; buyer's revision/build/eval/release/offer; use on the update (78); durable rows show release/artifact/owner generation per use; 22 charges; graceful stop exit 0 | `server/test/flagship-journey-process.test.ts` (~10 s), SYNTHETIC chain/wallet/model |

## Browser findings to fix (Phase G polish; observed at 1280)

1. Offer review/list and customer pages lead with "150000 base units of tusd.near"; plan step says
   "0.15 TUSD". Readable amount first, exact base units in details (CustomerOffers, PublicPage,
   CustomerProduct, PurchasePanel, DeskDigital).
2. Studio tab (Service > Customer access) is not in the URL; reload returns to Preview.
3. Wrong-ID refusal text renders under "Read again", away from the ID field.
4. Raw code `no_active_offer` shown in "Service checks not yet passing".
5. Recovery panel order: "Check it" button sits before the ID label/field.
6. Unnamed buttons in the progress strip (accessibility tree shows no name).

## Gaps found (not yet built)

- Books' monthly revenue ignores token-denominated customer charges (20 x 0.15 TUSD shows
  revenue 0, basis none). Operations has usage/cost. -> 005e economics.
- Phase B inventory: only AI API + web-app bundle execute; no customer release path for web-app
  bundles (006a); no shared functional-vs-prototype label; no recorded manual evaluation; no
  end-to-end "draft edit after release leaves served product unchanged" test; 002f1 corrections
  1-5 all missing (repo parts possible; host proof needs a dispatched host step).
- Phases C-F: 004b GitHub adapter missing; 005c entirely missing; 005d portfolio missing;
  006a customer release of bundles missing; 003x sheet/record/verifier missing; 005e unified
  economics + recovery view missing; 006b machine API/MCP missing; 006c rehearsal records missing.

## Open (retained, not claimed)

Restart/concurrency matrix around the full journey, writer-history (needs_reconciliation /
legacy_invalid) operator workflow, Gated at its boundaries in the journey, external rehearsal
packet, zoom/reduced motion/screen reader, 390/1440 passes, device enrollment in browser.

## Checks

- Focused: flagship + harness recovery + plan-setup process: 3 files, 11 tests pass. tsc exit 0.
- Full `npm run check` not yet run this session.
