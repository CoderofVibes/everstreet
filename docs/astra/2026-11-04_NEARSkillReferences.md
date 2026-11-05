# NEAR implementation skill references received from Tony

Tony's other thread supplied the official NEAR skill repository for use in implementation:
https://github.com/near/agent-skills . These are public technical references, separate from the
ignored hackathon research library. No research assessment or content transfer occurred.

## Obtained source and complete companion files

Astra fetched the official repository revision through GitHub's API, then downloaded the three
recommended packages, including every file under their package directories, from that revision.

- Revision: `cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b`
- Local cache: `C:\Users\antho\AppData\Local\Temp\EverstreetNearSkills-cb32b6af`
- Integrity inventory: `manifest.json` in that cache, with source revision, paths, byte counts
  and SHA-256 for each downloaded file.21 files,148917bytes.
- Nothing installed or executed. The cache is outside this Git worktree. No upstream text or
  example code is copied into product implementation by this pass.

| Skill | Local entry, relative to cache | Official pinned source |
|---|---|---|
| near-smart-contracts | `skills/near-smart-contracts/SKILL.md` | https://github.com/near/agent-skills/blob/cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b/skills/near-smart-contracts/SKILL.md |
| near-api-js | `skills/near-api-js/SKILL.md` | https://github.com/near/agent-skills/blob/cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b/skills/near-api-js/SKILL.md |
| near-contract-audit | `skills/near-contract-audit/SKILL.md` | https://github.com/near/agent-skills/blob/cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b/skills/near-contract-audit/SKILL.md |

The smart-contract package includes its9 rule files; API package includes6 reference files;
audit package includes3 severity references. Read a selected complete SKILL.md and its referenced
files before applying it. If the temporary cache is gone, obtain those exact public files from
the pinned revision; do not silently substitute an unrelated package or floating version.

## Review status and application

Astra read the smart-contract and API entry documents through the browser, then fetched the
complete pinned packages to avoid incomplete cached web references. Astra also read the entire
pinned audit entry and all3 companion severity documents locally. The remaining pinned entry/
reference reads belong before application in003wf2; do not describe them all as reviewed already.

Use the audit workflow to organize code-specific review: automated checks, manual authority/
economic/callback analysis, demonstrated findings and remediation evidence. It is guidance for
our review, not an independent audit or certification. Severity must follow actual impact in
this contract, not a generic detector label. Verify examples against the installed SDK.

Current repo manifest versions independently read: `near-api-js`7.3.1, Wallet Selector core and
MyNearWallet10.1.4, `near-sdk` exactly5.29.1 for business-v3. Recheck lockfiles and actual API/types
before relying on version-specific examples. Existing architecture, authority and dependency
choices remain governing. Generic setup/deploy/upgrade examples grant no new execution rights.

003wf2 should use these references while validating storage deposits, caller/beneficiary authority,
callback outcomes, arithmetic and exact wallet calls against this repository's actual v3 methods.
The existing lifecycle correction job continues; this reference handoff does not dispatch003wf2.
No new SDK, wallet stack, billing/service, contract deployment, real transaction or global skill
installation is requested by this document. Read any further feature skill only when relevant.

## Astra changes

Added this reference handoff and linked it from the queued003wf2 brief and INDEX. Downloads are
read-only upstream retrieval into a temporary cache; no repo implementation changes and no Git
writes. No code check is needed solely for these documentation references. Claude reviews and
locally commits the docs together with the other pending Astra work after the applicable checks.

## API reference review completed — November4,21:56 Pacific

Astra has now read the pinned near-api-js entry and all6 companions in full: api_patterns,
tokens_guide, key_management, meta_transactions, nep413 and contracts. This was read-only
technical reference review; no example was executed, no key generated/printed, no SDK or wallet
migration, and no network/transaction was performed. The contract package's full pinned rule
review remains required before its application.

Grounding against this repository: web/src/wallet.ts sends one exact FunctionCall and retains
only a returned transaction hash, not a claimed outcome. Direct sale should reuse that separation
and authoritative receipt recovery. Current v3 source measures party-record storage separately
from token-contract registration; do not substitute one quote for the other. claim_party moves
the selected category into an asynchronous payout, and on_payout handles actual outcome; a
successful initial wallet call is not proof that proceeds arrived. These are existing003wf2
requirements, not an added feature or evidence of finished implementation. The supplied API
examples remain subordinate to actual7.3.1 types and this repo's pinned wallet/authority design.
Examples for relayers, new access keys and deployment do not authorize those operations.

This updates the reference pass's read status and concrete application notes only. Claude still
reads each selected complete skill and its references for its own implementation context and
reviews/commits this documentation. No additional unchanged code suite is warranted for this note.

## Contract reference review completed — November4,22:04 Pacific

Astra has now read the pinned near-smart-contracts entry and all9 local rule files completely:
security-storage-checks, state-collections, structure-near-bindgen, xcc-promise-chaining,
testing-integration-tests, upgrade-migration, yield-resume, chain-signatures and best-contract-tools.
Together with the API entry+6 companions and audit entry+3 severity references, the three cached
packages' local reading is complete. Further upstream API claims still need version-specific
verification when used; this does not certify the contract or imply any sandbox/testnet run.

Apply principles to this repository, not examples verbatim. In particular, v3 ensure_party
explicitly flushes its store collection before measuring storage growth; retain that measured
behavior rather than copying a simplified example that measures an unflushed lazy collection.
Likewise, v3 claim_party reserves the category before scheduling its payout; on_payout finalizes
or restores it. The generic callback example's wording about state changes only in callbacks
must not remove the existing pre-dispatch reservation and permit duplicate claims.

No scaffold, installer, migration, self-upgrade/DAO authority, chain-signature/relayer feature,
dependency replacement, key operation, live transaction or deployment was performed or authorized.
Those examples are outside this job's selected implementation scope. Preserve the existing
authority model and state/account semantics; use actual pinned Rust tests and receipt behavior.
