// The light-client proof of the recorded testnet close (data/evidence/light-client-close.json):
// both the closing transaction and the business contract's closing receipt prove into their
// block's outcome root, the block's header hashes to that block, and the block proves into the
// later head's block merkle root. Any change to the outcome, the header or the paths is caught.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyLightClientProof } from "../src/lightClient.ts";

// biome-ignore lint/suspicious/noExplicitAny: recorded RPC JSON
type Json = any;
const ev = JSON.parse(readFileSync("data/evidence/light-client-close.json", "utf8")) as Json;
const clone = <T>(x: T): T => structuredClone(x);

describe("light-client proof of the close", () => {
  it("the recorded transaction and closing receipt both prove against the head", () => {
    const a = verifyLightClientProof(ev.transaction.proof, ev.head);
    const b = verifyLightClientProof(ev.receipt.proof, ev.head);
    expect(a).toMatchObject({ ok: true, problems: [] });
    expect(a.block.height).toBe(276581442);
    expect(b).toMatchObject({ ok: true, block: { height: 276581443 } });
    expect(b.status).toEqual({ SuccessValue: Buffer.from('"closed"').toString("base64") });
  });

  it("a changed outcome, log, header or path doesn't prove", () => {
    const status = clone(ev.receipt.proof);
    status.outcome_proof.outcome.status = {
      SuccessValue: Buffer.from('"aborted"').toString("base64"),
    };
    expect(verifyLightClientProof(status, ev.head).problems).toContain(
      "the outcome doesn't prove into the block's outcome root",
    );
    const log = clone(ev.receipt.proof);
    log.outcome_proof.outcome.logs[0] = log.outcome_proof.outcome.logs[0].replace(
      "buyer",
      "someone",
    );
    expect(verifyLightClientProof(log, ev.head).ok).toBe(false);
    const header = clone(ev.receipt.proof);
    header.block_header_lite.inner_lite.height += 1;
    expect(verifyLightClientProof(header, ev.head).problems).toContain(
      "the block header isn't the block the outcome names",
    );
    const path = clone(ev.receipt.proof);
    path.block_proof[0].direction = path.block_proof[0].direction === "Left" ? "Right" : "Left";
    expect(verifyLightClientProof(path, ev.head).problems).toContain(
      "the block doesn't prove into the head's block merkle root",
    );
    expect(
      verifyLightClientProof(ev.receipt.proof, { ...ev.head, block_merkle_root: ev.head.hash }).ok,
    ).toBe(false);
  });
});
