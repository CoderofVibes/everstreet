# First-use review: brief for the reviewer (November 7, 2026)

You are reviewing a web product called Everstreet as a newcomer would meet it. You know nothing
about it beyond what its screens show you, and that is the point: if something on a screen isn't
clear to you, that is a finding, not something to work out from elsewhere.

## Rules

- **Do not read code, docs, READMEs or any file in the repository** other than this brief. Do
  not search the repository. Do not open anything in `reports/`. Use the product only through the
  browser.
- **Do not edit or commit anything.** The only files you write are the findings file and your
  screenshots (paths below).
- Everything you'll see is fictional: people, businesses, money (test tokens) and the wallet are
  synthetic. You may click, type, buy, accept or decline anything; nothing real happens.
- Stay on `127.0.0.1` / `localhost`. Don't open other sites. (Explorer links on proof pages point
  at public NEAR testnet and Sepolia explorers; note that they exist and where they point, but
  don't follow them.)

## Starting it

The product runs as a local demo. It is already running when you begin, at:

- **Site:** http://127.0.0.1:8820/
- **Wallet control:** http://127.0.0.1:8821/ (not part of the product; it only sets which account the
  synthetic wallet signs in as)

If the site doesn't answer, start it with the browser pane's `preview_start` and the name `demo`, and
wait about a minute until http://127.0.0.1:8821/ answers. Restarting it resets everything to the
starting state.

**Signing in as someone:** set the wallet's account, then sign in through the site:

```bash
curl -s -X POST http://127.0.0.1:8821/account/rosa.near
```

then on the site choose sign in and continue with the synthetic wallet. (The wallet may also show a
picker of accounts; either way works.) To switch people, sign out on the site, set the next account,
and sign in again.

## Who you are, in this order

Spend roughly the time given. Go where you'd naturally go; don't hunt for pages by guessing URLs
unless that's what a real person would be forced to do (and if so, note it).

1. **A hackathon judge, five minutes, not signed in.** Start at http://127.0.0.1:8820/. You want to
   understand what this is and whether it works. Note what you understood after one minute and
   after five. Follow whatever the home page offers to prove it works (recorded runs, proofs,
   attack records) and say whether you believed it and why.
2. **Rosa Lind (`rosa.near`), first day.** You want to start a business here. Get as far as you
   can toward having something real to sell.
3. **Delphine Marsh (`delphine.near`).** You run businesses here. Check how they're doing and deal
   with what needs you today. One of your businesses pays suppliers from a budget an agent runs
   and has a feed on another chain; one gets purchases from AI agents. Find them and check them.
4. **Priya Raman (`priya.near`).** You help out on one of Delphine's businesses. Do your work for
   today.
5. **Cara Okafor (`cara.near`).** You use an invoice-reading service here called Ledgerline. Use it
   on an invoice and check what you got and what you paid.
6. **Noah Brandt (`buyer.near`).** You're in the middle of buying a business called Signalwatch.
   Check where the deal stands and take it as far as you're comfortable. You hold a different test
   token than the one the escrow wants; see whether the site lets you use it, and whether you
   understood what happened to your money at every step. If the sale closes, look at everything the
   site then offers you about the close.

## Widths and themes

Look at the main screens at **1440 px** wide and at **390 px** (phone), using the browser pane's
`resize_window`. Also look once in **dark** colour scheme (`resize_window` with `colorScheme:
"dark"`). Put the pane back to `preset: "desktop"` when you finish.

## What to record

Every time any of these happens, write it down with where it happened:

- You hesitated, guessed, or re-read something.
- Something looks like text but should be a field you can type in, or the reverse.
- The same thing is said twice, or a section repeats what's above it.
- A word or term is used before you know what it means.
- The screen claims something it doesn't show, or two places disagree.
- Something moved, changed or switched (including who you're acting as) without you doing it or
  being told.
- You couldn't tell where to start or what to do next.
- Layout problems: overlap, cut-off text, sideways scrolling, cramped or empty areas, unreadable
  contrast, at either width or in dark.
- Text you'd skip because it's explaining rather than helping you act.
- A number, amount or token you couldn't read or couldn't tell the unit of.

## The findings file

Write **`reports/2026-11-07_first-use-review.md`** with:

1. **The five worst**, one line each, worst first.
2. **Findings**, numbered. Each has: a severity (**Blocks**: you couldn't continue; **Confuses**: you
   got it wrong or weren't sure; **Noise**: unnecessary or repeated; **Polish**: looks off), the
   persona and screen (with its URL), what you did, what you expected, what happened, and the
   screenshot file name if you took one. Write findings as you go, not at the end.
3. **What worked well**, a short list.
4. What you understood the product to be, in two or three sentences, as the judge after five
   minutes.

Save screenshots in **`reports/first-use-shots/2026-11-07/`** (file names like
`03-portfolio-phone.png`). They stay out of the repository. If your browser tools can't save an
image to a file, say precisely what the screen showed instead; don't skip the finding. When you're
done, reply with the five worst and the counts by severity.
