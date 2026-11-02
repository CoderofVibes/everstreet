# 002c3 report: keep every unresolved request recoverable

Claude, 2026-11-02. Job: [002c3](../jobs/2026-11-02_002c3_recovery-capacity-and-capability-copy.md).
Commit `1733995`.

## What changed

**`web/src/serviceAttempt.ts`**

- The list stays bounded at `MAX_TRACKED = 10`. `put` now trims only the oldest *settled* entries (answered or refused). It never drops a request that is being sent or whose answer was lost.
- `runAction` has a new result, `"full"`: every tracked slot holds an unresolved or in-flight request.
- `start` refuses `"full"` before calling `mint`, so no key is created and nothing is sent, even with the explicit new-paid action.
- Recovering or settling replaces the entry with the same key, so it works at the limit.
- An answer (or refusal) settles an entry, which makes it trimmable and frees capacity.

**`web/src/pages/Service.tsx`**

- At `"full"`, the Run controls are replaced by a status notice: "Check an earlier request first. 10 earlier requests have no answer yet, which is as many as this page keeps track of. Check on one below (that won't run it again) before starting new paid work. Your text above stays as it is."
- Every unresolved request keeps its own "Check on that request" button.
- The draft is not read or changed by any of this.

**Capability copy**

- `Home.tsx` (Build card): "Start from a brief and prototype; each project shows whether AI drafting and builds are available."
- `Build.tsx` (landing): "Saved privately with every revision. You start from an editable brief and prototype; the project shows whether AI drafting and builds are available here."
- Neither page now claims AI is absent or present. The project views that do state availability (Conversation, Service) already use the server's authoritative availability response, and they are unchanged.

## Tests

`web/test/serviceAttempt.test.ts` has 3 new tests; the 6 existing ones are unchanged and pass:

- **Fifteen answered requests after one lost one:** the lost one is still unresolved and recoverable. The list is 10 long, and only the oldest answered entries were trimmed.
- **Ten lost answers:**
  - `runAction` is `"full"`. `start` returns null with and without the explicit action, the `mint` spy is never called, nothing is dropped, and the eleventh draft isn't stored.
  - Recovering the *oldest* works at the limit.
  - Its answer frees one slot. Explicit new work then starts and trims that settled entry, never an unresolved one.
- **Refused versus unknown:** with nine unknown requests and one refused, there is still room, and the refusal isn't recoverable. The next request evicts the refusal. After it too loses its answer, the list is full.

## Commands

```
npx biome check --write <the five files>     (1 file reformatted)
npm run check        Test Files 30 passed (30); Tests 346 passed (346)
npm run web:build    built (existing chunk-size advisory only)
```

## Limits

- Requests still live only in the open page's memory (as in 002c2). A refresh or tab close forgets them.
- No browser persistence was added: the job excludes storing raw customer input.
- The server's own invocation record stays authoritative.
- The browser repeat (eleven lost answers, recovery at capacity, the copy on Home and Build) is Astra's.
