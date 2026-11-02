// Guided authoring: the product work log (a conversation that belongs to the business), AI
// proposals for a revised brief and screens, and applying a proposal as a new revision.
//
// A proposal is drafted by a durable build job (intent `propose`, server/src/builds.ts), so it
// inherits budgets, fencing, cancellation and recovery. The model's answer is untrusted data:
// it is rebuilt through the same validators as a founder's own save (parseBrief,
// parsePrototype) and becomes a revision only when the business's current owner applies it.
// Applying is idempotent and refuses (409) when the brief changed since the proposal's base.

import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "./artifacts.ts";
import type { BuildBudget, Builds } from "./builds.ts";
import type { Db } from "./db.ts";
import {
  type Brief,
  hashOf,
  type Products,
  type Prototype,
  parseBrief,
  parsePrototype,
} from "./products.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const PROPOSAL_SCHEMA = "product_proposal/1" as const;
export const MAX_PROPOSAL_BYTES = 64 * 1024;
export const LOG_LIMITS = { message: 2000, conversation: 12, page: 200 } as const;

export interface Proposal {
  reply: string;
  summary: string;
  brief: Brief;
  prototype: Prototype;
  assumptions: string[];
  questions: string[];
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

class Invalid extends Error {}

function text(v: unknown, max: number, what: string, required = true): string {
  if (typeof v !== "string") throw new Invalid(`${what} must be text`);
  const s = v.replace(CONTROL, "").trim();
  if (required && !s) throw new Invalid(`${what} is empty`);
  if (s.length > max) throw new Invalid(`${what} is longer than ${max} characters`);
  return s;
}

function texts(v: unknown, maxItems: number, maxLen: number, what: string): string[] {
  if (!Array.isArray(v)) throw new Invalid(`${what} must be a list`);
  if (v.length > maxItems) throw new Invalid(`${what}: at most ${maxItems}`);
  return v.map((x, i) => text(x, maxLen, `${what} ${i + 1}`)).filter(Boolean);
}

export type ProposalResult =
  | { ok: true; proposal: Proposal; canonical: string; digest: string; bytes: number }
  | { ok: false; reason: string };

/** Parse and rebuild a proposal from a model's output. Anything unexpected is refused. */
export function validateProposal(raw: unknown): ProposalResult {
  try {
    let value = raw;
    if (typeof raw === "string") {
      if (raw.length > MAX_PROPOSAL_BYTES) throw new Invalid("The proposal is larger than 64 KB");
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Invalid("The answer is text, not a structured proposal");
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Invalid("The proposal must be an object");
    const o = value as Record<string, unknown>;
    let brief: Brief;
    let prototype: Prototype;
    try {
      brief = parseBrief(o.brief);
      prototype = parsePrototype({ schema: 1, screens: o.screens });
    } catch (e) {
      throw new Invalid(e instanceof HttpError ? e.message : "The proposal could not be read");
    }
    const proposal: Proposal = {
      reply: text(o.reply, 1200, "The reply"),
      summary: text(o.summary, 400, "The summary"),
      brief,
      prototype,
      assumptions: texts(o.assumptions ?? [], 8, 200, "Assumption"),
      questions: texts(o.questions ?? [], 3, 200, "Question"),
    };
    const canonical = canonicalJson(proposal);
    const bytes = Buffer.byteLength(canonical, "utf8");
    if (bytes > MAX_PROPOSAL_BYTES) throw new Invalid("The proposal is larger than 64 KB");
    return {
      ok: true,
      proposal,
      canonical,
      digest: createHash("sha256").update(canonical).digest("hex"),
      bytes,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Invalid ? e.message : "The proposal could not be read",
    };
  }
}

interface MessageRow {
  id: string;
  project_id: string;
  seq: number;
  role: "founder" | "assistant";
  text: string;
  author_id: string | null;
  idempotency_key: string | null;
  job_id: string | null;
  proposal_id: string | null;
  created_at: string;
}

interface ProposalRow {
  id: string;
  project_id: string;
  job_id: string;
  message_id: string;
  base_revision: number;
  base_hash: string;
  brief: string;
  prototype: string;
  content_hash: string;
  summary: string;
  assumptions: string;
  questions: string;
  provider_config: string;
  requested_by: string;
  owner_epoch: string;
  status: "open" | "applied" | "superseded";
  applied_revision: number | null;
  applied_by: string | null;
  applied_at: string | null;
  created_at: string;
}

const nextSeq = (db: Db, projectId: string) =>
  (
    db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM product_messages WHERE project_id = ?")
      .get(projectId) as { n: number }
  ).n;

/** The work log up to and including one message, oldest first, for a provider request. */
export function conversationFor(db: Db, projectId: string, upToMessage: string | null) {
  const upTo = upToMessage
    ? (db.prepare("SELECT seq FROM product_messages WHERE id = ?").get(upToMessage) as
        | { seq: number }
        | undefined)
    : undefined;
  const rows = db
    .prepare(
      "SELECT role, text FROM product_messages WHERE project_id = ? AND seq <= ? ORDER BY seq DESC LIMIT ?",
    )
    .all(projectId, upTo?.seq ?? Number.MAX_SAFE_INTEGER, LOG_LIMITS.conversation) as {
    role: "founder" | "assistant";
    text: string;
  }[];
  return rows.reverse();
}

/**
 * Records a validated proposal for a succeeded `propose` job, in the caller's transaction:
 * the proposal, the assistant's reply in the work log, and older open proposals superseded.
 */
export function recordProposal(
  db: Db,
  job: {
    id: string;
    project_id: string;
    revision: number;
    content_hash: string;
    request_ref: string | null;
    provider_config: string;
    requested_by: string;
    owner_id: string;
    owner_generation: number;
  },
  proposal: Proposal,
  at: string,
) {
  const id = randomUUID();
  db.prepare(
    "UPDATE product_proposals SET status = 'superseded' WHERE project_id = ? AND status = 'open'",
  ).run(job.project_id);
  db.prepare(
    `INSERT INTO product_proposals (id, project_id, job_id, message_id, base_revision, base_hash, brief, prototype, content_hash, summary, assumptions, questions, provider_config, requested_by, owner_epoch, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(
    id,
    job.project_id,
    job.id,
    job.request_ref ?? "",
    job.revision,
    job.content_hash,
    JSON.stringify(proposal.brief),
    JSON.stringify(proposal.prototype),
    hashOf(proposal.brief, proposal.prototype),
    proposal.summary,
    JSON.stringify(proposal.assumptions),
    JSON.stringify(proposal.questions),
    job.provider_config,
    job.requested_by,
    `${job.owner_id}:${job.owner_generation}`,
    at,
  );
  db.prepare(
    "INSERT INTO product_messages (id, project_id, seq, role, text, author_id, job_id, proposal_id, created_at) VALUES (?, ?, ?, 'assistant', ?, NULL, ?, ?, ?)",
  ).run(randomUUID(), job.project_id, nextSeq(db, job.project_id), proposal.reply, job.id, id, at);
  return id;
}

const KEY = /^[A-Za-z0-9_-]{8,80}$/;

export class Authoring {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly products: Products,
    private readonly builds: Builds,
    /** Limits for one proposal, set by the server; founders never pick tokens. */
    readonly proposalBudget: () => BuildBudget | null,
  ) {}

  private message(row: MessageRow) {
    const author = row.author_id
      ? (this.db.prepare("SELECT display_name FROM people WHERE id = ?").get(row.author_id) as
          | { display_name: string }
          | undefined)
      : undefined;
    const job = row.job_id ? this.builds.row(row.job_id) : undefined;
    return {
      id: row.id,
      seq: row.seq,
      role: row.role,
      text: row.text,
      author: row.role === "assistant" ? "Assistant" : (author?.display_name ?? "Someone"),
      created_at: row.created_at,
      proposal_id: row.proposal_id,
      job: row.role === "founder" && job ? this.builds.view(job) : null,
    };
  }

  private proposalSummary(p: ProposalRow) {
    return {
      id: p.id,
      status: p.status,
      summary: p.summary,
      base_revision: p.base_revision,
      applied_revision: p.applied_revision,
      created_at: p.created_at,
      provider: JSON.parse(p.provider_config || "{}") as object,
      current_owner: this.epochOf(p.project_id) === p.owner_epoch,
    };
  }

  private epochOf(projectId: string) {
    const b = this.db
      .prepare("SELECT business_id FROM product_projects WHERE id = ?")
      .get(projectId) as { business_id: string };
    const e = this.builds.ownerEpoch(b.business_id);
    return `${e.owner_id}:${e.generation}`;
  }

  /** The work log, proposals, any running request, and what a new request would reserve. */
  conversation(viewer: Person, projectId: string, after = 0) {
    const view = this.products.view(viewer, projectId);
    this.builds.fenceStale(view.project.business_id);
    const rows = this.db
      .prepare(
        "SELECT * FROM product_messages WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?",
      )
      .all(
        projectId,
        Number.isInteger(after) && after > 0 ? after : 0,
        LOG_LIMITS.page,
      ) as unknown as MessageRow[];
    const last = (
      this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM product_messages WHERE project_id = ?")
        .get(projectId) as { n: number }
    ).n;
    const proposals = (
      this.db
        .prepare(
          "SELECT * FROM product_proposals WHERE project_id = ? ORDER BY created_at DESC LIMIT 20",
        )
        .all(projectId) as unknown as ProposalRow[]
    ).map((p) => this.proposalSummary(p));
    const live = this.db
      .prepare(
        "SELECT * FROM build_jobs WHERE project_id = ? AND intent = 'propose' AND state IN ('queued','running','validating') ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId) as Parameters<Builds["view"]>[0] | undefined;
    const availability = this.builds.availability();
    const budget = this.proposalBudget();
    const pricing = this.builds.provider?.pricing() ?? null;
    return {
      log: {
        label: "Product work log",
        note: "Belongs to the business, with its accepted decisions. If the business is sold, the new owner gets it.",
      },
      messages: rows.map((r) => this.message(r)),
      last_seq: last,
      has_more: rows.length > 0 && (rows.at(-1) as MessageRow).seq < last,
      proposals,
      pending: live ? this.builds.view(live) : null,
      availability,
      budget: this.builds.budgetFor(view.project.business_id),
      per_request:
        availability.available && budget && pricing
          ? {
              reserve_cents: Math.ceil(
                (budget.max_input_tokens * pricing.inputCentsPerMillionTokens +
                  budget.max_output_tokens * pricing.outputCentsPerMillionTokens) /
                  1_000_000,
              ),
              limits: budget,
            }
          : null,
    };
  }

  /** Adds the founder's message and asks for a proposal against the current revision. */
  send(viewer: Person, projectId: string, input: Record<string, unknown>) {
    const view = this.products.view(viewer, projectId);
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!KEY.test(key))
      throw new HttpError(
        400,
        "idempotency_key must be 8 to 80 letters, digits, dashes or underscores",
      );
    let said: string;
    try {
      said = text(input.text, LOG_LIMITS.message, "Your message");
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const existing = this.db
      .prepare("SELECT * FROM product_messages WHERE project_id = ? AND idempotency_key = ?")
      .get(projectId, key) as unknown as MessageRow | undefined;
    if (existing && existing.text !== said)
      throw new HttpError(409, "This request key was already used for a different message.");
    if (existing?.job_id) return { message: this.message(existing), created: false };

    const availability = this.builds.availability();
    if (!availability.available) throw new HttpError(409, availability.reason);
    const budget = this.proposalBudget();
    if (!budget) throw new HttpError(409, "AI drafting is not configured on this server.");

    const id = existing?.id ?? randomUUID();
    if (!existing)
      this.db
        .prepare(
          "INSERT INTO product_messages (id, project_id, seq, role, text, author_id, idempotency_key, created_at) VALUES (?, ?, ?, 'founder', ?, ?, ?, ?)",
        )
        .run(id, projectId, nextSeq(this.db, projectId), said, viewer.id, key, this.builds.iso());
    let jobId: string;
    try {
      jobId = this.builds.request(
        viewer,
        projectId,
        { idempotency_key: key, intent: "propose", revision: view.head.number, budget },
        null,
        id,
      ).job.id;
    } catch (e) {
      // Nothing was queued: the message is not kept, so the founder can try again as written.
      if (!existing) this.db.prepare("DELETE FROM product_messages WHERE id = ?").run(id);
      throw e;
    }
    this.db.prepare("UPDATE product_messages SET job_id = ? WHERE id = ?").run(jobId, id);
    const row = this.db
      .prepare("SELECT * FROM product_messages WHERE id = ?")
      .get(id) as unknown as MessageRow;
    return { message: this.message(row), created: true };
  }

  private proposalRow(viewer: Person, projectId: string, proposalId: string) {
    this.products.view(viewer, projectId);
    const p = this.db
      .prepare("SELECT * FROM product_proposals WHERE id = ? AND project_id = ?")
      .get(String(proposalId), projectId) as unknown as ProposalRow | undefined;
    if (!p) throw new HttpError(404, "No such proposal");
    return p;
  }

  proposal(viewer: Person, projectId: string, proposalId: string) {
    const p = this.proposalRow(viewer, projectId, proposalId);
    const head = this.products.head(viewer, projectId);
    return {
      ...this.proposalSummary(p),
      brief: JSON.parse(p.brief) as Brief,
      prototype: JSON.parse(p.prototype) as Prototype,
      assumptions: JSON.parse(p.assumptions) as string[],
      questions: JSON.parse(p.questions) as string[],
      base_hash: p.base_hash,
      head: { number: head.number, content_hash: head.content_hash },
      base_is_head: head.number === p.base_revision,
      note: "Assumptions and suggestions are the assistant's, not evidence of demand or results.",
    };
  }

  /** Applies a proposal as a new revision, once. Refuses if the brief changed since its base. */
  apply(viewer: Person, projectId: string, proposalId: string) {
    this.proposalRow(viewer, projectId, proposalId);
    let outcome = { created: false, revision: 0, already: false };
    let brief: Brief | null = null;
    this.store.tx(() => {
      const p = this.db
        .prepare("SELECT * FROM product_proposals WHERE id = ?")
        .get(proposalId) as unknown as ProposalRow;
      if (p.status === "applied") {
        outcome = { created: false, revision: p.applied_revision as number, already: true };
        return;
      }
      if (p.owner_epoch !== this.epochOf(projectId))
        throw new HttpError(
          409,
          "This proposal was made before the business changed hands. Ask again to get one for you.",
        );
      const head = this.products.head(viewer, projectId).number;
      if (head !== p.base_revision)
        throw new HttpError(
          409,
          `Revision ${head} was saved after this proposal was made from revision ${p.base_revision}. Nothing was overwritten. Compare them, or ask again on revision ${head}.`,
        );
      brief = JSON.parse(p.brief) as Brief;
      const c = this.products.commitCore(
        viewer,
        projectId,
        p.base_revision,
        brief,
        JSON.parse(p.prototype) as Prototype,
        `Used the assistant's proposal: ${p.summary}`.slice(0, 200),
        null,
      );
      this.db
        .prepare(
          "UPDATE product_proposals SET status = 'applied', applied_revision = ?, applied_by = ?, applied_at = ? WHERE id = ? AND status <> 'applied'",
        )
        .run(c.number, viewer.id, this.builds.iso(), proposalId);
      outcome = { created: c.created, revision: c.number, already: false };
    });
    const view = brief
      ? this.products.afterCommit(viewer, projectId, outcome.created, brief)
      : this.products.view(viewer, projectId);
    return { ...view, applied: { proposal_id: proposalId, ...outcome } };
  }
}
