# Truthful suppression and seller access recovery

**Why:** An acquirer needs truthful figures and a seller's customers need the promised privacy.

## Independent evidence atbcf2346

Astra passed861tests/84files/lint/types/webbuild. Two additional finite pure-function probes fail
(5ms total, no permissions or external side effects):

1. `suppressPartition([1,10],11).cells[1]` is `fewer_than_3`. The complement is10, yet the browser
   shownText() says Fewer than3 and costShown() claims fewer than3calls. The marker conflates
   primary small counts and secondary suppression. It gives mathematically false public facts.
2. Let visible=JSON.stringify(suppressPartition([1,1],2)). Enumerate exactly256 candidate pairs
   a,b in0..15, compare the complete output of suppressPartition([a,b],a+b) tovisible. The set of
   possible a is only{1}. Both supposedly hidden small cells are exactly recoverable from this
   single output and the documented algorithm. Existing tests check a simpler subtraction rule,
   not the information in the marker/total/zero pattern. This is not the acknowledged residual
   inference between later reads. Temporary probe file removed after recording.

## Correct privacy projection first

Use truthful withheld semantics throughout API, charts, tooltips, table and export. Do not merely
rename the marker: the deterministic suppression pattern itself can reveal the small count.
Choose coarser suppression (including whole groups/totals when necessary), or another justified
scheme, with meaningful alternate-input tests. A generic "Withheld" must never imply a bound
that is untrue. Explicitly test secondary counts>=3 and small total with multiple positive cells.

Check the COMPLETE projection, not isolated partitions: totals/costs/months/known zero patterns
and known relationships must not undo the promised protection. Preserve fixed window, exact
unsuppressed costs, unknown states, allowlist and grant fencing. Do not claim absolute anonymity;
state remaining limits honestly. Prefer withholding an entire affected group over complicated
charts that imply numeric bounds. No numbers hidden only in CSS or readable in ARIA/export.

Reproduce both failures first. Exhaustive bounded candidate checks must test actual distinguishable
public outputs under the full rule, not repeat implementation conditions. Maintain room/export
parity and old-grant exclusion. Update design, marker types and tests with clear migration behavior.

## Browser seller recovery and scope wording

At the seller URL while signed out, the page says Sign in first. Selecting local fictional Ava
changes the header but leaves that error; only browser reload loads the seller page. Source:
DeskSale.load depends on id/apply, initial useEffect calls it before person exists, and successful
apply never clears error. Bind this view's loader to actor/business/current access, recover on
sign-in, clear private state on change, fence late responses and make failures retryable. Preserve
typed listing edits/grant choices across safe panel changes. Do not retain a former owner's data.

Buyer's request list currently renders raw digital_performance. Use the same human-readable scope
labels as the request/grant/room; no silent change in old scope meanings.

## Done when / boundaries

Finite regressions for suppression and actor/error/late-load recovery; npm check/webbuild;
local report/commit then001d. P0/M. No main/live wiring, signing, deployment, real transaction,
spending, public push/release/submission, research or Day One. All six milestones remain open.

The browser Grant click for fictional Fenn Holdings was blocked by automatic review. Explicit
Tony approval for granting/revoking synthetic Ledgerline data to Fenn/Ruiz is pending. Do not
perform that blocked browser action or substitute an API action on Astra's behalf. Pure code
corrections and normal automated regression development continue independently.
