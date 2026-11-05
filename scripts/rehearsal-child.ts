// business-v3 testnet rehearsal launcher (V3_TESTNET_APPROVAL_PACKET.md): the app's NORMAL entry
// (serve.ts runServer -> composeApplication, configured mode) against the REAL testnet RPC named in
// the configuration. Only the AI model is replaced, by the labelled stand-in (scripted answers; no
// provider is called and nothing is spent on inference). Started by scripts/v3-rehearsal.ts with
// an IPC channel; "shutdown" stops it the same way as SIGINT.
//   node --import tsx scripts/rehearsal-child.ts <config.json>

import { readFileSync } from "node:fs";
import { validateConfig } from "../server/src/appConfig.ts";
import { runServer } from "../server/src/serve.ts";
import { SyntheticModel } from "../server/test/lifecycleWorld.ts";

// Example 3's fault (TEST-ONLY, this launcher only; never the application): when the parent sends
// "arm-drop", the next JSON-RPC "tx" lookup really reaches the chain, and then the app is handed a
// failed connection instead of its answer (as if the reply were lost on the way back). Once.
let dropArmed = false;
const rpcFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const res = await fetch(input, init);
  if (dropArmed) {
    let method = "";
    try {
      method = String((JSON.parse(String(init?.body ?? "")) as { method?: string }).method);
    } catch {}
    if (method === "tx") {
      dropArmed = false;
      await res.arrayBuffer().catch(() => undefined); // the chain answered; the answer is lost
      process.send?.({ type: "dropped", method });
      throw new TypeError(
        "fetch failed (rehearsal fault: the transaction-status answer was dropped)",
      );
    }
  }
  return res;
}) as typeof fetch;

const config = validateConfig(JSON.parse(readFileSync(process.argv[2] as string, "utf8")));
const standIn = new SyntheticModel();
const running = runServer(
  config,
  {
    fetch: rpcFetch as never,
    fetchLabel: "testnet RPC (rehearsal launcher; one-time answer drop only when armed)",
    modelFetch: standIn.fetch(),
    modelFetchLabel: "stand-in model (scripted answers; no AI provider called)",
  },
  {
    log: (l) => console.log(l),
    error: (l) => console.log(l),
    exit: (code) => process.exit(code),
  },
);
process.on("message", (m: { type?: string }) => {
  if (m?.type === "shutdown") void running.stop();
  if (m?.type === "arm-drop") dropArmed = true;
});
process.on("SIGINT", () => void running.stop());
process.on("SIGTERM", () => void running.stop());
process.on("disconnect", () => void running.stop());
