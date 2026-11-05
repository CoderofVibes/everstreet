// Job 003wf1 test child (never used by the application): the NORMAL entry logic
// (server/src/serve.ts: compose, listen, then start; stop = admission, drain, gates, close) in its
// own process, with only its two network transports injected, both labelled. Each forwards the
// request over this process's IPC channel to the test process, which answers it
// (lifecycleWorld.ts). Every other destination is refused here, and nothing ever falls back to a
// real fetch. A "shutdown" IPC message runs the same stop as SIGINT/SIGTERM (on Windows a SIGTERM
// sent to a child is a forced kill, so the graceful path needs its own trigger).
//   node --import tsx server/test/entryChild.ts <config.json>   (forked with an IPC channel)

import { readFileSync } from "node:fs";
import { validateConfig } from "../src/appConfig.ts";
import { runServer } from "../src/serve.ts";
import type { FetchLike } from "../src/v3rpc.ts";

const RPC = "https://synthetic-testnet-rpc.example";
const MODEL_PATHS = new Set([
  "https://api.anthropic.com/v1/messages",
  "https://api.anthropic.com/v1/messages/count_tokens",
]);
if (!process.send) throw new Error("entryChild needs an IPC channel");
const config = validateConfig(JSON.parse(readFileSync(process.argv[2] as string, "utf8")));

let next = 0;
const waiting = new Map<number, (r: { status: number; body: string }) => void>();
process.on("message", (m: { type?: string; id?: number; status?: number; body?: string }) => {
  if (m?.type === "reply" && typeof m.id === "number") {
    const done = waiting.get(m.id);
    waiting.delete(m.id);
    done?.({ status: m.status ?? 500, body: m.body ?? "" });
  }
  if (m?.type === "shutdown") void running.stop();
});
/** Forwards one request to the test process; only `allowed` destinations, never a real fetch. */
const forward = (channel: "rpc" | "model", allowed: (url: string) => boolean) =>
  (async (input: string | URL | Request, init?: { body?: unknown }) => {
    const url = typeof input === "object" && "url" in input ? input.url : String(input);
    if (!allowed(url)) throw new Error(`synthetic transport: refused destination ${url}`);
    const id = ++next;
    const answer = new Promise<{ status: number; body: string }>((r) => waiting.set(id, r));
    process.send?.({ type: "fetch", channel, id, url, body: String(init?.body ?? "") });
    const r = await answer;
    return new Response(r.body, { status: r.status });
  }) as unknown;

const running = runServer(
  config,
  {
    fetch: forward("rpc", (u) => u === RPC) as FetchLike,
    fetchLabel: "synthetic RPC (lifecycle test)",
    modelFetch: forward("model", (u) => MODEL_PATHS.has(u)) as typeof fetch,
    modelFetchLabel: "synthetic model HTTP (lifecycle test)",
  },
  {
    log: (l) => console.log(l),
    error: (l) => console.log(l),
    exit: (code) => process.exit(code),
  },
);
process.on("SIGINT", () => void running.stop());
process.on("SIGTERM", () => void running.stop());
