# README draft

Everstreet opens as a platform for building, running, and selling digital businesses. The first screen names the studio, discovery, customers, and managed operations, then shows Ledgerline's third close, the former owner's failed supplier grant, and the same customer's recorded balance. The wider build follows through the founder's work, the buyer's handover, and a linked evidence table.

Tony asked, “Let's see your draft of the README.md” and said, “It is important to me that we show directly what Everstreet is. But also show the ambition and robustness of our build”. This draft uses Ledgerline itself as the opening picture. The print-shop analogy remains in the earlier proposal.

## Changes

- `README.md` has the draft. It replaces the stale series 2 lead with current Ledgerline evidence, connects the wider platform to the business lifecycle, links the actual transactions and tests, and gives the demo and local static-proof commands. It documents reproducible builds, cold AI reviews, attack cases, recovery, and the specific trust boundaries. Earlier examples link to their records and the feature reference. Rough size is one documentation pass using existing evidence and UI.
- `docs/astra/2026-11-07_READMEDraft.md` records this pass.
- `docs/astra/INDEX.md` links the draft pass.

## Evidence and wording

Read the current README, role, brief, feature reference, safety case, agent-payment design, rehearsal records, relevant tests and verifiers, and the latest cold review and triage. The current cold review corrects the earlier framing of the handover strip. Its recorded former-owner calls are to companion contracts. The README names the supplier-budget companion and links a failed `grant` transaction from the fixed series 4 deployment. This keeps the receipt and explorer outcome straightforward to inspect.

The draft says the suite has 27 cases, including refusals and a revenue flag. It describes the suite's uncommitted-changes flag and uses the saved record as the source for its count. The Sepolia held publish was refused by the RPC after the role move used its nonce. The light-client verification is against a supplied head. The final customer snapshot is a separate observation after all three sales.

The static proof is currently built locally. Its instructions use Vite preview. A published proof URL and film link can be added when those deliverables exist. If length becomes a problem, compress the repository map and move the detailed verification commands into an existing technical reference while retaining the linked claims table.

## Validation

All relative Markdown links resolve, all internal anchors resolve, and every explorer link in the draft occurs in its corresponding committed evidence record. The offline customer-snapshot verifier and light-client verifier both passed. The attack suite passed all 27 cases and caught all 5 planted faults.

`npm run check` passed typechecking and lint with two warnings. The first test stage had 1,962 passing tests, 1 skipped, and 1 failure in `server/test/showcase.test.ts`. The allowlist test rejects the new `read_after`, `how`, and `asked_business` fields from the handover-strip work being edited concurrently by Claude. The command stopped before its later test stages. This pass changes documentation only. The application test failure is recorded for Claude's review.
