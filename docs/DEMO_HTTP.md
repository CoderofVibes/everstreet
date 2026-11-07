# Driving the demo over HTTP

`npm run demo` serves the site on port 8820 and the synthetic wallet's controls on the next port
(`npm run demo -- --port 8830` moves both: 8830 and 8831). Everything below is fictional and runs on
your machine: a synthetic wallet and a synthetic chain that applies the real contract's rules.

## Who you can be

`GET http://127.0.0.1:8821/` lists the controls; `GET http://127.0.0.1:8820/__harness/accounts` lists
the cast with roles. The ones the README's route uses:

| Account | Who | Role in the story |
|---|---|---|
| `delphine.near` | Delphine Marsh | the founder: owns Ledgerline, Relaydesk and Signalwatch; Signalwatch is mid-sale |
| `buyer.near` | Noah Brandt | the buyer of Signalwatch (holds tALT for the other-token funding) |
| `cara.near` | Cara Okafor | a customer who prepaid Ledgerline and Signalwatch before the sale |
| `priya.near` | Priya Raman | a case worker on Relaydesk's team |
| `rosa.near` | Rosa Lind | new here, nothing yet |

Switch who the wallet signs as with `POST http://127.0.0.1:8821/account/<account>`.

## Signing in

The site's session is a cookie proved by a NEP-413 signature over a one-time challenge:

1. `POST /api/session/challenge` (empty body) → `{ challenge: { message, recipient, nonce, callback_url } }`
   and a `Set-Cookie` for the sign-in binding. Keep the cookie.
2. Ask the synthetic wallet to sign it: `POST /__harness/sign-message` with
   `{ message, recipient, nonce, callbackUrl }` (the wallet signs as the account set above) →
   `{ accountId, publicKey, signature }`.
3. `POST /api/session/verify` with `{ account_id, public_key, signature, nonce }` and the cookie →
   `201 { person }` and the session cookie. Every call below carries that cookie.

Signing in as another account in the same cookie jar replaces the session.

## A sale action, in order

Every wallet action on a sale runs through five calls. The order matters: the hash is accepted only
after the wallet was asked.

1. `POST /api/sales/:business/prepare { kind, input }` → the exact call for review (`input`,
   `action_digest`, the effects in words). Nothing is stored.
2. `POST /api/sales/:business/actions { kind, input, action_digest, idempotency_key }` → `201`, the
   stored action (`action.id`, `action.call`).
3. `POST /api/sales/actions/:id/requested {}` → `{ ask: "granted" }`: the wallet is about to be asked.
   A hash sent before this step is refused (`409 not_requested`).
4. The wallet sends `action.call` (`POST /__harness/tx` with `{ receiverId, actions: [{ methodName,
   args, gas, deposit }] }` on the synthetic wallet) → the transaction hash.
5. `POST /api/sales/actions/:id/requested { tx_hash }`, then `POST /api/sales/actions/:id/check {}` →
   the outcome read from the chain (`resolution.kind`: `confirmed`, `refused`, `unknown`,
   `no_longer_possible`).

Kinds: `propose`, `revise`, `fund`, `accept`, `unfund`, `cancel`, `expire`, `claim`, `appoint`,
`register`, `abort`, `create_plan`, `owner_probe`. The README's "Try an owner action" is
`owner_probe`: a former seller asks the contract to appoint them; the contract refuses
(`E_NOT_OWNER`) and the page shows the refusing transaction. A plain `appoint` by a former owner is
refused by Everstreet itself at `prepare` and never reaches the chain.

`GET /api/sales/:business` is the sale page's reading: roles, the live deal, outcomes, the viewer's
claims. `GET /api/sales/:business/proof` is the handoff proof after a close.

## A customer use

`POST /api/customer/offers/:offer/prepare { idempotency_key, input }` (`input` is one string, the
document) → `201 { use }`. The next step, `confirm`, needs two ed25519 signatures from the
customer's device key, which the browser holds in IndexedDB; there is no HTTP stand-in for it. Over
plain HTTP a use stops at "Prepared, nothing held"; the browser route completes it.

## What is synthetic here

Transaction hashes, block hashes and the contract accounts (`*.demo.near`, `tusd.near`) are the
synthetic chain's. `/api/sales/:business/proof` marks every synthetic fact (`source: "synthetic"`,
`code_hash: "synthetic"`). The recorded runs on real NEAR testnet are in `data/evidence/` and are
verified with `scripts/verify-rehearsal.ts <record> --live`.
