# Digital handover: authority and continuity design constraints

Astra proposal, November 2. This is not an implemented protocol or live evidence. Read the
characterization report from job 003a before choosing the contract implementation. Existing
v1/v2 deployments and their evidence remain unchanged.

## What the product needs to prove

A customer purchased 100 uses of an identified service under recorded pricing terms. After
20 successful, uniquely settled requests and a business sale, the same customer access has
80 uses under those terms. The service identity, release, requests and liabilities remain
with the business. The seller cannot issue new administrative changes after handover; the
buyer can operate it. Third-party accounts need separate transfer evidence.

"No customer re-onboarding or handover-induced service shutdown" is a testable managed-service
goal. Absolute uninterrupted availability despite provider outages or a new owner's future
actions is not a guarantee this platform can make. Preserve unused rights/refund behavior.

## Current boundaries, checked in source

- v2's second matching acceptance changes ownership/generation atomically and voids grants.
- Offchain ownership is reconciled separately. A fresh chain read followed by a database write
  leaves an interval in which the chain can advance. Polling frequency does not eliminate it.
- Current credit methods protect accounting buckets but permit operator-chosen charges without
  customer policy or logical-use idempotency. A monetary balance alone does not pin use price.

## Two authority claims must not be conflated

| Approach | What it can establish | What remains |
|---|---|---|
| Reconciler plus generation checks | Refuse old authority once final chain state has been observed; cancel/fence queued work on observation | A command admitted before observation can race an external close; honest bounded/observed-finality language is required |
| Managed close with a durable administration freeze and readiness attestation | Drain or fence old administrative mutations before the closing transaction can succeed; admit buyer administration after final close | Requires the closing contract to enforce the handshake, trust in the managed runtime, and recovery from aborted/expired closes |

For the flagship managed product, prefer the stronger protocol if characterization confirms
the integration is tractable. Do not claim that adding a last-second RPC read provides it.
The alternative remains useful for legacy/imported businesses but must carry the weaker claim.

## Proposed managed-close protocol to specify and test

1. The accepted terms identify exact sale contents, pricing/plan obligations, a treasury floor,
   successor operating grants and the managed runtime identity. Changes invalidate acceptance.
2. As closing starts, the runtime durably freezes administrative mutations for this business
   and expected generation: releases, provider/config edits, privilege changes and old-owner
   build application. Transactions must check that freeze at commit. Drain or fence admitted
   asynchronous mutations before attesting readiness; do not rely on a banner or process memory.
3. Customer invocations remain separate. They use stable customer credentials, a pinned release,
   durable reservations and business-managed infrastructure. They do not inherit the seller's
   administrative session or depend on reusing a seller-owned credential.
4. A readiness attestation binds the business, deal/version digest, expected generation, frozen
   administration epoch and expiry. The contract must require the relevant attestation for a
   managed close, including calls outside the platform UI. Define which party finalizes and
   preserve both parties' exact acceptance and funding conditions.
5. Finalization changes owner/generation, enforces the agreed treasury condition and installs
   only the explicitly agreed successor grants. Customer entitlement/hold state is unchanged.
   An operating worker may be reauthorized; arbitrary old administrator instructions are not.
6. On observing final close, the runtime atomically reconciles ownership once, fences old work,
   records evidence and enables buyer administration. Unknown chain state fails closed for
   administrative writes. Stable customer service may continue within existing funded policy.
7. Cancellation, expiry and partial failure need a complete state machine. Do not unfreeze old
   administration based only on wall-clock expiry: verify the final chain outcome and whether
   a closing transaction could still be valid. All readiness/close/recovery calls are idempotent
   and bound to their exact request fingerprint. Avoid wedging all customer refunds during a sale.

The attestation/contract design is a follow-up proposal, not authorization for signing or
deployment. Tests must include an outside-UI close, delayed RPC, duplicate reconcilers, an
already admitted administrative operation, process restart during freeze, expiry/cancel races
and a customer invocation spanning close. If the protocol is cut for a local milestone, retain
the weaker claim explicitly; do not silently remove the acceptance requirement.

## Entitlement constraints

Bind service/plan identity, immutable unit pricing and quantity. A customer-authorized policy
limits the gateway's spending but cannot cryptographically prove that an AI result was useful
or delivered. Receipts provide an audit commitment, not automatic truth about service quality.
Use reservations confirmed before serving to avoid racing withdrawals; define settlement,
late results, failed requests, partial refund and expiry without double earning/charging.

An old sequence with different terms is a conflict. Store enough fingerprint/outcome state
to resolve uncertain outcomes and bound history/storage. One fixed-size record per customer
still requires a registration/funding strategy for the number of customers. Keep documents,
prompts, outputs and personal work notes off public ledgers; disclose that on-chain accounts
and token amounts are public. Do not put raw document hashes on chain without considering
guessability; a protected receipt commitment is a separate design detail.
