# Direct build review packet: November 5, 2026

Claude Code (claude-opus-5-5, high, subscription), under Tony's direct build instruction
(handoffs/2026-11-05). Local software only:
- nothing was pushed, deployed, signed for real, spent or published;
- no real customer data was used;
- no live provider or GitHub call was made;
- Day One and the research library were not touched.

Every person, account and business is fictional. Astra's automatic goal stays paused.

**Statuses.**
- **Implemented:** code is in the repo.
- **Builder-verified:** I ran the evidence named.
- **Independent review pending:** Astra hasn't reviewed it.
- **External integration pending:** it needs a live account, deployment or host.

Nothing below is independently accepted. No milestone is complete.

## Commits (in order)

| Commit | What |
|---|---|
| a0bbde8 | Astra's pause note and the handoff packet, reviewed and committed (docs only) |
| ac6831e | **Phase A:** the flagship 100/20/80/79 journey in one configured child process; the 003wf4 harness's `finalBlock` budget gap fixed |
| 519ca1a | 003wf slice 3: the operators' unresolved writer-history procedure |
| 8cb4c74 | **Phase B:** Checks states real build/evaluation/release evidence; recorded manual checks; draft-never-changes-the-product proof; external rehearsal packet (prepared only) |
| 56cd3b0 | 002f1 stage 1: worker readiness corrections in the repository (no host touched) |
| 7fa6deb | **Phase C:** 004b connected source inspection |
| 7641da5 | The new owner routes are gated during a managed handover; every new mutation route is classified |
| 41223ba | **Phase D:** 005e operating economics and recovery |
| 20d8a56, 291388c | 005c expert help |
| d7cd760 | 005d portfolio; **Phase F:** 003x control sheet, portable handover record, offline verifier |
| 729a4d5 | **Phase G:** polish from the real-browser review |
| 4a9300e, 2234ca0 | 006b agent access: customer-granted narrow access, plain API and MCP 2026-07-28 |

## Checks (exact)

- Full `npm run check`:
  - at ac6831e: exit 0; main 1606 passed / 1 skipped; protected 12; process 60;
  - at 7fa6deb: one failure, the route-classification guard (5 new routes unclassified). Fixed
    in 7641da5, where the routes are now refused during an actual managed closing;
  - on the tree just before d7cd760: exit 0; main 1653 passed / 1 skipped; protected 12;
    process 60.
- After that check:
  - the 003x and Phase G changes ran their focused suites: handover-record 3, portfolio 2,
    expert-help 3, handover-routes, and all 65 web test files (539 tests);
  - tsc, biome (only the known `useMathMinMax` warning in handoverCoordinator.ts) and the web
    build pass.
  - The full check after the packet commit: exit 0; main 1656 passed / 1 skipped;
    protected 12; process 60.
  - 006b was added after that check: agent-access 3 + the route guard pass, plus tsc, biome and
    the web build. **A last full check runs at the end (result below).**
- Real browser: Claude's built-in browser pane, Chromium, mostly 1280x800, two at 390, against
  synthetic harnesses only. No 1440 pass, keyboard-only traversal, zoom, reduced motion or screen
  reader pass was done; those stay unverified.

## Requirement and evidence matrix

### Phase A: flagship journey (003wf parent, M3)

| Requirement | Status | Evidence |
|---|---|---|
| Founder creates the product in the configured composition: revision, budgets, build, evaluation, release, plan, reviewed metering grant, offer | implemented, builder-verified | `flagship-journey-process.test.ts`: one configured child; only the founder and business shell are seeded |
| Fresh customer registers and buys 100; 20 delivered and charged; operations and compute recorded | builder-verified | Ops 20 requested / 20 charged / 20 usable; customer compute 20 calls, none unknown; 20 open_hold + 20 settle_hold |
| Direct sale propose → register → fund → accept → close, reconciliation applied | builder-verified | Same test; contract control → buyer, generation 2 |
| 80 at close; 79 after the buyer's next use; same result identity; former owner denied; buyer manages | builder-verified | Same test |
| A draft never changes the served product; the buyer's reviewed update reaches the same customer | builder-verified | A use during the buyer's unreleased build runs on the released artifact; the update's release and offer serve the next use (77 left); durable rows show release, artifact and owner generation per use |
| Economics agree (earned 3 000 000, prepaid 15 000 000, 80 owed = 12 000 000) | builder-verified | Same test (005e) |
| Writer-history operator workflow | implemented, builder-verified | `writer-history*.test.ts` (unit + production composition) |
| 003wf4 browser repeat: lost answer → wrong ID refused → reload → original ID → offer handoff | builder-verified in a real browser | Resume note; the recovery panel was then reordered (Phase G) |
| Restart/concurrency matrix around the whole journey; Gated close inside the journey | **open** | Existing 003wf2/3/4 process matrices only |
| External testnet rehearsal | prepared only, external integration pending | `docs/design/EXTERNAL_REHEARSAL_PACKET.md` |

Everything in this phase is synthetic chain, wallet and model. It is not live NEAR or provider
evidence.

### Phase B: creation and execution (M1/M2, 002f1)

| Requirement | Status | Evidence |
|---|---|---|
| Checks state the saved revision's real build, evaluation, release and observed use | implemented, builder-verified (browser) | `studio-checks-evidence.test.ts`; Studio at 1280 |
| Manual checks recorded (self-reported, append-only) | implemented, builder-verified (browser) | Same |
| 002f1: boot readiness, memory evidence, test-only orphan procedure, explicit VMM gate, ACL removal with rollback | implemented in the repository, builder-verified (host-free) | `setup-harness.sh` all pass; `conformance --self-test`; `conformance-memory.test.ts`; `docs/design/WORKER_READINESS_002F1.md` |
| Real-host worker conformance | **external integration pending** (needs Astra's dispatch of a host step) | Not run; the worker engine stays disabled |
| More product families running (SaaS workflow, agent, portal); web-app customer release (006a); a shared functional-vs-prototype label | **open** | |

### Phase C: connected import (M4, 004b)

| Requirement | Status | Evidence |
|---|---|---|
| Connect, read at a pinned commit, immutable report, recheck with comparison, disconnect | implemented, builder-verified (browser at 1280 and 390, fictional fixture) | `source-connect.test.ts` (7), `imports-source.test.ts` (6) |
| Scope before reads; owner fence; buyer refused the seller's connection; honest failures; observed vs claimed, never verified | builder-verified | Same |
| A live GitHub connection | **external integration pending** (Tony's authorization and a read-only token) | |

### Phase D: operating network (M5)

| Requirement | Status | Evidence |
|---|---|---|
| 005e economics: per asset, exact units, pending, prepaid vs earned, obligations, cost per success only when every cost is known, recovery list, no profit across currencies | implemented, builder-verified (browser) | flagship journey, `economics.test.ts` (unknown, never negative) |
| 005c expert help: opt-in self-reported profiles, directory with stated reasons, exact preview, private requests, state machine, idempotency, no granted authority, pause on a sale | implemented, builder-verified (browser at 1280) | `expert-help.test.ts` (3) |
| 005d portfolio: owned / considering (anonymous stays anonymous) / former (history only), attention, private notes | implemented, builder-verified (browser) | `portfolio.test.ts` (2) |
| Delegated operators beyond the existing helper role; living person profiles for non-owners | **open** | |

### Phase F: extensions

| Requirement | Status | Evidence |
|---|---|---|
| 003x control sheet (current / as recorded / history / pending external, each with basis and time), portable record v1 with digests, offline verifier | implemented, builder-verified (browser: sheet) | `handover-record.test.ts` (3), including the offline script |
| 006b agent access: narrow customer grant (one offer, the agent's own key slot, cap, expiry; hashed token), same customer path, MCP 2026-07-28 Streamable HTTP | implemented, builder-verified | `agent-access.test.ts` (3): an independent client's full flow, refusals before dispatch, protocol conformance; spec checked against modelcontextprotocol.io on Nov 5; `docs/design/AGENT_ACCESS.md` |
| 006b inside the configured child across a sale; founder enablement switch; browser pass | **open** | |
| 006c successor rehearsal records | **open** | |

### Phase E: M6

006a web-app customer lifecycle, more product families, business integrations and team/co-op
ownership: **open**.

## Real-browser findings

**Fixed:**
- raw service codes;
- recovery panel order and the answer's placement;
- the Studio's view not kept in the address;
- Checks claiming that no build existed;
- the economics "−3 owed" (now unknown);
- `?skill` ignored in the expert directory;
- the expert directory filters' layout.

**Still open:**
- offer and customer pages lead with base units instead of readable token amounts, which needs
  token metadata on those routes;
- Checks cards are narrow at 1280 with the companion open.

## Running and reviewing

- `npm run web:build`, then:
  - `npx tsx scripts/sale-harness.ts` (synthetic wallet and chain, ports 8814/8815), or
  - a scratch local preview: `npm run serve` with `PORT=8811` and `EVERSTREET_DB` /
    `OPENSEAT_DB` pointing at scratch files.

  The preview has the fictional GitHub fixture and expert help.
- The flagship journey: `npx vitest run server/test/flagship-journey-process.test.ts` (about
  10 s).
- Verify a record offline: `npx tsx scripts/verify-handover-record.ts <record.json>`.

## Decisions for Tony

1. The external rehearsal (`EXTERNAL_REHEARSAL_PACKET.md`):
   - whether to deploy business-v3 to testnet, and the NEAR budget;
   - a provider spend ceiling;
   - whether you operate the wallet steps;
   - whether Gated is in scope.
2. Whether to authorize a live read-only GitHub connection for 004b (a repository-scoped token,
   which you would create).
3. When to dispatch Astra for independent review, including 002f1 stage 2 on the worker host.
