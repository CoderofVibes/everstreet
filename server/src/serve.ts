// Job 003wf1 (docs/design/APPLICATION_COMPOSITION.md §12.5): the normal entry's logic, shared by
// server/src/entry.ts and (with only labelled network transports injected) the lifecycle test
// child. It composes, LISTENS, and only then starts recovery, workers and maintenance; a listen
// failure stops what was composed and exits 1 with nothing started. `stop()` (signals, or the
// test child's IPC request) stops the composition (bounded: admission, drain, fence, close),
// then closes the listener and its connections, then exits 0. Idempotent.

import { serve } from "@hono/node-server";
import type { AppConfig } from "./appConfig.ts";
import { type ComposeDeps, composeApplication } from "./compose.ts";

export interface ServeIo {
  log(line: string): void;
  error(line: string): void;
  exit(code: number): void;
}

export function runServer(config: AppConfig, deps: ComposeDeps, io: ServeIo) {
  const composed = composeApplication(config, deps);
  const server = serve(
    { fetch: composed.app.fetch, port: config.listen.port, hostname: config.listen.host },
    () => {
      // Readiness is reported, and work started, only once the listener is listening.
      composed.start();
      io.log(
        `Everstreet (${config.mode}, ${config.network}) listening on http://${config.listen.host}:${config.listen.port}`,
      );
      for (const c of composed.capabilities())
        io.log(`  ${c.state === "on" ? "on " : "off"}  ${c.label}: ${c.detail}`);
    },
  );
  let ending: Promise<void> | null = null;
  const finish = (code: number) =>
    (ending ??= (async () => {
      await composed.stop();
      const ls = composed.lastStop();
      if (ls?.forced || ls?.stop_failures)
        io.error(
          `stop: ${ls.forced ? "the drain budget ran out" : "drained"}; ${ls.requests_running} request(s) still running; ${ls.stop_failures} stop failure(s)`,
        );
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2_000);
        server.close(() => {
          clearTimeout(t);
          resolve();
        });
        (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      });
      io.exit(code);
    })());
  server.on("error", (err: NodeJS.ErrnoException) => {
    io.error(`listen failed: ${err.code ?? "error"}`);
    void finish(1);
  });
  return { composed, stop: () => finish(0) };
}
