// Job 006c: the successor rehearsal child (docs/design/SUCCESSOR_REHEARSAL.md §1). Forked by the
// server with an IPC channel and a heap limit; it receives one snapshot, runs the synthetic
// successor journey in its own temporary directory (never the live database), and answers the
// sealed record, then exits. SYNTHETIC: fictional people, no network.
//   node --import tsx scripts/successor-child.ts   (IPC only)

import { runSuccessorRehearsal } from "./lib/successor/run.ts";

process.once("message", (m: { type?: string; input?: unknown }) => {
  if (m?.type !== "run") return process.exit(2);
  runSuccessorRehearsal(m.input as Parameters<typeof runSuccessorRehearsal>[0])
    .then((record) => process.send?.({ type: "record", record }, () => process.exit(0)))
    .catch((e: Error) =>
      process.send?.({ type: "error", message: e.message.slice(0, 300) }, () => process.exit(1)),
    );
});
process.send?.({ type: "ready" });
