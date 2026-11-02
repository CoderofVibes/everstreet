# M3p: evidence stays within the seller's disclosure choices

**Why (Tony's words):** "A great one stop shop for builders, investors, and clients in need
of services to all come together and exchange on NEAR."

## What the person sees and does

The seller understands exactly what an acquisition listing, access grant and sale terms
disclose. A buyer sees only permitted evidence. Revocation/expiry prevents new server reads;
an open browser clears private evidence when access or identity changes and rechecks on
returning to the tab. Explain that an exported copy cannot be recalled.

## Underneath: verified source findings and review qualifications

Read `reports/2026-11-02_financial-integration-review.md` critically. Astra verified:
`Acquisitions.room` and `tryScenario` authorize before asynchronous financial reads but do
not recheck before returning. `saveScenario` checks again, but must also recheck the required
category. `AcquireRoom` retains old room state on identity change and allows late responses
to replace newer state. `Deals.buildTerms` automatically embeds private financial facts.

Some review findings are scope ambiguities, not established unauthorized access: the current
listing choice explicitly says "estimate and its calculation", and operations includes
customer promises. Do not call those bugs solely because they contain numbers. Define a
consistent disclosure model: separate valuation range from detailed inputs, and distinguish
operational promises from treasury amounts. Show precise descriptions at consent time. An
unchecked revenue/profit choice must not create a contradictory promise while a calculation
reveals the same inputs. Do not silently narrow or expand existing saved disclosures; use
explicit versioning/compatibility behavior and label historical choices.

Revalidate membership, role, grant categories, expiry, listing/business ownership after the
last await and before serializing or committing private data. An access-version or equivalent
fence must catch revoke-and-regrant under narrower categories while a read is in flight.
Apply one scoping function to room, export, scenarios and future chart endpoints. Add no-store
headers to authenticated evidence and derived financial responses. In the browser, scope
responses to actor/request epoch, immediately hide stale evidence, abort/ignore old requests
and clear on 403. A network error must not expose the previous actor's room.

Treat immutable sale terms separately from a revocable live evidence room. For new terms,
make retained evidence an explicit seller-selected, previewed snapshot with a clear audience
and retention explanation; omit optional financial figures by default unless authorized.
Necessary liabilities/pricing obligations still must be disclosed and agreed for the sale.
Do not retroactively alter the bytes/digest of historical accepted terms, or imply revoking a
room recalls a contractual snapshot already shared with its parties. Coordinate with 003b
and the v3 terms design before changing `deals.ts`.

Review anonymous sort/filter behavior: ordering must not reveal exact hidden values within
an advertised band. Buyer saved scenarios should keep only the data they need under the
same continuing access boundary, not become a backdoor after grant revocation.

## Done when

Astra reproduced the in-flight grant gap: room/export/try returned private results with 200
after revocation, while scenario save correctly refused with 403. See
`../reports/2026-11-02_evidence-access-review.md` for the controlled-gate sequence. Turn it
into regression tests while fixing it. Gate financial reads while revoking,
expiring, narrowing or changing buyer membership, then assert no private result escapes.
Test sequential and concurrent access for room/export/try/save scenarios and chart adapters.
Test value-only/operations-only disclosures against the documented scope, no-store headers,
anonymous within-band sorting, and unchanged hashes for old terms. Browser review switches
identity during a delayed read and verifies immediate clearing and no late repopulation.
Run `npm run check` and web build. Preserve the existing permitted-export limitation.

## Not in this job

No live payments, transactions, deployment or access to real customer data. No promise to
delete a downloaded copy or make public chain amounts private. No unrelated identity rewrite.

## Priority and size

P0 / M. Foundational access fences before 003f adds charts; deal terms after 003b coordination.
