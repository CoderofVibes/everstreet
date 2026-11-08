# Video cue sheet: "A launchpad for the agentic economy, on NEAR" (about 2:15)

For Anthony and Astra. Built from `docs/astra/2026-11-07_AgenticEconomyRealignment.md`. Every line
of narration stays inside that note's evidence table and "Not claimed" list.

## Before filming

- Start a fresh demo for each take: `npm run demo` (the site is http://127.0.0.1:8820). It resets
  everything, so every take starts the same: Delphine signed in, Signalwatch mid-sale.
- **Film part 2's agent-budget shot (cue 9a) before the sale in part 1**, or in its own fresh
  take: after the sale, Signalwatch's budget shows "ended at the close".
- Browser at 110 % zoom, bookmarks bar hidden, one window, 1920 × 1080.
- Switching people: the menu under your name → **Disconnect Synthetic demo wallet** → **Sign out
  of Everstreet** → **Sign in or join** → **Continue with Synthetic demo wallet** → pick from the
  list. Cut the switching out in the edit; a lower-third name card covers the jump.
- The proof shots (cue 13): `npm run proof-site`, then
  `npx vite preview --config web/vite.proof.config.ts` (http://localhost:8830/proof/ledgerline).
- Testnet shots (cues 10 to 12) are public explorer pages: open the links in the cue.

## Part 1: Everstreet at the surface (0:00 to 1:15)

| # | Time | Who | Screen and clicks | Narration (or caption) |
|---|---|---|---|---|
| 1 | 0:00–0:07 | — | Title card: **Everstreet**: a launchpad for the agentic economy, on NEAR | "It's never been easier to build with AI. Everstreet turns what you build into a business." |
| 2 | 0:07–0:17 | Delphine | **Build** (home): type an idea in *Describe what you want to build*, choose **Agent service**; then Ledgerline's **Run the sample** → *One clean invoice* | "Describe a product, shape it in the studio, and open it to customers." |
| 3 | 0:17–0:25 | Delphine | **Discover**: the published businesses, then **Post a need** | "People find what they need, or post what they need built." |
| 4 | 0:25–0:33 | Delphine | **Portfolio**: Earned, Delivered, Customers, Prepaid uses; *Needs you today* | "One desk to run every business." |
| 5 | 0:33–0:43 | Delphine | **Acquire** → Signalwatch's sale → **Per-use economics** → *Earned revenue by source* | "Buyers search for businesses and check where the revenue really comes from, including what the seller paid to themselves." |
| 6 | 0:43–0:50 | Delphine | Signalwatch's sale → **Accept version 1** → **Ask my wallet for exactly this** | "Delphine is selling Signalwatch. Escrow is funded on NEAR; she accepts the exact terms." |
| 7 | 0:50–1:02 | Noah | The sale → **Accept version 1 and close the sale** → wallet → *buyer.near controls the business now*; scroll to **Your first shift** | "Noah accepts, and one contract closes the sale. The treasury, the customers' prepaid uses and the agents' permissions follow the contract." |
| 8 | 1:02–1:15 | Delphine, then Cara | Delphine: **Register with the token** → **Collect the sale proceeds** → **Try an owner action** → *Refused by the contract (E_NOT_OWNER); nothing changed*. Cara: **My activity** → **Signalwatch** → *93 uses ready* → fill the form → **Review one use** → **Authorize this one use** → **Send my request** → *92* | "Delphine is paid, and refused from then on. Cara bought her uses before the sale; she uses one under the new owner." |

## Part 2: what NEAR is building toward, already working (1:15 to 2:00)

Lower third on each cue: the NEAR idea in two or three words.

| # | Time | Lower third | Screen and clicks | Narration |
|---|---|---|---|---|
| 9 | 1:15–1:25 | Agents as customers | Delphine: **Ledgerline** desk → **Agent purchases** → the confirmed row (*Paid from the agent's own account · 2 units granted*) | "Agents are customers. They get an exact price over HTTP 402 and pay from their own NEAR accounts." |
| 9a | 1:25–1:32 | Agents spend within limits | *(film before the sale)* Delphine: **Signalwatch** desk → **Supplier allowance**: the caps and the invoice awaiting approval | "A business's own agent pays its suppliers within limits the contract enforces; bigger payments wait for the owner." |
| 10 | 1:32–1:42 | Agents hire agents | Sign in as **Signalwatch's agent** → **My activity**: *Invoice reader v2 from Ledgerline · 1 charged*. Cut to the testnet purchase: https://testnet.nearblocks.io/txns/Hfhwf17ADeAEu6GPnYV8fWt6zrSbHqdsGCEVbbn1am9V | "One business's agent hires another business. Recorded on NEAR testnet." |
| 11 | 1:42–1:50 | Chain Signatures | Noah: Signalwatch's sale → *Your first shift* → **Move it to your address** → done. Cut to the Sepolia transaction: https://sepolia.etherscan.io/tx/0x512803af90ad082206987398a933fc9ae84184498715d1fcb56a9cae264c2934 | "The business's asset on Ethereum moves to the buyer, signed by NEAR Chain Signatures." |
| 12 | 1:50–2:00 | NEAR Intents | The escrow funding on testnet: https://testnet.nearblocks.io/txns/CvmiCw4NpvT8k6H2jQPeRTJ7CfCDYxjTUB1EsuhSB95a | "A buyer can fund the escrow from another token through NEAR Intents." |

## Part 3: the proof (2:00 to 2:15)

| # | Time | Screen | Narration |
|---|---|---|---|
| 13 | 2:00–2:10 | Static proof copy, **Sales of this business**: three sales, the former owner refused by the business contract, then *78 unused · 22 used · 100 bought* | "Ledgerline has changed hands three times on NEAR testnet. Every claim is tied to a transaction." |
| 14 | 2:10–2:15 | End card: **Built at NEAR HACKATHON** · DadMod · github.com/CoderofVibes/everstreet | "Everstreet. Built at NEAR HACKATHON." |

## Words to say out loud

"own NEAR account", "limits the contract enforces", "recorded on NEAR testnet", "Chain
Signatures", "NEAR Intents", "Built at NEAR HACKATHON".

## Words not to say

"autonomous" or "AI-run" for the businesses (people run them; the model is a labelled stand-in),
"audited", "production", "agents collaborate", "private" or "TEE".
