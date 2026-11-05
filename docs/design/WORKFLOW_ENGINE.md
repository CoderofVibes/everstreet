# The workflow engine (SaaS workflow product type) and Relaydesk

Claude, November 5 2026 (night). Plan step 3: a product-type framework on trusted engines
Everstreet owns (no generated code), then Relaydesk end to end. Grounded in a read-only map of
the current pipeline, where every product is today read as an AI extraction spec.

## 1. What a Relaydesk customer gets

A support desk:
- The customer submits a request through a form (intake). It lands in the first stage, is
  assigned, and is resolved.
- The customer can follow its stage and history.
- **One unit is charged per accepted submission.** A submission the desk refuses (a missing
  required field, too long, unknown fields) is never charged; its unit returns.
- Moving a request through its stages never charges anything.

No AI model is involved. The engine is deterministic and part of Everstreet.

## 2. The framework: one artifact, one engine per kind

| Piece | Today | With this change |
|---|---|---|
| Build artifact | always `extraction_spec`, made by the AI provider | `extraction_spec` (AI API, unchanged), or `workflow_spec` for a `saas_workflow` project, **compiled deterministically** from the founder's saved revision (no provider call, no spend) |
| Validator | `extract-validator/2` | per kind: `extract-validator/2` or `workflow-validator/1` |
| Runtime `run()` | provider call + `validateExtraction` | dispatches on the artifact's kind: extraction (unchanged), or the workflow engine (deterministic, zero cost, no reservation) |
| Outcome | `extracted / incomplete / refused / invalid` | adds `accepted` (a one-time rebuild of `runtime_invocations`, keeping every row, as job 003n did). A single helper decides when a use is fulfilled (`extracted` or `accepted`), used by `finish`, `eligible`, operations and the views |
| Evaluation | the required invoice cases | per kind: the workflow's required cases (§4) |
| Release | needs the model config and the extract validator | the workflow kind needs no model config (`provider_config` is the engine's own config, `{"engine":"workflow-engine/1","model":null}`) |

Every place that reads an artifact checks its **kind** before using it, so an extraction spec
can never be read as a workflow spec, or the other way round.

## 3. `workflow_spec/1`

```json
{
  "kind": "workflow_spec", "schema_version": 1, "name": "Relaydesk support desk",
  "intake": { "fields": [
    { "key": "subject", "label": "Subject", "type": "text", "required": true, "max_chars": 120 },
    { "key": "details", "label": "What happened", "type": "long_text", "required": true, "max_chars": 4000 },
    { "key": "urgency", "label": "Urgency", "type": "choice", "required": false, "options": ["low","normal","high"] }
  ]},
  "stages": [
    { "key": "intake", "label": "Received" },
    { "key": "assigned", "label": "Assigned" },
    { "key": "resolved", "label": "Resolved", "final": true }
  ],
  "assignment": { "to": "owner" }
}
```

**How it's compiled:** the intake fields come from the revision's form screen, and the stages
from its board screen. The saas_workflow starter already has both: a form, and a board with To
do / In progress / Done.

**Rules:**
- 1 to 20 fields with unique keys and bounded lengths;
- 2 to 8 stages: the first is where accepted requests land, and only the last is final;
- choice options are bounded.

The compiled spec is immutable, like every build artifact.

## 4. The engine

**Input.** The customer's submission, as canonical JSON text: a sorted object of field key to
string. This reuses the existing request machinery unchanged: the input's hash and length, and
its encrypted protected copy.

**Run.** Parse, then validate against the release's spec:
- `accepted`, with the normalized fields: every required field present, within its limits,
  choices from the options, no unknown keys;
- otherwise `refused`, with a reason.

There's no model, the usage is zero (final), and the cost is zero.

**Required cases** (evaluation), each with a why:

| Case | Expect |
|---|---|
| a complete request | accepted |
| a missing required field | refused, never charged |
| a field longer than its limit | refused |
| an unknown field | refused |
| a choice outside its options | refused |
| text that contains instructions | accepted, stored **verbatim as data** (nothing in a submission is ever executed) |
| an empty submission | refused |

## 5. Cases: the lifecycle after intake

```
workflow_cases(request_id PK -> customer_requests, business_id, offer_id, project_id, stage,
  assignee_account, created_at, updated_at, closed_at)
workflow_case_events(n PK, request_id, at, actor_kind customer|staff|system, actor_account,
  from_stage, to_stage, note)   -- append-only (triggers)
```

- **Creation.** A case is created once, when the accepted use is delivered (idempotent by
  request id). It starts in the first stage, with a `system` event.
- **Staff.** The business's **current** owner moves a case to the next stage only: assignment
  records the assignee per the spec's rule, and the final stage closes it. A move is fenced
  like every owner write: control is checked inside the write, and moves are refused during a
  managed handover (`gated_owner`).
- **Privacy.**
  - The submission's content is readable by the customer and by the business's current owner
    (the staff), from the request's protected copy.
  - Nobody else can read it, including a former owner after a sale.
  - Notes on stage changes are visible to the customer: there are no hidden staff notes in v1.
- **Sale continuity.**
  - Cases belong to the business. After the close the buyer works them, and open cases
    continue where they were.
  - The seller can no longer read or move them.
  - The customer's prepaid units and case history are kept.

## 6. Routes

| Route | Who | Classification |
|---|---|---|
| `GET /api/businesses/:id/workflow-cases` | owner | read |
| `GET /api/businesses/:id/workflow-cases/:request` | owner (content from the protected copy) | read |
| `POST /api/businesses/:id/workflow-cases/:request/advance` `{to_stage, note}` | owner | `gated_owner` |
| `GET /api/customer/uses/:id/case` | the customer | read |

## 7. Evidence planned

**Unit tests:**
- compiler rules;
- engine validation;
- the required cases;
- a kind mismatch is refused everywhere.

**Process journey** (configured child, synthetic chain):
1. A founder builds and releases Relaydesk; the evaluation passes with no model call.
2. A customer buys units and submits 3 requests (1 refused, so not charged; 2 accepted and
   charged).
3. Staff move one request to resolved.
4. A Direct sale closes.
5. The buyer resolves the other request. The seller is refused, and the customer still sees
   both histories and has the right units left.
6. Restart in the middle: no double case, no double charge.

**After that:** the Studio summary, the customer form and case page, the owner's case board,
and the Relaydesk showcase sample (§2 of SHOWCASE_SPEC: prepared in advance, no request).

## 8. As built (Nov 5)

Everything in §7 is built and tested. Where the build differs from the plan above, the build wins:

- **Run config.** A workflow's `provider_config` is the engine's own JSON,
  `{"engine":"workflow-engine/1","model":null}` (every view parses a config as JSON).
- **No AI budget.** A SaaS workflow's build compiles in the request. It takes no budget; zero
  limits are recorded. Checks, trials and customer requests need no runtime budget and no model
  provider. The model runtime's availability and budget still gate model products exactly as
  before.
- **Per-product availability.** The builds and runtime lists carry `engine: "workflow" | "model"`.
  The Studio's Builds tab offers "Compile revision N"; the Service tab's Try takes a JSON request.
  Its required checks are the engine's cases for the latest compiled form.
- **What staff read.** A request's input copy is deleted once it has run. So the current owner's
  case view reads the accepted fields from the kept result (verbatim) while it is retained, and
  the input copy before that. This is only for requests that opened a case. An extraction result
  is never read this way.
- **Handover backstop.** A database trigger refuses a staff move during an open handover (the
  service refuses first). A case opened by delivering a request admitted before the handover is
  not gated.
- **Showcase.** Relaydesk is tryable on `/example/relaydesk` and its Example businesses card.
  Three fictional requests are decided in advance by the real compiler and engine
  (`web/src/showcase/relaydesk.json`; a test regenerates it byte for byte). Signalwatch stays an
  illustration.

**Tests:**
- `server/test/workflow.test.ts`: compile, spec, engine, required cases.
- `server/test/workflow-flow.test.ts`: real routes, including with no model provider.
- `server/test/relaydesk-journey-process.test.ts`: the §7 journey in the configured child, with a
  restart, a Direct sale and zero model calls.
- `web/test/workflowCaseBoard.test.tsx`: the board, a move and the customer's track.
- `server/test/showcase.test.ts` and `web/test/showcase.test.tsx`: the sample.

**Not covered in a browser:** the customer purchase, request and case path. It needs a
configured chain. The process journey covers it end to end; the demo account (plan step 7) is
where it will be seen.
