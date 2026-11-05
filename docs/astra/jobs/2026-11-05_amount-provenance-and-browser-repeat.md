# Preserve amount provenance and finish the browser repeat

P1/S–M. Correction to Review evidence and presentation. Review baseline `f817fef`.

The cached token observation marks a disagreement, but `TokenAmount` ignores it and `parseToken` retains only symbol and decimals. Independent render probe: pass `150000` base units with TUSD metadata at 18 decimals and `changed: true`. The UI leads with `0.00000000000015 TUSD` and gives no warning. A 6-decimal observation would render the same units as `0.15 TUSD`. A new metadata observation must not silently reprice the user's view of historical records.

Carry the conflict through the projections and rendering path. Use evidence pinned to the amount where available. If scale is disputed or unavailable, show the exact base units, asset and reason. Treat conflicting reads at the same finalized height explicitly. Cover actual consumers that parse or reshape metadata, including a historical amount after a later conflicting observation. Retain exact formatting for consistent known metadata, including zero and large values. Keep assets separate.

Repeat the original browser acceptance with populated money rows, long asset names and large amounts at desktop and phone widths, with actual 200% browser zoom, keyboard and reduced motion. Verify Checks with its companion open. Record widths, what was exercised, and any limits. The previous narrow empty card and simulated viewport are partial evidence. Keep K5/K5b and exact Direct close assertions intact. Run the full check and web build.
