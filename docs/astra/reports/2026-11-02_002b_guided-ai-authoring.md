# Job 002b report: guided AI authoring

Builder: Claude. Date: 2026-11-02. Job: `docs/astra/jobs/2026-11-02_002b_guided-ai-authoring.md`.
Parent job 002 and M2 stay open. **No live model call was made.** All provider evidence below
is keyless: scripted doubles or the real adapter over an injected transport. No browser pass
by me (no browser tool; the real server reads keys and was not started).

## Commits (local, not pushed)

| Commit | What |
|---|---|
| `5ce2dc9` | Astra's handoff docs (ContinuousDevelopment, ACCEPTANCE, 002b/003f jobs, TRANSFER_PROTOCOL_OPTIONS, financial review) |
| `9cb528b` | JOBS verification notes for 002a/002a1/003a; 002b taken |
| `e491dcc` | Server: work log, proposals, safe apply, Anthropic adapter, configuration, operator ceiling, event paging, migration; 39 tests |
| `a6340f4` | Adapter fixes from Astra's early review: pinned thinking, priced band, zero receipt for unsent work |
| `233d2bf` | Studio: Assistant panel, Proposal tab, money budgets, complete history, scoped drafts |
| `1c5c28f` | `BUILD_RUNTIME.md` sections 11–12, configuration and live plan |
| (this commit) | this report |

## What a founder can do (keyless-verified server behaviour; UI not browser-checked)

1. The studio opens on **Assistant**: the business's product work log, labelled as such. With
   no provider: "AI drafting isn't connected here" plus the reason and an "Edit the brief
   yourself" button; nothing is stored, nothing is faked. With a provider but no budget: a
   dollar budget form, capped by the operator ceiling.
2. "Turn invoices into clean data…" (or "Start from your idea") → a `propose` job against the
   current revision. Typing stays possible; double clicks/retries reuse the request key; each
   request can be stopped. Status reads plainly ("Drafting a proposal…", "Proposal ready",
   "Couldn't draft: The AI declined this request", "Stopped; whether it ran is unknown").
3. **Proposal** tab: summary, "What changes", the assistant's assumptions (labelled as not
   evidence), up to three questions, the proposed brief and screens beside the current
   revision (stacked on narrow canvases). **Use this version** makes a revision and publishes
   nothing. It is disabled with a reason when there are unsaved edits, when the base changed
   (with "Ask again on revision N"), or when the proposal predates a sale.
4. "Also return the invoice date" → a second proposal against the new revision; history stays.
5. **Builds**: completed history pages through every event ("Events · n of N", "Show more");
   Used (exact, e.g. $0.0210) is shown apart from Counted against limit (rounded up per job)
   and Held (worst case); token limits and provider details sit under **Advanced**.

## Required behaviours and their tests

| Required | Evidence (all keyless) |
|---|---|
| idea → proposal → accept → immutable revision → requested change → second proposal | `authoring.test.ts` "goes from an idea to an applied proposal…" |
| Stale-base refusal; edits never overwritten | "refuses to apply over edits made while the assistant was working" |
| Duplicate apply (sequential and concurrent) | "applies a proposal once…" (one revision, 201 + 200, `already`) |
| Duplicate send / reused key | "treats a repeated message as the same request…" |
| Another actor | "lets nobody but the business's current owner…" (404 on log, send, proposal, apply) |
| Transfer fencing | "fences a pending request at a sale…" (pending job cancelled `ownership_changed`; pre-sale proposal 409 for the buyer) |
| Restart | "survives a restart before dispatch and runs the proposal once" |
| Cancel | "cancels a running request; no proposal appears…" |
| Malformed output / >3 questions / unknown screen kinds | "refuses malformed proposals…" (cost still final, hold released) |
| Budget boundaries, operator ceiling, no provider, no ceiling | "guided authoring budgets and availability" (4 tests) |
| Exact vs rounded cost | "reports exact use and rounded budget consumption separately"; `builds-history` receipt microcents |
| Event pagination beyond 100 | `builds-history.test.ts`: 180 progress events, two pages, ends at `succeeded` |
| Migration of 002a `build_jobs` | `builds-history.test.ts`: legacy table rebuilt, rows and events kept, idempotent |
| Owner-epoch draft scope; studio availability includes ceiling | "studio view scoping" (2 tests) |
| Adapter request: count first, exact prompt+schema, no extras, thinking pinned | `anthropic.test.ts` request tests (Sonnet `between_tools`, Haiku `disabled`, effort `medium`) |
| Refusal, truncation, context, tool use, two blocks, prose, missing/bad usage, cache billing, server tools, 401/429/529/400 | 14 table tests: never success, safe reasons, no key or header text, only reported usage |
| Thinking blocks discarded | "discards thinking blocks…" |
| Priced band (Astra's Haiku 100,001 case) | "does not issue a final receipt when actual usage crosses the priced band" |
| Free preflight refusal releases the hold | adapter: zero receipt for over-limit/503/unreachable count; end to end: `reserved_cents: 0`, `retry_needs_ack: false` |
| Unreachable after dispatch keeps the hold | "keeps the reservation when the provider could not be reached after dispatch" |
| HTTPS transport pinning | injected `fetch`: URL, `anthropic-version`, `redirect: "error"`, foreign URL, oversize, network error message has no key |
| Configuration | 10 refusal cases (missing, invalid, provider, model, pricing version, ceiling bounds, key in file, missing/short key) and identity without secrets |

## Commands and results

| Command | Result |
|---|---|
| `npm run check` (final) | lint and types clean; **158 tests passed** (15 files; 46 new this job) |
| `npm run web:build` | **Not run: this session required approval for it.** Earlier in this job it was likewise unavailable. `npm run check` type-checks all web sources (`tsc --noEmit` includes `web/src`), but the Vite bundle is unverified. Needed: `npm run web:build`. |
| `npm run format` | **Not run: required approval.** Biome's diffs were applied by hand until `biome check .` passed. |

Official docs read (no API calls): structured outputs, stop reasons, token counting, pricing,
thinking, effort, Sonnet 5.5 overview (platform.claude.com, 2026-11-02).

## Astra's early review: all three addressed (`a6340f4`)

1. **Thinking default.** Confirmed in the docs: thinking is on by default and billed as
   output. Sonnet 5.5 pins `between_tools`, Haiku 5.5 `disabled`, effort `medium`, in both
   count and generation and in the job's identity; thinking blocks are discarded unread.
2. **Priced band.** A final receipt is issued only within the request limits and the
   model's band; otherwise "at least" usage, hold kept, no output.
3. **Preflight.** Unsent work reports a zero receipt and releases its hold; a dispatched
   generation with an unknown outcome still keeps it.

## Configuration status and safe requirements (no secret values)

- Not configured in this repository or session. To enable: a JSON file outside the repo at
  the path in `EVERSTREET_AI_CONFIG` (`config_version`, `provider: "anthropic"`, `model`,
  `pricing_version: "2026-11-02"`, `operator_ceiling_cents`), and `ANTHROPIC_API_KEY` in the
  server's environment, from the platform's API account (not a personal Claude login).
- Before enabling: confirm the account has no automatic top-up, choose a small operator
  ceiling, and re-check prices on the pricing page (the config refuses a different
  `pricing_version`).
- The exact bounded live plan is in `BUILD_RUNTIME.md` section 12.

## Limitations

- No live provider evidence: real token counts, latency, thinking-block shapes under
  `between_tools`, and cost agreement with the console are unverified.
- No browser review by me; layouts at 1440/1280/narrow are untested here.
- A generation that fails after being sent keeps its hold until reconciliation tooling
  exists (conservative by design).
- The 4xx error categories assume Anthropic does not bill rejected requests only for the
  free count; generation errors stay unresolved regardless.
- Work log has no private personal-notes scope; it is business property by design.
- "Bring a product" and the managed runtime remain later slices (002c, M4).
