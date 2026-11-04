# Keep customer obligations moving without leaving a page open

**Why (Tony's words):** seamless purchase and transfer is central. Customer service cannot
depend on the founder or customer repeatedly pressing recovery buttons or keeping a tab open.

## Scope and experience

Implement a bounded background maintenance supervisor for the existing digital customer runtime.
It advances already-authorized reservations, decidable unit settlement/release and protected-data
cleanup through existing service boundaries. It must never prepare a new request, sign for a
customer, rerun an uncertain provider call, decide a sale or grant itself operating authority.

The owner sees a concise read-only maintenance status: unavailable/not started, running with a
recent heartbeat, overdue/stopped, or needing attention. Show last completed pass and useful
aggregate counts without private customer content or per-customer records. Readiness distinguishes
configured deletion capability, observed scheduled work, successful deletion and failures.
Customer units/results continue to use actual request and contract evidence, never worker intent.

This slice is injected/keyless and locally testable. Production main.ts stays unchanged; no live
wallet/provider/RPC adapters or credentials. Start the supervisor only explicitly in the isolated
preview/test harness. Implement production-quality scheduling/records as a module, with the real
deployment integration recorded as a separate gate. Do not add an app button that enables live
signing or global worker access. The build-agent worker is separate and out of scope.

## Checked integration points

customerUse.ts exposes reconcileDue (expired preparations/reservation steps), settleDue,
expireResults and expireInputs, currently called explicitly by tests/customer actions. Existing
reservation/unit steps already have generation leases and authority/evidence checks. Delivery
finalization has a durable pending/final decision and timeout. invocations.ts has ManagedRuntime
recovery; inspect its semantics before reuse, never repeatedly orphan an actually running call.
Result cleanup readiness currently correctly reports that no pass is scheduled.

Source selection concerns to test first: settleDue takes the oldest25 reserved rows, including
not_decidable rows, so later decidable work may starve; expireInputs takes the first200 refs before
filtering deletable ones; failed oldest result deletions can monopolize a batch. Do not conceal
these issues by increasing limits or looping an unbounded number of batches.

## Implementation requirements

1. One explicit supervisor lifecycle: start, bounded pass, stop/drain. No overlapping ticks;
   bounded concurrency, batch size, per-operation deadline and aggregate pass budget. Scheduling
   and dependency injection are testable with a controlled clock. No retry loops or unbounded
   promises/streams; noncooperative adapters cannot cause continually accumulating work.
2. Durable coordination for more than one process and restart: claim/renew/expire a worker lease
   or equivalent proven fencing, retain per-request leases, and never let stale work resurrect
   a result or apply a unit decision. No remote await inside a database transaction. Atomic
   transitions and actual adapter outcomes determine recorded progress. Demonstrate two worker
   instances and crash/restart behavior against the same disposable database.
3. Fair bounded selection/backoff: undecidable, conflicted, stopped or repeatedly failing rows
   cannot block unrelated eligible work. Retry only safe idempotent operations with caps/backoff;
   preserve unknown charge/return/protection outcomes as unknown until exact evidence resolves
   them. Keep conflict/manual-attention states sticky. No automatic provider redispatch.
4. Cleanup has separate capability and observed execution facts. Retry transient failures without
   counting them deleted; scheme/retention and in-flight delivery rules remain enforced. Audit
   metadata contains only safe counts/codes/times, not input/result, raw errors or protection refs.
5. Ownership transfer does not stop eligible customer maintenance, but every eventual metering
   call still requires current contract authority. Revoked platform authority pauses that work
   honestly; unrelated safe cleanup can progress. Reappointment permits safe existing recovery,
   no new consent or duplicate charge. No automatic acquisition reconciliation from a timer.
6. An owner-scoped status/readiness projection is bounded and fenced against ownership changes.
   Former owner cannot read successor maintenance details; customer sees only their own existing
   status. A heartbeat alone does not prove every subsystem healthy. Keep frontend status concise
   and actual-event refreshed, consistent with001b1, without exposing implementation plumbing.

Write a short concrete design explaining pass ordering, failure/retry and restart guarantees,
resource caps and exact wiring limitations before implementing. Claude owns script/config work;
no package change needed unless an unavoidable concrete requirement is reported.

## Done when

- A completed use automatically reaches exact charged/returned evidence in the isolated runtime
  without a customer settle click. A prepared unsigned request never becomes authorized. Unknown
  provider work never reruns. Retention expiry refuses reads and cleanup accurately records its
  result, including failures/retries.
- Finite tests cover simultaneous workers, lease expiry/stale callback, stop during an await,
  restart, hanging adapter, mixed schemes, backlog > batch, failing/undecidable oldest work,
  unavailable adapters, delivery timeout and sale/revoked/reappointed metering. Prove fairness
  with bounded passes rather than a test that duplicates the selection SQL.
- An isolated preview demonstrates worker stopped/running/attention states, eventual customer
  unit completion and cleanup, without live calls or Tony's runtime DB. Provide exact launch/
  stop controls. No listeners/processes left running after your verification.
- npm run check/web:build and relevant keyless tests pass. Report limits, exact commits and
  remaining live integration gates. Stop for Astra review after this bounded job. All six
  milestones stay open; synthetic maintenance is not live NEAR or production operation proof.

P1/L after001b1. No signing/deploy/main wiring/live calls, spending/billing, public push/release,
submission, real data, local research access/assessment or Day One. Preserve the complete roadmap.
