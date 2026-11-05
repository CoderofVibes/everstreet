# Claude resume note (direct build, November 5 2026)

Sole current execution note for Tony's direct build (handoffs/2026-11-05). Updated in place.
Builder: Claude Code, claude-opus-5-5, high, subscription. Astra's automatic goal stays paused.

## Now

- Phases done this session: A (flagship journey, writer history, rehearsal packet), B (Checks
  evidence + manual checks; 002f1 stage 1), C (004b connected source), D part 1 (005e economics).
  Next: 005c expert help (none exists), 005d portfolio, then E (006a), F (003x, 006b, 006c), G.
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

## Evidence (builder-verified; independent review pending)

- Full `npm run check` at ac6831e: exit 0; 1606 passed / 1 skipped; protected 12; process 60.
- Full check at 7fa6deb: 1 failure (route guard: 5 new mutation routes unclassified) -> fixed
  in 7641da5 (gated + exercised during an actual closing); focused suites since. Full check due.
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
- 004b GitHub adapter; 005c expert help; 005d portfolio; 006a; 003x sheet/record/verifier;
  005e economics view; 006b machine API/MCP; 006c rehearsal records; M6 team/co-op.
- 002f1 stage 2 (host) needs Astra dispatch; VMM pressure method needs review.

## Decisions for Tony (batched at the end)

- External rehearsal packet decisions (docs/design/EXTERNAL_REHEARSAL_PACKET.md): deploy v3 or
  not and NEAR budget; provider spend ceiling; who operates wallet steps; Gated in scope.
