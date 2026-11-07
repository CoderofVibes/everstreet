# Sale, proof and handover screens: design brief

Static mock-ups for the screens of Everstreet's next build. Tony chooses a direction; Claude
then builds it on real data. This brief is the whole assignment: design only, no app code.

## The idea these screens serve

Everstreet's claim is that a business can change hands without breaking anything customers paid
for. The next build makes that claim **checkable by anyone** and **wider**:

- **One source of authority.** The business contract on NEAR is the only thing that says who owns
  the business. Every new capability (an external asset on another chain, a supplier budget) is a
  small companion contract that asks the business contract "who owns this now?" at the moment it
  acts, and refuses if the answer changed. So **one close moves everything at once**: customers
  keep their rights, the owner role moves, and every companion follows without a transfer step
  of its own.
- **Proof, not reassurance.** After a close, each fact a person might doubt is shown with where it
  came from, and can be exported and checked without trusting Everstreet.
- **The memorable moment is still the customer.** The customer keeps using the business after
  control changes. Proof stays quiet and one click away; it supports that moment and never
  competes with it.

## The story (fictional; use these names and numbers)

- **Delphine Marsh** sells **Signalwatch** (an agent service that flags what changes in suppliers'
  release notes; 4.00 TUSD per analysis) to **Noah Brandt** for **180 TUSD**, in escrow.
- **Cara Okafor** is a customer who prepaid 100 analyses and used 20 before the sale. 80 carry over;
  she uses one under Noah, leaving 79.
- Control is generation 3 before the close and generation 4 after. Contract account
  `signalwatch-v4.everstreet.testnet`, born with no access keys.
- **New in this build:**
  - **External asset:** Signalwatch publishes its alerts to a feed contract on an EVM test network.
    One role (`publisher`) controls who can post. Each owner of Signalwatch controls that role
    from their own address, derived from the business and its generation. At the handover Noah
    moves the role to his generation's address; anything Delphine signed earlier no longer
    controls the feed. The external step is "pending" until it is final on that network.
  - **Supplier allowance:** an agent pays a fictional model supplier, **Larchmere Models**,
    0.90 TUSD per analysis from a separate operating budget (never from customer money). Caps:
    2.00 TUSD per payment, 60 TUSD per week; anything above 5 TUSD waits for the owner's approval
    of that exact invoice. At the close the allowance **ends**, unless Noah re-grants it.
  - **Funding through NEAR Intents:** Noah may fund escrow from another token through a verifier
    contract we deploy ourselves on testnet. States: quote, deposit, delivered, funded (funded only
    when the business contract confirms). Failures: quote expired, underpaid, partial, refunded,
    response lost.
  - **Readiness checklist (Gated close):** a signed checklist bound to this deal, this generation
    and an expiry: runtime healthy, seller administration frozen, queued work safe to replay.
  - **Agents paying per use:** an agent calls Signalwatch's API, gets an exact offer back
    (HTTP 402), and buys units through a purchase Everstreet relays. Only the contract's purchase
    grants a unit.

## Inputs (read these first)

1. `docs/ASTRA.md` (your seat) and `docs/design/EVERSTREET_UI_DIRECTION.md` with the tokens at
   the top of `web/src/styles.css`. One brand; stay in this family.
2. The current sale page, so the new screens fit it: `web/src/pages/SaleRoom.tsx` (handover,
   "Your first shift", "Your access after the sale") and `web/src/pages/DeskEconomics.tsx`.
   Run `npm run demo` and walk the four-step route in `README.md` "Try it" to see them live.
3. The chosen dashboard direction and how it was decided: `design/dashboard/DECISION.md`.
4. Chart rules: `docs/design/SHOWCASE_SPEC.md` (search "Not color-only").

## Screens

### Three hero screens: two directions each (A and B)

Make A and B genuinely different, and name each in two words. One suggested contrast: **A puts
the customer's continuity at the centre with proof one click away; B leads with the facts and
their sources**. Improve on that if you see a better pair.

1. **Before anyone accepts: terms and what's still in progress.** Seller's and buyer's view.
   Price and escrow; customers' units that carry over; included items (operators kept, the
   external feed role, the supplier allowance and that it ends unless re-granted); everything
   still in progress (open customer holds, unsettled uses, pending payouts, open wallet requests,
   queued writes, companion state). In a Gated close, the readiness checklist (who signed, valid
   until, bound to this deal). If Noah funded through Intents, the funding states.
2. **After the close: the proof.** Owner, generation, key count, code hash, terms digest, close
   transaction, customers' units, the next settled use. **Each fact is tagged with its source:**
   synthetic run, local NEAR node, testnet final read, testnet receipt, light-client proof
   ("proved against block header …"), or Everstreet's own record. Tags must be distinct without
   colour. Then **ended / carried over / still possible**: roles that ended; grants carried over by
   the terms; what customers can still redeem; what Noah now operates; what is still Delphine's
   claim; what an old signature can still do (Cara's open hold, until its grace deadline). A
   download for the handoff receipt. Two RPC providers agreeing at one block, and the uncertain
   state when they don't (shown as uncertain, never as done).
3. **What we tried to break.** A public results page for the attack suite: nine groups (changed
   terms and stale seller; dropped response or misleading success; an old write admitted before
   the close; signed before the change; poisoned observation; quote or signer substitution;
   shared-cap race and storage pressure; evidence substitution; faults planted in our own checks).
   For each: the clean run beside the attack run, the refusal it met, and the protected values
   (owner, generation, escrow, customer units, pending payouts) unchanged. The planted faults show
   which named check caught each one.

### Five supporting screens: one proposal each, in the direction you recommend

4. **The buyer's first shift, extended:** the existing four items plus "move the feed role to
   your address" (with its pending external step) and "re-grant the supplier allowance".
5. **Supplier allowance on the owner's desk:** caps, the allowed supplier, the review threshold,
   spent this week, a payment awaiting approval with its invoice, and what happens at a sale.
6. **One customer use, with its economics:** Cara sees her input, result and one charge. The owner
   (and a buyer reviewing the books) also sees supplier cost and margin, and the books keep
   earned revenue, customer funds owed, founder-entered costs and supplier cost on separate lines.
   A buyer can rerun the valuation with their own assumptions without changing the seller's books.
7. **Agents paying per use:** the owner's view of agent purchases (offer, units bought, relay
   budget used of its cap).
8. **A recorded testnet example:** the public page for one recorded run, using the proof layout
   from screen 2 with explorer links.

## Hard rules (product rules, not style)

- **No narration.** Every line is a label, a value, an action or an error. No subtitles explaining
  the page, no sub-lines restating a value, no reassurance paragraphs. Short labels ("Accepted",
  "Carried over", "Ended"). Detail goes one click away or behind an (i) only where a term isn't
  obvious.
- **Labels for what's simulated:** the demo is a synthetic chain with stand-in models; say so
  where the app already does ("Simulated history", "Fictional"). The recorded example says
  "NEAR testnet".
- **Pending is outlined, never filled.** An external step that isn't final reads as pending.
- **Unknown is not zero.** Uncertain observations look uncertain.
- **Never add currencies.** TUSD and USD are never summed or put on one axis.
- **Accessible** (WCAG AA text contrast, nothing colour-only, sensible reading order) and **works
  at 390 px** without sideways scrolling.
- Fictional people and businesses only. Contract and event identifiers stay brand-neutral.

## Deliverable and process

- `design/sale-proof/<screen>-<a|b>/index.html` for the hero screens (`terms-a`, `terms-b`,
  `proof-a`, `proof-b`, `attacks-a`, `attacks-b`) and `design/sale-proof/<screen>/index.html` for
  the others (`first-shift`, `allowance`, `use-economics`, `agent-purchases`, `testnet-example`).
  Each is ONE self-contained file: inline CSS and JS, data as a JS constant, no external fonts,
  CDNs, images or network requests. Include the app's top bar ("Acting as Noah Brandt" etc.).
- **Look at your work and revise.** Screenshot each with
  `node design/dashboard/shot.mjs <file.html> <dir>/desktop.png 1440 <height>` and
  `... <dir>/phone.png 390 <height>`, open the PNGs and critique hierarchy, spacing, legibility
  and the phone layout. At least two improve-and-rerender rounds. Keep the final PNGs.
- `design/sale-proof/<screen>/NOTES.md`: the idea in two sentences and what you changed after
  looking at it.
- `design/sale-proof/OVERVIEW.md`: one table of every screen with links to its PNGs, your
  recommendation between A and B for each hero screen, and open questions for Tony.
- Your usual pass file in `docs/astra/` with its row in `docs/astra/INDEX.md`.
- Write only inside `design/sale-proof/` and your pass file. Leave everything uncommitted.
