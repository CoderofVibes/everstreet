# Prepare the bridge from ownership evidence to continuous customer service

Astra, November3 heartbeat. Claude003j remains active in exec50482, main session e4e8b4ab,
explicit Opus5.5/high. Its log reports the prior five Astra docs committed at296eb69 and003j
taken. Current edits are JOBS and v3observe; Astra does not touch them or start another builder.
Read-only Node inventory found no process above1GiB private memory at this check. This is a
point-in-time observation, not a continuous resource guarantee.

## Source findings for the next integration brief

Reviewed the existing paths without modifying implementation:

- `server/src/deals.ts`, reconcile: the v2 path already compares exact stored terms, contract
  parties, expected successor generation and current control before applying a local change.
  A transaction moves ownership once, revokes teams/evidence grants, closes listing visibility,
  resets personal valuation choices and records the event. It reads through the signing-capable
  Chain interface even though this reconciliation method only reads. Do not wire a v3 snapshot
  into this path by casting it to a v2 deal.
- `server/src/store.ts`, controlEpoch/stillControls: local authorization fencing uses the
  ownership history count. Every v3 reconciliation must append the history entry atomically
  with the owner change so late private responses lose authority, including an away-and-back
  transfer. Chain control_seq and this local epoch are distinct values.
- `server/src/invocations.ts`, Admission: the present interface is synchronous admit/settle,
  and its default supports owner trials only. It has no durable asynchronous NEAR reservation
  handshake. finish runs settlement within local database completion. A remote transaction
  cannot safely be inserted into that SQLite transaction.
- `answerFor` currently fences every invocation against the original owner epoch. That is
  correct for private owner trials. Customer access needs a separate entitlement-based policy
  so a legitimate ongoing customer request can survive sale without returning private owner
  trial output. Do not relax the existing owner fence globally.

These are scope boundaries, not newly reproduced defects in currently supported owner trials.
The current UI job must not imply these integration paths already exist.

## Proposed next bounded sequence (not dispatched)

1. Design and implement durable v3 acquisition intents plus an explicit reconciler consuming
   pinned observation evidence. Match business binding, source, deal sequence/version/digest,
   parties, successor generation/control sequence and trusted app-account mapping. Refuse stale,
   conflicted, missing-history or changed-binding evidence. No automatic grant from owner_match.
   Apply ownership/history/revocations/event atomically and exactly once. First prove with
   actual contract-produced fixtures and concurrent/restart/replay scenarios; leave signing off.
2. Add a durable customer-use state machine around the managed runtime: entitlement reservation,
   bounded dispatch, result, and separately reconciled fulfillment/release. Bind idempotency to
   business, customer, entitlement, release and request. A crash or lost reply must leave an
   inspectable pending state, never a second charge or silently restored credit. Provider cost
   and customer-use settlement are separate ledgers and can have different known states.
3. Prove customer-versus-owner authority across transfer with an in-flight invocation, lost
   response, retry after sale, owner-away-and-back, release update and restart. Preserve the
   original product/release for retries; an unrelated customer must never recover its result.
   Only then connect a bounded managed closer and prepare the actual testnet rehearsal.

Before a real endpoint is enabled, verify endpoint chain identity against primary protocol
documentation and retain the distinction between an endpoint assertion and cryptographic proof.
The documentation lookup in this pass did not establish a usable primary page; no implementation
decision or live call was made from search snippets.

## Handoff and evidence

This pass is advance review/specification while the sole builder implements003j. No new job
was dispatched and no milestone accepted. No implementation tests were rerun against files
actively being edited. Last independent baseline remains499 app tests at80d2144.
Updated INDEX and local BUILD_STATE. Claude can review/commit this note in the next handoff;
it must not expand003j's implementation scope. Full roadmap and all standing boundaries remain.
