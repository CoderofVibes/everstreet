# Make NEAR ownership and customer obligations understandable in the owner's workspace

**Why (Tony's words):** "One key function of Everstreet is the seamless purchase and transfer
of business/product to the investor/acquirer, on NEAR. So, that has to stay central to this as
well." Tony requested an overview and continued development on November 3.

## What the person sees and does

Add a clearly reachable owner-only **Ownership and continuity** page from My businesses / the
business desk. Use the existing design system. This is a useful view over the real observation
API, not a parallel simulation or a new acquisition flow. Start with what needs attention, then
ownership, customer obligations, current transfer, and evidence history. Keep raw hashes and
protocol detail in expandable evidence sections. The page remains useful at 1440/1280/390px.

- Explain unconnected, never-read, unavailable, paused, fresh, stale and conflicting states in
  plain language. Never present an unconfigured business as connected. No dummy live metrics.
- When observations exist, show the recorded chain owner versus app-owner mapping, generation,
  and whether mapping is unknown or disagrees. Observation does not grant application access.
- Show customer entitlement liabilities, held funds, available/withdrawable funds, outstanding
  claims, sale escrow and pending payouts using their actual contract categories. Clearly
  distinguish obligations, amounts held and completed payouts. Do not call claims paid or cash
  revenue. Preserve integer precision; no guessed token decimals or USD conversion. If trusted
  asset decimals aren't available, explicitly label exact base units and the asset account.
  These aggregate values do not prove individual remaining-use counts or service availability.
- Show the active deal's version, acceptance/closing state and observed outcomes with explicit
  source dates. A closed outcome does not mean the application handover or external assets are
  complete. Show history gaps. No buy/accept/close/withdraw/reconcile action in this job.
- Let the owner deliberately refresh recorded evidence, optionally selecting a month. Display
  the result and retain the last valid evidence with its ORIGINAL timestamp on transient error.
  No background polling, auto-refresh on mount, retry loops, or automatic clear of sticky flags.
- Source account/network, block identity, read time, freshness and operator-asserted network
  identity remain accessible next to the evidence. Each month's own block/time matters; missing
  or not-retained evidence is not zero. Exact=false counters must not appear exact.
- If access ends or the acting person/business changes, clear private data and drafts and fence
  late answers. Reuse the lessons from004a2/004a3; do not retain cached private evidence after404,
  or remain stuck in progress after a failed recheck. Loading, failure and explicit retry must
  all resolve clearly. Refresh status must be accessible to screen readers and keyboard users.

## Underneath and boundaries

Astra read `server/src/v3observe.ts` view/refresh, `server/src/v3read.ts` types,
`server/src/app.ts` v3 endpoints, `web/src/pages/Desk.tsx` and App routes. Existing owner-only
GET /api/businesses/:id/v3 and POST .../v3/refresh provide the evidence. Build a typed frontend
client and controller with meaningful async-state tests. Keep server types separate from
browser bundles. Modest read-only API changes are allowed if needed for truthful state (e.g.
freshness expiry metadata), with backwards compatibility and tests. Validate all displayed
amount/time values without coercing large integers to Number. Recompute displayed freshness
as time passes rather than leaving a green badge forever; use server-provided thresholds.

Normal app setup remains unconfigured: do not edit main.ts/config or enable live RPC. For
verification, provide a documented disposable in-memory preview fixture using the actual API
and actual Rust-produced fixture snapshots; make synthetic provenance explicit. Its only
network listener is loopback, with no keys, secrets, runtime data or external requests. Keep
test controls outside production routes. Include enough states for Astra's browser review.
Do not import signing Chain or touch contracts. Do not mix v2 financial totals with v3 balances.
This does not authorize deployment, signing, transactions, provider calls or public release.

## Done when

1. The actual owner can navigate to the page, inspect evidence, refresh one month, reload and
   see persisted evidence. An unrelated person is refused by the API and UI.
2. Tests cover every capability state, stale evidence, conflicting flags, owner mismatch/unknown,
   large exact amounts, uncertain counters, missing months, history gaps, refresh success and
   refusal, delayed and reordered answers, actor/business change, access loss and recovery.
3. A refresh failure cannot falsely advance the observation timestamp, clear a flag, claim a
   completed handover, or silently hide a stale/error state. No uncaught async errors.
4. Run npm run check and web:build, verify the source diff, report exact results and limitations.
   Provide fixture launch instructions and browser scenarios; Astra reviews before acceptance.
5. Test data producers must be finite even if the implementation guard is broken. No unbounded
   flood tests. If mutation testing is necessary, change one invariant at a time, use a bounded
   isolated run, restore in a finally-equivalent procedure, inspect the diff, then run the full
   suite only on restored code. Do not repeat the003i host-memory failure.

## Not in this job

No ownership reconciliation, managed closer, customer runtime/entitlement integration, chain
identity attestation, live endpoint, wallet operations or M3 completion. These remain required
next integration gates; this page must expose the gaps, not conceal them. Preserve all six
milestones and the approachable studio/digital business direction.

Priority P1 / M-L. After003i review. Stop for Astra review when complete.
