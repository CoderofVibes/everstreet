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
      if (!this.runtime.configNow()) out.push(this.runtime.availability().reason);
    }
    return { blockers: out, artifact };
  }

  activate(
    viewer: Person,
    projectId: string,
    input: { artifact_job?: unknown; eval_run?: unknown },
  ) {
    const p = this.runtime.project(viewer, projectId);
    const job = String(input.artifact_job ?? "");
    const runId = String(input.eval_run ?? "");
    this.store.tx(() => {
      const { blockers, artifact } = this.blockers(p.id, job, runId);
      if (blockers.length || !artifact) throw new HttpError(409, blockers.join(". "));
      this.insert(viewer, p, artifact, runId, null);
    });
    return this.view(viewer, projectId);
  }

  /** Points new requests back to an earlier release's version, if its checks are still current. */
  rollback(viewer: Person, projectId: string, releaseId: string) {
    const p = this.runtime.project(viewer, projectId);
    this.store.tx(() => {
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
      this.insert(viewer, p, artifact, r.eval_run, r.id);
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
        randomUUID(),
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
            WHERE j.project_id = ? AND j.intent = 'build' AND j.state = 'succeeded'
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
    };
  }
}
