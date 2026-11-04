// Job 002e1: the worker's single lifecycle lock (scripts/worker-host/lifecycle-lock.mjs), with
// deterministic interleavings on a real temporary directory (no host effect). Astra's race: a
// preflight observed the lock free, a run took it, then the preflight's orphan scan treated the
// new live jail as an orphan. With one lock held across each critical section that can't happen.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs module shared with the host, without type declarations
import { lifecycleLock } from "../../scripts/worker-host/lifecycle-lock.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function world() {
  const dir = mkdtempSync(join(tmpdir(), "es-lock-"));
  dirs.push(dir);
  const path = join(dir, "run.lock");
  const live = new Set<string>();
  const proc = (pid: number, start = "100", hooks?: object) => {
    live.add(`${pid}:${start}`);
    return lifecycleLock({
      path,
      self: { pid, start },
      alive: (h: { pid: number; start: string }) => live.has(`${h.pid}:${h.start}`),
      hooks,
    });
  };
  const die = (pid: number, start = "100") => live.delete(`${pid}:${start}`);
  return { path, proc, die };
}

describe("002e1 lifecycle lock", () => {
  it("Astra's race: a run can't start while a preflight holds the lock; the scan sees no new run", () => {
    const w = world();
    const preflight = w.proc(1);
    const run = w.proc(2);
    expect(preflight.acquire("preflight")).toMatchObject({ ok: true, orphan: null });
    // A run arriving between the preflight's check and its orphan scan is refused, not hidden.
    expect(run.acquire("run", "es-0123456789ab-1")).toMatchObject({
      ok: false,
      busy: { pid: 1, purpose: "preflight" },
    });
    expect(preflight.release()).toBe(true);
    expect(run.acquire("run", "es-0123456789ab-1")).toMatchObject({ ok: true });
  });

  it("a preflight or cleanup during a live run is busy and touches nothing", () => {
    const w = world();
    const run = w.proc(2);
    run.acquire("run", "es-0123456789ab-1");
    for (const p of ["preflight", "cleanup", "uninstall"])
      expect(w.proc(3).acquire(p)).toMatchObject({
        ok: false,
        busy: { pid: 2, id: "es-0123456789ab-1" },
      });
    expect(run.read()).toMatchObject({ pid: 2, purpose: "run" });
  });

  it("only the owner releases; a recycled pid (other start time) is not the owner", () => {
    const w = world();
    const run = w.proc(2, "100");
    run.acquire("run");
    expect(w.proc(2, "999").release()).toBe(false);
    expect(w.proc(7).release()).toBe(false);
    expect(run.release()).toBe(true);
  });

  it("a dead owner's lock is taken over once, reporting the orphan to clean", () => {
    const w = world();
    const crashed = w.proc(2);
    crashed.acquire("run", "es-0123456789ab-1");
    w.die(2);
    const pre = w.proc(1);
    expect(pre.acquire("preflight")).toMatchObject({
      ok: true,
      orphan: { pid: 2, id: "es-0123456789ab-1" },
    });
    expect(pre.read()).toMatchObject({ pid: 1, purpose: "preflight" });
  });

  it("two contenders judge the same dead lock: only one wins; the newer live lock is never stolen", () => {
    const w = world();
    const crashed = w.proc(2);
    crashed.acquire("run", "es-0123456789ab-1");
    w.die(2);
    const first = w.proc(1);
    let firstResult: unknown;
    // The second contender has judged the stale lock; before it moves it, the first takes over.
    const second = w.proc(3, "100", {
      beforeMoveStale: () => {
        firstResult = first.acquire("preflight");
      },
    });
    const secondResult = second.acquire("run", "es-00000000000f-1");
    expect(firstResult).toMatchObject({ ok: true, orphan: { pid: 2 } });
    expect(secondResult).toMatchObject({ ok: false, busy: { pid: 1 } });
    expect(first.read()).toMatchObject({ pid: 1, purpose: "preflight" });
    expect(first.release()).toBe(true);
  });

  it("the run records its jail id under its own lock only", () => {
    const w = world();
    const run = w.proc(2);
    run.acquire("run");
    expect(run.setId("es-0123456789ab-4")).toBe(true);
    expect(w.proc(5).setId("es-ffffffffffff-1")).toBe(false);
    expect(run.read()).toMatchObject({ id: "es-0123456789ab-4" });
  });
});
