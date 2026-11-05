# Agent, presentation and Relaydesk review

Tony asked for an accept-or-correct decision on the three November 5 review jobs, with Relaydesk Stage C at `f817fef` included and Claude continuing Signalwatch. The review started from clean `f817fef`. The three original entries remain in review with the correction jobs listed in JOBS.md. Stage D and Signalwatch are outside this disposition.

| Review | Verdict | Evidence |
|---|---|---|
| 006b1 Agent control corrections | Correction required | Existing focused fixtures cover cross-account read fencing, revocation and focus. In an independent component probe, a deferred create reply rendered the previous session's token after sign-out and same-account sign-in without unmounting. The boundary was account identity rather than session lifetime. |
| Review evidence and presentation | Correction required | Exact integer rendering and the evidence improvements are present. A render probe supplied 150000 units with `changed: true` and 18 decimals. It rendered `0.00000000000015 TUSD` without surfacing the metadata disagreement. The previous 6-decimal scale yields `0.15 TUSD`. The original populated portfolio, actual zoom and reduced-motion browser acceptance also remains open. |
| Showcase proposal corrections, including Relaydesk Stage C | Correction required | The revised spec, sample drift checks and public projection are present. In an independent board probe with two open cases on different stage sets, the board counted both but rendered only the first. A second probe hit a synchronous compiler hang on two valid 41-character labels with an identical 40-character prefix. The child timed out at 2.5 seconds while the noncolliding control compiled. |

The independent component probes used the actual components, fictional inputs and scripted responses. The two agent/board probes failed the new assertions with nine existing checks passing. The amount probe failed its new assertion with four existing checks passing. Temporary probe files were removed. These were component checks, and no independent browser pass was performed for this review. The Relaydesk process tests exercise a synthetic chain. The public Ledgerline projection has a separate evidence basis in the committed testnet record.

## Files changed

- `docs/astra/JOBS.md` and `docs/astra/INDEX.md` record the disposition and links.
- `jobs/2026-11-05_006b2_agent-session-boundaries.md` defines the session and business fencing correction.
- `jobs/2026-11-05_amount-provenance-and-browser-repeat.md` defines the metadata and browser acceptance correction.
- `jobs/2026-11-05_relaydesk-versioned-case-corrections.md` defines the mixed-release case and compiler corrections.
- This pass records the evidence and handoff. Claude's Signalwatch files were left to the active builder.

## Verification

The web build passed. The full keyless check ran with loopback access against the review baseline and exited 0: 1,702 main tests passed with one skipped, 12 protected-storage tests passed, and 67 process tests passed. The independent failing probes ran separately from the suite. `git diff --check` passed for the documentation changes.
