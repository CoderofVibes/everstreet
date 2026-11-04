# Durable customer preparation and reservation

**Why (Tony's words):** "one key function of Everstreet is the seamless purchase and transfer of
business/product to the investor/acquirer, on NEAR." Build the first actual customer admission
foundation so customer identity and units are independent of the business owner's identity.

## What the person sees and does

Prepare one use of a supported released digital product, review the exact consent, submit the
customer's authorization, and recover that same reservation after an interrupted reply. The
customer sees prepared, awaiting reservation, reserved or unknown with a useful explanation.
This slice provides backend capability for the later customer UI, not an enabled live service.

## Underneath

After003l1, implement the corrected preparation/reservation portion only. Read current runtime,
release, chain_accounts, v3 observation/API authorization and DB migration conventions first.

1. Persist immutable offer/release/plan/contract binding and customer request identity. Trusted
   configured mappings only: customer body cannot choose another person's chain account, business
   contract or released artifact. Existing local fixture identity is not wallet authentication.
   Offer administration is owner-authorized and fenced against concurrent handover; consumer
   records are customer-authorized, not owner-authorized. Offers remain business-owned at sale.
2. Prepare/confirm/status API through injected options in the real app factory. Preparation
   persists the exact canonical consent/signing envelope and expiration before returning it.
   Confirm checks exact envelope and HoldAuth/UseAuth signatures/public key/registration/epoch
   against trusted pinned evidence. Repeated identical keys recover the same preparation;
   changed input, offer, release or terms conflict instead of silently mutating it.
3. Use a bounded, explicitly documented hold allocation policy. A one-unit/one-slot hold per
   request is an acceptable first implementation if the contract permits it and its throughput
   limitation is stated. Concurrent requests/devices may not allocate or reuse the same slot;
   a lost response must never allocate a new hold. Do not claim local locking controls external
   wallets: readback conflicts stay explicit. Bounded input/rows/retention and validation.
4. Durable reserve_requested/reserve_unknown/reserved state with append-only events, exact
   payload persistence and worker lease generation/CAS. Network awaits outside DB transactions.
   Injected chain writer/read transport only; production without configuration says unavailable
   and performs no side effects. Do not wire main, auto-start a worker or add signing code.
5. Reconcile exact pinned reservation evidence under003l1 rules, including stale/conflicting
   evidence, timeout, lost reply, external hold advance, revocation and ownership/operator
   changes. Local state alone is never evidence that a chain hold exists or never executed.
   Polling/retries bounded; competing/stale workers cannot overwrite newer outcomes. Record
   what network/account/block and exact authorization an outcome is supported by.
6. Private input persistence requires an injected storage-protection seam with no plaintext
   production fallback; minimize stored input if a digest is enough for this reservation slice.
   Keep salts/signatures/raw inputs out of public listings, events/logs and owner responses.
   Customer status discloses only that customer's preparation and reservation. Another customer,
   seller, or new owner cannot read it. Recheck caller authority after awaited work.

## Done when

- Real API tests cover prepare/confirm/recover and changed-payload idempotency conflicts; wrong
  person, wrong offer/release/account/registration/key/epoch/sequence/slot/deadline/signature;
  cancelled/expired preparations; no configured adapters; bounds and malformed input.
- File-backed reopen/restart, two requests racing, stale lease result, missing reserve reply
  after acceptance, advanced hold history and exact replay are tested with finite fixtures.
- Actual Rust-produced readback fixtures are exercised, with all synthetic mutations labelled.
  A fixture-backed fake is not claimed to execute a real chain transaction or prove live auth.
- A sale changes owner/operator authority without changing the customer's request or entitlement
  identity; customer recovery persists and former/new owners cannot inspect private requests.
  Accepting alone does not pause compatible customer service. Unknown authority fails closed.
- Existing owner-trial checks still pass. Run npm run check and web build; relevant keyless Rust
  checks if fixture/test changes. Report capability boundaries, tests and exact commits.

## Not in this job

Provider dispatch, result delivery, settlement/release workers and customer UI follow after
Astra reviews this slice. No fake success or fabricated balance changes. No production wallet
authentication, real keys, signing, live endpoints/providers, token purchases, deployment,
package/billing changes or research assessment. No claim that M2/M3 or any milestone is complete.

## Priority and size

P0/L, after003l1; implement and stop for Astra review. Claude is the only writer and commits
locally after checks. Resource fixtures must have independent finite ceilings; restore any
deliberate mutation in finally and inspect diff before running a full suite.
