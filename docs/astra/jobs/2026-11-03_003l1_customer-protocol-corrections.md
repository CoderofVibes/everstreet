# Make the customer-use protocol precise before admission

**Why (Tony's words):** "the seamless purchase and transfer of business/product to the
investor/acquirer, on NEAR" must stay central. Customers must retain service and units.

## What the person sees and does

A customer reviews an exact use before signing, can recover an uncertain reservation, and is
not told their units are free or charged without evidence. A business negotiating a sale keeps
serving customers; a potentially 30-day offer must not shut down its product.

## Underneath

Astra reviewed CUSTOMER_USE_RUNTIME at e0ba6aa and the actual v3 methods. Correct the following
before003m, with source references and tests/contract fixtures where they establish semantics:

1. require_metering permits the current owner. With no successor grant the platform loses
   authority, but "nobody can settle" is false. Do not classify all outstanding uses uncharged.
2. validate_terms in Gated mode requires ANY METERING grant, not the platform account. Platform
   identity/readiness is an app/closer policy, not an existing contract guarantee. Capture the
   owner-without-grant and unrelated-successor-account distinctions with actual unit methods.
3. Accepting can last30days; closing10min-24h. Remove the blanket accepting freeze. Describe the
   continuing same-operator path, an explicit bounded close/drain policy and missing-grant
   recovery. A pinned pre-dispatch read cannot eliminate a subsequent close or revocation race.
4. Preparation must precede client signing: persist exact input/release/plan/request/salt/slot
   commitment and consent, return a versioned canonical signing envelope, then verify submitted
   signatures against that exact envelope. Specify unambiguous byte encoding (not bare ||),
   domain, types, lengths, canonical decimal/hex, account/network binding, expiration and how
   the client verifies what it is consenting to. Server never holds a customer private key.
5. reserve_unknown cannot resolve using hold_active/sequence alone. Specify complete account,
   registration/key epoch/slot/public key, plan, units, deadlines and hold identity checks plus
   pinned evidence/coherence. Advanced history, missing records and uncertain ordering do not
   establish non-execution or authorize a fresh hold. Resend only when exact replay is safe.
6. A closed root requires the complete ordered used-slot fingerprints and bitmap, including
   slots belonging to other requests or devices. Incomplete history/root mismatch stays unknown,
   not unsettled_after_deadline. Expiry alone does not prove a prior charge never happened.
   Distinguish positive charged proof, closed unused proof, conflict and unavailable history.
7. Persisted dispatch intent does not prove a provider received a request. State at-most-once
   automatic dispatch, lease-generation/CAS fencing, unknown outcome and provider idempotency
   constraints. Do not promise universal exactly-once execution. Separate stale worker writes
   and ambiguous delivery from deterministic refusal.
8. Revocation is observed with latency; already running calls cannot stop atomically on a chain
   write. Define admission bounds, stale-read refusal and late result/settlement handling.
9. Define encryption/retention seams and configurable deadlines without claiming they exist.
   No plaintext production persistence fallback; synthetic fixtures only until configured.
10. Replace contradictions in state/interruption tables. Clearly separate implementation
    authorization (already granted) from forbidden live signing/deploy/spending. No routine
    design approval from Tony is needed. Live dependencies remain unconfigured and disabled.

## Done when

The design gives concrete prepare/confirm/reconcile APIs and durable identities suitable for
003m. Contract assertions match actual methods, and fixtures distinguish the authority cases.
Run relevant keyless Rust tests/clippy for changed tests and npm run check. Report verified facts
versus proposed behavior. Do not change deployed or undeployed contract behavior to fit prose.
Proceed to003m only when these contradictions are resolved; otherwise report the concrete blocker.

## Not in this job

No live endpoints, provider calls, wallets, key custody, signing/deployment or main wiring.
No research assessment. Existing owner trials and all six milestones remain intact/open.

## Priority and size

P0/M, before003m. Local review/commits by Claude; no push.
