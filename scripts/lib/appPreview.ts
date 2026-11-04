// Job 002e: the in-memory scenario behind scripts/preview-app.ts, kept apart from any listener so a
// test can drive it through the real API without a network.
//
// FICTIONAL and SYNTHETIC: an in-memory database and the real app. One founder, Ava, with a
// digital product whose two web app versions (a fictional API plan estimator, then a cheaper
// Priority rate) were made through the REAL build API by a SCRIPTED build provider (labelled; no
// model, no spend). Logic checks use the REAL worker; its engine is the real WSL/Firecracker
// adapter only when a distro is named explicitly, otherwise none: checks then say "Isolated worker
// unavailable: nothing ran". There is no test-double engine here, so nothing is shown as passed.
// Preview is served on a separate site (localhost vs 127.0.0.1).

import { everstreetApi } from "../../server/src/app.ts";
import { AppChecks } from "../../server/src/appChecks.ts";
import { AppCheckWorker } from "../../server/src/appCheckWorker.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../../server/src/build.ts";
import { Builds, BuildWorker } from "../../server/src/builds.ts";
import { openDb } from "../../server/src/db.ts";
import { Store } from "../../server/src/store.ts";
import { WslFirecrackerEngine } from "../../server/src/workerEngine.ts";
import { QUOTE_BUNDLE, QUOTE_BUNDLE_V2 } from "../../server/test/app-fixtures.ts";
import { labelScript } from "./customerPreview.ts";

/** SCRIPTED build provider (preview only): returns the next fictional bundle; no model, no spend. */
class ScriptedApps implements BuildProvider {
  readonly id = "preview-scripted";
  next: unknown[] = [QUOTE_BUNDLE, QUOTE_BUNDLE_V2];
  identity() {
    return { id: this.id, model: "scripted (preview)", version: "1" };
  }
  availability() {
    return { available: true, provider: this.id, reason: "Preview: a scripted provider, no model" };
  }
  pricing() {
    return { inputCentsPerMillionTokens: 0, outputCentsPerMillionTokens: 0 };
  }
  start(_req: BuildRequest): AsyncIterable<BuildEvent> {
    const artifact = this.next.length > 1 ? this.next.shift() : this.next[0];
    return (async function* () {
      yield { type: "progress", message: "Preview: a scripted bundle" } as BuildEvent;
      yield { type: "output", artifact } as BuildEvent;
      yield { type: "usage_final", inputTokens: 0, outputTokens: 0 } as BuildEvent;
    })();
  }
}

export async function appPreview(opts: { port: number; wslDistro?: string }) {
  const store = new Store(openDb(":memory:"));
  const provider = new ScriptedApps();
  const builds = new Builds(store.db, store, provider, { operatorCeilingCents: 1000 });
  const checks = new AppChecks(store.db, store);
  const engine = opts.wslDistro ? new WslFirecrackerEngine({ distro: opts.wslDistro }) : null;
  const api = everstreetApi(store, {
    localPreview: true,
    environment: "preview",
    buildProvider: provider,
    builds,
    appChecks: checks,
    previewOrigin: `http://localhost:${opts.port}`,
    platformOrigin: `http://127.0.0.1:${opts.port}`,
  });
  api.get("/__preview/label.js", (c) =>
    c.body(
      labelScript({
        label: "Preview only: synthetic web app versions",
        detail: opts.wslDistro
          ? `Scripted generation (no model). Logic checks use the real isolated worker in WSL "${opts.wslDistro}".`
          : "Scripted generation (no model). No isolated worker is configured: checks say nothing ran.",
      }),
      200,
      { "content-type": "text/javascript; charset=utf-8" },
    ),
  );
  const join = async (name: string) => {
    const r = await api.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const id = ((await r.json()) as { person: { id: string } }).person.id;
    return Object.assign(
      async (path: string, method = "GET", body?: unknown) => {
        const res = await api.request(path, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
        });
        // biome-ignore lint/suspicious/noExplicitAny: preview setup reads response fields
        return { status: res.status, body: (await res.json()) as Record<string, any> };
      },
      { id },
    );
  };
  const ava = await join("Ava Chen");
  const p = (
    await ava("/api/product-projects", "POST", {
      idea: "A monthly plan estimator for a fictional document-parsing API",
      foundation: "saas_workflow",
    })
  ).body;
  const projectId = p.project.id as string;
  await ava(`/api/businesses/${p.project.business_id}/build-budget`, "PUT", { limit_cents: 100 });
  const worker = new BuildWorker(builds, provider, { id: "preview-build" });
  const budget = {
    max_input_tokens: 1000,
    max_output_tokens: 1000,
    max_seconds: 60,
    max_cost_cents: 1,
  };
  const v1 = await ava(`/api/product-projects/${projectId}/builds`, "POST", {
    idempotency_key: "preview-app-0001",
    revision: 1,
    intent: "app",
    instructions: "A plan estimator: requests per month and support level give a monthly price",
    budget,
  });
  await worker.runNext();
  await ava(`/api/product-projects/${projectId}/builds`, "POST", {
    idempotency_key: "preview-app-0002",
    revision: 1,
    intent: "app",
    instructions: "Make Priority support 40 cents per thousand requests",
    base_job: v1.body.job.id,
    budget,
  });
  await worker.runNext();
  // The real check worker: one at a time, polled while the preview runs.
  const checkWorker = new AppCheckWorker(checks, engine, { id: "preview-checks" });
  checkWorker.recover();
  return { api, projectId, people: { ava: ava.id }, builds: { worker }, checkWorker };
}
