# Everstreet README story

> Build, run, and sell an online business that honors what customers already paid for.

Picture a print shop changing hands. A customer comes back with the same prepaid copy card and prints the next page. The card is the foreground of the image. The owner name changes behind the counter. On the README, use a Ledgerline customer receipt for the card, so the image can carry recorded figures and work as the handover strip. Keep the strip in text with links so the beats hold on a phone.

## The first screen

Put the line directly under Everstreet. Follow it with “Ledgerline is an invoice API. Its first customer bought 100 uses before the first sale.” Then show three beats, each with its own source.

1. **Sale closed.** The buyer took control and the customer had 80 unused uses at close. [Direct sale record](../../data/evidence/v3-direct-testnet.json)
2. **Former owner refused.** Link the first recorded onchain refusal for that seller. It is a later call to a companion and its refusal is in the receipt. [Extended sale record](../../data/evidence/v3-ext-testnet.json)
3. **Customer kept their uses.** After three sales the same customer had 78 unused and 22 used of the 100 purchased. [Final entitlement snapshot](../../data/evidence/ledgerline-after-sales-testnet.json)

Give the after-three-sales snapshot its own label. The second and third close records have no customer balance at the close. On the full proof page those cells read “Not read.” Use “a later owner-only call” in narration. The refusal is an observed transaction, and the new owner takes authority in the close itself.

Lead with **See the recorded handover** for the static Ledgerline proof and place **Watch the film** beside it when ready. Follow with **Try the handover locally** and `npm run demo`. Its guided sale is Signalwatch on a synthetic wallet and chain. Keep the cast, install steps and browser route there. One click into the static proof is the minute-long path from a cold start.

## Proof as the reader scrolls

Keep the claims table and fold “How far it goes” into it. Group rows by the question a judge would ask about the same handover. Each row makes one checkable claim and points to its test or script, the transaction or recorded checkpoint when applicable, and the proof-page section or film time. Assign film times from the final cut. Give testnet transactions, sandbox tests, and synthetic or app evidence explicit labels. Link the primary evidence for each row and put extra hashes and commands one click deeper.

| Question | What the row proves |
|---|---|
| What did the customer keep? | Ledgerline's first customer kept the uses they had paid for. The first buyer served the next use. After the third sale all 100 still reconcile. |
| Who can act after the sale? | The former owner's recorded owner-only calls were refused on chain. |
| What does the buyer take over? | The studio's released service and revision history stay with the business. Use app evidence for this. For paid operation, show the contract's prepaid units and the HTTP 402 customer path with their respective evidence. |
| How does the deal close? | Both sides accept the same terms. Link the Direct and separate Gated rehearsals, and the executed NEAR Intents swap followed by escrow funding. |
| What else follows control? | Show the series 4 Sepolia role move to a derived address, and the old supplier grant's refusal. The buyer initiates the role move after close. The held publish was refused by Sepolia's RPC after the role move used its nonce. |
| Can the buyer trust the revenue line? | A testnet registration paid by the owner is attributed to the seller in the app's revenue view. It is a specific link the buyer can see. |
| Can I check the rules? | Link reproducible builds and zero access keys for the featured NEAR deployments, the light-client proof against its recorded head, and the independent reviews. The attack docket has 27 refused cases in its suite. Label the separate testnet evidence case by case. |

Give distinct claims separate rows when their evidence differs. Keep “Build · Run · Sell” as an optional narrow index into these rows. Move the full feature catalog, earlier case studies and setup reference below the proof or behind links.

Use “One contract decides who is in charge. The companions ask it before they act.” The app builds and serves the product. A Sepolia role move is a separate action. Keep “Not claimed” next to the proof, with testnet and test tokens, the labeled stand-in model, server and hosting trust, the short in-flight companion window, the pause on new uses in Gated mode, and external assets that require separate transfer. The revenue check can identify recorded seller links such as the registration payer. Hidden related wallets and off-platform reimbursement are outside its reach.

## Film proposal

Make a roughly 90-second film from the recorded Ledgerline proof. Give the handover the longest beat. The film and the README should each make sense on their own.

| Time | What is on screen |
|---|---|
| 0–12s | Meet Ledgerline. Open the customer's receipt with 100 purchased and 80 unused before the first close. |
| 12–38s | Open the actual NEAR testnet close and leave its explorer link readable. Change the owner on the proof strip and keep the receipt in view. Cut to the former owner's recorded `E_NOT_OWNER` receipt, labeled as a later call. |
| 38–58s | Show the next recorded use under the first buyer. Pull back to three sales and the final snapshot with 78 unused and 22 used. Label the first-sale use and the later snapshot separately. |
| 58–76s | Show the buyer's series 4 role move and the final Sepolia receipt. Keep the other proof rows in the README. |
| 76–90s | Return to the customer's receipt. End on the static proof and repository, with the testnet label visible throughout and a caption for the stand-in when a model result appears. |

If capture time is tight, cut the Sepolia scene first. Record the three customer and authority beats from the existing static proof and link the other runs in the README. Rough size is a short README rewrite and a one-screen proof treatment using existing records, plus a separate capture and caption pass for the film.

## Repo checks and decisions

Tony asked for “one story at the top, and the ambition shown as proof underneath it,” with customers protected and Claude supplying checkable links. The line, print-shop picture, placement of the static proof, combined proof table and film cut are proposals for Tony. The pending cold review should be reflected in the claims Claude wires up before release.

Read the current README, authority and safety notes, proof projection, and committed records. The Ledgerline direct, extended and series 4 records are for the same business. The final entitlement snapshot reports 78 free, 22 consumed and 100 purchased. The handover projection finds the first recorded refusal for each former owner and can find that receipt in a later record. The current README still describes series 2 as the lead example. The static proof was built locally. The launch URL and final film times depend on release and capture.

- Changed this pass file and `docs/astra/INDEX.md` to record the proposal.
- `npm run check` passed typechecking and continued past two lint warnings. The first test run had 1,944 passing tests and 18 failures in composition and wallet sign-in, with loopback connections denied (`EACCES`).
