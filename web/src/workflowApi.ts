// The workflow engine's cases (docs/design/WORKFLOW_ENGINE.md §5), for the browser: the owner's
// case board and one case, the owner's one-stage move, and a customer's own case. Every answer is
// checked before it is shown; anything unexpected is refused as malformed. Browser-side types only.

import { call, MalformedAnswer } from "./customerApi.ts";

export interface CaseStage {
  key: string;
  label: string;
}
export interface CaseEvent {
  at: string;
  actor_kind: "customer" | "staff" | "system";
  /** Staff only (review #64): which account moved this step. */
  actor_account?: string | null;
  from_stage: string | null;
  to_stage: string;
  note: string;
}
export interface CaseView {
  request_id: string;
  stage: CaseStage & { final: boolean };
  next: CaseStage | null;
  stages: CaseStage[];
  /** Whether the release this case was opened under is the one serving new requests now. */
  on_current_release: boolean;
  assigned: boolean;
  /** Staff only (review #40): who it's assigned to. */
  assignee?: string | null;
  /** Staff only (review #39): an open request's subject. */
  title?: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  history: CaseEvent[];
}
export interface CaseDetail {
  case: CaseView;
  fields: { key: string; label: string; value: string }[] | null;
  content_note: string | null;
}

const fail = (where: string): never => {
  throw new MalformedAnswer(`The answer wasn't in the expected shape (${where}).`);
};
const obj = (v: unknown, where: string) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(where);
const str = (v: unknown, where: string) => (typeof v === "string" ? v : fail(where));
const arr = (v: unknown, where: string) => (Array.isArray(v) ? v : fail(where));
const strOrNull = (v: unknown, where: string) => (v === null ? null : str(v, where));
const stage = (v: unknown, where: string): CaseStage => {
  const s = obj(v, where);
  return { key: str(s.key, `${where}.key`), label: str(s.label, `${where}.label`) };
};

export function parseCase(raw: unknown): CaseView {
  const c = obj(raw, "case");
  const st = obj(c.stage, "case.stage");
  return {
    request_id: str(c.request_id, "case.request_id"),
    stage: { ...stage(st, "case.stage"), final: st.final === true },
    next: c.next === null ? null : stage(c.next, "case.next"),
    stages: arr(c.stages, "case.stages")
      .slice(0, 12)
      .map((s) => stage(s, "case.stages")),
    on_current_release: c.on_current_release === true,
    assigned: c.assigned === true,
    assignee: typeof c.assignee === "string" ? c.assignee : null,
    title: typeof c.title === "string" ? c.title : null,
    created_at: str(c.created_at, "case.created_at"),
    updated_at: str(c.updated_at, "case.updated_at"),
    closed_at: strOrNull(c.closed_at, "case.closed_at"),
    history: arr(c.history, "case.history")
      .slice(0, 200)
      .map((e) => {
        const x = obj(e, "case.event");
        const kind = str(x.actor_kind, "case.event.actor");
        return {
          at: str(x.at, "case.event.at"),
          actor_kind: (["customer", "staff", "system"].includes(kind)
            ? kind
            : fail("case.event.actor")) as CaseEvent["actor_kind"],
          actor_account: typeof x.actor_account === "string" ? x.actor_account : null,
          from_stage: strOrNull(x.from_stage, "case.event.from"),
          to_stage: str(x.to_stage, "case.event.to"),
          note: typeof x.note === "string" ? x.note : "",
        };
      }),
  };
}

function parseDetail(raw: unknown): CaseDetail {
  const o = obj(raw, "answer");
  return {
    case: parseCase(o.case),
    fields:
      o.fields === null
        ? null
        : arr(o.fields, "fields")
            .slice(0, 40)
            .map((f) => {
              const x = obj(f, "field");
              return {
                key: str(x.key, "field.key"),
                label: str(x.label, "field.label"),
                value: str(x.value, "field.value"),
              };
            }),
    content_note: strOrNull(o.content_note ?? null, "content_note"),
  };
}

const enc = encodeURIComponent;

export const workflowApi = {
  /** The owner's case board for a business (open cases first). */
  async board(businessId: string): Promise<{ has_workflow: boolean; cases: CaseView[] }> {
    const o = obj(await call(`/api/businesses/${enc(businessId)}/workflow-cases`), "answer");
    return {
      has_workflow: o.has_workflow === true,
      cases: arr(o.cases, "cases")
        .slice(0, 200)
        .map((c) => parseCase(c)),
    };
  },
  async one(businessId: string, requestId: string): Promise<CaseDetail> {
    return parseDetail(
      await call(`/api/businesses/${enc(businessId)}/workflow-cases/${enc(requestId)}`),
    );
  },
  /** Moves a case to its next stage only; the server refuses any other move. */
  async advance(businessId: string, requestId: string, toStage: string, note: string) {
    const o = obj(
      await call(
        `/api/businesses/${enc(businessId)}/workflow-cases/${enc(requestId)}/advance`,
        "POST",
        { to_stage: toStage, note },
      ),
      "answer",
    );
    return parseCase(o.case);
  },
  /** A customer's own case for one of their requests, or null before it is opened. */
  async mine(requestId: string): Promise<CaseView | null> {
    const o = obj(await call(`/api/customer/uses/${enc(requestId)}/case`), "answer");
    return o.case === null ? null : parseCase(o.case);
  },
};

/** A workflow submission as the engine reads it: one JSON object of text values, keys sorted. */
export function canonicalSubmission(fields: Record<string, string>): string {
  const keys = Object.keys(fields)
    .filter((k) => fields[k] !== "")
    .sort();
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, fields[k]])));
}

/** The fields of a draft submission (an empty object for anything else). */
export function submissionOf(draft: string): Record<string, string> {
  try {
    const v = JSON.parse(draft) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string"),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}
