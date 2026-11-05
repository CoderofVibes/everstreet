// Job 004b (M4): a READ-ONLY, bounded GitHub source reader for an import workspace.
//
// What it reads, and nothing else (GitHub REST, API version 2022-11-28, GET only):
//   GET /repos/{owner}/{repo}                                   repository metadata
//   GET /repos/{owner}/{repo}/commits/{ref}                     the ref, pinned to one commit SHA
//   GET /repos/{owner}/{repo}/contents/package.json?ref={sha}   the allowlisted manifest AT that SHA
//   GET /repos/{owner}/{repo}/deployments?sha={sha}&per_page=5  deployment records for that SHA
//   GET /repos/{owner}/{repo}/deployments/{id}/statuses?per_page=5
// Contents need "Contents: read"; deployments need "Deployments: read" (fine-grained tokens).
// Docs: https://docs.github.com/en/rest/repos/contents, .../deployments/deployments,
// .../deployments/statuses (checked by Astra Nov 4; the paths above follow them).
//
// Never: clone, install, execute, follow redirects with credentials, fetch URLs found in payloads
// (environment_url, log_url, target_url, html_url are dropped), read READMEs, arbitrary files,
// symlink targets or submodules. Calls, bytes and elapsed time are bounded independently. A
// deployment status "success" is a CLAIM published by an integration: not proof that the service
// runs now, that this commit is live, or that the founder owns transferable IP.

export const SOURCE_API_VERSION = "2022-11-28";
export const SOURCE_LIMITS = {
  calls: 12,
  totalBytes: 512 * 1024,
  callBytes: 256 * 1024,
  manifestBytes: 64 * 1024,
  callMs: 8_000,
  totalMs: 20_000,
  deployments: 5,
  statuses: 5,
};

const OWNER_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const REF = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]{1,200}$/;
const SHA = /^[0-9a-f]{40}$/;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface SourceConnectionConfig {
  id: string;
  label: string;
  /** public: unauthenticated reads of public repositories; repository_scoped: a named credential. */
  kind: "public" | "repository_scoped";
  /** The only repositories this connection may read ("owner/repo"); anything else is refused. */
  repositories: string[];
  /** repository_scoped only: the NAME of the environment variable holding a read-only token. */
  credential_env?: string;
  /** A fictional fixture connection (preview and tests), labelled as such everywhere. */
  fixture?: boolean;
}

export type ReadFailure =
  | "not_found_or_inaccessible"
  | "denied"
  | "rate_limited"
  | "timed_out"
  | "invalid_response"
  | "too_large"
  | "budget_exhausted"
  | "unavailable";

const RETRYABLE: ReadFailure[] = ["rate_limited", "timed_out", "budget_exhausted"];

export interface DeploymentClaim {
  id: number;
  environment: string;
  sha: string;
  matches_commit: boolean;
  created_at: string;
  /** Newest first; each is what the integration reported, never verified here. */
  statuses: { state: string; created_at: string }[];
}

export interface SourceRead {
  connection: { id: string; label: string; fixture: boolean };
  repository: { full_name: string; private: boolean | null; default_branch: string | null };
  ref: string;
  commit: { sha: string };
  manifest:
    | {
        state: "read";
        path: "package.json";
        bytes: number;
        blob_sha: string | null;
        content: string;
      }
    | {
        state: "missing" | "too_large" | "invalid" | "not_a_file";
        path: "package.json";
        detail: string;
      };
  deployments:
    | { state: "read"; records: DeploymentClaim[]; truncated: boolean }
    | { state: "unread"; reason: string };
  unread: string[];
  usage: { calls: number; bytes: number; ms: number };
  read_at: string;
  api_version: string;
}

export type SourceOutcome =
  | { ok: true; read: SourceRead }
  | { ok: false; failure: ReadFailure; retryable: boolean; detail: string };

class Stop extends Error {
  constructor(
    readonly failure: ReadFailure,
    detail: string,
  ) {
    super(detail);
  }
}

const seg = (s: string) => encodeURIComponent(s);

export function validRepository(v: unknown): string | null {
  return typeof v === "string" && OWNER_REPO.test(v) && !v.includes("..") ? v : null;
}
export function validRef(v: unknown): string | null {
  return typeof v === "string" && REF.test(v) ? v : null;
}

/** One bounded GitHub reader per configured origin; the transport is injected. */
export class GithubSource {
  constructor(
    private readonly origin: string,
    private readonly fetchImpl: FetchLike,
    private readonly limits = SOURCE_LIMITS,
  ) {
    if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(origin) && !origin.startsWith("fixture:"))
      throw new Error("source origin must be an https origin with no path");
  }

  async read(
    conn: SourceConnectionConfig,
    repository: string,
    ref: string,
    token: string | null,
    outer?: AbortSignal,
  ): Promise<SourceOutcome> {
    const repo = validRepository(repository);
    const r = validRef(ref);
    if (!repo || !r)
      return {
        ok: false,
        failure: "invalid_response",
        retryable: false,
        detail: "Invalid repository or ref",
      };
    // Scope is checked BEFORE any request is made.
    if (!conn.repositories.includes(repo))
      return {
        ok: false,
        failure: "denied",
        retryable: false,
        detail: "This connection isn't allowed to read that repository",
      };
    const started = Date.now();
    const usage = { calls: 0, bytes: 0, ms: 0 };
    const total = new AbortController();
    const totalTimer = setTimeout(() => total.abort(), this.limits.totalMs);
    const onOuter = () => total.abort();
    outer?.addEventListener("abort", onOuter, { once: true });
    const [owner, name] = repo.split("/") as [string, string];
    const base = `/repos/${seg(owner)}/${seg(name)}`;
    const get = async (path: string, maxBytes = this.limits.callBytes) => {
      if (usage.calls >= this.limits.calls)
        throw new Stop("budget_exhausted", "Read call limit reached");
      usage.calls++;
      const call = new AbortController();
      const t = setTimeout(() => call.abort(), this.limits.callMs);
      const abortCall = () => call.abort();
      total.signal.addEventListener("abort", abortCall, { once: true });
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.origin}${path}`, {
          method: "GET",
          redirect: "manual",
          signal: call.signal,
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": SOURCE_API_VERSION,
            "user-agent": "everstreet-source-inspection",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
      } catch {
        throw new Stop("timed_out", "The source didn't answer in time");
      } finally {
        clearTimeout(t);
        total.signal.removeEventListener("abort", abortCall);
      }
      if (res.status >= 300 && res.status < 400) throw new Stop("denied", "A redirect was refused");
      if (res.status === 404)
        throw new Stop("not_found_or_inaccessible", "Not found or not accessible");
      if (
        res.status === 429 ||
        (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
      )
        throw new Stop("rate_limited", "The source's rate limit was reached; try again later");
      if (res.status === 401 || res.status === 403)
        throw new Stop("denied", "The connection was refused");
      if (res.status !== 200) throw new Stop("unavailable", `The source answered ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes)
        throw new Stop("too_large", "A response was larger than allowed");
      usage.bytes += buf.byteLength;
      if (usage.bytes > this.limits.totalBytes)
        throw new Stop("budget_exhausted", "Read byte limit reached");
      try {
        return JSON.parse(new TextDecoder().decode(buf)) as unknown;
      } catch {
        throw new Stop("invalid_response", "The source's answer wasn't valid JSON");
      }
    };
    const unread: string[] = [];
    try {
      const meta = (await get(base)) as Record<string, unknown>;
      if (typeof meta?.full_name !== "string")
        throw new Stop("invalid_response", "No repository name");
      const commit = (await get(`${base}/commits/${seg(r)}`)) as Record<string, unknown>;
      const sha = typeof commit?.sha === "string" && SHA.test(commit.sha) ? commit.sha : null;
      if (!sha) throw new Stop("invalid_response", "The ref didn't resolve to a commit");
      // Everything after this point reads AT the pinned SHA, never the moving ref.
      let manifest: SourceRead["manifest"];
      try {
        const m = (await get(`${base}/contents/package.json?ref=${sha}`)) as Record<
          string,
          unknown
        >;
        if (m?.type !== "file" || typeof m.content !== "string" || m.encoding !== "base64")
          manifest = {
            state: "not_a_file",
            path: "package.json",
            detail: "package.json isn't a regular file there",
          };
        else {
          const content = Buffer.from(m.content.replace(/\s/g, ""), "base64").toString("utf8");
          const bytes = Buffer.byteLength(content, "utf8");
          manifest =
            bytes > this.limits.manifestBytes
              ? {
                  state: "too_large",
                  path: "package.json",
                  detail: `package.json is ${bytes} bytes; the limit is ${this.limits.manifestBytes}`,
                }
              : {
                  state: "read",
                  path: "package.json",
                  bytes,
                  blob_sha: typeof m.sha === "string" ? m.sha : null,
                  content,
                };
        }
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
        if (e.failure === "not_found_or_inaccessible")
          manifest = {
            state: "missing",
            path: "package.json",
            detail: "No package.json at this commit (or not accessible)",
          };
        else if (e.failure === "too_large")
          manifest = { state: "too_large", path: "package.json", detail: e.message };
        else if (e.failure === "invalid_response")
          manifest = { state: "invalid", path: "package.json", detail: e.message };
        else throw e;
      }
      let deployments: SourceRead["deployments"];
      try {
        const list = await get(
          `${base}/deployments?sha=${sha}&per_page=${this.limits.deployments}`,
        );
        if (!Array.isArray(list)) throw new Stop("invalid_response", "Deployments weren't a list");
        const records: DeploymentClaim[] = [];
        for (const d of list.slice(0, this.limits.deployments) as Record<string, unknown>[]) {
          if (typeof d?.id !== "number" || typeof d.sha !== "string") continue;
          let statuses: DeploymentClaim["statuses"] = [];
          try {
            const s = await get(
              `${base}/deployments/${d.id}/statuses?per_page=${this.limits.statuses}`,
            );
            if (Array.isArray(s))
              statuses = (s as Record<string, unknown>[])
                .filter((x) => typeof x?.state === "string")
                .slice(0, this.limits.statuses)
                .map((x) => ({
                  state: String(x.state).slice(0, 40),
                  created_at: String(x.created_at ?? "").slice(0, 40),
                }));
          } catch (e) {
            if (!(e instanceof Stop) || e.failure === "rate_limited" || e.failure === "timed_out")
              throw e;
            unread.push(`statuses of deployment ${d.id}: ${e.message}`);
          }
          records.push({
            id: d.id,
            environment: String(d.environment ?? "").slice(0, 80),
            sha: d.sha,
            matches_commit: d.sha === sha,
            created_at: String(d.created_at ?? "").slice(0, 40),
            statuses,
          });
        }
        deployments = { state: "read", records, truncated: list.length >= this.limits.deployments };
      } catch (e) {
        if (!(e instanceof Stop) || e.failure === "rate_limited" || e.failure === "timed_out")
          throw e;
        deployments = { state: "unread", reason: e.message };
        unread.push(`deployments: ${e.message}`);
      }
      unread.push(
        "source code bodies, scripts, README instructions and other files (never read)",
        "who owns the repository or its intellectual property (read access isn't ownership)",
      );
      return {
        ok: true,
        read: {
          connection: { id: conn.id, label: conn.label, fixture: conn.fixture === true },
          repository: {
            full_name: String(meta.full_name).slice(0, 140),
            private: typeof meta.private === "boolean" ? meta.private : null,
            default_branch:
              typeof meta.default_branch === "string" ? meta.default_branch.slice(0, 200) : null,
          },
          ref: r,
          commit: { sha },
          manifest,
          deployments,
          unread,
          usage: { ...usage, ms: Date.now() - started },
          read_at: new Date().toISOString(),
          api_version: SOURCE_API_VERSION,
        },
      };
    } catch (e) {
      if (e instanceof Stop)
        return {
          ok: false,
          failure: total.signal.aborted && e.failure === "timed_out" ? "timed_out" : e.failure,
          retryable: RETRYABLE.includes(e.failure),
          detail: e.message,
        };
      throw e;
    } finally {
      clearTimeout(totalTimer);
      outer?.removeEventListener("abort", onOuter);
    }
  }
}

// ---------- the fictional fixture (preview and tests): the same reader, a canned transport ----------

export interface FixtureRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
  /** ref -> commit sha */
  refs: Record<string, string>;
  /** commit sha -> package.json text (absent: no manifest at that commit) */
  manifests: Record<string, string>;
  deployments?: { id: number; sha: string; environment: string; statuses: string[] }[];
}

/** A deterministic GitHub-shaped responder over fictional repositories. Records every request. */
export function fixtureTransport(repos: FixtureRepo[]) {
  const requests: string[] = [];
  const by = new Map(repos.map((r) => [r.full_name, r]));
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push(url);
    if (init.method !== "GET") return json(405, { message: "GET only" });
    const u = new URL(url.replace(/^fixture:\/\/[^/]+/, "https://fixture.invalid"));
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname);
    if (!m) return json(404, { message: "Not Found" });
    const repo = by.get(
      `${decodeURIComponent(m[1] as string)}/${decodeURIComponent(m[2] as string)}`,
    );
    if (!repo) return json(404, { message: "Not Found" });
    const rest = m[3] ?? "";
    if (rest === "")
      return json(200, {
        full_name: repo.full_name,
        private: repo.private,
        default_branch: repo.default_branch,
      });
    const commit = /^\/commits\/(.+)$/.exec(rest);
    if (commit) {
      const sha = repo.refs[decodeURIComponent(commit[1] as string)];
      return sha ? json(200, { sha }) : json(404, { message: "No commit found" });
    }
    if (rest === "/contents/package.json") {
      const text = repo.manifests[u.searchParams.get("ref") ?? ""];
      return text === undefined
        ? json(404, { message: "Not Found" })
        : json(200, {
            type: "file",
            encoding: "base64",
            sha: "b".repeat(40),
            content: Buffer.from(text).toString("base64"),
          });
    }
    if (rest === "/deployments") {
      const sha = u.searchParams.get("sha");
      return json(
        200,
        (repo.deployments ?? [])
          .filter((d) => d.sha === sha)
          .map((d) => ({
            id: d.id,
            sha: d.sha,
            environment: d.environment,
            created_at: "2026-11-01T10:00:00Z",
            environment_url: "https://example.invalid/never-fetched",
          })),
      );
    }
    const st = /^\/deployments\/([0-9]+)\/statuses$/.exec(rest);
    if (st) {
      const d = (repo.deployments ?? []).find((x) => x.id === Number(st[1]));
      return d
        ? json(
            200,
            d.statuses.map((s) => ({
              state: s,
              created_at: "2026-11-01T10:05:00Z",
              target_url: "https://example.invalid/log",
            })),
          )
        : json(404, { message: "Not Found" });
    }
    return json(404, { message: "Not Found" });
  };
  return { fetchImpl, requests };
}

/** The preview's fictional repository (clearly labelled; never a real account). */
export const FICTIONAL_REPOS: FixtureRepo[] = [
  {
    full_name: "ledgerline-fictional/invoice-reader",
    private: true,
    default_branch: "main",
    refs: { main: "a1".repeat(20), "v1.2.0": "c3".repeat(20) },
    manifests: {
      ["a1".repeat(20)]: JSON.stringify({
        name: "invoice-reader",
        version: "1.3.0",
        private: true,
        type: "module",
        engines: { node: ">=22" },
        dependencies: {
          "@anthropic-ai/sdk": "^0.40.0",
          stripe: "^17.0.0",
          pg: "^8.13.0",
          hono: "^4.6.0",
        },
        devDependencies: { vitest: "^3.0.0", typescript: "^5.6.0" },
        scripts: { start: "node server.js" },
      }),
      ["c3".repeat(20)]: JSON.stringify({
        name: "invoice-reader",
        version: "1.2.0",
        private: true,
        dependencies: { "@anthropic-ai/sdk": "^0.38.0", stripe: "^16.0.0", hono: "^4.5.0" },
      }),
    },
    deployments: [
      {
        id: 901,
        sha: "a1".repeat(20),
        environment: "production",
        statuses: ["success", "in_progress"],
      },
    ],
  },
];

/**
 * The preview's FICTIONAL source connection: the real reader over the fixture transport, labelled
 * as a fixture everywhere it appears. Never a real account, token or network request.
 */
export function fictionalSourceOptions() {
  const t = fixtureTransport(FICTIONAL_REPOS);
  const connection: SourceConnectionConfig = {
    id: "fictional-fixture",
    label: "Fictional GitHub fixture",
    kind: "repository_scoped",
    repositories: FICTIONAL_REPOS.map((r) => r.full_name),
    fixture: true,
  };
  return {
    reader: new GithubSource("https://fixture.github.invalid", t.fetchImpl),
    connections: [connection],
    credential: () => "fictional-fixture-credential",
  };
}

/** Configured connections over a real transport; tokens come only from their named variables. */
export function configuredSourceOptions(
  config: {
    origin: string;
    connections: {
      id: string;
      label: string;
      kind: "public" | "repository_scoped";
      repositories: string[];
      credential_env?: string;
    }[];
  },
  fetchImpl: FetchLike,
  envVar: (name: string) => string | undefined,
) {
  return {
    reader: new GithubSource(config.origin, fetchImpl),
    connections: config.connections.map((c) => ({ ...c })),
    credential: (c: SourceConnectionConfig) =>
      c.credential_env ? (envVar(c.credential_env) ?? null) || null : null,
  };
}
