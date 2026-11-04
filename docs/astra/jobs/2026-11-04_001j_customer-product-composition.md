# A focused customer product experience

P1/M-L after001i. Tony approved a distinct polished customer experience within the shared
luminous Everstreet identity. This is the customer doing useful work with a digital product.
The founding/acquisition platform stays reachable without competing with the current task.

## Grounded baseline

Astra inspected the actual preview-customer --with-offer UI, built at69940a0, as fictional Cara.
1440 desktop has input, result and unit/history columns;390 fits horizontally. A106-character
fictional invoice -> Review one use creates a ready-to-review request, with no reservation or
charge. No Authorize click or signer call was performed. Two screenshots in docs/astra:
customer-before-001j-desktop-2026-11-04.jpg and customer-before-001j-phone-2026-11-04.jpg.

Useful existing behavior: explicit product/business identity, result retention, exact one-unit
terms, account/network/deadline, distinction between prepared and held, browser envelope checks,
recent request link and no invented balance. Preserve it. Phone currently stacks a large empty
Result card (CSS min-height360px) before unit state/history. Repeated preview explanations take
substantial space; preview provenance must remain explicit but can have one clear contextual home.

## What to build

Make one clear working surface for input -> review -> processing -> result/recovery. Desktop can
use input and output side by side once useful; phone should foreground the active step and show
unit/recovery status near it. Empty result needs a compact meaningful placeholder, not a tall
blank card. Do not reorder controls under the user's pointer or lose typed input on view changes.
Result data should be readable, selectable and easy to compare with declared fields and notes.
Partial/invalid/refused/expired/deleted results must never resemble a valid successful extraction.

Offer summary states the product's actual supported input (currently pasted text), output and
unit cost. At review retain every meaningful authorization term: product, exact price/asset,
one use, account/network, retention, expiry and input binding. Cryptographic identifiers can be
in clearly labelled expandable technical detail; their computation and checks must remain.
Use a human denomination only when verified metadata exists; never infer decimals from names.
Explain retention as this product's accessible-result policy, not a guarantee about all provider
storage. Do not invent privacy certifications, deletion guarantees or model capabilities.

Unit state is clear and source-qualified: not read, nothing held, reserved, charged, returned or
unresolved. A failed read isn't zero; elapsed time isn't proof of refund. Keep same-request recovery
distinct from a new use. A running request must not trigger a second model invocation on refresh.
Cancellation and unavailable authorization/provider controls explain what can happen next.

Customer history/result access remains stable across confirmed ownership change. Do not expose
private acquisition intent, buyer-room information or founder work logs on this surface. Existing
product names remain consistent between storefront, offer, use and history; a changed founder draft
does not silently rename the released product. Preserve My products, recent uses and direct links.

## Underneath and acceptance

Read CustomerProduct.tsx, CustomerOffers.tsx, customer controller/API and existing result/unit
recovery tests. Write a concise composition/state map before editing. Reuse existing data and
authority; no customer settlement/protocol rewrite or fake automatic transaction. No new provider,
wallet, chain or main wiring. All six milestones and actual live100/20/80 gate remain open.

-1440/1280/390 and keyboard: empty input, review, running, valid result and meaningful failure.
  No blank360px phone result while nothing has run; no hidden focus or overlapping action bars.
- Bounded synthetic test demonstrates lost prepare/confirm/execute/unit answers recover the same
  request, a repeat cannot double-execute/charge, provider failure stays truthful, result retention
  and access loss clear protected data. Use existing protocol tests; don't mirror markup only.
- Actual before/after customer continuity across the existing synthetic sale fixture, explicitly
  distinguished from live testnet evidence. Do not perform external transaction for this job.
- Reduced motion, zoom, direct links, accessible labels/status announcements and mobile history.
- npm check/webbuild, local commit/report listing observed vs pending browser gates. Stop for Astra.

No signing/deploy/push/public release/submission/spending/real data/research access/Day One.
Scope searches before reading. If scope bites, simplify ornament, never recovery or truthful terms.
