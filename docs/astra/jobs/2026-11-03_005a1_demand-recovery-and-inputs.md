# Keep original creation recoverable and constrain published request metadata

**Why:** Tony's approachable studio must preserve work when replies are lost; request provenance
must contain only the bounded public fields it promises. Read the independent report
reports/2026-11-03_demand-and-recovery-review.md. Both findings were reproduced.

## Recovery

Keep an unknown Create attempt (exact key/input) separate from editable draft. Always expose
Check original request while it remains unresolved, including after typing. Recovering it must
not silently discard newer text or navigate away before the founder can keep it. Show a link to
the recovered project and an explicit choice for newer edits, or preserve them as an editable
draft with a clear next action. Do not turn new typing into an accidental duplicate business.
If creating a second project is offered, make it an intentional explicit action, with bounded
unresolved state; never evict an unknown request silently. Retain same-key retry after source
closure if the server already committed it. Unknown success and definite refusal stay distinct.

Fence loads and writes by current route/person/lifecycle; late reads must not reopen a request
known closed, and late success must not discard typed-ahead input. Replace fragile parsing of
human error strings with structured refusal semantics or an explicit guarded availability read.
Render actionable errors if foundations or destinations fail to load; a silently empty choice
list should not pretend the founder has no businesses or offer an invisible default foundation.

## Input and projection boundary

POST /api/needs currently persists arbitrary constraints, including negative price, extra contact
and huge payload;005a copies it into projects. Define strict finite bounded allowed fields for
family, max_price_cents, online, confirmed_only. Reject wrong types, unsafe/negative amounts and
unknown keys on new writes with useful400s. Reuse a single clear parser, avoid duplicate drifting
schemas. Project only allowed canonical fields from old rows; malformed legacy fields must not
crash public views or leak extra metadata into source snapshots. State how invalid historical
constraints are represented (unknown/not usable, never silently satisfied). Preserve valid hard
constraints and do not reinterpret a customer price limit as project cost or revenue.

## Acceptance

API tests for scalar/array/nested/wrong-type constraints, unknown keys, huge values, negative,
fractional and unsafe prices, validzero and valid limits; preexisting malformed rows cannot
leak extras or crash board/review/project source. Test existing legacy need workflows too.
Controller tests: committed-lost reply with typed-ahead edits, recover exact original, late
success while typing, source closure before recovery, actor/route change, reordered reads and
choice-list failure. No extra projects/replies on recovery. Run check/build and report.

Keep copy concise: public request, optional price limit, reply permission and clear actions are
primary; place detailed classification/provenance explanations behind expandable context where
useful. No fake demand or hidden limitations. Preserve the tested1440/1280/390 layout.

No external messages, automatic model/build calls, public publishing, contracts or new services.
Commit bounded fixes then003i. Priority P1/M; fullM5 remains open.
