// Web app releases (docs/design/WEB_APP_RELEASE.md, job 006a): a released `web_app_bundle` is one
// more product kind in the existing release, offer and unit machinery. This module holds what is
// particular to it: the access terms beside a release, the pass engine (deterministic: a
// customer's one unit starts N days of access to the release they bought, pinned), and serving
// the app to customers from a separate sandboxed origin (a free address, or a pass's private
// one). The app runs only in the customer's browser; nothing here executes its code.

import { createHash, randomBytes } from "node:crypto";
import { MEDIA_TYPE, storedBundle } from "./appBundle.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./store.ts";

export const WEB_APP_KIND = "web_app";
/** The release policy for this kind: an isolated logic check of the exact digest (§2). */
export const WEB_APP_VALIDATOR = "web-app-release/1";
/** A web app release's "model config": none runs; access is granted, not computed. */
export const WEB_APP_CONFIG = JSON.stringify({ engine: "web-app-access/1", model: null });

export interface WebAppSpec {
  digest: string;
  name: string;
  description: string;
}

/** What the platform says about every released web app (§1), before the founder's own words. */
export const PLATFORM_LIMITATIONS =
  "Runs only in your browser: its results are calculated there. It has no backend, takes no payments and keeps nothing for you.";

export interface AppTerms {
  access: "free" | "pass";
  /** Days of access a pass gives (null for free access). */
  pass_days: number | null;
  /** The founder's own limitations, shown after the platform's. */
  limitations: string;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** Validates the owner's access terms for a release. */
export function parseAppTerms(raw: unknown): AppTerms {
  const bad = (m: string): never => {
    throw new HttpError(400, m, "bad_app_terms");
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    bad("Say how customers get the app: free access, or an access pass");
  const o = raw as Record<string, unknown>;
  if (o.access !== "free" && o.access !== "pass") bad("Access is free or a pass");
  let days: number | null = null;
  if (o.access === "pass") {
    days = Number(o.pass_days);
    if (!Number.isInteger(days) || days < 1 || days > 365)
      bad("A pass lasts a whole number of days, 1 to 365");
  }
  const limitations =
    typeof o.limitations === "string" ? o.limitations.replace(CONTROL, " ").trim() : "";
  if (limitations.length > 600) bad("The limitations are at most 600 characters");
  return { access: o.access as AppTerms["access"], pass_days: days, limitations };
}

/** The terms a customer is shown and the owner reviews, and their digest. */
export function termsText(spec: WebAppSpec, t: AppTerms) {
  const text = JSON.stringify({
    app: spec.name,
    digest: spec.digest,
    access: t.access,
    pass_days: t.pass_days,
    platform: PLATFORM_LIMITATIONS,
    limitations: t.limitations,
  });
  return { text, digest: sha(text) };
}

// The tables (app_release_terms, web_apps, app_passes) are in db.ts: APP_TERMS_SCHEMA.

export function termsOf(db: Db, releaseId: string) {
  return (
    (db.prepare("SELECT * FROM app_release_terms WHERE release_id = ?").get(releaseId) as
      | {
          release_id: string;
          project_id: string;
          access: "free" | "pass";
          pass_days: number | null;
          limitations: string;
          terms_digest: string;
        }
      | undefined) ?? null
  );
}

/** The project's stable customer address id, made on its first release (inside the caller's tx). */
export function ensureAppId(db: Db, projectId: string, now: string) {
  const r = db.prepare("SELECT app_id FROM web_apps WHERE project_id = ?").get(projectId) as
    | { app_id: string }
    | undefined;
  if (r) return r.app_id;
  const id = randomBytes(12).toString("base64url");
  db.prepare("INSERT INTO web_apps (project_id, app_id, created_at) VALUES (?, ?, ?)").run(
    projectId,
    id,
    now,
  );
  return id;
}

export const appIdOf = (db: Db, projectId: string) =>
  (
    db.prepare("SELECT app_id FROM web_apps WHERE project_id = ?").get(projectId) as
      | { app_id: string }
      | undefined
  )?.app_id ?? null;

// ---------- the pass engine ----------

export type PassResult =
  | {
      outcome: "granted";
      release_id: string;
      digest: string;
      pass_days: number;
      starts_at: string;
      expires_at: string;
      /** The customer's private address for the app (carries the capability token). */
      url: string;
    }
  | { outcome: "refused"; reason: string };

/** Grants a pass for the release a request runs on, or refuses (never charged). */
export function grantPass(
  db: Db,
  input: { releaseId: string | null; digest: string; appOrigin: string; now: number },
): PassResult {
  if (!input.releaseId) return { outcome: "refused", reason: "A pass is bought from an offer" };
  const t = termsOf(db, input.releaseId);
  if (t?.access !== "pass" || !t.pass_days)
    return { outcome: "refused", reason: "This release is free to open; it has no passes" };
  const token = randomBytes(32).toString("base64url");
  const starts = input.now;
  const expires = starts + t.pass_days * 86_400_000;
  return {
    outcome: "granted",
    release_id: input.releaseId,
    digest: input.digest,
    pass_days: t.pass_days,
    starts_at: new Date(starts).toISOString(),
    expires_at: new Date(expires).toISOString(),
    url: `${input.appOrigin}/p/${token}/index.html`,
  };
}

/** Records a delivered pass's token (its hash only), in the caller's delivery transaction. */
export function recordPass(
  db: Db,
  r: { request_id: string; person_id: string; project_id: string },
  pass: Extract<PassResult, { outcome: "granted" }>,
) {
  const token = /\/p\/([A-Za-z0-9_-]{43})\//.exec(pass.url)?.[1];
  if (!token) throw new Error("a granted pass carries its token");
  db.prepare(
    "INSERT OR IGNORE INTO app_passes (token_hash, request_id, person_id, project_id, release_id, digest, starts_ms, expires_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    sha(token),
    r.request_id,
    r.person_id,
    r.project_id,
    pass.release_id,
    pass.digest,
    Date.parse(pass.starts_at),
    Date.parse(pass.expires_at),
    pass.starts_at,
  );
}

// ---------- serving on the app origin (§3) ----------

export interface ServeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const page = (status: number, title: string, text: string): ServeResponse => ({
  status,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  },
  body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#1b2333}</style></head><body><h1>${title}</h1><p>${text}</p></body></html>`,
});

/** One file of a bundle, under the customer sandbox (top-level: never framed). */
function serveFile(
  db: Db,
  jobId: string,
  digest: string,
  path: string,
  prefix: string,
  standIn: boolean,
): ServeResponse {
  const a = db
    .prepare(
      "SELECT digest, content FROM build_artifacts WHERE job_id = ? AND kind = 'web_app_bundle'",
    )
    .get(jobId) as { digest: string; content: string } | undefined;
  if (!a || a.digest !== digest) return page(404, "Not found", "This app isn't available.");
  const file = storedBundle(a.content).files.find((f) => f.path === path);
  if (!file) return page(404, "Not found", "This app has no such file.");
  const ext = path.slice(path.lastIndexOf(".") + 1);
  const common = {
    "Content-Type": MEDIA_TYPE[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  };
  if (ext === "html") {
    // The stand-in label is part of the page a customer sees, outside the app's own markup.
    const label = standIn
      ? `<div role="note" style="font:13px system-ui;background:#fff4d6;padding:6px 10px;border-bottom:1px solid #e6c97a">Stand-in release: its logic checks ran on a test double, not an isolated worker. Fictional.</div>`
      : "";
    return {
      status: 200,
      headers: {
        ...common,
        "Content-Security-Policy": [
          "sandbox allow-scripts",
          "default-src 'none'",
          `script-src ${prefix}`,
          `style-src ${prefix} 'unsafe-inline'`,
          `img-src ${prefix} data:`,
          "connect-src 'none'",
          "form-action 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
        ].join("; "),
      },
      body: label ? file.text.replace(/<body([^>]*)>/i, (m) => `${m}${label}`) : file.text,
    };
  }
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

/** Whether a release was checked by a test double (a stand-in release, §5). */
export function releaseIsStandIn(db: Db, releaseId: string) {
  const r = db
    .prepare(
      "SELECT e.results FROM runtime_releases r JOIN eval_runs e ON e.id = r.eval_run WHERE r.id = ?",
    )
    .get(releaseId) as { results: string | null } | undefined;
  return !!r?.results && r.results.includes('"engine":"test-double"');
}

/** The free address: the project's ACTIVE release, if its access is free. */
export function serveFree(
  db: Db,
  appOrigin: string,
  appId: string,
  path: string,
  allowed: (releaseId: string) => boolean,
): ServeResponse {
  if (!/^[A-Za-z0-9_-]{16}$/.test(appId)) return page(404, "Not found", "No such app.");
  const p = db.prepare("SELECT project_id FROM web_apps WHERE app_id = ?").get(appId) as
    | { project_id: string }
    | undefined;
  if (!p) return page(404, "Not found", "No such app.");
  const r = db
    .prepare(
      "SELECT id, artifact_job, artifact_digest FROM runtime_releases WHERE project_id = ? AND state = 'active'",
    )
    .get(p.project_id) as { id: string; artifact_job: string; artifact_digest: string } | undefined;
  if (!r)
    return page(
      410,
      "This app isn't available",
      "The business withdrew this app, or hasn't released it. Nothing older is shown in its place.",
    );
  const t = termsOf(db, r.id);
  if (t?.access !== "free")
    return page(
      403,
      "This app needs an access pass",
      "Open the business's page on Everstreet to get a pass.",
    );
  if (!allowed(r.id))
    return page(503, "This app can't be served now", "Its release needs checking again.");
  return serveFile(
    db,
    r.artifact_job,
    r.artifact_digest,
    path,
    `${appOrigin}/a/${appId}/`,
    releaseIsStandIn(db, r.id),
  );
}

/** A pass's private address: its PINNED release until it expires (§3). */
export function servePass(
  db: Db,
  appOrigin: string,
  token: string,
  path: string,
  now: number,
  standInAllowed: boolean,
): ServeResponse {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return page(404, "Not found", "No such pass.");
  const p = db.prepare("SELECT * FROM app_passes WHERE token_hash = ?").get(sha(token)) as
    | { release_id: string; digest: string; expires_ms: number }
    | undefined;
  if (!p) return page(404, "Not found", "No such pass.");
  if (now >= p.expires_ms)
    return page(
      410,
      "This pass has ended",
      `It was valid until ${new Date(p.expires_ms).toUTCString()}. Your purchase history stays on Everstreet.`,
    );
  const r = db
    .prepare("SELECT artifact_job FROM runtime_releases WHERE id = ?")
    .get(p.release_id) as { artifact_job: string } | undefined;
  if (!r) return page(404, "Not found", "No such release.");
  const standIn = releaseIsStandIn(db, p.release_id);
  // §5: with stand-in releases off, a stand-in release serves nobody, a pass's pinned one included.
  if (standIn && !standInAllowed)
    return page(503, "This app can't be served now", "Its release needs checking again.");
  return serveFile(db, r.artifact_job, p.digest, path, `${appOrigin}/p/${token}/`, standIn);
}
