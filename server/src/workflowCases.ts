// The workflow engine's lifecycle after intake (docs/design/WORKFLOW_ENGINE.md §5): one case per
// accepted, delivered request, created in the SAME transaction that records the delivery (so a
// delivered request always has exactly one case). The business's CURRENT owner moves it to the
// next stage only; the final stage closes it. Every move is an append-only event, visible to the
// customer. The request's content is read from its protected copy, for the customer or the
// current owner only. Cases belong to the business: after a sale the buyer works them and the
// seller can't.

import { type Db, WORKFLOW_CASES_SCHEMA } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import { validateWorkflowSpec, type WorkflowSpec } from "./workflow.ts";

interface CaseRow {
  request_id: string;
  business_id: string;
  offer_id: string;
  project_id: string;
  release_id: string;
  stage: string;
  assignee_account: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

const iso = () => new Date().toISOString();

/**
 * Opens the case for a delivered, accepted request, inside the CALLER's transaction (the one that
 * records the delivery). Idempotent: a second call changes nothing.
 */
export function openCase(
  db: Db,
  r: { id: string; business_id: string; offer_id: string; project_id: string; release_id: string },
  stage: string,
) {
  db.exec(WORKFLOW_CASES_SCHEMA);
  const t = iso();
  const c = db
    .prepare(
      "INSERT OR IGNORE INTO workflow_cases (request_id, business_id, offer_id, project_id, release_id, stage, assignee_account, created_at, updated_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)",
    )
    .run(r.id, r.business_id, r.offer_id, r.project_id, r.release_id, stage, t, t);
  if (c.changes === 1)
    db.prepare(
      "INSERT INTO workflow_case_events (request_id, at, actor_kind, actor_account, from_stage, to_stage, note) VALUES (?, ?, 'system', NULL, NULL, ?, 'Received')",
    ).run(r.id, t, stage);
}

export interface CaseContent {
  load: (requestId: string) => Promise<Record<string, string> | null>;
}

export class WorkflowCases {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    /** Reads a request's submitted fields from its protected copy (the server holds the keys). */
    private readonly content: CaseContent,
  ) {
    db.exec(WORKFLOW_CASES_SCHEMA);
  }

  private row(requestId: string) {
    return this.db.prepare("SELECT * FROM workflow_cases WHERE request_id = ?").get(requestId) as
      | CaseRow
      | undefined;
  }

  private specOf(c: CaseRow): WorkflowSpec {
    const a = this.db
      .prepare(
        "SELECT a.kind, a.content FROM runtime_releases r JOIN build_artifacts a ON a.job_id = r.artifact_job WHERE r.id = ?",
      )
      .get(c.release_id) as { kind: string; content: string } | undefined;
    const spec = a?.kind === "workflow_spec" ? validateWorkflowSpec(JSON.parse(a.content)) : null;
    if (!spec) throw new HttpError(409, "This case's workflow can't be read");
    return spec;
  }

  private events(requestId: string) {
    return (
      this.db
        .prepare(
          "SELECT at, actor_kind, from_stage, to_stage, note FROM workflow_case_events WHERE request_id = ? ORDER BY n",
        )
        .all(requestId) as {
        at: string;
        actor_kind: string;
        from_stage: string | null;
        to_stage: string;
        note: string;
      }[]
    ).map((e) => ({ ...e }));
  }

  private view(c: CaseRow) {
    const spec = this.specOf(c);
    const stage = spec.stages.find((s) => s.key === c.stage);
    const i = spec.stages.findIndex((s) => s.key === c.stage);
    const next = i >= 0 && i < spec.stages.length - 1 ? spec.stages[i + 1] : null;
    return {
      request_id: c.request_id,
      stage: { key: c.stage, label: stage?.label ?? c.stage, final: stage?.final ?? false },
      next: next ? { key: next.key, label: next.label } : null,
      stages: spec.stages.map((s) => ({ key: s.key, label: s.label })),
      assigned: c.assignee_account !== null,
      created_at: c.created_at,
      updated_at: c.updated_at,
      closed_at: c.closed_at,
      history: this.events(c.request_id),
    };
  }

  // ---------- the business's staff (its current owner) ----------

  list(viewer: Person, businessId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const rows = this.db
      .prepare(
        "SELECT * FROM workflow_cases WHERE business_id = ? ORDER BY closed_at IS NOT NULL, created_at DESC LIMIT 200",
      )
      .all(businessId) as unknown as CaseRow[];
    const hasWorkflow = !!this.db
      .prepare(
        "SELECT 1 FROM product_projects WHERE business_id = ? AND foundation = 'saas_workflow'",
      )
      .get(businessId);
    return { has_workflow: hasWorkflow || rows.length > 0, cases: rows.map((c) => this.view(c)) };
  }

  async one(viewer: Person, businessId: string, requestId: string) {
    this.store.ownedBusiness(viewer, businessId);
    const c = this.row(requestId);
    if (!c || c.business_id !== businessId) throw new HttpError(404, "No such case");
    const epoch = this.store.controlEpoch(viewer, businessId);
    const fields = await this.content.load(requestId).catch(() => null);
    // Control may have moved while the content was read: nothing is returned then.
    this.store.stillControls(viewer, epoch, { handover: "allow" });
    const spec = this.specOf(c);
    return {
      case: this.view(c),
      fields: fields
        ? spec.intake.fields
            .filter((f) => fields[f.key] !== undefined)
            .map((f) => ({ key: f.key, label: f.label, value: fields[f.key] as string }))
        : null,
      content_note: fields
        ? null
        : "The request's content couldn't be read (it may have passed its retention).",
    };
  }

  /** The owner moves a case to the NEXT stage only; the final stage closes it. */
  advance(viewer: Person, businessId: string, requestId: string, input: Record<string, unknown>) {
    const to = typeof input.to_stage === "string" ? input.to_stage : "";
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
    const epoch = this.store.controlEpoch(viewer, businessId);
    return this.store.tx(() => {
      this.store.stillControls(viewer, epoch);
      this.store.requireNoHandover(businessId);
      const c = this.row(requestId);
      if (!c || c.business_id !== businessId) throw new HttpError(404, "No such case");
      if (c.closed_at) throw new HttpError(409, "This case is closed", "case_closed");
      const spec = this.specOf(c);
      const i = spec.stages.findIndex((s) => s.key === c.stage);
      const next = spec.stages[i + 1];
      if (!next || next.key !== to)
        throw new HttpError(
          409,
          `A case moves to its next stage only${next ? ` (${next.label})` : ""}`,
          "not_next_stage",
        );
      const account = (
        this.db
          .prepare(
            "SELECT account_id FROM chain_accounts WHERE owner_kind = 'person' AND owner_id = ?",
          )
          .get(viewer.id) as { account_id: string } | undefined
      )?.account_id;
      const t = iso();
      this.db
        .prepare(
          "UPDATE workflow_cases SET stage = ?, assignee_account = COALESCE(assignee_account, ?), updated_at = ?, closed_at = ? WHERE request_id = ? AND stage = ?",
        )
        .run(next.key, account ?? viewer.id, t, next.final ? t : null, requestId, c.stage);
      this.db
        .prepare(
          "INSERT INTO workflow_case_events (request_id, at, actor_kind, actor_account, from_stage, to_stage, note) VALUES (?, ?, 'staff', ?, ?, ?, ?)",
        )
        .run(requestId, t, account ?? null, c.stage, next.key, note);
      return { case: this.view(this.row(requestId) as CaseRow) };
    });
  }

  // ---------- the customer ----------

  forCustomer(viewer: Person, requestId: string) {
    const r = this.db
      .prepare("SELECT person_id FROM customer_requests WHERE id = ?")
      .get(requestId) as { person_id: string } | undefined;
    if (r?.person_id !== viewer.id) throw new HttpError(404, "No such request");
    const c = this.row(requestId);
    if (!c) return { case: null };
    return { case: this.view(c) };
  }
}
