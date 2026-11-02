# 003f2 report: an observed zero keeps its source

Claude, 2026-11-02. Job: [003f2](../jobs/2026-11-02_003f2_zero-observation-source.md). Commit
`a58c13a`.

## Cause and change

`Books.months` (`server/src/books.ts`) used to derive `revenue_sources` from the month's revenue
*lines*. A line exists only for nonzero earned revenue. So an observed zero month had no revenue
source, and the Sources cell showed only its costs' source ("Founder supplied").

Revenue provenance now follows the month's `revenue_basis`:

| Basis | Revenue source |
|---|---|
| `observed`, including an exact zero | `Verified on NEAR · testnet` (the existing label for observed months) |
| `seeded` | `Seeded history · fictional` |
| `unknown` (unavailable, not connected) | none |
| `none` (before opening with no records, or nothing recorded) | none |

Unchanged:

- No revenue line is invented for a zero.
- Cost sources still come from the cost lines.
- The owner's books, the buyer's evidence room (`financialMonth`, all scope versions) and the estimate's source table all read the same field, so they agree.
- The UI needed no change: the Sources cell already joins revenue and cost sources. The August-style row now reads "Verified on NEAR · testnet · Founder supplied".

**Side effect, intended:** an estimate built only on observed zero months now names the ledger as
its revenue source, and adds the existing "test money on testnet" caveat, instead of saying "None
recorded".

## Tests (`server/test/financials-source.test.ts`, 3 new)

The fixture opened two months ago, with:

- M4: fictional seeded history.
- M3: before opening.
- M2: observed zero plus a founder cost.
- M1: observed $120.

Each test checks:

1. The observed zero has `[Verified on NEAR · testnet]` as its revenue source and `[Founder supplied]` as its cost source, and no revenue line.
2. Unavailable (M2 read failure), before-opening and fictional months:
   - The unavailable month has no revenue source and keeps its cost source.
   - The before-opening month has none.
   - The seeded month has only the fictional source.
   - Exactly the observed-basis months carry the observation source.
3. A buyer's granted evidence room shows the same provenance, including the current partial month read as zero.

**Control:** with the old line-based derivation restored, all 3 fail. With the fix, they pass.

## Commands

```
npm run check        Test Files 31 passed (31); Tests 349 passed (349)
npm run web:build    built
```

## Limits

- "Verified on NEAR · testnet" is the existing label for whatever ledger reader the server is configured with. In these tests that reader is the FakeChain double, so these results are not testnet evidence, and this job adds no new verification claim.
- No redesign, accounting-policy, chain or contract change.
- The browser repeat is Astra's.
