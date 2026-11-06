# Judge rehearsal brief: Everstreet from a clean clone

You are a NEAR hackathon judge seeing this entry for the first time. You have a fresh clone of the
repository and about 30 minutes. Your only guide is `README.md` and whatever it links to. Do not
read source code, tests, `AGENTS.md`, `CLAUDE.md`, `docs/astra/` or `reports/` unless the README
sends you there; a judge wouldn't.

## What to try

1. **Get it running** exactly as the README says (Node 24 is installed). Note every command that
   failed, every step you had to guess, and how long it took.
2. **Reach the handoff.** In the running demo, find the business that is mid-sale and get as far as
   you can through the sale and what happens after it. If browser tools are available to you, use
   them as a judge would (click, read); otherwise use plain HTTP against the demo and say so.
3. **Say what actually ran on NEAR testnet** and what is simulated, in your own words, using only
   what the README and the demo told you. Name anything that left you unsure.
4. **Reproduce one proof** the README offers (for example, verify a testnet record offline, or open
   one of its explorer links). Say whether the result matched what the README claimed.
5. **The safety case.** Open the README's "How we tested these promises" links and say in two or
   three sentences whether you would trust the central claim (the customer keeps what they paid
   for; the old owner loses control) and why.

## Rules

- Fictional data only; do not use any real account, wallet, key or payment. Do not touch NEAR
  mainnet; do not sign or send anything to NEAR testnet. Reading public testnet data (an explorer
  page, an RPC view) is fine.
- Do not run anything that calls a paid AI model.
- Stop the demo when you're done.

## Output

Write `judge-rehearsal.md` in your scratch folder, appending as you go:

- **Timeline:** each step, how long it took, and whether you needed help.
- **Where I needed help:** each point, quoted from what confused you, and what would have fixed it.
- **What ran on testnet vs simulated:** your understanding, and whether the README made it clear.
- **Proof reproduced:** the command or link, and the result.
- **Would I trust it:** two or three sentences.
- **Top three changes** that would most help the next judge.
