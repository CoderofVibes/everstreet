# Home account-switch privacy reproduced

Astra, November4, while sole Claude80361 implements001g. Previous goal turn made progress:
independent988-test check and actual discovery correction/error/retry acceptance, then Studio
dispatch.80361 re-polled live; no duplicate writer. Claude has committed preceding Astra handoff
as cdf1084 and now changes only Studio files. This review did not alter those files.

## Actual browser result

At cdf1084 / built001f1 web assets, wrapped the existing publicationPreview real app in a local
fixture that holds only the first successful GET /api/product-projects reply after it is read.
Signed in as fictional Ava on Home, switched to Bea while Ava's response was held, observed
Bea's Tutor Portal card. Released the response: header still Bea, card becomes Ava's private
Untitled product / Ledgerline Invoice Reader with Ava's project URL. Screenshot
home-actor-race-2026-11-04.jpg. Clicking that card produces This project doesn't exist, or it
belongs to someone else's business. Server detail access holds; Home summary boundary fails.

Read-only source corroborates Home.tsx effect: list().then(setMine) has no actor identity or
request-generation guard. Build.tsx has the same unguarded setProjects pattern; that second
surface is source-identified and not yet independently browser-reproduced.001f2 includes both.

The earlier deliberate outage independently showed Home's failure-as-empty state and lost
foundation choices.001f2 also fixes those read states and preserves typed idea on retry; this is
the same home/build entry flow, not a new product scope.

## Fixture bounds and cleanup

Temporary OS-temp everstreet-home-race-20261104.mts imports existing publicationPreview, serves
the real built web assets/API on127.0.0.1:8840 and tiny controls on8841. First project-list answer
held at most90seconds,150-API-request cap, independent8-minute process ceiling. Controller showed
12requests and pendingtrue before release. All people/data synthetic, :memory:, no provider,
wallet, chain or persistent runtime DB. Only delayed delivery; response content unmodified.
Browser25 closed; process23683 stopped intentionally withCtrl+C exit1. No server left running.

## Changes and next action

Added this note,001f2 brief, screenshot and INDEX/checkpoint entries. Add its JOBS row after Claude
releases that file. Dispatch after current001g review, before003u2/001h, without silently dropping
Studio or remaining milestones. Required full check is attempted after docs, but Studio's actively
changing source cannot be treated as a final accepted snapshot. Claude reviews/local commits
these exact files later; Astra makes no Git writes. Research remains unread/local-only; searches
were scoped to named allowed source paths. All six functional milestones stay open.
