# The demo video: it plays itself

Tony, Nov 11: the video is recorded in one take with no clicking. A page inside the static site
plays Everstreet's own screens from the recording of the demo, with the captions burned in. It
replaces the click-through takes of `docs/astra/2026-11-07_VideoCueSheet.md`; the scenes, the
labels and the claim boundaries are that script's.

- The script, as data: `web/src/video/beats.ts` (16 beats, 2:16; X's limit without Premium is 2:20).
- The player: `web/src/video/Video.tsx`. Its clock counts animation frames, 60 to the second, and
  never reads the system clock, so every take is the same and a busy computer plays slower instead
  of skipping.
- The data: `data/tour/recording.json`, recorded by `npm run tour:record` (a fresh demo, walked in
  a headless browser as each person, before and after Signalwatch's sale closes). No sign-in, no
  wallet window, no network: where the real flow needs an approval, the picture cuts to the
  recorded state just after it.

## Addresses and keys

Build and serve the static site, then open the video:

```sh
npm run proof-site
npx vite preview --config web/vite.proof.config.ts
```

| Address | What it does |
|---|---|
| `http://localhost:8830/?video=1` | The player, paused on its first frame, with a small hint in the corner |
| `&capture=1` | For recording: no hint, no scrollbar, no cursor. Captions stay |
| `&from=<beat id>` | Starts at a beat, for a retake |
| `&autostart=1` | Starts at once |
| `&page=1440` | Lays the app page out at another width (default 1920; 1024 to 2560). Wider shows more of each page, smaller. Captions keep their size |

Space starts and pauses. R goes back to the start. The left and right arrows skip a beat.

The picture is 16:9 and fills the window: the app page is laid out 1920 wide and scaled to fit, and
the captions and slides are composed for a 1280-wide frame and scaled on their own.

## The check

```sh
npm run video:check
```

It builds the site, plays the whole video at 10x in a headless Edge, refuses every request outside
the build, and fails unless every caption came on in order, every cue found what it presses or
scrolls to, and the console stayed clean. Run it after any change to the script, the pages or the
recording. `npm run video:check -- --shots` also saves two pictures of every beat in
`data/runtime/video-shots/`; `--at 12.5,33` adds pictures at those seconds.

## The beats and the voice

One voice line per beat, wording settled with Tony on Nov 11. Each fits its beat at about 2.5 words
a second and claims no more than the captions on screen. Say "HTTP 402" as "H-T-T-P four-oh-two"
and NEAR as the word. Beat 5 is the tightest; if its take runs long, that beat is slowed by up to
about 5% in the edit. Record one take per line; each is laid under its beat and must end inside
it.

| # | Starts | Length | Beat | Voice |
|---|---|---|---|---|
| 1 | 0:00 | 11 s | open | Everstreet is a launchpad and marketplace for the agentic economy that runs on NEAR. Launch a product, and people and agents find it and pay for it. |
| 2 | 0:11 | 12 s | build | Start with an idea, or bring a product you've already built. Shape it in the studio, then release it to customers at a price per use. |
| 3 | 0:23 | 7 s | find | Customers search for services they need today, or post requests for future solutions. |
| 4 | 0:30 | 9 s | portfolio | The portfolio shows what your businesses earn, what they deliver, and other financial metrics. |
| 5 | 0:39 | 6 s | agent-buys | Agents get an HTTP 402 price and pay from their own NEAR account. |
| 6 | 0:45 | 6 s | agent-activity | Businesses buy from each other: Signalwatch's agent pays Ledgerline to read its invoices. |
| 7 | 0:51 | 7 s | allowance | The agent also pays suppliers, within limits the contract enforces. Larger invoices wait for owner approval. |
| 8 | 0:58 | 12 s | acquire | Everstreet also allows investors and companies to search for businesses to acquire. Companies can opt to share financials, with revenue verifiable on NEAR. |
| 9 | 1:10 | 5 s | terms | The price waits in escrow. Both sides review the same exact terms. |
| 10 | 1:15 | 13 s | close | Both sides accept, and the contract transfers control. The seller collects the proceeds. The buyer assumes ownership. |
| 11 | 1:28 | 8 s | first-shift | The business's Ethereum asset moves to the buyer too, signed with NEAR Chain Signatures. |
| 12 | 1:36 | 6 s | refused | The contract on NEAR refuses the former owner's actions. |
| 13 | 1:42 | 8 s | cara | Customers keep using what they paid for, even after the business changes hands. |
| 14 | 1:50 | 10 s | proof | On NEAR testnet, Ledgerline has changed hands three times. The contract refuses the former owner. All one hundred customer uses are accounted for. |
| 15 | 2:00 | 8 s | explorers | Each step is a public transaction: the agent's payment, the escrow, the refusal, the move on Ethereum. |
| 16 | 2:08 | 8 s | end | Everstreet. What can you create? |

The video ends at 2:16.

## What the labels say

Every beat carries where its data comes from, beside the caption: "Recorded demo · synthetic
chain" for the app's pages, "Recorded on NEAR testnet · Ledgerline" for the proof page and the
explorer pages. The explorer pages are Ledgerline's testnet runs; none is shown as a receipt of the
synthetic Signalwatch sale. A name card says who the picture is following whenever that changes.

## The explorer pictures

Beat 15 shows four public explorer pages, side by side, from pictures in `web/public/video/`.
The explorers turn away automated browsers, so Tony took these by hand on Nov 11, in an ordinary
browser, light theme. Each is cut with ffmpeg to the rows that make its point (hash and status,
then from, to and any transfer) and stacked, so the text stays readable in a quarter of the frame:

| File | Page |
|---|---|
| `agent-pays-ledgerline.jpg` | https://testnet.nearblocks.io/txns/Hfhwf17ADeAEu6GPnYV8fWt6zrSbHqdsGCEVbbn1am9V |
| `intents-escrow-funding.jpg` | https://testnet.nearblocks.io/txns/CvmiCw4NpvT8k6H2jQPeRTJ7CfCDYxjTUB1EsuhSB95a |
| `former-owner-refused.jpg` | https://testnet.nearblocks.io/txns/ZWJP4nst8L6Syx52WkyZ7fmCuHZJSoER6j5oD7f8zyb |
| `sepolia-role-move.jpg` | https://sepolia.etherscan.io/tx/0x512803af90ad082206987398a933fc9ae84184498715d1fcb56a9cae264c2934 |

## Recording a take (OBS)

1. `npm run video:check`, then serve the site (the two commands above).
2. Open a bare Edge window on the video (PowerShell):
   `Start-Process msedge -ArgumentList '--app=http://localhost:8830/?video=1&capture=1', '--window-size=1920,1080', "--user-data-dir=$env:TEMP\everstreet-video"`
3. In OBS: a Window Capture of that window, Capture Cursor off, desktop audio and the microphone
   muted, the canvas and output at 1920 by 1080, 60 frames a second.
4. Click the Edge window once, press F11, start recording in OBS, wait two seconds, press Space.
   (Any screen refresh rate is fine: the video paces itself to 60 frames a second.)
5. The video stops on the closing slide. Wait three seconds, then stop recording.
6. Save takes in `data/runtime/video/` (not committed), each with its own number.

## After the take

- Trim the lead-in and the tail with ffmpeg, so the first frame is the first beat's.
- If the take ran slower than the script (the clock stretches evenly when the computer is busy),
  find the caption changes (scene detection on a crop of the caption bar), fit one speed factor
  across them, and re-time with `setpts` so every beat starts at its scripted second. Check the
  beat starts against the table above before sending.
- Lay the voice under the picture: `npx tsx scripts/mix-video.ts <picture.mp4> <folder of 01.wav to 16.wav> <out.mp4>`.
  Each line is kept whole, with its own pauses, and starts speaking 0.15 s into its beat; a line
  longer than its beat holds that beat's last frame (never sped up), and the close and the closing
  slide are shortened to keep the whole under 2:20. Under everything runs a bed of the takes' own
  room tone (the quiet before and after the words, joined and looped), crossfaded with each line,
  so the gaps never drop to silence. One fixed gain takes the whole to -16 LUFS. Check the caption
  changes and the speech against the printed plan.
- Save every version as a new numbered file; never overwrite an older one.
