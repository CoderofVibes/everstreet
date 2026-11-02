# M3a: executable characterization of credit and transfer boundaries

**Why (Tony's words):** "the seamless purchase and transfer of business/product to the
investor/acquirer, on NEAR ... has to stay central"

## What the person sees and does

Turn architectural concerns into reproducible evidence before extending customer-credit and
transfer promises. This internal test slice adds no public claim or deployment. The founder
and acquirer experience will build on its guarantees and explicit gaps.

## Underneath

Read the saved adversarial review and FoundationReview/ContinuousDevelopment. Inspect v2 and
the authority/settlement tests. Only tests and the report change here; do not change deployed
v2 behavior to make characterization green. Characterize at least:

- Owner/fulfillment operator consumes credit without a customer policy; identical memo
  charges twice. Two distinct prepayments moving funds twice are not a single transaction replay.
- Seller withdrawal between buyer acceptance and seller's closing acceptance reduces available
  funds without invalidating the digest. Second matching acceptance and finalize are atomic.
- Credit withdrawal before offchain-delivered usage settlement: a prior balance read reserves
  nothing. Existing bucket coverage/old-owner rejection still hold; distinguish coverage
  from consent. Show where a failed old-owner profit payout restores funds across close.
- Concurrent read/reconcile calls after close can duplicate local settlement records; lost
  acceptance response/retry is distinct from chain finality.
- OpenSeat authorization read before close can precede an operation after close. Reproduce
  with an authority double/gate, not real network timing.

Use isolated TypeScript and Rust VMContextBuilder tests. The README's WSL unit command is
`CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p business-v2 --lib` from `contracts/`.
Only that keyless unit path is authorized in this dispatch. No sandbox chain, wasm deploy,
setup/seed/smoke/handoff, signing, keys or runtime database. If a toolchain/permission is
missing, report it precisely and complete unaffected work; no install or safeguard bypass.

## Constraints for the follow-up design

The read-only review's v3 proposal is input, not an approved detailed implementation:

- 100 uses means uses of an identified product under purchased terms, not a monetary balance
  a new owner can devalue by raising prices. Bind product, immutable plan/price and authorized
  units, or an equivalent enforceable constraint.
- Customer policies cap charges but do not prove delivery. A receipt hash proves commitment
  to recorded data, not actual service or absence of unrecorded acts. State the trust boundary.
- Replayed sequence with different amounts/terms must conflict, not misleadingly say already
  successful. Keep sufficient fingerprint/outcome state for bounded, reliable reconciliation.
- Reservations protect against withdrawal and have explicit settle/refund terminal states.
  Do not expire a hold then charge the same work again. Define late provider completion.
- Customer credentials survive sale; old administrative instructions do not. Successor grants
  must be explicit, scoped and digest-bound, never arbitrary retained seller authority.
- Enforce treasury floors in finalization, not a display. Avoid unbounded historical-deal
  scans; handle expiry/cancel/hold withdrawal.
- Polling cannot create instantaneous distributed revocation. Define observed-finality and
  fenced-commit semantics, including closes outside the app. A chain read followed by an
  offchain write is not atomic. Stronger guarantees need a defined close protocol.
- Fixed per-customer state does not bound customer count or fund storage. Define funded
  headroom/registration limits and bounded plan/hold cardinality.
- v3 would be a new crate/account. Preserve Juniper/v2 deployments and recorded config.

## Done when

Tests pass by asserting existing behavior; names/report make undesirable behavior clear.
Record exact commands/results and recommend bounded contract/reconciler slices with tradeoffs.
`npm run check` passes; Rust results are separate. Doubles are not testnet evidence. Commit
locally and stop for Astra review. M3 remains incomplete.

## Priority and size

P0 / M. Independent of model credentials; after 002a1 in this checkout.
