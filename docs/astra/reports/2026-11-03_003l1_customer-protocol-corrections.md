# 003l1 report: customer protocol corrections

Claude, 2026-11-03. Job: [003l1](../jobs/2026-11-03_003l1_customer-protocol-corrections.md).
Commit `eed4405`.

**Files:**
- `docs/design/CUSTOMER_USE_RUNTIME.md` (rewritten)
- `contracts/business-v3/src/tests.rs`: five new tests; no behaviour change
- `server/test/fixtures/v3/customer-signing.json` (new, contract-produced)
- `server/test/customer-signing.test.ts` (new)

## Verified facts (actual methods, keyless unit tests)

| Test | Shows |
|---|---|
| `c01` | **The owner meters without any grant.** Before a sale, the owner (not an operator) opens and settles. After a Direct sale with no grant, the platform's `meter`, the former owner and a stranger get `E_NOT_OPERATOR`, but the **new owner settles** the open hold and opens the next one. "Nobody can settle" was false. |
| `c02` | **A Gated close accepts METERING for any account.** SUPPORT alone is refused. `stranger.near` with METERING closes and settles. `meter` (SUPPORT only) and `meter2` are refused. Platform identity is app policy, not a contract guarantee. |
| `c03` | **A live deal never pauses metering.** An offer open 30 days, at day 29 in `accepting`, and (Gated) through `closing`: holds open and settle. After the close the same account, granted again, settles at generation 2. |
| `c04` | **What identifies a hold:** |
| | Two devices sign different HoldAuths for one sequence. The exact one again is `already`; the other gets `E_HOLD_SEQ_USED`. |
| | The active view names seq, units, serve_until, key slot and epoch. After the close only seq, bitmap, count and root remain. |
| | A HoldAuth is refused for good from `serve_until − 60 s + 1 ms`. |
| | A revoke mid-hold sets `serve_until = now`, so the exact resend is no longer `already`. An already-signed use still settles, and the old epoch gets `E_KEY`. |
| `customer_signing_matches_server_fixture` | Hold and use preimages written by hand hash to exactly `hold_message`/`use_message`. A signature over the preimage is refused (`E_SIG`); one over the 32-byte digest opens and charges. One-slot, partial (slots 0 and 2 of 3) and empty closed roots are recomputed and match the entitlement. |

`customer-signing.test.ts` checks the fixture with `node:crypto` ed25519:
- preimage → digest;
- the signature verifies over the digest and not over the preimage;
- a flipped bit fails;
- the roots are recomputed, and a missing used slot changes the root.

## The design, corrected (proposed behaviour)

Each point of 003l1 has a section; a table at the top maps them.

- **Prepare before sign.** The server persists the exact envelope first (§3).
  - **The envelope** binds the request, offer, release, artifact, network, entitlement, key,
    sequence, deadlines, the input digest and salt, and the consent.
  - **Encoding:** borsh-style and length-prefixed.
  - **Values:** canonical decimals and lowercase hex.
  - **Expiry:** three expirations, on chain or server clocks (`accept_by = serve_until − 60 s`).
- **Network binding.** The contract's messages don't name a network. The app binds it through
  the fingerprint, the envelope and one key per (network, business, plan) (§4).
- **Reservation is decided only by an exact pinned readback**, a nine-row table (§5.2):
  - `reserved` needs every field equal;
  - three rows prove a refusal (superseded, key changed, and expired unopened by **block
    timestamp**);
  - three rows stay `unresolved`;
  - nothing authorizes a fresh hold. Writer answers are events, not evidence.
- **No blanket freeze.** Service follows authority (§6), with the missing-grant recovery stated
  (the owner re-appoints the platform). Pinned reads can't remove a close or revocation race; the
  one-unit hold bounds it.
- **For later jobs** (§7):
  - at-most-once dispatch;
  - only a complete used-slot list decides a closed root;
  - expiry proves nothing about charges.
- **Seams.** Protection and retention are seams with no plaintext fallback (§3.4).
- **003m scope.** §8 gives the tables, injected options, routes and bounds.

## For Astra to check

- **A1** (§11): NEAR block timestamps rise strictly from block to block. Only the
  "expired unopened" proof uses it. It isn't verified against nearcore here, so that proof holds
  for the synthetic transport only until it is.
- **The signed UseAuth is collected at confirm**, so the platform can settle without the
  customer online. That is a stated trust bound of one unit per request (§3.3). Signing after the
  result is the alternative, if Astra prefers it.

## Checks

```
WSL cargo test -p business-v3 --lib            → 70 passed (5 new)
WSL cargo clippy -p business-v3 --all-targets  → 0 warnings
npm run check        Test Files 44 passed (44); Tests 569 passed (569)
npm run web:build    built
```

**No blocker to 003m.** It proceeds under §8.

No live call, signing, deployment or customer runtime, and no milestone is claimed.
