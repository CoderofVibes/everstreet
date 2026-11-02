# Job 002c1 report: runtime authority, release checks, request recovery

Claude, 2026-11-02. Job: [002c1](../jobs/2026-11-02_002c1_runtime-review-corrections.md),
from Astra's [independent review](2026-11-02_002c-independent-review.md) and its disposition of
the [source review](2026-11-02_002c-source-review.md).

**Commits:**

- `3732fef`: server corrections and regressions.
- `50a002c`: Service continuity, release-check UI, digital samples, design note.

**Evidence:** keyless unit and integration tests only. No browser run and no live provider. The
runtime model in every test is a scripted double.

## The five reproductions

| # | Reproduction | Now | Regression |
|---|---|---|---|
| 1 | A former owner received the private answer after ownership changed mid-request | The answer is authorized again after the final await (`ManagedRuntime.answerFor`), for new requests and same-key replays alike. A former owner gets 404; an owner who left and came back gets 409. The request is still finished, charged and kept as the business's record, and the current owner can read it. | `runtime-authority.test.ts`: former owner, owner away and back, same-key replay fenced, control case. With the fence removed, those three fail (mutation check). |
| 2 | An empty-only suite released a product without processing a document | Release policy `invoice-release/1`: 10 platform-defined required cases run in every check, beside the founder's own. A release needs every required case present (counted from results) and passing. Founder cases can't use `req_` ids and can't remove or weaken required ones. The policy is recorded on runs and releases; an older policy is stale, and a release under another policy stops serving. | `runtime-releases.test.ts`: empty-only suite with a model that never extracts can't release (and the required cases really ran); an accept-anything founder case doesn't rescue a wrong `req_clean`; removing all founder cases still leaves 10 required; shadowing a required id is a 400; correct checks still release. |
| 3 | Leaving Service lost the pending request; refilling and running paid twice | Service stays mounted across studio tabs, keyed by person, project and owner epoch. A request's text, target and key are fixed (`serviceAttempt.ts`). While it's in flight nothing else is sent. After a lost answer the main button re-sends the **same key** ("Check on the earlier request (won't run it again)"); a new paid request is a separate, explicitly labelled button. Running requests from this or another tab are listed with Check now and Stop. | `web/test/serviceAttempt.test.ts` (5) covers in-flight waiting, same-key recovery after a lost answer, explicit new work on changed text or target, and bounded polling. The server side of same-key recovery is in `runtime-invocations` and `runtime-authority`. **The panel itself is not browser-verified by me.** |
| 4 | The same paid request was refused (409) after the active release changed | The fingerprint is now the request as asked: purpose, target (`release` or the build id), input hash and evaluation reference. It is resolved **before** today's release, model or availability is looked up. A retry returns the original record with no provider call; a genuinely different request under the key is still 409. | `runtime-authority.test.ts`: after another release is activated; after a model change; with the runtime provider removed. |
| 5 | A 2,101-character value was shortened and returned as a clean, fulfilled result | Validator `extract-validator/2`: a value over 2,000 characters makes the answer `invalid` with a stated problem, never shortened. Notes and issues are bounded at 300 characters with a visible "…". The validator version change makes earlier checks stale. | `runtime-authority.test.ts` (API: invalid, not fulfilled, no fields; long note marked, value untouched); `runtime-extract.test.ts` (validator). |

## Also done

- **Required cases** cover the full table from 002c:
  - clean invoice;
  - missing date;
  - ambiguous day/month;
  - two invoices;
  - totals that disagree (the stated total is kept and the disagreement must be reported);
  - embedded instructions;
  - unrelated text;
  - an unsafe amount;
  - empty input;
  - **over-limit input** (new).

  Cancellation stays covered by the runtime tests. The unsafe-amount case now passes as
  `invalid` **only** when a problem names `total`; an unrelated invalid answer fails it (test).
  Runs count invalid answers separately.
- **Fixtures and samples are fictional digital businesses:** hosting, API services, data
  labs, dev tools, automation, AI ops, compute. "FICTIONAL EXAMPLE" sits on its own line, outside
  the vendor's name, so an exact-text vendor comparison is achievable. The historical class
  fixtures elsewhere are unchanged.
- **Retention wording** is now: "The pasted text itself isn't stored, only its length and
  fingerprint. The result (extracted values, notes and any reported issues) is kept as one of
  the business's records, can contain text from the document, and moves with the business if
  it is sold. Test cases you save keep their input."
  - Per Astra's disposition, business runtime records are **not** erased, made personal or
    newly hidden from a new owner.
- **Costs:** unknown cost stays conservative. No change to how non-200 or holds are treated,
  and no new spending policy.
- **Smaller fixes:**
  - test-case versions can't be deleted (trigger);
  - an unconfigured runtime gives its real reason instead of "model changed";
  - refusals and loss of access clear the Service view's private state;
  - overlapping loads keep only the newest.

## Checks

- `npm run check`: lint, types, 27 files / 295 tests passed.
- `npm run web:build`: passed, 61 modules (bundle-size advisory only).

## Still open (not claimed)

- **Browser:** Astra's repeat of reproduction 3 is needed (tab away and back during a delayed
  request, response loss, actor switch). Reproductions 1, 2, 4 and 5 are unit and integration
  evidence.
- **Live provider:** a real model hasn't been run against the required cases; whether one
  passes them is unproven.
- **Unknown-cost reconciliation,** per-business ceiling shares and the M3 customer ledger
  remain open, as before.
- **Existing checks need re-running.** Releases and runs from before this change (empty policy,
  validator 1) read as stale.
