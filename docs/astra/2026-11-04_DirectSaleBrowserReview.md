# Direct sale browser review — in progress

Astra, November4,23:18 Pacific. Active003wf2, not accepted. Actual in-app browser, finite
sale-harness.ts (25 minutes), fictional seller Ava/founder.near, no external wallet/network.
Harness48000, site8814/control8815, business934122bd-6692-4ead-b291-9e5388b1c246. Static built
frontend from the earlier aad6452 slice; harness33e99c4. Later dba88aa changes require rebuild /
reload before their verification. Sole Claude81990 continues; no duplicate implementation writer.

## Required visible correction

At1440x1000 the proposal form's labels, text inputs and textareas run together inline: buyer input
immediately touches Price, expiry and floor share an accidental wrapped row, the checkbox sits
alone above its label, and exclusions/note/submit are interleaved. At390x844 the same raw browser
fields wrap awkwardly. Screenshot and accessibility inspection both show real editable fields;
this is not a missing-page or loading observation. It does not meet the approved product design.
Source: PrepareTerms uses form.stack (no .stack rule in styles.css), bare inputs/textarea instead
of the existing .input treatment, with no .field grouping. Fix the component deliberately using
the established form system: each label with its control/help/error, consistent touch targets,
useful desktop grouping, single-column phone layout, full-width multiline notes, checkbox and
continuity explanation together. Review the OTHER action/recovery fields too for the same issue.
Do not fix it with a broad new global selector that changes unrelated forms.

Also before any terms exist, the right authority panel says "No operator is named; every earlier
operator ends with the close" while the draft's metering checkbox is already checked. Label the
sidebar's source/state: no proposal has been made yet, or a clearly identified draft preview.
Do not describe empty on-chain terms as the definitive consequences of the draft being edited.
Retain the caution when a real proposal omits metering.

The shell and main title render cleanly; the current single-step pre-proposal state is legible.
Phone measured innerWidth390, document clientWidth/scrollWidth375 (scrollbar), no horizontal
page overflow in this initial state. These narrow observations do not accept the whole page.

## Review coverage still due

Correct/rebuild, then1440/1280/390; keyboard focus and review cancellation/return; exact terms and
amounts; seller proposal and buyer registration/funding/acceptance; seller close and truthful local
apply; lost reply/original-ID recovery; revised/expired terms; claim restored/paid; buyer operation
and customer continuity; current sale versus history. Keep all existing customer-key permission
gates; this review does not authorize that blocked enrollment workflow or external transactions.

This pass changes only this review, INDEX and BUILD_STATE. No job added or milestone closed.

## Review/cancel behavior at1280x900 — 23:20 Pacific

Entered buyer.near, price250 TUSD and exclusion "ledgerline.example domain and DNS account".
Review opens an inline focused section, correctly states250 TUSD /250000000 base units and
0.00186 NEAR party storage. The document hash verification is visible. However the primary review
summary says "open until the time shown" without displaying a human-readable expiry, and does
not summarize the floor; those facts are buried in collapsed JSON. Put buyer, price, exact expiry
(with timezone), retained balance floor and explicit operator grant together in a readable review
summary before the wallet button. Exact arguments remain useful secondary evidence.

Clicking "Not now" returns to the proposal form but clears buyer, price and exclusion; focus falls
to the page instead of a useful form control. This is directly observed in the real browser.
Preserve this person's draft through review/cancel, retry and stale-review correction; restore
focus to the originating Review button or editing context. If expiry is time-relative, re-review
can compute a fresh absolute expiry but must not discard the entered terms. Scope draft retention
to the business/account so switching roles cannot leak or reuse another person's terms. Test on
the real page/controller path (component unmount/remount matters). Do not silently submit after
returning or changing values. Escape had no effect on the inline section; it is not a modal, so
this alone is not a failure.

Actual synthetic proposal now exercised in the browser: re-entered the same draft, reviewed,
clicked the explicitly synthetic wallet action, and observed deal1/version1 proposed to buyer.near
for250 TUSD with meter.near. Header/history report confirmed by its own transaction; escrow is
correctly not funded, acceptance/apply/operation/collection remain waiting. Visible customer
obligations stay5 TUSD. This verifies proposal only, not the full buyer/close journey. Screenshot
reviewed internally; Tony's full creative walkthrough remains deferred. Review tab65 marked for
handoff; viewport override reset. Harness48000 remains bounded to25 minutes from ~23:16.

## Buyer lost-response recovery is not reachable — 23:26 Pacific

Actual browser: signed seller out, switched the harness's synthetic account to buyer.near,
signed in as Noah through the real verified sign-in, reviewed and registered with TUSD. That
registration visibly confirmed and the next action became Fund escrow. Set ONLY harness
lose-next, then reviewed250 TUSD funding and clicked the synthetic wallet action. Contract reading
now shows escrow funded, but that request becomes no_longer_possible (correctly distinct from a
confirmed original transaction). The notice tells the person "if your wallet's activity lists it,
enter its ID." No transaction field or Check control exists anywhere for that history row; it
contains only the action name and unknown/inapplicable state. The next action is Accept version1.

Source confirms OPEN excludes no_longer_possible while CHECKABLE includes it, and History renders
no recovery controls. Do not re-block unrelated next actions merely because the old request can
no longer execute. Provide explicit read-only original-ID recovery on this request/history row,
so the displayed instruction is actionable and its immutable evidence can be resolved. Never
resend it. Verify lost funding and lost proposal/closing acceptance followed by irreversible
state movement, including reload, and wrong IDs. Backend reachability is not browser reachability.
This exact preview still holds the pending record; do not resolve it through a hidden API just
to make the browser appear green. Continue via the corrected UI after rebuild/reload.

## Correction continuation — 23:29 Pacific

Original writer81990 exited0; exact-session CIM found no remaining process. Astra resumed the
same session c64c374e-63b8-469b-b4ff-db61ca33d730 for this bounded correction as sole exec37479.
Explicit --model claude-opus-5-5 --effort high; init independently reports model claude-opus-5-5,
apiKeySource=none. Correct the remaining full review (not just its first form section), run
required checks/build, update report and local commits, then stop for Astra. Preserve preview48000.

Operational hygiene: the new empty stderr redirect
claude-2026-11-04-003wf2-browser-corrections.stderr.txt is local-only and currently untracked;
Claude should exclude it locally or move it to the existing ignored *.last-message.txt pattern
once its writer exits. Do not stage this diagnostic file. Standard stdout stream already ignored.
