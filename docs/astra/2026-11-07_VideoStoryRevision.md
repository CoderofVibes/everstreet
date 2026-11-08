# Video story revision: a launchpad and marketplace for the agentic economy

Proposal for Tony, not an approved replacement for the filming cue sheet.

## Direction

Introduce Everstreet through three perspectives. Founders build where customers can find their
offers. People and agents can buy services from those businesses. Investors and other companies
can browse businesses open to acquisition and decide what fits. The chance to reach customers
now and a buyer later is part of why a founder would build here.

Show agent commerce before acquisition. Start the acquisition scene in the catalog and follow it
with the buyer's review of a specific business. Put NEAR Intents with escrow funding and Chain
Signatures with the buyer's first shift. End the handover on a customer using what she bought.

Open on the working product with Everstreet's name visible. A long title card spends the
opening before the viewer sees anything happen. Keep Ledgerline and Signalwatch identified
throughout. Plant Cara's prepaid balance during operations and return to it after the sale.

## Proposed 2:15 narration and edit

Timings are targets for an edited voiceover, not a claim that the clicks fit in real time.

| Time | Picture | Narration |
|---|---|---|
| 0:00-0:14 | Working product result → Discover offer → Acquire catalog. Everstreet name over the first shot | Launch a business on Everstreet. Reach people and agents who can buy what you make. And if you choose to sell, investors and other companies can find and acquire it here. |
| 0:14-0:23 | Build, studio, offer. Identify the existing sample when cutting to it | Start with an idea, or bring a product you've already built. Shape it in the studio and publish your offer. |
| 0:23-0:32 | Discover: open a published service → Post a need | Customers can find a service they can use today, or tell builders what they need next. |
| 0:32-0:40 | Portfolio: earnings, deliveries, obligations, Cara's pre-sale balance | From one desk, see what your businesses earn, what they deliver, and what they owe customers. |
| 0:40-0:49 | Ledgerline Agent purchases, payment source | An agent can get a price and pay from its own NEAR account. |
| 0:49-0:58 | Signalwatch agent's Ledgerline use, then labeled recorded testnet purchase | Signalwatch's agent buys invoice reads from Ledgerline. One business becomes another business's customer. |
| 0:58-1:05 | Supplier allowance caps and pending invoice, filmed before close | The contract enforces supplier spending limits. Larger invoices wait for the owner's approval. |
| 1:05-1:20 | Acquire catalog → cut to Noah reviewing Signalwatch's revenue and prepaid obligations | Investors can look for a business to own. Companies can find a service to add to their own. Noah opens Signalwatch and checks its revenue and outstanding customer commitments. |
| 1:20-1:29 | Labeled recorded NEAR Intents funding, then Signalwatch's exact terms | NEAR Intents lets the buyer fund escrow from another token. Both sides review the same terms. |
| 1:29-1:41 | Accept, close, seller payout, buyer's first shift | Both sides accept. The contract transfers control. The seller collects the proceeds. The buyer takes charge of the treasury and agent permissions. |
| 1:41-1:50 | Buyer initiates external asset move; labeled Sepolia receipt | The buyer also moves the business's external asset on Ethereum, using NEAR Chain Signatures. |
| 1:50-2:00 | Former owner's owner action refused; Cara's completed result and 93 to 92 | The contract refuses the seller's next owner action. Cara keeps using what she paid for. |
| 2:00-2:10 | Explicitly switch to recorded Ledgerline proof: three sales, 100 bought, 22 used, 78 unused | Ledgerline has changed hands three times on NEAR testnet. One hundred customer uses still accounted for: twenty-two used, seventy-eight remaining. |
| 2:10-2:15 | Everstreet, approved headline, hackathon, creator and repository credits | Everstreet. A launchpad and marketplace for the agentic economy. |

## Production and claim boundaries

- A new idea must not appear to have generated Ledgerline's existing sample. Use a visible
  example label or show a consistent product's supported build path.
- The synthetic Signalwatch demo and recorded Ledgerline testnet proof are different stories
  within the platform. Name each, retain execution-mode labels, and do not splice transactions
  into the synthetic sale as if they were its receipts. Keep stand-in model labels visible.
- The 402 buyer spends from its own account. Supplier allowances are the separate capped path.
  Showing these as separate scenes avoids attributing supplier caps to every agent purchase.
- The demo's old supplier allowance ends at close; the buyer controls its replacement. Team
  treatment follows the reviewed sale terms. Do not suggest the seller keeps owner powers or
  that all agent permissions carry over unchanged. Customer uses remain protected.
- The Ethereum move is a separate buyer action after close, not part of the atomic sale.
- Revenue attribution shows recorded links to the seller, not detection of every related wallet.
- Show real acquisition catalog results before cutting to Noah's existing Signalwatch deal.
  Film a direct listing-to-deal path only if that route is available in the demo take. Keep the
  customer's Discover catalog and the buyer's Acquire catalog distinct on screen.
- The final 78/22 snapshot is after three Ledgerline sales; do not invent customer balance
  observations at the second and third close.
- Hold on Cara's successful result, not only a falling counter or a raw error code. Translate
  E_NOT_OWNER visually into the concrete outcome: the former owner cannot perform that action.

This is a narration/editing pass using the existing scenes, not a product implementation job.
Rough size: one voiceover draft and one capture/edit pass, with additional time for readable
wallet steps. If timing bites, shorten navigation, login switches and explorer scrolling first;
preserve the completed customer result and the evidence labels.

## Checked, assumed and recorded

Tony: "I feel like we can do so much better with this script. What do you think" and supplied
both the surface sequence and the agent/proof sections. This requests critique and a stronger
proposal; no revised script, release or filming plan has been approved in this exchange.

Tony's follow-up: "it's a place investors or businesses on Everstreet can go to acquire - all
the more reason to build there. It also brings customers in." The revision brings both markets
into the opening, extends the buyer scene to fifteen seconds, and keeps the 2:15 target. The
Acquire source confirms catalog browsing and buyer search. The cue sheet and demo account note
establish Noah's sale role and the already funded deal. The exact capture path needs a run.

Read the brief, authority model, decisions, platform vision, current video cue sheet, agentic
economy realignment and earlier README story. The current cue sheet and realignment establish
the supplied scenes and evidence boundaries. No browser run, transaction re-verification or
new capture was performed. The 2:15 fit needs a spoken read and edit.

Files changed: this pass records the proposal; INDEX.md adds its discovery row. No jobs opened.
Application code and the existing cue sheet are unchanged. Changes remain uncommitted for
Claude's review. On the first draft, `npm run check` lint completed with two existing warnings;
types passed; the first test stage ended with 1,953 passed, one skipped and 18 failures in
composition/wallet sign-in, with loopback `connect EACCES` and consequent sign-in failures.
Later test stages did not run. No application fixes were attempted for this script discussion.
