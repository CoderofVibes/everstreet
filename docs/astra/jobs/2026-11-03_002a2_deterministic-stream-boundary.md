# Make the flooding-stream check prove the intended boundary

**Why:** Tony expects sustained building with reliable verification. Independent full check at
ed36b95 failed467/468: the flooding test expected stream_limit but got timeout. Claude observed
the same earlier; all20 boundary tests pass alone. See demand-and-recovery-review.

Inspect the test's100ms-style time limits and worker scheduling. Separate the stream-event cap
test from the real timeout test so load cannot make one guard win before the guard being tested.
Use a controlled clock/scheduling or sufficiently isolated explicit timeout for this test; retain
separate meaningful deadline/silent-provider checks. Don't remove the assertion, accept either
reason indiscriminately, skip the case or loosen production safeguards. Preserve usage/reserve
accounting and bounded event storage. If a production bug is found, reproduce and report it
before making a narrowly justified fix.

Run the focused boundary tests and full check; a small repeated full run is warranted to verify
this intermittent failure, not an unbounded rerun loop. Report exact results. Small local commit,
then005a1. No provider calls, network, signing or deployment. Priority P1/S.
