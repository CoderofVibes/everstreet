// Job 003wf1 (docs/design/APPLICATION_COMPOSITION.md §12.3): the composition's shutdown fence.
//
// Every injected network call (RPC, chain writer, model provider) and every protected storage
// call the composition makes passes through one Fence. While it is open, answers pass through
// unchanged. Once `close()` runs (after admission ended and in-flight work drained or timed
// out, and BEFORE the database closes), an answer that arrives late never resumes its caller: it
// stays pending, so no request handler or maintenance pass continues into a closed database, and
// nothing is recorded as done that wasn't. A network call started after close never reaches the
// adapter; an object method called after close may start, but its answer is dropped.
// The fence never answers for an adapter and never fabricates an outcome; whatever was in doubt
// stays in doubt in the durable records, for the next process's recovery.

type AnyFn = (...args: never[]) => unknown;

export class Fence {
  private shut = false;
  /** Late answers that arrived after close and were held back (observability for tests). */
  held = 0;

  get closed() {
    return this.shut;
  }

  close() {
    this.shut = true;
  }

  /** Runs `start` while open; its answer resumes the caller only if the fence is still open. */
  pass<T>(start: () => Promise<T>): Promise<T> {
    if (this.shut) return new Promise<T>(() => {});
    return new Promise<T>((resolve, reject) => {
      let p: Promise<T>;
      try {
        p = start();
      } catch (e) {
        reject(e);
        return;
      }
      p.then(
        (v) => {
          if (this.shut) this.held++;
          else resolve(v);
        },
        (e) => {
          if (this.shut) this.held++;
          else reject(e);
        },
      );
    });
  }

  /** A fetch-like function through the fence. */
  wrap<F extends AnyFn>(f: F): F {
    return ((...args: Parameters<F>) =>
      this.pass(() => Promise.resolve(f(...args) as ReturnType<F>))) as unknown as F;
  }

  /** An adapter object whose promise-returning methods pass through the fence. */
  object<T extends object>(target: T): T {
    return new Proxy(target, {
      get: (t, key, recv) => {
        const v = Reflect.get(t, key, recv);
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          const r = (v as (...a: unknown[]) => unknown).apply(t, args);
          if (!(r instanceof Promise)) return r; // synchronous answers (e.g. readiness) as they are
          if (this.shut) {
            // Started after close (its own resource is closing too): its answer is dropped.
            r.catch(() => {});
            this.held++;
            return new Promise(() => {});
          }
          return this.pass(() => r);
        };
      },
    });
  }
}
