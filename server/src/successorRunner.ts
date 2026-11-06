// Job 006c: runs a successor rehearsal in a separate child process (scripts/successor-child.ts)
// with a heap limit; killed when its deadline passes. The child never receives anything but the
// snapshot, and answers only the sealed record (or an error).

import { fork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SuccessorRunner } from "./successorRehearsal.ts";

const CHILD = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "successor-child.ts",
);

export function forkSuccessorRunner(opts: { heapMb?: number } = {}): SuccessorRunner {
  return (input, signal) =>
    new Promise<string>((resolve, reject) => {
      const child = fork(CHILD, [], {
        execArgv: ["--import", "tsx", `--max-old-space-size=${opts.heapMb ?? 512}`],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      let settled = false;
      const done = (f: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        f();
      };
      const onAbort = () => {
        child.kill("SIGKILL");
        done(() => reject(new Error("stopped at its deadline")));
      };
      signal.addEventListener("abort", onAbort);
      child.on("message", (m: { type?: string; record?: string; message?: string }) => {
        if (m.type === "ready") child.send({ type: "run", input });
        else if (m.type === "record" && typeof m.record === "string")
          done(() => resolve(m.record as string));
        else if (m.type === "error")
          done(() => reject(new Error(m.message ?? "the rehearsal failed")));
      });
      child.on("exit", (code) =>
        done(() => reject(new Error(`the rehearsal process ended (${code ?? "killed"})`))),
      );
      child.on("error", (e) => done(() => reject(e)));
    });
}
