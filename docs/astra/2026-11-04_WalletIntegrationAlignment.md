# Keep account sign-in and customer-use authorization distinct

The next composition job003w must deliver a real usable identity path, not merely hide local
person switching. This note sharpens its existing wallet requirement; it adds no external action
or narrowed acceptance.76931 remains the sole writer on002e1.003v remains the next adapter job.

## Verified source and official interface

web/src/customerAuthorizer.ts currently expects signatures of two exact hold/use digests from a
page-supplied authorizer. CUSTOMER_USE_RUNTIME explicitly describes customer-owned device use
keys, installed on the entitlement by the customer's account. The contract's open_hold and
settle paths verify those message digests; there is no generic wallet-message wrapper here.

The official [NEP-413 specification](https://github.com/near/NEPs/blob/master/neps/nep-0413.md)
defines message signing over a tagged, serialized payload containing the message, nonce,
recipient and optional callback URL, then hashed. It is intended for off-chain account proofs
using a full-access account key. [Wallet Selector's API](https://github.com/near/wallet-selector/blob/main/packages/core/docs/api/wallet.md)
exposes that standard and may complete through a browser redirect rather than a direct return.

Inference from those sources and our contract: passing hold_message_hex to wallet.signMessage
does not produce a signature over the raw digest our current contract expects. Do not wire the
interfaces together by assumption or describe wallet sign-in as customer-use authorization.

## Concrete requirements for003w's identity sub-job

- Account sign-in needs an exact one-use challenge bound to the intended application/session,
  expiry, recipient and network/account policy, verified signature and current account-key
  authority; a returned accountId alone is not proof. Handle redirect state and cancellation,
  unavailable wallets, stale/replayed challenges, account switching and logout. No arbitrary
  callback or person/account relinking based solely on client claims.
- Customer-use authority needs a separately designed implementation compatible with the actual
  registered key and digest scheme. Evaluate the intended device use-key path, its provisioning,
  storage, reload, loss, replacement and revocation. Keep customer private keys off the server
  and out of business-transfer assets. A contract-protocol change is Claude-owned and needs
  explicit compatibility evidence, not an unnoticed workaround in the UI adapter.
- The customer sees plain, distinct consent for signing in, enabling service use and authorizing
  a particular request. Show actual recovery limits and units/expiry; retain the original request
  after interrupted authorization. Do not promise universal wallet/device support.
- Pin the selected supported wallet adapter and verify its real API when implementing. Use
  ephemeral synthetic cryptographic fixtures and injected transports for local tests; separately
  record what requires an approved real wallet/testnet rehearsal. No accounts, signing, key
  provisioning, transactions, packages, deployments or provider calls occurred in this review.

Astra read only the named development files and official public protocol documentation. The
local research library remains unread. Changed this note,003w cross-reference,INDEX and the
checkpoint, plus the separate AppStudioReview browser appendix/screenshot. Fullcheck result
is recorded in BUILD_STATE. All six milestones and the complete100/20/80 live gate remain open.
