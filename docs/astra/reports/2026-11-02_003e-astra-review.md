# Entitlement core review and next boundary

Astra, November2,15:07 Pacific. Reviewed `219976c`, the implementation note, report and source.
Separate read-only Claude reviewer exec41509 completed (session
`e417185d-2c84-4c9c-9ac8-fa1f76979b56`); its full analysis is in003e-source-review. It ran no
tests. Main builder reports26 v3 and27 unchanged v2 unit tests. Astra has not independently
executed those Rust scenarios. No live NEAR or provider activity occurred.

## What is established and what is still a candidate

Source supports the intended fixed-price prepaid buckets, two-pass signed-use settlement,
monotonic payout identity and conservative missing-callback liabilities. Those are useful
foundations. The unit ownership injection is correctly labelled; it is not a sale. The full
manifest/gateway/journal/close proposal remains unaccepted. Do not integrate the core yet.

Concrete source-confirmed corrections for003e1:

- Initialization bounds max_hold_units but accepts arbitrary TTL/grace ceilings. Plans can lock
  held units for years or overflow later deadline arithmetic. Bound these at creation, use
  checked deadline arithmetic, and expose them to clients.
- `get_entitlement` lacks active slot fingerprints/key identity needed to reconcile an uncertain
  charge against a particular use. Public on-chain observations must support exact readback;
  the bitmap alone is insufficient.
- Successful claim retries mix customer returns and owner withdrawals in claims_paid. Keep
  economic categories stable through retries. The unit counter named refunded means units
  retired into refund liability, not money already paid. Views and documentation must say so.
- Saturating reporting counters prevent gross-flow overflow from blocking money, but currently
  give no indication that the reported amount is incomplete. Add a fixed-size overflow flag per
  affected counter/month and preserve the no-allocation callback rule.
- Owner profit withdrawals can take every shared payout slot. Reserve customer capacity and cap
  non-customer pending payouts. This reduces this path's starvation; it does not prove fairness
  against arbitrary Sybil customers or recover missing callbacks.
- Re-grant of an existing operator is possible with zero deposit; preserve the explicit
  intentional administrative-action deposit requirement. Validate calendar-month view inputs.

Source review's weak-key forgery claim is **unconfirmed**. Its author explicitly did not check
the pinned host implementation. Astra checked Cargo.lock: near-vm-runner0.37.4. Official
[VMLogic documentation](https://docs.rs/near-vm-runner/0.37.4/near_vm_runner/logic/struct.VMLogic.html)
describes the verification host API but does not settle strictness; attempted source retrieval
did not locate the implementation. Do not label the forgery as reproduced or copy a guessed
crypto blacklist.003e1 starts by running its proposed synthetic identity/zero-key cases against
the pinned VM and records the exact result and implementation evidence. Prefer existing vetted
validation to new cryptographic code if rejection is necessary. No live signature/transaction.

## Limits to retain

The recreated-party stranded case begins from already-corrupt state; harden it when revisiting
the recovery path but do not present it as an ordinary reachable theft. An `already` hold reply
currently skips signature verification: it proves matching stored fields, not the submitted
signature. Authenticate or explicitly distinguish this observation in the API.

Gas, physical FT balances, detached native storage refunds, receipt rollback, initialization
atomicity and callback reconciliation remain integration gates. Unit mock gas figures are not
Wasm/chain evidence. Key revocation cannot distinguish when a signed use was produced: remaining
slots of the existing hold can settle during grace; revocation blocks new holds. UTC-day caps
are not rolling24-hour limits. State these accurately rather than promising more revocation.

Next bounded implementation is003e1; later managed-close and customer integration must use the
corrected views and retain100/20/80, old-owner revocation and business-owned knowledge goals.

