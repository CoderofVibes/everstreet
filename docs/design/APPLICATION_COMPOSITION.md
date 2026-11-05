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
| Account sign-in | NEP-413 verifier + `TestnetAccessKeyReader` (**003w-b**), browser: pinned Wallet Selector + MyNearWallet (**003w-e1**) | real (new); live wallet not yet rehearsed |
| Customer use authorization (device use key) | this device's enrolled WebCrypto key (`web/src/deviceKey.ts`, **003w-e2**); the preview keeps its labelled page seam | real in the browser (new); live wallet enrollment not yet rehearsed |
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

**Design.** (Honest order: this section was appended after the first version of
`customerWriter.ts`, then corrected three times after Astra's CustomerWriterReview
counterexamples, the third being the upgrade of an earlier records file; it describes the final
behaviour.) The callers are `CustomerUses.submit` (reservation) and the
unit step (settle or release). They already mark intent ("unknown") under their lease before
calling, treat the answer as an event only, and resend the **identical payload**, bounded by
`maxSubmissions`, whenever readback shows the hold still not open. So the writer, not the
callers, must make "the same operation again" safe:

- **Operation identity.** Every call now carries `operation` (the request id; the writer adds the
  method). The interface change is in `CustomerChainWriter`, and both callers pass it.
- **One durable attempt per operation.** In `chain_tx_attempts` (the records database), each
  attempt row is written **before broadcast**. It holds the payload digest, the nonce, the block
  hash and height, the exact signed bytes and the hash. Its state is `signed` (may be in flight),
  `success`, `failure` or `invalid`. Its `history` is `counted` when the writer created it (every
  send since signing is claimed), and `uncounted` for a row from before the upgrade below.

**What a call does, given the newest attempt for its operation:**

| Newest attempt | What the call does |
|---|---|
| None | Read the key's nonce and permission and a final block. Then, in ONE `BEGIN IMMEDIATE` transaction: re-check the operation, allocate the nonce, sign and persist. Then broadcast. |
| `signed` | Read its own **FINAL** status by hash. Final: record it. Not found and still valid: rebroadcast the **same bytes** (the same hash, so the chain includes it at most once). Otherwise it **stays unknown**: past the validity window it answers `unknown: needs_reconciliation`. **No fresh transaction is ever made after an attempt whose outcome may be unknown** (Astra's CustomerWriterReview): a missing status, an expiry or a used nonce on a rebroadcast doesn't prove it didn't execute. |
| `invalid` | Only one thing makes an attempt `invalid`: a used-nonce or expired-hash admission refusal received by the **sole** sender of its bytes. Every send, first or repeated, by any connection or process, first durably claims it by incrementing `broadcasts` while the attempt is `signed` (a crash after the claim counts as a send). The refusal turns into `invalid` only by a compare-and-set requiring `history = counted` and `broadcasts = 1`, made by the sender whose claim was that one. With another send claimed (Astra's overlapping retry), or an uncounted row, the refusal proves nothing about another copy, and the attempt stays `signed`. A sender whose claim finds the attempt no longer `signed` doesn't send. A fresh attempt (a new nonce) is allowed only when **every** attempt of the operation is a counted `invalid`; otherwise nothing fresh is read or signed (below). |
| `invalid`, flagged `legacy_invalid` | An earlier writer's classification, not proof (the upgrade below). Only that attempt's own **FINAL** status for its exact hash resolves it, read without sending anything: success or failure is recorded and the flag cleared. Anything else answers `unknown: needs_reconciliation`, and no fresh transaction is made. |
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
- **Terminal states are final.** `success`, `failure` and `invalid` are only written over a `signed` row (a compare-and-set). A late reply to an interrupted or overlapping sender that finds a terminal state answers from that durable state, and never undoes it. The one exception is a `legacy_invalid` row, which only its own exact FINAL status can move to `success` or `failure` (also a compare-and-set).
- **Upgrading an earlier records file** (`openDb`, once, in one write transaction; Astra's actual
  old-schema counterexample). Rows written by 99cba15 (no send count) or 47649b7 (whose upgrade
  gave every existing row a count of 0) may already have been sent any number of times.
  - Every row present at the upgrade becomes `uncounted`: its count never proves a sole sender.
    It is still resolved by its own status and its own bytes, never by a fresh transaction.
  - Every `invalid` row present is flagged `reconcile = legacy_invalid`. The old classification
    may come from the reproduced unsafe exception, so it is kept (with its code) but not trusted.
    A flagged attempt also blocks fresh attempts for its operation, even behind a later attempt,
    and stays flagged for the operator after that later attempt resolves.
  - `success` and `failure` stand: every committed writer recorded them only from a FINAL status
    for the exact hash.
  - The policy is conservative: a 47649b7 file whose rows were in fact counted from creation is
    still treated as uncounted. No deployed records file exists, so nothing real is affected.
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
- the only fresh-attempt proof, a used nonce received by the sole sender, giving a new nonce;
- **overlapping senders on independent connections:** a held first send, then a retry whose
  identical copy lands with its answer lost, then the first send's late InvalidNonce. Reproduced
  first (the old code signed a third, fresh transaction). Now it stays unknown, and the next call
  finds the landed transaction (one nonce, two sends of the same bytes);
- a late first-send answer can't undo a success recorded meanwhile;
- **upgrading an actual earlier file** (really signed rows rewritten into the 99cba15 and 47649b7
  schemas, closed, reopened through `openDb`). Reproduced first: the old upgrade gave
  `broadcasts = 0`, the next InvalidNonce made it `invalid` and the next call read for a fresh
  attempt. Now:
  - a pending old row stays `signed` and unknown, with no fresh read, only its own bytes sent;
    it is found when it landed;
  - an old `invalid` row is flagged, sends nothing, reads only its own status, and is corrected
    to `success` when that shows it executed;
  - a later attempt behind it resolves by its own bytes while the old one stays flagged;
  - old success and failure answer with no reads;
  - a new row in the upgraded file keeps the sole-sender proof, and reopening doesn't upgrade
    again;
- optimistic and wrong-hash replies are never recorded;
- a signer change is refused with no reads;
- SDK byte compatibility;
- operator-key validation.

**Composition** (`composition.test.ts`): the writer on with honest provenance and no key in
status; a wrong-account key file refused with an unwind; a writer refused outside configured mode.

**Not covered here:**
- separate **processes** racing (connections in one process are tested);
- the writer driven through `CustomerUses` routes against a coherent synthetic chain;
- any real endpoint;
- the operator's reconciliation procedure for `needs_reconciliation` and `legacy_invalid`
  (there is no UI or procedure yet; the customer-use readback still decides each request).

The first two and the procedure are in 003w-f.

## 9. Wallet sign-in and customer device authority (sub-job 003w-e)

**Design.** Written before this job's code. The job brief is
`docs/astra/jobs/2026-11-04_003we_wallet-and-customer-authorization.md`, and
WalletIntegrationAlignment still holds. There are **three separate acts**, and the customer sees
three separate pieces of plain consent:

| Act | Authority | Protocol | Who signs |
|---|---|---|---|
| Prove my account | an account's full-access key | NEP-413 message, verified on the server (§4) | the wallet |
| Let this device use a service within limits | the customer's account | `install_key` / `revoke_key` transactions (1 yoctoNEAR) | the wallet |
| Authorize one exact request | the enrolled device use key | raw ed25519 over the contract's `hold_message` / `use_message` digests | the device key, in this browser |

None stands in for another. A NEP-413 signature is never a hold or use signature, and a wallet
approval is never shown as a chain outcome. Each act is confirmed only by its own server
verification or by a fresh contract readback.

### 9.1 The wallet adapter (requirement 1)

**Pinned: `@near-wallet-selector/core` 10.1.4 with `@near-wallet-selector/my-near-wallet`
10.1.4**, NEAR's own wallet selector, plus `buffer` 6.0.3 because the module uses a global
`Buffer` in the browser.
- **Evidence for the API.** The packages' published type declarations, READMEs and module code,
  fetched with `npm pack` into an isolated temporary directory. Our `node_modules` was not read,
  and `tsc` checks our calls against the pinned declarations. The NEAR documentation tools
  weren't available in this session.
- **What the pinned module does:**
  - `signMessage({message, nonce, recipient, callbackUrl, state})` opens a MyNearWallet popup at
    `<walletUrl>/sign-message`. It **always** passes a `callbackUrl`: the given one, or the
    current page if none is given.
  - Its answer arrives by `postMessage` from the wallet's own origin, as
    `{accountId, publicKey, signature}` with the signature in base64.
  - A closed popup rejects with "User closed the window", and a blocked one rejects with "Popup
    window blocked".
  - Transactions go through the same popup, at `/sign`.
- **Support limits.** Only MyNearWallet on testnet in this slice. It needs a browser that allows
  its popup. Other wallets, extension wallets and hardware wallets are not offered or claimed.
- **Redirects.** No redirect path exists for `signMessage` in the pinned module. A return route
  still exists for redirect-style answers (9.2).

### 9.2 Verified sign-in in the browser (requirement 2)

- **Config.** `sign_in.return_origin` (a bare origin) gives the **exact callback URL**
  `<origin>/signin/return`. The server issues it with each challenge and stores it with the
  challenge. Without it, wallet sign-in is unavailable and says so: the pinned module would
  otherwise sign the current page's URL, which the verifier can't rebuild.
- **The verifier rebuilds exactly two payloads:**
  - `callbackUrl = None` (wallets that leave it out);
  - `callbackUrl = Some(the issued URL)`.

  Never any other URL, and never one the client sends. Which one verified is recorded.
- **Browser binding.** The `es_sign_in` cookie (§4) still binds the challenge to the initiating
  browser, it is still one-use, the expiry is unchanged, and the recipient must still be the
  currently configured one.
- **Client state.** The browser makes a random `state` per attempt and keeps
  `{state, nonce, destination, expires}` in `sessionStorage`. A direct popup answer is checked
  against the attempt that is still current.
  - The return route `/signin/return` accepts a NEP-413 fragment
    (`#accountId=…&publicKey=…&signature=…&state=…`, or `error=…`) only when its `state`
    matches a stored, unexpired attempt. It verifies once, clears the fragment from history, and
    goes to the stored destination.
  - A destination is only ever a same-origin path starting with `/`, and never `/signin/return`
    itself.
- **Answers:**
  - **cancellation:** "You closed the wallet: nothing changed";
  - **popup blocked:** say how to allow it;
  - **unsupported or not configured:** say why, with no form that can't work;
  - **expired, wrong browser or replayed:** the server's fixed 401, and "start again".

### 9.3 Account changes and logout (requirement 3)

- **`/api/me` names the verified session's account** (`account`, or null for preview). The
  browser treats `(person, account)` as the acting identity.
- **Fencing.** Every sign-in attempt, wallet transaction and device-key action carries the
  identity generation it started under. Signing out, a switch of account, or a wallet
  `accountsChanged` or `signedOut` event bumps it. A late answer from an older generation is
  dropped: it is never posted to verify, never applied, and never stored.
- **Private UI remounts per identity** (keyed by person and account), so account A's in-memory
  state can't show under B. Drafts and recovery stay scoped by person, as now.
- **Two different actions:**
  - "Sign out of Everstreet" ends the application session (`DELETE /api/session`);
  - "Disconnect wallet" calls the wallet's `signOut`.

  Each says which it does. Signing out never needs the wallet, and disconnecting never claims to
  end the session.

### 9.4 The customer's device use key (requirement 4)

- **Creation.** In the browser, with WebCrypto `generateKey({name: "Ed25519"}, false, …)`. The
  private key is **non-extractable**: no code, ours included, can read its bytes.
- **Storage.** The `CryptoKey` object goes in IndexedDB (`everstreet-device-keys`), one record
  per `(network, business account, plan, customer account)`. The record holds:
  - the key;
  - the public key in hex;
  - the slot and limits;
  - the enrollment intent and its state.
- **Nothing private leaves the device.** No private material reaches the server, logs, analytics,
  exports or business sale assets; the server only ever sees the public key from the contract.
- **Browser support.** WebCrypto Ed25519 is recent in browsers, so a missing algorithm or
  unavailable IndexedDB (some private modes, storage blocked or evicted) gives
  **`unsupported` / `storage_unavailable`**. There is no fallback to extractable keys or
  `localStorage`, and no universal device guarantee is claimed.
- **Readiness comes only from a fresh `get_entitlement` readback**
  (`GET /api/customer/offers/:offer/keys`, through the read-only customer transport):
  - **`ready`:** this slot is `active` with **this** public key; the epoch comes from the
    readback;
  - **`pending`:** the intent is stored, and the slot isn't active with this key yet;
  - **`lost`:** the slot is active with a key this browser doesn't hold, such as after storage
    loss;
  - **`revoked`:** the slot is revoked, or now holds another key;
  - **`none`.**

### 9.5 Enrollment and revocation requests (requirement 5)

- **Exact wallet requests.** One FunctionCall each, receiver = the offer's contract:
  - `install_key {plan_id, slot, pk (64 hex), max_hold_units, max_units_per_day}`;
  - `revoke_key {plan_id, slot}`.

  Both carry deposit exactly 1 yoctoNEAR and 30 Tgas. The customer sees every field before
  approving.
- **Persist before asking.** The intent (key, slot, limits) is stored **before** the wallet is
  asked. Afterwards, whatever the wallet answered, or if it never answered, readiness comes from
  the readback.
- **An interrupted enrollment recovers the same key and intent.** Retrying re-asks with the same
  public key and slot. A new key is made only when the customer explicitly chooses "replace this
  device's key", and never while the stored one could still become active unnoticed.
- **No account keys added.** Sign-in for transactions uses wallet sign-in **without** a contract,
  so no function-call or full-access account key is added for convenience.
- **Revocation.** After `revoke_key`, the local key is deleted only once the readback shows the
  slot revoked.
- **Removal and loss.**
  - "Forget this device's key" deletes it locally, and says plainly that the slot stays active on
    the contract until revoked.
  - A lost key is revoked by slot, from the account alone.

### 9.6 The real customer authorizer (requirement 6)

**In configured mode** the customer workspace's authorizer is the device key, for the
signed-in account and the offer's contract and plan, and only when readiness is `ready`.
- `publicKey()` gives the readback-confirmed key, and `verifyEnvelope` refuses an envelope naming
  another key.
- Before signing, the slot, epoch, account and readiness are checked again against a fresh
  readback.
- `sign` signs the 32-byte digests themselves (the contract's `ed25519_verify(sig, msg, pk)`).
- The existing envelope recomputation, the original-request versus edited-draft separation, and
  consent and expiry are unchanged.

**The preview's synthetic authorizer stays a separate, labelled dependency**
(`pageAuthorizer`), used only in preview mode. Privacy, delivery, settlement and 100/20/80 are
untouched.

### 9.7 A fresh customer (requirement 7)

A fresh customer needs, in order:
1. a testnet account;
2. a storage shell: `sponsor_shell(customer, plan_id)`, payable, which anyone may pay for;
3. the business's token, and storage registration with that token;
4. the purchase: `ft_transfer_call` on the token to the business, with
   `msg = {"buy": {plan_id, units, purchase_seq, install?}}`. It can enroll this device's key in
   the same transaction.

Steps 2–4 are prepared transactions shown to the customer. Their exact preparation (child slice
003w-e3) is listed in 9.9. The end-to-end path is **not** called complete from a pre-seeded
entitlement.

### 9.8 Review harness (as built; corrected from the plan above)

The plan said "the normal configured application", but what was built is narrower:
`scripts/wallet-harness.ts` serves **the real app routes (`everstreetApi`) with verified
identity**. It uses the real `AccountSignIn` with the harness's exact callback URL, over the
customer test world (`server/test/customer-world.ts`):
- an in-memory database;
- the contract-JSON chain double;
- a published fictional offer.

It does not use `composeApplication`, because seeding a published offer and its entitlement there
needs the integrated journey (003w-f).

**The wallet is injected at the Wallet Selector module boundary.** `/__harness/wallet.js` defines
a `WalletModuleFactory` with the official shape, so the browser runs the production `selectorWallet`,
`SignInController` and `DeviceKeys`. The module's `signMessage` and transactions are answered by the
**harness process**:
- an ephemeral account key made at start signs NEP-413 there;
- `install_key` and `revoke_key` are applied to the chain double by lib.rs's rules: the plan and its
  hold limit on install, and on revoke the active hold stops serving now, while uses already signed
  stay settleable;
- the curve-point and weak-key checks are only the hex shape, so the double can't stand in for the
  contract's key validation.

**Bounds:**
- It listens on loopback only, on `:8814`, with controls on `:8815` (cancel next, lose next,
  switch account).
- It stops by itself after `--minutes` (1–120, default 30) or on a signal, and keeps no files.
- The page's Content-Security-Policy allows connections only to the harness (`connect-src 'self'`),
  so the browser refuses any outbound request, including the Wallet Selector's default RPC. The
  harness server makes none.
- It is accepted only when `/api/env` names the harness, and the page shows a permanent synthetic
  label.

**What it is not:**
- not the composed entry;
- not a real wallet, real Wallet Selector network behaviour or real MyNearWallet;
- not testnet evidence.

### 9.9 Child slices and status

| Slice | Covers | Status |
|---|---|---|
| 003w-e1 | 9.1–9.3: wallet sign-in, return route, fencing, logout and disconnect | built and tested, including the server fences from Astra's WalletSignInReview |
| 003w-e2 | 9.4–9.6: device key, enrollment and revocation, readiness, the real authorizer, the harness | built and tested, including Astra's DeviceKeyReview corrections: the atomic claim across tabs, a fence after every await, compare-and-delete, the exact request reviewed then re-checked, no refresh loop, one store connection |
| 003w-e3 | 9.7: fresh-customer shell and purchase preparation (with install) | **partial**: exact transaction builders, tested against the contract's rules. Not built: a quoted storage deposit (a `storage_byte_cost` readback), the customer's token balance and registration reads, `purchase_seq` in the readback, and the purchase UI. These are a bounded follow-up inside 003w-e |

### 9.10 Real wallet and testnet rehearsal: prepared, NOT run

Nothing here has been executed. It needs Tony's explicit yes, as part of the 003w-f packet.
1. **Accounts.** A fresh fictional testnet customer account, created by the person in
   MyNearWallet (testnet). It must not be an existing account of Tony's.
2. **Configuration.** A configured composition with `sign_in.return_origin` set to the origin
   actually served (for example `http://127.0.0.1:8870`), and the testnet RPC.
3. **Sign-in.**
   - Check that the popup opens at `testnet.mynearwallet.com/sign-message` and shows the exact
     message and recipient.
   - Record which payload verified (`sign_in_challenges.verified_variant`: does MyNearWallet sign
     the callback?).
   - Check cancellation (close the popup) and a blocked popup.
4. **Enrollment.**
   - The customer's existing testnet entitlement for a test business (from 003w-f's setup).
   - Review the exact `install_key` request, approve it in MyNearWallet (1 yoctoNEAR), and confirm
     it from a `get_entitlement` readback only.
   - Record the transaction hash.
5. **Use.** One request authorized by the device key, then a FINAL `open_hold` from the operator
   writer (003w-d).
6. **Revocation.**
   - `revoke_key`, then confirm the active hold stopped serving and a new request is refused.
   - Then delete the local key.
7. **Evidence.** Transaction hashes, readback blocks, screenshots, and the gaps observed.
8. **Cleanup.** Revoke the remaining keys. No mainnet, no spending beyond testnet faucet tokens.

### 9.11 Corrections from 003wea (Astra's browser handoff and reviews)

**The harness's customer page.** The harness now publishes its fictional business. The public
offer route correctly requires that, and public access is unchanged.
- **Time.** The harness's chain double and server follow this computer's clock, moving only
  forward, so the browser's own envelope check agrees with the server's deadlines.
- **Controls:**
  - cancel next;
  - lose next;
  - delay next wallet answer (0–30000 ms, once);
  - switch the wallet's account.
- **Evidence (`server/test/wallet-harness-browser.test.ts`).** The page's own code (customerHttp,
  api, readKeys, SignInController, DeviceKeys, CustomerWorkspace on the browser's clock) runs
  public offer → sign-in → enroll → prepare → check → device signature → authorize → reserved.
  It is still not composeApplication and not live NEAR.

**Revocation is reviewed like enrollment** (requirement 5).
- `prepareRevoke` gives:
  - the exact `revoke_key`;
  - the acting account and gas;
  - the plain consequence: new requests and the current serving window stop now, and uses
    already signed can still settle until their settlement deadline;
  - **which key** (public key and epoch) the review is for.
- `revoke` sends only if the request **and** that observed key, epoch, registration and account
  are unchanged. Otherwise the new key is shown, unsent.
- **Limit:** the contract's `revoke_key` is slot-based. This is a client comparison against a
  fresh read, not an atomic on-chain guarantee. A guarded contract method (revoke only at the
  reviewed epoch) would close the window between the read and inclusion. That is a contract
  change, recorded as a follow-up and not made here.

**SessionProvider runs `SessionModel`** (web/src/sessionModel.ts).
- Every change of who is acting bumps an identity generation, and a `/me` answer from an older
  generation, or one overtaken by a newer refresh, never changes who is acting.
- Sign-out clears at once and settles a pending sign-in prompt. If the server couldn't be told,
  a refresh reads what it says.
- A sign-in completion whose refresh was overtaken answers `stale`.

**Panel lifetime.** `deviceView` owns one controller and one store connection per offer view.
- Disposing it closes a connection whose open resolves late, and refuses further opens.
- An offer, account or unmount change clears any request under review, busy and error state,
  and withdraws the authorizer.

**Follow-up at `16ec3d4` (Astra's WalletBrowserRepeat and DeviceKeyReview):**
- **A revocation review is an immutable object.** The call and the observed key travel together.
  `revoke` checks that review's own observation; a bare call never sends, because two reviews of
  one slot have identical bytes.
- **The customer page's workspace is owned per effect.** It is keyed by the person's id, the offer
  or use, and the identity mode, so a same-person session refresh never retires it.
- **The phone layout** lets grid tracks shrink and long exact values wrap. Nothing is hidden or
  truncated.

## 10. A fresh customer buys and uses the product (sub-job 003w-eb, job 003web)

**Design.** Written before this job's purchase code; only the contract fixture (below) came first,
and it is its evidence. The brief is `docs/astra/jobs/2026-11-04_003web_fresh-customer-purchase.md`.
The customer arrives with **no entitlement and no device key**. Everything they sign is signed in
their own wallet; the server only reads and verifies. Nothing below is live NEAR.

### 10.1 What the contract does (contracts/business-v3, measured)

`customer_purchase_matches_server_fixture` writes `server/test/fixtures/v3/customer-purchase.json`
from the contract itself.

- **Shell storage.** `sponsor_shell(customer, plan_id)` is payable and charges the measured
  growth: **exactly 811 + len(customer) bytes**. This is measured for customer lengths 2, 9 and 64
  and payer lengths 2, 12 and 64; the payer is a fixed 65-byte field, so its length never matters.
  The charge is `bytes × storage_byte_cost`. Any excess is refunded; less is refused
  (`E_STORAGE`). A shell that already exists is refused (`E_EXISTS`).
- **Purchase.** The customer calls `ft_transfer_call` on the business's own token, to the
  business, with `msg = {"buy": {plan_id, units, purchase_seq, install?}}`.
  - **Accepted:** `ft_on_transfer` returns `0` and logs `units_bought {customer, plan_id, units,
    amount}`.
  - **Returned whole:** anything invalid logs `purchase_returned {customer, amount, reason}` with
    no state change. Reasons include a wrong amount, a sequence that isn't the next, the
    per-purchase or outstanding cap, no shell, or an install slot in use.
  - **Optional install:** `install` enrolls a device key in the same call.
- **The sequence.** A purchase is accepted only at `purchase_seq + 1`. So **any number of requests
  with the same sequence can accept at most one**; the rest are returned whole.
  `units_bought` carries **no sequence**: the event alone can't name a purchase.

### 10.2 Reads (bounded, authenticated, one final block)

`GET /api/customer/offers/:offer/purchase-setup?units=N[&install=...]` is for the signed-in
person's linked account only. At one pinned final block it reads:
- **the business contract:** `get_plan`, `get_entitlement(customer)`;
- **the offer's token (`asset`):** `ft_metadata`, `ft_balance_of(customer)`,
  `storage_balance_of(customer)`, `storage_balance_of(business)`, `storage_balance_bounds`;
- **the protocol's `storage_amount_per_byte`** (`EXPERIMENTAL_protocol_config`, the only new RPC
  method).

The customer transport's allowlist gains exactly those token views, with their exact arguments.

**Validation:**
- **Metadata:** `spec` `ft-1.0.0`, decimals an integer 0–38, a symbol of 1–16 plain characters,
  and a bounded name.
- **Amounts:** exact u128 decimals, `0 ≤ v < 2^128`.
- **Coherence:** the plan must equal the offer's reviewed plan.
- Anything malformed, oversized, from another block, or mismatched refuses the read. An unknown
  value is shown as unknown, never as zero.

**The answer:**
- the block;
- the token (symbol, decimals, the customer's balance, both registrations and the bounds);
- the entitlement (none, or the shell: registration id, sequence, free, held, purchased);
- the shell quote: **exact**, with its basis (bytes, per-byte cost, and the contract fixture
  version);
- the steps still needed;
- when units are asked, an exact **preview**: the call and the terms, with their digest.

### 10.3 The steps, each an exact reviewed wallet request

| Step | When | Request (receiver, method, args, deposit, gas) |
|---|---|---|
| Registration (shell) | no entitlement | business, `sponsor_shell {customer, plan_id}`, the exact quote, 30 Tgas |
| Token storage | the customer isn't registered with the token | token, `storage_deposit {account_id, registration_only: true}`, `storage_balance_bounds.min`, 30 Tgas. The customer still needs their own tokens: there is no faucet, purchase of funds or bridge here |
| Purchase | a shell exists, both registrations exist, and the balance ≥ the total | token, `ft_transfer_call {receiver_id: business, amount, msg}`, 1 yoctoNEAR, 100 Tgas |
| Device (as 9.5) | after the purchase, or `install` in the purchase | business, `install_key …`, 1 yoctoNEAR |

**When the business isn't registered with its token**, purchase is unavailable, with an owner
action. Nothing is sent.

**The purchase preview's exact checks:**
- `units` a u32 integer within `1..max_units_per_purchase`;
- `amount = units × unit_price` in BigInt, < 2^128;
- `free + held + units ≤ max_units_outstanding`;
- `purchase_seq + 1 ≤ u32 max`;
- `balance ≥ amount`;
- the optional `install`: a slot that isn't active, a 64-hex key, `1 ≤ max_hold_units ≤ plan`,
  `1 ≤ max_units_per_day ≤ 65535`.

**The reviewed digest** covers account, network, contract, asset, registration id, sequence,
units, amount, deposit, gas and the call. Creating an intent recomputes it from a **fresh** read.
A difference gives `409 terms_changed` with the new preview to review; nothing is stored.

### 10.4 The durable purchase intent

`customer_purchases` holds only public identifiers and terms: person, account, offer, business,
network, contract, asset, plan, registration id, sequence, units, amount, the install public
fields, the exact call, the digest, an idempotency key, the state, the transaction hash if the
wallet gave one, the evidence, and times. It never holds private keys, documents or signatures.

**States:**
- `prepared`: stored, the wallet not yet asked;
- `requested`: the wallet was asked;
- `confirmed`: this purchase's own transaction showed `units_bought`;
- `returned`: its own transaction showed `purchase_returned`, with the reason;
- `unknown`: no transaction evidence yet;
- `abandoned`: the customer explicitly set it aside, only when the readback allows (below).

**One open intent per (account, contract, plan, sequence).** A unique index enforces it, so
another tab finds the open one instead of making a second.

**Resolution (`POST /api/customer/purchases/:id/check`), bounded and explicit:**
1. **With a transaction hash** (from the wallet's answer, or recorded earlier), read `tx`
   (FINAL). It must be signed by this account, received by this token, and be exactly this
   intent's `ft_transfer_call` with these arguments. Then the business receipt's logs decide:
   `units_bought` for this customer, units and amount means `confirmed`;
   `purchase_returned` for this amount means `returned`. Anything else stays `unknown`.
2. **Without a hash,** the readback alone **never confirms**: another tab, device or app could
   have used the sequence.
   - `purchase_seq ≥ seq`: still unknown ("a purchase with this sequence is recorded; it can't be
     shown to be this one"), with the units the contract now shows.
   - `purchase_seq < seq`: still unknown ("not seen yet; if you approved it, it may still be
     processing, or it was returned"). The customer may then **abandon** it explicitly. That is
     safe because any new purchase uses the same next sequence, so at most one of them can be
     accepted.
3. **Never automatic:** no fresh-sequence retry, and no second payment. "Ask my wallet again"
   re-sends the **identical** request (the same sequence): at most one is accepted, and a
   duplicate is returned whole by the contract.

### 10.5 The browser

`web/src/purchase.ts` gains `PurchaseFlow`, a controller per (person, account, offer) that is
retired on identity change. Every answer after retirement is dropped.
- **The panel leads with** the product, the quantity, the **token amount** (from validated
  decimals and symbol), the separate refundable storage deposit, the account and the outcome. The
  exact base units, method, arguments, deposit and gas are in the details. There is no fiat.
- **Status words:** checking, waiting for your wallet, processing, confirmed, returned (with the
  reason), unknown (with the next step).
- **Recovery first:** an open intent is shown and recovered before any new purchase is offered.

`WalletBoundary.send` returns the transaction hash when the pinned adapter's answer carries one
(`FinalExecutionOutcome.transaction.hash`), otherwise null. Popup closure never implies finality.

### 10.6 Evidence plan

**The chain double** (`FixtureChain`, server/test/customer-world.ts) applies the actual calls by
lib.rs's rules: `sponsor_shell` (the measured growth, refunds, `E_EXISTS`), `storage_deposit`,
and `ft_transfer_call` with the contract's `validate_buy` and its accept/return, events and
optional install. Each case is checked against `customer-purchase.json`, never by seeding a
post-state. Transactions are kept by hash with their receipts and logs, for `tx`.

**The tests start with no entitlement or key.** Through the real routes and controllers they:
- create the shell;
- register token storage when needed;
- buy 100;
- enroll;
- run and charge one use.

**They also cover:**
- insufficient funds;
- stale quote or terms;
- cancellation;
- accepted but the answer lost;
- returned;
- malformed answers;
- concurrent same and different purchases;
- reload and restart;
- account switch;
- old-owner continuity (a sale between purchase and use).

**The harness** gains a fresh fictional customer and these wallet calls. It stays synthetic, as
in 9.8.

**Not covered here** (003w-f): configured composition, process concurrency and the 100/20/80
acquisition. **Live:** the real token, real wallet answers and a rehearsal.

### 10.7 Corrections during the job (Astra's PurchaseDesignReview and its probes)

The first design (10.1–10.6, `0ed7557`) was corrected before acceptance as follows. It is kept above
for the record; where they differ, this section is the behaviour.

**The contract** (business-v3, not deployed; a contract change ships as a new business account):
- `Buy.reg_id` (optional) binds a purchase to its registration. A buy for a replaced registration
  (unregister, then a new shell whose sequence restarts at 0) is returned whole. The client always
  sends it. A message without it keeps the old behaviour, which the Rust test records.
- `get_purchase_terms(customer)` states the capability version (1), the exact shell bytes
  (`SHELL_BASE_BYTES` 811 + len, which the test proves equal the measured growth), the byte cost
  and that buys bind the registration. **The quote comes from the running contract.** A contract
  without the view is unavailable for purchase (an upgrade); the fixture constant is never applied
  to unidentified code.

**Resolution:** only this purchase's own transaction can resolve it, and that transaction must:
- be FINAL, with an **affirmative** top-level status: exactly `{ SuccessValue }`, whose value
  equals the token resolution's (the amount used). A status that merely lacks `Failure` (say
  `{}`) is no proof (Astra's handoff review);
- have `transaction_outcome.id` equal to its hash;
- carry exactly one action, the complete reviewed call (method, deposit, gas, arguments);
- have a receipt graph of the token's transfer (succeeded), with the business's receiver outcome
  and the token's resolution as its children.

What follows from the graph:
- **Confirmed:** the receiver succeeded, used the whole amount (0 unused) and logged
  `units_bought` for exactly this purchase, and the resolution succeeded using the whole amount.
- **Returned:** the receiver logged `purchase_returned` with the whole amount unused, and the
  resolution succeeded using none. A resolution that failed is **not** a confirmed refund.
- **Unknown:** a return seen when the wallet was asked more than once, since an earlier attempt
  may have been accepted. A named transaction (say from the wallet's history) is verified the
  same way.

**Recovery:**
- **Nothing cancels a requested purchase.** Once the wallet has been asked, it is never set
  aside or replaced. The ask is recorded durably before each wallet request.
- **No time window closes it:** the wallet chooses its reference block when it signs, which can
  be long after it was asked.
- **A readback never closes a purchase as not accepted.** A registration read now as absent or
  replaced proves only that reading. The contract's own test (`history` in the fixture) shows a
  purchase that **was** accepted, whose registration was then validly emptied (the contract's
  refund payout, its callback succeeding) and removed, after which the same request is returned:
  future refusal is not historical non-acceptance (Astra's handoff review). So:
  - a request that **names** its registration becomes `registration_replaced`: the contract can't
    accept it from then on, so it no longer blocks a purchase for a new registration (listed as
    an earlier purchase with an unknown outcome), and it stays checkable by its own transaction,
    which can still confirm it or show it returned;
  - a request that names **no** registration (prepared before the binding) never inherits that:
    a later registration could still accept it, so it stays open and blocking;
  - an earlier version's `not_accepted` record is kept as it is and checkable; it blocks unless
    its request names its registration. A check without its transaction leaves it unchanged, and
    a proof keeps the old reading alongside as `evidence.earlier`;
  - an unknown check never moves a historical row (`legacy_abandoned`, `not_accepted`,
    `registration_replaced`) back into the open states.
- **The recovery path** is the reviewed, identical resend, with its own consent: the same
  sequence and registration, so at most one is ever accepted. A duplicate is returned whole by the
  contract, but its gas is spent.
- **Only a preparation the wallet never saw** can be set aside.
- **Consent survives the create response:** the stored request must equal the reviewed one
  before anything is sent.

**Upgrade of an earlier records file** (e6375d2's table): one transaction, every row kept.
- Open rows' asks were uncounted, so they become 2 (a return seen is never definitive).
- An `abandoned` row may still execute, so it becomes `legacy_abandoned`: checkable, and blocking
  a fresh payment like any open purchase.
- The table with asks but without `registration_replaced` (9138fe1–6aa4979) is rebuilt the same
  way to admit the new state; every row, state, count and evidence is kept as it is.

**The browser, after Astra's PurchaseBrowserReview and PurchaseRefreshReview:**
- **Dependent views follow fresh readings.** When a fresh reading of this flow (this offer and
  account) shows the registration or its units changed, the device panel re-reads the contract
  itself; it never takes the other panel's reading. That includes an unknown purchase whose
  units the contract now shows: the units are the current entitlement, not proof of which
  payment produced them. A flow's first reading only sets the baseline, so nothing loops. The
  device panel no longer remounts (a review in progress stays), and only its newest reading
  applies.
- **Only the newest setup reading applies.** An older one answering late never replaces it; the
  quantity is the customer's and never comes from a reading; a review whose reading was
  superseded by a newer read or an edit reads once more; a retired flow reads nothing.
- **Recovery by the original transaction's ID.** When the wallet's answer carried no hash, the
  customer can enter the ID from the wallet's activity. The wallet is never asked. The server's
  check refuses a malformed ID (400 `bad_tx_hash`), runs the same strict resolver, records a
  named ID only once it is shown to be this purchase's (before, an unverified named ID was
  stored first), and answers `transaction: { hash, matched }`. An unrelated or another
  account's transaction changes nothing.
- **Copy:** token amounts lead; base units, bytes, the terms version and the exact request are in
  one "Exact details" disclosure. A returned payment is announced only from the token's own
  resolution; the open purchase says a new one isn't offered while it might still go through.
- **Composition:** getting ready (buy uses, enroll this device) is a full-width section before
  the workspace, with the two panels side by side when there is room and no card inside a card.
  The document draft stays editable meanwhile. Once this device is ready the section folds to
  its heading (Show reopens it), unless it was needed earlier in the same view.

## 11. Revoke the reviewed key at execution (job 003wec)

**Design.** Written before this job's code. The brief is
`docs/astra/jobs/2026-11-04_003wec_guarded-device-revocation.md`; it closes the limit §9.11
recorded: `revoke_key(plan_id, slot)` revokes whatever key is active in that slot when the
transaction runs, so a review of one key could revoke a replacement installed meanwhile (another
device, or this account after unregister and a new shell). The client's fresh-read comparison
narrows the window but can't be atomic with inclusion.

### 11.1 The contract (business-v3)

**`revoke_key_guarded(plan_id, slot, reg_id: U64, epoch: u32, pk: String)`**, `#[payable]`.
Every check runs before any mutation, in this order, and a refusal changes nothing:
1. exactly 1 yoctoNEAR (`assert_one_yocto`, as now);
2. the caller's own entitlement for the plan (`E_NOT_CUSTOMER`; a sponsor or anyone else can't);
3. the slot is 0–3 (`E_ARGS`);
4. `pk` is 64 hex characters (`E_ARGS`; it is compared, not installed, so no point validation);
5. the entitlement's registration is `reg_id` (`E_STALE_REVIEW: the registration changed since
   this was reviewed`): a new shell reuses slot numbers and epochs from 1;
6. the slot's key is active (`E_KEY: that key is not active`; a replay after success lands here);
7. the slot's epoch is `epoch` and its public key is `pk` (`E_STALE_REVIEW: the key in this slot
   changed since this was reviewed`). The epoch alone already separates a reinstall of the same
   key (epoch +2); the key is named too so the request states exactly which key it removes.

Then exactly what `revoke_key` does today, through one shared private step: the epoch rises by
one (checked, `E_OVERFLOW`), the slot becomes revoked, and an active hold opened under that slot
stops serving now (`serve_until = min(serve_until, now)`); uses already signed still settle until
the hold's settle deadline. No units, holds, accounting, other slots, storage or sale state are
touched; there is no state migration (the arguments are checked against stored fields).
It emits `key_revoked` with `plan_id`, `slot`, `reg_id` and the slot's new `epoch`.

**`revoke_key` stays, unchanged and documented as unguarded**, for existing integrations and
tests. The customer product never sends it (11.3).

**Capability: `get_key_terms() -> { version: 1, guarded_revoke: true }`**, a view with no
arguments. A contract without it (every deployed business today) doesn't have the guarded
method. Deploying it means a new business account (the contract is born locked); that is a
later, separately authorized rehearsal, not part of this job.

### 11.2 The server

- The transport's view allowlist gains `get_key_terms` with no arguments.
- `GET /api/customer/offers/:offer/keys` reads it at the SAME pinned block as the entitlement
  (an answer from another block, or anything but exactly `{version: 1, guarded_revoke: true}`,
  counts as unsupported) and adds `guarded_revoke: boolean` to the readback. A missing view is
  `false`, never an error: reading keys and authorizing uses still work on an older contract.

### 11.3 The browser (web/src/deviceKey.ts, DeviceKeyPanel)

- **The request names the key.** `revokeCall` becomes
  `revoke_key_guarded {plan_id, slot, reg_id, epoch, pk}` from the reviewed observation. Two
  reviews of different keys now differ in their bytes, and the immutable review (§9.11) carries
  the call and the observation together, as before.
- **No downgrade.** If the readback says `guarded_revoke: false`, `prepareRevoke` and `revoke`
  refuse in plain words (the business's contract can't make sure only the reviewed key is
  removed; its owner needs to upgrade it; nothing is sent). A failed or refused guarded call is
  never retried as `revoke_key`.
- **Sending:** still only under a review whose observation equals a fresh one; then the reviewed
  call itself is sent (not a rebuilt one). This device's record is marked `intent: revoke` only
  if it holds the reviewed key.
- **After the wallet answers (or doesn't):** a fresh readback decides.
  - The reviewed key (that epoch and public key) is no longer active: done. If another key is
    active in the slot now, the answer says so and that it was not revoked.
  - **This device's stored key is kept** whenever the contract still shows that same public key
    active in its slot (reinstalled at a later epoch, or under a new registration): it still
    serves a valid authorization (Astra's GuardedRevokeDesignReview). Otherwise it is deleted only
    if the stored record is still the very incarnation this revocation marked: the same public
    key, slot and creation time, with intent still `revoke`, checked and deleted in one IndexedDB
    transaction (`deleteIf` with those fields). Another tab's newer or re-enrolling record stays.
  - **Every write is conditional the same way** (Astra's KeyRecordReview probe, two IndexedDB
    handles): marking `intent: revoke` requires the record as read, and clearing the mark
    afterwards requires the marked incarnation (`putIf` with slot, creation time and intent). A
    newer record another tab stored meanwhile, even with the same public key, is never
    overwritten by the older one.
  - **The capability read has its own deadline** (Astra's KeyCapabilityTimeoutReview): the
    route's read timeout, with a cancellation signal; a transport that never answers settles as
    `guarded_revoke: false`, and a late answer changes nothing.
  - **The wording** says the reviewed key is no longer active, never that this transaction
    revoked it: after a lost answer the readback shows current authority, not which action
    caused it. A replacement is named as still active, and revoking it needs its own review.
  - Still active at the reviewed epoch: not confirmed (perhaps still processing) or cancelled.
    The review stays valid, so a lost answer is recovered by checking again; asking again sends
    the same guarded request, which the contract accepts at most once.
- **The review shows** the key's public key, registration and epoch with the request, and says
  the contract refuses it if the slot holds another key by then.

### 11.4 The doubles and harness

- `applyKeyCall` (the harness and the route double) applies `revoke_key_guarded` by 11.1's rules,
  and `FixtureChain` answers `get_key_terms` (with a switch for an older contract).
- **Anchored to the contract:** a Rust test writes `server/test/fixtures/v3/guarded-revoke.json`
  (each case's call, its refusal code or success, and the resulting key slots), and a server test
  replays every case through `applyKeyCall` and compares.
- The wallet harness gains nothing new for this job beyond the double; its later browser review
  (guarded revoke, stale refusal and a new review, lost answer) waits for the applicable approval
  and isn't run here.

### 11.5 Evidence plan

- **Rust:** the legacy method revoking a replacement under a stale review (characterized as the
  defect); the guarded method refusing it; the same public key reinstalled at a later epoch; a
  new registration with the slot and epoch reused; wrong account, deposit, slot and malformed key;
  replay; an inactive key; epoch overflow. Every refusal through `W::refuse` (state unchanged,
  byte for byte). A guarded success with an open hold: serving stops now, the signed use still
  settles, the other slot and all accounting invariants hold.
- **Server and browser:** the readback's capability (supported, missing view, wrong shape);
  controller tests for a stale review after a newer prepare, a changed answer, a concurrent
  replacement between review and send and a delayed wallet answer (the contract refuses; the
  replacement stays active and its local record stays); an older contract refused without any
  send; lost-answer recovery. The earlier Astra revoke probe stays.
- `cargo test`, `cargo clippy`, the wasm build, `npm run check` and the web build, once, on the
  final code.

## 12. Configured maintenance and the provider transport lifecycle (job 003wf1)

**Design.** Written before this job's code. The brief is
`docs/astra/jobs/2026-11-04_003wf1_configured-maintenance-lifecycle.md`, the first child of 003wf
(whose later children keep every other requirement). Grounded at `b537e06`:
- `compose.ts` starts the build worker and recovers runtime and evaluations, but never builds the
  `MaintenanceSupervisor` (§002d's "what remains to wire live").
- Its model adapters call `httpsTransport(key)` without the supported `fetchImpl` option, so a
  configured composition can't be exercised without the real network.
- `entry.ts` starts the composition before listening, closes the listener before stopping, and
  has a 10 s fallback; the composition has no request-admission boundary, and nothing stops a
  late adapter answer from resuming against a closed database.

### 12.1 Configuration (explicit, validated, off by default)

```json
"maintenance": {
  "enabled": true,
  "interval_ms": 30000,      // 1000..3600000
  "batch": 10,               // 1..25
  "pass_budget_ms": 20000,   // 100..120000
  "op_deadline_ms": 15000,   // 100..120000, at most the pass budget
  "stop_timeout_ms": 30000   // 100..120000: the longest stop waits for a pass to end
}
```
- Every field is required when the section is present (no hidden defaults in a configured
  process); unknown fields are refused; `enabled: false` is the same as absent.
- It needs customer use (`customer`, `rpc`, `protected_storage`), checked at validation.
- The lease is derived as now (3 × max(interval, budget)); the holder is a fresh opaque id per
  process (`proc-<uuid>`). Several processes on one database coordinate through the existing
  durable lease, never through uncoordinated loops; at most one supervisor per process.
- Absent: the capability is unavailable, nothing is scheduled, and health reads `not_started`.

### 12.2 Composition

- One `MaintenanceSupervisor`, over its OWN `CustomerUses` (as the preview does), sharing the
  store, the v3 observations and the managed runtime, with `guardAdapters(options, 4)`.
- It never calls `ManagedRuntime.recover()` (that stays in `start()`, once per process, before
  maintenance starts).
- **Capability, not health.** `maintenance` in `/api/system/capabilities` says only what is
  configured ("passes every 30 s; which tasks can progress"). Without the writer it says so:
  expiry and cleanup can progress; reservations and settlements wait (backed off as
  `writer_unavailable`). Observed health is separate: the same endpoint adds
  `maintenance_observed` (the platform worker's state, last pass time and outcome, in flight),
  from `maintenance_status`, with no holder id, business, count or customer material; owners
  keep their per-business counts through the existing fenced readiness.

### 12.3 Start and stop

- `start()`: runtime and evaluation recovery, the build worker, then `supervisor.start()`.
  Idempotent; a no-op after `stop()`.
- `stop()`, idempotent (also before `start()` and after a failed composition), in order:
  1. **Admission ends:** every new HTTP request gets 503 `stopping` (with `Connection: close`).
  2. **Scheduling ends and in-flight work drains:** `supervisor.stop()` and the build worker's
     stop, each raced against `stop_timeout_ms` (the supervisor's own pass is already bounded by
     its budget plus one operation deadline).
  3. **The fence closes:** every injected network call (RPC, writer, model) and every protected
     storage call made through the composition passes a fence. After it closes, an answer that
     arrives late never resumes its caller (it stays pending), so no handler or pass continues
     into a closed database, and nothing is recorded as done that wasn't. Unknown dispatch stays
     unknown and is recovered by the next process's `start()`.
  4. **Resources close**, newest first.
- The fence never answers for an adapter and never fabricates an outcome.

### 12.4 The provider network seam

`ComposeDeps` gains `modelFetch` and `modelFetchLabel` (labelled, like `fetch`). The real
`AnthropicProvider` and `AnthropicRuntime` are built over `httpsTransport(key, { fetchImpl })`,
so budgets, counting, parsing, accounting, provider errors, timeouts and cancellation are the
production code. The capability's provenance names the label. No application service is
replaced and no global is patched. Test transports refuse every destination but the exact
configured RPC endpoint and the two Anthropic paths, and never fall through to a real fetch.

### 12.5 The entry

`server/src/serve.ts` holds the entry's logic, used by `entry.ts` and, with only labelled
network transports injected, by the test child:
- validate, compose, **listen, and only then start** (a listen failure stops and exits 1 with
  nothing started);
- on SIGINT/SIGTERM (or the test child's IPC request), stop the composition (bounded), then close
  the listener and its connections, then exit 0.

### 12.6 Evidence plan

- **In process:** config validation; capability truth with and without the writer; observed
  health only after a holder's pass; stop before start, twice, and after a composition failure;
  admission refusal while stopping; a hung adapter bounded by `stop_timeout_ms` with no late DB
  access; the real Anthropic adapters over a synthetic HTTP seam (success with accounting, a
  provider error, a timeout, a refused destination).
- **Actual child processes** (`server/test/entryChild.ts` over `serve.ts`; disposable DB and
  protected store; the chain double and a JSON-RPC answering from the TEST process over IPC, so
  its state survives restarts and barriers are deterministic; small heap, deadlines, exact
  cleanup):
  - maintenance settles a reserved, executed use through the real writer and RPC transports;
  - stop during a held settlement, then restart: one settlement, no duplicate charge;
  - a forced kill mid-settlement, then restart: recovered once;
  - two children on one database: one holder works; after the holder stops, the other takes over;
  - a late answer after stop resumes nothing; a listen failure exits 1 with the DB closed.
- **Left for later 003wf children:** the purchase/provider/close restart and nonce/migration
  matrix, the full journey through normal APIs, browser review, and the rehearsal packet.

### 12.7 Built (and what changed from 12.1–12.6)

The design held. Astra's reviews during the job changed how the boundary works:
- **The database gate** (`fence.ts` `gateDb`): every records access goes through it. Once
  stop closes it, any access (getters included) throws `StoppedError`, an HttpError 503
  `stopping`, so a route resuming after a body read answers 503, a maintenance item past its
  deadline is caught by the supervisor's own wrapper, and nothing reaches the closed SQLite.
- **The fence settles instead of leaving work pending.** After close, a call is refused before
  it reaches its adapter (object methods too), and `close()` rejects every outstanding call at
  once, whatever its raw adapter does.
- **Stop:** every owner's stop starts together, then they and the admitted requests drain under
  ONE shared deadline. Requests get at most 2 s of it, then are answered 503 by the stop itself.
  Then the gates close and resources close. `lastStop()` records a forced drain and stop
  failures, and `serve.ts` reports them. The listener then closes idle connections first, lets
  answers being written finish, and cuts the rest at 2 s.
- **Recovery never takes a live peer's work.** `process_presence` (renewed every 10 s,
  removed at stop) and `runtime_invocations.runner`: `recover({ isLive })` at start and
  periodically after recovers only requests whose runner is gone or unrecorded. Evaluation
  runs, which have no runner, are stopped only when no peer is alive. The build worker recovers
  only lapsed leases.
- **One claim per completion:** in `ManagedRuntime.finish` the conditional update comes first;
  ledger rows and the admission settlement follow only if it moved the row.
- **`customer_authorization`** is derived from sign-in, its browser callback and customer use.
- **Test support** (`server/test/lifecycleWorld.ts`, `entryChild.ts`): the synthetic RPC models
  only the one business, keeps the last 64 blocks' view snapshots, validates the transaction
  envelope, signature and nonce, and refuses anything it can't establish.
- **`npm test`** runs the child-process file after the main suite (both required).

The report `docs/astra/reports/2026-11-04_003wf1_configured-maintenance-lifecycle.md` maps each
requirement to its evidence and lists what is left.

### 12.8 Corrections after Astra's handoff review (003wf1 continuation)

Astra's ConfiguredLifecycleHandoffReview found four original requirements unmet. Items 3 and 4
were reproduced and fixed first in `a9635e0`; this section was written after that commit and
before any code for items 1 and 2.

**Item 3: the whole response lifetime** (reproduced: after stop the runtime still had one request
running, reading a body held after its headers).
- `Fence.wrap` now passes every body read through the fence. At close, a pending read is rejected
  at once (`StoppedError`) and the underlying reader is cancelled, so a held body can't keep a run,
  its timer or its caller alive.
- The url and redirect flag are kept for `httpsTransport`'s own redirect check. This covers RPC
  bodies too: every injected fetch goes through it.
- `lastStop().work_running` reports provider requests still running after the gates close.

**Item 4: an evaluation left by a dead process while another lives** (reproduced: it stayed
running indefinitely).
- `eval_runs.runner` is recorded, and `Evaluations.recover({ isLive })` runs at start and on every
  presence tick (10 s). The no-peers gate is gone.
- A live runner's evaluation is never stopped; a gone runner's is stopped within one tick of its
  presence ending. Its in-doubt case request is recorded unknown by the runtime's own recovery.

**Item 2: the configured build adapter** (the real `AnthropicProvider` through the composition's
own build worker, over the model seam):
- **Success:** a founder's build through the route; the composition's worker runs it. The synthetic
  model answers count and generation as the provider expects (a JSON text block, examples as
  key/value pairs), and the job's usage, final flag and charge are checked.
- **Budget refusal:** a business build budget below the worst case is refused at admission, with no
  provider call and nothing reserved.
- **Cancellation:** the owner cancels while the generation is held. Production's own outcome for a
  dispatched build is asserted, never resent.
- **Timeout:** the composition's provider timeout is the transport's fixed 120 s, so the timeout is
  shown on the production adapters directly (`httpsTransport({ timeoutMs })` with the provider and
  the runtime), labelled as adapter-level evidence.
- **A peer starting during a live build:** the build worker recovers only lapsed leases. Two
  compositions on one database: a running, leased build is left alone and completes. When its
  process stops, the survivor's worker recovers it after the lease lapses (30 s), as production's
  rules say, and never resends it.

**Item 1: process barriers for reservation and retention cleanup** (actual children):
- **Reservation:** the confirm's `open_hold` is held at the node; the child stops gracefully (the
  confirm is answered 503). The node then applies it, and after a restart the maintenance reserve
  phase resolves the recorded attempt by its exact transaction: the request is reserved once, with
  one `open_hold`.
- **Retention cleanup:** there is no network boundary to hold, because protected storage is a local
  SQLite file. The interruptible boundary is between items: each deletion removes the object, then
  marks the record (idempotent, so the safe order).
  - Several executed uses are made due by the child's clock. The composition's existing `now`
    dependency is set from a labelled test environment variable in `entryChild.ts` only.
  - A child is killed as soon as the first deletion is recorded, then another finishes.
  - Asserted: every result ends deleted with its object gone, and no record still marked stored
    lacks its object.
  - It can't prove a per-item barrier inside one SQLite delete; it states that.

### 12.9 Follow-ups made during the continuation (recorded after the code)

These came from Astra's probes and reviews while the continuation ran. Each was reproduced
before it was fixed. This section was written after their code (`a40eab1`, `52f22ea`,
`db68fdb`), not before.
- **Build recovery with peers:** the worker recovered lapsed leases only at start, so a survivor
  never noticed a dead peer's build. In the `"expired"` mode, every poll now recovers lapsed
  leases.
- **A recovered evaluation's old loop never continues.** Before each case the run must still be
  this process's running run. Each result write is conditional on that (`state = 'running'` and
  `runner IS` this process), and so is the case's admission, inside the same transaction as its
  reservation (409 `eval_stopped`). No further paid case is dispatched, and a recovered row is
  never rewritten.
- **Owned work is awaited, not sampled.** The runtime tracks its runs and the evaluation loops as
  owned work. Stop awaits them under what is left of the shared deadline, and
  `lastStop().work_running` is what is still unsettled then. The build worker's own stop covers
  builds.
- **Retention interruption is made deterministic** with batch 1: one deletion per phase per pass,
  a pass a second. The kill lands with deletions genuinely still due, which is asserted.
- **`npm test`:** the four long lifecycle evidence files (process, peers, builds, body) run in
  the second required phase.
