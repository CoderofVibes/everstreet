# 003i report: a bounded read-only testnet RPC adapter, and the observation-format upgrade

Claude, 2026-11-03. Job: [003i](../jobs/2026-11-03_003i_readonly-rpc-adapter.md).
Commit `39d32ee`.

**Files:**

- `server/src/v3rpc.ts` (new);
- `server/test/v3-rpc.test.ts` (new);
- `server/src/v3read.ts`, `server/src/v3observe.ts`, `server/src/db.ts`;
- `docs/design/V3_OBSERVATIONS.md` (new §8).

Not touched: `main.ts`, configuration, signing, deployment, v2 and the contract. The fixtures are
unchanged, so Rust wasn't rerun.

## The interruption, and what I found on resuming

The previous run (exec83497) ended during local host trouble, mid-way through mutation testing.
Three deliberate mutants were still in the uncommitted `v3rpc.ts`, as Astra's recovery note said:

- the response-id check gated by `id === "mutant"`;
- the gate capacity multiplied by 100;
- the body cap multiplied by 10⁶.

I reverted exactly those three and kept the rest of the implementation.

**The likely cause of the hang (unconfirmed).** The body-cap mutant explains a suite that doesn't
finish. With the cap multiplied by 10⁶, the oversized-body test's synthetic stream, which produced
64 KiB chunks forever, would be read up to about 256 GB, growing memory instead of failing. That
plausibly also strained the host. I haven't confirmed the host cause; the run left no error
showing it.

**Test hardening:**

- That stream now closes itself after 4 MiB. A broken cap now fails the test in milliseconds; I
  checked this by re-applying the mutant: it fails in 19 ms.
- One mutant (response id) had passed for the wrong reason: the mismatched answer also lacked a
  block header. That case now carries a valid result, so only the id check can refuse it, and the
  mutant is caught.

**Leftovers.** 13 test database files from earlier failed or interrupted runs (fictional data, in
`server/test`) were deleted. All deleted cleanly, so no process held them open.

**Process check.** Listing processes needs an approval I don't have in this session, so I couldn't
inspect them directly. Every run since then finished normally: the full suite takes 3.4 s.

## What was built

**The adapter** (`TestnetRpcTransport`, a `ViewTransport`) follows the official NEAR RPC pages for
contracts and blocks. It reads in two steps:

1. `block` with `{ finality: "final" }` pins the block.
2. `query` with `call_function`, `block_id` set to that hash, then reads each of the five fixed
   views with exact arguments, base64-encoded. `finality` and `block_id` are never combined.

The result is fed to the existing 003h/003h1 decoders and coherence checks unchanged.

**Validation:**

- **Envelope.** `jsonrpc` must be 2.0, the `id` (unique per request) must match, and exactly one of
  `result` and `error` must be present.
- **Block identity.** Heights must be exact safe integers (2⁵³+1, a negative, a string and 1.5 are
  all refused), hashes must be base58, and every answer's `block_hash` must equal the pinned one.
- **Results.** Byte arrays only: 0–255 integers, at most 64 KiB, strict UTF-8.
- **Contract failures.** A contract failure (HTTP 200 with `result.error`) becomes
  `execution_failed`; its text and logs are dropped.

**Resources:**

- **Deadlines.** `readSnapshot` now has one overall deadline. Its `AbortSignal` reaches the
  transport, so a timeout aborts the fetch and cancels the body stream; nothing is abandoned
  running. Each request also has its own deadline.
- **Bodies.** They are streamed under a byte cap, without trusting `Content-Length`; a declared
  length over the cap is refused before reading.
- **Concurrency.** Requests are gated, with waiters released on abort.
- **Redirects and retries.** Redirects are refused (`redirect: "error"`, and any 3xx). There are
  no retries and no failover.

**Configuration.** It must name `testnet` and an `https` endpoint with no credentials, query or
fragment. A host naming mainnet is refused, as are bad limits.

**Errors.** Each failure is a fixed code: `unsupported`, `block_unavailable`, `unknown_account`,
`execution_failed`, `rpc_error`, `too_large`, `timeout`, `unavailable`, `malformed`,
`mixed_blocks`. The documented causes `UNKNOWN_BLOCK`, `GARBAGE_COLLECTED_BLOCK`, `UNKNOWN_ACCOUNT`,
`INVALID_ACCOUNT` and `NOT_SYNCED_YET` each map truthfully. No URL, header, body, RPC message or log
reaches a response or an audit event.

**The integration seam.** The adapter is passed into `V3Options.transport` like the test double. A
transport fixed to testnet refuses a binding for another network before sending anything, and the
owner's control epoch is still checked after the await.

**The upgrade** (`upgradeObservationFormat`) runs when `V3Observations` is constructed:

1. It validates every 003h-era row first.
2. In one transaction, it rewrites snapshots core-only with recomputed core digests, and moves
   each month to `v3_periods` with its original block and time (the newest per month wins, up to
   24 months).
3. It records `v3_meta.observation_format = "2"`.

**Left untouched:** the high-water mark, sources, outcomes, the projection, and flags. A genuine
conflict flag stays.

**Repeat runs and failures:**

- **Idempotent.** A repeat or a restart does nothing.
- **Malformed rows.** If a stored row is malformed, nothing is written. Only the v3 capability
  pauses (`paused`, code `format_upgrade_failed`); the app keeps running.

## Evidence

`server/test/v3-rpc.test.ts` has 19 tests. All HTTP is synthetic: an injected `fetch` builds
in-memory `Response` objects from the real Rust-produced fixture JSON, encoded as byte arrays, so
no test can reach an endpoint.

| Area | What is shown |
|---|---|
| Protocol | The Direct snapshot (with a month) is read exactly as the real fixture says. The block request uses `finality: final` only. All five queries name the pinned hash, carry no `finality`, use `redirect: "error"`, and send the right arguments. Request ids are unique. |
| Refusals before sending | Unsupported method, extra arguments, a bad month, a bad account, a mainnet view or block, and a mainnet binding all give `unsupported`, with zero requests sent. Eight unsound configurations throw. |
| Exact heights | 2⁵³+1, -1, `"string"` and 1.5 are each `malformed` |
| Errors | HTTP 500 and 503, and a 307 redirect: `unavailable`. `UNKNOWN_BLOCK` and `GARBAGE_COLLECTED_BLOCK`: `block_unavailable`. `UNKNOWN_ACCOUNT`: `unknown_account`. `NOT_SYNCED_YET`: `unavailable`. `PARSE_ERROR`: `rpc_error`. The documented `MethodNotFound` result error: `execution_failed`. |
| Bytes and envelopes | 256, -1, 1.5, a string, invalid UTF-8, a non-array and non-JSON text are each `malformed`. So are six envelope faults: another request's id (with a valid result), a missing `jsonrpc`, both result and error, neither, an array, and non-JSON. An answer from another block hash is `mixed_blocks`. |
| Resources | An endless chunked body with no Content-Length is `too_large`, the stream is cancelled, and fewer than 10 chunks are pulled. A declared oversize is refused. A stalled fetch is a `timeout` within 2 s, with its signal aborted and nothing left in flight. A stalled body is a `timeout` with its stream cancelled. The per-request deadline works. In-flight requests never exceed 2, and queued requests honour the abort. |
| Through the API | A Gated snapshot over synthetic HTTP is recorded, with honest `network_identity` and `provenance` labels. A fictional secret placed in the RPC error, the contract error, the logs and the endpoint path appears in neither the response nor the events. Ownership lost while the transport is awaited gives 404 with nothing recorded. With no transport, the capability is plainly unavailable. |
| The upgrade | Two 003h rows (one with month 202611, one with a null month) on a file database: core-only snapshots, recomputed digests, the month moved with its block and time, and the projection (including the genuine flag) unchanged. A repeat does nothing; after a restart the format is recorded. Replaying block 1000 with its month afterwards is `duplicate` for both the core and the month, not a false conflict. Replaying at the high-water block is a duplicate with no flag. A malformed second row throws "nothing was changed": both rows are unchanged, no months move, no format is recorded, the v3 view and refresh say `format_upgrade_failed`, and the rest of the API answers. |

**Mutation checks** (each reverted; none remain, confirmed by search):

| Mutant | Failing tests |
|---|---|
| No response-id check | 1 (after the case was tightened) |
| Body cap ×10⁶ | 1, in 19 ms |
| Concurrency ×100 | 1 |
| No body `cancel()` on abort | 2 |
| Upgrade skips the height check | 1 |

```
npx vitest run v3-rpc + v3-observe   → 2 files, 67 passed, 2.5 s
npm run check                         Test Files 38 passed (38); Tests 499 passed (499), 3.35 s
npx biome check .                     164 files, no fixes
npm run web:build                     built (existing chunk-size advisory only)
```

## Limits and remaining gates

- **Not a live acceptance.** No real endpoint was contacted, so this shows the adapter's boundary
  against the documented protocol, not that a real testnet node answers the same way.
- **Chain identity isn't verified.** "testnet" is the operator's assertion about the endpoint. I
  didn't check the chain id via node `status`, because the primary pages I could read don't
  document its fields. Chain-id or genesis-hash pinning is a gate before live use.
- **Docs tools.** The NEAR docs MCP tools needed permissions that weren't granted, so I read the
  pages with the web fetch tool instead.
- **Trust.** The transport is still trusted for provenance, with no cryptographic proof. There is
  no light client.
- **Not built:** production wiring, owner-facing status UI, reconciliation into app ownership, the
  managed closer, and 100/20/80 end-to-end. M3 stays open.
- **Pre-existing test cleanup.** The earlier v3 restart and month tests can leave database files
  only when they fail, because they close their stores inside the test body. That's left as it
  was, beyond this job's scope.

Stopping here for Astra's review.
