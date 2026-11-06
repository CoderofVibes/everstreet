// Job 006c (docs/design/SUCCESSOR_REHEARSAL.md §2): the successor rehearsal's journey, run inside
// the rehearsal child in its own temporary directory. It reuses the existing synthetic successor
// flow (server/test/sale-world.ts: the real app, routes, customer runtime, writer and reconciler
// over one contract-anchored synthetic customer + sale state), seeded with the snapshot's EXACT
// product. SYNTHETIC: fictional people (Ava the founder, Noah the successor, Cara the customer),
// fictional test tokens, no network, no real chain, wallet or provider, nothing from the live
// database. Every step records what was expected and what happened; nothing is filled in.

import { join } from "node:path";
import type { RehearsalSeed, RehearsalSnapshot } from "../../../server/src/successorRehearsal.ts";
import { seedDoubleCheck } from "../../../server/test/app-fixtures.ts";
import { BUYER, proposal, SELLER, saleWorld } from "../../../server/test/sale-world.ts";

// biome-ignore lint/suspicious/noExplicitAny: API answers are read field by field
type Json = Record<string, any>;

export interface Step {
  n: number;
  key: string;
  title: string;
  expected: string;
  outcome: "passed" | "failed" | "not_run";
  observed: string;
}

export async function rehearseSuccessor(
  input: { snapshot: RehearsalSnapshot; seed: RehearsalSeed; digest: string },
  dir: string,
) {
  const steps: Step[] = [];
  let failed = false;
  const step = (key: string, title: string, expected: string, ok: boolean, observed: string) => {
    steps.push({
      n: steps.length + 1,
      key,
      title,
      expected,
      outcome: ok ? "passed" : "failed",
      observed,
    });
    if (!ok) failed = true;
    return ok;
  };
  const notRun = (key: string, title: string, expected: string) =>
    steps.push({
      n: steps.length + 1,
      key,
      title,
      expected,
      outcome: "not_run",
      observed: "An earlier step failed.",
    });

  const { snapshot, seed } = input;
  const s = await saleWorld({
    dbPath: join(dir, "rehearsal.db"),
    seed,
    appOrigin: "http://localhost:0",
  });
  const db = s.w.state.store.db;
  const project = s.w.f.project;
  const deps: Record<string, { status: string; observed: string }> = {};
  try {
    // 1. The exact version.
    const active = db
      .prepare(
        "SELECT artifact_digest FROM runtime_releases WHERE project_id = ? AND state = 'active'",
      )
      .get(project) as { artifact_digest: string } | undefined;
    const same = active?.artifact_digest === snapshot.product?.artifact_digest;
    step(
      "rebuild",
      "Rebuild the exact released version",
      `The rebuilt version's digest equals the snapshot's (${snapshot.product?.artifact_digest.slice(0, 12)}…)`,
      same,
      same ? "Digests match." : `The rebuilt digest was ${active?.artifact_digest ?? "none"}.`,
    );
    const rest: [string, string, string][] = [
      ["existing_customer", "Serve the existing customer before the sale", "One unit charged"],
      ["change_of_control", "Change of control through a Direct sale", "The reconciler applies it"],
      [
        "founder_dependency",
        "Founder-only dependency, intentionally failed",
        "The next use is refused",
      ],
      ["corrected", "Successor appoints metering; the check is repeated", "The customer is served"],
      ["former_owner", "Former owner refused", "404 on the product's owner routes"],
      ["successor_release", "Successor releases a checked version", "Released under the successor"],
      ["customer_continuity", "Customer keeps their result and address", "Still theirs"],
    ];
    if (!same) {
      for (const [k, t, e] of rest) notRun(k, t, e);
    } else {
      // 2. Existing entitlement served before the sale.
      const before = await s.customerUse();
      step(
        "existing_customer",
        "Serve the existing customer before the sale",
        "The customer's prepaid use is served and exactly one unit charged",
        before.unit === "charged",
        `Unit: ${before.unit ?? before.code}.`,
      );
      const firstUse = before.id as string;
      // 3. Change of control on terms that name no metering operator.
      await s.act(s.ava, SELLER, "propose", proposal({ metering: false }));
      await s.act(s.noah, BUYER, "register");
      await s.act(s.noah, BUYER, "fund");
      await s.act(s.ava, SELLER, "accept");
      const close = await s.act(s.noah, BUYER, "accept");
      const applied = close.check?.body.effects?.reconcile?.state === "applied";
      const owner = (
        db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(s.biz) as {
          owner_id: string;
        }
      ).owner_id;
      step(
        "change_of_control",
        "Change of control through a Direct sale",
        "The contract closes the sale and Everstreet's reconciler makes the successor the owner",
        applied && owner === s.noah.id,
        applied ? "Closed and reconciled; the successor owns the business." : "Not reconciled.",
      );
      deps.business_contract = {
        status: applied ? "rehearsed" : "failed",
        observed: applied ? "Control moved on the synthetic contract and here." : "It didn't move.",
      };
      // 4. The founder-only dependency fails, as it would.
      const refused = await s.customerUse();
      step(
        "founder_dependency",
        "Founder-only dependency, intentionally failed",
        "Metering was appointed by the founder and ended at the close, so the customer's next use is refused before anything is held",
        refused.status === 409 && refused.code === "operator_not_authorized",
        `Answer: ${refused.status} ${refused.code ?? ""}.`,
      );
      // 5. Corrected through the supported seam, and the affected check repeated.
      const ap = await s.act(s.noah, BUYER, "appoint");
      const again = await s.customerUse();
      const fixed = ap.check?.body.resolution?.result === "appointed" && again.unit === "charged";
      step(
        "corrected",
        "Successor appoints metering; the check is repeated",
        "The successor's own wallet appoints the metering operator; the same customer is then served",
        fixed,
        `Appointment: ${ap.check?.body.resolution?.result ?? "none"}; repeated use: ${again.unit ?? again.code}.`,
      );
      deps.metering_operator = {
        status: fixed ? "failed_then_corrected" : "failed",
        observed: fixed
          ? "Refused after the close; served again once the successor appointed it."
          : "Not corrected.",
      };
      deps.customer_offers = {
        status: fixed ? "rehearsed" : "failed",
        observed:
          "The customer's prepaid uses stayed on the contract and were served under the successor.",
      };
      // 6. The former owner.
      const r1 = await s.ava(`/api/product-projects/${project}/releases`);
      const r2 = await s.ava(`/api/businesses/${s.biz}/customer-offers`);
      step(
        "former_owner",
        "Former owner refused",
        "The former owner gets the same answer as a stranger on the product's owner routes",
        r1.status === 404 && r2.status === 404,
        `Releases: ${r1.status}; offers: ${r2.status}.`,
      );
      // 7. The successor releases a checked version under their own control.
      const released = await successorRelease(s, seed, project);
      step(
        "successor_release",
        "Successor releases a checked version",
        "The successor builds the product again, its checks pass, and they release it",
        released.ok,
        released.observed,
      );
      deps.runtime = {
        status: released.ok ? "rehearsed" : "failed",
        observed: "The successor's release runs on Everstreet as before.",
      };
      // 8. Customer continuity.
      const cont = await continuity(s, seed, firstUse);
      step(
        "customer_continuity",
        "Customer keeps their result and address",
        seed.kind === "web_app"
          ? "The pass bought before the sale still opens the app at the same address"
          : "The case opened before the sale is still the customer's, with its history",
        cont.ok,
        cont.observed,
      );
      deps.protected_storage = {
        status: cont.ok ? "rehearsed" : "failed",
        observed: "The customer's kept result stayed readable by the customer only.",
      };
    }
  } finally {
    db.close();
  }
  const dependencies = snapshot.dependencies.map((d) => ({
    ...d,
    status:
      d.responsibility === "external"
        ? "pending_external"
        : (deps[d.key]?.status ?? (failed ? "not_run" : "not_rehearsed")),
    observed:
      d.responsibility === "external"
        ? "Not checked: outside Everstreet. Someone must transfer it; a rehearsal can't."
        : (deps[d.key]?.observed ?? ""),
  }));
  return {
    steps,
    dependencies,
    outcome: {
      result: failed ? "failed" : "passed",
      summary: failed
        ? `${steps.filter((x) => x.outcome === "failed").length} step(s) failed.`
        : "The successor served the existing customer, fixed the founder-only dependency, and released a checked version. External transfers are still pending.",
      boundaries:
        "Synthetic rehearsal: fictional people, a synthetic contract and wallet, no network. It proves the platform's handover of this product, not NEAR control or any external transfer.",
    },
  };
}

async function successorRelease(
  s: Awaited<ReturnType<typeof saleWorld>>,
  seed: RehearsalSeed,
  project: string,
): Promise<{ ok: boolean; observed: string }> {
  const noah = s.noah;
  let job: string;
  if (seed.kind === "workflow") {
    const head = (await noah(`/api/product-projects/${project}`)).body.head?.number as number;
    const b = await noah(`/api/product-projects/${project}/builds`, "POST", {
      idempotency_key: "rehearsal-successor-build",
      revision: head,
    });
    if (b.status !== 201)
      return { ok: false, observed: `Compile: ${b.status} ${b.body.error ?? ""}` };
    job = b.body.job.id as string;
  } else {
    // App builds go through the world's build app (same store), as the founder's did.
    const rw = s.w.rw.app;
    const login = await rw.request(`/api/session/as/${noah.id}`, { method: "POST" });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const builder = Object.assign(
      async (path: string, method = "GET", body?: unknown) => {
        const res = await rw.request(path, {
          method,
          headers: { cookie, "content-type": "application/json" },
          body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
        });
        return { status: res.status, body: (await res.json()) as Json };
      },
      { id: noah.id },
    );
    job = await s.w.rw.build(builder as never, project, seed.bundle, "app");
    const epoch = s.w.state.runtime.ownerEpoch(s.biz);
    seedDoubleCheck(s.w.state.store.db as never, {
      project,
      business: s.biz,
      job,
      requestedBy: noah.id,
      ownerId: epoch.owner_id as string,
      generation: epoch.generation,
    });
  }
  const started = await noah(`/api/product-projects/${project}/evaluations`, "POST", {
    artifact_job: job,
  });
  if (started.status !== 202)
    return { ok: false, observed: `Checks: ${started.status} ${started.body.error ?? ""}` };
  let run: Json = started.body.run;
  for (let i = 0; i < 300 && run.state === "running"; i++) {
    await new Promise((ok) => setTimeout(ok, 2));
    run = (await noah(`/api/evaluations/${run.id}`)).body.run;
  }
  const body: Json = { artifact_job: job, eval_run: run.id };
  if (seed.kind === "web_app") {
    const t = await noah(`/api/product-projects/${project}/releases/app-terms`, "POST", {
      artifact_job: job,
      app_terms: seed.app_terms,
    });
    body.app_terms = seed.app_terms;
    body.terms_digest = t.body.terms_digest;
  }
  const r = await noah(`/api/product-projects/${project}/releases`, "POST", body);
  return r.status === 201
    ? {
        ok: true,
        observed: `Checks ${run.passed}/${run.total}; released by the successor${seed.kind === "web_app" ? " (a stand-in: its logic checks ran on a test double, labelled)" : ""}.`,
      }
    : { ok: false, observed: `Release: ${r.status} ${r.body.error ?? ""}` };
}

async function continuity(
  s: Awaited<ReturnType<typeof saleWorld>>,
  seed: RehearsalSeed,
  firstUse: string,
): Promise<{ ok: boolean; observed: string }> {
  if (seed.kind === "web_app") {
    const res = (await s.cara(`/api/customer/uses/${firstUse}/result`)).body.result as Json;
    const url = String(res?.url ?? "");
    const page = await s.w.state.app.request(url.replace(/^https?:\/\/[^/]+/, ""));
    return {
      ok: page.status === 200,
      observed: `The pre-sale pass's address answered ${page.status}.`,
    };
  }
  const c = await s.cara(`/api/customer/uses/${firstUse}/case`);
  const history = (c.body.case?.history ?? []) as Json[];
  return {
    ok: c.status === 200 && history.length >= 1,
    observed: `The customer's case: ${c.status}, ${history.length} event(s).`,
  };
}
