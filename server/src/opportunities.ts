// Job 005a: published customer requests as opportunities for digital builders, and a bridge from
// one request into a private product project in the existing studio.
//
// A request is not a contract, a customer or verified demand. Reading the board never reveals
// who posted a request. Creating a project from one sends nothing to anyone, adds no reply, and
// reserves nothing; the requester's stated price limit stays a stated limit, never a product
// price, budget or income. The project is the founder's own work inside their business, with a
// bounded snapshot of the public request (see projectSource.ts for what is kept).

import { createHash } from "node:crypto";
import type { Community } from "./community.ts";
import type { Db } from "./db.ts";
import { FOUNDATIONS, type Foundation, LIMITS, type Products } from "./products.ts";
import { HttpError, type Person, type Store, terms } from "./store.ts";

// ---------- a visible, editable classification (a word heuristic, not AI) ----------

export const DIGITAL_KINDS = [
  "near_app",
  "agent",
  "ai_tool",
  "api",
  "saas",
  "website",
  "online_service",
  "other",
] as const;
export type DigitalKind = (typeof DIGITAL_KINDS)[number];

const KIND_LABEL: Record<DigitalKind, string> = {
  near_app: "NEAR app",
  agent: "AI agent",
  ai_tool: "AI tool",
  api: "API",
  saas: "SaaS or web app",
  website: "Website",
  online_service: "Online service",
  other: "Not recognized",
};

/** Checked in this order; the first kind with a matching word wins. */
const KIND_WORDS: [DigitalKind, string[]][] = [
  [
    "near_app",
    ["near", "web3", "blockchain", "wallet", "token", "tokens", "nft", "dapp", "onchain"],
  ],
  ["agent", ["agent", "agents", "assistant", "autonomous", "triage", "copilot"]],
  [
    "ai_tool",
    ["ai", "gpt", "llm", "model", "chatbot", "summarize", "summarise", "classify", "transcribe"],
  ],
  ["api", ["api", "apis", "endpoint", "webhook", "webhooks", "json", "integration", "integrate"]],
  [
    "saas",
    ["saas", "dashboard", "subscription", "workflow", "crm", "tracker", "platform", "app", "apps"],
  ],
  ["website", ["website", "websites", "site", "landing", "webpage", "portfolio", "storefront"]],
  ["online_service", ["online", "automation", "automate", "automated", "bot", "software", "tool"]],
];

/** Which foundation a kind suggests in the review step; always changeable there. */
const SUGGESTED: Record<DigitalKind, Foundation> = {
  near_app: "saas_workflow",
  agent: "agent_service",
  ai_tool: "ai_api",
  api: "ai_api",
  saas: "saas_workflow",
  website: "client_portal",
  online_service: "saas_workflow",
  other: "saas_workflow",
};

export function classifyNeed(text: string) {
  const words = new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  for (const [kind, list] of KIND_WORDS) {
    const basis = list.filter((w) => words.has(w));
    if (basis.length)
      return {
        kind,
        label: KIND_LABEL[kind],
        basis,
        suggested_foundation: SUGGESTED[kind],
        note: "A guess from the request's words, not an AI judgement. Change it in the review step.",
      };
  }
  return {
    kind: "other" as const,
    label: KIND_LABEL.other,
    basis: [] as string[],
    suggested_foundation: SUGGESTED.other,
    note: "No digital product words recognized. Choose the foundation yourself.",
  };
}

// ---------- the request bridge ----------

const KEY = /^[A-Za-z0-9_-]{8,80}$/;

function bad(message: string, status: 400 | 404 | 409 = 400): never {
  throw new HttpError(status, message);
}

function field(value: unknown, max: number, what: string, multiline = false): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return bad(`${what} must be text`);
  const v = multiline ? value.replace(/\r\n/g, "\n").trim() : value.replace(/\s+/g, " ").trim();
  if (v.length > max) bad(`${what} is too long (at most ${max} characters)`);
  return v;
}

type NeedRow = {
  id: string;
  text: string;
  constraints: string;
  allow_replies: number;
  status: string;
  expires_at: string;
  created_at: string;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class Opportunities {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly community: Community,
    private readonly products: Products,
  ) {}

  /** The viewer's businesses, as words to explain which requests mention what they do. */
  private businessWords(viewer: Person | null) {
    if (!viewer) return [];
    const rows = this.db
      .prepare("SELECT id FROM businesses WHERE owner_id = ? ORDER BY created_at")
      .all(viewer.id) as { id: string }[];
    return rows.map((r) => {
      const page = this.store.business(viewer, r.id);
      const text = [
        page.business.name,
        page.business.tagline,
        page.offer.title,
        page.offer.outcome,
        page.offer.audience,
        page.offer.deliverable,
      ].join(" ");
      return {
        business_id: r.id,
        name: page.business.name,
        published: Boolean(page.business.published_at),
        words: new Set(terms(text)),
      };
    });
  }

  private decorate(
    n: ReturnType<Community["openNeeds"]>[number],
    mine: ReturnType<Opportunities["businessWords"]>,
  ) {
    // The same word folding as search (plurals folded, common words dropped).
    const needWords = [...new Set(terms(n.text))];
    return {
      ...n,
      classification: classifyNeed(n.text),
      // Why it might suit the viewer: words it shares with one of their businesses, nothing more.
      matches: mine
        .map((b) => ({
          business_id: b.business_id,
          name: b.name,
          published: b.published,
          words: needWords.filter((w) => b.words.has(w)).slice(0, 8),
        }))
        .filter((m) => m.words.length > 0),
    };
  }

  /** Open, unexpired requests; never who posted them. */
  list(viewer: Person | null) {
    const mine = this.businessWords(viewer);
    return {
      opportunities: this.community.openNeeds().map((n) => this.decorate(n, mine)),
      note: "Requests people chose to publish. A request isn't a commitment, a customer or verified demand, and nothing here is a market size or a value.",
    };
  }

  /** One open request, for the review step. Closed, expired and removed requests aren't served. */
  one(viewer: Person | null, needId: string) {
    const n = this.community.openNeeds().find((x) => x.id === needId);
    if (!n) throw new HttpError(404, "This request is no longer open");
    return this.decorate(n, this.businessWords(viewer));
  }

  /**
   * Creates a private product project inspired by an open request, in one transaction. The same
   * request key with the same input returns the same project (a lost response is safe to retry);
   * with different input it is refused. Nothing is sent to the requester.
   */
  createProject(viewer: Person, needId: string, input: Record<string, unknown>) {
    const key = typeof input.idempotency_key === "string" ? input.idempotency_key : "";
    if (!KEY.test(key))
      bad("idempotency_key must be 8 to 80 letters, digits, dashes or underscores");
    const idea = field(input.idea, LIMITS.idea, "The idea", true);
    if (idea.length < 3) bad("Describe the product in a sentence or two");
    const foundation = input.foundation as Foundation;
    if (!FOUNDATIONS.includes(foundation)) bad("Choose what kind of product to build");
    const name = field(input.name, LIMITS.name, "The product name");
    const raw = input.business_id;
    const businessId = raw === undefined || raw === null || raw === "" ? null : String(raw);
    const requestHash = sha256(JSON.stringify({ needId, idea, foundation, name, businessId }));

    const replay = () => {
      const r = this.db
        .prepare(
          "SELECT request_hash, project_id FROM need_project_requests WHERE person_id = ? AND idempotency_key = ?",
        )
        .get(viewer.id, key) as { request_hash: string; project_id: string } | undefined;
      if (!r) return null;
      if (r.request_hash !== requestHash)
        bad("This request key was already used for a different project. Nothing was created.", 409);
      return r.project_id;
    };
    // A replay answers with the project only while the viewer controls its business: after a
    // sale, the former owner's retry gets the same 404 as any project that isn't theirs.
    const earlier = replay();
    if (earlier) return { created: false, view: this.products.view(viewer, earlier) };

    // The destination must be the viewer's now (404 otherwise), and still be theirs at the write.
    const epoch = businessId ? this.store.controlEpoch(viewer, businessId) : null;
    let createdId: string | null = null;
    const projectId = this.store.tx(() => {
      const again = replay();
      if (again) return again;
      if (epoch) this.store.stillControls(viewer, epoch);
      const need = this.db.prepare("SELECT * FROM needs WHERE id = ?").get(needId) as
        | NeedRow
        | undefined;
      if (!need) bad("This request is no longer available. Nothing was created.", 404);
      if (need.status !== "open")
        bad("The person who posted this request has closed it. Nothing was created.", 409);
      if (need.expires_at <= new Date().toISOString())
        bad("This request expired before the project was created. Nothing was created.", 409);
      const bid =
        businessId ??
        this.store.insertBusiness(viewer, "idea", name || undefined, "software").businessId;
      const id = this.products.insertProject(
        viewer,
        bid,
        idea,
        foundation,
        name,
        ", inspired by a publicly shared request",
      );
      const t = new Date().toISOString();
      this.db
        .prepare(
          "INSERT INTO project_sources (project_id, need_id, need_text, constraints, allow_replies, need_created_at, need_expires_at, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          need.id,
          need.text,
          need.constraints,
          need.allow_replies,
          need.created_at,
          need.expires_at,
          t,
        );
      this.db
        .prepare(
          "INSERT INTO need_project_requests (person_id, idempotency_key, request_hash, project_id, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(viewer.id, key, requestHash, id, t);
      createdId = id;
      return id;
    });
    return { created: createdId === projectId, view: this.products.view(viewer, projectId) };
  }
}
