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

const config = validateConfig(JSON.parse(readFileSync(process.argv[2] as string, "utf8")));
const standIn = new SyntheticModel();
const running = runServer(
  config,
  {
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
});
process.on("SIGINT", () => void running.stop());
process.on("SIGTERM", () => void running.stop());
process.on("disconnect", () => void running.stop());
