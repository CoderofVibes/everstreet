# M2: real AI creation with isolated builds and recovery

**Why (Tony's words):** "If we give them what is a good solution for building within a
platform that will then showcase their product.. I mean, that is huge especially for the
future wave of builders and developers."

## What the person sees and does

Extend the persisted studio from job 001: turn an idea into a proposed editable product brief,
generate a real supported product, inspect a working preview, request a change, compare and
restore versions, run customer-journey checks and prepare a release. Persist progress and
results across refresh/restart; provide clear cancel/retry actions and useful failure details.
Show usage and budget before and during a build. Never imply success from provider text alone.

## Underneath

First read job 001's report and `docs/design/BUILD_RUNTIME.md`; split this large job into
reviewable implementation slices with Astra before execution. Use a supported authenticated
API provider and a provider-neutral interface; keyless tests inject deterministic doubles.
Validate all generated artifacts. Arbitrary code executes only in an actual isolated worker
with controlled network/filesystem/resources, never the application host. Keep preview and
platform origins separate. Credentials remain server-side and scoped. Default unavailable
when the required provider or isolation runtime is absent; no silent fake AI.

Initial product: a document-to-structured-data API with an accompanying web client, fictional
test documents, request usage accounting and a repeatable model evaluation set. Establish
versioned product identity and entitlements that M3 can attach to NEAR ownership. Separate
the AI that builds a product from the AI calls made by that product for its customers.

## Done when

An authorized founder can generate, run, revise, test and recover one working product. A
different founder cannot access its builds/artifacts. Cancellation/restart/idempotency and
resource limits are exercised. Live provider and sandbox verification are reported separately
from keyless tests; lacking a required live dependency leaves this milestone incomplete.
`npm run check` and build pass. Astra completes browser and artifact review. Report evidence,
usage, commit(s), limitations and next job; update JOBS.md.

## Not in this job

No new purchases/top-ups, public deployment, Git push, mainnet or uncontrolled shell execution.
No production identity claims based on local actor switching. Never read or print secrets.
Existing API credit is authorized, but confirm a configured budget and no automatic top-up
before unattended live calls. Continue keyless work if live integration needs setup.

## Priority and size

P0 / XL; depends on 001, requires subdivision. Alongside M3 design, before broader templates.
