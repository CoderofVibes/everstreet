# Second cold pass (November 7, 2026, evening)

After the morning's four reviews and their fixes (commits 7f96af0, 01bd0e6, 37b0511, 7d7ed3a),
three fresh reviewers, each with only their own brief, went over the areas that had findings:
first use in the browser on the restarted demo, the server's permissions in the five areas that had
findings, and a judge rehearsal from a clean clone at 7d7ed3a. The contracts were not reviewed
again: the companion findings wait for Tony's redeploy decision, and business-v3 held every attack
in the morning.

| Pass | Report | Found | Fixed afterwards |
|---|---|---|---|
| First use | `2026-11-07_second-pass-first-use.md` (71 findings: 6 blocks, 30 confuses, 11 noise, 24 polish; 69 screenshots) | The missing-contract stop said three things and led to a page with no action; the inbox lagged the seller's acceptance and never told the buyer; a refused document was shown as a partial result, a ready result and an unsettled unit at once; the key registration submitted the swap inside its own click; the proof page led with the one units figure no other page shows | All six blocks: one explanation and no form for a missing contract, the desk item waits on the operator; the desk and inbox count the seller's own confirmed acceptance and the buyer's sale; a refusal reads as one, the unit's settlement is followed without a click; the swap is reviewed and signed as its own step; the proof leads with the contract's prepaid total. The studio's Try tab still asks for JSON for a workflow product (finding 22): open, see below |
| Permissions | `2026-11-07_second-pass-permissions.md` (3 high, 5 medium, 3 low; 35 tests in `server/test/permissions-review-3/`) | Two signs of one deal at the same instant both filled; a lost fill past its deadline let a new quote fill; "delivered" on a partial withdrawal; an ended buyer learned of a live deal with someone else; the owner here stayed current until the watcher; a seller who revised and closed with their wallet kept the record; past participants learned of companions and intents; a different refusal for a linked account; a stale quote after a revision; writer-history 404 before 401; the external role shown moved while pending | All eleven: the fill claims the deal in one write before any await and asks the verifier about every other quote; "delivered" once the tUSD has left the verifier; one answer for anyone who isn't the live buyer; the owner is current only while the contract agrees (economics, companions, the owner's companion list, the sale page's customer totals); a close at a version introduced outside Everstreet between the same parties applies to the recorded intent unless that version was recorded too; the companion request checks the owner first; the same 401 body for every refused sign-in; a revised deal refuses the old quote; sign-in before the configuration check; a pending move reports the generation it moves from. The review's 35 tests pass and stay in the repository |
| Judge | `2026-11-07_second-pass-judge.md` (15 minutes; nothing failed; live verification matched) | Eight README-vs-evidence disagreements (series-3 accounts, hash, build, date, test count, no mention of the later sale, the companions, Sepolia, intents or the second review); the `bad_kind` error should list the valid kinds | README items recorded for the README session (`2026-11-07_triage.md`, D1). `bad_kind` now lists the kinds |

## Open after the second pass

- **Studio Try tab for a workflow product** asks for JSON and never names the form's fields
  (second first-use pass, finding 22). Needs a small form built from the release's intake fields.
- **The studio's long tail** (second pass findings on the Product studio's labels, tabs and
  progress cards) and the **Operate tab badges** on the example page: polish, not blocking.
- **Companion contracts**: the morning's findings (triage A1–A8) wait for Tony.
- **Dark theme**, **Rosa's self-serve contract** and **the wallet picker's role labels**: Tony's
  calls (triage C15, C2, C16).
- **README**: deferred to the README session with Tony and Astra (triage D1 and the second
  judge's eight items).
