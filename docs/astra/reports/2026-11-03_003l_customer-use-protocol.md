# 003l report: the customer-use protocol, and contract readback fixtures

Claude, 2026-11-03. Job: [003l](../jobs/2026-11-03_003l_customer-use-protocol.md).
Commit `f456c69`.

**Files:**

- `docs/design/CUSTOMER_USE_RUNTIME.md` (new)
- `contracts/business-v3/src/tests.rs`: one fixture test, no behaviour change
- `server/test/fixtures/v3/customer-readback.json` (new)
- `server/test/customer-readback.test.ts` (new)

No customer admission, tables or routes were implemented, as the job required.

## What the design establishes

It was read from the contract (`open_hold`, `settle_hold`, `release_hold`, `install_key`,
`revoke_key`, `skip_hold_seq`, `get_entitlement`, `check_use`, `require_metering`, `finalize`) and
from the server runtime (`Admission`, `answerFor`, `runtime_invocations`).

**Authority, as the contract enforces it:**

- Only the customer's own account installs a use-key.
- The customer signs every `HoldAuth` and `UseAuth`.
- Only a METERING operator of the current generation (or the owner) opens and settles.
- After a sale only the deal's grants operate. Existing tests `g01` and `g02` prove the successor
  operator serves the same customer's key, and that the old operator gets `E_NOT_OPERATOR`.

**Mappings:**

- A person maps to a chain account through `chain_accounts`.
- A business maps to a contract through the operator binding.
- A plan maps to a release through a proposed immutable `customer_offers` row.
- Owner trials stay fenced on the owner epoch.
- `customer_use` is a separate purpose, read by customer authorization only, and never by a
  successor.

**Fingerprints** are salted with a per-request server-side random value. The readback proves why:
an active hold's fingerprints are public in `get_entitlement.hold_slots`.

**The state machine** runs `accepted → reserve_requested/unknown → reserved → dispatched →
result_recorded/failed → settle_requested/unknown → settled`, plus `released_unused` and
`unsettled_after_deadline`.

- Intent is persisted before each side effect, and nothing remote is awaited inside SQLite.
- Recovery is by pinned-block readback only.
- **Where replay can't be proven, the state stays explicitly unknown:**
  - a lost provider response is `result_failed`/`outcome_unknown`, with no settle and no
    redispatch;
  - a `closed` readback whose root doesn't match is reported as unknown.

**A sale with a use pending.** Service is uninterrupted only when the deal grants METERING to the
platform's own operator account.

- Otherwise settlement stops from the close receipt on.
- With no grant at all (Direct mode only), pending uses are absorbed by the business or released
  after `settle_until`.

The design proposes a bounded remedy (no new holds while a deal is `accepting` or `closing`, and
the platform grant required for managed products). It states plainly that this makes interruption
bounded and visible, not zero.

## Contract-produced readback

`customer_readback_matches_server_fixture` runs actual methods: `sponsor_shell`, a token buy with
the key installed, `open_hold`, `settle_hold`, a resent use, `release_hold` by a stranger after the
deadline, and an actual sale. It records each view's JSON, and asserts the key numbers in Rust.

| State | Values |
|---|---|
| Funded | 100 |
| Consumed | 20, across two closed holds |
| Active hold | 4 of 10 charged: readback `charged`, `conflict` and `unused`. A resent use gives `["already"]`, and charged stays 4. |
| Released after the deadline | free 76, consumed 24 |
| After an actual sale | 100/20/80 unchanged; owner `buyer.near` at generation 2, operator `meter2` |

**One finding for the next job.** On a **closed** hold, `check_use` answers identically for the
genuine fingerprint and an altered one (`closed`, `slot_used: true`, the same root). A client can
confirm its own use only by recomputing `closed_hold_root` from the fingerprints it submitted. The
protocol does that, and the server fixture test pins the behaviour.

```
WSL cargo test -p business-v3 --lib            → 65 passed (1 new)
WSL cargo clippy -p business-v3 --all-targets  → 0 warnings
npm run check        Test Files 43 passed (43); Tests 566 passed (566)
npm run web:build    built (existing chunk-size advisory only)
```

The fixtures use test signing keys (`SigningKey` seed 1), not wallet signatures.

## Live prerequisites not met

These are design §10; each needs separate authorization:

1. **Customer wallet sign-in**, so `install_key` comes from the customer's own NEAR account, plus
   client-side ed25519 signing of holds and uses.
2. **A platform METERING operator key**, its custody, and transaction signing. Not authorized.
3. **A live testnet endpoint**, with verified chain identity.
4. **A real FT**, with measured gas and storage.
5. **Encrypted customer-output storage**, with deletion.

The next bounded job is proposed in design §11: the tables, a `CustomerAdmission` alongside
owner trials, a writer interface with only a test-double implementation, two customer routes, and
tests against these fixtures.

No customer runtime, no live NEAR use, no M2 or M3 completion. Stopping here for Astra's review.
