# Correct customer execution freshness and privacy

**Why (Tony's words):** the platform must support working AI products and a "seamless purchase
and transfer of business/product ... on NEAR" without breaking customer obligations.

## What the customer sees

A lagging endpoint cannot authorize work on an expired hold. A result is unavailable after its
retention deadline even when storage responds late. Customer document text is never written to
business operational records through an error message. Unavailable delivery is not fulfilled use.

## Reproductions at461dfa3

Astra ran three finite real-app probes (153ms, all failed safe assertions). Temporary test was
removed afterwards; recreate permanent regressions first. Common setup: customerWorld with
SyntheticProtection, create offer, prepare input `Fictional invoice 412 USD` with key
astra-exec-0001, confirm with w.signed(envelope), assert reserved.

1. Leave chain/reader unchanged, advance w.clock.now by86400000. POST execute currently returns
   200 and makes one new provider call. Expected zero calls. Same coherent final block is not
   fresh just because the HTTP read was recent or height did not regress. Check bounded block
   age/future skew against injected local clock, plus remaining duration at actual dispatch
   after all awaits. Fail closed on clock uncertainty. Keep chain timestamps as evidence for
   chain facts; local time is admission policy, not a proof that funds were returned.
2. Execute normally. Wrap protection.load: obtain original bytes then advance w.clock.now by
   366 days before returning them. GET result currently200 with content; expected409 expired.
   Recheck current execution/ref/state/retention and customer authorization after load, not just
   before it. Include deletion/replacement and exact-deadline cases. Never return stale loaded
   bytes after access/retention changed while awaiting.
3. Set provider.script to throw new RuntimeFailure('PROBE_PRIVATE_CUSTOMER_DOCUMENT_412',
   'provider_error',null). Execute. SELECT * FROM runtime_invocations WHERE purpose=customer_use
   contains that marker in failure_detail. Expected no marker in business records/events/logs/
   owner surfaces. Use bounded allowlisted customer diagnostics, not truncated provider prose;
   preserve exact cost/usage and useful error classes. Owner-trial semantics remain explicit.

## Related source-review gaps to resolve before settlement

- executionView fulfilled currently means completed/extracted even when result protection fails.
  Separate model validation, durable customer delivery and settlement eligibility. No unit charge
  solely because a model returned data that could not be safely retained/delivered. Add failure
  and crash-between-finish-and-protect evidence; never rerun paid work automatically.
- Protected inputs currently have no expiration/delete path while results do. Add a bounded
  retention policy and cleanup for input refs, cancelled/expired/unexecuted preparations and
  failed/unavailable results; identify deadlines and avoid deleting still-needed work. Do not
  claim failed deletion succeeded. Audit late protection results/orphan references and scheme
  compatibility. All production protection remains injected/unconfigured, no plaintext fallback.
- Cover the artifact_changed path noted untested in003n and verify dispatch config/release checks
  remain correct after awaits. Add tests only where they establish real invariants.

## Done when

Reproductions fail first then pass, with no provider calls on stale/future/insufficient-deadline
evidence; post-await retention and privacy hold; only safely delivered valid work can become
settlement-eligible. Recovery and owner-trial regression checks pass. Update protocol, report,
JOBS; npm run check and web build. No contract changes expected, no live calls or signing.
P0/M before003o. All six milestones remain open; local commits only.
