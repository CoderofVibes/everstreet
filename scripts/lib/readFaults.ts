// Job 001f2: delayed and failed reads for the Home preview, so the account-switch race and the
// outage can be repeated in a browser. It only changes WHEN a real answer is delivered (held), or
// replaces one read with a labelled 503 once. Answers are the app's own, computed for the caller
// who asked. Bounded: a held answer is released after `maxHoldMs` at the latest; at most
// `maxRequests` API requests pass through before every further one is refused.

import type { MiddlewareHandler } from "hono";

export const FAULT_READS = {
  projects: "/api/product-projects",
  discover: "/api/public/discover",
  needs: "/api/public/needs",
  foundations: "/api/product-foundations",
} as const;
export type FaultRead = keyof typeof FAULT_READS;

export function readFaults({ maxHoldMs = 90_000, maxRequests = 2_000 } = {}) {
  let holdNext = false;
  const held: (() => void)[] = [];
  const failNext = new Set<FaultRead>();
  let requests = 0;
  let delivered = 0;
  const which = (path: string) =>
    (Object.keys(FAULT_READS) as FaultRead[]).find((k) => FAULT_READS[k] === path);

  const middleware: MiddlewareHandler = async (c, next) => {
    requests++;
    if (requests > maxRequests)
      return c.json({ error: "Preview request ceiling reached; restart the preview" }, 503);
    const key = c.req.method === "GET" ? which(c.req.path) : undefined;
    if (key && failNext.has(key)) {
      failNext.delete(key);
      return c.json({ error: "Preview: this read was made to fail once" }, 503);
    }
    if (key === "projects" && holdNext) {
      holdNext = false;
      await next(); // the real answer, for whoever asked, computed now
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, maxHoldMs);
        held.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      delivered++;
      return;
    }
    await next();
  };

  return {
    middleware,
    /** Hold the next project-list answer until released (or maxHoldMs). */
    hold() {
      holdNext = true;
    },
    /** Deliver every held answer now. */
    release() {
      const n = held.length;
      for (const go of held.splice(0)) go();
      return n;
    },
    /** Make the next read of this kind fail once with a labelled 503. */
    fail(key: FaultRead) {
      failNext.add(key);
    },
    summary() {
      return {
        hold_next: holdNext,
        held: held.length,
        held_delivered: delivered,
        fail_next: [...failNext],
        requests,
        max_requests: maxRequests,
        max_hold_ms: maxHoldMs,
      };
    },
  };
}
