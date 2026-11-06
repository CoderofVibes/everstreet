# Successor rehearsal: the buyer's first operating shift, rehearsed (job 006c)

Plan step 6, part 2. Job: [006c](../astra/jobs/2026-11-04_006c_successor-rehearsal.md). Before a
handover is treated as operationally ready, the owner (and, through the handover record, the
buyer) can review a **disposable rehearsal** in which a successor takes over a copy of the
business's released product, serves an existing customer, hits a founder-only dependency, fixes
it through a supported seam, and releases a checked version, while the former owner is refused
and the customer keeps their address and rights.

## 1. What is rehearsed, exactly

**The snapshot** (taken by the server when the owner starts a rehearsal, digested):
- the business (id, name, owner generation);
- the product rehearsed: its active release, with kind, exact artifact digest and the content needed
  to rebuild it (a SaaS workflow's saved revision; a web app's bundle and its customer terms);
- the active customer offers on it (plan, retention), as terms only;
- its dependency inventory: the platform-managed dependencies, the business contract, and (for an
  imported business) the import workspace's categories.

**Supported kinds** (the job's "one managed service and one additional family"): a **SaaS
workflow** (Relaydesk; deterministic compile, no model) and a **web app** (006a; a labelled
stand-in release). Other kinds are listed as "not rehearsed" with the reason (an AI product's
rebuild and checks would spend the model budget).

**The environment**: a separate child process (`scripts/successor-child.ts`) running the
existing synthetic successor flow (`saleWorld`: the real app, routes, customer runtime, writer and
reconciler over one contract-anchored synthetic customer + sale state) in its own temporary
directory. It receives the snapshot over IPC. **It never opens the live database**, contacts no
customer, signs nothing real and reaches no network. Bounded: one rehearsal at a time per
server, a heap limit, a hard deadline, and a kill on timeout.

**Synthetic customer rights**: a fictional customer with prepaid uses and an enrolled key on the
synthetic contract, who uses the product once before the sale (the "existing entitlement").

## 2. The steps (each recorded with its outcome and evidence)

1. **Rebuild the exact version.** The rehearsal rebuilds the snapshot's version and compares
   digests; a different digest stops the rehearsal (it would rehearse something else).
2. **Existing customer served before the sale** (one unit charged).
3. **Change of control** through the existing Direct sale and reconciler, on terms that name no
   metering operator.
4. **Founder-only dependency, intentionally failed:** customer service depended on the metering
   operator the founder had appointed; it ended at the close, so the existing customer's next use
   is refused (`operator_not_authorized`).
5. **Corrected through the supported seam:** the successor appoints metering from their own
   wallet; **the affected check is repeated** and the customer is served.
6. **Former owner refused** on the product's owner routes.
7. **Successor releases a checked version** of the product under their own control.
8. **Customer continuity:** the customer's earlier result, case or pass is still theirs and its
   address unchanged.
9. **External dependencies** (hosting, domain, source, billing): always **pending external**. A
   rehearsal can't turn them green; the report names who must act.
10. **Disposal:** the world is closed and its directory removed; the child reports it and the server
    checks the directory no longer exists.

## 3. The record

`everstreet-successor-rehearsal/1`: header (business, snapshot digest, label "synthetic
rehearsal", commit), snapshot, steps, dependencies, outcome, disposal; section digests with the
same canonical JSON as the handover record, checked on receipt (and offline). No keys, cookies,
customer documents or results, only identities. The server stores it immutably.

**Outcomes:** `passed` (every step passed as expected, external items pending), `failed` (a step
didn't), `interrupted` (the server restarted or the child died or timed out: a started rehearsal
is never left running or silently retried), `stale` (the business changed after the snapshot).

**Where it shows:** the owner's "Successor rehearsal" page (start, progress, report); the handover
record (003x) carries the latest finished rehearsal as an "as recorded" statement with its
boundaries, so the buyer receives it. A passing rehearsal never marks NEAR control or any
external transfer as done.

## 4. Not covered

A real chain, wallet or provider; AI products; the business's other products in the same run;
multi-product businesses; live customer accounts. The successor in the rehearsal is fictional.

## 5. As built (Nov 5, late)

- **Server.** `successorRehearsal.ts` (snapshot with digest, seal and offline verify, the
  `successor_rehearsals` table immutable once finished, one run at a time, the server's own
  deadline, restart recovery to "interrupted", stale detection, the directory check);
  `successorRunner.ts` (forks `scripts/successor-child.ts` with a 512 MB heap; killed at the
  deadline). Routes: list, start (handover-gated), record download. The handover record carries the
  latest finished rehearsal in its control section (digested, "as recorded"); the buyer's control
  sheet shows it with its boundaries. Composed in the configured entry, the local preview and the
  review harness.
- **Journey.** `scripts/lib/successor/journey.ts` over `saleWorld` seeded with the snapshot
  (`ProductSeed`); `run.ts` creates and removes the temporary directory and seals the record.
- **Web.** Desk link "Successor rehearsal" to `/desk/:id/rehearsal`: start, bounded follow, the
  steps (expected and observed), the dependencies (who holds each and its status), boundaries,
  record download.
- **Evidence.** `server/test/successor-rehearsal.test.ts` (Relaydesk and a web app pass every
  step with matching digests; tampered or secret-bearing records refused; routes: owner only,
  busy, unsupported AI product, failing runner, deadline, restart, stale, directory left behind;
  handover record and control sheet), `server/test/successor-rehearsal-process.test.ts` (the
  real child process; killed at its deadline), `web/test/rehearsalApi.test.ts`. Browser
  (relaydesk harness): started by keyboard at 375 px, followed to "Passed", report readable, no
  overflow, a second run listed the first under earlier rehearsals; no rehearsal directory left.
- **Not covered.** AI products; free web apps; multi-product businesses in one run; buyer access
  before the transfer (the buyer receives it in the handover record); a real chain or wallet.
