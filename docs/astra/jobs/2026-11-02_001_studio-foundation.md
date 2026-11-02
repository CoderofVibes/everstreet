# M1: digital product system and persistent studio foundation

**Why (Tony's words):** "People I know themselves know they can build with AI but haven't
figured out Codex or Claude Code, how to prompt, all of that." "I want you to drive the
development of that build with Claude as your builder."

Read `docs/design/PLATFORM_VISION.md`. Astra is coordinating this implementation. Own this
job's code and completion report; do not proceed into other jobs without a handoff.

## What the person sees and does

- Replace the cream/serif presentation with the specified crisp technology-workspace design
  across the shared shell; preserve all working routes and actor switching.
- Rework the home around building and discovering digital businesses. Offer clear Start
  building and Bring a product paths. Use existing data honestly; preserve legacy examples
  but prioritize software in the primary showcase. Never invent working product demos.
- Add a persistent product studio reachable from the home and a founder's workspace, without
  destroying the current business-offer studio. A founder describes an idea and chooses AI
  API, SaaS workflow, agent service or client portal. A new project is linked to a business.
- Show the brief (audience, problem, promised result, core features, pricing assumption), a
  usable initial prototype canvas, and tabs for brief/checks/versions. Editing and saving the
  brief creates an immutable revision; reopening restores it. Make the UI approachable and
  visually strong, not another long form. Partial and unavailable states are designed.
- Explicitly label any schema-based preview as a prototype. Until a live provider exists,
  explain that generated builds are not connected; do not fake an AI conversation, progress,
  test results or a successful deployment. Offer a useful manual brief/prototype path.
- Show a concise business continuity panel: customer promises, dependencies and transfer
  readiness. Its values reflect actual known state and unknowns.

## Underneath

Inspected: `web/src/App.tsx`, `pages/Studio.tsx`, `server/src/app.ts`, `db.ts`. Current launch
studio is an interview/offer workflow and must remain accessible. SQLite business ownership
is the existing access boundary. Reuse established API/session conventions.

Add narrowly scoped, brand-neutral project/brief/revision persistence and a provider-neutral
build interface for the next job. Enforce ownership server-side on every read/write. Use
additive migrations compatible with existing local data; no reset or seed execution.
Make any schema-rendered preview inert with respect to platform authority. No arbitrary code
execution, external requests or credentials in its content. Keep dependency additions small.

Document the next job's execution architecture in `docs/design/BUILD_RUNTIME.md`: project
records, job lifecycle, provider boundary, isolation choices, release identity, cancellation,
usage accounting and transfer behavior. Confirm assumptions from code rather than claiming
unsupported capabilities. Architecture documentation accompanies working M1 code.

## Done when

- Founder can create, save, reopen and version a digital project and view its prototype.
- Other actors cannot read or mutate it; malformed input is handled; revision recovery is
  covered by meaningful tests. Existing 52 tests and `npm run check` pass; web build passes.
- No legacy data is discarded, no transaction is sent, no secrets are printed.
- Desktop UI at 1280/1440px is ready for Astra's browser review; keyboard/focus states work.
- Report files changed, commands/results, limitations and next integration point in
  `docs/astra/reports/2026-11-02_001_studio-foundation.md`.
- Review/check Astra's handoff docs before building, commit them as the existing repo rules
  request, then make scoped local implementation commits. Record commit(s) in JOBS.md.
  "Done" here means this bounded foundation, not the whole platform or a live AI builder.

## Not in this job

No public deployment, Git push, mainnet/testnet signing, billing configuration, imported real
data, runtime database inspection/dumps, credential file reads, or changes to Day One.
Do not run seed/setup/smoke/handoff scripts. Do not launch other agents in the same checkout.
Do not change `docs/astra/BUILD_STATE.md` (Astra owns the coordinator checkpoint).

## Priority and size

P0 / L. First build job. Claude is sole code writer during the run. Astra may edit the
coordinator checkpoint and subsequent job briefs, and will independently review the result.
