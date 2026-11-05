// Shared fixtures for the managed runtime tests (job 002c). Fictional data only. Artifacts are
// produced by the real build pipeline from a scripted build provider; the runtime provider is a
// scripted double. Nothing here calls a model or the network.

import { everstreetApi } from "../src/app.ts";
import type { ExtractionSpec } from "../src/artifacts.ts";
import type { BuildEvent, BuildProvider, BuildRequest } from "../src/build.ts";
import { Builds, BuildWorker } from "../src/builds.ts";
import { openDb } from "../src/db.ts";
import { ManagedRuntime, type RuntimeOptions } from "../src/invocations.ts";
import type { RuntimeProvider, RuntimeRequest, RuntimeUsage } from "../src/runtime.ts";
import { Store } from "../src/store.ts";

export const INVOICE_SPEC: ExtractionSpec = {
  kind: "extraction_spec",
  schema_version: 1,
  name: "Invoice reader",
  input: { kind: "document_text", max_chars: 8000 },
  fields: [
    { key: "vendor", label: "Vendor", type: "text", required: true, description: "" },
    {
      key: "invoice_number",
      label: "Invoice number",
      type: "text",
      required: true,
      description: "",
    },
    { key: "invoice_date", label: "Invoice date", type: "date", required: true, description: "" },
    { key: "total", label: "Total", type: "number", required: true, description: "" },
    { key: "currency", label: "Currency", type: "text", required: false, description: "" },
    { key: "due_date", label: "Due date", type: "date", required: false, description: "" },
  ],
  instructions: "Read one invoice.",
  examples: [
    {
      input: "Fictional invoice A-1 from Alder Supply, 2026-10-01, total 10.00 USD",
      output: {
        vendor: "Alder Supply",
        invoice_number: "A-1",
        invoice_date: "2026-10-01",
        total: 10,
        currency: "USD",
        due_date: null,
      },
    },
  ],
};

/** Builds whatever spec it is given, reporting a final usage receipt. */
class SpecBuilder implements BuildProvider {
  readonly id = "scripted-build";
  spec: unknown = INVOICE_SPEC;
  identity() {
    return { id: this.id, model: "scripted-build-model", version: "1" };
  }
  availability() {
    return { available: true, provider: this.id, reason: "Scripted build provider" };
  }
  pricing() {
    return { inputCentsPerMillionTokens: 300, outputCentsPerMillionTokens: 1500 };
  }
  start(_req: BuildRequest) {
    const spec = this.spec;
    return (async function* (): AsyncGenerator<BuildEvent> {
      yield { type: "output", artifact: spec };
      yield { type: "usage_final", inputTokens: 1000, outputTokens: 500 };
    })();
  }
}

export type Answer = { usage: RuntimeUsage; output: unknown };
export type Script = (req: RuntimeRequest, signal: AbortSignal) => Promise<Answer>;

/** The status and field values a scripted model reports. */
export const reply = (
  fields: Record<string, string | null>,
  status = "extracted",
  issues: string[] = [],
  usage: RuntimeUsage = { inputTokens: 900, outputTokens: 120, final: true },
): Answer => ({
  usage,
  output: {
    status,
    fields: Object.entries(fields).map(([key, value]) => ({ key, value, note: "" })),
    issues,
  },
});

export const CLEAN = {
  vendor: "Stackline Hosting Ltd",
  invoice_number: "SH-1042",
  invoice_date: "2026-10-14",
  total: "412.50",
  currency: "USD",
  due_date: null,
};

const row = (
  vendor: string,
  num: string,
  date: string | null,
  total: string,
  currency: string,
) => ({ vendor, invoice_number: num, invoice_date: date, total, currency, due_date: null });

/** What a correct extractor says about each required release document (fictional). */
export async function correct(req: RuntimeRequest): Promise<Answer> {
  const d = req.document;
  if (d.includes("SH-1042"))
    return reply(row("Stackline Hosting Ltd", "SH-1042", "2026-10-14", "412.50", "USD"));
  if (d.includes("QA-88"))
    return reply(row("Quillmark API Services", "QA-88", null, "140.00", "EUR"));
  if (d.includes("HD-310"))
    return reply({}, "ambiguous", ["03/04/2026 could be 3 April or 4 March"]);
  if (d.includes("---")) return reply({}, "multiple_documents");
  if (d.includes("MA-2026-07"))
    return reply(
      row("Marten Automation Co", "MA-2026-07", "2026-08-19", "300.00", "USD"),
      "extracted",
      ["Line items add up to 260.00, not the stated 300.00"],
    );
  if (d.includes("NA-4410"))
    return reply(row("Northwind AI Ops", "NA-4410", "2026-10-01", "48.00", "USD"));
  if (d.includes("OC-1"))
    return reply(row("Orbit Compute", "OC-1", "2026-10-10", "98765432109876543.21", "USD"));
  return reply({}, "not_a_document");
}

export class ScriptedRuntime implements RuntimeProvider {
  readonly id = "scripted-runtime";
  calls: RuntimeRequest[] = [];
  model = "scripted-runtime-model";
  constructor(public script: Script = async () => reply(CLEAN)) {}
  identity() {
    return { id: this.id, model: this.model, version: "1" };
  }
  availability() {
    return { available: true, provider: this.id, reason: "Scripted runtime" };
  }
  pricing() {
    // 30,000 in + 2,000 out at 100/500 cents per million: 3 + 1 = 4 cents worst case.
    return { inputCentsPerMillionTokens: 100, outputCentsPerMillionTokens: 500 };
  }
  extract(req: RuntimeRequest, signal: AbortSignal) {
    this.calls.push(req);
    return this.script(req, signal);
  }
}

export function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { opened, open };
}

export function runtimeWorld(
  provider: RuntimeProvider | null = new ScriptedRuntime(),
  options: RuntimeOptions = {},
  /** Job 003m: a file-backed database, for restart tests. */
  extra: { dbPath?: string } = {},
) {
  const store = new Store(openDb(extra.dbPath ?? ":memory:"));
  const builder = new SpecBuilder();
  const builds = new Builds(store.db, store, builder, { operatorCeilingCents: 100_000 });
  const runtime = new ManagedRuntime(store.db, store, provider, {
    ceilingCents: 1_000,
    ...options,
  });
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    buildProvider: builder,
    builds,
    runtime,
  });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
      });
      // biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const me = (await res.json()) as { person: { id: string } };
    return Object.assign(as(cookie), { id: me.person.id });
  };
  let n = 0;
  /** Builds the given spec into a checked artifact for a project; returns its job id. */
  const build = async (
    founder: Awaited<ReturnType<typeof join>>,
    projectId: string,
    spec: unknown = INVOICE_SPEC,
  ) => {
    builder.spec = spec;
    const r = await founder(`/api/product-projects/${projectId}/builds`, "POST", {
      idempotency_key: `build-key-${String(++n).padStart(4, "0")}`,
      revision: 1,
      budget: {
        max_input_tokens: 10_000,
        max_output_tokens: 2_000,
        max_seconds: 60,
        max_cost_cents: 10,
      },
    });
    // Production time scale (job 002a2): the deadline must not race a fast scripted build.
    await new BuildWorker(builds, builder, { id: `w${n}` }).runNext();
    const job = builds.row(r.body.job.id) as { state: string; id: string };
    if (job.state !== "succeeded") throw new Error(`build ${job.state}`);
    return job.id;
  };
  /** A founder with a project, budgets set, and one checked artifact. */
  const founder = async (name = "Ava Chen") => {
    const ava = await join(name);
    const p = (
      await ava("/api/product-projects", "POST", {
        idea: "Turn fictional supplier invoices into clean rows",
        foundation: "ai_api",
      })
    ).body.project;
    await ava(`/api/businesses/${p.business_id}/build-budget`, "PUT", { limit_cents: 100 });
    await ava(`/api/businesses/${p.business_id}/runtime-budget`, "PUT", { limit_cents: 100 });
    const job = await build(ava, p.id);
    return { ava, project: p.id as string, business: p.business_id as string, job };
  };
  /**
   * Flagship journey (003wf parent): ONLY the founder's person and the project's business shell,
   * so the business's contract account can be bound in the configuration. No budget, build,
   * evaluation or release: the founder makes those through the configured child's own routes.
   */
  const shell = async (name = "Ava Chen") => {
    const ava = await join(name);
    const p = (
      await ava("/api/product-projects", "POST", {
        idea: "Turn fictional supplier invoices into clean rows",
        foundation: "ai_api",
      })
    ).body.project;
    return { ava, project: p.id as string, business: p.business_id as string, job: "" };
  };
  /** Starts a check of a version and waits for it to finish (bounded). */
  const check = async (f: Awaited<ReturnType<typeof founder>>, job = f.job) => {
    const started = await f.ava(`/api/product-projects/${f.project}/evaluations`, "POST", {
      artifact_job: job,
    });
    if (started.status !== 202) throw new Error(`check: ${started.body.error}`);
    for (let i = 0; i < 300; i++) {
      const r = (await f.ava(`/api/evaluations/${started.body.run.id}`)).body.run;
      if (r.state !== "running") return r;
      await new Promise((ok) => setTimeout(ok, 2));
    }
    throw new Error("check did not finish");
  };
  /** Checks a version and releases it. */
  const release = async (f: Awaited<ReturnType<typeof founder>>, job = f.job) => {
    const run = await check(f, job);
    const r = await f.ava(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: job,
      eval_run: run.id,
    });
    if (r.status !== 201) throw new Error(`release: ${r.body.error}`);
    return { run, view: r.body };
  };
  /** Moves the business to another person, as a closed sale records it. */
  const transfer = (businessId: string, from: string, to: string) => {
    const gen = (
      store.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(businessId) as {
        n: number;
      }
    ).n;
    store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, businessId);
    store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(businessId, from, to, gen + 2, new Date().toISOString());
  };
  return {
    store,
    builds,
    runtime,
    app,
    join,
    build,
    founder,
    shell,
    check,
    release,
    transfer,
    anon: as(""),
  };
}

export type RuntimeWorld = ReturnType<typeof runtimeWorld>;
