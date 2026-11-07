# Reproducible contract builds

The contracts that go to testnet build in NEAR's pinned image
(`sourcescan/cargo-near:0.22.0-rust-1.97.1`, digest in each crate's Cargo.toml) and carry their
build record (NEP-330 1.3.0): the repository, the exact commit, the image and the build command.
Anyone with the repository can rebuild from that commit and compare the hash with the code on
chain.

Built Nov 6, 2026 from commit `aff17cf07cb075e6db306508df4270291c16cbb2` (WSL, Docker):

| Contract | Bytes | sha256 |
|---|---|---|
| business-v3 | 412,277 | `ede1c2f7bed77d1832f5b16e8a873645b387693a486b42a745a06b6d510a29b4` |
| asset-key | 172,663 | `0593b0f92d8280e04c97e543d7784ad3c6623964d28c3ef9c071eb9d71a4d693` |
| spend-allowance | 213,164 | `4b0a422fe93c9dabc55d47b7e119f59e1bb16b1bf7532bd833b063626a72bda2` |
| intents verifier (NEAR's, `docs/INTENTS.md`) | 1,297,007 | `257b53c5ba0deff95ca870c7de944d92d6617eeae65f008782b6d95a513193c8` |

business-v3 was built twice and came out byte-identical.

```bash
git checkout aff17cf07cb075e6db306508df4270291c16cbb2
cd contracts/business-v3        # or asset-key, spend-allowance
cargo near build reproducible-wasm
sha256sum ../target/near/business_v3/business_v3.wasm
```

The earlier testnet series (1 and 2) used plain builds without a build record; series 3 deploys
these.

## Deployed on NEAR testnet (series 3, Nov 6 2026)

Each account was created, funded, deployed and initialized in one transaction, with no access
key: nobody can change its code. The code hash on chain is the sha256 above (base58).

| Account | Contract | Code hash on chain |
|---|---|---|
| `ledgerline-v3-3b.everstreet.testnet` (Direct) | business-v3 | `H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw` |
| `ledgerline-gated-v3-3.everstreet.testnet` (Gated) | business-v3 | same |
| `ledgerline-payout-v3-3.everstreet.testnet` (recovery) | business-v3 | same |
| `feed-key-v3s3.everstreet.testnet` | asset-key | `Nmf8aXspQNzPuYLuBEHLHBexxtmhWi34rocsAQCGAWN` |
| `budget-v3s3.everstreet.testnet` | spend-allowance | `63vehjcNDHvTyYtzKkYdmeqHr9ZMFkCsf6Ndt1uvpCQy` |
| `intents-v3s3.everstreet.testnet` | NEAR's intents verifier | `3XKA3xB2Dz92QhELLkWhZ2j66fR7JYYKPRi3A3J4LFzX` |

`ledgerline-v3-3.everstreet.testnet` is a first Direct attempt with the same code, stopped when
the RPC lost a landed purchase's hash; its record is in `data/evidence/v3-series-3-stopped/`.

The external asset's registry on Sepolia (`0x888188bc8e06c2f05d29092c1745fa5337736cfd`) has no
compiler step: its bytecode is assembled in `scripts/lib/feedRegistry.ts` and run in a small EVM
in `server/test/feed-registry.test.ts`.
