# Second cold pass, first use (November 7, 2026, evening)

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
- Stay on `127.0.0.1` / `localhost`. Don't open other sites. (Explorer links point at public NEAR
  testnet and Sepolia explorers; note that they exist and where they point, but don't follow them.)

## Starting it

The product runs as a local demo, already running when you begin, at:

- **Site:** http://127.0.0.1:8820/
- **Wallet control:** http://127.0.0.1:8821/ (not part of the product; it only sets which account the
  synthetic wallet signs in as)

If the site doesn't answer, start it with the browser pane's `preview_start` and the name `demo`, and
wait about a minute until http://127.0.0.1:8821/ answers. Restarting it resets everything.

**Signing in as someone:** set the wallet's account, then sign in through the site:

```bash
curl -s -X POST http://127.0.0.1:8821/account/rosa.near
```

then on the site choose sign in and continue with the synthetic wallet. To switch people, sign out
on the site, set the next account, and sign in again.

## Who you are, in this order

Spend roughly the time given. Go where you'd naturally go; don't hunt for pages by guessing URLs
unless that's what a real person would be forced to do (and if so, note it).

1. **A hackathon judge, five minutes, not signed in.** Start at http://127.0.0.1:8820/. Find what
   proves this works. Say what you found, how many clicks it took, and whether you believed it.
   Then look at the example business's Operate and Acquire tabs and say whether what they claim is
   backed on the same screen.
2. **Rosa Lind (`rosa.near`), first day.** Take the big "Start building" box on the home page and go
   as far as you can toward something a customer could buy. When you reach a stop, say exactly
   what the screen told you, whether you understood why, and whether anything on the desk or the
   studio pointed you somewhere useful. Then take the small "Start a business" link and do the same.
3. **Delphine Marsh (`delphine.near`).** Open each business's desk. Say what each desk tells you
   needs you today, and whether that matched what you then found inside (the sale, the supplier
   invoice, open requests). Approve the supplier invoice and say whether the page showed the result
   without a reload. Check the inbox after accepting the sale.
4. **Priya Raman (`priya.near`).** Open your inbox first and say whether it tells you what is yours
   to do. Then work the Relaydesk board: resolve a case and say whether you could still find it by
   name afterwards, and whether the case panel was in view when you opened a card.
5. **Cara Okafor (`cara.near`).** Use Ledgerline on an invoice from its public page, end to end,
   and check what you got and what you paid. Say whether the "Recent uses" list was about the
   product you were using.
6. **Noah Brandt (`buyer.near`).** Open the Signalwatch sale. The escrow is already funded in TUSD;
   withdraw it and collect it, then fund it again with your other token (tALT) through the route the
   page offers. For every step that moves money, say whether you saw a review of the exact amount
   before your wallet was asked, and whether the list of steps matched what happened. Close the sale
   and go through everything the site then offers you about the close, including the proof page:
   say whether the figures for what customers are owed agree across the proof page, the sale page
   and the portfolio, and whether you understood any difference.

## Widths and themes

Look at the main screens at **1440 px** wide and at **390 px** (phone), using the browser pane's
`resize_window`. Put the pane back to `preset: "desktop"` when you finish. (There is no dark theme;
don't report its absence.)

## What to record

Every time any of these happens, write it down with where it happened: you hesitated, guessed or
re-read; text that should be a field or the reverse; the same thing said twice; a term used before
it is explained; a screen that claims what it doesn't show, or two places that disagree; something
changed without you doing it or being told; you couldn't tell what to do next; layout problems at
either width; text you'd skip because it explains rather than helps you act; a number or token you
couldn't read or place.

## The findings file

Write **`reports/2026-11-07_second-pass-first-use.md`** with:

1. **The five worst**, one line each, worst first.
2. **Findings**, numbered, each with a severity (**Blocks**, **Confuses**, **Noise**, **Polish**),
   the persona and screen (with its URL), what you did, what you expected, what happened, and the
   screenshot file name if you took one. Write findings as you go.
3. **What worked well**, a short list.
4. What you understood the product to be, in two or three sentences, as the judge after five
   minutes.

Save screenshots in **`reports/first-use-shots/2026-11-07-pass2/`**. If your browser tools can't
save an image to a file, describe the screen precisely instead. When you're done, reply with the
five worst and the counts by severity.
