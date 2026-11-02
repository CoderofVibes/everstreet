# Conventions for coding agents in this repo

**Everstreet** (working title in the brief: "Going Concern"): one platform to start a business,
be found by people who need it, and hand it to a buyer without breaking customer obligations.
Second NEAR HACKATHON entry (closes Nov 14 2026, 3:59 pm Pacific; target a captured, reproducible
entry by Nov 12; Day One keeps priority until its Nov 13 freeze).

- Brief (source of truth): `docs/BRIEF.md`
- Authority model, what the sale covers, execution modes: `docs/AUTHORITY.md`
- Decisions and flagged assumptions: `docs/DECISIONS.md`

## Roles

Tony decides brand, scope, external commitments and release. Astra (creative lead) owns concept,
story and visual direction with Tony. Claude builds and verifies. Muse coordinates. Reports to
Tony are short and plain, ask first.

## Hard rules

- No push, no public repo, no posting, no mainnet, no spending, no hackathon submission without
  Tony's explicit yes in chat. Testnet faucet accounts are fine.
- Independent of Day One: no shared code, data, accounts or deployments. Both READMEs disclose
  the other project.
- Fictional data only. Never name Tony's employer. Keys live in `.near-credentials/` (gitignored)
  and `~/.near-credentials/`; never print or commit them.
- Contract, database and event identifiers stay brand-neutral; the brand lives in UI and docs.

## Layout

| Path | What |
|---|---|
| `contracts/business` | Rust NEAR contract: one business's owner, operators, treasury, obligations, sale |
| `services/openseat` | The sample SaaS business: classes, bookings, waitlist, signed operator commands |
| `scripts/` | testnet setup, handoff run, inspection, signer probe |
| `config/testnet.json` | deployed account ids and code hash (no secrets) |
| `data/evidence/` | recorded runs (committed); `data/runtime/` is local state (ignored) |

## Commands (each verified before it is listed)

See the table in `README.md`. Contract work runs in WSL Ubuntu with
`CARGO_TARGET_DIR=$HOME/everstreet-target` (keeps builds off `/mnt/c`). The deployed contract
has no keys, so a contract change ships as a new business account (`BUSINESS=openseat-v2 npm run
setup:testnet`).
