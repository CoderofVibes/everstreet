# In-flight evidence access: independent Astra reproduction

November 2. Keyless, fictional in-memory stores and an explicit FakeChain double. No runtime
database, network, signer or real customer data. Source tested: acquisition read paths at
`9cb528b` (002b was editing unrelated build files concurrently).

## Sequence

1. Create fictional Ava Chen and Ben Okafor through the local-preview session API.
2. Create a software business and publish it in the in-memory fixture. Register an explicit
   fake business chain account in that fixture so Books invokes the period reader.
3. Create a buying team, list the business with no public financial disclosures, ask for
   financial access and grant it through the ordinary acquisition API.
4. Use a FakeChain subclass whose `period` awaits a controlled Promise and signals entry.
5. Start the buyer's evidence request, await the period gate, revoke access through the
   seller's API, then release the period response. Inspect the original response.
6. Repeat with a fresh grant for export, scenario preview and scenario save. The last path
   is a control: it already rechecks after its asynchronous work.

| Endpoint suffix | Response after revocation completed | Private financial result | Cache-Control |
|---|---|---|---|
| `/rooms/:id` | 200 | yes, financials | absent |
| `/rooms/:id/export` | 200 | yes, financials | absent |
| `/rooms/:id/try` | 200 | yes, base/scenario inputs | absent |
| `/rooms/:id/scenarios` | 403 | no | absent |

A subsequent room read after revocation returns 403. The failure is specifically an
authorization check before an await without a final recheck, not absence of the basic grant.

## Implications for 003p

Recheck the current role, grant version/categories, expiry and owner after the final await
and before returning/committing. Preserve the working scenario-save refusal and strengthen
category checks. The same source inspection finds a browser identity/late-response risk,
but that separate browser sequence has not yet been reproduced. Do not conflate this with
already downloaded snapshots: those cannot be recalled by revocation.

Disclosure-scope concerns in the earlier financial review need product interpretation:
"estimate and its calculation" already warns that inputs are included. A precise revised
consent model is needed, not an unsupported claim that every calculation field is a leak.

This is evidence of a current gap; no production fix was made by this review.
