// Job 003j: the disposable preview's scenario, driven through the real API in memory (no
// listener, no network), so the states promised for browser review are actually there.

import { describe, expect, it } from "vitest";
import { continuityPreview } from "../../scripts/lib/continuityPreview.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

async function as(p: Awaited<ReturnType<typeof continuityPreview>>, token: string) {
  return async (path: string, method = "GET", body?: unknown) => {
    const res = await p.app.request(path, {
      method,
      headers: { cookie: `es_session=${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Json };
  };
}

describe("003j the preview offers every state for review", () => {
  it("has fresh, stale+mismatch+conflict, closing, unknown+gap, never-read and unbound businesses", async () => {
    const p = await continuityPreview();
    const m = await as(p, p.maraToken);
    const get = async (id: string) => (await m(`/api/businesses/${id}/v3`)).body;
    expect(await get(p.ids.ledger)).toMatchObject({
      state: "observed",
      owner_match: "matches",
      flag: null,
      periods: [expect.objectContaining({ yyyymm: 202611 })],
      control: { live_deal: { state: "accepting" } },
    });
    const harbor = await get(p.ids.harbor);
    expect(harbor).toMatchObject({
      state: "observed",
      owner_match: "mismatch",
      flag: { code: "conflict" },
    });
    expect(Date.parse(harbor.served_at) - Date.parse(harbor.observed_at)).toBeGreaterThan(
      harbor.stale_after_ms,
    );
    expect(await get(p.ids.quay)).toMatchObject({
      control: { close_mode: "gated", live_deal: { state: "closing" } },
    });
    expect(await get(p.ids.tide)).toMatchObject({
      owner_match: "unknown_mapping",
      history: { complete: false, missing_count: "2" },
    });
    expect(await get(p.ids.quill)).toMatchObject({
      state: "never_observed",
      transport: "configured",
    });
    expect(await get(p.ids.north)).toMatchObject({ state: "unbound" });
    // An unrelated person is refused.
    const n = await as(p, p.noahToken);
    expect((await n(`/api/businesses/${p.ids.ledger}/v3`)).status).toBe(404);
  });

  it("its transport modes give honest refusals without changing the evidence; the transfer control ends access", async () => {
    const p = await continuityPreview({ timeoutMs: 50 });
    const m = await as(p, p.maraToken);
    const before = (await m(`/api/businesses/${p.ids.ledger}/v3`)).body;
    for (const [mode, code] of [
      ["offline", "unavailable"],
      ["slow", "timeout"],
      ["block_unavailable", "block_unavailable"],
    ] as const) {
      p.transport.mode = mode;
      expect((await m(`/api/businesses/${p.ids.ledger}/v3/refresh`, "POST")).body).toMatchObject({
        outcome: "refused",
        code,
      });
    }
    p.transport.mode = "ok";
    const after = (await m(`/api/businesses/${p.ids.ledger}/v3`)).body;
    expect(after.observed_at).toBe(before.observed_at);
    expect(after.block).toEqual(before.block);
    expect(
      (await m(`/api/businesses/${p.ids.ledger}/v3/refresh`, "POST", { period: 202610 })).body,
    ).toMatchObject({
      outcome: "accepted",
      period: { yyyymm: 202610, outcome: "accepted" },
    });
    p.transfer(p.ids.ledger);
    expect((await m(`/api/businesses/${p.ids.ledger}/v3`)).status).toBe(404);
  });

  it("the paused variant pauses only the v3 capability", async () => {
    const p = await continuityPreview({ paused: true });
    const m = await as(p, p.maraToken);
    expect((await m(`/api/businesses/${p.ids.ledger}/v3`)).body).toMatchObject({
      state: "paused",
      code: "format_upgrade_failed",
    });
    expect((await m("/api/product-projects")).status).toBe(200);
  });
});
