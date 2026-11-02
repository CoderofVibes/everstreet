# Decision log

Newest first. Routine engineering choices are Claude's; anything that changes the user promise
goes to Tony and Astra with an alternative.

## 2026-11-01 · Gate 1 (first 48 hours) — done in the first session

**Result.** On NEAR testnet, `openseat.everstreet.testnet` changed owner from the founder to
Northline in one call; the founder's real transactions were then refused on chain; OpenSeat
refused the founder's stale command and the founder-era worker; Northline appointed a new
worker; Sam, waitlisted before the sale, was promoted once under generation 2 and his original
reference `OS-HZ6VB-SBDEA` returns a confirmed seat and a calendar file. Every step and hash:
`data/evidence/handoff-testnet.json`. `npm run inspect` shows 0 keys on the contract account.

Decisions:

1. **One contract per business, born locked.** Root creates the account, funds it, deploys and
   calls `new` in one transaction and never adds a key. No upgrade method. Consequence: a contract
   fix means a new business account (`openseat-v2…`). Chosen because "the founder can't bypass the
   sale" is only true if nobody can redeploy.
2. **Authority generation** instead of revoking things one by one. A sale bumps it; every operator
   grant and signed OpenSeat command names one; both sides refuse a stale one.
3. **Operator commands are signed, not sessions.** OpenSeat has no operator login or API token. A
   command is signed with a key on the operator's NEAR account; OpenSeat checks the key on chain
   (full access, or function-call scoped to this business) and asks the contract
   `operator_check` at final finality. Nothing to keep using after the close.
4. **Two-party acceptance of one digest.** Either side may accept first; the buyer's acceptance
   holds the price; any revision voids both acceptances and returns the hold; the second matching
   acceptance settles, moves control and bumps the generation in the same call. Closing one deal
   voids any racing deal and returns its hold.
5. **Demo credits, not NEAR.** Integer units in the contract's own ledger (`asset()`: DEMO, 0
   decimals). The issuer (platform faucet) can mint to anyone except the business treasury.
6. **Obligations pay only their committed beneficiary** (`sha256(salt|account)`), so neither
   owner can redirect reserved funds to themselves through "fulfilment".
7. **OpenSeat on Node 24's built-in SQLite**, one write transaction per state change, outbox
   events in the same transaction, promotion jobs keyed by the cancellation (redelivery-safe).
8. **Testnet RPC is FastNEAR** (`test.rpc.fastnear.com`); `rpc.testnet.near.org` returned 429
   "deprecated" mid-run. The run resumed from its state file without repeating any transaction.
9. **Chain Signatures probe passed** (read-only): `v1.signer-prod.testnet` answers `public_key` and
   `derived_public_key`. No signature requested yet (that costs a deposit; later gate).
10. **Name.** Repo, docs and testnet root use "Everstreet" (Tony, Nov 1). Contract, tables and
    event names stay brand-neutral (`business_control`, `business-deal/v1`).

Assumptions that weaken the promise (flagged for Tony and Astra):

- **All demo identities' keys are on this one machine.** Founder, buyer and workers are separate
  NEAR accounts, but the demo holds all their keys. A real buyer would hold their own. The README
  must say so.
- **OpenSeat itself is operated by someone.** The contract proves who may operate; whoever hosts
  the OpenSeat process could still edit its database directly. For the hackathon the platform
  hosts it; a real handoff also needs the hosting itself transferred (that is the external
  "pending" item). This is the honest edge of the claim.
- **Finality window.** OpenSeat reads final state, so a command signed in the ~2 s between a
  sale's inclusion and its finality could still pass under the old generation.
- **The founder-era worker's refusal reads "not an operator"**, because the close clears grants.
  Accurate, but "grant is from generation 1" would tell the story better; small contract change
  for the next deployment.

Not done in gate 1 (next gates): founder launch flow, catalog and search, web UI, evidence room,
rehearsal mode, external simulated asset with its own completion evidence, sandbox replay of
the whole run from TypeScript, Chain Signatures action.
