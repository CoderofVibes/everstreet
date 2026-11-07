# Funding escrow from another token (NEAR Intents)

A buyer who holds a different test token can fund a sale's escrow through NEAR's intents
verifier. Everstreet acts as the solver, and is labelled as one everywhere it appears. The
business contract is unchanged.

## The flow

1. **Quote.** Everstreet quotes the price in the buyer's token for two minutes.
2. **Deposit.** The buyer's wallet transfers that token into the verifier (credited to the buyer).
3. **Sign.** The buyer's wallet signs its side of the swap (NEP-413). The first time, the wallet
   also registers that signing key with the verifier.
4. **Swap.** Everstreet checks the signature, the key, the deadline and the deposit, runs the
   verifier's dry run, then submits both signed sides in one call. The verifier swaps both or
   neither.
5. **Delivered.** The buyer withdraws the tUSD from the verifier to their own account.
6. **Funded.** The buyer funds escrow with the existing fund request. Escrow counts as funded
   only when the business contract shows it.

Failures: an expired quote, a deposit short of the quote, a refusal by the verifier (nothing
moves), a refund of an unswapped deposit, and a lost response, which is settled from the
verifier's record of spent nonces.

## The verifier

NEAR's own contract, built from its published source: `github.com/near/intents` (MIT, NEAR
Foundation), commit `32cd1f9788a347908164fbcc56525dc6542f158f`, crate `contracts/defuse`
version 0.4.5. Built in WSL with Rust 1.97.1 and cargo-near 0.22.0:

```bash
cd ~/vendor/near-intents/contracts/defuse
cargo near build non-reproducible-wasm --locked --features=contract --abi-features=abi,contract --no-embed-abi
sha256sum ../../target/near/defuse/defuse.wasm
```

The reproducible build runs in NEAR's pinned image (`sourcescan/cargo-near:0.22.0-rust-1.97.1`,
digest named in the crate's Cargo.toml) and embeds its build information (NEP-330):

```bash
cd ~/vendor/near-intents/contracts/defuse
cargo near build reproducible-wasm --no-locked
```

It is 1,297,007 bytes with sha256
`257b53c5ba0deff95ca870c7de944d92d6617eeae65f008782b6d95a513193c8` (base58
`3XKA3xB2Dz92QhELLkWhZ2j66fR7JYYKPRi3A3J4LFzX`), and the local-node test below passes with it.
An earlier plain build (1,287,300 bytes, no build information) is superseded. The prebuilt
`releases/defuse-0.2.10.wasm` in that repository is not used: it reports version 0.2.9 and
carries no build information.

The verifier needs a newer node than our other local tests: its test runs on nearcore 2.14.0,
the version NEAR's own verifier tests use.

## Where it is checked

| What | Where |
|---|---|
| The verifier itself, our business contract and two test tokens on a local NEAR node: underpaid, expired, one side only, wrong verifier, solver signing as the buyer, solver withdrawing the buyer's deposit, refund, swap, lost response and replay, delivered, funded | `contracts/intents-funding/tests/sandbox.rs` |
| The app builds the same nonce and NEP-413 hash bytes as NEAR's Rust tooling | the same file and `server/test/intents-funding.test.ts` |
| The app's routes over the synthetic verifier double | `server/test/intents-funding.test.ts` |
| Four cases in the attack suite | `scripts/attack-suite.ts`, shown at `/attacks` |

```bash
VERIFIER_WASM=$HOME/vendor/near-intents/target/near/defuse/defuse.wasm \
CARGO_TARGET_DIR=$HOME/everstreet-target cargo test -p intents-funding --test sandbox -- --nocapture
```

## On NEAR testnet (series 3)

The same reproducible build is deployed at `intents-v3s3.everstreet.testnet`, born with no
access key, configured with no fee and no admin roles (code hash
`3XKA3xB2Dz92QhELLkWhZ2j66fR7JYYKPRi3A3J4LFzX`). The give token is `talt-v3s3.everstreet.testnet`
(test token, no keys); Everstreet's solver is `solver-v3s3.everstreet.testnet`, which holds its
tUSD float inside the verifier and registered its signing key there. In the configured app the
solver's key is a file the configuration names (`intents.solver.key_file`), never echoed.

The run (`npx tsx scripts/series3.ts run-ext`, record `data/evidence/v3-ext-testnet.json`) sells
the Direct example's business again, from `buyer-v3s3` to `noor-v3s3`, with the escrow funded
from tALT through the app's routes: quote, deposit, the buyer's NEP-413 signature, the solver's
fill, the buyer's withdrawal, then the business contract's own fund call.

What happened (Nov 6 2026): the buyer's first signature was refused until they registered their
key with the verifier (`key_not_registered`, then `add_public_key`). The solver's fill landed,
but its answer reached the app late, so the app showed the funding as `unknown`, not swapped.
On the next read the app checked the verifier's spent-nonce record and the buyer's balance inside
the verifier, and showed `swapped`. The buyer then withdrew 250 tUSD, funded the escrow, and the
sale closed to `noor-v3s3` (generation 3). The solver now re-checks its own transaction for up to
a minute before calling an outcome unknown.

In the demo, the buyer (Noah Brandt) holds tALT and sees "Fund from another token · NEAR
Intents" in the sale's escrow card while the escrow is unfunded. The verifier, tALT and the
solver there are synthetic and labelled so.
