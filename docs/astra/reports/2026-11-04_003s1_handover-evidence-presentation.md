# 003s1 report: handover evidence stays qualified

Claude, 2026-11-04. Job: [003s1](../jobs/2026-11-04_003s1_handover-evidence-presentation.md).
Commit `cabd516`, on top of `19cec4a` (Astra's six docs). Not pushed. The backend authority,
reconciliation and receipt privacy are unchanged. No contract change; Rust was not rerun.

## Reproduced first

`web/test/handover-evidence.test.ts` failed 10 of 12 before the fix:
- the flagged-evidence case;
- the stale and owner-mismatch case;
- seven malformed refresh forms;
- the deadline helper.

The unanswered-record and genuine-refusal cases already behaved; they are now pinned by tests.
Two test-setup mistakes were fixed along the way:
- a closure used the world before it was returned;
- re-reading the same block is `duplicate` and keeps the old reading time, so the stale case
  reads a newer block.

## Changes

1. **The preview labels itself.** Both disposable previews serve `/__preview/label.js`, which
   sets `window.__everstreetPreview`.
   - The shell (`web/src/previewLabel.ts`, `App.tsx`) then shows a persistent amber strip under
     the environment strip on every page:
     - acquisition preview: "Preview only: synthetic sale evidence, customer chain and runtime",
       plus the fixture clock and "Not testnet proof";
     - customer preview: "…synthetic customer chain, runtime and signer".
   - The app never sets the label. It is data only (bounded, validated, JSON-escaped), with no
     signer, key or behaviour.
   - The bundle scan is clean.
2. **A coherent fixture clock.** The sale views are the contract tests' fixtures, and their
   digest-covered times are fixed:
   - T0 = 2026-11-02T00:00Z;
   - Gated closer deadline T0 + 30 min;
   - offer open until 2026-11-03T00:00Z.
   
   The acquisition preview reads them on a fixture clock that starts at T0 + 10 min and runs at
   real speed (`v3Now`, a new test-world option). The label states this, and customer uses keep
   the computer's clock. **No term was rewritten.** A preview test checks the digest, expiry and
   price, and that the reading falls before the deal's own deadline.
   
   The page also labels any passed offer or closer deadline as "already passed when this was
   read", with a note that only a later reading of the outcome shows how the sale ended.
3. **Qualified readings can't be acted on.** `reviewProblem(evidence)` disqualifies:
   - a flag;
   - a stale reading (decided explicitly: read again before recording);
   - a chain owner that doesn't map to this business's owner here;
   - no reading, or no live deal.
   
   The terms stay visible "as last read, for reference", with the reason. Review and Record are
   withheld or disabled, a held review drops on reload, and `record()` refuses locally with
   `evidence_disqualified`. An unanswered record can still be recovered as the same request.
4. **Strict refresh.** `parseRefresh` accepts only two forms:
   - `refused` with a code and no view or period;
   - a recording outcome with a valid view and period, where accepted/duplicate must be
     observed and a conflict must be flagged.
   
   Anything else gives `refresh_malformed`: retryable, the evidence shown is not replaced, and
   no success is announced.

## Checks

- `npm run check`: Biome and `tsc` clean, **762 tests in 64 files** (747/62 before).
- `npm run web:build`: built.
- **New tests:**
  - `web/test/handover-evidence.test.ts` (12);
  - `web/test/previewLabel.test.ts` (2);
  - `server/test/acquisition-preview.test.ts` (+1: label, fixture clock, unchanged terms,
    customer preview label, escaping).
- **Existing tests:** all 003s recovery, identity and participant-privacy tests still pass.
- **Mutants**, one at a time, each restored, with the diff inspected before running. All 4 were
  killed:
  1. the flag ignored;
  2. staleness ignored;
  3. refresh view validation swallowed;
  4. `refused` without a code accepted.

## Limits

- **Browser.** Not browser-verified here, including the amber strip at 390 px.
- **Mixed clocks.** The preview's customer side and sale side run on different clocks; this is
  stated in the label.
- **Stale readings.** These now block recording until a newer block is read. That is a
  deliberate, conservative choice.
- **Milestones.** All six stay open.
