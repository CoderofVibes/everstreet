# Guarded revocation design review

Reviewed f123431 APPLICATION_COMPOSITION section11 and the initial contract diff while Claude
61536 remains the sole writer. The proposed registration/slot/epoch/public-key guard, shared
revocation mutation, no migration, explicit pinned-block capability and no legacy fallback fit
003wec. Actual contract tests and client implementation remain pending, not accepted evidence.

## Preserve the newer authorization locally as well as on chain

The brief already requires a same-public-key reinstall at a newer epoch and a new registration
with reused slot/epoch. Include those in the CLIENT delayed-wallet recovery tests, not only Rust.
The current local record and deleteIf compare public key but do not bind registration/epoch.
Thus a future "old epoch no longer active => done => delete same public key" implementation could
delete the private key which still serves a valid newer authorization. This is a design risk from
the existing storage shape, not a claimed failure of the new code (not implemented yet).

Required outcome: a stale guarded request leaves the replacement active, and retains usable local
key material for a same-key reinstall, changed registration, or another tab's newer stored record.
Re-check the full identity and the actual conditional storage operation; public-key equality alone
does not establish that a record is still the reviewed incarnation. Cover the real IndexedDB path
where the claim is atomic across tabs. Do not weaken the guard or silently send a new request.
Choose the smallest correct retention/conditional-update design and document it in section11.

## Outcome language

Distinguish "the reviewed authorization is no longer active" from "this transaction revoked it".
A replacement/removal observed after a lost answer proves current authority, not which action
caused it. Show the replacement honestly, preserve it, and require a new review to revoke it.
The absence of the old authorization is sufficient to stop using it; do not imply an unrelated
replacement is inactive or that a particular transaction confirmed without matching evidence.

Capability support should remain pinned to the same observed block, unsupported/unknown must not
downgrade, and all guard failures must leave accounting and hold deadlines unchanged. The actual
guarded success still needs the existing signed-use settlement proof. These clarify the existing
acceptance criteria; no additional feature or external approval is introduced.

Astra adds this review only; Claude owns contracts/client/code and commits. Record it in INDEX
at handoff. Enrollment/revocation browser submissions remain pending applicable approval; no
bypass, deploy, real keys/transactions, spending, research or Day One. All milestones remain open.

## Independent contract verification at49b9c37

Astra ran the committed s04 contract tests offline in the existing Ubuntu environment:
`cargo test --offline --manifest-path /mnt/c/Dev/Everstreet/contracts/business-v3/Cargo.toml --lib s04 -- --test-threads=1`
with the repository's existing CARGO_TARGET_DIR. All6pass: signatures/holds, prior revocation,
legacy-versus-guarded replacement, stale/invalid/overflow unchanged-state checks, reused
registration/slot/epoch, and serving-stop with valid signed-use settlement. No signing/deployment.
Builder's recorded full suite separately has79pass, clippy clean and wasm build success. The
client/storage/capability tests and browser gates remain pending; this is contract evidence only.

## Follow-through on the local retention patch

In the in-progress retention branch, deletion now compares slot/created_ms/revoke intent and
the same active public key is retained, which addresses the deletion risk. Also review the
`else if (mine) updateRecord({...mine, intent:null})` branch: putIf still compares only public key.
If another handle stores a newer record with the SAME public key during the delayed wallet
answer, clearing intent with the old `mine` can overwrite the newer slot/created_ms/limits/intent.
The stillThere branch has the same write pattern. Preserve the current newer local incarnation
through conditional updates as well as conditional deletion. Include actual controller plus
two IndexedDB handles in coverage. This is a specific source-review follow-up, not a newly
executed failure claim; do not replace the ongoing tests with a storage-only mock assertion.

At20:13 Astra then reproduced both branches independently in
`server/test/astra-key-record-review.test.ts`: actual keys route, DeviceKeys controller, two
real IndexedDB adapter handles over fake-indexeddb, and a delayed synthetic wallet answer.
Both unchanged registration and new registration fail: expected newer created_ms, limit15,
intent enroll; received old created_ms, limit10, intent null. Thus the update risk is now
executed evidence (2/2 failures), not just a source concern. The fixture installation only
establishes initial test state; no browser permission action, real signing or network occurs.

Astra also prepared but did not dispatch
jobs/2026-11-04_003wf1_configured-maintenance-lifecycle.md as the next bounded parent003wf child.
It retains every parent gate, pending browser permissions and the full roadmap. Do not start
it in the current003wec run; finish corrections/checks/report and stop at Astra's handoff.

Required npm run check at20:13 passes lint/types, then1403pass/20fail/1skip. Two are the
new same-key regressions; seventeen composition/wallet-signin cases hit sandbox loopback
EACCES or consequential failures, and protected-store concurrent-write case times out.
This sandbox run is not a clean baseline or acceptance. Re-run final checks with the already
authorized loopback/test filesystem access after code settles; investigate any remaining
protected-store timeout rather than assuming it is an implementation defect or a pass.

At20:14 the two independent same-key cases pass after Claude made conditional updates compare
the original slot/created_ms/intent atomically, including both late-answer branches. Together
with the capability regression, focused independent verification is3/3. Source reviewed.
The authorized-loopback full check52317 then completes with lint/types clean and1422pass/
1fail/1skip: only the protected-store200-write concurrency test exceeds its5-second deadline.
No loopback failures remain. Claude is isolating that existing test; no clean full-check claim.
