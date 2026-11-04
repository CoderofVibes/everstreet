// Job 002e1 (Astra's WorkerImplementationReview follow-up, item 5): ONE lifecycle lock shared by
// every operation that can create or destroy worker state: run, preflight, cleanup and (in the
// shell) uninstall. Each holds it for its whole critical section, so a preflight's orphan scan can
// never run while a new run starts, and a run can't start during a scan.
//
// The lock file holds its owner's {pid, start, purpose, id}; `start` is the process start time
// (/proc/<pid>/stat field 22), so a recycled pid is not mistaken for the owner.
// - acquire: atomic exclusive create. If it exists and its owner is alive: busy. If its owner is
//   gone: a takeover. Move the stale file aside, check by inode that what was moved IS the stale
//   lock judged (not a newer live lock another contender just created), then create ours
//   exclusively. Having moved someone else's lock, it is put back and the answer is busy.
// - release: only the owner removes the lock.
// Residual (documented): three-way contention during one takeover can still leave a live owner's
// lock displaced; the displaced owner's release then refuses, and the next preflight reports it.
// Unit-tested with deterministic interleavings in server/test/lifecycle-lock.test.ts.

import * as nodeFs from "node:fs";

/**
 * @param {{ path: string, self: {pid: number, start: string}, alive: (h: {pid: number, start: string}) => boolean,
 *           fs?: typeof nodeFs, tag?: () => string, hooks?: { beforeMoveStale?: () => void } }} o
 */
export function lifecycleLock(o) {
  const fs = o.fs ?? nodeFs;
  const tag = o.tag ?? (() => `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const mine = (h) => h && h.pid === o.self.pid && h.start === o.self.start;

  function read(p = o.path) {
    try {
      const h = JSON.parse(fs.readFileSync(p, "utf8"));
      return h && typeof h.pid === "number" && typeof h.start === "string" ? h : { unreadable: true };
    } catch (e) {
      if (e.code === "ENOENT") return null;
      return { unreadable: true };
    }
  }
  function create(purpose, id) {
    try {
      fs.writeFileSync(o.path, JSON.stringify({ ...o.self, purpose, id: id ?? null }), { flag: "wx", mode: 0o600 });
      return true;
    } catch (e) {
      if (e.code === "EEXIST") return false;
      throw e;
    }
  }

  /** @returns {{ok: true, orphan: object|null} | {ok: false, busy?: object, unreadable?: true}} */
  function acquire(purpose, id) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (create(purpose, id)) return { ok: true, orphan: null };
      const h = read();
      if (h === null) continue; // released meanwhile: try again
      if (h.unreadable) return { ok: false, unreadable: true };
      if (o.alive(h)) return { ok: false, busy: h };
      // The owner is gone: take over, checking that what we move is the stale lock we judged.
      const judged = fs.statSync(o.path, { throwIfNoEntry: false });
      if (!judged) continue;
      o.hooks?.beforeMoveStale?.();
      const aside = `${o.path}.stale-${tag()}`;
      try {
        fs.renameSync(o.path, aside);
      } catch (e) {
        if (e.code === "ENOENT") continue; // someone else moved it first
        throw e;
      }
      const moved = fs.statSync(aside);
      if (moved.ino !== judged.ino || moved.dev !== judged.dev) {
        // We moved a NEWER lock (another contender's live one): put it back, report busy.
        try {
          fs.linkSync(aside, o.path);
        } catch {
          // a third party holds the path now; the displaced owner's release will refuse
        }
        fs.unlinkSync(aside);
        return { ok: false, busy: read() ?? { displaced: true } };
      }
      fs.unlinkSync(aside);
      if (create(purpose, id)) return { ok: true, orphan: h };
      const now = read();
      return now && !now.unreadable && o.alive(now) ? { ok: false, busy: now } : { ok: false, unreadable: true };
    }
    return { ok: false, busy: read() ?? { contended: true } };
  }

  /** Records the run's jail id once known (only the owner may). */
  function setId(id) {
    const h = read();
    if (!mine(h)) return false;
    fs.writeFileSync(o.path, JSON.stringify({ ...h, id }), { mode: 0o600 });
    return true;
  }

  /** Removes the lock only if it is ours. */
  function release() {
    const h = read();
    if (!mine(h)) return false;
    fs.unlinkSync(o.path);
    return true;
  }

  return { acquire, release, setId, read };
}
