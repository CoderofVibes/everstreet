# The analysis engine (agent service product type) and Signalwatch

Plan step 4 (CLAUDE_RESUME.md). The third product type runs on the AI runtime, under rules that
Everstreet owns. There is no generated code and there are no tools: the agent reads what a
customer submits and proposes actions; it never does anything for them. Signalwatch is the
example. A customer submits a supplier's release notes and what they rely on. They get flags back:
what could affect them, the exact line it comes from, why it matters, and a proposed next step.

## 1. What a Signalwatch customer gets

- A form with two fields: the release notes (the source) and "What you rely on" (context).
- An answer with up to 8 flags. Each flag has:
  - a title and a severity (low, medium or high);
  - the evidence, a line quoted word for word from the release notes;
  - why it matters to them;
  - a proposed action.
- A delivered analysis costs one unit, including one that finds nothing relevant ("Nothing here
  affects what you rely on" is a delivered answer).
- Text that isn't release notes is refused. So is an empty or malformed submission, and so is an
  answer that fails the platform's checks. None of these is charged; the unit comes back.
- Proposals only. Nothing is sent, changed or scheduled for the customer, and the page says so.

## 2. `analysis_spec/1`, compiled from the saved revision

Compiled deterministically, in the request, like the workflow engine. There is no build model and
no AI budget for the build.

- `source`: the first long-text field of the first form. It is the material analysed: required, up
  to 12,000 characters.
- `context`: up to three more text fields of that form, optional, each up to 2,000 characters.
- `purpose`: the brief's promised result, as data (bounded). It never changes the platform's
  rules.
- `result_title`: the title of the model screen fed by the form. Compiling requires one.
- `max_findings`: 8. The finding shape is the platform's, not the founder's.

## 3. The model request and the platform's checks

- **Input.** The same canonical form submission the workflow engine reads. A submission whose JSON
  is malformed, has unknown keys or has no source is refused BEFORE any model call: nothing is
  sent, nothing is charged.
- **The request.** One fixed request, with its own system prompt, `analysis-prompt/1`. The source
  and context are untrusted data. Structured output is the closed schema
  `{status: analyzed | not_applicable, summary, findings[]}`.
- **The model config** a release is bound to is the runtime's config plus the analysis prompt
  version. Ledgerline's extraction config is unchanged, so its releases stay current.
- **`analysis-validator/1`** is pure and deterministic:
  - unknown status, too many findings, an empty or overlong text or a bad severity make the answer
    `invalid`;
  - so does any evidence that is not a verbatim quote of the source (whitespace normalized). Made-up
    quotes are never shown.
  - `not_applicable` becomes `refused`, with the model's reason (bounded).

Outcomes are `analyzed` (fulfilled, chargeable), `refused` and `invalid`.

## 4. Required checks (the release policy for this kind)

These run on the real runtime at check time, at the runtime's own cost:

1. A relevant removal is flagged, quoting its line, as high severity.
2. Release notes with nothing relevant: analyzed, no flags.
3. Text that isn't release notes is refused.
4. Release notes that contain instructions to the agent: the instructions are not followed, and the
   real change is still flagged.
5. A deprecation is flagged with its own quote, and an unrelated change is not.

A case passes when the outcome matches and every expected quote is among the flags' evidence. A
case can also require no flags, or no flag quoting a given line. These cases are written for
release-note review. Another kind of analysis product would need its own policy, and the Studio
says so.

## 5. Stand-in model

Tests, the configured child and the showcase use a labelled, deterministic stand-in analyst. It
flags lines that announce removals, deprecations, renames, price or limit changes, but only when
they name something the customer's context mentions. No real model is called anywhere in this
build. A real run is Tony's call, because it spends money.

## 6. Evidence planned

- Unit tests: compile, the validator (including fabricated evidence), canonical input refusal.
- Real routes: compile, check, release, offer, a customer request, the refused cases.
- Process journey in the configured child (synthetic chain, wallet and model):
  - one refusal, returned;
  - two delivered analyses, charged once each;
  - a restart;
  - a Direct sale, after which the buyer serves the next request.
- Showcase: `/example/signalwatch` becomes tryable from the stand-in's answers through the
  validator (drift-tested). Ledgerline's sample stays as it is.

## 7. As built (Nov 5)

Everything in §6 is built and tested. Details the plan above didn't fix:

- **The model request.** `RuntimeRequest` is either an extraction (`spec`) or an analysis
  (`analysis: {spec, content}`); `AnthropicRuntime` sends `ANALYSIS_SYSTEM` and the closed
  `analysisSchema()` for the latter. Trials, checks and customer requests record the release's
  config, `configFor("analysis_spec")`: the model's config plus `task: "analysis-prompt/1"`.
- **Outcomes.** `analyzed` joins `runtime_invocations.outcome` (migration rebuilds the table
  once, like `accepted`), and it is fulfilled (one unit).
- **Studio.** The builds and runtime lists carry `engine: "analysis"`. Builds offers "Compile
  revision N" (no AI budget); the Service tab's Try takes a JSON request, shows flags, and keeps
  the runtime budget (requests use the model). Its checks section names the release-note policy
  and says another kind of analysis needs checks that aren't built yet.
- **Customer.** The offer is a form (`kind: "analysis"`, `result_title`); the answer shows each
  flag's quote apart from its reasoning, and says it is proposals only and checked word for word.
  Results stay private to the customer (the business never reads them).
- **Showcase.** `/example/signalwatch` and its card are tryable: three fictional release notes
  through the real request content, the stand-in analyst and `validateAnalysis`
  (`web/src/showcase/signalwatch.json`, drift-tested). The illustration component is gone: every
  example is now a sample.

**Tests:** `server/test/analysis.test.ts` (compile, checks, cases, wrong answers fail),
`server/test/analysis-flow.test.ts` (real routes: checks 5/5 under the analysis config, delivered,
refused, refused before sending, made-up quote invalid), `server/test/signalwatch-journey-process
.test.ts` (configured child: checks, a delivered analysis charged once, a refusal returned, a
restart, a quiet release delivered, a Direct sale, the buyer serves the next request),
`server/test/showcase.test.ts` and `web/test/showcase.test.tsx`.

**Not done:** no real model has run Signalwatch (that spends money: Tony's call). The customer
form and answer weren't exercised in a browser (it needs a configured chain); the journey covers
the path and the parsers are cross-checked against the real answers.
