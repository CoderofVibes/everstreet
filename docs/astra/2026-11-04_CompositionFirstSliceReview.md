# Composition first slice: independent review

Tony's standing mandate is the complete platform, with approachable AI creation and NEAR
acquisition preserving customer service. His dedicated-worker approval is already recorded and
exercised; it does not require another installation. All six milestones remain open.

## Verified at d350489 / report bfcd26c

- Claude87576 ended exit0. Exact conversation process lookup found no writer before handoff.
- Astra's final `npm run check`58416 passed:1235 tests,1 Linux-only skip; lint/types clean.
  Earlier targeted34 composition/build-boundary tests passed before the final two additions.
- Actual configured-composition browser preview93352 used temporary durable files, ephemeral
  storage keys and a transport refusing every network call. No model, wallet, worker or chain.
  Its180-second SIGTERM cleanup completed exit0;8870 had no listener afterward. Tab57 closed.
- The actual sign-in dialog offers no name-only form and explicitly says wallet connection is
  unavailable. Internal screenshot:003w-configured-signin-2026-11-04.png. This is a partial
  server identity/read integration, not usable configured sign-in or full platform acceptance.
- Browser-binding/current-recipient, real child-process identity restart and stop-admission
  corrections are covered. Astra independently reproduced dispatch-after-stop before the fix
  (provider calls1->2), then repeated the same real-route probe after it (1->1,zero network).

## Concrete keyboard correction before the next slice

In the actual configured dialog, focus remained on the background Sign in or join button.
Pressing Tab moved focus to background Home. Read-only DOM inspection confirmed the dialog
remained open and document.activeElement was Home. Escape also left the dialog open with Home
focused. VerifiedSignInNotice in web/src/ui.tsx declares aria-modal but has no focus lifecycle.

Correct initial focus, contained forward/backward Tab, Escape dismissal and return to opener.
Use the established accessible modal pattern; preserve preview sign-in behavior and avoid
leaving background controls keyboard-operable while the modal claims to be modal. A small
mounted interaction regression should cover the reproduced behavior. Browser repeat follows.

## Next and limits

003w-a/b/c backend slice has passing checks; UI correction remains.003w-d is the next bounded
implementation;003w-e wallet/device-use-key and003w-f integrated/restart journey remain required.
The report's proposed launcher decision is routine implementation within existing authorization:
when the safe composed preview replaces the legacy demo adequately, update launcher/docs together
without losing useful fictional workflows. Do not run legacy main or silently enable signing.

Worker002f stays partial13/15 and disabled;002f1 retains memory/orphan/boot/pressure gates.
Keep004b/005c/005d/006a and full M6; no research assessment or external execution.

Files changed this pass: this review and INDEX for evidence;003w-d brief/JOBS for the next bounded
job;BUILD_STATE for terminal/handoff facts;WorkerHostSetupProposal status to remove obsolete
not-yet-installed wording. Screenshot was captured during the finite review. Claude reviews and
commits these; Astra makes no Git writes.
