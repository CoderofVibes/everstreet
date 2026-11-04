// Job 002e: the real engine adapter's command line (server/src/workerEngine.ts). Pure: nothing
// here spawns WSL. What this proves: the argv is fixed (only the verb, and a validated jail id
// for cleanup, vary), a distro or id can't smuggle arguments, and the jail id matches the
// launcher's own derivation (scripts/worker-host/host-launch.mjs).

import { describe, expect, it } from "vitest";
import { jailId, launchArgs, WslFirecrackerEngine } from "../src/workerEngine.ts";

describe("002e WSL Firecracker adapter: fixed command line", () => {
  it("passes only the verb to the root-owned launcher, as the runner account", () => {
    expect(launchArgs("EverstreetWorker", "run")).toEqual([
      "-d",
      "EverstreetWorker",
      "-u",
      "everstreet-runner",
      "--",
      "sudo",
      "-n",
      "/opt/everstreet-worker/bin/launch",
      "run",
    ]);
    expect(launchArgs("EverstreetWorker", "cleanup", "es-0123456789ab-2").at(-1)).toBe(
      "es-0123456789ab-2",
    );
  });

  it("refuses a distro or jail id that could carry anything else", () => {
    for (const d of ["", "Ubuntu --exec", "-d", "a;b", "x".repeat(70)])
      expect(() => launchArgs(d, "preflight"), d).toThrow(/distribution/);
    expect(() => new WslFirecrackerEngine({ distro: "Ubuntu --root" })).toThrow(/distribution/);
    for (const id of [undefined, "es-xyz-1", "es-0123456789ab-1 --rm", "../es-0123456789ab-1"])
      expect(() => launchArgs("W", "cleanup", id), String(id)).toThrow(/job id/);
  });

  it("derives the same jail id as the launcher", () => {
    expect(
      jailId({
        check_id: "01234567-89ab-cdef-0123-456789abcdef",
        attempt: 3,
        digest: "",
        recipe: "",
        bundle: "",
      }),
    ).toBe("es-0123456789ab-3");
  });
});
