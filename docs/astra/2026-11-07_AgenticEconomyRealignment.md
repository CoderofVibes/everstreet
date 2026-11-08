# Everstreet, realigned: a launchpad for the agentic economy (November 7, 2026, late)

From Anthony's thread with Claude. Anthony decides; Astra owns story and visual direction;
Claude builds. This note is the one place the new direction is written down.

## Anthony's vision, in his words

> "One thing that NEAR believes in is the agentic future. It is easier than ever to build
> products and services with AI enablement. I feel like people haven't quite discovered that
> yet. Everstreet is meant to be a launchpad to enable people to join the agentic economy and
> to fuel said economy. ... Everstreet IS the agentic economy in action and it runs on NEAR."

> "Everstreet ... a launch pad for new businesses, a place where investors and people looking
> to acquire businesses can go search, and a place people can seek services."

> "I think the more of this we can bring to the table the better. Then in the demo I can run
> through Everstreet at its surface level ..., then go through all of the examples we are
> bringing that Everstreet is doing exactly what NEAR's goals and vision are."

## Approved wording (Anthony, Nov 7)

- **Headline:** "A launchpad for the agentic economy, on NEAR."
- **The three parts:** anyone can launch an AI-powered product or agent service; agents can buy
  from it and spend for it, using their own NEAR accounts within limits the contract enforces;
  and when the business changes hands, its customers and its agents' permissions follow the
  contract.
- **The handover line:** "When the business changes hands, its treasury, its customers' prepaid
  uses and its agents' permissions follow the contract, and its products and customer records
  come with it."

The README opens with these now. Astra may tune the words; the meaning is Anthony's.

## What Everstreet adds to NEAR's picture

NEAR's stated direction (from public material; not quoted in the README unless the source is
checked): agents as the main users of blockchains, transacting with their own accounts; NEAR
Intents and Chain Signatures so outcomes settle across chains; AI as the interface, the chain as
the settlement layer. Their picture has agents doing work and getting paid. It doesn't say who
owns the businesses agents run, or how those businesses are valued and sold. Everstreet is that
layer: AI-built businesses become assets you can launch, find, run, inspect and hand over, with
their customers and their agents' permissions protected by the contract.

## The evidence, each item recorded

| NEAR's goal | What Everstreet does | Where |
|---|---|---|
| Agents with their own accounts and real economic agency | An agent gets HTTP 402, pays from its own NEAR account, uses what it bought | `data/evidence/agent-402-testnet.json` (testnet) |
| Agents spending within limits | A business's agent pays suppliers inside on-chain caps; bigger payments wait for the owner; the old owner's grants end at a sale | `data/evidence/v3-s4-testnet.json` (testnet) |
| Agents hiring agents | Signalwatch's agent, appointed on Signalwatch's own contract, buys invoice reads from Ledgerline over 402 from its own account | `data/evidence/agent-hires-agent-testnet.json` (testnet); in the demo, sign in as "Signalwatch's agent" |
| NEAR Intents | The buyer funds escrow from another token through NEAR's own verifier | `data/evidence/v3-ext-testnet.json` (testnet) |
| Chain Signatures | A business's role on Ethereum Sepolia moves to the buyer with the business | `data/evidence/v3-s4-testnet.json` (testnet) |
| Chain as the settlement layer | Payments, units, ownership and the sale settle in one business contract; people see uses and results, not hashes | `contracts/business-v3`, every record |
| Trust you can check | Contracts born with no keys from reproducible builds; records re-read live; a light-client proof of the close | `docs/BUILDS.md`, `scripts/verify-rehearsal.ts --live` |

## Not claimed (keep it that way)

- Multi-agent collaboration beyond one agent buying from another (agents don't delegate tasks or
  share context).
- Confidential execution, TEEs or private inference.
- A real AI model: the examples use a labelled stand-in. The commerce is real; the intelligence
  isn't.
- An agent's spending cap when it buys over 402: that is its own account's balance, not a
  contract limit. (The supplier budget is contract-enforced; it pays named suppliers.)

## The video (Anthony and Astra; about 2 minutes)

1. **Everstreet at the surface** (about 60 s): launch in the studio, be found on Explore,
   run from the portfolio, acquire with the evidence a buyer reads, hand over (seller refused,
   customer keeps her uses).
2. **Everstreet doing what NEAR is aiming for** (about 45 s): one short stop per row of the table
   above, saying "own NEAR account" and "limits the contract enforces" out loud.
3. **The proof** (about 15 s): three testnet sales, 100 uses accounted for, every claim tied to a
   transaction. "Built at NEAR HACKATHON."

## Build order (Claude)

1. Done: agent purchase over HTTP 402 on testnet; README opening and a "For agents" section.
2. Done: agent hires agent in the demo (Signalwatch's agent buys and uses an invoice read from
   Ledgerline; Ledgerline's Agent purchases page shows it; the wallet can sign in as the agent).
3. Done: the same on testnet (Signalwatch as a second business contract, born locked, its agent
   appointed on chain; the purchase recorded and verified live).
4. Done: README claims row, "For agents" paragraph, testnet accounts table. Next: the video stop.

## For Astra

Tune the README opening and the video's narration around the approved wording; keep every claim
inside the evidence table and the "Not claimed" list. The day-by-day plan to submission stays in
`docs/astra/CLAUDE_RESUME.md` ("Now").
