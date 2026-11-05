// Job 002f1 correction 2: what the guest memory case may claim (scripts/worker-host/
// conformance-lib.mjs memoryClaim). Pure rules only: no host, launcher or VM. The real-host run
// remains a separate, dispatched gate.

import { describe, expect, it } from "vitest";
import {
  GUEST_MEMORY_MAX,
  memoryClaim,
  memorySelfTest,
  // @ts-expect-error: a plain .mjs module shared with the host, without type declarations
} from "../../scripts/worker-host/conformance-lib.mjs";

const job = { check_id: "m", attempt: 1, digest: "d", ids: ["grow", "ok"] };
const ok = { id: "ok", passed: true, detail: "" };
const report = (grow: object, extra: object = {}) => ({
  report: {
    check_id: "m",
    attempt: 1,
    digest: "d",
    cases: [grow, ok],
    usage: { untrusted_memory_peak_bytes: 150 * 1048576 },
    limits: { memory_max: GUEST_MEMORY_MAX, swap_max: 0 },
    ...extra,
  },
});

describe("002f1: the guest memory claim", () => {
  it("every negative control holds", () => {
    expect(memorySelfTest()).toEqual([]);
  });

  it("an OOM kill and a held-then-timed-out step are different claims, both named", () => {
    const oom = memoryClaim(
      report({
        id: "grow",
        passed: false,
        detail: "killed by signal SIGKILL",
        memory_events: { max: 2, oom: 1, oom_kill: 1 },
      }),
      job,
      "grow",
      "ok",
    );
    expect(oom).toEqual({ holds: true, kind: "oom_kill", reasons: [] });
    const held = memoryClaim(
      report({
        id: "grow",
        passed: false,
        detail: "Took longer than 5 seconds and was stopped",
        memory_events: { max: 9, oom: 0, oom_kill: 0 },
      }),
      job,
      "grow",
      "ok",
    );
    expect(held).toEqual({ holds: true, kind: "held_at_ceiling_then_timed_out", reasons: [] });
  });

  it("run 2's shape (a 5 s stop with no kernel memory evidence) does not count", () => {
    const r = memoryClaim(
      report(
        { id: "grow", passed: false, detail: "Took longer than 5 seconds and was stopped" },
        { limits: undefined },
      ),
      job,
      "grow",
      "ok",
    );
    expect(r.holds).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        "the memory bound wasn't read back",
        "no finite kernel memory events for the case",
      ]),
    );
  });
});

describe("002f1 correction 3: the test-only orphan procedure's rules", () => {
  // @ts-expect-error: a plain .mjs module shared with the host, without type declarations
  const lib = import("../../scripts/worker-host/conformance-lib.mjs");
  const LOCKS = [
    "1: FLOCK  ADVISORY  WRITE 4242 08:20:77101 0 EOF",
    "1: -> FLOCK  ADVISORY  WRITE 5151 08:20:77101 0 EOF",
    "2: POSIX  ADVISORY  WRITE 6262 08:20:77101 0 EOF",
    "3: FLOCK  ADVISORY  WRITE 7373 08:20:99999 0 EOF",
  ].join("\n");

  it("finds only the FLOCK holder of the lifecycle lock's inode (not waiters, POSIX locks or other files)", async () => {
    const { flockHolders } = await lib;
    expect(flockHolders(LOCKS, 77101)).toEqual([4242]);
    expect(flockHolders(LOCKS, 12345)).toEqual([]);
    expect(flockHolders("garbage\n\n1: FLOCK ADVISORY WRITE 1 08:20:77101 0 EOF", 77101)).toEqual(
      [],
    );
  });

  it("accepts exactly the launcher's run and exactly this jail's Firecracker", async () => {
    const { isLauncherRun, isVmFor } = await lib;
    const run =
      "/opt/everstreet-worker/node/bin/node\0/opt/everstreet-worker/host-launch.mjs\0run\0";
    expect(isLauncherRun(run)).toBe(true);
    expect(isLauncherRun(run.replace("run", "preflight"))).toBe(false);
    expect(isLauncherRun(`${run}extra\0`)).toBe(false);
    expect(isLauncherRun("/usr/bin/node\0/opt/everstreet-worker/host-launch.mjs\0run\0")).toBe(
      false,
    );
    const jail = "es-0123456789ab-1";
    const fc = `/srv/everstreet-jail/firecracker/${jail}/root/firecracker\0--id\0${jail}\0--api-sock\0x\0`;
    expect(isVmFor(fc, jail)).toBe(true);
    expect(isVmFor(fc, "es-0123456789ab-2")).toBe(false);
    expect(isVmFor(fc.replace("firecracker\0", "sh\0"), jail)).toBe(false);
    expect(isVmFor(fc, "es-*")).toBe(false);
  });
});
