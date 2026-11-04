// Job 002e: the raw-drive frame shared by the host launcher and the guest supervisor
// (scripts/worker-host/guest/wire.mjs). The host never mounts a guest-written filesystem; it
// reads one frame from a raw drive image. Anything malformed must be an error, never a partial
// or guessed value.

import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs module shared with the guest, without type declarations
import { decodeFrame, encodeFrame } from "../../scripts/worker-host/guest/wire.mjs";

const drive = (frame: Buffer, size = 4096) => {
  const b = Buffer.alloc(size);
  frame.copy(b);
  return b;
};

describe("002e worker drive frame", () => {
  it("round-trips a value through a zero-padded drive image", () => {
    const v = { check_id: "x", cases: [{ id: "a", passed: true }] };
    expect(decodeFrame(drive(encodeFrame(v, 65536)), 65536)).toEqual(v);
  });

  it("refuses to encode past the limit", () => {
    expect(() => encodeFrame({ s: "x".repeat(100) }, 50)).toThrow(/larger than 50/);
  });

  it("refuses an empty drive, a missing marker, an oversize claim and a truncated frame", () => {
    expect(() => decodeFrame(Buffer.alloc(4096), 65536)).toThrow(/no frame marker/);
    expect(() => decodeFrame(Buffer.alloc(4), 65536)).toThrow(/no frame/);
    const big = encodeFrame({ s: "y".repeat(1000) }, 65536);
    expect(() => decodeFrame(drive(big), 100)).toThrow(/more than 100/);
    expect(() => decodeFrame(big.subarray(0, big.length - 10), 65536)).toThrow(/truncated/);
  });

  it("refuses invalid UTF-8 and invalid JSON instead of guessing", () => {
    const head = Buffer.from("ESW1\0\0\0\u0002", "latin1");
    expect(() =>
      decodeFrame(drive(Buffer.concat([head, Buffer.from([0xc3, 0x28])])), 65536),
    ).toThrow();
    const notJson = Buffer.concat([
      Buffer.from("ESW1", "ascii"),
      Buffer.from([0, 0, 0, 3]),
      Buffer.from("{x}"),
    ]);
    expect(() => decodeFrame(drive(notJson), 65536)).toThrow();
  });
});
