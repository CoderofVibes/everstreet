// The product studio's records: a digital product project belongs to a business, and each save
// is an immutable revision (brief + prototype schema). Restoring an old revision makes a new
// one, so history only grows. Only the business's current owner may read or write a project;
// "missing" and "not yours" get the same 404. The prototype is plain data rendered by the web
// app as text: no code, markup, URLs or credentials, and nothing in it can act for the platform.

import { createHash, randomUUID } from "node:crypto";
import { ANALYSIS_COMPILE_AVAILABILITY } from "./analysis.ts";
import { type BuildAvailability, type BuildProvider, buildAvailability } from "./build.ts";
import type { Db } from "./db.ts";
import { projectSource } from "./projectSource.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import { WORKFLOW_ENGINE_AVAILABILITY } from "./workflow.ts";

export const FOUNDATIONS = ["ai_api", "saas_workflow", "agent_service", "client_portal"] as const;
export type Foundation = (typeof FOUNDATIONS)[number];

export const PRICE_MODELS = ["per_use", "monthly", "one_time", "free", "undecided"] as const;
export type PriceModel = (typeof PRICE_MODELS)[number];

export interface Brief {
  name: string;
  audience: string;
  problem: string;
  promise: string;
  features: string[];
  price: { model: PriceModel; amount_cents: number | null; note: string };
}

export const FIELD_TYPES = ["text", "long_text", "number", "choice", "file_name"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface ProtoField {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
}

export type Screen =
  | { id: string; kind: "form"; title: string; fields: ProtoField[]; submit_label: string }
  | { id: string; kind: "list"; title: string; source: string; stages: string[] }
  | { id: string; kind: "model"; title: string; source: string; outputs: ProtoField[] };

export interface Prototype {
  schema: 1;
  screens: Screen[];
}

export const LIMITS = {
  idea: 2000,
  name: 80,
  text: 600,
  features: 8,
  feature: 140,
  screens: 6,
  fields: 12,
  label: 80,
  options: 8,
  stages: 6,
  note: 200,
  maxPriceCents: 100_000_000,
} as const;

// ---------- foundations ----------

type DependencyKey =
  | "model_provider"
  | "hosting"
  | "metering"
  | "payments"
  | "database"
  | "sign_in"
  | "tools"
  | "review"
  | "storage";

const DEPENDENCY_LABEL: Record<DependencyKey, string> = {
  model_provider: "Model provider for customer requests",
  hosting: "Where the product runs",
  metering: "Usage counted per customer",
  payments: "Customer payments",
  database: "Customer records storage",
  sign_in: "Customer sign-in",
  tools: "Tools the agent may use",
  review: "A person who reviews the agent's work",
  storage: "File storage",
};

const f = (key: string, label: string, type: FieldType, options: string[] = []): ProtoField => ({
  key,
  label,
  type,
  options,
});

interface FoundationDef {
  id: Foundation;
  label: string;
  summary: string;
  example: string;
  needs: DependencyKey[];
  features: string[];
  prototype: Prototype;
}

export const FOUNDATION_DEFS: Record<Foundation, FoundationDef> = {
  ai_api: {
    id: "ai_api",
    label: "AI API",
    summary: "Customers send a document or text and get structured results back.",
    example: "Turn invoices into clean JSON for an accounting tool",
    needs: ["model_provider", "hosting", "metering", "payments"],
    features: [
      "Accept a document or text input",
      "Return the fields the customer needs as structured data",
      "Count every request against the customer's plan",
    ],
    prototype: {
      schema: 1,
      screens: [
        {
          id: "request",
          kind: "form",
          title: "Send a request",
          fields: [
            f("document", "Document or text", "long_text"),
            f("document_type", "Document type", "choice", ["Invoice", "Receipt", "Contract"]),
          ],
          submit_label: "Send request",
        },
        {
          id: "result",
          kind: "model",
          title: "Structured result",
          source: "request",
          outputs: [
            f("vendor", "Vendor", "text"),
            f("total", "Total", "number"),
            f("due_date", "Due date", "text"),
          ],
        },
        { id: "log", kind: "list", title: "Request log", source: "request", stages: [] },
      ],
    },
  },
  saas_workflow: {
    id: "saas_workflow",
    label: "SaaS workflow",
    summary: "A team tracks its work through stages in a shared web app.",
    example: "A tracker for renovation crews to move jobs from quote to done",
    needs: ["hosting", "database", "sign_in", "payments"],
    features: [
      "Add a work item with the details that matter",
      "Move items through stages",
      "See everything in progress at a glance",
    ],
    prototype: {
      schema: 1,
      screens: [
        {
          id: "new_item",
          kind: "form",
          title: "New item",
          fields: [
            f("title", "Title", "text"),
            f("owner", "Owner", "text"),
            f("due", "Due", "text"),
          ],
          submit_label: "Add item",
        },
        {
          id: "board",
          kind: "list",
          title: "Board",
          source: "new_item",
          stages: ["To do", "In progress", "Done"],
        },
      ],
    },
  },
  agent_service: {
    id: "agent_service",
    label: "Agent service",
    summary: "An AI agent carries out a task for a customer; a person approves what matters.",
    example: "An agent that drafts supplier follow-ups for a small shop to approve",
    needs: ["model_provider", "tools", "review", "hosting"],
    features: [
      "Take a task request in plain words",
      "Draft the work with an AI agent",
      "A person approves before anything is sent",
    ],
    prototype: {
      schema: 1,
      screens: [
        {
          id: "task",
          kind: "form",
          title: "New task",
          fields: [
            f("request", "What should be done", "long_text"),
            f("deadline", "By when", "text"),
          ],
          submit_label: "Submit task",
        },
        {
          id: "draft",
          kind: "model",
          title: "Agent draft",
          source: "task",
          outputs: [
            f("summary", "Summary", "long_text"),
            f("next_steps", "Next steps", "long_text"),
          ],
        },
        {
          id: "review",
          kind: "list",
          title: "Review queue",
          source: "task",
          stages: ["Waiting for review", "Approved", "Sent back"],
        },
      ],
    },
  },
  client_portal: {
    id: "client_portal",
    label: "Client portal",
    summary: "Clients sign in to make requests, share files and follow progress.",
    example: "A portal where a design studio's clients request and approve work",
    needs: ["sign_in", "storage", "hosting", "payments"],
    features: [
      "Clients submit a request with files",
      "Clients see the status of each request",
      "You reply and update status in one place",
    ],
    prototype: {
      schema: 1,
      screens: [
        {
          id: "request",
          kind: "form",
          title: "New request",
          fields: [
            f("subject", "Subject", "text"),
            f("details", "Details", "long_text"),
            f("attachment", "Attachment", "file_name"),
          ],
          submit_label: "Send request",
        },
        {
          id: "requests",
          kind: "list",
          title: "Your requests",
          source: "request",
          stages: ["Received", "In progress", "Delivered"],
        },
      ],
    },
  },
};

export function foundations() {
  return FOUNDATIONS.map((id) => {
    const d = FOUNDATION_DEFS[id];
    return {
      id,
      label: d.label,
      summary: d.summary,
      example: d.example,
      needs: d.needs.map((k) => DEPENDENCY_LABEL[k]),
      features: d.features,
    };
  });
}

// ---------- validation: everything stored is rebuilt from checked parts ----------

const bad = (message: string): never => {
  throw new HttpError(400, message);
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function text(value: unknown, max: number, what: string, multiline = false): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return bad(`${what} must be text`);
  let s = value.replace(CONTROL, "");
  if (!multiline) s = s.replace(/[\r\n\t]+/g, " ");
  s = s.trim();
  if (s.length > max) bad(`${what} is too long (at most ${max} characters)`);
  return s;
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

function key(value: unknown, what: string): string {
  if (typeof value !== "string" || !KEY.test(value))
    bad(`${what} must be a short lowercase key (letters, digits, underscores)`);
  return value as string;
}

function list(value: unknown, max: number, what: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return bad(`${what} must be a list`);
  if (value.length > max) bad(`${what}: at most ${max}`);
  return value;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) bad(`${what} is missing`);
  return value as Record<string, unknown>;
}

export function parseBrief(input: unknown): Brief {
  const b = record(input, "The brief");
  const features = list(b.features, LIMITS.features, "Core features")
    .map((x, i) => text(x, LIMITS.feature, `Feature ${i + 1}`))
    .filter(Boolean);
  const p = b.price === undefined ? {} : record(b.price, "The pricing assumption");
  const model = p.model ?? "undecided";
  if (!PRICE_MODELS.includes(model as PriceModel)) bad("Unknown pricing model");
  let amount: number | null = null;
  if (p.amount_cents !== undefined && p.amount_cents !== null && p.amount_cents !== "") {
    const n = Number(p.amount_cents);
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.maxPriceCents)
      bad("The price must be a whole number of cents, zero or more");
    amount = n;
  }
  if (model === "free" || model === "undecided") amount = null;
  return {
    name: text(b.name, LIMITS.name, "The product name") || "Untitled product",
    audience: text(b.audience, LIMITS.text, "The audience", true),
    problem: text(b.problem, LIMITS.text, "The problem", true),
    promise: text(b.promise, LIMITS.text, "The promised result", true),
    features,
    price: {
      model: model as PriceModel,
      amount_cents: amount,
      note: text(p.note, LIMITS.text, "The pricing note"),
    },
  };
}

function parseField(input: unknown, where: string): ProtoField {
  const x = record(input, where);
  const type = x.type;
  if (!FIELD_TYPES.includes(type as FieldType)) bad(`${where}: unknown field type`);
  const options =
    type === "choice"
      ? list(x.options, LIMITS.options, `${where} options`)
          .map((o, i) => text(o, LIMITS.label, `${where} option ${i + 1}`))
          .filter(Boolean)
      : [];
  if (type === "choice" && options.length === 0) bad(`${where}: a choice needs options`);
  const label = text(x.label, LIMITS.label, `${where} label`);
  if (!label) bad(`${where} needs a label`);
  return { key: key(x.key, `${where} key`), label, type: type as FieldType, options };
}

function parseFields(value: unknown, where: string, required: boolean): ProtoField[] {
  const fields = list(value, LIMITS.fields, `${where} fields`).map((x, i) =>
    parseField(x, `${where}, field ${i + 1}`),
  );
  if (required && fields.length === 0) bad(`${where} needs at least one field`);
  const keys = new Set<string>();
  for (const fl of fields) {
    if (keys.has(fl.key)) bad(`${where}: two fields share the key "${fl.key}"`);
    keys.add(fl.key);
  }
  return fields;
}

export function parsePrototype(input: unknown): Prototype {
  const p = record(input, "The prototype");
  if (p.schema !== 1) bad("Unknown prototype version");
  const raw = list(p.screens, LIMITS.screens, "Screens");
  if (raw.length === 0) bad("The prototype needs at least one screen");
  const screens: Screen[] = raw.map((s, i) => {
    const x = record(s, `Screen ${i + 1}`);
    const id = key(x.id, `Screen ${i + 1} id`);
    const title = text(x.title, LIMITS.label, `Screen ${i + 1} title`) || `Screen ${i + 1}`;
    const where = `"${title}"`;
    if (x.kind === "form")
      return {
        id,
        kind: "form",
        title,
        fields: parseFields(x.fields, where, true),
        submit_label: text(x.submit_label, LIMITS.label, `${where} button`) || "Submit",
      };
    if (x.kind === "list")
      return {
        id,
        kind: "list",
        title,
        source: key(x.source, `${where} source`),
        stages: list(x.stages, LIMITS.stages, `${where} stages`)
          .map((st, j) => text(st, LIMITS.label, `${where} stage ${j + 1}`))
          .filter(Boolean),
      };
    if (x.kind === "model")
      return {
        id,
        kind: "model",
        title,
        source: key(x.source, `${where} source`),
        outputs: parseFields(x.outputs, where, true),
      };
    return bad(`Screen ${i + 1}: unknown kind of screen`);
  });
  const forms = new Set(screens.filter((s) => s.kind === "form").map((s) => s.id));
  const ids = new Set<string>();
  for (const s of screens) {
    if (ids.has(s.id)) bad(`Two screens share the id "${s.id}"`);
    ids.add(s.id);
    if (s.kind !== "form" && !forms.has(s.source))
      bad(`"${s.title}" must read from a form screen in this prototype`);
  }
  return { schema: 1, screens };
}

export const hashOf = (brief: Brief, prototype: Prototype) =>
  createHash("sha256").update(JSON.stringify({ brief, prototype })).digest("hex");

// ---------- checks and continuity: only what is actually known ----------

type CheckState = "pass" | "todo" | "unavailable" | "manual" | "fail";

/** Manual checks a founder can record (self-reported; labelled as such everywhere). */
export const MANUAL_CHECKS = {
  audience_walkthrough: "Walk someone from your audience through the prototype",
  manual_fallback: "Confirm you could deliver the promise by hand if the AI step failed",
} as const;
export type ManualCheckKey = keyof typeof MANUAL_CHECKS;

/**
 * Phase B (November 5 build): what is actually recorded for a saved revision, so Checks never
 * says "no build exists" when one does, and never claims more than the records show.
 */
export interface RevisionEvidence {
  build: { id: string; state: string; finished_at: string | null } | null;
  evaluation: {
    id: string;
    state: string;
    passed: number;
    failed: number;
    errors: number;
    total: number;
    finished_at: string | null;
  } | null;
  release: { id: string; artifact_job: string; revision: number; activated_at: string } | null;
  customer_results: number;
  manual: Partial<
    Record<ManualCheckKey, { outcome: "done" | "issues"; note: string; by: string; at: string }>
  >;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function buildCheck(build: BuildAvailability, revision: number | null, e: RevisionEvidence | null) {
  if (e?.build)
    return {
      state: (e.build.state === "succeeded"
        ? "pass"
        : e.build.state === "failed"
          ? "fail"
          : "todo") as CheckState,
      detail:
        e.build.state === "succeeded"
          ? `Revision ${revision} was built.`
          : `The build of revision ${revision} is ${e.build.state.replaceAll("_", " ")}.`,
    };
  return {
    state: (build.available ? "todo" : "unavailable") as CheckState,
    detail: build.available
      ? `Revision ${revision} hasn't been built yet.`
      : "No build provider is connected, so nothing is generated here yet.",
  };
}

function evaluationCheck(build: BuildAvailability, e: RevisionEvidence | null) {
  const ev = e?.evaluation;
  if (ev) {
    const wrong = ev.failed + ev.errors;
    if (ev.state !== "complete")
      return {
        state: "todo" as CheckState,
        detail: `An evaluation of this revision's build is ${ev.state}.`,
      };
    return {
      state: (wrong === 0 ? "pass" : "fail") as CheckState,
      detail: `${ev.passed} of ${ev.total} named test cases passed on this revision's build${
        wrong > 0 ? ` (${ev.failed} wrong, ${ev.errors} errors)` : ""
      }. Quality on these cases only, not a claim of general accuracy.`,
    };
  }
  return {
    state: "unavailable" as CheckState,
    detail:
      e?.build?.state === "succeeded"
        ? "This revision's build hasn't been evaluated yet."
        : build.available
          ? "No evaluation set has been run for this revision."
          : "No build provider is connected, so no model output exists to evaluate.",
  };
}

function customerCheck(revision: number | null, e: RevisionEvidence | null) {
  const r = e?.release;
  if (!r)
    return {
      state: "unavailable" as CheckState,
      detail:
        e?.build?.state === "succeeded"
          ? "Not released yet, so no customer has used it."
          : "Customer journey tests need a working build; this project has a prototype only.",
    };
  const which =
    r.revision === revision
      ? `Revision ${revision} is released.`
      : `Released: revision ${r.revision}. This revision isn't released; customers keep the released one.`;
  const used =
    (e?.customer_results ?? 0) > 0
      ? ` Customers have received ${plural(e?.customer_results ?? 0, "result")} from the released version (observed use, not a test).`
      : " No customer has used the released version yet.";
  return {
    state: ((e?.customer_results ?? 0) > 0 ? "pass" : "todo") as CheckState,
    detail: which + used,
  };
}

export function checks(
  brief: Brief,
  prototype: Prototype,
  build: BuildAvailability,
  revision: number | null = null,
  evidence: RevisionEvidence | null = null,
) {
  const priced =
    brief.price.model === "free" ||
    (brief.price.model !== "undecided" && brief.price.amount_cents !== null);
  const c = (id: string, label: string, ok: boolean, todo: string) => ({
    id,
    label,
    state: (ok ? "pass" : "todo") as CheckState,
    detail: ok ? "" : todo,
  });
  const deterministic = [
    c(
      "name",
      "The product has a name",
      brief.name !== "Untitled product",
      "Give it a working name",
    ),
    c("audience", "The audience is named", Boolean(brief.audience), "Say who it is for"),
    c("problem", "The problem is stated", Boolean(brief.problem), "Say what goes wrong for them"),
    c(
      "promise",
      "The promised result is stated",
      Boolean(brief.promise),
      "Say what the customer gets",
    ),
    c("features", "At least two core features", brief.features.length >= 2, "List what it must do"),
    c("price", "A pricing assumption is set", priced, "Choose how and what customers would pay"),
    c(
      "input",
      "The prototype captures customer input",
      prototype.screens.some((s) => s.kind === "form"),
      "Add a form screen",
    ),
  ];
  return {
    deterministic,
    passed: deterministic.filter((d) => d.state === "pass").length,
    build: buildCheck(build, revision, evidence),
    model_evaluations: evaluationCheck(build, evidence),
    journey_tests: customerCheck(revision, evidence),
    manual: (Object.keys(MANUAL_CHECKS) as ManualCheckKey[]).map((key) => {
      const r = evidence?.manual[key];
      return {
        key,
        label: MANUAL_CHECKS[key],
        state: (r ? (r.outcome === "done" ? "pass" : "fail") : "manual") as CheckState,
        recorded: r ?? null,
      };
    }),
    unknowns: [
      ...((evidence?.customer_results ?? 0) > 0
        ? []
        : [
            evidence?.build?.state === "succeeded"
              ? "Compute cost per customer request: shown in operations once customers use the released version"
              : "Compute cost per customer request: unknown until a build runs",
          ]),
      (evidence?.customer_results ?? 0) > 0
        ? "Whether customers keep paying the price over time"
        : "Whether customers will pay the assumed price",
    ],
  };
}

// ---------- the module ----------

interface ProjectRow {
  id: string;
  business_id: string;
  foundation: Foundation;
  idea: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  owner_id: string;
}

interface RevisionRow {
  project_id: string;
  number: number;
  brief: string;
  prototype: string;
  content_hash: string;
  note: string;
  restored_from: number | null;
  author_id: string;
  author: string;
  created_at: string;
}

const now = () => new Date().toISOString();

export class Products {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly provider: BuildProvider | null = null,
    /** The build service's own answer (which also requires an operator ceiling), if wired. */
    private readonly availability: (() => BuildAvailability) | null = null,
  ) {}

  /** What the records show for one saved revision (Checks; never more than is recorded). */
  private evidence(projectId: string, revision: number): RevisionEvidence {
    const build = this.db
      .prepare(
        "SELECT id, state, finished_at FROM build_jobs WHERE project_id = ? AND revision = ? AND intent = 'build' ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId, revision) as RevisionEvidence["build"] | undefined;
    const evaluation = build
      ? (this.db
          .prepare(
            "SELECT id, state, passed, failed, errors, total, finished_at FROM eval_runs WHERE artifact_job = ? ORDER BY created_at DESC LIMIT 1",
          )
          .get(build.id) as RevisionEvidence["evaluation"] | undefined)
      : undefined;
    const release = this.db
      .prepare(
        `SELECT r.id, r.artifact_job, j.revision, r.activated_at FROM runtime_releases r
           JOIN build_jobs j ON j.id = r.artifact_job
          WHERE r.project_id = ? AND r.state = 'active' ORDER BY r.activated_at DESC LIMIT 1`,
      )
      .get(projectId) as RevisionEvidence["release"] | undefined;
    const customer = release
      ? (this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM customer_executions e
               JOIN runtime_invocations i ON i.id = e.invocation_id
              WHERE i.release_id = ? AND e.delivery = 'delivered'`,
          )
          .get(release.id) as { n: number })
      : { n: 0 };
    const manual: RevisionEvidence["manual"] = {};
    const rows = this.db
      .prepare(
        `SELECT m.check_key, m.outcome, m.note, m.created_at, p.display_name FROM product_manual_checks m
           JOIN people p ON p.id = m.recorded_by
          WHERE m.project_id = ? AND m.revision = ? ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(projectId, revision) as {
      check_key: ManualCheckKey;
      outcome: "done" | "issues";
      note: string;
      created_at: string;
      display_name: string;
    }[];
    for (const r of rows)
      manual[r.check_key] = {
        outcome: r.outcome,
        note: r.note,
        by: r.display_name,
        at: r.created_at,
      };
    return {
      build: build ?? null,
      evaluation: evaluation ?? null,
      release: release ?? null,
      customer_results: customer.n,
      manual,
    };
  }

  /**
   * Records a founder's own manual check of a saved revision: self-reported, append-only, and
   * shown as recorded by that person, never as an automated pass. The newest record counts.
   */
  recordManualCheck(viewer: Person, projectId: string, input: Record<string, unknown>) {
    const p = this.owned(viewer, projectId);
    // An owner write: refused while the business is changing hands (MANAGED_HANDOVER §14.2).
    this.store.requireNoHandover(p.business_id);
    const key = input.check_key;
    if (typeof key !== "string" || !(key in MANUAL_CHECKS))
      throw new HttpError(400, "Choose one of the manual checks");
    const outcome = input.outcome;
    if (outcome !== "done" && outcome !== "issues")
      throw new HttpError(400, "The outcome is done or issues");
    const revision = Number(input.revision);
    if (!Number.isSafeInteger(revision) || !this.revisionRow(p.id, revision))
      throw new HttpError(404, "No such revision");
    const note = text(input.note, LIMITS.text, "The note", true);
    if (outcome === "issues" && !note) throw new HttpError(400, "Say what you found");
    this.db
      .prepare(
        "INSERT INTO product_manual_checks (id, project_id, revision, check_key, outcome, note, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), p.id, revision, key, outcome, note, viewer.id, new Date().toISOString());
    return this.view(viewer, projectId);
  }

  private build(): BuildAvailability {
    return this.availability ? this.availability() : buildAvailability(this.provider);
  }

  /**
   * First-use review #19: whether this kind of product can be built here. A SaaS workflow and an
   * agent service compile without a model provider (as builds.ts does), so they can be built even
   * when generated builds aren't connected; the other kinds need the provider.
   */
  private buildFor(foundation: Foundation): BuildAvailability {
    if (foundation === "saas_workflow") return { ...WORKFLOW_ENGINE_AVAILABILITY };
    if (foundation === "agent_service") return { ...ANALYSIS_COMPILE_AVAILABILITY };
    return this.build();
  }

  private event(type: string, subject: string, actor: string, payload: object = {}) {
    this.db
      .prepare("INSERT INTO events (type, subject, actor, payload, at) VALUES (?, ?, ?, ?, ?)")
      .run(type, subject, actor, JSON.stringify(payload), now());
  }

  /** The project if the viewer owns its business right now. */
  private owned(viewer: Person, projectId: string): ProjectRow {
    const row = this.db
      .prepare(
        "SELECT p.*, b.owner_id FROM product_projects p JOIN businesses b ON b.id = p.business_id WHERE p.id = ?",
      )
      .get(String(projectId)) as unknown as ProjectRow | undefined;
    if (!row || row.owner_id !== viewer.id) throw new HttpError(404, "No such product project");
    return row;
  }

  private revisionRow(projectId: string, n: number): RevisionRow | undefined {
    return this.db
      .prepare(
        "SELECT r.*, p.display_name AS author FROM product_revisions r JOIN people p ON p.id = r.author_id WHERE r.project_id = ? AND r.number = ?",
      )
      .get(projectId, n) as unknown as RevisionRow | undefined;
  }

  private headNumber(projectId: string): number {
    return (
      this.db
        .prepare("SELECT MAX(number) AS n FROM product_revisions WHERE project_id = ?")
        .get(projectId) as { n: number }
    ).n;
  }

  private revisionView(r: RevisionRow) {
    return {
      number: r.number,
      brief: JSON.parse(r.brief) as Brief,
      prototype: JSON.parse(r.prototype) as Prototype,
      content_hash: r.content_hash,
      note: r.note,
      restored_from: r.restored_from,
      author: r.author,
      created_at: r.created_at,
    };
  }

  foundations() {
    const list = foundations();
    return {
      foundations: list.map((f) => ({ ...f, build: this.buildFor(f.id) })),
      build: this.build(),
    };
  }

  mine(viewer: Person) {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.business_id, p.foundation, p.updated_at, b.name AS business_name, r.number AS revision, r.brief
         FROM product_projects p JOIN businesses b ON b.id = p.business_id
         JOIN product_revisions r ON r.project_id = p.id
           AND r.number = (SELECT MAX(number) FROM product_revisions WHERE project_id = p.id)
         WHERE b.owner_id = ? ORDER BY p.updated_at DESC`,
      )
      .all(viewer.id) as unknown as {
      id: string;
      business_id: string;
      foundation: Foundation;
      updated_at: string;
      business_name: string;
      revision: number;
      brief: string;
    }[];
    return rows.map(({ brief, ...r }) => {
      const b = JSON.parse(brief) as Brief;
      return {
        ...r,
        name: b.name,
        promise: b.promise,
        foundation_label: FOUNDATION_DEFS[r.foundation].label,
      };
    });
  }

  create(
    viewer: Person,
    input: { idea?: unknown; foundation?: unknown; business_id?: unknown; name?: unknown },
  ) {
    const idea = text(input.idea, LIMITS.idea, "The idea", true);
    if (idea.length < 3) bad("Describe your idea in a sentence or two");
    const foundation = input.foundation as Foundation;
    if (!FOUNDATIONS.includes(foundation)) bad("Choose what kind of product to build");
    const name = text(input.name, LIMITS.name, "The product name");
    const existing =
      input.business_id === undefined || input.business_id === null || input.business_id === ""
        ? null
        : this.store.ownedBusiness(viewer, String(input.business_id));
    const id = this.store.tx(() => {
      if (existing) this.store.requireNoHandover(existing.id); // job 003wf3
      const businessId =
        existing?.id ??
        this.store.insertBusiness(viewer, "idea", name || undefined, "software").businessId;
      return this.insertProject(viewer, businessId, idea, foundation, name, "");
    });
    return this.view(viewer, id);
  }

  /**
   * A new project with its starting brief (revision 1), inside the caller's transaction, for a
   * business the caller has already checked. Shared by the studio composer and the request
   * bridge (job 005a). `noteSuffix` is appended to the first revision's note.
   */
  insertProject(
    viewer: Person,
    businessId: string,
    idea: string,
    foundation: Foundation,
    name: string,
    noteSuffix: string,
  ): string {
    const def = FOUNDATION_DEFS[foundation];
    const brief = parseBrief({ name, problem: idea.slice(0, LIMITS.text), features: def.features });
    const prototype = parsePrototype(def.prototype);
    const id = randomUUID();
    const t = now();
    this.db
      .prepare(
        "INSERT INTO product_projects (id, business_id, foundation, idea, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, businessId, foundation, idea, viewer.id, t, t);
    this.insertRevision(
      id,
      1,
      brief,
      prototype,
      viewer,
      `Starting brief from ${def.label}${noteSuffix}`,
      null,
    );
    this.event("product_project_created", businessId, viewer.id, { project: id, foundation });
    return id;
  }

  private insertRevision(
    projectId: string,
    n: number,
    brief: Brief,
    prototype: Prototype,
    author: Person,
    note: string,
    restoredFrom: number | null,
  ) {
    const t = now();
    this.db
      .prepare(
        "INSERT INTO product_revisions (project_id, number, brief, prototype, content_hash, note, restored_from, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        projectId,
        n,
        JSON.stringify(brief),
        JSON.stringify(prototype),
        hashOf(brief, prototype),
        note,
        restoredFrom,
        author.id,
        t,
      );
    this.db.prepare("UPDATE product_projects SET updated_at = ? WHERE id = ?").run(t, projectId);
  }

  /** Everything the studio shows. */
  view(viewer: Person, projectId: string) {
    const p = this.owned(viewer, projectId);
    const business = this.store.ownedBusiness(viewer, p.business_id);
    const head = this.revisionRow(p.id, this.headNumber(p.id));
    if (!head) throw new HttpError(404, "No such product project");
    const current = this.revisionView(head);
    const revisions = (
      this.db
        .prepare(
          "SELECT r.number, r.note, r.restored_from, r.content_hash, r.created_at, p.display_name AS author FROM product_revisions r JOIN people p ON p.id = r.author_id WHERE r.project_id = ? ORDER BY r.number DESC",
        )
        .all(p.id) as unknown as {
        number: number;
        note: string;
        restored_from: number | null;
        content_hash: string;
        created_at: string;
        author: string;
      }[]
    ).map((r) => ({ ...r }));
    const def = FOUNDATION_DEFS[p.foundation];
    const build = this.buildFor(p.foundation);
    // Fields still holding the foundation's starter text, so the UI can say so.
    const starter =
      current.brief.features.length === def.features.length &&
      def.features.every((x, i) => current.brief.features[i] === x)
        ? ["features"]
        : [];
    return {
      project: {
        id: p.id,
        business_id: p.business_id,
        foundation: p.foundation,
        idea: p.idea,
        created_at: p.created_at,
        updated_at: p.updated_at,
      },
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        stage: business.stage,
        published_at: business.published_at,
        /**
         * Changes when the business changes hands; browsers scope unsaved drafts to it so
         * one owner's unaccepted edits are never offered to the next.
         */
        owner_epoch: `${business.owner_id}:${
          (
            this.db
              .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
              .get(business.id) as { n: number }
          ).n
        }`,
      },
      foundation: {
        id: def.id,
        label: def.label,
        summary: def.summary,
        features: def.features,
      },
      head: current,
      revisions,
      starter,
      checks: checks(
        current.brief,
        current.prototype,
        build,
        head.number,
        this.evidence(p.id, head.number),
      ),
      continuity: this.continuity(viewer, business.id, business.name, def, current.brief),
      build,
      // Job 005a: where the idea came from, if it came from a publicly shared request.
      source: projectSource(this.db, p.id),
    };
  }

  private continuity(
    viewer: Person,
    businessId: string,
    businessName: string,
    def: FoundationDef,
    brief: Brief,
  ) {
    const payments = this.db
      .prepare(
        "SELECT account_id FROM chain_accounts WHERE owner_kind = 'business' AND owner_id = ?",
      )
      .get(businessId) as { account_id: string } | undefined;
    const listing = this.db
      .prepare("SELECT mode FROM listings WHERE business_id = ?")
      .get(businessId) as { mode: string } | undefined;
    const dependency = (k: DependencyKey) => {
      if (k === "payments")
        return payments
          ? {
              label: DEPENDENCY_LABEL[k],
              state: "ok",
              detail: `The business's contract on NEAR testnet (${payments.account_id})`,
            }
          : {
              label: DEPENDENCY_LABEL[k],
              state: "missing",
              detail: "Not turned on for this business",
            };
      if (k === "review")
        return {
          label: DEPENDENCY_LABEL[k],
          state: "manual",
          detail: "You, until you appoint someone",
        };
      return {
        label: DEPENDENCY_LABEL[k],
        state: "missing",
        detail: "Not connected: no product runtime exists yet",
      };
    };
    const priceText =
      brief.price.model === "undecided"
        ? null
        : brief.price.model === "free"
          ? "Free"
          : brief.price.amount_cents === null
            ? null
            : `${(brief.price.amount_cents / 100).toFixed(2)} USD ${
                { per_use: "per use", monthly: "per month", one_time: "once" }[brief.price.model]
              }`;
    return {
      promises: [
        {
          label: "Promised result",
          state: brief.promise ? "assumption" : "missing",
          detail: brief.promise || "Not stated yet",
        },
        {
          label: "Price",
          state: priceText ? "assumption" : "missing",
          detail: priceText
            ? `${priceText} (an assumption in the brief, not a published price)`
            : "Not decided",
        },
        {
          label: "Customers with access",
          state: "known",
          detail: "None: this product has no customers or entitlements yet",
        },
      ],
      dependencies: def.needs.map(dependency),
      transfer: [
        {
          label: "Owner",
          state: "known",
          detail: `${viewer.display_name}, through ${businessName}`,
        },
        {
          label: "This project",
          state: "known",
          detail:
            "Belongs to the business, with every revision. A new owner of the business gets it; the former owner loses access.",
        },
        {
          label: "Code and deployments",
          state: "missing",
          detail: "None exist yet; nothing to hand over beyond the brief and prototype",
        },
        {
          label: "External accounts",
          state: "unknown",
          detail: "None recorded. Anything outside Everstreet is a separate item to transfer.",
        },
        {
          label: "For sale",
          state: "known",
          detail:
            listing && listing.mode !== "closed"
              ? `Listed (${listing.mode})`
              : "Not listed; customers never see sale plans",
        },
      ],
    };
  }

  revision(viewer: Person, projectId: string, n: number) {
    const p = this.owned(viewer, projectId);
    const r = Number.isInteger(n) ? this.revisionRow(p.id, n) : undefined;
    if (!r) throw new HttpError(404, "No such revision");
    return this.revisionView(r);
  }

  private commit(
    viewer: Person,
    p: ProjectRow,
    base: unknown,
    brief: Brief,
    prototype: Prototype,
    note: string,
    restoredFrom: number | null,
  ) {
    let created = false;
    this.store.tx(() => {
      this.store.requireNoHandover(p.business_id); // job 003wf3 (revisions and restores)
      created = this.commitCore(viewer, p.id, base, brief, prototype, note, restoredFrom).created;
    });
    return { created, view: this.afterCommit(viewer, p.id, created, brief) };
  }

  /**
   * Writes a new revision if the content differs from the head, in the caller's transaction.
   * Refuses (409) unless `base` is the current head. Returns the resulting head number.
   */
  commitCore(
    viewer: Person,
    projectId: string,
    base: unknown,
    brief: Brief,
    prototype: Prototype,
    note: string,
    restoredFrom: number | null,
  ): { created: boolean; number: number } {
    const p = this.owned(viewer, projectId);
    const baseN = Number(base);
    if (!Number.isInteger(baseN) || baseN < 1)
      bad("Say which revision your changes start from (base_revision)");
    const head = this.headNumber(p.id);
    if (baseN !== head)
      throw new HttpError(
        409,
        `Revision ${head} was saved after the one you started from (${baseN}). Nothing was overwritten; reload to see it, then apply your change again.`,
      );
    const headRow = this.revisionRow(p.id, head);
    if (headRow?.content_hash === hashOf(brief, prototype)) return { created: false, number: head };
    this.insertRevision(p.id, head + 1, brief, prototype, viewer, note, restoredFrom);
    this.event("product_revision_saved", p.business_id, viewer.id, {
      project: p.id,
      number: head + 1,
      restored_from: restoredFrom,
    });
    return { created: true, number: head + 1 };
  }

  /** After a committed revision: name an untitled business after the product, then the view. */
  afterCommit(viewer: Person, projectId: string, created: boolean, brief: Brief) {
    const p = this.owned(viewer, projectId);
    const business = this.store.ownedBusiness(viewer, p.business_id);
    if (created && business.name === "Untitled business" && brief.name !== "Untitled product")
      this.store.updateBusiness(viewer, business.id, { name: brief.name });
    return this.view(viewer, p.id);
  }

  /** The head revision's number and content hash, for an owner. */
  head(viewer: Person, projectId: string) {
    const p = this.owned(viewer, projectId);
    const n = this.headNumber(p.id);
    const r = this.revisionRow(p.id, n) as RevisionRow;
    return this.revisionView(r);
  }

  save(viewer: Person, projectId: string, input: Record<string, unknown>) {
    const p = this.owned(viewer, projectId);
    const brief = parseBrief(input.brief);
    const prototype = parsePrototype(input.prototype);
    const note = text(input.note, LIMITS.note, "The note") || "Edited the brief and prototype";
    return this.commit(viewer, p, input.base_revision, brief, prototype, note, null);
  }

  restore(viewer: Person, projectId: string, input: Record<string, unknown>) {
    const p = this.owned(viewer, projectId);
    const n = Number(input.revision);
    const old = Number.isInteger(n) ? this.revisionRow(p.id, n) : undefined;
    if (!old) throw new HttpError(404, "No such revision");
    // Stored revisions were validated when saved; parse again so a restore never trusts old data.
    const brief = parseBrief(JSON.parse(old.brief));
    const prototype = parsePrototype(JSON.parse(old.prototype));
    return this.commit(
      viewer,
      p,
      input.base_revision,
      brief,
      prototype,
      `Restored revision ${n}`,
      n,
    );
  }
}
