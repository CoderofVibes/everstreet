// Job 002e: web app versions, the current-version pointer, and the preview capability
// (docs/design/EXECUTABLE_PRODUCTS.md §1 and §6). Versions are succeeded `app` build jobs: their
// bundles are immutable. "Current" is an append-only pointer, so restoring rewrites nothing.
//
// Preview: a capability token (only its SHA-256 is stored) for one version, under the owner
// epoch it was issued in, for 30 minutes. Files are served by the token alone (no cookie is read
// or set). The document is sandboxed by CSP; subresources are served CORS-readable with CORP
// cross-origin, because an opaque-origin document fetches module scripts in CORS mode with no
// credentials (Astra's header canary showed `same-origin`/no-CORS fails to load them). Ordinary
// preview is for a version whose isolated logic checks passed; an unchecked one only when asked
// for explicitly.

import { createHash, randomBytes } from "node:crypto";
import { MEDIA_TYPE, storedBundle, type WebAppBundle } from "./appBundle.ts";
import type { AppChecks } from "./appChecks.ts";
import { HttpError, type Store } from "./store.ts";

export const PREVIEW_TTL_MS = 30 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface PreviewResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export class AppVersions {
  constructor(
    readonly store: Store,
    readonly checks: AppChecks,
    readonly opts: { previewOrigin: string; platformOrigin: string; now?: () => number },
  ) {}

  private get db() {
    return this.store.db;
  }
  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /** The latest check of each version, newest first. */
  private latestChecks(projectId: string) {
    const rows = this.db
      .prepare(
        "SELECT job_id, id, state, engine, finished_at FROM app_checks WHERE project_id = ? ORDER BY created_at DESC",
      )
      .all(projectId) as {
      job_id: string;
      id: string;
      state: string;
      engine: string | null;
      finished_at: string | null;
    }[];
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.job_id)) latest.set(r.job_id, r);
    return latest;
  }

  /** Whether the version has a passed check from a real engine (a double is never isolation). */
  private checkedByEngine(projectId: string, jobId: string) {
    const r = this.db
      .prepare(
        "SELECT engine FROM app_checks WHERE project_id = ? AND job_id = ? AND state = 'passed' ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId, jobId) as { engine: string | null } | undefined;
    if (!r?.engine) return { passed: false, double: false };
    const engine = JSON.parse(r.engine) as { engine?: string };
    return { passed: true, double: engine.engine === "test-double" };
  }

  current(projectId: string) {
    const r = this.db
      .prepare("SELECT job_id FROM app_versions WHERE project_id = ? ORDER BY seq DESC LIMIT 1")
      .get(projectId) as { job_id: string } | undefined;
    if (r) return r.job_id;
    // Until one is chosen, the newest version is current.
    const n = this.db
      .prepare(
        "SELECT j.id FROM build_jobs j JOIN build_artifacts a ON a.job_id = j.id WHERE j.project_id = ? AND j.intent = 'app' AND j.state = 'succeeded' AND a.kind = 'web_app_bundle' ORDER BY a.created_at DESC LIMIT 1",
      )
      .get(projectId) as { id: string } | undefined;
    return n?.id ?? null;
  }

  list(viewerId: string, projectId: string) {
    const p = this.checks.ownedProject(viewerId, projectId);
    this.checks.fenceStale(p.business_id);
    const rows = this.db
      .prepare(
        "SELECT j.id, j.base_job, j.instructions, j.created_at, a.digest, a.bytes, a.content FROM build_jobs j JOIN build_artifacts a ON a.job_id = j.id WHERE j.project_id = ? AND j.intent = 'app' AND j.state = 'succeeded' AND a.kind = 'web_app_bundle' ORDER BY a.created_at DESC LIMIT 50",
      )
      .all(p.id) as {
      id: string;
      base_job: string | null;
      instructions: string | null;
      created_at: string;
      digest: string;
      bytes: number;
      content: string;
    }[];
    const latest = this.latestChecks(p.id);
    const current = this.current(p.id);
    return {
      current,
      versions: rows.map((r, i) => {
        const b = storedBundle(r.content);
        const c = latest.get(r.id);
        const engine = c?.engine ? (JSON.parse(c.engine) as { engine?: string }) : null;
        return {
          job_id: r.id,
          number: rows.length - i,
          name: b.name,
          description: b.description,
          digest: r.digest,
          bytes: r.bytes,
          base_job: r.base_job,
          instructions: r.instructions,
          files: b.files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.text, "utf8") })),
          checks: b.checks.map((x) => ({ id: x.id, label: x.label, module: x.module })),
          latest_check: c
            ? {
                id: c.id,
                state: c.state,
                test_double: engine?.engine === "test-double",
                finished_at: c.finished_at,
              }
            : null,
          current: r.id === current,
          created_at: r.created_at,
        };
      }),
    };
  }

  /** One version's files, for comparing versions in Studio (owner only). */
  files(viewerId: string, projectId: string, jobId: string): WebAppBundle {
    const p = this.checks.ownedProject(viewerId, projectId);
    return storedBundle(this.checks.version(p.id, jobId).content);
  }

  /** Restore: append a pointer to an existing version; nothing is rewritten. */
  setCurrent(viewerId: string, projectId: string, jobId: string, note: unknown) {
    const p = this.checks.ownedProject(viewerId, projectId);
    this.checks.version(p.id, jobId);
    const text = typeof note === "string" ? note.trim().slice(0, 200) : "";
    this.store.tx(() => {
      this.store.requireNoHandover(p.business_id); // job 003wf3 (D5)
      const seq =
        ((
          this.db
            .prepare("SELECT MAX(seq) AS s FROM app_versions WHERE project_id = ?")
            .get(p.id) as { s: number | null }
        ).s ?? 0) + 1;
      this.db
        .prepare(
          "INSERT INTO app_versions (project_id, seq, job_id, set_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(p.id, seq, jobId, viewerId, text, new Date(this.now()).toISOString());
    });
    return this.list(viewerId, projectId);
  }

  /**
   * Issues a preview capability. Ordinary preview needs a passed check by a real engine; an
   * unchecked (or double-checked) version only with `unchecked: true`, which the UI asks for
   * explicitly with a warning.
   */
  issuePreview(viewerId: string, projectId: string, jobId: string, unchecked: unknown) {
    const p = this.checks.ownedProject(viewerId, projectId);
    const v = this.checks.version(p.id, jobId);
    const state = this.checkedByEngine(p.id, jobId);
    const checked = state.passed && !state.double;
    if (!checked && unchecked !== true)
      throw new HttpError(
        409,
        "This version's logic checks haven't passed in the isolated worker, so it isn't opened as an ordinary preview. You can open it as an unchecked preview instead.",
        "not_checked",
      );
    const token = randomBytes(32).toString("base64url");
    const epoch = this.checks.ownerEpoch(p.business_id);
    const expires = this.now() + PREVIEW_TTL_MS;
    this.store.tx(() => {
      this.store.requireNoHandover(p.business_id); // job 003wf3 (D5)
      this.db
        .prepare(
          "INSERT INTO app_preview_tokens (token_hash, project_id, business_id, job_id, digest, owner_id, owner_generation, issued_to, expires_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          sha(token),
          p.id,
          p.business_id,
          jobId,
          v.digest,
          epoch.owner_id,
          epoch.generation,
          viewerId,
          expires,
          new Date(this.now()).toISOString(),
        );
    });
    return {
      url: `${this.opts.previewOrigin}/preview/app/${token}/index.html`,
      checked,
      expires_ms: String(expires),
    };
  }

  /** Serves one file of a previewed version by its token alone. */
  serve(token: string, path: string): PreviewResponse {
    const missing: PreviewResponse = {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      body: "Not found",
    };
    if (!TOKEN.test(token)) return missing;
    const t = this.db
      .prepare("SELECT * FROM app_preview_tokens WHERE token_hash = ?")
      .get(sha(token)) as
      | {
          project_id: string;
          business_id: string;
          job_id: string;
          digest: string;
          owner_id: string;
          owner_generation: number;
          expires_ms: number;
        }
      | undefined;
    if (!t || t.expires_ms < this.now()) return missing;
    // A sale (or any change of hands) ends every preview issued before it.
    const e = this.checks.ownerEpoch(t.business_id);
    if (e.owner_id !== t.owner_id || e.generation !== t.owner_generation) return missing;
    let v: { digest: string; content: string };
    try {
      v = this.checks.version(t.project_id, t.job_id);
    } catch {
      return missing;
    }
    if (v.digest !== t.digest) return missing;
    const file = storedBundle(v.content).files.find((f) => f.path === path);
    if (!file) return missing;
    const ext = path.slice(path.lastIndexOf(".") + 1);
    const prefix = `${this.opts.previewOrigin}/preview/app/${token}/`;
    const common = {
      "Content-Type": MEDIA_TYPE[ext] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    };
    if (ext === "html")
      return {
        status: 200,
        headers: {
          ...common,
          "Content-Security-Policy": [
            "sandbox allow-scripts",
            "default-src 'none'",
            `script-src ${prefix}`,
            `style-src ${prefix}`,
            `img-src ${prefix} data:`,
            "connect-src 'none'",
            "form-action 'none'",
            "base-uri 'none'",
            `frame-ancestors ${this.opts.platformOrigin}`,
          ].join("; "),
        },
        body: file.text,
      };
    // Subresources: readable by the opaque-origin document (CORS without credentials) and
    // embeddable across origins (CORP); the token is the only authority, and it is narrow.
    return {
      status: 200,
      headers: {
        ...common,
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
      body: file.text,
    };
  }
}
