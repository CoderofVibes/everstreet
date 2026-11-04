# 001j1 Customer run recovery: report

Claude, 2026-11-04. Job: [001j1](../jobs/2026-11-04_001j1_customer-run-recovery.md). Code `f9e6cd1`.
Design: "A lost answer (job 001j1)" in `docs/design/CUSTOMER_WORKSPACE.md`.

## Reproduced first, on 89c6923

`web/test/customerView.test.tsx`: the actual `CustomerWorkspace` over the real API, with a fixture chain and a scripted extractor. The server ran the use and its execute answer was lost. Immediately afterwards, `nextStep` gave `run`, and the page's controls (Run, "Don't run it: return my unit") were derived from the stale `reserved`, no-execution state.

The cause is that `act()` only set a "lost" notice: the request state stayed as it was before the action. The same mechanism applied to the confirm (authorize), release, unit-settle and cancel answers.

## Fix (controller and UI only; no backend change)

- **Marker.** `inDoubt: { action, useId }` is set in `act()` when one of authorize, run, release, check_unit or cancel loses its answer. Lost means no answer, a 5xx, or an unreadable answer. A 4xx stays a definite refusal.
- **Next action.** `nextStep` puts "Check what happened" first. Its explanation is per action, for example "It may have run… it is never run again automatically".
- **`checkRequest()`.** It is a GET of the same request. After a successful read it says what it found:
  - the run finished, is running, or ended with no usable result;
  - no run exists, so it didn't start, nothing was charged, and running it uses the same request;
  - the authorization wasn't recorded, so nothing is held;
  - or the authorization was received.
- **When the marker clears.**
  - A failed check keeps the marker and the action.
  - Any fresh readable answer for the request settles it.
  - Access ending (`gone`) and `startAnother` clear it.
  - A reload or direct link starts from a fresh read, so the marker is never persisted.
- **`StepActions`.** The page's action area, extracted so the test renders exactly what the page renders. While in doubt it shows only the check: no Cancel and no "return my unit".
- **Step strip.** The affected step reads "Needs checking" and later steps wait. The unit card notes that its state is as last read.
- **Shared rule.** `send()` (the lost prepare, 003q1) now uses the same shared `unansweredError` rule. Its behaviour is unchanged.

## Checks

- **6 new tests** replace 001j's lost-execute test, which called `refresh()` without proving the page offered it:
  1. **Lost execute, after the server acted.** Immediately: `inDoubt`, next `check_request`, and the rendered controls contain "Check what happened" with neither Run nor return; Run reads "Needs checking". Then a failed read (503): still in doubt, the same control, a warn notice. Then a fresh read: the same request id, `completed`, "Checked: the run finished", next Show my result, and one provider call throughout.
  2. **Execute never reached the server.** The check says it didn't start, the next action is run, and running gives the same request id with one provider call.
  3. **Explicit 409 refusal.** No doubt, the refusal is shown, and no check is offered.
  4. **Lost authorization.** One signature only; no Authorize or Cancel is rendered; the check finds it received; still one signature.
  5. **Lost return.** No Run or return is rendered, and the check shows `release_pending` or `returned`, with no provider call.
  6. **Reload or direct link** while in doubt: a fresh read, no stale marker, next Show my result. Leaving the request clears the marker. One provider call.
- **Existing tests pass unchanged:** the 003q, 003q1 and 003r1 workspace protocol tests, and the 001j running, unknown, partial, settlement, access-loss and sale-continuity tests.
- **Mutants.** 4 were killed: no marker set, Cancel and return still shown, a failed read clearing the marker, and a 4xx treated as lost.
- **Full run.** `npm run check` gave 1100 tests in 111 files, with lint and types clean. `npm run web:build` passed at 852.76 kB, with the existing size advisory.

## Limits

- **Not browser-verified.** I had no browser tool. For Astra:
  - `preview-customer --with-offer`, `POST :8813/lose/execute`, then Run: "Check what happened" should appear, alone, and lead to the finished result;
  - the same with `/lose/confirm` and `/lose/release`, if those routes exist in the preview's `LOSE_ROUTES`.
- **Actor change.** A different person gets a new workspace instance per page mount; the marker is in memory only. I didn't change how the page remounts on an account switch.
- **Still open.** No backend, provider, chain or main-wiring change. All six milestones and the live gates remain open. 002e is next after review.

## Finishing corrections (Astra's CustomerRecoveryReview)

Separate commit after `f9e6cd1`; see its hash in JOBS.
- **Signer failure on this device.** Everything before `confirm` (the envelope recheck, the key,
  `sign`) runs in a `NotSent` guard. A failure there gives "nothing was sent and nothing is held":
  no doubt and no "Check" control, and Authorize is offered again for the same request.
  - Test: the authorizer refuses once. That makes zero confirm calls and renders Authorize, not
    Check. Authorizing again makes one confirm call and the same request becomes `reserved`.
- **Lost execute, then the provider's outcome is unknown.** The check reports "can't be told
  whether this run finished … never run again automatically", with tone warn. It is never
  "ended" or "failed"; the next action is not Run; one provider call.
- **An empty read says what is recorded now.** For a run: "no run is recorded for this request
  yet". For an authorization: "no authorization is recorded for this request yet". It no longer
  says the run "didn't start".
- **While in doubt, `StepHeading` reads "Check this request".** The old headline appears only as
  "as last read before it". `ResultArea` says "Not known until this request is checked" instead
  of "Reserved. Run it when you're ready."
  - Tested by rendering both components with the real in-doubt state.
- **Undoing each fix on purpose makes its test fail:** the `NotSent` branch, the unknown branch
  and the in-doubt heading.
- **Full run.** `npm run check` gave 1102 tests in 111 files; `npm run web:build` passed at
  853.95 kB. Still not browser-verified by me.
