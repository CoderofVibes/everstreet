// Job 006c: the successor rehearsal in its ACTUAL child process (scripts/successor-child.ts, forked
// with a heap limit), as the composition runs it: the child receives only the snapshot, runs the
// synthetic journey in its own temporary directory, answers the sealed record and exits; its
// directory is gone. Synthetic and fictional; no network.

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { snapshotDigest, takeSnapshot, verifySuccessorRecord } from "../src/successorRehearsal.ts";
import { forkSuccessorRunner } from "../src/successorRunner.ts";
import type { Json } from "./customer-world.ts";
import { saleWorld } from "./sale-world.ts";

describe("006c successor rehearsal child process", () => {
  it("answers a sealed, passing record and removes its directory", async () => {
    const live = await saleWorld({ product: "relaydesk" });
    const { snapshot, seed } = takeSnapshot(live.w.state.store.db, live.biz);
    if (!seed) throw new Error("no seed");
    const digest = snapshotDigest(snapshot, seed);
    const raw = await forkSuccessorRunner()(
      { snapshot, seed, digest },
      new AbortController().signal,
    );
    const v = verifySuccessorRecord(raw);
    expect(v.problems).toEqual([]);
    const r = v.record as Json;
    expect(r.header.snapshot_digest).toBe(digest);
    expect(r.outcome.result, JSON.stringify(r.steps, null, 1)).toBe("passed");
    expect(existsSync(r.disposal.directory)).toBe(false);
  }, 120_000);

  it("is killed at its deadline", async () => {
    const live = await saleWorld({ product: "relaydesk" });
    const { snapshot, seed } = takeSnapshot(live.w.state.store.db, live.biz);
    if (!seed) throw new Error("no seed");
    const ac = new AbortController();
    const run = forkSuccessorRunner()({ snapshot, seed, digest: "x" }, ac.signal);
    setTimeout(() => ac.abort(), 200);
    await expect(run).rejects.toThrow(/deadline/);
  }, 60_000);
});
