# Judge rehearsal brief, second pass: Everstreet from a clean clone (November 7, 2026, evening)

You are a NEAR hackathon judge seeing this entry for the first time. You have a fresh clone of the
repository and about 40 minutes. Your only guide is `README.md` and whatever it links to. Do not
read source code, tests, `AGENTS.md`, `CLAUDE.md`, `docs/astra/` or `reports/` unless the README
sends you there; a judge wouldn't.

## Your clone

Clone the local repository into your scratch folder so you run exactly what is committed:

```
git clone C:/Dev/Everstreet <scratch>/judge2/everstreet
```

Work only inside that clone. Node 24 is installed. WSL Ubuntu with Rust, cargo-near and Docker is
installed if the README asks for them (contract builds and tests there take minutes; try one, not
all, and say which).

Another demo is already running on this machine on ports 8820 and 8821. When you start yours, use
the port option the README documents so they don't collide, and note whether the README made that
easy. Do not use the browser pane (another reviewer has it); use plain HTTP against your demo and
say so. You may use Node scripts to fetch pages.

## What to try

1. **Get it running** exactly as the README says. Note every command that failed, every step you
   had to guess, and how long it took.
2. **Reach the handoff.** In the running demo, find the business that is mid-sale and get as far as
   you can through the sale and what happens after it, over HTTP.
3. **Say what actually ran on NEAR testnet** and what is simulated, in your own words, using only
   what the README and the demo told you. Name anything that left you unsure, including anything
   where the README and the files it points to disagree with each other. Report what you hit;
   don't work around it.
4. **Reproduce one proof the README offers**, preferably one that reads public NEAR testnet
   (a verifier script with a `--live` option, or a rebuild-and-compare of a contract hash). Say
   whether the result matched what the README claimed, and quote any mismatch.
5. **The safety case.** Open the README's "How we tested these promises" links and say in two or
   three sentences whether you would trust the central claim (the customer keeps what they paid
   for; the old owner loses control) and why. Say whether you found what the README says about
   the attack docket, the companions on another chain, and funding escrow from another token, and
   whether each was clear.

## Rules

- Fictional data only; do not use any real account, wallet, key or payment. Do not touch NEAR
  mainnet; do not sign or send anything to NEAR testnet or Sepolia. Reading public testnet data (an
  explorer page, an RPC view, a verifier script's read-only mode) is fine.
- Do not run anything that calls a paid AI model.
- Stop your demo when you're done. Do not touch the demo on 8820.

## Output

Write `reports/2026-11-07_second-pass-judge.md` in **`C:/Dev/Everstreet`** (the original, not your
clone), appending as you go:

- **Timeline:** each step, how long it took, and whether you needed help.
- **Where I needed help:** each point, quoted from what confused you, and what would have fixed it.
- **What ran on testnet vs simulated:** your understanding, and whether the README made it clear.
  List every place the README's claims and its linked files disagreed.
- **Proof reproduced:** the command or link, and the result.
- **Would I trust it:** two or three sentences.
- **Top three changes** that would most help the next judge.

Reply with the timeline's total, the disagreements you found, and your top three.
