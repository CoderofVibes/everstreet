# First studio review and next build slice

Tony asked: "How's the job going so far?" The sustained build mandate remains in effect.
The first code slice is built; the complete platform is early in its development.

## Checked

- Claude completed job 001 with local commits `ba2950e`, `0e82986`, `07d666e`, `9ecea05`.
  No push. Builder process 41523 and read-only review process 90234 both exited successfully.
- Astra independently ran `npm run check`: lint/types and all 64 tests passed on Nov 2.
  Claude separately reports the web build passed; no independent rebuild needed without edits.
- Browser review used the real built UI with an isolated in-memory API on loopback port 8801,
  fictional Ava/Ben actors, no key loading, provider, chain or booking worker. That preview
  and review tab were stopped after review. The existing 8800 preview was left alone.
- The home now identifies AI tools, SaaS, APIs and agents, and keeps acquisition in navigation.
  Signing in as fictional Ava after entering an idea creates a private product project.
  Editing the brief, saving revision 2 and reloading preserves the edits. Restoring revision 1
  creates revision 3 while keeping revisions 1 and 2. Prototype/not-connected labels are clear.
- Two browser failures prevent accepting M1: Versions details can display a stale revision
  after restoration; the Versions canvas overflows at 1280 (1265px client, 1357px scroll width).
  At 1440 the main preview fits; 390 has no page overflow but is only a preliminary mobile pass.
- Source review confirms VersionsView has an asynchronous response race. The server's
  immutable revision and current-owner tests pass; browser history presentation needs fixing.
- Internal QA images are `m1-studio-1440.jpg`, `m1-versions-1280.jpg`, `m1-studio-mobile.jpg`
  under `C:/Users/antho/.codex/visualizations/2026/11/02/01a19d2e-29f9-7722-8592-187bac300246`.
  Full visual walkthrough remains deferred per Tony's request.

## Decisions and jobs

- Opened 001a to fix the two browser issues and make brief checks/readiness claims specific.
- Opened 002a for durable jobs, fenced worker attempts, recovery, budgets and truthful build
  progress. It precedes live AI integration; scripted providers stay in tests.
- A safe managed declarative runtime can produce a real useful digital product. It does not
  license arbitrary generated code execution. A WSL installation alone is not adequate
  evidence of sandboxing. Paid calls with an unknown result must not be blindly retried.
- Old-owner pending jobs must lose authority at transfer. Historical records transfer with
  the business; that does not imply continuing the former owner's execution instructions.

## NEAR architecture review: findings to investigate, not accepted proof

Claude's read-only review identified credit consumption without idempotency, incomplete
chain-to-database close recovery, no digital entitlement gateway, and ambiguity in credit
financial reporting. These are priorities for job 003 subdivision. Raw review output remains
in ignored `docs/astra/claude-m3-review.last-message.txt`; it is analysis, not test evidence.

Do not adopt its optimistic "v2 needs no contract changes" conclusion without tests. Offchain
controls do not prevent direct authorized contract calls that consume another customer's
credit, and a live treasury check does not remove a withdrawal race. A short stale-owner
lease also does not prove immediate revocation. Proposed owner-key suspension must not be
described as uninterrupted customer service. Characterize these behaviors and have Claude
propose contract changes when required; no deployment is authorized by this review.

## Files changed

This pass adds this review and jobs 001a/002a, updates JOBS/INDEX, and records tested and pending
gates in ACCEPTANCE plus the current process state in BUILD_STATE. These are Astra's uncommitted
docs for Claude to review. The earlier uncommitted BuildMandate addition is also Astra's.
No application code changed in this pass. The independent check passed before these doc edits;
run the required check again with the handoff. No decision from Tony is needed for these slices.
