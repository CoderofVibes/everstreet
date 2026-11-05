// Job 004b: the bounded, read-only GitHub source reader over the FICTIONAL fixture transport.
// No network: every request goes to an in-memory responder that records it.

import { describe, expect, it } from "vitest";
import {
  type FetchLike,
  FICTIONAL_REPOS,
  fixtureTransport,
  GithubSource,
  SOURCE_LIMITS,
  type SourceConnectionConfig,
} from "../src/sourceConnect.ts";

const REPO = "ledgerline-fictional/invoice-reader";
const CONN: SourceConnectionConfig = {
  id: "fixture",
  label: "Fictional GitHub fixture",
  kind: "repository_scoped",
  repositories: [REPO],
  fixture: true,
};
const ORIGIN = "https://api.github.invalid";
const clone = () => JSON.parse(JSON.stringify(FICTIONAL_REPOS)) as typeof FICTIONAL_REPOS;

describe("004b source reader", () => {
  it("pins the ref to a commit, reads the manifest AT that commit and the deployment claims", async () => {
    const t = fixtureTransport(clone());
    const out = await new GithubSource(ORIGIN, t.fetchImpl).read(
      CONN,
      REPO,
      "main",
      "fixture-token",
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.read;
    expect(r.commit.sha).toBe("a1".repeat(20));
    expect(r.manifest).toMatchObject({ state: "read", path: "package.json" });
    expect(r.deployments).toMatchObject({
      state: "read",
      records: [{ id: 901, environment: "production", matches_commit: true }],
    });
    // Every read after resolution names the SHA, never the moving ref; GET only; no payload URL.
    expect(t.requests.filter((u) => u.includes("contents"))).toEqual([
      `${ORIGIN}/repos/ledgerline-fictional/invoice-reader/contents/package.json?ref=${"a1".repeat(20)}`,
    ]);
    expect(t.requests.some((u) => u.includes("example.invalid"))).toBe(false);
    expect(JSON.stringify(r)).not.toContain("example.invalid");
    expect(r.unread.join(" ")).toMatch(/read access isn't ownership/);
    expect(r.usage.calls).toBeLessThanOrEqual(SOURCE_LIMITS.calls);
  });

  it("refuses a repository outside the connection's scope before any request", async () => {
    const t = fixtureTransport(clone());
    const out = await new GithubSource(ORIGIN, t.fetchImpl).read(
      CONN,
      "someone-else/secret",
      "main",
      null,
    );
    expect(out).toMatchObject({ ok: false, failure: "denied", retryable: false });
    expect(t.requests).toEqual([]);
  });

  it("a ref that moves during the read can't mix commits", async () => {
    const repos = clone();
    const t = fixtureTransport(repos);
    const moving: FetchLike = async (url, init) => {
      const res = await t.fetchImpl(url, init);
      // Right after the ref resolves, someone pushes: main now points elsewhere.
      if (url.includes("/commits/")) (repos[0] as (typeof repos)[0]).refs.main = "c3".repeat(20);
      return res;
    };
    const out = await new GithubSource(ORIGIN, moving).read(CONN, REPO, "main", null);
    expect(out.ok && out.read.commit.sha).toBe("a1".repeat(20));
    expect(
      out.ok && out.read.manifest.state === "read" && JSON.parse(out.read.manifest.content).version,
    ).toBe("1.3.0");
  });

  it("states a missing, oversized or non-file manifest truthfully; never 'no dependencies'", async () => {
    const repos = clone();
    const r0 = repos[0] as (typeof repos)[0];
    r0.refs.empty = "e5".repeat(20);
    r0.refs.big = "f6".repeat(20);
    r0.manifests["f6".repeat(20)] = JSON.stringify({ name: "x", description: "y".repeat(70_000) });
    const src = new GithubSource(ORIGIN, fixtureTransport(repos).fetchImpl);
    const missing = await src.read(CONN, REPO, "empty", null);
    expect(missing.ok && missing.read.manifest).toMatchObject({ state: "missing" });
    const big = await src.read(CONN, REPO, "big", null);
    expect(big.ok && big.read.manifest).toMatchObject({ state: "too_large" });
  });

  it("not found, rate limit, refusal, redirect and timeout are distinct, honest outcomes", async () => {
    const status =
      (s: number, headers: Record<string, string> = {}): FetchLike =>
      async () =>
        new Response("{}", { status: s, headers });
    const read = (f: FetchLike) => new GithubSource(ORIGIN, f).read(CONN, REPO, "main", null);
    expect(await read(status(404))).toMatchObject({
      ok: false,
      failure: "not_found_or_inaccessible",
      retryable: false,
    });
    expect(await read(status(403, { "x-ratelimit-remaining": "0" }))).toMatchObject({
      failure: "rate_limited",
      retryable: true,
    });
    expect(await read(status(429))).toMatchObject({ failure: "rate_limited", retryable: true });
    expect(await read(status(401))).toMatchObject({ failure: "denied", retryable: false });
    expect(await read(status(302, { location: "https://elsewhere.invalid" }))).toMatchObject({
      failure: "denied",
    });
    const hang: FetchLike = (_u, init) =>
      new Promise((_r, reject) =>
        init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    const slow = new GithubSource(ORIGIN, hang, { ...SOURCE_LIMITS, callMs: 30, totalMs: 200 });
    expect(await slow.read(CONN, REPO, "main", null)).toMatchObject({
      failure: "timed_out",
      retryable: true,
    });
  });

  it("deployment records for another commit are kept as not matching; the call budget is finite", async () => {
    const repos = clone();
    const t = fixtureTransport(repos);
    const other: FetchLike = async (url, init) => {
      if (url.includes("/deployments?"))
        return new Response(
          JSON.stringify([{ id: 7, sha: "d4".repeat(20), environment: "staging" }]),
          { status: 200 },
        );
      return t.fetchImpl(url, init);
    };
    const out = await new GithubSource(ORIGIN, other).read(CONN, REPO, "main", null);
    expect(out.ok && out.read.deployments).toMatchObject({
      state: "read",
      records: [{ id: 7, matches_commit: false }],
    });
    const tight = new GithubSource(ORIGIN, t.fetchImpl, { ...SOURCE_LIMITS, calls: 2 });
    expect(await tight.read(CONN, REPO, "main", null)).toMatchObject({
      ok: false,
      failure: "budget_exhausted",
      retryable: true,
    });
  });

  it("refuses malformed repository names and refs, and a non-https origin", async () => {
    const src = new GithubSource(ORIGIN, fixtureTransport(clone()).fetchImpl);
    expect(await src.read(CONN, "../etc", "main", null)).toMatchObject({ ok: false });
    expect(await src.read(CONN, REPO, "main/../../x", null)).toMatchObject({ ok: false });
    expect(
      () => new GithubSource("http://api.github.com", fixtureTransport([]).fetchImpl),
    ).toThrow();
    expect(
      () => new GithubSource("https://api.github.com/evil", fixtureTransport([]).fetchImpl),
    ).toThrow();
  });
});
