# 003w Application composition: report (partial)

Job: `docs/astra/jobs/2026-11-04_003w_application-composition.md`.

**Status: PARTIAL.** Sub-jobs 003w-a, -b and -c are implemented and tested. 003w-d, -e and -f
remain (§4). 003w is **not complete**: no missing capability has been relabelled as done.

**Next concrete bounded job: 003w-d (the customer chain writer).**

**Commits:**
- `297962c`: Astra's 001k1 acceptance paths.
- `aae1d28`: Astra's CompositionDesignReview and INDEX.
- `d350489`: the design and the a/b/c implementation.

## 1. Design first

`docs/design/APPLICATION_COMPOSITION.md` covers:
- the gap in `main.ts`: it discovers credential files, starts a worker with any key it finds, and
  builds a v2 chain from local keys;
- the two modes (`preview`, `configured` on testnet), with mainnet refused;
- the side-effect-controlled composition root;
- the capability table (real, new, or unavailable, and why);
- NEP-413 identity;
- customer reads;
- evidence;
- the remaining sub-jobs.

Astra's CompositionDesignReview corrections are all folded in (§3).

## 2. What exists now

**003w-a: modes, composition root, safe entry.**
- **`server/src/appConfig.ts`** validates the single config before anything opens:
  - testnet only, with mainnet refused in the network, endpoints and accounts (`.testnet` only);
  - preview listens on loopback only;
  - absolute paths, and `:memory:` only in preview;
  - configured mode needs verified sign-in;
  - customer use needs protected storage;
  - the model key is a variable **name**;
  - unknown fields are refused.
- **`server/src/compose.ts`** builds every capability on (with its real adapter) or unavailable
  (with a fixed reason). It never discovers keys and never starts the legacy OpenSeat worker or the
  v2 chain. It never imports fixtures. `GET /api/system/capabilities` carries no path, key or
  endpoint. Injected dependencies are labelled: "synthetic RPC (test)", "no network (review
  harness)".
- **Lifecycle.** `start()` runs the existing recoveries. `stop()` ends admission, drains or fences
  in-flight work, then closes. A construction failure unwinds.
- **`server/src/entry.ts`** (`npm run entry -- --config <file>`) reports readiness from the listener
  callback, exits non-zero on a listen failure, and stops cleanly on a signal.
- **`config/everstreet.example.json`** holds placeholders only.
- **The legacy `main.ts`** is unchanged, labelled in the README and never run.

**003w-b: identity.**
- **Session fences.** Sessions record their mode and a server-side expiry, so a preview session
  never authenticates in verified mode. There, name-only join (403 `verified_sign_in_required`),
  people listing and actor switching are absent.
- **NEP-413 sign-in** (`server/src/identity.ts`):
  - a one-use challenge, bound to the initiating browser (an HttpOnly `es_sign_in` cookie, with
    only its hash stored) and to the currently configured recipient;
  - an exact Borsh payload, verified with ed25519 in node:crypto;
  - a **FullAccess** key check through the new read-only `TestnetAccessKeyReader`;
  - one person per account, linked as their chain account;
  - a 12-hour expiry by default (1–168 hours).
- **The web** reports the identity mode, and the verified-mode sign-in dialog says plainly that no
  wallet connection exists yet. There is no name form.

**003w-c: customer reads.** `TestnetCustomerRpcTransport` is read-only:
- its final block carries `timestamp_ms` (exact BigInt conversion from `timestamp_nanosec`);
- only `get_control`, `get_treasury`, `get_plan`, `get_entitlement` and `check_use`, with exact
  argument shapes;
- the same envelope, size, deadline, redirect and concurrency rules as 003i.

**The build worker** (shared by `compose.ts` and the legacy entry): `startBuildWorker().stop()`
now ends admission and fences in-flight attempts. Astra reproduced the old helper dispatching after
stop.

## 3. Astra's CompositionDesignReview: all addressed

1. **Sign-in binding.** It is now bound to the initiating browser and the current recipient.
   Tested:
   - B holding A's complete valid proof is refused (`sign_in_binding`), and nothing is spent;
   - B's own cookie with A's nonce is refused;
   - two concurrent verifies of one challenge give exactly one session;
   - an old recipient's challenge is refused (`sign_in_recipient`) and spent.
2. **A real process restart.**
   - A configured child process (`server/test/composeChild.ts`: the same composition with the
     labelled synthetic RPC) signs Ava in. After it exits, a fresh process on the same files keeps
     her verified person and session.
   - The preview entry itself (`entry.ts`) keeps a joined person across a real restart.
   - The in-process recompose test is kept.
3. **Contract names.** The design names `open_hold`, `settle_hold` and `release_hold_for`.
4. **Status wording.** Status and evidence wording now match what ran.
5. **Shutdown.** Two regressions use a held provider: no second dispatch after stop, and fencing
   past the drain bound.
6. **Construction and readiness.** Construction failures unwind. Readiness comes only from the
   listen callback, so log-before-listen is gone. Every test registers cleanup as soon as it
   acquires a resource. Children are exit-aware and bounded at 30 s, and their cleanup awaits exit.

## 4. What remains (003w is not complete until these are done)

- **003w-d: customer chain writer.** A `CustomerChainWriter` for `open_hold`, `settle_hold` and
  `release_hold_for` on testnet:
  - a near-api-js signer with the operator key from an explicitly named key file;
  - the transaction hash recorded before broadcast;
  - "unknown" never resubmitted;
  - the registration guard on release kept;
  - a synthetic RPC for tests.

  Until it exists, the inventory says "Reserving and settling units: unavailable".
- **003w-e: browser identity and customer authorization.**
  - A pinned wallet adapter for the NEP-413 sign-in, with redirect state, cancellation, account
    switch and logout. This needs a dependency decision, since none was added here.
  - The customer device use-key design (provisioning, storage, loss, revocation), compatible with
    the contract's raw-digest scheme.
  - Distinct consent copy for each act.
- **003w-f: the configured journey and review:**
  - every real adapter composed;
  - the integrated idea → build → check → offer → customer use → operating evidence → sale path on
    one business, across a process restart, with old-owner denial and buyer authority;
  - the existing 100/20/80 journey and the live gate, unchanged here and still passing;
  - a browser review of the normal entry;
  - the exact testnet and provider rehearsal packet (accounts, budget, transactions, receipts,
    cleanup), **not yet prepared**.
- **Unchanged gates.** The worker engine stays off: 002f is partial and 002f1 queued. M1–M6, 004b,
  005c, 005d and 006a are unaffected.

## 5. Checks and resources

- **`npm run check`:** exit 0, lint and types clean. 1235 passed and 1 skipped (1236), across 128
  passed and 1 skipped files.
- **New tests:**
  - `server/test/composition.test.ts` (14);
  - `builds-boundary.test.ts` (+2);
  - `web/test/signIn.test.tsx` (1).
- **`npm run web:build`:** 884.84 kB JS (was 884.02), 72.52 kB CSS.
- **Dependency provenance in tests:** a synthetic RPC (labelled), ephemeral ed25519 and storage
  keys, disposable files. There were no real endpoints, wallets, models, workers or chain calls. No
  credentials, `.env` or runtime database were read, and no environment was printed.
- **Resources.** Child processes are bounded (30 s) and awaited. The 20 s smoke of the review entry
  served the inventory, `/api/env` (`identity: verified`) and a refused name-only join, then exited.
  - On Windows `timeout` hard-kills, so that smoke left one temporary directory (fictional data,
    ephemeral key). I removed exactly that one.
  - Another `everstreet-entry-*` directory created at 16:22, while I was only running tests, is not
    mine: most likely Astra's review run. I left it untouched.

## 6. Browser review entry (finite, local, fictional)

```
npm run web:build
npx tsx scripts/preview-entry.ts configured    # verified identity; no network; inventory
npx tsx scripts/preview-entry.ts preview       # fictional preview sessions
```

Open `http://127.0.0.1:8870/` and `/api/system/capabilities`. Stop with Ctrl+C, which removes its
temporary directory. `--keep` with `--dir <path>` repeats a restart on the same files.

**What to check in configured mode:**
- the sign-in dialog says a wallet connection isn't built, and offers no name field;
- `/api/session` POST is refused;
- the capability list is honest (records, sign-in, protection and customer reads on; the writer,
  authorization, checks, model and legacy payments unavailable).

## 7. A decision for Tony and Astra

`Start Everstreet.cmd` and `npm run app` still start the legacy local preview, Tony's daily demo,
which seeds fictional data and discovers local testnet keys for its demos. I didn't repoint them,
because that would break that workflow without a replacement. The README now labels it legacy and
documents the composed entry as the normal one. Making the double-click open the composed entry
(for example in preview mode with seeded data) is a small follow-up once Tony wants it.
