// Job 006c (docs/design/SUCCESSOR_REHEARSAL.md): the owner's successor rehearsals for the browser.
// Every answer is checked before it is shown; anything unexpected is refused as malformed.

import { call, MalformedAnswer } from "./customerApi.ts";

export type RehearsalState = "running" | "passed" | "failed" | "interrupted" | "stale";
export interface RehearsalStep {
  n: number;
  key: string;
  title: string;
  expected: string;
  outcome: "passed" | "failed" | "not_run";
  observed: string;
}
export interface RehearsalDependency {
  key: string;
  label: string;
  responsibility: string;
  note: string;
  status: string;
  observed: string;
}
export interface Rehearsal {
  id: string;
  state: RehearsalState;
  detail: string;
  started_at: string;
  finished_at: string | null;
  steps: RehearsalStep[];
  dependencies: RehearsalDependency[];
  outcome: { result: string; summary: string; boundaries: string } | null;
  record_digest: string | null;
}
export interface Rehearsals {
  available: boolean;
  unavailable_reason: string | null;
  product: {
    kind: string;
    artifact_digest: string;
    supported: boolean;
    reason: string | null;
  } | null;
  rehearsals: Rehearsal[];
}

const fail = (where: string): never => {
  throw new MalformedAnswer(`The answer wasn't in the expected shape (${where}).`);
};
const obj = (v: unknown, where: string) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(where);
const str = (v: unknown, where: string) => (typeof v === "string" ? v : fail(where));
const STATES = ["running", "passed", "failed", "interrupted", "stale"] as const;
const OUTCOMES = ["passed", "failed", "not_run"] as const;

function parseRehearsal(raw: unknown): Rehearsal {
  const r = obj(raw, "rehearsal");
  const state = r.state as RehearsalState;
  if (!STATES.includes(state)) fail("rehearsal.state");
  const o = r.outcome === null ? null : obj(r.outcome, "rehearsal.outcome");
  return {
    id: str(r.id, "rehearsal.id"),
    state,
    detail: str(r.detail, "rehearsal.detail"),
    started_at: str(r.started_at, "rehearsal.started_at"),
    finished_at: r.finished_at === null ? null : str(r.finished_at, "rehearsal.finished_at"),
    steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 20).map((x) => {
      const s = obj(x, "step");
      const outcome = s.outcome as RehearsalStep["outcome"];
      if (!OUTCOMES.includes(outcome)) fail("step.outcome");
      return {
        n: typeof s.n === "number" ? s.n : 0,
        key: str(s.key, "step.key"),
        title: str(s.title, "step.title"),
        expected: str(s.expected, "step.expected"),
        outcome,
        observed: str(s.observed, "step.observed"),
      };
    }),
    dependencies: (Array.isArray(r.dependencies) ? r.dependencies : []).slice(0, 30).map((x) => {
      const d = obj(x, "dependency");
      return {
        key: str(d.key, "dependency.key"),
        label: str(d.label, "dependency.label"),
        responsibility: str(d.responsibility, "dependency.responsibility"),
        note: str(d.note, "dependency.note"),
        status: str(d.status, "dependency.status"),
        observed: typeof d.observed === "string" ? d.observed : "",
      };
    }),
    outcome: o
      ? {
          result: str(o.result, "outcome.result"),
          summary: str(o.summary, "outcome.summary"),
          boundaries: str(o.boundaries, "outcome.boundaries"),
        }
      : null,
    record_digest: r.record_digest === null ? null : str(r.record_digest, "record_digest"),
  };
}

function parseRehearsals(raw: unknown): Rehearsals {
  const o = obj(raw, "rehearsals");
  const p = o.product === null ? null : obj(o.product, "product");
  return {
    available: o.available === true,
    unavailable_reason: o.unavailable_reason === null ? null : str(o.unavailable_reason, "reason"),
    product: p
      ? {
          kind: str(p.kind, "product.kind"),
          artifact_digest: str(p.artifact_digest, "product.digest"),
          supported: p.supported === true,
          reason: p.reason === null ? null : str(p.reason, "product.reason"),
        }
      : null,
    rehearsals: (Array.isArray(o.rehearsals) ? o.rehearsals : []).slice(0, 20).map(parseRehearsal),
  };
}

const enc = encodeURIComponent;
export const rehearsalApi = {
  list: async (b: string) => parseRehearsals(await call(`/api/businesses/${enc(b)}/rehearsals`)),
  start: async (b: string) =>
    parseRehearsal(
      obj(await call(`/api/businesses/${enc(b)}/rehearsals`, "POST", {}), "answer").rehearsal,
    ),
  recordUrl: (b: string, id: string) => `/api/businesses/${enc(b)}/rehearsals/${enc(id)}/record`,
};
