# Clear the obsolete access warning after a successful check

**Why (Tony):** approachable recovery; keep the build moving.

Astra repeated003j1 in the real browser with a disposable wrapper around the actual API:
valid evidence -> refresh404 -> recheck503 -> explicit check malformed200 -> explicit check valid.
The malformed check now settles and Check access remains enabled. The valid retry removes the
Needs attention access warning and enables Refresh evidence, but role=status still says:
"We couldn't check whether this business is still yours ... nothing can be refreshed until
access is checked." Browser independently confirmed refreshEnabled=true with that exact text.

When a successful explicit check restores access, clear or replace the access-related refresh
notice with a truthful result. Preserve unrelated refresh outcomes and original observation
timestamps. Never let an older completion clear a newer refusal. Add a controller assertion on
the actual status message after this sequence, not only the enabled state. Run check/build and
report/commit. Small web-only correction; no broad redesign, signing or live integration.

Priority P1/S, before003k1.003j1's original malformed-answer recovery itself passed this browser
repeat; this is a newly observed stale notice, not a claim the original fix failed.
