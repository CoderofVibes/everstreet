// Job 006a (docs/design/WEB_APP_RELEASE.md): a web app version released to customers, through the
// real routes. The founder builds the fictional quote app (scripted build provider), its isolated
// logic check is a TEST DOUBLE's passed report (a fixture row here; the check path itself is
// proven in app-checks.test.ts), and stand-in releases are on unless a test turns them off. Free
// access at a stable address; an access pass bought with one unit, pinned to the release it was
// bought on; update, rollback and withdrawal; the stand-in gate; a change of owner. The chain is
// the labelled fixture double. Fictional data only.

import { describe, expect, it } from "vitest";
import { QUOTE_BUNDLE, QUOTE_BUNDLE_V2, seedDoubleCheck } from "./app-fixtures.ts";
import { customerWorld, type Json, SyntheticProtection } from "./customer-world.ts";

const APP_ORIGIN = "http://localhost:4999";

async function world(standIn = true) {
  const shift = { ms: 0 };
  const protection = new SyntheticProtection();
  const w = await customerWorld({
    customer: { protection },
    runtime: {
      appOrigin: APP_ORIGIN,
      appStandIn: standIn,
      now: () => Date.now() + shift.ms,
    },
  });
  const { f, owner } = w;
  /** Builds an app version and records its test double's passed logic check. */
  const version = async (bundle: unknown, checked = true) => {
    const job = await w.rw.build(f.ava, f.project, bundle, "app");
    const a = w.state.store.db
      .prepare("SELECT digest FROM build_artifacts WHERE job_id = ?")
      .get(job) as { digest: string };
    if (checked) {
      const epoch = w.state.runtime.ownerEpoch(f.business);
      seedDoubleCheck(w.state.store.db as never, {
        project: f.project,
        business: f.business,
        job,
        requestedBy: f.ava.id,
        ownerId: epoch.owner_id as string,
        generation: epoch.generation,
      });
    }
    return { job, digest: a.digest };
  };
  const check = async (job: string) => {
    const r = await owner(`/api/product-projects/${f.project}/evaluations`, "POST", {
      artifact_job: job,
    });
    return r;
  };
  /** Reviews the terms, then releases the version with them. */
  const release = async (job: string, appTerms: Json) => {
    const run = await check(job);
    expect(run.status, JSON.stringify(run.body)).toBe(202);
    const t = await owner(`/api/product-projects/${f.project}/releases/app-terms`, "POST", {
      artifact_job: job,
      app_terms: appTerms,
    });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    const r = await owner(`/api/product-projects/${f.project}/releases`, "POST", {
      artifact_job: job,
      eval_run: run.body.run.id,
      app_terms: appTerms,
      terms_digest: t.body.terms_digest,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  /** GET on the app site (path only; the composition serves both sites). */
  const open = async (url: string) => {
    const res = await w.state.app.request(url.replace(APP_ORIGIN, ""));
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
  /** Offers the active pass release and buys one pass as Cara. */
  const offerActive = async (retention = 30) => {
    const active = (await owner(`/api/product-projects/${f.project}/releases`)).body.active;
    const terms = { release_id: active.id, plan_id: 1, retention_days: retention };
    const ins = await owner(
      `/api/businesses/${f.business}/customer-offer-inspections`,
      "POST",
      terms,
    );
    if (ins.status !== 200) return { status: ins.status, body: ins.body, offer: "" };
    const made = await owner(`/api/businesses/${f.business}/customer-offers`, "POST", {
      ...terms,
      idempotency_key: `app-offer-${active.id.slice(0, 8)}`,
      reviewed_terms: ins.body.inspection.terms_digest,
    });
    return { status: made.status, body: made.body, offer: made.body.offer?.id as string };
  };
  let n = 0;
  const buy = async (offer: string) => {
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: `app-pass-${String(++n).padStart(4, "0")}`,
      input: "Access pass",
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const id = p.body.use.id as string;
    const c = await w.cara(
      `/api/customer/uses/${id}/confirm`,
      "POST",
      w.signed(p.body.use.envelope),
    );
    expect(c.body.use.state).toBe("reserved");
    const x = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(x.status, JSON.stringify(x.body)).toBe(200);
    return { id, execution: x.body.use.execution as Json };
  };
  return { w, f, owner, shift, version, check, release, open, offerActive, buy };
}

describe("006a web app releases", () => {
  it("free access: a stable address serving the active release; update, rollback, withdrawal", async () => {
    const t = await world();
    const v1 = await t.version(QUOTE_BUNDLE);
    const v2 = await t.version(QUOTE_BUNDLE_V2);
    const view = await t.release(v1.job, { access: "free", limitations: "Estimates only." });
    expect(view.active).toMatchObject({
      artifact_digest: v1.digest,
      validator: "web-app-release/1",
      stand_in: true,
      app_terms: { access: "free", pass_days: null, limitations: "Estimates only." },
    });
    const url = view.app.free_url as string;
    expect(url).toMatch(/^http:\/\/localhost:4999\/a\/[A-Za-z0-9_-]{16}\/index\.html$/);
    // The published business page lists it, with what it is.
    await t.owner(`/api/businesses/${t.f.business}`, "PATCH", { name: "Lumen Parse" });
    await t.owner(`/api/businesses/${t.f.business}/offer`, "PATCH", { title: "Quote app" });
    await t.owner(`/api/businesses/${t.f.business}/publish`, "POST", {});
    const slug = (await t.owner(`/api/businesses/${t.f.business}`)).body.business?.slug;
    const listed = await t.w.cara(`/api/public/businesses/${slug}/customer-offers`);
    expect(listed.body.apps, JSON.stringify(listed.body)).toEqual([
      expect.objectContaining({ name: "Lumen Parse plan estimator", url, stand_in: true }),
    ]);
    const doc = await t.open(url);
    expect(doc.status).toBe(200);
    expect(doc.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(doc.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(doc.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(doc.headers.get("set-cookie")).toBeNull();
    expect(doc.text).toContain("Stand-in release");
    const js = (u: string) => t.open(u.replace("index.html", "estimate.js"));
    expect((await js(url)).text).toContain("? 45 : 12");
    // A free release can't be offered: there is nothing to charge for.
    const offered = await t.offerActive();
    expect(offered.body.code).toBe("app_is_free");
    // Owners use the preview; a web app isn't tried on the runtime.
    const trial = await t.owner(
      `/api/product-projects/${t.f.project}/runtime/invocations`,
      "POST",
      {
        idempotency_key: "app-trial-0001",
        artifact_job: v1.job,
        text: "x",
      },
    );
    expect(trial.body.code).toBe("web_app_trial");
    // An update keeps the address and serves the new version.
    const updated = await t.release(v2.job, { access: "free", limitations: "" });
    expect(updated.app.free_url).toBe(url);
    expect((await js(url)).text).toContain("? 40 : 12");
    // Rollback restores the earlier release's own version and terms.
    const first = (updated.releases as Json[]).find((r) => r.artifact_job === v1.job) as Json;
    const back = await t.owner(
      `/api/product-projects/${t.f.project}/releases/${first.id}/rollback`,
      "POST",
      {},
    );
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.active.app_terms).toMatchObject({
      access: "free",
      limitations: "Estimates only.",
    });
    expect((await js(url)).text).toContain("? 45 : 12");
    // Withdrawn: nothing older is served in its place.
    const gone = await t.owner(
      `/api/product-projects/${t.f.project}/releases/withdraw`,
      "POST",
      {},
    );
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect(gone.body.active).toBeNull();
    const w = await t.open(url);
    expect(w.status).toBe(410);
    expect(w.text).toContain("withdrew");
    expect(
      (await t.owner(`/api/product-projects/${t.f.project}/releases/withdraw`, "POST", {})).body
        .code,
    ).toBe("not_released");
  });

  it("terms must be the reviewed ones; a pass lasts 1 to 365 days", async () => {
    const t = await world();
    const v1 = await t.version(QUOTE_BUNDLE);
    const run = await t.check(v1.job);
    const reviewed = await t.owner(
      `/api/product-projects/${t.f.project}/releases/app-terms`,
      "POST",
      {
        artifact_job: v1.job,
        app_terms: { access: "pass", pass_days: 7 },
      },
    );
    expect(reviewed.body.terms).toMatchObject({ access: "pass", pass_days: 7 });
    const changed = await t.owner(`/api/product-projects/${t.f.project}/releases`, "POST", {
      artifact_job: v1.job,
      eval_run: run.body.run.id,
      app_terms: { access: "pass", pass_days: 30 },
      terms_digest: reviewed.body.terms_digest,
    });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe("terms_not_reviewed");
    const none = await t.owner(`/api/product-projects/${t.f.project}/releases`, "POST", {
      artifact_job: v1.job,
      eval_run: run.body.run.id,
    });
    expect(none.body.code).toBe("bad_app_terms");
    const long = await t.owner(`/api/product-projects/${t.f.project}/releases/app-terms`, "POST", {
      artifact_job: v1.job,
      app_terms: { access: "pass", pass_days: 366 },
    });
    expect(long.body.code).toBe("bad_app_terms");
    // An extraction version has no access terms.
    const ex = await t.owner(`/api/product-projects/${t.f.project}/releases/app-terms`, "POST", {
      artifact_job: t.f.job,
      app_terms: { access: "free" },
    });
    expect(ex.body.code).toBe("not_web_app");
    // Nothing was released by any of this.
    const v = (await t.owner(`/api/product-projects/${t.f.project}/releases`)).body;
    expect(v.active.artifact_job).toBe(t.f.job);
  });

  it("an access pass: one unit charged when access starts, private address pinned to its release until it expires", async () => {
    const t = await world();
    const v1 = await t.version(QUOTE_BUNDLE);
    const v2 = await t.version(QUOTE_BUNDLE_V2);
    await t.release(v1.job, { access: "pass", pass_days: 7, limitations: "Estimates only." });
    // The result must be kept as long as the pass lasts, so the customer can reopen the app.
    expect((await t.offerActive(3)).body.code).toBe("retention_short");
    const o = await t.offerActive(30);
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    await t.owner(`/api/businesses/${t.f.business}`, "PATCH", { name: "Lumen Parse" });
    await t.owner(`/api/businesses/${t.f.business}/offer`, "PATCH", { title: "Quote app" });
    const pb = await t.owner(`/api/businesses/${t.f.business}/publish`, "POST", {});
    expect(pb.status, JSON.stringify(pb.body)).toBeLessThan(300);
    const pubr = await t.w.cara(`/api/public/customer-offers/${o.offer}`);
    expect(pubr.status, JSON.stringify(pubr.body)).toBe(200);
    const pub = pubr.body.offer;
    expect(pub.product).toMatchObject({
      kind: "web_app",
      name: "Lumen Parse plan estimator",
      pass_days: 7,
      limitations: "Estimates only.",
      stand_in: true,
    });
    expect(pub.product.platform_limitations).toContain("Runs only in your browser");
    const { id, execution } = await t.buy(o.offer);
    expect(execution).toMatchObject({ state: "completed", outcome: "granted", fulfilled: true });
    const result = (await t.w.cara(`/api/customer/uses/${id}/result`)).body.result as Json;
    expect(result).toMatchObject({ outcome: "granted", pass_days: 7, digest: v1.digest });
    expect(Date.parse(result.expires_at) - Date.parse(result.starts_at)).toBe(7 * 86_400_000);
    const url = result.url as string;
    expect(url).toMatch(/^http:\/\/localhost:4999\/p\/[A-Za-z0-9_-]{43}\/index\.html$/);
    // Only the token's hash is stored.
    const row = t.w.state.store.db.prepare("SELECT * FROM app_passes").get() as Json;
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(url.split("/")[4]);
    const doc = await t.open(url);
    expect(doc.status).toBe(200);
    expect(doc.text).toContain("Stand-in release");
    const js = () => t.open(url.replace("index.html", "estimate.js"));
    expect((await js()).text).toContain("? 45 : 12");
    // The pass's free address doesn't exist: a pass release is not free.
    const view = (await t.owner(`/api/product-projects/${t.f.project}/releases`)).body;
    expect((await t.open(view.app.free_url)).status).toBe(403);
    // An update: new passes would get v2, this one keeps v1.
    await t.release(v2.job, { access: "pass", pass_days: 7, limitations: "" });
    // The offer for the replaced release can't admit anyone, so the public page doesn't list it.
    const slug = (await t.owner(`/api/businesses/${t.f.business}`)).body.business?.slug;
    expect((await t.w.cara(`/api/public/businesses/${slug}/customer-offers`)).body.offers).toEqual(
      [],
    );
    expect((await js()).text).toContain("? 45 : 12");
    // The old offer names the retired release: no new pass from it.
    const again = await t.w.cara(`/api/customer/offers/${o.offer}/prepare`, "POST", {
      idempotency_key: "app-pass-after-update",
      input: "Access pass",
    });
    expect(again.status).toBe(409);
    // Withdrawn: started passes keep their pinned release.
    await t.owner(`/api/product-projects/${t.f.project}/releases/withdraw`, "POST", {});
    expect((await js()).text).toContain("? 45 : 12");
    // Expired.
    t.shift.ms = 7 * 86_400_000 + 1000;
    const ended = await t.open(url);
    expect(ended.status).toBe(410);
    expect(ended.text).toContain("This pass has ended");
    // A wrong or unknown token is not found.
    expect((await t.open(url.replace(/\/p\/.{43}\//, `/p/${"A".repeat(43)}/`))).status).toBe(404);
  });

  it("a version whose logic checks haven't passed can't be released", async () => {
    const t = await world();
    const v1 = await t.version(QUOTE_BUNDLE, false);
    const r = await t.check(v1.job);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("not_checked");
  });

  it("stand-in releases off: a test double's check isn't release evidence, and stand-in releases stop serving", async () => {
    const off = await world(false);
    const v = await off.version(QUOTE_BUNDLE);
    const r = await off.check(v.job);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("checks_on_double");

    // Released while stand-ins were on; then the server restarts with them off.
    const t = await world(true);
    const v1 = await t.version(QUOTE_BUNDLE);
    const view = await t.release(v1.job, { access: "free" });
    const url = view.app.free_url as string;
    expect((await t.open(url)).status).toBe(200);
    const runtime = t.w.runtimeFor(t.w.state.store);
    const strict = new (
      runtime.constructor as typeof import("../src/invocations.ts").ManagedRuntime
    )(t.w.state.store.db, t.w.state.store, null, {
      ceilingCents: 1_000,
      appOrigin: APP_ORIGIN,
      appStandIn: false,
    });
    t.w.state.app = t.w.make(t.w.state.store, strict);
    expect((await t.open(url)).status).toBe(503);
    const after = (await t.owner(`/api/product-projects/${t.f.project}/releases`)).body;
    expect(after.active.checks_current).toBe(false);
    expect(after.active.reasons.join(" ")).toMatch(/test double/);
  });

  it("after a change of owner: the seller can't release or withdraw, the buyer can; the address stays", async () => {
    const t = await world();
    const v1 = await t.version(QUOTE_BUNDLE);
    const view = await t.release(v1.job, { access: "free" });
    const url = view.app.free_url as string;
    const bo = t.w.person("Bo Lindqvist");
    t.w.rw.transfer(t.f.business, t.f.ava.id, bo.id);
    expect(
      (await t.owner(`/api/product-projects/${t.f.project}/releases/withdraw`, "POST", {})).status,
    ).toBe(404);
    expect((await t.open(url)).status).toBe(200);
    // The buyer's view has the same address; the version was built under the seller, so the
    // buyer must rebuild before releasing, but may withdraw.
    const bv = (await bo(`/api/product-projects/${t.f.project}/releases`)).body;
    expect(bv.app.free_url).toBe(url);
    const gone = await bo(`/api/product-projects/${t.f.project}/releases/withdraw`, "POST", {});
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect((await t.open(url)).status).toBe(410);
  });
});
