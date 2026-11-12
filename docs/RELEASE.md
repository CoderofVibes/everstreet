# Release: the hosted guided tour

The guided tour and recorded proof (`npm run proof-site`, built into `web/dist-proof/`) is hosted on Vercel as the
project `everstreet-demo` under the `coderofvibes` account. It stays private until Tony says yes
in chat on Fri Nov 13. Pin the CLI: `npx --yes vercel@65.5.0` everywhere.

## Now (Nov 11): private preview

| What | Address | Signed out |
|---|---|---|
| Guided tour and the self-playing video (`/?video=1`), preview of e391101 | https://everstreet-demo-os2621v64-coderofvibes.vercel.app | 302 to Vercel sign-in |
| Earlier guided tour, preview of b62396f | https://everstreet-demo-re8fxokj2-coderofvibes.vercel.app | 302 to Vercel sign-in |
| Earlier preview of 5fc8cf8 (proof pages only) | https://everstreet-demo-m0d8gr08h-coderofvibes.vercel.app | 302 to Vercel sign-in |
| Placeholder on production ("Nothing here yet.") | https://everstreet-demo-qpm0z5sr1-coderofvibes.vercel.app | 302 to Vercel sign-in |
| Public name | https://everstreet-demo.vercel.app | 404 (alias removed) |

Vercel's default Deployment Protection locks every deployment address to people signed in to the
account. The public name `everstreet-demo.vercel.app` is open to everyone, so it must answer 404
until Friday.

## The trap

Vercel always puts a project's **first** deployment on production and the public name, even with
`vercel deploy` (no `--prod`) or `--environment preview`. So the first deployment was a placeholder
(an index.html and a noindex header, nothing else), and its public alias was removed at once with
`vercel alias rm everstreet-demo.vercel.app --yes`. Every deployment after it without `--prod` is
a preview.

Second trap: `vercel link` writes a `.env.local` holding a Vercel token into the folder it links.
Delete it before deploying, and keep a `.vercelignore` with `.env*` in the folder so it never
uploads.

## Checks

The build writes `vercel.json` (noindex on every path, the SPA rewrite to `/index.html` except
`data/` and `assets/`) and a `404.html`, and stops if any built file holds key or token material.
Check as a stranger, signed out:

```sh
curl.exe -s -o NUL -w "%{http_code} -> %{redirect_url}" https://<deployment address>/
curl.exe -s -o NUL -w "%{http_code}" https://everstreet-demo.vercel.app/
```

Before Friday the first must be 302 to `vercel.com/sso-api` and the second 404. If the public
name ever answers 200 early, remove the alias first, then tell Tony.

## The recording behind the tour

The app pages in the tour (front page, studio, portfolio, desks, a customer's and a buyer's view)
answer from `data/tour/recording.json`, one demo run kept on Nov 11. The self-playing demo video
(`/?video=1`, docs/VIDEO.md) plays from the same recording. Its dates are that day's, and
Signalwatch's sale in it is open until Nov 26. Record again if those pages change what they read,
and before the release build if they did:

1. `npm run tour:record` (about four minutes): it starts a fresh demo, walks its pages in a
   headless Edge as each person, closes Signalwatch's sale through the real routes, walks the
   pages again as they stand after it, and writes the recording.
2. `npm run video:check`: it builds the site and stops if a guide stop or a video beat is missing
   from the recording, or if the video doesn't play through (docs/VIDEO.md).
3. Walk the built copy's guide once with the console open; an unrecorded read is logged at debug
   level as `[tour] not recorded`.

## Friday Nov 13, only after Tony's yes in chat

1. Run the full sweep (secret scan, fresh clone, `npm run check`), then build from the frozen
   commit: `npm run proof-site`.
2. Copy `web/dist-proof/` into an empty folder outside the repo, add `.vercelignore` (`.env*`),
   run `vercel link --yes --project everstreet-demo`, delete the `.env.local` it writes.
3. `vercel deploy --prod --yes` from that folder.
4. If `https://everstreet-demo.vercel.app/` still answers 404, attach it:
   `vercel alias set <deployment address> everstreet-demo.vercel.app`.
5. Open it signed out, walk all seven steps of the guide and both side doors on step 1, try an
   unknown path, check the console, then link it in the README: make "The guided tour" in
   route step 2 a link to the public address, and put the tour and the video (`/?video=1`)
   first under the proof table.
