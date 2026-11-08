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

## The fixed companions (Nov 7, 2026)

After the Nov 7 attack review the two companions were fixed in source (`docs/SAFETY_CASE.md`) and
built the same way from commit `24ac5fbf07a1ba2947ff6e69b0f7674ef6ceab92`. Each was built twice
and came out byte-identical. business-v3 did not change.

| Contract | Bytes | sha256 |
|---|---|---|
| asset-key | 198,296 | `e123359c2fd50beaf74df0d5ec0be802c046ab481602bbcd5530c496de225106` |
| spend-allowance | 221,772 | `3bb096761fb5c49ce0d120fffbdbfdfea00d22fce321e3f10a1833c899e6b4cb` |

```bash
git checkout 24ac5fbf07a1ba2947ff6e69b0f7674ef6ceab92
cd contracts/asset-key          # or spend-allowance
cargo near build reproducible-wasm
```

The local-node tests can run on a recorded build instead of a fresh one:
`WASM_ASSET_KEY=<file> WASM_SPEND_ALLOWANCE=<file> WASM_BUSINESS_V3=<file> cargo test -p asset-key --test sandbox`
(and `-p spend-allowance`).

## Deployed on NEAR testnet (agent hires agent, Nov 7 2026, late)

A second business, Signalwatch, on the same reproducible build as Ledgerline's
(`ede1c2f7…`), created, funded, deployed and initialized in one transaction with no access key
([deploy](https://testnet.nearblocks.io/txns/5JzVTgpQCUXBcco6FkPwemJGGjvfJpFtSrtsnaQAbR6)). Its
owner appointed its agent as an operator; the agent bought from Ledgerline over HTTP 402. Run by
`scripts/agent-hires-agent-testnet.ts`; record `data/evidence/agent-hires-agent-testnet.json`
(its checkpoints carry Signalwatch's code hash, key count and control at each block).

| Account | Contract | Code hash on chain |
|---|---|---|
| `signalwatch-v3s8.everstreet.testnet` | business-v3 | `H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw` |

## Deployed on NEAR testnet (series 4, Nov 7 2026)

The fixed companions, new accounts beside the same business (`ledgerline-v3-3b`, unchanged code),
each created, funded, deployed and initialized in one transaction with no access key. Run by
`scripts/series4.ts` (`setup`, then `run`); records in `data/evidence/v3-s4-setup-testnet.json`
and `data/evidence/v3-s4-testnet.json` (`npx tsx scripts/verify-rehearsal.ts
data/evidence/v3-s4-testnet.json --live`).

| Account | Contract | Code hash on chain |
|---|---|---|
| `feed-key-v3s4.everstreet.testnet` | asset-key (fixed) | `G9qsYKsoqeZ3Tpopdx7QBNgp5oz4CejdSHsYK3SNUqMP` |
| `budget-v3s4.everstreet.testnet` | spend-allowance (fixed) | `521EJESDdkoW21rbyr957LYfoxPnB9GztSkCEUFsYDmk` |

The new companion account means new signer-derived addresses, so the external asset has a new
registry on Sepolia, `0x3b093ebdf5e727766c128df85d1f4540d84de269`, whose first controller was
generation 3's address. The series-3 companions (`feed-key-v3s3`, `budget-v3s3`) and registry stay
as recorded; nothing points at them after series 4.

The records name commit `eeacf25`; the run used that script with two corrections committed next
(the run's own app folder, and a hex amount Sepolia's RPC now refuses with a leading zero).

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
