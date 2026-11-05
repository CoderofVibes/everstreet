// Job 003x: verify a downloaded Everstreet handover record OFFLINE, on any computer:
//   npx tsx scripts/verify-handover-record.ts <record.json>
// Reads only the named file (bounded); no network, database or URLs. Exit 0 only if it verifies.
import { readFileSync, statSync } from "node:fs";
import { RECORD_MAX_BYTES, verifyRecord } from "../server/src/handoverVerify.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx scripts/verify-handover-record.ts <record.json>");
  process.exit(2);
}
if (statSync(file).size > RECORD_MAX_BYTES) {
  console.error(`refused: larger than ${RECORD_MAX_BYTES} bytes`);
  process.exit(1);
}
const v = verifyRecord(readFileSync(file, "utf8"));
console.log(JSON.stringify(v, null, 2));
process.exit(v.ok ? 0 : 1);
