// Job 002e1: the worker's lifecycle exclusion after Astra reproduced two winners in the earlier
// file-based takeover lock. Exclusion is now the kernel's flock(2), which Windows tests can't
// exercise; real exclusion is verified only on the Linux host (conformance cases 9 and 10), and
// the uninstall side by the fake-root harness. This pins the contract those rely on: one lock file
// for every lifecycle operation, never waiting, never inherited by what the launcher starts, and
// no file-based takeover left anywhere.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const launch = readFileSync("scripts/worker-host/launch", "utf8");
const hostLaunch = readFileSync("scripts/worker-host/host-launch.mjs", "utf8");
const setup = readFileSync("scripts/worker-host/setup.sh", "utf8");
const LOCKFILE = "/var/lib/everstreet-worker/lifecycle.flock";

describe("002e1 lifecycle exclusion contract", () => {
  it("every launcher verb runs inside one non-blocking, non-inherited flock on the lifecycle file", () => {
    expect(launch).toContain(`LOCKFILE=${LOCKFILE}`);
    expect(launch).toMatch(
      /flock -n -o -E 75 "\$LOCKFILE" env -i [^\n]*\\\n\s*\/opt\/everstreet-worker\/node\/bin\/node \/opt\/everstreet-worker\/host-launch\.mjs "\$VERB"/,
    );
    expect(launch).not.toMatch(/^exec /m); // the wrapper stays to report busy (exit 75) as JSON
    expect(launch).toContain('"busy":true');
  });

  it("uninstall takes the same lock; the launcher has no file-based takeover", () => {
    expect(setup).toMatch(/exec 9>>"\$MANIFEST_DIR\/lifecycle\.flock"\n\s*flock -n 9/);
    expect(setup).toContain("MANIFEST_DIR=$S/var/lib/everstreet-worker");
    expect(setup).toContain("flock:util-linux");
    expect(hostLaunch).not.toMatch(/run\.lock|lifecycleLock|renameSync|\.stale-/);
    expect(existsSync("scripts/worker-host/lifecycle-lock.mjs")).toBe(false);
  });
});
