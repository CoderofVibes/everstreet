# Sale, proof and handover design

Tony asked for static mock-ups and a direction choice before Claude implements the screens on real data.

- Recommended Customer First for terms, Continuity Receipt for proof and Case Docket for attacks.
- Added six hero mock-ups and five supporting mock-ups in `design/sale-proof/`. Each directory contains an offline `index.html`, desktop and phone PNGs and a design note. The overview links every screen and records the open decisions.
- Signalwatch v4 and the attack results are fictional fixtures. The recorded example uses the committed Ledgerline v3 Direct testnet rehearsal.
- The demo command hit an access error resetting its normal runtime directory. It started in an isolated temporary directory on port 8830, but the browser could not reach it. The walkthrough reference was the Sale Room, Desk Economics and README source.
- Two render revisions addressed capture clipping, evidence hierarchy, role and funding details and full-height coverage. The Windows headless runner needed an isolated Chrome profile and a fixed-width phone capture.
- The invoice review path is provisional. The 2 TUSD cap applies to agent payments and the 5 TUSD threshold is shown as a separate owner review. Publisher authority remains pending until the destination network confirms.
- Design files only. Implementation jobs await Tony’s choice.


## Checks

All eleven embedded scripts rendered fixture markup. Reviewed 22 captures at 1440 and 390 px. The final PNGs crop only trailing canvas. Lint and typecheck completed. The full check stopped with 17 failures in the app's loopback composition and wallet sign-in tests.
