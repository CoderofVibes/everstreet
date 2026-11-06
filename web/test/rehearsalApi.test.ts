// Job 006c: the browser checks rehearsal answers before showing them; an unknown state or step
// outcome is refused as malformed (never shown as passed).

import { afterEach, describe, expect, it, vi } from "vitest";
import { MalformedAnswer } from "../src/customerApi.ts";
import { rehearsalApi } from "../src/rehearsalApi.ts";

const answer = (body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
afterEach(() => vi.unstubAllGlobals());

const rehearsal = {
  id: "r1",
  state: "passed",
  detail: "",
  started_at: "2026-11-05T00:00:00Z",
  finished_at: "2026-11-05T00:00:05Z",
  steps: [
    {
      n: 1,
      key: "rebuild",
      title: "Rebuild",
      expected: "Same digest",
      outcome: "passed",
      observed: "Match",
    },
  ],
  dependencies: [
    {
      key: "external",
      label: "Hosting",
      responsibility: "external",
      note: "Pending",
      status: "pending_external",
      observed: "",
    },
  ],
  outcome: { result: "passed", summary: "ok", boundaries: "Synthetic." },
  record_digest: "a".repeat(64),
};
const list = {
  available: true,
  unavailable_reason: null,
  product: {
    kind: "workflow_spec",
    artifact_digest: "b".repeat(64),
    supported: true,
    reason: null,
  },
  rehearsals: [rehearsal],
};

describe("rehearsal answers", () => {
  it("parses a list with a finished rehearsal", async () => {
    answer(list);
    const v = await rehearsalApi.list("b1");
    expect(v.rehearsals[0]?.steps[0]?.outcome).toBe("passed");
    expect(v.rehearsals[0]?.dependencies[0]?.status).toBe("pending_external");
  });
  it("refuses an unknown state or step outcome", async () => {
    answer({ ...list, rehearsals: [{ ...rehearsal, state: "green" }] });
    await expect(rehearsalApi.list("b1")).rejects.toBeInstanceOf(MalformedAnswer);
    answer({
      ...list,
      rehearsals: [{ ...rehearsal, steps: [{ ...rehearsal.steps[0], outcome: "ok" }] }],
    });
    await expect(rehearsalApi.list("b1")).rejects.toBeInstanceOf(MalformedAnswer);
  });
});
