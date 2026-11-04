// Job 002e: the length-prefixed frame used on the worker's raw drives (no filesystem is ever
// mounted by the host). Shared by the host launcher and the guest supervisor; unit-tested in
// server/test/worker-wire.test.ts. A frame is "ESW1" + 4-byte big-endian length + UTF-8 JSON.

export const MAGIC = Buffer.from("ESW1", "ascii");

/** Encodes one JSON value as a frame, refusing anything larger than `max` payload bytes. */
export function encodeFrame(value, max) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > max) throw new Error(`frame larger than ${max} bytes`);
  const head = Buffer.alloc(8);
  MAGIC.copy(head, 0);
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

/**
 * Decodes the first frame of a raw drive image. Anything malformed (no magic, a length past the
 * limit or past the bytes present, invalid UTF-8 or JSON) is an error, never a partial value.
 */
export function decodeFrame(buf, max) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) throw new Error("no frame");
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("no frame marker");
  const len = buf.readUInt32BE(4);
  if (len > max) throw new Error(`frame claims ${len} bytes, more than ${max}`);
  if (8 + len > buf.length) throw new Error("frame is truncated");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(8, 8 + len));
  return JSON.parse(text);
}
