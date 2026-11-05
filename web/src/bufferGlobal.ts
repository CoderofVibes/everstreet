// Job 003w-e1: the pinned MyNearWallet module (10.1.4) calls the global `Buffer` in the browser
// (e.g. `Buffer.from(nonce).toString("base64")` in signMessage). Browsers have none, so the pinned
// `buffer` polyfill (6.0.3) is installed before the wallet modules load.

import { Buffer } from "buffer";

const g = globalThis as { Buffer?: unknown };
if (g.Buffer === undefined) g.Buffer = Buffer;
