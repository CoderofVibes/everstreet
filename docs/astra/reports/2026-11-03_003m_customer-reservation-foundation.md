# 003m report: durable customer preparation and reservation

Claude, 2026-11-03. Job: [003m](../jobs/2026-11-03_003m_customer-reservation-foundation.md).
Commit `6ac4bc7`. Design: `docs/design/CUSTOMER_USE_RUNTIME.md` §3, §5 and §8 (from 003l1,
`eed4405`).

**Files:**
- New: `server/src/customerSigning.ts`, `server/src/customerRead.ts`, `server/src/customerUse.ts`
- Tables in `server/src/db.ts`: `customer_offers`, `customer_requests`, `customer_request_events`
- `app.ts`: `AppOptions.customer`, eight routes
- `store.ts`: `HttpError` now allows 422 and 503
- `v3read.ts`: exports its strict decoders (no behaviour change)
- Tests: `server/test/customer-world.ts`, `server/test/customer-use.test.ts`, and a `dbPath`
  option for `runtime-world.ts`

## What exists now

- **Offers** (`/api/businesses/:id/customer-offers`; create, list, retire).
  - The current owner only, fenced on the control epoch before and after the plan read.
  - An offer binds the **active** release (with its exact artifact digest) to a contract plan.
    The plan snapshot and the asset are read at a recorded pinned block.
  - A trigger keeps offers immutable but for retirement; at most one active offer per
    release and plan. Offers stay with the business through a sale.
- **Prepare** (`POST /api/customer/offers/:offer/prepare`).
  - The customer's chain account comes from `chain_accounts`; the body never names one.
  - One pinned read of control, plan and entitlement, with the block timestamp, outside any
    transaction.
  - It refuses, with codes:
    - `operator_not_authorized`: the platform account doesn't meter at the current generation;
    - `plan_changed`, `no_entitlement`, `key_not_active`, `paused`, `hold_active`,
      `no_free_unit`, `daily_cap`;
    - any read failure, as `read_*`.
  - In one transaction it then does:
    - idempotency;
    - the per-person bounds;
    - the **one allocation per entitlement** (a partial unique index);
    - the exact envelope with its expirations, persisted before it is returned.
- **Confirm** (`POST /api/customer/uses/:id/confirm`).
  - The envelope digest must match.
  - Both ed25519 signatures are verified against the **stored** public key and digests only.
  - It persists the `open_hold` payload, then runs one leased step.
- **Status, cancel, reconcile.** These are for that customer only: anyone else gets 404. A
  `reconcileDue(limit ≤ 25)` method serves a later worker, which is not started.
- **The step:**
  1. A lease is claimed by CAS (`lease_gen`).
  2. Intent (`reserve_unknown`, attempt count) is committed **before** the writer is awaited.
  3. The writer's answer is recorded as an event only.
  4. One pinned `get_entitlement` read is decided by `decideReservation` (the 9-row table).
  5. While still pending (row 8), it resends the identical payload, within five submissions.

  A result is applied only if the lease generation is unchanged. A read below the newest
  evidence height is ignored.
- **Input.** Only the sha256 and the length are stored, or an opaque reference from an injected
  `InputProtection`. No plaintext is stored in any configuration.
- **Unconfigured.** The default is no reader, no writer and no operator, so customer use answers
  `503 customer_use_unavailable` with no rows and no calls.
- **Not done:** wiring in `main.ts`, signing code, provider dispatch, settlement, a release worker
  and customer UI.

## Evidence

**Contract-produced fixtures.** `customer-readback.json`, `customer-signing.json` and
`direct-accepting.json` are used three ways:
- **Byte matching.** The encoder reproduces the contract's preimages and roots. The test client's
  seed-1 key reproduces the contract tests' signature.
- **Decoding.** Every entitlement and plan the contract produced decodes strictly. Labelled
  synthetic mutations are refused.
- **Seeding.** The chain test double starts from the funded entitlement and from the actual
  accepting and after-sale control.

**The test double.** `FixtureChain` models `open_hold`'s checks in the contract's order, plus
revoke, skip, pause and release. **It is a test double.** It executes no transaction and proves
no live authorization. Every producer has a ceiling: chain 400 calls, writer 50.

**Tests (25)**, each through the real app factory:

| Area | Covered |
|---|---|
| Bytes and decoding | Exact preimages, roots and signatures; strict decoding and mutations |
| Decision table | Rows 1–9, with boundaries (row 7 at exactly `accept_by`) |
| Configuration | Unconfigured; no writer |
| Offers | Owner, fence, plan, idempotency, retirement, immutability |
| Preparation | Prepare, client check, then reserve. Events and rows hold no salt, signatures or input. |
| Idempotency | Same key recovers; changed input conflicts; a second key waits; racing prepares give one allocation |
| Refusals | Wrong person, owner, envelope, signature (another key, swapped, preimage-signed, malformed), deadline; unlinked account, no entitlement, inactive key, bounds, paused, malformed, mixed-block and failed reads |
| Lost answers | Lost reply means one hold; a dropped request means an exact resend; a manual identical resend is `already` |
| Stale lease | Worker A returns while B holds generation 2: A records and decides nothing |
| Advanced history | Superseded (another device's HoldAuth); sequence used (the allocation freed, and a new request takes the next sequence explicitly); expired unopened, by block time |
| Revocation | Before the open: refused, key changed (`E_KEY`). After the open: reserved, not serving. |
| Other | A lagging read is ignored; cancelled preparations hold their sequence until `accept_by`; the protection seam |
| Sale | The request is identical; former and new owners get 404; the new owner sees the offers |
| Authority | Accepting (contract fixture) does not pause; lost platform authority (after-sale fixture) fails closed until re-appointed |
| Restart | A second connection to the same file recovers an interrupted submission while the first worker is still stuck |

**Mutants**, one at a time, each restored with an empty `git diff` against the staged copy:

| Mutant | Caught by |
|---|---|
| No lease-generation check | The stale-lease test, after I strengthened it: the first version let worker A finish only after B, so the state check alone hid the mutant |
| A cancelled preparation frees its sequence at once | The cancelled-allocation test |
| Row 7 `>` → `>=` | The decision-table test |
| Use signature unchecked | The wrong-signature test |
| Stale-read check removed | The lagging-read test |

```
npm run check        Test Files 45 passed (45); Tests 594 passed (594); lint and types clean
npm run web:build    built (existing chunk-size advisory only)
```

Rust: no contract, test or fixture change in 003m. The 003l1 run (70 passed, clippy clean)
stands.

## Boundaries and limits, stated

- **One request at a time** per (customer, plan). A `reserved` request keeps its allocation until
  later jobs (dispatch, settle, release) close the hold.
- **Row 7 relies on A1** (block timestamps rise; design §11). It is shown only against the double.
- **The two-signature consent** (the UseAuth collected at confirm) is a one-unit trust bound
  (design §3.3), open for Astra's view.
- **`chain_accounts` is not wallet authentication.** The local mapping isn't proof that a person
  controls the account.

No live endpoint, provider, signing, deployment, spending or real customer data. No milestone is
claimed. Stopping here for Astra's review.
