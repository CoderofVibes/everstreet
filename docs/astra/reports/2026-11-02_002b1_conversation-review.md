# Job 002b1 report: conversation browser corrections

Builder: Claude. Date: 2026-11-02. Job: `docs/astra/jobs/2026-11-02_002b1_conversation-review.md`.
Code commit: see JOBS.md row (the commit that adds this report also carries the code).
No browser pass by me; Astra repeats the delayed-send and visual review. No live AI.

## Changes

1. **Typed-ahead message lost.** Cause confirmed: `send` cleared the composer after the
   request resolved. Now the message being sent is an *outbox* entry, separate from the
   composer (`web/src/outbox.ts`): its text and request key are fixed together when Send is
   pressed, and the composer is cleared at that moment, so anything typed while it is sending
   stays put when it resolves. Outcomes:
   - accepted → the outbox entry goes away and the work log reloads;
   - refused by the server (4xx) → "Not sent" with the reason; **Edit it** moves the text back
     only into an empty box (never overwrites new typing); **Discard**;
   - unknown (no answer, network error, 5xx) → "Not confirmed: it may or may not have been
     sent"; **Send again (it won't be sent twice)** retries the same text under the same key;
     **Check the work log** reloads.
   A ref guard and a disabled Send block a second dispatch on fast repeated clicks; a new
   message can't be sent while one is unresolved.
2. **Founder layout collision.** Cause confirmed: `.msg.founder` matched the public profile's
   `.founder { display:flex }`. Work-log classes are now `msg-founder` / `msg-assistant`
   (with `.msg { display:block }`); the profile rule is untouched.
3. **Applied proposal copy.** The note beside the disabled button now says "Used as revision
   N. Nothing was published." for an applied proposal (from the server's `applied_revision`,
   so it survives reload), and the button reads "Used". Stale and former-owner states get
   their own short notes.

Also reviewed while there:
- **Overlapping conversation loads** (polling and post-send reload): only the newest request's
  answer is applied now (sequence guard). This was a source-review risk, not a reproduced bug.
- **Stop errors**: a failed cancel previously rejected unhandled and showed nothing; it now
  shows "Couldn't stop it: …". Source-review finding, not browser-reproduced.
- Actor/project remount boundary unchanged.

## Checks

| Command | Result |
|---|---|
| `npm run check` | lint and types clean; 163 tests passed (16 files; 5 new in `web/test/outbox.test.ts`) |
| `npm run web:build` | built (JS 505.6 kB; Vite's >500 kB chunk advisory, not a failure) |
| `npx biome format --write` / `npx biome check --write` on the changed web files | applied |

`web/test/outbox.test.ts` covers the state rules the panel renders from: typing during a
send survives settlement; a second send can't start while one is in flight or unresolved;
an unknown outcome retries the same text and key; a refusal is not retried and is given back
only to an empty box; classification of 4xx vs 5xx/no-answer. No DOM dependency was added.

## Not verified by me

The delayed-response browser sequence, 1280/390 rendering of the work log, keyboard focus on
the new outbox buttons.
