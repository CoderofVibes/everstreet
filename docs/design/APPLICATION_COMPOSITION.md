# Application composition: modes, the composition root, identity (job 003w)

Status: **design; sub-jobs 003w-a, -b and -c are implemented, with the tests in §6** (after Astra's CompositionDesignReview corrections). The
remaining sub-jobs are listed in §7. 003w is **not complete**. Nothing here was run against a live
chain, wallet or model provider.

## 1. The gap

- **`server/src/main.ts`** (the legacy entry, `npm run app` / `serve`) is a **local preview with
  side effects at import**:
  - it searches the filesystem for NEAR credential files (`.near-credentials`, the home
    directory);
  - it starts the OpenSeat waitlist worker with any key it finds;
  - it builds `NearChain.fromLocalConfig()` (a v2 signing chain from local keys) and reads an AI
    key from the environment;
  - it serves with `localPreview: true`;
  - it supplies neither v3 nor customer options.

  It stays as it is: the legacy preview, documented, **not run by this job** and not the normal
  entry.
- **`AppOptions` and its seams.** `AppOptions` already has the real seams (`v3`, `customer`,
  `runtime`, `appChecks`, preview origins). Only tests and per-feature preview scripts compose
  them, with labelled doubles.
- **Identity.** `localPreview: false` turns off people listing and actor switching. But
  `POST /api/session` still creates a person from a name alone, and a session never expires on
  the server (ApplicationIdentityBoundaryReview).

## 2. Modes

One validated configuration object (`server/src/appConfig.ts`) selects a mode. Nothing else
switches behaviour.

| Mode | For | Identity | Dependencies | Listener |
|---|---|---|---|---|
| `preview` | Local fictional review | Preview sessions: name-only join and fictional actor switching are allowed and labelled | Only those passed explicitly by the caller (synthetic, labelled); none discovered | Loopback only (127.0.0.1); any other host is refused |
| `configured` | A real deployment on **testnet** | **Verified** sessions only: an account proves key control (NEP-413 challenge, §4). No name-only join, no actor switching | Each capability named in the config file, validated, then built (§3) | The configured host (still loopback in this job's harness) |
| mainnet | — | — | Refused by validation in every field that names a network or endpoint | — |

**Session isolation between modes.** Every session row records the mode that minted it. A
`preview` session never authenticates in `configured` mode, even on the same database file.
Rows from before this job are migrated as `preview`.

## 3. The composition root (`server/src/compose.ts`)

`composeApplication(config, deps)` builds everything and **starts nothing**. It returns:
- `app` (the Hono handler with the API and, optionally, the static web app);
- `capabilities()` (the inventory);
- `start()` (recovery, workers and timers);
- `stop()` (clears every timer and worker, then closes the databases).

`server/src/entry.ts` is the normal process entry: read one config file, compose, start, listen,
and on SIGINT/SIGTERM stop and exit. It never reads credential files, never discovers keys, and
never starts the legacy OpenSeat worker or the v2 chain.

**Capabilities.** Each is either **on**, with its adapter, or **unavailable**, with a fixed reason.
A missing one never blocks the others.

| Capability | Adapter in configured mode | Status after this job |
|---|---|---|
| Records | `Store` over a durable SQLite file named in the config | real |
| Protected customer storage | `protectedStoreFromConfig` (003v): its own root, operator-supplied keys | real |
| v3 observation (owner reads, sale reconciliation) | `TestnetRpcTransport` (003i), read-only | real |
| Customer reads (timestamped final block, plan, entitlement, check_use) | `TestnetCustomerRpcTransport` (**003w-c**), read-only | real (new) |
| Customer hold/settle writer | none yet | **unavailable: sub-job 003w-d** |
| Account sign-in | NEP-413 verifier + `TestnetAccessKeyReader` (**003w-b**) | real server side (new); the browser wallet adapter is **003w-e** |
| Customer use authorization (device use key) | page-supplied seam | **unavailable: 003w-e** |
| Model build/runtime | the Anthropic provider, only with an AI config file **and** a named key variable **and** a budget | unavailable without them; never enabled to test |
| Isolated logic checks | WSL worker engine | **unavailable: 002f is partial (13/15); never enabled from that evidence** |
| Maintenance supervisor | `MaintenanceSupervisor`, bounded, explicit interval | on when configured and customer use is on; stopped by `stop()` |
| Legacy bookings, payments and v2 deals | none in configured mode | unavailable (they depend on locally discovered keys) |

**Rules:**
- **Validation.** Identifiers (network, account ids, business bindings, operator account) are
  validated before anything is written.
- **Config contents.** The config may name **files and environment variable names** for secrets;
  their values are never echoed.
- **Status output.** `GET /api/system/capabilities` reports each capability's state and reason,
  never a path, key, variable value or customer data.
- **No fixtures.** Test fixtures are never imported by `compose.ts`. Synthetic dependencies come
  only through `deps`, which only tests and the preview harness pass, labelled.

**Restart.** `start()` runs the existing recoveries:
- `ManagedRuntime.recover()` and `Evaluations.recover()`: unknown dispatch is marked unknown,
  never re-sent;
- the app-check worker's recovery;
- the maintenance supervisor's lease.

Customer ciphertext lives in the protected store's own file, and request identity and units live in
the records file, so both are durable by construction. §6 records what this slice has actually
proven across a real process restart (identity and sessions). The full customer-and-sale restart
journey belongs to 003w-f.

**Shutdown (corrected after Astra reproduced dispatch after stop):**
- `stop()` ends admission at once: the build worker's loop checks before every job.
- It awaits the running pass for a bounded time.
- Anything still in flight is **fenced**: its attempt aborts and writes no outcome, and the next
  start's `recover({ orphanAll: true })` settles it by the existing rules (never re-sent if it may
  have been sent).
- Only then are the protected store and the records database closed.

**Construction failure.** A failure part-way (an unreadable key file, a bad config) unwinds
everything already opened.

**Readiness.** The entry reports it only from the listener's own callback. A listen error stops
everything and exits non-zero.

## 4. Identity (sub-job 003w-b)

**Verified sign-in (NEP-413):**
1. `POST /api/session/challenge` returns `{ nonce (32 random bytes, base64), message, recipient,
   expires_at }`. **It also sets an HttpOnly `es_sign_in` cookie holding a random binding secret;
   only its SHA-256 is stored with the challenge.** The challenge row has an expiry (5 min) and is
   used at most once.
2. `POST /api/session/verify` takes `{ account_id, public_key, signature, nonce }`. The server:
   - rebuilds the NEP-413 payload: the tag `2^31 + 413` (u32 LE), then the Borsh payload
     `{ message: string, nonce: [u8; 32], recipient: string, callbackUrl: Option<string> = None }`;
   - hashes it with SHA-256;
   - verifies the ed25519 signature against `public_key`;
   - requires the **same browser's binding cookie**. A complete, valid proof replayed from another
     browser is refused, and a wrong binding doesn't spend the challenge;
   - consumes the challenge atomically, so one challenge yields at most one session even when
     verified concurrently;
   - checks that its stored recipient is the **currently configured** one. An outstanding
     challenge from a reconfigured application identity is refused;
   - asks the injected `AccessKeyReader` whether `public_key` is a **FullAccess** key of
     `account_id` on testnet now. A returned account id alone proves nothing.
3. It finds or creates the person bound to that account (`person_accounts`, one person per
   account) and starts a `verified` session with a server-side expiry: 12 hours absolute by
   default, configurable and bounded.

**Expiry and logout:**
- Expired, wrong-mode or deleted sessions are not sessions: `/api/me` reads `null` and protected
  routes answer 401.
- Logout deletes the row.
- The cookie's `Max-Age` matches the server expiry, but the server is the authority.

**Not done here:**
- the browser wallet adapter (Wallet Selector or a similar pinned adapter, its redirects,
  cancellation and account switching);
- the customer device use-key path.

Both are 003w-e. WalletIntegrationAlignment holds: NEP-413 sign-in is **account proof**, never
customer-use authorization, and a wallet's `signMessage` is never fed the hold/use digests.

## 5. Customer reads (sub-job 003w-c)

`TestnetCustomerRpcTransport` extends the read-only `TestnetRpcTransport`:
- **Its final block carries `timestamp_ms`**, from the RPC block header's `timestamp_nanosec`
  (a decimal string, converted exactly with BigInt).
- **It allows only these views, each with exact argument shapes:** `get_control`, `get_treasury`,
  `get_plan {plan_id}`, `get_entitlement {customer, plan_id}` and `check_use {customer, plan_id,
  reg_id, hold_seq, slot, fingerprint}`.

It keeps the same envelope, block-identity, size, deadline, redirect and concurrency rules. It
has no keys and sends no transactions.

## 6. Evidence (what this slice ran)

The composition tests start the real `composeApplication` on a finite loopback listener. They
use a disposable records file and protected-store root, an injected synthetic RPC `fetch`
(labelled), and ephemeral ed25519 and storage keys. They cover:
- missing, invalid, mainnet and network-mismatched configs refused before any write;
- the capability inventory with no secrets;
- preview-only routes absent in configured mode;
- a preview session refused in configured mode;
- verified sign-in, its expiry, replay and wrong key;
- **a real process restart.** A configured child process (`server/test/composeChild.ts`, the same
  composition with the labelled synthetic RPC) signs a person in. It is terminated, and a fresh
  process on the same files keeps the verified person and session. The preview entry
  (`server/src/entry.ts` itself) keeps a joined person across a real restart. Also tested: the
  in-process stop and recompose;
- **two isolated browsers.** A proof started in A doesn't sign in B, and two concurrent verifies of
  one challenge make exactly one session. A reconfigured recipient refuses old challenges;
- **shutdown.** With a held provider, a queued second job is never dispatched after stop. An
  attempt past the drain bound is fenced (its signal aborted) (`builds-boundary.test.ts`).

**Not yet proven (003w-f):**
- the integrated customer and sale journey across a restart;
- recovery of unknown requests across a restart, in the composed entry.

The existing 100/20/80 fixture journey, the customer-world sale tests and the live acceptance
gate are unchanged and must keep passing.

## 7. Remaining bounded sub-jobs (003w is not complete until they are)

- **003w-d: customer chain writer.** A `CustomerChainWriter` that submits the operator's
  `open_hold`, `settle_hold` and `release_hold_for` (the exact names in contracts/business-v3/src/lib.rs; the registration guard on release kept) on testnet:
  - **signer:** near-api-js, with the operator key from an explicitly named key file;
  - **design:** one transaction per call, its nonce and hash recorded before broadcast, and
    "unknown" outcomes never resubmitted;
  - **tests:** a synthetic RPC.

  It needs a reviewed testnet rehearsal packet before any real transaction.
- **003w-e: browser identity and customer authorization.**
  - a pinned wallet adapter for the NEP-413 sign-in above (redirect state, cancellation, account
    switch, logout);
  - the customer device use-key provisioning, storage, loss and revocation design that matches the
    contract's digest scheme (WalletIntegrationAlignment);
  - plain consent copy for each of the three acts.
- **003w-f: the configured journey and review:**
  - the normal entry composed with every real adapter;
  - the integrated idea → build → check → offer → customer use → operating evidence → sale path
    on one business identity, across restart, with old-owner denial and buyer authority;
  - a browser review of the normal entry (fresh setup, missing capability, outage, reopen);
  - the exact testnet and provider rehearsal packet (accounts, budget, transactions, receipts,
    cleanup). It is prepared, never run, by this job.
- The worker engine stays off until 002f1 and its host gates pass.
- 004b, 005c, 005d, 006a and M6 are unaffected and remain.

## 8. The customer chain writer (sub-job 003w-d)

**Design (written before the code).** The callers are `CustomerUses.submit` (reservation) and the
unit step (settle or release). They already mark intent ("unknown") under their lease before
calling, treat the answer as an event only, and resend the **identical payload**, bounded by
`maxSubmissions`, whenever readback shows the hold still not open. So the writer, not the
callers, must make "the same operation again" safe:

- **Operation identity.** Every call now carries `operation` (the request id; the writer adds the
  method). The interface change is in `CustomerChainWriter`, and both callers pass it.
- **One durable attempt per operation.** In `chain_tx_attempts` (the records database), each
  attempt row is written **before broadcast**. It holds the payload digest, the nonce, the block
  hash and height, the exact signed bytes and the hash. Its state is `signed` (may be in flight),
  `success`, `failure` or `invalid` (proven unable to land).

**What a call does, given the newest attempt for its operation:**

| Newest attempt | What the call does |
|---|---|
| None | Read the key's nonce and permission and a final block. Then, in ONE `BEGIN IMMEDIATE` transaction: re-check the operation, allocate the nonce, sign and persist. Then broadcast. |
| `signed` | Read its own **FINAL** status by hash. Final: record it. Not found and still valid: rebroadcast the **same bytes** (the same hash, so the chain includes it at most once). Otherwise it **stays unknown**: past the validity window it answers `unknown: needs_reconciliation`. **No fresh transaction is ever made after an attempt whose outcome may be unknown** (Astra's CustomerWriterReview): a missing status, an expiry or a used nonce on a rebroadcast doesn't prove it didn't execute. |
| `invalid` | Only one thing makes an attempt `invalid`: its exact bytes, on their **first** broadcast (nothing else ever had them), refused at admission for a used nonce or an expired block hash. Then a fresh attempt (a new nonce) is allowed. Any other refusal leaves it `signed`. |
| Another signer or key | `E_SIGNER_CHANGED`: never queried or rebroadcast under the new identity, so it needs explicit reconciliation. |
| `success` | Answer `already` with no transaction. |
| `failure` | Answer `refused` with the recorded `E_` code, and no new transaction. |
| A different payload | `E_PAYLOAD_MISMATCH`, before anything is read or signed. |

**Rules around the table:**
- **Nonces.** `chain_tx_nonces` stores each signer key's next nonce, so a nonce is
  `max(stored next, chain nonce + 1)`. It is changed only under the write lock, together with the
  attempt, and `(signer, key, nonce)` is unique. Separate connections or processes can't sign two
  transactions with one nonce, or two live transactions for one operation (the loser of a race
  answers `unknown: in_flight`).
- **Bounded calls only.** The exact contract calls are `open_hold`, `settle_hold` and
  `release_hold_for`: zero deposit, 100 Tgas, and argument shapes validated before any read. There
  is no unguarded release. The RPC methods are `query` view_access_key, `block`, `send_tx` and
  `tx`, under 003i's bounds (deadline, abort, body cap, no redirects, no retries).
- **Fail closed.** Identity checks fail closed: testnet and `.testnet` accounts only, and the key
  must permit the receiver and method (FullAccess, or a FunctionCall key for that contract and
  method). Otherwise `E_SIGNER_KEY`, and nothing is signed.
- **What counts as an outcome.** Only a reply with `final_execution_status: FINAL` and this exact transaction's hash. `SuccessValue` means success, and `Failure` or a failed receipt means failure (its `E_` code kept). An optimistic, mismatched or partial reply is unknown, and the writer asks with `wait_until: FINAL`.
- **Answers are events.** The customer-use state machine's exact contract readback stays the only
  proof of a reservation or a charge.
- **Configuration.** The config names `customer.writer.key_file` (absolute; configured mode only).
  At composition the file's account must be the metering account and its key must match its
  public key, or composition fails and unwinds. Status names the provenance, never the key or path.

**Crash boundaries:**
- **Before persisting:** nothing exists, so a fresh attempt happens.
- **After persisting, before broadcast:** the restart sends the same bytes.
- **After broadcast, before recording:** the restart reads the status.

**Wire compatibility (verified).** The writer's Borsh transaction bytes are compared in a test
with the pinned SDK (near-api-js 7.3.1, used through its public exports, with no package files
read). `createTransaction` plus `encodeTransaction` give byte-identical output, and
`decodeSignedTransaction` of the writer's signed bytes re-encodes to the same transaction.

**Assumptions to verify before any live use (the testnet rehearsal packet, 003w-f):**
- **Endpoint behaviour.** The validity window, and how a real endpoint reports
  `UNKNOWN_TRANSACTION`, `INVALID_TRANSACTION` and `TIMEOUT_ERROR`.

**Evidence** (`server/test/customerWriter.test.ts`; a synthetic JSON-RPC chain that independently
decodes Borsh, checks the ed25519 signature, the nonce and inclusion; newly generated keys; a
disposable SQLite file over separate connections):
- exact serialization and signing for all three methods;
- the allowlist;
- refusals before any effect;
- failed reads persist nothing;
- duplicates and payload mismatch;
- **a negative control:** without the durable record, the same operation IS sent twice;
- concurrency on separate connections;
- final refusal;
- a crash after persist (the same bytes once);
- landed-but-unanswered (no resend);
- dropped then expired (the same hash while valid, then it **stays unknown** with no fresh
  transaction);
- Astra's counterexample: a used nonce on a rebroadcast stays unknown;
- the only fresh-attempt proof, a used nonce on the first broadcast, giving a new nonce;
- optimistic and wrong-hash replies are never recorded;
- a signer change is refused with no reads;
- SDK byte compatibility;
- operator-key validation.

**Composition** (`composition.test.ts`): the writer on with honest provenance and no key in
status; a wrong-account key file refused with an unwind; a writer refused outside configured mode.

**Not covered here:**
- separate **processes** racing (connections in one process are tested);
- the writer driven through `CustomerUses` routes against a coherent synthetic chain;
- any real endpoint.

The first two are in 003w-f's integrated journey.
