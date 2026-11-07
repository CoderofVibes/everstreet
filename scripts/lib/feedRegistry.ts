// The synthetic feed registry for the external-asset run on an EVM testnet (Sepolia): one
// `controller` role and the last published digest. It is the other chain's half of
// contracts/asset-key, assembled here opcode by opcode (no compiler, no download), so every byte
// is in this file and its test (server/test/feed-registry.test.ts runs it in a small EVM).
//
//   controller() -> address        anyone
//   latest() -> bytes32            anyone
//   publish(bytes32)               controller only; emits Published(bytes32)
//   setController(address)         controller only; nonzero address; emits ControllerSet(address)
//
// Anything else, any value sent, short call data or a caller that isn't the controller reverts.
// The constructor takes the first controller as its one 32-byte argument.

import { keccak_256 } from "@noble/hashes/sha3.js";

const sel = (sig: string) => Buffer.from(keccak_256(new TextEncoder().encode(sig))).subarray(0, 4);
const topic = (sig: string) => Buffer.from(keccak_256(new TextEncoder().encode(sig)));

export const SELECTORS = {
  controller: sel("controller()"),
  latest: sel("latest()"),
  publish: sel("publish(bytes32)"),
  setController: sel("setController(address)"),
};
export const TOPICS = {
  Published: topic("Published(bytes32)"),
  ControllerSet: topic("ControllerSet(address)"),
};

const OP = {
  STOP: 0x00,
  SUB: 0x03,
  LT: 0x10,
  EQ: 0x14,
  ISZERO: 0x15,
  SHR: 0x1c,
  CALLER: 0x33,
  CALLVALUE: 0x34,
  CALLDATALOAD: 0x35,
  CALLDATASIZE: 0x36,
  CODESIZE: 0x38,
  CODECOPY: 0x39,
  MLOAD: 0x51,
  MSTORE: 0x52,
  SLOAD: 0x54,
  SSTORE: 0x55,
  JUMPI: 0x57,
  JUMPDEST: 0x5b,
  DUP1: 0x80,
  LOG1: 0xa1,
  RETURN: 0xf3,
  REVERT: 0xfd,
} as const;

type Item = number | Buffer | { label: string } | { at: string };

/** PUSHn of `bytes` (1..32). */
const push = (bytes: Buffer | number[]): Buffer => {
  const b = Buffer.from(bytes);
  return Buffer.concat([Buffer.of(0x5f + b.length), b]);
};
const p1 = (v: number) => push([v]);

/** Two-pass assembly: labels are JUMPDESTs, `{at}` is a PUSH2 of a label's offset. */
function assemble(items: Item[]): Buffer {
  const size = (i: Item) =>
    typeof i === "number" ? 1 : Buffer.isBuffer(i) ? i.length : "label" in i ? 1 : 3;
  const where = new Map<string, number>();
  let pc = 0;
  for (const i of items) {
    if (typeof i === "object" && !Buffer.isBuffer(i) && "label" in i) where.set(i.label, pc);
    pc += size(i);
  }
  return Buffer.concat(
    items.map((i) => {
      if (typeof i === "number") return Buffer.of(i);
      if (Buffer.isBuffer(i)) return i;
      if ("label" in i) return Buffer.of(OP.JUMPDEST);
      const to = where.get(i.at);
      if (to === undefined) throw new Error(`no label ${i.at}`);
      return Buffer.of(0x61, to >> 8, to & 0xff);
    }),
  );
}

/** Reverts unless the caller is the controller and the call data holds one 32-byte word. */
const guarded: Item[] = [
  p1(0x24),
  OP.CALLDATASIZE,
  OP.LT,
  { at: "revert" },
  OP.JUMPI,
  p1(0),
  OP.SLOAD,
  OP.CALLER,
  OP.EQ,
  OP.ISZERO,
  { at: "revert" },
  OP.JUMPI,
];

export const RUNTIME = assemble([
  OP.CALLVALUE,
  { at: "revert" },
  OP.JUMPI,
  p1(0),
  OP.CALLDATALOAD,
  p1(0xe0),
  OP.SHR,
  ...(
    [
      ["controller", "get_controller"],
      ["latest", "get_latest"],
      ["publish", "publish"],
      ["setController", "set_controller"],
    ] as const
  ).flatMap(([name, label]): Item[] => [
    OP.DUP1,
    push(SELECTORS[name]),
    OP.EQ,
    { at: label },
    OP.JUMPI,
  ]),
  { label: "revert" },
  p1(0),
  OP.DUP1,
  OP.REVERT,
  // controller() / latest(): one storage word.
  { label: "get_controller" },
  p1(0),
  OP.SLOAD,
  p1(0),
  OP.MSTORE,
  p1(0x20),
  p1(0),
  OP.RETURN,
  { label: "get_latest" },
  p1(1),
  OP.SLOAD,
  p1(0),
  OP.MSTORE,
  p1(0x20),
  p1(0),
  OP.RETURN,
  // publish(bytes32 digest): slot 1 = digest; Published(digest).
  { label: "publish" },
  ...guarded,
  p1(4),
  OP.CALLDATALOAD,
  OP.DUP1,
  p1(1),
  OP.SSTORE,
  p1(0),
  OP.MSTORE,
  push(TOPICS.Published),
  p1(0x20),
  p1(0),
  OP.LOG1,
  OP.STOP,
  // setController(address to): a clean nonzero address; slot 0 = to; ControllerSet(to).
  { label: "set_controller" },
  ...guarded,
  p1(4),
  OP.CALLDATALOAD,
  OP.DUP1,
  p1(0xa0),
  OP.SHR,
  { at: "revert" },
  OP.JUMPI,
  OP.DUP1,
  OP.ISZERO,
  { at: "revert" },
  OP.JUMPI,
  OP.DUP1,
  p1(0),
  OP.SSTORE,
  p1(0),
  OP.MSTORE,
  push(TOPICS.ControllerSet),
  p1(0x20),
  p1(0),
  OP.LOG1,
  OP.STOP,
]);

/** Creation code: slot 0 = the last 32 bytes of the code (the constructor argument). */
export function initCode(controller: string): Buffer {
  if (!/^0x[0-9a-fA-F]{40}$/.test(controller)) throw new Error("controller isn't an address");
  const head = (offset: number) =>
    assemble([
      p1(0x20),
      OP.DUP1,
      OP.CODESIZE,
      OP.SUB,
      p1(0),
      OP.CODECOPY,
      p1(0),
      OP.MLOAD,
      p1(0),
      OP.SSTORE,
      push([RUNTIME.length >> 8, RUNTIME.length & 0xff]),
      OP.DUP1,
      push([offset >> 8, offset & 0xff]),
      p1(0),
      OP.CODECOPY,
      p1(0),
      OP.RETURN,
    ]);
  const offset = head(0).length;
  const arg = Buffer.concat([Buffer.alloc(12), Buffer.from(controller.slice(2), "hex")]);
  return Buffer.concat([head(offset), RUNTIME, arg]);
}
