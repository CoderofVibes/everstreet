// Job 002e, guest, UNTRUSTED CONTEXT. Started by the supervisor for exactly one check case, as
// uid 1000 (`app`) with no capabilities and no_new_privs, inside the guest cgroup `untrusted`,
// under prlimit, with a per-step kill. It imports only that case's logic module, calls the
// named export with the input from stdin, and prints one JSON line: the returned value. It never
// sees the expected value, cannot open the output drive (root 0600), and its output is only that
// case's value: the supervisor parses and compares it.
//
// argv: <module path relative to /work/app> <export name>

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [modulePath, exportName] = process.argv.slice(2);
const input = JSON.parse(readFileSync(0, "utf8") || "null");
const url = pathToFileURL(`/work/app/${modulePath}`).href;
let mod;
try {
  mod = await import(url);
} catch (e) {
  process.stderr.write(`module_load_failed: ${String(e?.message ?? e).slice(0, 300)}\n`);
  process.exit(2);
}
const fn = mod[exportName];
if (typeof fn !== "function") {
  process.stderr.write(`not_a_function: ${exportName}\n`);
  process.exit(3);
}
const value = await fn(input);
process.stdout.write(`${JSON.stringify(value === undefined ? null : value)}\n`);
