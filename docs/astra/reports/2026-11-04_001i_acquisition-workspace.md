# 001i Acquisition workspace: report

Claude, 2026-11-04. Job: [001i](../jobs/2026-11-04_001i_acquisition-workspace.md). Code `dfeecae`.
Design first: "Composition and states (job 001i)" in `docs/design/ACQUISITION_WORKSPACE.md`.

## What changed

**Sale and handover (`/desk/:id/handover`, the seller-owner)**
- **Identity header.**
  - The business's own name, read with the owner-only desk read the desk already makes. If that read fails, it shows "This business".
  - A one-sentence status (`saleSentence`), for example "Deal 1, version 1 is accepting on the contract; the seller accepted. Read at block H. Not recorded here yet."
  - A scope line: nothing here signs, pays or closes a sale.
- **One primary action (`saleNext`).** Each maps to an existing controller method or link. In order:
  1. Check access
  2. Recover my original request
  3. Try again
  4. Go to Selling (unbound)
  5. none (paused)
  6. Record this exact version (while reviewing)
  7. Review this version (a shown, recordable version that isn't recorded, including a revision)
  8. Check the contract's outcome… (a recorded intent)
  9. Read the contract again

  "Check the contract's outcome…" only opens the existing confirmation (`reconcile` first click) and focuses it. Applying stays the click inside that panel, next to `APPLY_EFFECTS`. In-card buttons became secondary.
- **Progress (`saleSteps`).** Five steps: read, record, close, apply, buyer takes over.
  - Each step's status is a word (Completed / Current / Waiting / Blocked) plus a distinct border or fill (solid, 2px, dashed, left bar). Colour is never the only signal.
  - "The contract closes the sale" and "Apply" are Completed only when an intent is `applied`. A recorded intent makes them Current with "Not known yet".
  - A revised version on the contract makes Record Current again; the older record never covers it.
  - A stale or flagged reading, or an owner mismatch, makes Record Blocked with `reviewProblem`'s words.
  - Paused or unbound makes Read Blocked.
- **Continuity aside**, in three separate groups:
  - Authority that changes: buyer account, kept operator grants with caps, metering needing appointment, and seller access, listing and rooms ending.
  - Customer rights that stay: `prepaid_unused` and `reserved_in_use` in exact base units, plus customers keeping requests, results and units.
  - Needs its own verified transfer: `NOT_TRANSFERRED`.
- **Terms card.** Now titled "Exact terms, as the contract shows them", with a note that amounts are base units of the asset and no dollar value is shown.
- **Unchanged:** DealTerms, the technical details, freshness and flag notices, recorded versions, answers, receipts, and the gone/error/loading views.

**Evidence room (`/acquire/rooms/:id`, the buyer)**
- Identity first: eyebrow "Evidence room · family", then name, then tagline.
- An access strip: opened to, you can see, until, opened/purpose, export, and the fictional and recall notes.
- Stats are responsive (auto-fit) and the purpose moved into the strip.
- A line saying the room is evidence, not a sale, and linking to handover receipts.
- Only granted scopes are tabs (`nav` with `aria-pressed`), followed by "Not in this grant: …". The tab selection logic and the export link are unchanged.

**Not changed:**
- controllers, routes, server, authority and evidence rules, fences and privacy scopes;
- the raw-unit display and provenance;
- the v2 Selling and Deal pages (legacy regression paths);
- buyer receipts (`/handovers`);
- 001j customer composition.

## Checks

- **`web/test/saleView.test.tsx`, 6 tests.** They drive the actual `OwnerHandover` over the real API with the contract-produced v3 fixtures:
  - read → review → record → revised v2, where close is never Completed and v2 needs review;
  - stale and flagged readings each make Record Blocked, with the next action Read again;
  - an actual 404 → 503 path gives `access: unconfirmed`, so Check access comes first and Recover ranks next;
  - only `applied` completes close and apply, while `ended` and `superseded` do not;
  - unbound → Selling, and paused → no action with Read blocked;
  - the static render of Continuity keeps the buyer and grants in authority, the customer amounts in rights and no account in external.
- **4 mutants, all killed:**
  - close completed on a recorded intent;
  - an older record covering a revision;
  - outcome ranked before review;
  - an account leaking into the external group.
- **Full run:** `npm run check` gave 1082 tests in 110 files, with lint and types clean. `npm run web:build` passed at 842.75 kB, with the existing size advisory.

## Preview and limits

- **Preview.** Use the existing previews; no new one was needed.
  - `npx tsx scripts/preview-acquisition.ts` (8814/8815; `/deal/*` controls; `--gated`) shows every handover state.
  - `scripts/preview-evidence.ts` (8824/8825) shows granted and withheld scopes.
  - Their scenario test passed in the full run.
- **Not browser-verified.** There was no browser tool, and a local boot probe of the preview was refused by the command checker. For Astra to check:
  - 390px header wrap with a long name;
  - the step grid at 1280 and 980;
  - focus on the confirmation after "Check the contract's outcome…";
  - the room access strip on a phone.
- **Seller after applying.** A seller who applies themselves loses access, so their page shows the existing "gone" receipt view. The "buyer takes over: Current" step is reached only when an applied intent is visible.
- **Still open.** No milestone is complete from this: live NEAR, real signing and the 001j, 002e, 004b and 005c jobs remain open.
