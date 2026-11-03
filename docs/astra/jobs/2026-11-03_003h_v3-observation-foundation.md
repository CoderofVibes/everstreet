# Read digital-business control and books without inventing a completed transfer

**Why (Tony):** seamless acquisition on NEAR is central, alongside building and operating a
digital business.003g now has actual sale methods in unit tests; the app still speaks v2.
Build the first read-only v3 boundary so later customer/runtime/close integration consumes exact,
durable observations rather than loose JSON or latest-response-wins state.

Read AUTHORITY.md, BUSINESS_V3_CORE.md, BUSINESS_V3_SALE.md,003g report/current view structs,
server chain/deals/store/books boundaries and Astra's003g review. Write a short implementation
note first describing trust, ordering, source identity and failure semantics. This job authorizes
only the bounded read model and tests below; it does not authorize signing or the runtime closer.

## What the application can report

For an explicitly bound v3 business: the last observed owner/generation, direct/gated mode,
manifest pointer, proposed/accepting/closing deal or observed outcome, reserve/available/customer
liability/pending claims/escrow and exact economic categories. Include source network/account,
schema identifier, block hash/height, finality evidence, observation time and freshness. Unknown,
unavailable, malformed, contradictory and history-gap states stay distinct from closed/paid.
A manifest hash is never called available code; a configured closer is never called a verified
handover. An observation is not authorization to give a person control of the app.

## Bounded implementation

1. Separate v3 reader/decoded types from the signing v2 Chain. Inject a read-only view transport;
   it cannot create accounts, read key files, sign or broadcast. Default unavailable. Implement
   control/outcomes/treasury/pending plus one explicitly requested period. Bound lengths/counts,
   enums and valid numeric encodings. U64/U128 values remain decimal strings/BigInt through all
   comparisons; never Number for money, sequence or heights. Match actual Rust JSON field names
   and tuple shapes. Reject unsafe/truncated/mismatched data before persistence.
2. Read a coherent snapshot at one pinned block identity; no mixing latest reads across blocks.
   Validate returned identities match the requested block and bound network/account/schema.
   Transport asserts provenance, not cryptographic truth; document this trust explicitly.
   No live RPC calls for development/tests. Use injected deterministic transport and real Rust
   unit-produced JSON fixtures for representative actual sale/control/treasury views if useful.
   Serialization-fixture tests may be added to business-v3; no contract behavior changes here.
3. Durable SQLite observation records and current projection update transactionally. Exact
   duplicate is idempotent; stale block/control information cannot overwrite newer observations.
   Equal control_seq can have newer treasury/customer changes: order by pinned block as well.
   Conflicting same block/control evidence fails closed. Missing outcomes after the8-entry ring
   wraps must say history incomplete; never manufacture a sale or a seller settlement.
   Specify bounded retention and a stable high-water mark that survives restart/pruning.
4. Add an owner-only application read/refresh API using explicit operator-supplied v3 bindings
   through injected app options or equivalent trusted registration. No user-supplied arbitrary
   RPC URL, account binding or public import route. Capture and recheck local control epoch after
   every await and inside writes. An observed owner mismatch reports reconciliation required;
   it does not silently reassign app ownership, grant new access, or expose private project data.
   Keep raw untrusted errors/data out of public routes/audit logs. Unconfigured existing v2
   businesses continue unchanged with truthful unavailable status for this new capability.
5. Produce the exact next integration contract for reconciliation and a future managed closer:
   which evidence is required, what remains unavailable, and how current v2 paths are kept
   distinct. Do not implement freeze/drain/signing/journal close submission in this job.

## Acceptance

Actual API/service tests: valid direct/gated snapshots; actual serialized Rust examples; values
above2^53; malformed values and unknown enums; mixed block identities; timeouts; duplicate and
reversed completion; control sequence unchanged while funds change; ownership away-and-back
during await; caller loses access; same-height conflict; unknown mapping; history ring gap;
restart preserving high-water mark; source identity changes; bounded retention. Validate business
and tenant isolation. No actor can claim a v3 binding or turn an observation into ownership.

Run rootcheck and relevant Rust unit tests if fixture tests added. Report exact implemented
methods, supported schema, persistence, API, evidence and remaining gates. No UI wiring claiming
live connection; no main.ts production wiring, scripts/config, v1/v2 changes, deployments,
provider calls, signing, external network calls or new dependencies unless separately justified
within existing approved tooling. Contract-only fixtures remain synthetic. No M3 completion.

Priority P1 / M-L, after004a2. Commit bounded types/service/tests/report locally; stop for Astra
review before application ownership reconciliation or managed runtime integration.
