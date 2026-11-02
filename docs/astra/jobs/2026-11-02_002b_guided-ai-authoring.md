# M2b: a founder can shape and revise a product in conversation

**Why (Tony's words):** "People I know themselves know they can build with AI but haven't
figured out Codex or Claude Code, how to prompt, all of that."

## What the person sees and does

Replace the studio's form-first introduction with an approachable product conversation that
produces reviewable changes. Keep the existing brief and screen editors as direct controls.
The founder should not have to learn prompts, tokens, JSON, jobs or command lines.
Use a clear currency-denominated project budget and an actionable way to set it within the
operator's ceiling. Put token limits and provider diagnostics in an Advanced section. The
current Builds panel only displays a budget, so a connected provider alone does not complete
the founder's start flow. Ensure completed event history can page beyond the first 100 rows.
Astra's internal fixture review confirmed a completed 180-progress-event job shows only its
first 100 events, ending at progress 97; its final receipt/completion is inaccessible there.
Also distinguish precise computed usage from conservatively rounded budget consumption:
the fixture totals $0.02835, while the current budget tile says "Charged $0.05". Use accurate
labels and consistent precision in event details; a partial $0.0003 receipt is not a $0.01 bill.

Use the invoice extraction service as the first supported journey:

1. They enter "Turn invoices into clean data for small accounting teams." The studio keeps
   the idea and starts shaping when an available, budgeted provider is configured. Otherwise
   it offers the current manual path and a concise connection explanation, with no fake reply.
2. The assistant proposes a name, customer, problem, outcome, initial features and screens.
   It identifies assumptions and asks at most three useful questions at once. Do not force
   an interview about details that can reasonably be proposed and corrected.
3. The main canvas shows the proposed brief/screens alongside the accepted revision. The
   founder sees a short "What changes" summary, assumptions and unresolved questions. A
   single "Use this version" action creates a revision; it does not publish a product.
4. "Also return the invoice date" produces a new proposal against the recorded revision.
   Accepted history stays intact. If the founder edited the brief while AI was working,
   explain the conflict and provide comparison; never silently overwrite their edits.
5. Conversation, proposals and build progress survive reload. Typing remains possible while
   a request runs. Prevent duplicate dispatch on double clicks/retries, offer cancel, and
   show a concise reason for refusal, truncation or unavailable service. Do not expose stack
   traces, model reasoning or request headers in the founder flow.

Treat this as the business's product work log, labelled as such. Do not silently import personal
chat histories. Accepted decisions and necessary product knowledge belong to the business;
the transfer surface must say which work records carry over. Future private personal notes
need a distinct scope, not a privacy promise contradicted by the database.

## Underneath

Depends on accepted 002a. Reuse its durable job, event, ownership, budget, cancellation and
fencing machinery. Extend typed intents/artifacts as needed instead of implementing a second
untracked model loop. Proposal output is a bounded validated brief/prototype plus assumptions,
questions and a concise change summary. No code, tool permissions or payment authority in it.
Record base revision/hash, requester, provider/model and the applied revision. Accepting the
same proposal twice is idempotent; applying against a changed base is a useful 409.
Scope browser draft recovery and asynchronous responses to actor, project and ownership
epoch. The existing local draft key contains only the project id; review shared-browser and
post-sale behavior. A late previous-actor response must never repopulate the new actor's UI.
Clear visible private state immediately on identity change; preserve recovery for its author
without offering unaccepted local edits to a different owner.

Add a supported Anthropic Messages adapter behind a small transport interface so request
construction and failure handling can be tested without a credential or network. No shelling
out to the personal Claude Code login for customer-facing requests. Configure server-side
credentials outside the repository through a documented mechanism; do not read or print any
existing secret while building. No browser input or generated artifact can select an arbitrary
provider URL, model, price or API key. Restrict production transport to the intended HTTPS
provider host and reject redirects; test transports are explicit constructor dependencies.

Required adapter behavior:

- One explicitly bounded generation per attempt; no SDK or transport automatic paid retries.
  Use timeouts/abort, size limits and safe error categories. A response without trustworthy
  usage does not release an unresolved reservation as zero cost.
- Use structured output; validate locally even when the provider constrains JSON. Refusal,
  max-token truncation, unexpected content/tool blocks and wrong schema are not success.
  Never follow instructions embedded in returned text to execute, fetch or reveal anything.
- Include the complete actual prompt and schema in preflight counting and budgeting. Keep
  model and price configuration explicit/versioned. Token estimates are not a billing
  guarantee. Capture usage with sufficient precision for small requests; round presentation
  separately from the ledger. Refuse unsupported pricing features rather than undercounting.
- Live dispatch requires an operator-set overall spend ceiling in addition to a project's
  ceiling; a founder increasing their project limit must not authorize more of Tony's credit.
  No automatic top-up, fallback to an unpriced model, thinking/tool extras, or uncontrolled
  chaining. Conservative reservations may exceed actual usage; label both accurately.
- Generated assumptions and suggestions are not evidence about market demand or financial
  performance. All prototype/sample data remains plainly fictional and separate from live data.

### API references checked by Astra, November 2

[Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
uses `output_config.format` with a JSON schema, but refusal and truncation can still return
unusable output. The docs describe additional input overhead from structured output. Keep
local validation and account for the actual request configuration.

[Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) accepts
the structured request and describes its result as an estimate. Do not advertise a hard
financial guarantee solely from that number.

[Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
is the reference for classifying completion. Recheck the relevant official API/model docs
when wiring the adapter; do not copy a model alias from documentation without a supported,
priced configuration for the account. This research did not make a live model call.

## Done when

Tests prove idea -> proposal -> accept -> immutable revision -> requested change -> second
proposal, plus stale-base refusal, duplicate apply, another actor, transfer fencing, restart,
cancel, provider refusal/truncation/malformed output, redaction and budget boundaries. Inspect
the actual studio at 1440/1280 and narrow widths. Provider integration tests use an explicitly
injected transport, not a mock that the normal application can accidentally advertise as AI.
`npm run check` and web build pass. Report keyless evidence separately from any live evidence.

Prepare an exact bounded live-verification checklist and configuration status without exposing
secrets. Do not make live calls in this job dispatch unless Astra supplies a concrete existing-
credit ceiling and supported configuration. Lack of a key does not block implementation or
keyless verification. M2 remains incomplete until the live provider and working runtime pass.

## Not in this job

No arbitrary generated code execution, public release, payments, credential inspection or
billing changes. No full PDF upload/OCR promise: first runtime input is pasted document text.
Do not claim that shaping a brief or generating a specification is a running product.

## Priority and size

P0 / L. After 002a review; follow with 002c for actual managed product execution.
