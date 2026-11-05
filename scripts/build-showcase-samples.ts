// Writes web/src/showcase/samples.json and relaydesk.json (docs/design/SHOWCASE_SPEC.md §2). Run after changing the
// required evaluation cases, the stand-in's answers or the validation step:
//   npx tsx scripts/build-showcase-samples.ts
import { writeFileSync } from "node:fs";
import { relaydeskJson } from "./lib/relaydeskSamples.ts";
import { samplesJson } from "./lib/showcaseSamples.ts";

writeFileSync("web/src/showcase/samples.json", await samplesJson());
console.log("wrote web/src/showcase/samples.json");
writeFileSync("web/src/showcase/relaydesk.json", relaydeskJson());
console.log("wrote web/src/showcase/relaydesk.json");
