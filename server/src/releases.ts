// Releasing a checked version (docs/design/MANAGED_RUNTIME.md §7). States: candidate (a
// succeeded build), checked (a current run with every case passing), active (one per
// project), retired. Activation and rollback are the owner's explicit choice, in one
// transaction that rechecks owner and generation, that the version was built under the current
// owner, and that its checks are current. A request that started on a release keeps running on
// the artifact it pinned, whatever is activated meanwhile.

import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import type { Evaluations } from "./evaluations.ts";
import type { ManagedRuntime } from "./invocations.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import {
  type AppTerms,
  appIdOf,
  ensureAppId,
  PLATFORM_LIMITATIONS,
  parseAppTerms,
  releaseIsStandIn,
  termsOf,
  termsText,
  WEB_APP_KIND,
  type WebAppSpec,
} from "./webApp.ts";

interface ReleaseRow {
  id: string;
  project_id: string;
  business_id: string;
  artifact_job: string;
  artifact_digest: string;
  eval_run: string;
  fixture_version: number;
  policy: string;
  validator: string;
  provider_config: string;
  state: "active" | "retired";
  rolled_back_from: string | null;
  activated_by: string;
  owner_id: string;
  owner_generation: number;
  activated_at: string;
  retired_at: string | null;
}

export class Releases {
  constructor(
    readonly db: Db,
    readonly store: Store,
    readonly runtime: ManagedRuntime,
    readonly evaluations: Evaluations,
  ) {}

  private active(projectId: string) {
    return this.db
      .prepare("SELECT * FROM runtime_releases WHERE project_id = ? AND state = 'active'")
      .get(projectId) as ReleaseRow | undefined;
  }

  /** Every reason this version can't be released now under this run; empty when it can. */
  private blockers(
    projectId: string,
    artifactJob: string,
    runId: string,
  ): { blockers: string[]; artifact: ReturnType<ManagedRuntime["artifact"]> | null } {
    let artifact: ReturnType<ManagedRuntime["artifact"]> | null = null;
    try {
      artifact = this.runtime.artifact(projectId, artifactJob);
    } catch {
      return { blockers: ["No checked version with that id"], artifact: null };
    }
    const out: string[] = [];
    const business = (
      this.db.prepare("SELECT business_id FROM product_projects WHERE id = ?").get(projectId) as {
        business_id: string;
      }
    ).business_id;
    const epoch = this.runtime.ownerEpoch(business);
    if (artifact.owner_id !== epoch.owner_id || artifact.owner_generation !== epoch.generation)
      out.push(
        "This version was built under a previous owner of the business; build it again as the current owner before releasing",
      );
    const run = this.evaluations.row(runId);
    if (!run || run.project_id !== projectId) out.push("No such check for this product");
    else {
      if (run.artifact_job !== artifactJob || run.artifact_digest !== artifact.digest)
        out.push("That check was for a different version");
      const c = this.evaluations.currency(run);
      out.push(...c.reasons);
      if (!this.runtime.configFor(artifact.checked.kind))
        out.push(this.runtime.availability().reason);
    }
    return { blockers: out, artifact };
  }

  /**
   * 006a: the customer terms of a web app version, for the owner to review before releasing. The
   * digest is what activate() requires, so changed terms always need a fresh review.
   */
  appTerms(
    viewer: Person,
    projectId: string,
    input: { artifact_job?: unknown; app_terms?: unknown },
  ) {
    const p = this.runtime.project(viewer, projectId);
    this.store.requireNoHandover(p.business_id);
    const artifact = this.runtime.artifact(p.id, String(input.artifact_job ?? ""));
    if (artifact.checked.kind !== WEB_APP_KIND)
      throw new HttpError(409, "Only a web app version has access terms", "not_web_app");
    const terms = parseAppTerms(input.app_terms);
    const { digest } = termsText(artifact.checked.spec, terms);
    return { terms: this.termsView(artifact.checked.spec, terms), terms_digest: digest };
  }

  private termsView(spec: WebAppSpec, t: AppTerms) {
    return {
      app: spec.name,
      digest: spec.digest,
      access: t.access,
      pass_days: t.pass_days,
      platform_limitations: PLATFORM_LIMITATIONS,
      limitations: t.limitations,
    };
  }

  activate(
    viewer: Person,
    projectId: string,
    input: {
      artifact_job?: unknown;
      eval_run?: unknown;
      app_terms?: unknown;
      terms_digest?: unknown;
    },
  ) {
    const p = this.runtime.project(viewer, projectId);
    const job = String(input.artifact_job ?? "");
    const runId = String(input.eval_run ?? "");
    this.store.tx(() => {
      this.store.requireNoHandover(p.business_id); // job 003wf3 (W13)
      const { blockers, artifact } = this.blockers(p.id, job, runId);
      if (blockers.length || !artifact) throw new HttpError(409, blockers.join(". "));
      // 006a: a web app is released with reviewed customer terms, written in this transaction.
      let terms: AppTerms | null = null;
      if (artifact.checked.kind === WEB_APP_KIND) {
        terms = parseAppTerms(input.app_terms);
        const { digest } = termsText(artifact.checked.spec, terms);
        if (input.terms_digest !== digest)
          throw new HttpError(
            409,
            "These customer terms weren't the ones reviewed; review them again",
            "terms_not_reviewed",
          );
      }
      const id = this.insert(viewer, p, artifact, runId, null);
      if (terms) this.writeTerms(p.id, id, artifact, terms);
    });
    return this.view(viewer, projectId);
  }

  private writeTerms(
    projectId: string,
    releaseId: string,
    artifact: ReturnType<ManagedRuntime["artifact"]>,
    terms: AppTerms,
  ) {
    if (artifact.checked.kind !== WEB_APP_KIND) return;
    const t = this.runtime.iso();
    ensureAppId(this.db, projectId, t);
    this.db
      .prepare(
        "INSERT INTO app_release_terms (release_id, project_id, access, pass_days, limitations, terms_digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        releaseId,
        projectId,
        terms.access,
        terms.pass_days,
        terms.limitations,
        termsText(artifact.checked.spec, terms).digest,
        t,
      );
  }

  /**
   * 006a: withdraws a web app. The active release is retired and none replaces it: the free
   * address says so, offers admit no new passes, and started passes keep their pinned release.
   */
  withdraw(viewer: Person, projectId: string) {
    const p = this.runtime.project(viewer, projectId);
    this.store.tx(() => {
      this.store.requireNoHandover(p.business_id);
      const a = this.active(p.id);
      if (!a) throw new HttpError(409, "Nothing is released", "not_released");
      if (!termsOf(this.db, a.id))
        throw new HttpError(409, "Only a web app can be withdrawn", "not_web_app");
      this.db
        .prepare(
          "UPDATE runtime_releases SET state = 'retired', retired_at = ? WHERE id = ? AND state = 'active'",
        )
        .run(this.runtime.iso(), a.id);
    });
    return this.view(viewer, projectId);
  }

  /** Points new requests back to an earlier release's version, if its checks are still current. */
  rollback(viewer: Person, projectId: string, releaseId: string) {
    const p = this.runtime.project(viewer, projectId);
    this.store.tx(() => {
      this.store.requireNoHandover(p.business_id); // job 003wf3 (W13)
      const r = this.db
        .prepare("SELECT * FROM runtime_releases WHERE id = ? AND project_id = ?")
        .get(String(releaseId), p.id) as ReleaseRow | undefined;
      if (!r) throw new HttpError(404, "No such release");
      if (r.state === "active") throw new HttpError(409, "That release is already active");
      const { blockers, artifact } = this.blockers(p.id, r.artifact_job, r.eval_run);
      if (blockers.length || !artifact)
        throw new HttpError(
          409,
          `That version needs checking again before it can serve requests: ${blockers.join(". ")}`,
        );
      const id = this.insert(viewer, p, artifact, r.eval_run, r.id);
      // 006a: a web app's rollback restores that release's own customer terms.
      const before = termsOf(this.db, r.id);
      if (before)
        this.writeTerms(p.id, id, artifact, {
          access: before.access,
          pass_days: before.pass_days,
          limitations: before.limitations,
        });
      else if (artifact.checked.kind === WEB_APP_KIND)
        throw new HttpError(409, "That release has no customer terms", "no_terms");
    });
    return this.view(viewer, projectId);
  }

  /** In the caller's transaction: retire the active release and record the new one. */
  private insert(
    viewer: Person,
    p: { id: string; business_id: string },
    artifact: ReturnType<ManagedRuntime["artifact"]>,
    runId: string,
    rolledBackFrom: string | null,
  ) {
    const run = this.evaluations.row(runId);
    if (!run) throw new HttpError(404, "No such check");
    const t = this.runtime.iso();
    const epoch = this.runtime.ownerEpoch(p.business_id);
    const id = randomUUID();
    this.db
      .prepare(
        "UPDATE runtime_releases SET state = 'retired', retired_at = ? WHERE project_id = ? AND state = 'active'",
      )
      .run(t, p.id);
    this.db
      .prepare(
        `INSERT INTO runtime_releases (id, project_id, business_id, artifact_job, artifact_digest, eval_run, fixture_version, policy, validator, provider_config, state, rolled_back_from, activated_by, owner_id, owner_generation, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        p.id,
        p.business_id,
        artifact.job_id,
        artifact.digest,
        runId,
        run.fixture_version,
        run.policy,
        run.validator,
        run.provider_config,
        rolledBackFrom,
        viewer.id,
        epoch.owner_id,
        epoch.generation,
        t,
      );
    return id;
  }

  view(viewer: Person, projectId: string) {
    const p = this.runtime.project(viewer, projectId);
    const releases = this.db
      .prepare(
        "SELECT * FROM runtime_releases WHERE project_id = ? ORDER BY activated_at DESC, rowid DESC LIMIT 30",
      )
      .all(p.id) as unknown as ReleaseRow[];
    const epoch = this.runtime.ownerEpoch(p.business_id);
    const candidates = (
      this.db
        .prepare(
          `SELECT j.id, j.revision, j.owner_id, j.owner_generation, j.finished_at, a.digest
             FROM build_jobs j JOIN build_artifacts a ON a.job_id = j.id
            WHERE j.project_id = ? AND j.intent IN ('build','app') AND j.state = 'succeeded'
            ORDER BY j.created_at DESC, j.rowid DESC LIMIT 20`,
        )
        .all(p.id) as {
        id: string;
        revision: number;
        owner_id: string;
        owner_generation: number;
        finished_at: string;
        digest: string;
      }[]
    ).map((c) => {
      const latest = this.db
        .prepare(
          "SELECT id FROM eval_runs WHERE artifact_job = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .get(c.id) as { id: string } | undefined;
      const run = latest ? this.evaluations.row(latest.id) : undefined;
      const check = run ? this.evaluations.view(run) : null;
      const current_owner =
        c.owner_id === epoch.owner_id && c.owner_generation === epoch.generation;
      return {
        artifact_job: c.id,
        artifact_digest: c.digest,
        revision: c.revision,
        built_at: c.finished_at,
        current_owner,
        latest_check: check
          ? {
              id: check.id,
              passed: check.passed,
              total: check.total,
              release_ready: check.release_ready,
              reasons: check.reasons,
            }
          : null,
        status: releases.some((r) => r.state === "active" && r.artifact_job === c.id)
          ? "active"
          : check?.release_ready && current_owner
            ? "checked"
            : "candidate",
      };
    });
    return {
      active: (() => {
        const a = this.active(p.id);
        return a ? this.releaseView(a) : null;
      })(),
      releases: releases.map((r) => this.releaseView(r)),
      candidates,
      note: "Only you can run it until customers are connected. A request keeps the version it started on, even if you release or roll back meanwhile.",
      // 006a: a web app's stable customer address (made at its first release).
      app: (() => {
        const id = appIdOf(this.db, p.id);
        return id
          ? {
              app_id: id,
              free_url: this.runtime.appOrigin
                ? `${this.runtime.appOrigin}/a/${id}/index.html`
                : null,
            }
          : null;
      })(),
    };
  }

  private releaseView(r: ReleaseRow) {
    const run = this.evaluations.row(r.eval_run);
    const c = run ? this.evaluations.currency(run) : { current: false, reasons: ["Check missing"] };
    return {
      id: r.id,
      artifact_job: r.artifact_job,
      artifact_digest: r.artifact_digest,
      eval_run: r.eval_run,
      fixture_version: r.fixture_version,
      policy: r.policy,
      validator: r.validator,
      provider_config: JSON.parse(r.provider_config) as object,
      state: r.state,
      rolled_back_from: r.rolled_back_from,
      activated_at: r.activated_at,
      retired_at: r.retired_at,
      checks_current: c.current,
      reasons: c.reasons,
      // 006a: a web app release's customer terms, and whether it is a labelled stand-in.
      app_terms: (() => {
        const t = termsOf(this.db, r.id);
        return t
          ? {
              access: t.access,
              pass_days: t.pass_days,
              platform_limitations: PLATFORM_LIMITATIONS,
              limitations: t.limitations,
              terms_digest: t.terms_digest,
            }
          : null;
      })(),
      stand_in: releaseIsStandIn(this.db, r.id),
    };
  }
}
