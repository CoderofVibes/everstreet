# Unresolved writer history: the operators' procedure

Job 003wf slice 3 (parent brief), November 5 2026. Closes the gap named in the 003wd report and
APPLICATION_COMPOSITION.md §8: `needs_reconciliation` and `legacy_invalid` had no operator UI
or procedure. Software only; nothing here signs, sends or deploys.

## Who

The verified NEAR accounts listed in the configuration's `operators.accounts` (1 to 16;
configured mode with `sign_in` only). Everyone else, including business owners, gets 404 from
`/api/operator/writer-history*`, and the page says "Page not found". There is no preview
operator: fictional actor switching never reaches this console.

## What is listed

Every operation in `chain_tx_attempts` (the customer writer) and `closer_tx_attempts` (the
managed-handover closer) with an attempt whose outcome is not proven:

| Reason | Meaning |
|---|---|
| `outcome_unknown` | `signed`: it may have been sent and executed; no FINAL status is recorded |
| `legacy_invalid` | an earlier writer's `invalid`, not proof (the upgrade policy) |
| `other_signer` | signed under an identity this server no longer signs with (customer writer only) |

Per operation: its subject (the customer request's id, state, business and plan, or the close
order), the newest attempt's state, and how many earlier unresolved attempts sit behind a later
terminal one (they still block fresh attempts). Per attempt: method, receiver, signer, key,
nonce, block height, hash, sends claimed and whether that count is proof (`counted`), state,
code, times and every earlier check. Never the signed bytes, the payload or customer content.
Bounded: 200 operations, 20 attempts each, 20 checks each.

## The one action

"Read its own final status": `txStatus(hash, signer)` for that exact attempt, with a 10 s
deadline, sending nothing. A FINAL success or failure is recorded by compare-and-set, over a
still-`signed` attempt or a `legacy_invalid` one (clearing the flag). If the attempt was
recorded elsewhere first, the stored state stands and the answer says so. `not_found`, pending
and failed reads change nothing and say that they prove nothing. Every check, whatever it
showed, is appended to `writer_history_checks` (append-only by trigger): who, when, the state
before and after, what was observed, whether it was recorded.

There is no "mark successful", "mark failed" or "retry fresh". Elapsed time, a missing status, an
expired block or a used nonce never prove an outcome. The customer-use and close state machines
stay decided by the contract's own readback.

## Evidence

- `server/test/writer-history.test.ts` (14): access, listing rules, never bytes, behind-terminal,
  other signer, success/failure/not_found/read_failed, the compare-and-set race, the audit's
  append-only triggers, configuration validation.
- `server/test/writer-history-composed.test.ts` (1): the production composition; a crash-lost
  `open_hold` record is listed for the operator only, resolved by its own hash; an unknown hash
  stays unknown; nothing is sent.

Not verified: the page in a real browser; competing operator processes (the compare-and-set is
the same rule the writer's own tests cover across processes).
