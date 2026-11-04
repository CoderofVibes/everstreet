# 003j2 report: the access notice after a successful check

Claude, 2026-11-03. Job: [003j2](../jobs/2026-11-03_003j2_recovered-access-notice.md). Files:

- `web/src/continuityController.ts`
- `web/src/pages/Continuity.tsx`
- `web/test/continuity.test.ts`

**Reproduced first.** Astra's sequence went into a controller test, run against `70bc241`:
valid evidence, a 404 refresh, a 503 recheck, a malformed check, then a valid check. After the
valid check, `refresh.message` was still `ACCESS_UNCONFIRMED` ("…nothing can be refreshed until
access is checked") while refresh was enabled. The test failed.

**Change:**

- The notice written when a 404 recheck fails now carries `code: "access_unconfirmed"`.
- When a valid read is applied (which is what confirms access), only a refresh status with that
  code is replaced. It becomes a new `info` status: "Access confirmed. The evidence shown is
  unchanged, with its original time; you can refresh again."
- Any other status, including a newer refusal, is left as it is.
- The page shows `info` as a plain notice inside the existing live status region.
- The evidence and its original `observed_at` are untouched.

**Tests** (35 in the file, 3 new):

- Astra's exact sequence, asserting the actual status message. It stays "unconfirmed" after the
  malformed check, and becomes the confirmation after the valid one, with the original time kept.
- A valid read never replaces an unrelated `timeout` refusal.
- A newer refusal made after access was confirmed isn't cleared when an older read lands later.

Before the fix, 2 of these 3 failed.

```
npm run check        Test Files 41 passed (41); Tests 551 passed (551)
npm run web:build    built (existing chunk-size advisory only)
```

I didn't repeat this in a browser.
