// Job 003wf1 (docs/design/APPLICATION_COMPOSITION.md §12.3): the composition's shutdown boundary.
//
// Two gates close together when the composition stops, after admission ended and in-flight work
// drained (or its shared budget ran out), and BEFORE storage closes:
// - `Fence`: every injected network call (RPC, chain writer, model provider) and every protected
//   storage call. Once closed, a call is refused before it reaches the adapter, and an answer that
//   arrives late is not delivered: its caller gets `StoppedError` instead.
// - `gateDb`: the records database itself. Once closed, any access (a statement, a transaction)
//   throws `StoppedError` instead of reaching SQLite, whichever code path it comes from: a route
//   handler that was admitted earlier and resumes after a body read, a maintenance item that
//   outlived its deadline, a runtime run finishing after its provider answered late.
// `StoppedError` is an HttpError 503 "stopping", so a late route continuation answers 503 with
// no closed-storage error, and the maintenance supervisor's deadline wrapper already catches it.
// Nothing is fabricated: whatever was durably recorded before the gate stays as it was (an
// unknown dispatch stays unknown) for the next process's recovery, and no fresh retry is implied.

import type { DatabaseSync, StatementSync } from "node:sqlite";
import { HttpError } from "./store.ts";

export class StoppedError extends HttpError {
  constructor() {
    super(503, "The server is stopping", "stopping");
  }
}

type AnyFn = (...args: never[]) => unknown;

export class Fence {
  private shut = false;
  /** Calls refused or answers withheld after close (tests observe it). */
  held = 0;
  /** The fence's own outstanding waiters: each is finished at close (Astra's fence probe). */
  private readonly waiting = new Set<(e: StoppedError) => void>();

  get closed() {
    return this.shut;
  }

  /**
   * Closes the fence: every call still outstanding through it gets StoppedError NOW, whether
   * or not its raw adapter ever answers (a non-cooperating adapter can't keep a caller waiting);
   * a late raw answer is then ignored.
   */
  close() {
    if (this.shut) return;
    this.shut = true;
    for (const stop of [...this.waiting]) stop(new StoppedError());
    this.waiting.clear();
  }

  /** Runs `start` while open; after close its caller gets StoppedError, its late answer is dropped. */
  pass<T>(start: () => Promise<T>): Promise<T> {
    if (this.shut) {
      this.held++;
      return Promise.reject(new StoppedError());
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const stop = (e: StoppedError) => {
        if (settled) return;
        settled = true;
        this.held++;
        reject(e);
      };
      this.waiting.add(stop);
      const end = () => {
        settled = true;
        this.waiting.delete(stop);
      };
      let p: Promise<T>;
      try {
        p = start();
      } catch (e) {
        end();
        reject(e);
        return;
      }
      p.then(
        (v) => {
          if (settled) return; // already finished by close: the late answer goes nowhere
          end();
          resolve(v);
        },
        (e) => {
          if (settled) return;
          end();
          reject(e);
        },
      );
    });
  }

  /**
   * A fetch-like function through the fence, for the WHOLE response lifetime (Astra's handoff
   * review): the headers arrive through the fence, and so does every read of the body. At close
   * a pending body read is rejected at once (StoppedError) and the underlying reader is
   * cancelled, so a transport that holds its body can't keep an owned run, its timer or its
   * caller waiting. The response's url and redirect flag are kept for the caller's own checks.
   */
  wrap<F extends AnyFn>(f: F): F {
    return ((...args: Parameters<F>) =>
      this.pass(() => Promise.resolve(f(...args) as ReturnType<F>)).then((r) =>
        this.response(r),
      )) as unknown as F;
  }

  private response<T>(r: T): T {
    if (!(r instanceof Response) || !r.body) return r;
    const reader = r.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      pull: async (c) => {
        try {
          const { done, value } = await this.pass(() => reader.read());
          if (done) c.close();
          else c.enqueue(value);
        } catch (e) {
          reader.cancel().catch(() => {});
          c.error(e);
        }
      },
      cancel: (why) => reader.cancel(why).catch(() => {}),
    });
    const out = new Response(body, {
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
    });
    Object.defineProperty(out, "url", { value: r.url });
    Object.defineProperty(out, "redirected", { value: r.redirected });
    return out as T;
  }

  /**
   * An adapter object whose promise-returning methods pass through the fence. After close no
   * method reaches the target (synchronous ones too: their resource is closing).
   */
  object<T extends object>(target: T): T {
    return new Proxy(target, {
      get: (t, key) => {
        const v = Reflect.get(t, key, t);
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          if (this.shut) {
            this.held++;
            throw new StoppedError();
          }
          const r = (v as (...a: unknown[]) => unknown).apply(t, args);
          return r instanceof Promise ? this.pass(() => r) : r;
        };
      },
    });
  }
}

/** The records database behind a gate: after `gate.closed`, no access reaches SQLite. */
export function gateDb(db: DatabaseSync, gate: { closed: boolean }): DatabaseSync {
  const refuse = () => {
    throw new StoppedError();
  };
  const statement = (s: StatementSync) =>
    new Proxy(s, {
      get(t, key) {
        const v = Reflect.get(t, key, t);
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          if (gate.closed) refuse();
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      },
    });
  return new Proxy(db, {
    get(t, key) {
      // Before anything reads the native object: a getter (isTransaction, isOpen) included.
      if (gate.closed && key !== "close") refuse();
      const v = Reflect.get(t, key, t);
      if (typeof v !== "function") return v;
      if (key === "close") return v.bind(t);
      return (...args: unknown[]) => {
        if (gate.closed) refuse();
        const out = (v as (...a: unknown[]) => unknown).apply(t, args);
        return key === "prepare" ? statement(out as StatementSync) : out;
      };
    },
  });
}
