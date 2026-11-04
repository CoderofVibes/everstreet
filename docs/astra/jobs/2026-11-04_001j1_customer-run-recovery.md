# Recover an unanswered customer run visibly

P0/S-M, next bounded correction before002e. Tony authorized continuous development and the
disposable synthetic customer/sale tests. Preserve all six milestones and the approved UI.

## Reproduced on committed89c6923

Astra actual browser tab44, preview-customer --with-offer, Cara, fictional invoice82chars.
Review -> authorize synthetic one use -> control POST :8813/lose/execute -> Run it.
The server completed the run but its response was lost. Actual screen still says Reserved,
Run it on my document and Don't run it: return my unit; error only says answer was lost.
No Check progress/recover action is offered. Recent-use direct link opens the SAME request
and immediately finds Result ready. Show result succeeds, settlement yields99free/1used.
No duplicate provider call was demonstrated; backend idempotency remains valuable.

## Correction

An unanswered execute must leave a visible, request-bound recovery state with a read/check
action rather than suggesting the run never started or offering return based on stale state.
Do not automatically execute again, create another request, or infer failure/refund from a
lost response. Preserve input safely, actor/generation fences, same-request identity, refresh
and direct-link recovery. A failed recovery read stays recoverable. If fresh authoritative
read truly shows no execution, allow deliberate same-request retry without claiming completion.
Clear the recovery marker only on appropriate confirmed state or actor/request change.
Inspect related confirm/release/unit unanswered action handling for the same mechanism;
fix actual instances within this bounded controller/UI slice, not a backend protocol rewrite.

## Acceptance

Reproduce first using actual CustomerWorkspace + real API synthetic fixture. Assert next
action and rendered controls immediately after lost execute, then failed read, then successful
read. Provider call remains one and request unchanged. Include no-execution/explicit refusal,
actor/request change and reload/direct-link cases as relevant. Existing running/unknown/result/
settlement/access-loss tests must pass. No fixture-only "recovery" by calling refresh manually
without proving the actual UI offers it. Update progress wording consistently.
Check/webbuild, local explicit-path commits/report; stop for Astra review. No provider/chain/
main wiring, signing/deploy/spending/push/release/research/Day One. Scope all searches.
