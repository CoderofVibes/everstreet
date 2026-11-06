// Job 006c: one successor rehearsal in a fresh temporary directory, sealed into a record. The
// directory is removed whatever happens, and the record says whether it is really gone (the server
// checks again). Used by the rehearsal child (scripts/successor-child.ts) and by tests.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type RehearsalSeed,
  type RehearsalSnapshot,
  sealSuccessorRecord,
} from "../../../server/src/successorRehearsal.ts";
import { rehearseSuccessor } from "./journey.ts";

export async function runSuccessorRehearsal(input: {
  snapshot: RehearsalSnapshot;
  seed: RehearsalSeed;
  digest: string;
}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "everstreet-successor-"));
  const started = new Date().toISOString();
  let body: Awaited<ReturnType<typeof rehearseSuccessor>>;
  try {
    body = await rehearseSuccessor(input, dir);
  } finally {
    // SQLite's files can take a moment to be released on Windows: retry briefly.
    for (let i = 0; i < 20 && existsSync(dir); i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        await new Promise((ok) => setTimeout(ok, 50));
      }
    }
  }
  const record = sealSuccessorRecord({
    header: {
      business: input.snapshot.business,
      snapshot_digest: input.digest,
      label: "synthetic rehearsal",
      runner: "successor-child/1",
      started_at: started,
      finished_at: new Date().toISOString(),
      people: {
        founder: "Ava Chen (fictional)",
        successor: "Noah Brandt (fictional)",
        customer: "Cara Okafor (fictional)",
      },
    },
    snapshot: input.snapshot,
    steps: body.steps,
    dependencies: body.dependencies,
    outcome: body.outcome,
    disposal: { directory: dir, removed: !existsSync(dir) },
  });
  return JSON.stringify(record);
}
