# M3: digital commerce and acquisition continuity on NEAR

**Why (Tony's words):** "One key function of Everstreet is the seamless purchase and transfer
of business/product to the investor/acquirer, on NEAR. So, that has to stay central to this
as well."

## What the person sees and does

A software customer prepays for 100 uses, consumes 20, and retains 80 after the business is
acquired. Their access keeps working. The founder sees delivered revenue, customer obligations,
compute costs and profit charts. A buyer inspects scoped evidence, understands exact transfer
contents, accepts terms and receives working operational control. Old administrative access
is refused. Present a transfer rehearsal and the buyer's first shift.

## Underneath

Review `docs/AUTHORITY.md`, existing v2 contract, payments/deals/books modules and job 002's
runtime boundaries. Design the entitlement ledger, consumption idempotency, refunds,
authorization generation and runtime ownership reconciliation. Existing class paths remain
valid. External accounts and legal/IP transfers are separate verified items. Customer data
stays off public ledgers. Broader customer price guarantees must match actual enforcement.

Start with an architecture delta and keyless contract/service tests. Claude owns all NEAR
changes; Astra never signs or deploys. Testnet validation needs a bounded explicit run plan
within Tony's existing testnet authorization and must never touch mainnet. No production
claim is inferred from doubles. Record transaction evidence only when actually executed.

## Done when

The 100/20/80 journey passes before and after sale, stale-owner actions fail, liabilities
remain covered, competing/retried actions cannot double consume or close, and revenue/cost
sources are correctly labelled. Meaningful tests plus visual review pass. A live testnet
evidence gate remains open until the complete digital journey is independently verified.

## Not in this job

No public release, push, mainnet, legal-entity transfer claim, new spending, or destruction of
Tony's existing Juniper demo. No wallet keys in generated products, browser payloads or logs.

## Priority and size

P0 / XL; design after 001, integrate with 002. Subdivide into reviewed jobs before executing.
