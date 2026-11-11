// The static proof copy's data files (scripts/build-proof-site.ts) are the server's own public
// projections written to disk. The build refuses key or token material; this pins the same check,
// and a few more (local paths, loopback hosts, environment values), on the projections themselves,
// so a leak is caught in the test run and not only when someone builds the copy (Nov 7 second pass).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attackSuite, ledgerlineExample } from "../src/examples.ts";
import { SECRETISH } from "../src/rehearsalRecord.ts";

const PRIVATE = [
  SECRETISH,
  /[A-Za-z]:\|\/Users\/|\/home\/|C:\/Dev/,
  /localhost|127\.0\.0\.1|\[::1\]/,
  /near-credentials|evm-credentials|private_key|sk-[A-Za-z0-9]{10,}/i,
];

describe("the static proof copy's data", () => {
  for (const [name, make] of [
    ["ledgerline.json", ledgerlineExample],
    ["attacks.json", attackSuite],
  ] as const) {
    it(`${name} carries nothing private`, () => {
      const text = JSON.stringify(make());
      expect(text.length).toBeGreaterThan(1000);
      for (const re of PRIVATE) expect(text, String(re)).not.toMatch(re);
    });
  }

  // The guided tour's recording of the demo (scripts/record-tour.ts) ships as it is committed.
  it("the tour recording carries nothing private, and only the demo's fictional viewers", () => {
    const text = readFileSync("data/tour/recording.json", "utf8");
    expect(text.length).toBeGreaterThan(100_000);
    for (const re of PRIVATE) expect(text, String(re)).not.toMatch(re);
    const rec = JSON.parse(text) as {
      format: string;
      viewers: Record<string, { reads: Record<string, { account?: string }> }>;
    };
    expect(rec.format).toBe("everstreet.tour-recording");
    expect(
      Object.fromEntries(
        Object.entries(rec.viewers).map(([k, v]) => [k, v.reads["/api/me"]?.account]),
      ),
    ).toEqual({
      delphine: "delphine.near",
      cara: "cara.near",
      noah: "buyer.near",
      agent: "signalwatch-agent.demo.near",
      "noah-closed": "buyer.near",
      "noah-after": "buyer.near",
      "delphine-after": "delphine.near",
      "cara-after": "cara.near",
    });
  });
});
