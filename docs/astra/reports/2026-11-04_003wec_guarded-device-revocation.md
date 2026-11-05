# 003wec Revoke the reviewed device key at execution: report

Job: `docs/astra/jobs/2026-11-04_003wec_guarded-device-revocation.md`.
Design: APPLICATION_COMPOSITION §11, written and committed before the code (`f123431`).

**Status: in review**, for Astra. Not browser-verified: enrollment and revocation submissions
in the browser wait for the pending approval, and none was run or bypassed here. 003web's
enrollment, first-use and ready-fold browser gates stay open too. 003wf (and its prepared child
003wf1) is not started.

## Commits

| Commit | What it holds |
|---|---|
| `e17b773` | Astra's PurchaseRecoveryVerified, the 003wec sequencing note, INDEX; JOBS: 003wec taken |
| `f123431` | Design §11, before any code |
| `49b9c37` | **Contract:** `revoke_key_guarded`, `get_key_terms`, Rust tests and the fixture (not deployed) |
| `0ae3af2` | Astra's GuardedRevokeDesignReview, KeyCapabilityTimeoutReview, two probes, and the 003wf1 brief (prepared, not dispatched) |
| `c7334ca` | Server, browser, double and harness; Astra's corrections; design §11.3 |
| Final | This report, JOBS and INDEX |

## The contract (business-v3, not deployed)

- **`revoke_key_guarded(plan_id, slot, reg_id, epoch, pk)`** checks everything before any change,
  in this order: exactly 1 yoctoNEAR, the caller's own entitlement, the slot, the key's shape,
  the registration (`E_STALE_REVIEW`), an active key (`E_KEY`), then the reviewed epoch and public
  key (`E_STALE_REVIEW`). It then does exactly what `revoke_key` does, through one shared private
  step: the epoch rises (checked), the slot is revoked, and an active hold under it stops serving
  now. Its event adds `reg_id` and the new `epoch`. No state migration.
- **`revoke_key` is unchanged**, documented in the source as unguarded.
- **`get_key_terms()`** returns `{ version: 1, guarded_revoke: true }`. Every deployed business
  lacks it; deploying means a new business account, which is a separate, later decision.

Rust evidence (`contracts/business-v3/src/tests.rs`):
- **s04c:** the legacy method, under a stale review, revokes a replacement installed meanwhile
  (the defect, characterized). The guarded method refuses that review and the replacement stays
  active; a review of the replacement itself revokes it.
- **s04d:** each refused through `W::refuse`, which also asserts the whole state is unchanged,
  byte for byte:
  - the same key reinstalled at a later epoch, and another key at the right epoch;
  - a sponsor or stranger;
  - no deposit, and 2 yoctoNEAR;
  - slot 4, and malformed or over-long keys;
  - an empty slot;
  - a replay after success;
  - epoch overflow (also on the legacy method).
- **s04e:** unregister and a new shell, with the same key reinstalled at the same slot and epoch:
  only the registration differs, and the old review is refused.
- **s04f:** a guarded success with an open hold:
  - serving stops now and the settlement deadline is unchanged;
  - the signed use still settles (free 79, consumed 21);
  - slot 0 and all accounting are untouched;
  - the revoked key can't open another hold.
- **`guarded_revoke_matches_server_fixture`:** a scripted 12-step history written to
  `server/test/fixtures/v3/guarded-revoke.json`.
- **Results:** 79 passed (74 before). `cargo clippy --all-targets -D warnings` is clean, after
  fixing one `1 * P` in a 003web test that I hadn't run clippy on then. The wasm build succeeds.
  Astra independently ran the six s04 tests at `49b9c37`: 6/6 passed.

## The server

- `get_key_terms` is on the transport's view allowlist (no arguments).
- **The keys readback adds `guarded_revoke`**, read at the same pinned block as the entitlement.
  It requires exactly `{version: 1, guarded_revoke: true}`; a missing view, another block or any
  other shape gives `false`, and keys and uses keep working.
- **It has its own deadline** (Astra's KeyCapabilityTimeoutReview reproduced the route stalling
  on an unanswered read). It uses the read timeout and a cancellation signal, settles as `false`,
  and a late answer changes nothing.

## The browser

- **The request names the key:** `revoke_key_guarded {plan_id, slot, reg_id, epoch, pk}`, built
  from the immutable review's observation. Two reviews of different keys now differ in bytes.
- **No downgrade:** `guarded_revoke` false means `prepareRevoke` and `revoke` refuse in plain
  words, with nothing sent, even under a review made earlier. A failed guarded call is never
  followed by `revoke_key`.
- **After the wallet answers, or doesn't, a readback decides.**
  - The wording says the reviewed key "is no longer active", never that this transaction revoked
    it.
  - A replacement is named as still active, and revoking it needs its own review.
- **This device's key is kept** whenever the contract shows that same key active again (a later
  epoch, or a new registration).
- **Every local write and delete is conditional on the incarnation read** (slot, creation time
  and intent, in one IndexedDB transaction). Astra's design review raised the delete risk. Astra's
  two-handle probe then reproduced the update risk: an older record overwriting another tab's
  newer one with the same key. Both are fixed.
- **The review shows** the key, its registration and epoch, and that the contract refuses the
  request if the slot holds another key by then.

Tests:
- **The capability:** supported, missing, wrong version, extra fields, and cancelled at the
  deadline.
- **An older contract:** refused, nothing sent, the key still active.
- **A replacement while the wallet is open, or under a delayed answer:** only the guarded request
  is sent; the contract's rule refuses it; the replacement and another tab's record stay.
- **This device's key under a newer authorization:** a same-key reinstall at a later epoch, and a
  new registration reusing slot and epoch; both kept and still ready.
- **Another tab re-enrolling the same key:** its record survives.
- **A real revocation:** the marked record is deleted.
- **A dropped then lost answer:** unconfirmed first, then shown no longer active; the same review
  sends nothing more; a replay is refused at the contract.
- **The double** replays the contract's fixture exactly, refusals leaving everything unchanged.
- **The harness wallet** applies the guarded call; `POST /older-contract` switches off the
  capability.
- **Astra's earlier revoke probe:** its readback gains `guarded_revoke: true`, because it predates
  the capability and without it nothing is offered. Its assertion (no send under an old review
  after a replacement) is unchanged.
- **Astra's capability-timeout and key-record probes** pass.

## Checks (final code, `c7334ca`)

- **Contract:** 79 passed, clippy clean, wasm builds.
- **`npm run check`:** exit 0, lint (408 files) and types clean. **1423 passed and 1 skipped
  (1424)**, across 158 passed and 1 skipped files.
- **The two full runs before that each failed one test:** `protected-store.test.ts` "concurrent
  and repeated writes" hit its 5-second timeout (5.09 s and 5.21 s; 200 SQLite writes to a temp
  directory, disk-bound). That code is untouched by this job. The file passed alone in the same
  session, the next full run passed, and the timeout was not changed.
- **`npm run web:build`:** exit 0, on the same code. The main chunk is 943.06 kB, CSS 73.40 kB.
- **Nothing live:** no signing, deployment, RPC write, real wallet, provider, credential,
  spending, push, publication, research or Day One. Every key is synthetic.

## Remaining gates (stated)

- **Browser review, waiting on the applicable approval:** a guarded revoke, a stale refusal with
  a new review, lost-answer recovery, an older contract refused (`POST /older-contract`), and 003web's
  enrollment, first use and ready fold. Harness:
  `npx tsx scripts/wallet-harness.ts --minutes 10` (stops itself).
- **The contract change needs a new business account** to reach testnet: a separately authorized
  rehearsal. Until then every deployed business reports `guarded_revoke: false`, so the product
  offers no revocation there (forgetting the local key still works).
- **003wf and its prepared child 003wf1** wait for Astra's dispatch. 003x, 005e, 006b and 006c
  stay queued, and all six milestones stay open.
