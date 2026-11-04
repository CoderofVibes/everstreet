// Job 002e2: the worker's lifecycle lock is verified with REAL processes and the REAL kernel
// flock(2), not by matching source text (002e1's source-shape assertions here pinned the flawed
// `flock -o` form that Astra reproduced on Ubuntu). The evidence is
// scripts/worker-host/lock-primitive-harness.sh: finite, unprivileged, harmless `sleep` children,
// one temporary directory, an outer timeout. It needs Linux with util-linux flock, so on Windows
// this test is SKIPPED (it is not counted as evidence there); the recorded run is in the 002e2
// report, made in existing WSL Ubuntu. Real host and engine conformance remain open.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const linuxWithFlock =
  process.platform === "linux" &&
  process.getuid?.() !== 0 &&
  spawnSync("flock", ["--version"]).status === 0;

describe("002e2 lifecycle lock: real flock(2), real processes (Linux only)", () => {
  it.runIf(linuxWithFlock)(
    "lock-primitive-harness: old -o form violates the invariant; the exec-held lock, fd-closed daemons, uninstall, inode and stale-uninstaller fences hold",
    () => {
      const r = spawnSync(
        "timeout",
        ["150", "sh", "scripts/worker-host/lock-primitive-harness.sh"],
        {
          encoding: "utf8",
          timeout: 160_000,
        },
      );
      expect(r.stdout).toContain("lock-primitive-harness: 0 failure(s)");
      expect(r.stdout).not.toContain("FAIL");
      expect(r.stdout).toContain("fenced setup.sh: stale U2 refuses");
      expect(r.status).toBe(0);
    },
    170_000,
  );
});
