// Job 003s: an in-memory v3 view transport over the contract-produced fixtures
// (server/test/fixtures/v3), for app tests and the disposable acquisition preview. It answers any
// account with the current views at its current final block; nothing reaches a network. States
// other than the fixtures' own are SYNTHETIC edits, labelled where they are built.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BlockRef, V3ReadError, type ViewTransport } from "../src/v3read.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const v3Fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", "v3", `${name}.json`), "utf8")) as Record<
    string,
    string
  >;

/** Contract fixtures: the same deal (seq 1, version 1, this digest) live, then closed. */
export const V3_ACCEPTING = v3Fixture("direct-accepting");
export const V3_CLOSED = v3Fixture("direct-closed");
export const V3_DIGEST = "aa53a9ad33a13ba3e609344b36591db8339482e852a6044a52d1cbda5b68dda4";

// biome-ignore lint/suspicious/noExplicitAny: fixture edits reach deep fields
type Json = Record<string, any>;

/** Edits one view of a fixture copy (synthetic; label each use). */
export function editView(views: Record<string, string>, method: string, f: (v: Json) => void) {
  const v = JSON.parse(views[method] as string);
  f(v);
  return { ...views, [method]: JSON.stringify(v) };
}

/**
 * Synthetic, coherent: the same deal one control step earlier, funded by the buyer but accepted
 * by nobody yet (escrow unchanged, so the treasury still agrees).
 */
export const V3_PROPOSED = editView(V3_ACCEPTING, "get_control", (c) => {
  c.control_seq = "5";
  c.live_deal.state = "proposed";
  c.live_deal.seller_accepted = false;
  c.live_deal.buyer_accepted = false;
});

/** Synthetic, coherent: the deal ended unsold (control stays with the seller at generation 1). */
export const v3Ended = (status: "cancelled" | "expired" | "aborted") =>
  editView(
    editView(V3_CLOSED, "get_outcomes", (os) => {
      os[0].status = status;
      os[0].generation_after = 1;
    }),
    "get_control",
    (c) => {
      c.owner = "founder.near";
      c.generation = 1;
      c.operators = [["meter.near", 1, 1]];
    },
  );

export const hashAt = (h: number, v = "S") => `${v}${String(h).replace(/0/g, "z")}`.padEnd(44, "x");

export class FixtureV3Transport implements ViewTransport {
  readonly network = "testnet";
  height = 5_000;
  at: BlockRef = { height: "5000", hash: hashAt(5000) };
  views: Record<string, string> = { ...V3_ACCEPTING };
  /** The next read fails like an unreachable endpoint (once). */
  failNext = 0;
  /** Ceiling on reads, independent of any test's own loop. */
  reads = 0;
  readonly ceiling = 500;

  async finalBlock(): Promise<BlockRef> {
    if (++this.reads > this.ceiling) throw new Error("v3 fixture transport ceiling reached");
    if (this.failNext > 0) {
      this.failNext--;
      throw new V3ReadError("unavailable", "fixture: endpoint unavailable");
    }
    return this.at;
  }

  async view(input: Parameters<ViewTransport["view"]>[0]) {
    const key = input.method === "get_period" ? `get_period:${input.args.yyyymm}` : input.method;
    const result = this.views[key];
    if (result === undefined) throw new V3ReadError("execution_failed", `no fixture for ${key}`);
    return { result, block: input.block };
  }

  /** Moves to a new final block with these views (the chain moved on). */
  next(views: Record<string, string>) {
    this.height += 1;
    this.at = { height: String(this.height), hash: hashAt(this.height) };
    this.views = views;
  }

  /** The same height answered with other content: a genuine, sticky conflict. */
  conflictAtSameHeight(views: Record<string, string>) {
    this.at = { height: this.at.height, hash: hashAt(Number(this.at.height), "C") };
    this.views = views;
  }
}
