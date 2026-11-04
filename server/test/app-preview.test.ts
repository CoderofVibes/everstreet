// Job 002e: the disposable web app preview's scenario (scripts/lib/appPreview.ts), driven through
// its real API without a listener. SYNTHETIC: a scripted build provider (no model) and NO check
// engine, so a check must say that nothing ran, and nothing may appear as passed.

import { describe, expect, it } from "vitest";
import { appPreview } from "../../scripts/lib/appPreview.ts";

describe("002e web app preview scenario", () => {
  it("two versions exist; a check with no engine says nothing ran; preview needs an explicit unchecked choice", async () => {
    const p = await appPreview({ port: 8858 });
    const s = await p.api.request(`/api/session/as/${p.people.ava}`, { method: "POST" });
    const cookie = (s.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const call = async (path: string, method = "GET", body?: unknown) => {
      const r = await p.api.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // biome-ignore lint/suspicious/noExplicitAny: test reads response fields
      return { status: r.status, body: (await r.json()) as Record<string, any> };
    };
    const list = (await call(`/api/product-projects/${p.projectId}/app-versions`)).body;
    expect(list.versions.map((v: { number: number }) => v.number)).toEqual([2, 1]);
    expect(list.preview_available).toBe(true);
    const v2 = list.versions[0].job_id as string;
    await call(`/api/product-projects/${p.projectId}/app-versions/${v2}/checks`, "POST", {
      idempotency_key: "preview-check-01",
    });
    await p.checkWorker.runNext();
    const checks = (await call(`/api/product-projects/${p.projectId}/app-versions`)).body.checks;
    expect(checks[0]).toMatchObject({
      state: "unavailable",
      failure: { code: "engine_not_configured" },
      isolation_evidence: false,
    });
    const ordinary = await call(
      `/api/product-projects/${p.projectId}/app-versions/${v2}/preview`,
      "POST",
      {},
    );
    expect(ordinary.body.code).toBe("not_checked");
    const unchecked = await call(
      `/api/product-projects/${p.projectId}/app-versions/${v2}/preview`,
      "POST",
      {
        unchecked: true,
      },
    );
    expect(unchecked.body.url).toMatch(/^http:\/\/localhost:8858\/preview\/app\//);
    const doc = await p.api.request(unchecked.body.url.replace("http://localhost:8858", ""));
    expect(doc.headers.get("content-security-policy")).toContain(
      "frame-ancestors http://127.0.0.1:8858",
    );
    expect(await doc.text()).toContain("Lumen Parse API");
  });

  it("002e1 recovery controls: a lost answer after the server acted, failed reads, explicit completion", async () => {
    const p = await appPreview({ port: 8858 });
    const s = await p.site.request(`/api/session/as/${p.people.ava}`, { method: "POST" });
    const cookie = (s.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const call = (path: string, method = "GET", body?: unknown) =>
      p.site.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const request = {
      idempotency_key: "browser-like-0001",
      revision: 1,
      intent: "app",
      instructions: "Add an annual price",
      budget: {
        max_input_tokens: 1000,
        max_output_tokens: 1000,
        max_seconds: 60,
        max_cost_cents: 1,
      },
    };
    p.controls.loseNextGeneration();
    const lost = await call(`/api/product-projects/${p.projectId}/builds`, "POST", request);
    expect(lost.status).toBe(502);
    expect(p.controls.state().queued_generations).toBe(1); // the server acted
    // Recovery with the same key returns that job: still one queued generation.
    const again = await call(`/api/product-projects/${p.projectId}/builds`, "POST", request);
    expect(again.status).toBe(200);
    const id = ((await again.json()) as { job: { id: string } }).job.id;
    expect(p.controls.state().queued_generations).toBe(1);
    p.controls.failReads(2);
    expect((await call(`/api/builds/${id}`)).status).toBe(503);
    expect((await call(`/api/product-projects/${p.projectId}/app-versions`)).status).toBe(503);
    expect((await call(`/api/builds/${id}`)).status).toBe(200);
    expect(await p.controls.completeGeneration()).toBe(id);
    const done = (await (await call(`/api/builds/${id}`)).json()) as { job: { state: string } };
    expect(done.job.state).toBe("succeeded");
    expect(p.controls.state().queued_generations).toBe(0);
  });
});
