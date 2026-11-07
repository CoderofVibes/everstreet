// The Sepolia feed registry (scripts/lib/feedRegistry.ts), run in a small EVM written here for the
// opcodes it uses: the constructor stores the first controller; only the controller can publish
// or move the role; after a move the earlier controller's calls revert; anything malformed
// reverts. Call data comes from server/src/evm.ts, the same bytes the asset-key contract builds.

import { describe, expect, it } from "vitest";
import { initCode, RUNTIME, SELECTORS, TOPICS } from "../../scripts/lib/feedRegistry.ts";
import { callData } from "../src/evm.ts";

const M256 = (1n << 256n) - 1n;
interface Ctx {
  code: Buffer;
  data: Buffer;
  caller: bigint;
  value: bigint;
  storage: Map<bigint, bigint>;
}
interface Out {
  ok: boolean;
  ret: Buffer;
  logs: { topic: bigint; data: Buffer }[];
}

function run(c: Ctx): Out {
  const st: bigint[] = [];
  let mem = Buffer.alloc(0);
  const logs: Out["logs"] = [];
  const pop = () => {
    const v = st.pop();
    if (v === undefined) throw new Error("stack underflow");
    return v;
  };
  const grow = (end: number) => {
    if (end > mem.length) mem = Buffer.concat([mem, Buffer.alloc(end - mem.length)]);
  };
  const word = (b: Buffer, off: number) => {
    const w = Buffer.alloc(32);
    b.subarray(off, off + 32).copy(w);
    return BigInt(`0x${w.toString("hex")}`);
  };
  const dests = new Set<number>();
  for (let i = 0; i < c.code.length; i++) {
    const op = c.code[i] as number;
    if (op === 0x5b) dests.add(i);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  let pc = 0;
  for (let steps = 0; steps < 10_000; steps++) {
    const op = c.code[pc] ?? 0;
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      st.push(BigInt(`0x${c.code.subarray(pc + 1, pc + 1 + n).toString("hex")}`));
      pc += 1 + n;
      continue;
    }
    if (op >= 0x80 && op <= 0x8f) {
      st.push(st[st.length - 1 - (op - 0x80)] as bigint);
      pc++;
      continue;
    }
    switch (op) {
      case 0x00:
        return { ok: true, ret: Buffer.alloc(0), logs };
      case 0x03: {
        const a = pop();
        st.push((a - pop()) & M256);
        break;
      }
      case 0x10: {
        const a = pop();
        st.push(a < pop() ? 1n : 0n);
        break;
      }
      case 0x14: {
        const a = pop();
        st.push(a === pop() ? 1n : 0n);
        break;
      }
      case 0x15:
        st.push(pop() === 0n ? 1n : 0n);
        break;
      case 0x1c: {
        const s = pop();
        const v = pop();
        st.push(s >= 256n ? 0n : v >> s);
        break;
      }
      case 0x33:
        st.push(c.caller);
        break;
      case 0x34:
        st.push(c.value);
        break;
      case 0x35:
        st.push(word(c.data, Number(pop())));
        break;
      case 0x36:
        st.push(BigInt(c.data.length));
        break;
      case 0x38:
        st.push(BigInt(c.code.length));
        break;
      case 0x39: {
        const dest = Number(pop());
        const off = Number(pop());
        const len = Number(pop());
        grow(dest + len);
        const chunk = Buffer.alloc(len);
        c.code.subarray(off, off + len).copy(chunk);
        chunk.copy(mem, dest);
        break;
      }
      case 0x51: {
        const off = Number(pop());
        grow(off + 32);
        st.push(word(mem, off));
        break;
      }
      case 0x52: {
        const off = Number(pop());
        const v = pop();
        grow(off + 32);
        Buffer.from(v.toString(16).padStart(64, "0"), "hex").copy(mem, off);
        break;
      }
      case 0x54:
        st.push(c.storage.get(pop()) ?? 0n);
        break;
      case 0x55: {
        const k = pop();
        c.storage.set(k, pop());
        break;
      }
      case 0x57: {
        const dest = Number(pop());
        if (pop() !== 0n) {
          if (!dests.has(dest)) throw new Error("bad jump");
          pc = dest;
          continue;
        }
        break;
      }
      case 0x5b:
        break;
      case 0xa1: {
        const off = Number(pop());
        const len = Number(pop());
        const t = pop();
        grow(off + len);
        logs.push({ topic: t, data: Buffer.from(mem.subarray(off, off + len)) });
        break;
      }
      case 0xf3:
      case 0xfd: {
        const off = Number(pop());
        const len = Number(pop());
        grow(off + len);
        return { ok: op === 0xf3, ret: Buffer.from(mem.subarray(off, off + len)), logs };
      }
      default:
        throw new Error(`opcode 0x${op.toString(16)} at ${pc}`);
    }
    pc++;
  }
  throw new Error("too many steps");
}

const SELLER = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const big = (a: string) => BigInt(a);
const DIGEST = `0x${"ab".repeat(32)}`;

function deployed() {
  const storage = new Map<bigint, bigint>();
  const init = initCode(SELLER);
  const out = run({ code: init, data: Buffer.alloc(0), caller: big(STRANGER), value: 0n, storage });
  expect(out.ok).toBe(true);
  expect(out.ret.equals(RUNTIME)).toBe(true);
  const call = (from: string, data: Uint8Array, value = 0n) =>
    run({ code: RUNTIME, data: Buffer.from(data), caller: big(from), value, storage });
  const read = (s: Buffer) => call(STRANGER, s).ret.toString("hex");
  return { storage, call, read };
}
const pad = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");

describe("feed registry (Sepolia half of the external asset)", () => {
  it("starts with the constructor's controller and no digest", () => {
    const r = deployed();
    expect(r.read(SELECTORS.controller)).toBe(pad(SELLER));
    expect(r.read(SELECTORS.latest)).toBe("0".repeat(64));
  });

  it("lets only the controller publish, with the asset-key contract's call data", () => {
    const r = deployed();
    const data = callData({ kind: "publish", digest: DIGEST.slice(2) });
    expect(r.call(STRANGER, data).ok).toBe(false);
    const ok = r.call(SELLER, data);
    expect(ok.ok).toBe(true);
    expect(ok.logs).toEqual([
      {
        topic: big(`0x${TOPICS.Published.toString("hex")}`),
        data: Buffer.from(DIGEST.slice(2), "hex"),
      },
    ]);
    expect(r.read(SELECTORS.latest)).toBe(DIGEST.slice(2));
  });

  it("moves the role; the earlier controller's calls revert afterwards", () => {
    const r = deployed();
    const move = callData({ kind: "set_controller", to: BUYER.slice(2), from_generation: 1 });
    expect(r.call(BUYER, move).ok).toBe(false);
    const moved = r.call(SELLER, move);
    expect(moved.ok).toBe(true);
    expect(moved.logs[0]?.topic).toBe(big(`0x${TOPICS.ControllerSet.toString("hex")}`));
    expect(r.read(SELECTORS.controller)).toBe(pad(BUYER));
    const publish = callData({ kind: "publish", digest: DIGEST.slice(2) });
    expect(r.call(SELLER, publish).ok).toBe(false);
    expect(r.call(SELLER, move).ok).toBe(false);
    expect(r.call(BUYER, publish).ok).toBe(true);
  });

  it("refuses value, short call data, unknown selectors, dirty or zero addresses", () => {
    const r = deployed();
    const publish = callData({ kind: "publish", digest: DIGEST.slice(2) });
    expect(r.call(SELLER, publish, 1n).ok).toBe(false);
    expect(r.call(SELLER, Buffer.from(publish).subarray(0, 20)).ok).toBe(false);
    expect(r.call(SELLER, Buffer.from("deadbeef", "hex")).ok).toBe(false);
    expect(r.call(SELLER, Buffer.alloc(0)).ok).toBe(false);
    const dirty = Buffer.concat([
      SELECTORS.setController,
      Buffer.alloc(11),
      Buffer.of(1),
      Buffer.from(BUYER.slice(2), "hex"),
    ]);
    expect(r.call(SELLER, dirty).ok).toBe(false);
    const zero = Buffer.concat([SELECTORS.setController, Buffer.alloc(32)]);
    expect(r.call(SELLER, zero).ok).toBe(false);
    expect(r.read(SELECTORS.controller)).toBe(pad(SELLER));
  });
});
