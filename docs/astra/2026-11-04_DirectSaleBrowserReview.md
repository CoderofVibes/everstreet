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

## Coverage boundary to preserve before acceptance — 23:32 Pacific

The present browser harness is useful real-page/route evidence, but its source calls
saleWorld -> customerWorld.make/createApp and injects fixture dependencies directly. It does not
start composeApplication/serve.ts with the configured adapters and maintenance lifecycle. The
actual-process tests separately exercise that production composition for selected sale cases.
Do not combine those two narrower proofs into a claim that this browser journey ran through the
configured composition. Brief item8 explicitly asks for a normal-composition browser harness.

After the current UI corrections, supply a finite configured-composition variant (reuse the
existing lifecycle bootstrap/entry boundary and synthetic RPC/wallet adapters where possible),
with disposable persisted state, explicit disabled worker and bounded cleanup. No new service,
real credentials or external transactions. Preserve the current preview while Astra completes
its pending History test. We can then exercise the same buyer/close/continuity browser flow
through that supported composition. Keep the wider100/20/80/79 and other parent003wf matrix
requirements open; this request closes the harness provenance gap, not the parent by inference.

Independent keyless targeted run at23:30: sale-controller, sale-journey and sale-harness tests
25/25 pass, exit0, including the authored repeated-sale payout case. This confirms the dba88aa
correction narrowly; it does not substitute for the outstanding actual UI cases above.

At1280 the six sale progress steps use a five-column layout, leaving collection alone on a second
row. During the same page polish, use a balanced six-step composition at the supported desktop
breakpoints (and a deliberate stacked/wrapped phone layout), rather than inheriting the older
five-step grid. Preserve readable status words and avoid shrinking text merely to fit.

The live pending funding transaction from the synthetic wallet's read-only history is
Ch4vUgvniKhAaSYoEXQFSzKSUmN1pXcpsgYuU9cvo9zv (buyer.near -> tusd.near, ft_transfer_call).
Astra will enter it through corrected visible History controls; no API reconciliation has run.

## First actual browser sale completed; preview cleaned — 23:42 Pacific

Continued the DISTINCT acceptance actions while keeping the buyer's old funding request
unresolved. Buyer review correctly described exact acceptance and conditional close, then its
own transaction confirmed acceptance and the page waited for the seller. Signed out and back
in through the real synthetic identity flow as Ava. On the newly rebuilt frontend (dist timestamp
23:38:31), the seller's review now visibly lists buyer,250TUSD, exact expiry in PST plus UTC,
floor0, meter.near and attached NEAR before the wallet button. This fixes the previously missing
human-readable summary in that acceptance case.

Seller clicked the synthetic acceptance; actual UI then showed deal1 closed, buyer.near controls
the business, local apply complete, former-seller role and Your handovers instead of Business
desk, and250TUSD sale proceeds owed (not paid). Customer obligations remained5TUSD. Screenshot
showed a balanced3x2 progress layout at the laptop viewport, with collection current while prior
steps complete. No premature paid claim. This is page/route/double evidence only, not configured
composition, real NEAR, actual buyer operation, or an attempted stale-owner request denial.

One remaining content-state polish: after close, Authority the buyer receives falls back to
"No sale is proposed ... Once terms are proposed ... draft ...". Show the confirmed handover /
current authority context here, clearly distinguishing the closed terms from current owner and
operator observations. Do not show pre-proposal guidance after a successful sale. Do not treat
any historical close as the current one when a later deal exists.

Preview48000 reached its25-minute bound and exited0; ports8814/8815 no longer listen. Tab65 was
closed; viewport override had been reset. No preview remains. Funding History recovery still
needs actual-browser recheck with a fresh bounded case (the old in-memory state is gone); it was
never secretly resolved. Draft/cancel and final form1440/1280/390, keyboard/zoom/reduced-motion,
payout restoration/payment, actual buyer operation/customer use and configured-composition
browser evidence also remain. Keep this evidence matrix honest; no whole003wf2 acceptance.

## Next bounded continuation — 23:49 Pacific

Astra verified the correction stream's terminal success result and exact-session process absence;
old exec37479 is no longer registered. Head0d32f98 contains correction2eea876. Independent focused
page/controller/journey/harness tests32/32 pass, exit0 at23:47. This is narrow automated evidence;
History recovery/focus still need actual-browser review. No preview is active.

Dispatch now: implement the configured-composition browser variant requested above and the
23:42 after-close authority wording correction. The previous preview has expired, so there is
no dependency on keeping it alive or first testing its now-lost in-memory funding record.
Use a fresh bounded synthetic case on the configured variant for the remaining browser matrix.
Preserve all existing test and permission boundaries; do not enable the real worker or bypass
pending customer enrollment/revocation approval. Read the entire latest review before finalizing.

## Independent browser correction verification — 23:54 Pacific

Astra started finite15-minute direct-fixture preview23665 at~23:51 (8814/8815), business
417848fc-0168-41bd-aaab-8bc22dfb09dc, browser2/tab66. Source/head0d32f98; no configured
composition claim. Do not stop this preview or launch a competing listener while it is live.
1440 desktop form now has deliberate labelled full-width fields/two-column price+days.390phone
stacks cleanly; measured innerWidth390/clientWidth375/scrollWidth375, no horizontal overflow.
Review/cancel retained buyer.near,250TUSD,0floor,7days,metering checked, domain exclusion and
note; focus returned to Review the exact request. Review had readable localPST+UTC expiry,
floor, operators and attachedNEAR. These specific former browser defects pass.

Lost proposal response exercised through actual synthetic wallet action. Page kept next action
available and showed History's original-ID controls. Wrong43-character ID did not resolve it;
page explained nothing was recorded. Reload preserved unresolved request and recovery controls.
Entering original ID3zDnm7agog945mi6wMnWRNui1GRDJ7z78WumnvNmm1jf through visible History then
confirmed its own transaction and removed recovery fields. This verifies proposal/reload/wrong-ID
history recovery, not yet lost funding/closing acceptance or configured-composition evidence.
No hidden API confirmation or resend. Remaining full matrix unchanged.

## Funding and closing recovery pass; preview read limit investigation — Nov5,00:01 Pacific

Same finite preview23665/tab66. Buyer registered, lost funding reply, then entered its unrelated
registration ID: UI rejected it without confirming funding. Reload preserved pending funding;
original Ch4vUgvniKhAaSYoEXQFSzKSUmN1pXcpsgYuU9cvo9zv confirmed through visible History.
Buyer accepted. Seller's closing acceptance deliberately lost its reply; page observed closed
contract but offered Apply the close here and retained unknown original action. Explicit UI apply
reconciled locally; reload retained History recovery; original
5S3b9aijrtj5ysxiC8gAKkTRjto8Z3DBTmZbp6cbEYgV then confirmed, with already-applied notice.
No resends. Proceeds remained owed250TUSD, customer obligations5TUSD. On reload frontend rebuilt
23:58:40 showed the new Authority after deal1 closed section with current buyer/generation2 and
meter.near observations: the stale draft-language correction passes this specific case.

Next attempted seller token registration reached 'NEAR could not be read' (no new registration
history row visible); payout testing remains incomplete. Direct fixture's chain ceiling400 and
reader ceiling300 are possible causes, not yet proven from accessible runtime counters. Please
ensure the configured browser variant has an explicit finite budget suitable for this multi-step
recovery/aftercare matrix and exposes nonsecret counters/exhaustion reason in its control-only
status. Do not remove bounds or turn a fixture exhaustion into a product success. Add a bounded
scenario regression exercising proposal loss/wrong-ID/reload-equivalent reads, funded loss,
closing loss/apply/recovery, seller registration, restored payout and then paid. Existing shorter
unit cases alone may not reach the browser's cumulative read load.

## Preview cleanup and configured harness source review — Nov5,00:03 Pacific

Astra closed tab66/reset viewport and stopped only its own preview23665 with Ctrl+C after the
read failure; tool reports exit1 on interruption. Independently8814/8815 have no listeners.
No preview or browser tab remains. No retry loop or modification of the old preview's limits.

Configured harness source in progress does reach normal runServer/composeApplication via child
and configured adapters, with separate fixture network boundaries. Before handoff, tighten its
failure cleanup: catch currently kills the child then immediately removes its DB directory;
on Windows that can race child exit/open SQLite files. Await bounded child exit before removing
that known temporary directory, including partial startup, and close any already-bound front/
control listener on failure. Keep only a bounded diagnostic tail instead of unbounded stdout+
stderr accumulation. Verify one injected startup failure leaves no child/listener/temp directory.
These are preview resource/cleanup requirements, not extra platform scope. No new installs or
permission changes. Do not run the pending customer device enrollment/revocation browser tests.

Astra00:07: configured preview8961 now active for20minutes on8814/8815, child56416, business2ac3b6b8-1310-42bd-a8ba-63aa1ccd65d7. Parent/child384MiB heap caps; sourceae3de0f plus current budget/cleanup corrections. Do not stop/restart it or launch competing listeners; isolated ephemeral test ports are fine. Actual browser verification starting; no whole-job acceptance.

## Configured browser journey and independent full check — Nov5,00:20 Pacific

Head46286d6/code41bd228. Claude6643 exited0. Astra independently npm run check81555 exited0:
1468main+1skip,12protected-store,31process. Lint has2existing warnings (unused p/s); no errors,
types pass. This corrects earlier shorthand 'lint clean'; warnings are not hidden.

Configured preview8961/browser2/tab67 runs normal entry/configured composition with synthetic
RPC/wallet/model transports, not createApp fixture injection. Seller Ava (ava-founder.near)
proposed250TUSD to noah-buyer.near with meter.testnet, domain exclusion; Notnow kept draft and
returned focus. Actual proposal/registration confirmed. Funding reply lost; unrelated registration
ID rejected, reload preserved History, original EifV6uQKzmfrRyqs5UJXN3hrfJQsVjsdj2xK3A388cEM
confirmed without resend. Buyer accepted; seller closing reply lost. Explicit Apply reconciled;
reload and original EeTMRdMQiD2wRsL4JLUErUjW8gjhcD5yfegXcveiZ2pv recovery confirmed/already-applied.
Seller registered, first claim transfer deliberately failed and showed restored/owed250; reviewed
new collection then paid (zBeFe1Eizp7P1siSphQuwcu7MeB6PDZubQkNAxXKWcr), nothing owed, no false paid
on the failed attempt. Closed authority section correctly distinguishes deal terms/current owner.
Actual1440aftercare screenshot readable, client/scroll1425/1425. All are synthetic evidence.

Direct navigation to former seller's old business desk denied ('No such business'). Signing in
as buyer opens the same business desk with released/offered product, operating charts and studio
link. One existing Cara fixture-authorized use via CONTROL CLI (not browser device enrollment)
returned reserved/fulfilled. Buyer actual browser saw1use/1usable/$0.00015customer runtime cost,
initially awaiting settlement, then after background maintenance1charged/0waiting. No manual
unit reconciliation was used. This proves that bounded configured service/bookkeeping continuation;
it does not prove the full100/20/80/79 parent journey or unperformed customer browser enrollment.
Preview remains finite until~00:27; no other preview or writer. RemainingUI/parent gates preserved.

## New-owner role wording — Nov5,00:21 Pacific

Actual configured buyer revisits /sales after close: header says YOU ARE THE SELLER while the
same page describes the deal bought by noah-buyer.near. This is because seller permission to
propose a future resale precedes new_owner/buyer in roleWords. The permission is valid; the
identity label for the currently displayed closed deal is misleading. Label the closed deal's
buyer as new owner (or buyer/new owner), and only call them seller for a later live sale where
they are actually the named seller. Keep their Prepare terms ability; do not change authority.
Add the specific current-closed-buyer and later-live-seller counterexamples.390aftercare layout
has no horizontal overflow(client/scroll375/375); payout correctly Not shown to buyer.

## Customer read-only continuity — Nov5,00:26 Pacific

Configured preview8961: signed buyer out and selected existing fictional Cara. Public product
entry remained reachable under new owner Noah. First sign-in attempt hit missing dynamic asset
while Claude rebuilt web/dist; one reload/retry recovered. This is recorded as a live-preview
asset-version change, not a verified stable-build sign-in defect.

Ordinary Cara sign-in then showed99uses ready, existing other-device key, and the completed
post-sale use in Recent uses. No Make this device key/enrollment/revocation action was taken.
Opened existing use e10c17bb-4d43-48ac-9044-721492e8ea51 and Show my result: exactly1unit charged,
99free/1used, private structured invoice result with vendorStackline/SH-1042/412.50USD and expiry.
This verifies customer read-only access and post-sale result/units from the configured synthetic
service scenario. It does not close the pending browser authorization gate or the full parent
100/20/80/79 journey. The public fixture page's legacy 'bookings and refund rights' transfer copy
should be audited in the broader digital storefront pass; don't silently claim it describes all
digital rights. No extra storefront implementation dispatched in003wf2.

Claude5627 is the sole active bounded role-wording continuation, samec64c374e session, exact
Opus5.5/high, init model/API-none verified. Predecessor6643 terminal0 and exact-session CIMabsent.
Role correction page/controller18 and configured-page3 pass per builder; independent visual
new-owner recheck remains. Main earlier independentfullcheck46286d6 passed as recorded above.

Configured preview8961 completed its20-minute deadline: tool exit0, application child exit0, temporary directory removed. Independently ports8814/8815/56416 have no listeners. Tab67 closed; viewport reset. No active preview remains. Preserve this cleanup evidence rather than restarting an expired preview.

## Configured browser follow-up — Nov 5, 00:38 Pacific

Fresh finite preview exec11935 started about00:31 (30-minute limit), site8814/control8815, application child53556, business1dc34635-bc2f-4b4d-abc8-e890eb399ccb. IAB2/tab68 plus temporarytab69; no builder launched. Normal configured synthetic composition, no real wallet/NEAR.

Actual stale-review scenario passes: seller proposes250; tab68 reviews revision300; tab69 confirms350/version2; sending tab68's old review produces “The sale changed since you reviewed it. Your terms are kept: review them again.” Contract view stays350/version2, focus returns to Review the exact request. No stale wallet request shown. Draft300 still requires explicit value reinspection below. Remaining new-owner label/browser keyboard checks in progress. All wider gates remain.

Final follow-up: draft300 directly verified; buyer keyboard close after seller acceptance succeeded at350/version2. New-owner header correct,1280 and390 fit verified. See2026-11-05_DirectSaleAccepted.md for evidence/limits and cleanup. Zoom shortcuts had no observable effect; reduced-motion not exposed. No fabricated pass. Preview11935 stopped, ports/child absent, tabs closed, viewport reset.

## Product-wide language follow-up — Nov5,00:52 Pacific

Source-confirmed during the managed-handover design wait: Home.tsx STAGES still says “digital products join later”, despite the verified configured digital commerce/sale path. PublicPage.tsx history unconditionally says “Customers' bookings and refund rights carried over” for a digital-only business too (also seen in the earlier actual configured browser). server/src/releases.ts view note still says “Only you can run it until customers are connected”; confirm whether each consumer renders it for an active customer offer before changing.

Carry a bounded copy/capability review into the cross-journey finish: describe the current business/product capability and evidence mode, using verified readiness where available. Preserve truthful limitations for unavailable providers, unverified isolated worker, synthetic transport and missing live deployment. Do not blanket-replace “Partly” with “Works now”, claim all listed product foundations are executable, or invent transferred rights. Digital-only, legacy-only and mixed storefronts need appropriate continuity language; private sale terms stay private. This is existing approved product-direction work, not new scope or an additional dispatch while003wf3 is active.
