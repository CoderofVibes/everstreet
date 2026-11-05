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
