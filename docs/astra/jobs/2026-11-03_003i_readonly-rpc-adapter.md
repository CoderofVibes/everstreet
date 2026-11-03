# Connect the v3 observation boundary to a bounded read-only HTTP adapter

**Why (Tony):** seamless acquisition on NEAR stays central.003h/003h1 currently consume an
injected fixture transport only. Implement the actual RPC protocol adapter and prove its boundary
with deterministic HTTP responses before enabling any live contract or ownership integration.

## Scope and sources

Read the current v3 transport/observation note and contract views. Use primary NEAR documentation
for the HTTP protocol; Astra checked these pages November3:

- [NEAR contract queries](https://docs.near.org/api/rpc/contracts): read-only call_function query,
  explicit block identity and returned result bytes/block metadata.
- [NEAR block queries](https://docs.near.org/api/rpc/block-chunk): block with finality final, then
  block_id for pinned reads. Do not mix finality and block_id on a single query.

Use existing runtime libraries or built-in fetch. No dependency upgrade needed by default.
This job authorizes implementation and synthetic HTTP tests, NOT live RPC requests, signing,
deployment, production config changes or main.ts wiring. Default observations remain unavailable.

## Implementation

1. Implement ViewTransport using a trusted explicit TESTNET endpoint configuration and injected
   fetch. It only emits block/read-only view requests for the supported fixed method/argument
   set. No keys, accounts creation, wallet setup, transaction methods, v2 signingChain reuse or
   arbitrary user URL. Reject mainnet configuration in this bounded slice. Tests use fake fetch
   and in-memory responses, never an external endpoint. Document endpoint trust, not proof.
2. Pin the final block, query all views at its hash, validate envelope/id/JSON-RPC errors, byte
   arrays and UTF-8, and carry returned block height/hash to existing consistency checks. Keep
   heights exact; reject unsafe numeric JSON heights rather than round them. Bound response
   bytes while streaming, decoded result sizes, counts, concurrent calls and overall elapsed
   time. Cancellation must abort fetch/body reads, not merely abandon Promise.race while work
   continues. Reject redirects and malformed endpoints; raw URLs, credentials, headers, RPC
   log strings and error bodies must not enter public errors or audit events. No retry loop or
   silent failover to another source. Archive/unavailable/method errors remain truthful codes.
3. Integrate at the existing injected options seam so the real adapter can feed V3Observations
   in tests. Check configured network with explicit trusted testnet identity rules; do not call
   arbitrary endpoints network-verified merely because they were labelled testnet. Document what
   is verified versus operator asserted. Owner epoch fencing still runs after async work.
4. Add an idempotent transactional upgrade for old003h observation rows whose digest included a
   period. Preserve source/high-water/outcomes/projection/flags, move old period evidence with
   its original block/time and recompute core digests. Validate stored data before migration;
   malformed data fails clearly without destructive partial updates. Do not clear a genuine
   conflict automatically. Tests construct old-schema rows in isolated DBs; never inspect or
   mutate Tony's runtime DB. Restart/reapply must be safe. Document format version and evidence.

## Acceptance

Transport+actual API/service tests with synthetic HTTP envelopes and real Rust JSON fixtures:
valid Direct/Gated read; exact block hash in every request; unsupported methods/args and network;
unsafe heights; HTTP/RPC errors; malformed result bytes/UTF8/JSON; response-ID mismatch; mixed
blocks; oversized chunked body without Content-Length; stalled fetch and stalled body; abort
on total timeout and bounded parallelism; redirect rejection; error sanitization; ownership
loss while awaiting transport; unconfigured state. Test migration populated core+period data,
sticky flags, failed migration atomicity, repeat/restart and exact replay without false conflict.

Run check/build (Rust only if fixtures actually change), bounded local commits and report. Stop
for Astra review after this job. No live read, UI live-connected claim, ownership reconciliation,
managed closer,100/20/80 end-to-end orM3 acceptance. Next integration will separately connect
the owner-facing status and exact acquisition intent/reconciliation to this evidence boundary.

Priority P1/M-L, after002a2 and005a1. All six milestones remain in scope.
