# 003w-e Wallet sign-in and customer authorization: report

Job: `docs/astra/jobs/2026-11-04_003we_wallet-and-customer-authorization.md`.

**Status: in review, and 003w-e is partial.**
- e1 and e2 are built and tested.
- e3 is partial: the transaction builders exist, but the reads and the purchase UI don't.
- The browser review of the harness (Astra's) is still to do.
- No real wallet or testnet run happened.

The 003w parent stays partial.

## Commits

| Commit | What it holds |
|---|---|
| `b0d48ad` | Astra's CustomerWriterReview appendix and INDEX, committed after the check passed (1266 passed and 1 skipped) |
| `a507754` | JOBS: 003we taken |
| `642e510` | Design §9, **written before this job's code** (9.8 was later corrected as built: see below) |
| `e6649b2` | e1: wallet sign-in, server fences, the controller and UI |
| `f48b19b` | e1: signing in again ends the browser's previous session on the server |
| `aff9d1d` | e2: the device key, the readback route and the real authorizer |
| `b961892` | e2: Astra's DeviceKeyReview corrections, the device panel and the review harness |
| `6773920` | e3 (partial): fresh-customer builders; §9.8–9.10 as built |

## Requirement by requirement

**1. A pinned adapter.**
- `@near-wallet-selector/core` 10.1.4 and `@near-wallet-selector/my-near-wallet` 10.1.4, plus
  `buffer` 6.0.3 for its global `Buffer`. They load lazily, as their own chunks.
- `fake-indexeddb` 6.2.7 is a dev dependency only.
- **The API evidence** is the packages' published declarations, READMEs and module code, from
  `npm pack` into an isolated temporary directory, plus `tsc` against the pinned types. Our
  `node_modules` was not read.
- **Not used:** the NEAR docs MCP tools and WebFetch were denied in this session, so no web
  documentation was read.
- **Install scripts:** two packages' scripts (`esbuild`, `secp256k1`) weren't on the allowlist and
  didn't run. Nothing was approved.
- **Support limit:** MyNearWallet on testnet only, through its popup.

**2. Server-verified NEP-413 and browser wiring.**
- **The exact callback.** `sign_in.return_origin` gives the exact `<origin>/signin/return`,
  issued with and stored on each challenge.
- **The verifier** rebuilds only `callbackUrl = None` or `Some(the issued URL)`, and records which
  (`verified_variant`).
- **The return route** accepts a fragment only for this browser's stored, unexpired attempt with
  the same state, once, and goes only to a same-origin destination.
- **Unchanged:** browser binding, one use, expiry, the current recipient and mode isolation.

**3. Account change and logout fences.** These are server-authoritative, after Astra's
WalletSignInReview:
- **A logout, or a newer challenge, from the same browser** ends that browser's earlier attempt
  by binding. Its challenges are cancelled, so a verify that is awaiting the key read issues
  nothing, and a session it minted but never delivered is deleted.
- **`DELETE /api/session/challenge`** cancels only the attempt (used on a wallet-side change).
- **The client never ends a session itself**, so a newer account's session survives (Astra's
  controller probe).
- **Signing in again** ends the browser's previous session.
- **`/api/me`** names the account, and private pages remount per person, as before.
- **The menu** separates "Sign out of Everstreet" from "Disconnect wallet".
- **Known limit:** if a stale verify's cookie arrives after a newer one, it names a deleted
  session. It fails safe: signed out, never A activated.

**4. The device use key.**
- WebCrypto Ed25519, **non-extractable**, with the `CryptoKey` itself in IndexedDB.
- No private material reaches the server or any record; the route returns public keys only.
- A missing algorithm, or storage unavailable or refused, is stated plainly, with no fallback.
- Readiness (`ready`, `pending`, `revoked`, `elsewhere`, `none`, `no_entitlement`) comes only from
  `GET /api/customer/offers/:offer/keys`, a fresh readback.

**5. Install and revoke requests.**
- **Exact requests:** `install_key {plan_id, slot, pk, max_hold_units 1, max_units_per_day}` and
  `revoke_key {plan_id, slot}`, each exactly 1 yoctoNEAR and 30 Tgas.
- **Two steps, enrollment only at 7f6fc0b.** The real key and its exact request are shown first,
  and only that reviewed request is sent; a changed one is shown again, unsent. Correction
  (Astra): revocation was then still sent straight from its button. 003wea (`96620c1`) adds
  the same review to revocation, bound to the observed key and epoch.
- **Persist first.** The intent is stored before the wallet is asked, and the readback decides.
- **Recovery.** A retry re-asks with the **same** key.
- **Across tabs,** an atomic IndexedDB claim keeps one key identity.
- **Local deletion** happens only once the readback shows revocation, and only for the record
  still holding that key.
- **No account key is added:** wallet `signIn({})` names no contract.

**6. The real authorizer, through the normal UI.**
- **Configured mode:** the customer page uses the device key while it is `ready`, and names its
  slot (prepare now sends `key_slot`).
- **Preview mode** keeps the labelled `pageAuthorizer`.
- **Before signing** it reads again (slot, epoch, key, account) and stops on retirement at every
  step.
- **What it signs:** the contract's 32-byte digests.
- **Unchanged:** envelope recomputation, the original-versus-draft separation, consent and expiry.

**7. A fresh customer.**
- **Prepared and tested:** builders for `sponsor_shell` (a quoted deposit, never guessed; the
  contract refunds any excess) and the `ft_transfer_call` purchase (exactly units × price, the
  next `purchase_seq`, optional install).
- **Not built:**
  - the storage-cost quote;
  - the token balance and registration reads;
  - `purchase_seq` in the readback;
  - the purchase UI.

  These are a bounded follow-up inside 003w-e (§9.9). The end-to-end path is not claimed from a
  pre-seeded entitlement.

## Acceptance cases

| Case | Evidence |
|---|---|
| Cancellation | sign-in (wallet closed); enrollment and revocation (closed): nothing changed |
| Redirect return and replay | return in the right and wrong browser, wrong state, replay, expiry |
| Missing or invalid capability | unconfigured return origin; no Ed25519; storage unavailable or refused |
| Reload | a new controller over the same storage re-asks with the same key; an attempt's state is in sessionStorage |
| Wrong account | wallet on another account refused before sending; the readback for another account refused |
| Changed key or epoch | authorizer refuses after revoke and reinstall |
| Expired challenge or envelope | expired return attempt; envelope expiry unchanged (existing tests) |
| Lost enrollment response | landed: ready, with one request; not landed: same key on retry |
| Storage lost | shows "held elsewhere", revoked by slot from the account |
| Revocation | local key deleted only after the readback; double revoke stops an active hold's serving |
| Late answers after logout or switch | controller (stale, no verify posted); server (logout during key read, undelivered session, newer challenge); device (retired during sign: zero signatures) |

**Cryptographic interoperability:**
- Our NEP-413 digest equals SHA-256 of the **pinned** `serializeNep413`, with and without a
  callback. The pinned `verifySignature` and our verifier accept each other's signatures.
- Device signatures over the **contract-produced** fixture digests (`customer-signing.json`)
  verify with the server's own `verifiesEd25519`. Signatures over the hex text don't.
- The full path runs: prepare in slot 1, the client's check, the device signature, confirm, then
  the contract double's `open_hold`.

**Tests added (all newly generated keys, synthetic RPC, fictional data):**
- `wallet-signin.test.ts` (12): the real controller over the real composed routes on loopback;
- `device-key.test.ts` (21): the real IndexedDB adapter over fake-indexeddb, the real route over
  the contract-produced entitlement, and the harness double's rules;
- `wallet-harness.test.ts` (3);
- `purchase.test.ts` (3), `deviceKeyPanel.test.tsx` (1), and `signIn.test.tsx` (updated).

**Mutations:**
- with logout cancellation disabled, Astra's three cases and my server-only regression fail;
- before the fixes, Astra's device and controller probes failed; they pass now.

**Astra's probes:** `astra-wallet-logout-review`, `astra-wallet-controller-review`,
`astra-device-key-review` and `astra-device-store-review` all pass. They are uncommitted Astra
files.

## Harness (§9.8, as built)

`npx tsx scripts/wallet-harness.ts [--minutes 30]`:
- the site on `127.0.0.1:8814`, the controls on `:8815`;
- **the real routes with verified identity** over the customer test world. It does not use
  `composeApplication`, and the design states this correction;
- a synthetic **Wallet Selector module** (the official shape) answered by the harness process;
- a CSP `connect-src 'self'`.

**Bounded run:** it served `/api/env` (verified, `harness` named), the page with the module, and
the controls. It stopped itself at the 1-minute bound, both ports were free, and nothing remained.

**Not yet verified:**
- the real browser path through `setupWalletSelector` with the injected module;
- the phone and keyboard review.

Both are Astra's browser review.

## Checks

- **`npm run check`:** exit 0. Lint (384 files) and types are clean. 1316 passed and 1 skipped
  (1317), across 139 passed and 1 skipped files.
  - The first full run had one timeout, `protected-store` "concurrent and repeated writes" at
    5068 ms, unrelated to this job.
  - That test passed alone (12/12) and in the second full run.
- **`npm run web:build`:** exit 0.
  - The main chunk is 911.63 kB (it was 886.08 kB; the session, controllers and panels).
  - The wallet code is lazy: core 212.09, MyNearWallet 113.07, esm 254.56 and buffer 26.91 kB.
  - CSS is 72.52 kB.

**Nothing live:**
- no wallet connection, account, enrollment, payment, transaction, provider or host action;
- no existing credential, env or runtime read;
- no Day One, research directory or legacy main.

The worker stays disabled.

## Remaining (stated, not hidden)

- **e3:** the storage quote, token reads, `purchase_seq` and the purchase UI.
- **Astra's browser review** of the harness: real Wallet Selector setup, sign-in, enrollment, use,
  recovery, phone and keyboard.
- **The real wallet and testnet rehearsal**, §9.10: prepared, not run. It needs Tony's yes.
- **003w-f:** separate-process contention and migration; the actual `CustomerUses` route and
  restart journey; the `needs_reconciliation` and `legacy_invalid` procedure; the integrated
  100/20/80; and the external rehearsal packet.
- **Also retained:** 002f1, 004b, 005c, 005d, 006a and all of M6. All six milestones are open.

**Astra's pending files**, left uncommitted for Astra's handoff:
- `INDEX.md`;
- `ConfiguredJourneyPlanning.md`;
- `WalletSignInReview.md` and `DeviceKeyReview.md`;
- the 003wf brief;
- the four `astra-*` review tests.
