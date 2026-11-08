# Filming script: "A launchpad and marketplace for the agentic economy, on NEAR" (about 2:15)

The one filming script (Anthony, Nov 7 late). Astra's structure from
`2026-11-07_VideoStoryRevision.md`, with Claude's edits (headline with "on NEAR", the Intents
label, the agent in the supplier line, "HTTP 402", the former owner's refusal in the proof) and
the clicks for each scene. Claims stay inside `2026-11-07_AgenticEconomyRealignment.md`.

## Before filming

- A fresh demo for each take: `npm run demo` (http://127.0.0.1:8820). Every take starts the same:
  Delphine signed in, Signalwatch mid-sale with its escrow funded.
- **Film scenes 1 to 7 before the sale closes** (scene 7's supplier allowance shows "ended at the
  close" afterwards). The sale is scenes 9 to 12; restart the demo between takes.
- Browser at 110 % zoom, bookmarks bar hidden, one window, 1920 × 1080.
- Switching people: the menu under your name → **Disconnect Synthetic demo wallet** → **Sign out
  of Everstreet** → **Sign in or join** → **Continue with Synthetic demo wallet** → pick from the
  list. Cut the switching out; a name card covers the jump.
- Recorded proof (scene 13): `npm run proof-site`, then
  `npx vite preview --config web/vite.proof.config.ts` → http://localhost:8830/proof/ledgerline.
- Testnet and Sepolia shots are public explorer pages (links in the scenes). Every one gets the
  on-screen label in its row; never cut them in as receipts of the synthetic Signalwatch sale.
- Keep the "synthetic" and "stand-in model" labels visible where the app shows them.

## The script

Timings are targets for the edited voiceover; read the narration aloud with a timer first. If a
scene runs long, shorten the narration, not the result on screen.

| # | Time | Who | Picture and clicks | On-screen label | Narration |
|---|---|---|---|---|---|
| 1 | 0:00–0:14 | Delphine | Ledgerline's sample result (**Run the sample** → *One clean invoice*) → **Discover** with a published service → **Acquire** catalog. Everstreet's name over the first shot | Everstreet | "Launch a business on Everstreet. Reach people and agents who can buy what you make. And if you choose to sell, investors and other companies can find and acquire it here." |
| 2 | 0:14–0:23 | Delphine | **Build**: type an idea in *Describe what you want to build*, choose **Agent service**; cut to Ledgerline's studio and offer | "Example business" on the Ledgerline cut | "Start with an idea, or bring a product you've already built. Shape it in the studio and publish your offer." |
| 3 | 0:23–0:32 | Delphine | **Discover**: open Signalwatch's page (**Use Signalwatch** visible), then **Post a need** | — | "Customers find a service they can use today, or tell builders what they need next." |
| 4 | 0:32–0:40 | Delphine | **Portfolio**: Earned, Delivered, Prepaid uses; hold on *Prepaid uses* | Simulated history (fictional) | "From one desk, see what your businesses earn, what they deliver, and what they owe customers, like the uses Cara has already paid for." |
| 5 | 0:40–0:49 | Delphine | **Ledgerline** desk → **Agent purchases** → the confirmed row: *Paid from the agent's own account · 2 units granted* | Synthetic demo | "An agent gets a price over HTTP 402 and pays from its own NEAR account." |
| 6 | 0:49–0:58 | Signalwatch's agent | **My activity**: *Invoice reader v2 from Ledgerline · 1 charged*. Cut to https://testnet.nearblocks.io/txns/Hfhwf17ADeAEu6GPnYV8fWt6zrSbHqdsGCEVbbn1am9V | "Recorded on NEAR testnet" on the explorer cut | "Signalwatch's agent buys invoice reads from Ledgerline. One business becomes another business's customer." |
| 7 | 0:58–1:05 | Delphine | **Signalwatch** desk → **Supplier allowance**: the caps and the invoice awaiting approval | Synthetic demo | "Signalwatch's own agent pays its suppliers within limits the contract enforces. Larger invoices wait for the owner." |
| 8 | 1:05–1:20 | Noah | **Acquire** catalog (real results) → Signalwatch's sale → **Per-use economics**: *Earned revenue by source* and customer funds owed | — | "Investors look for a business to own. Companies find a service to add to their own. Noah opens Signalwatch and checks its revenue and what it still owes customers." |
| 9 | 1:20–1:29 | Noah | Cut to https://testnet.nearblocks.io/txns/CvmiCw4NpvT8k6H2jQPeRTJ7CfCDYxjTUB1EsuhSB95a, then back to Signalwatch's terms (*Deal 1, version 1*) | "Recorded on NEAR testnet · Ledgerline's second sale" on the explorer cut | "With NEAR Intents, a buyer can fund escrow from another token. Both sides review the same terms." |
| 10 | 1:29–1:41 | Delphine, then Noah, then Delphine | Delphine: **Accept version 1** → **Ask my wallet for exactly this**. Noah: **Accept version 1 and close the sale** → wallet → *buyer.near controls the business now* → **Your first shift**. Delphine: **Register with the token** → **Collect the sale proceeds** | — | "Both sides accept, and the contract transfers control. The seller collects the proceeds. The buyer takes charge of the treasury and the agents' permissions." |
| 11 | 1:41–1:50 | Noah | **Your first shift** → **Move it to your address** → done. Cut to https://sepolia.etherscan.io/tx/0x512803af90ad082206987398a933fc9ae84184498715d1fcb56a9cae264c2934 | "Recorded on Ethereum Sepolia · Ledgerline's third sale" on the explorer cut | "The buyer also moves the business's asset on Ethereum, signed with NEAR Chain Signatures." |
| 12 | 1:50–2:00 | Delphine, then Cara | Delphine: **Try an owner action** → *Refused by the contract; nothing changed*. Cara: **My activity** → **Signalwatch** → fill the form → **Review one use** → **Authorize this one use** → **Send my request** → hold on the finished result (*92 uses ready*) | "The former owner can't act for the business" over the refusal | "The contract refuses the seller's next owner action. Cara keeps using what she paid for." |
| 13 | 2:00–2:10 | — | Recorded proof copy, **Sales of this business**: three sales, the business contract's own refusal of the former owner, then *78 unused · 22 used · 100 bought* | "Recorded on NEAR testnet · Ledgerline" | "Ledgerline has changed hands three times on NEAR testnet. The former owner, refused by the contract itself. One hundred customer uses still accounted for: twenty-two used, seventy-eight remaining." |
| 14 | 2:10–2:15 | — | End card: **Everstreet** · A launchpad and marketplace for the agentic economy, on NEAR · Built at NEAR HACKATHON · DadMod · github.com/CoderofVibes/everstreet | — | "Everstreet. A launchpad and marketplace for the agentic economy, on NEAR." |

## Claim boundaries (from Astra's revision; keep them)

- A new idea must not look as if it generated Ledgerline's existing sample: label the cut.
- The synthetic Signalwatch sale and the recorded Ledgerline testnet runs are different stories:
  each explorer cut carries its label, and none is presented as the synthetic sale's receipt.
- The 402 buyer spends from its own account; the supplier allowance is the separate, capped path.
- At the close the old supplier allowance ends and the buyer grants a new one; don't suggest the
  seller keeps owner powers or that every permission carries over unchanged.
- The Ethereum move is a separate buyer action after the close, not part of the sale itself.
- Revenue by source shows recorded links to the seller, not every related wallet.
- The 78/22 snapshot is after the third sale; don't show customer balances at the other closes.
- Hold on Cara's finished result, not only a counter or an error code.

## Words to say out loud, and words to avoid

Say: "own NEAR account", "HTTP 402", "limits the contract enforces", "recorded on NEAR testnet",
"NEAR Intents", "NEAR Chain Signatures", "on NEAR".
Avoid: "autonomous" or "AI-run" businesses, "audited", "production", "agents collaborate",
"private" or "TEE".
