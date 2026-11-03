// Jobs 005a and 005a1: the review step between a public request and a private product project.
// The page renders this controller's state; every request goes through it, so its rules are
// tested without a browser.
//
// - The draft (idea, foundation, name, destination) starts from the request once and is then the
//   founder's own: no later load replaces what they typed.
// - A Create that gets no answer stays as the *original request* (its exact key and input), kept
//   apart from the draft. Typing never removes it: "Check original request" resends exactly it,
//   so a project the server already made is found, never made twice. While it is unresolved no
//   other Create can start, so new typing can't become an accidental second project.
// - When a project is found or made, the page opens it only if the draft still says what was
//   sent. If the founder typed meanwhile, their newer edits stay on the page with a link to the
//   project and an explicit choice to create a separate project from them.
// - A refusal is not an unknown: it says why, from the server's stable code (never by reading
//   its message). A request that has closed, expired or been removed stays shown as gone; no
//   later read reopens it, and an older read finishing late never replaces a newer one.
// - The foundation and business lists load visibly: if one fails, the page says so and offers a
//   retry; Create needs the foundation list, so no invisible default is ever sent.
// - Leaving the page (or another person acting: the route is keyed by person) retires the
//   controller, so late answers land nowhere.

import { ApiError } from "./api.ts";
import type { CreateFromRequest, Opportunity, opportunitiesApi } from "./opportunitiesApi.ts";
import type { Foundation, FoundationInfo } from "./productsApi.ts";

export interface ReviewPort extends Pick<typeof opportunitiesApi, "get" | "createProject"> {
  foundations(): Promise<{ foundations: FoundationInfo[] }>;
  businesses(): Promise<{ id: string; name: string }[]>;
}

export interface ReviewDraft {
  idea: string;
  foundation: Foundation;
  name: string;
  /** null: a new private business. */
  business_id: string | null;
}

/** The one Create request outstanding: sent, unanswered, or being checked again. */
export interface OriginalRequest {
  key: string;
  /** Exactly what was sent with this key; a check resends exactly this. */
  sent: ReviewDraft;
  phase: "sending" | "unknown" | "checking";
}

export interface Refusal {
  code: string | null;
  message: string;
}

export interface Created {
  project_id: string;
  /** The server returned a project it had already made (a retry). */
  again: boolean;
  sent: ReviewDraft;
  /** The draft changed after this was sent; those edits are kept here, not lost. */
  newer_edits: boolean;
}

export type Choice<T> =
  | { state: "loading" }
  | { state: "ready"; items: T[] }
  | { state: "error"; message: string };

export interface ReviewState {
  status: "loading" | "ready" | "gone" | "error";
  message: string | null;
  need: Opportunity | null;
  draft: ReviewDraft | null;
  original: OriginalRequest | null;
  refusal: Refusal | null;
  created: Created | null;
  foundations: Choice<FoundationInfo>;
  businesses: Choice<{ id: string; name: string }>;
}

const same = (a: ReviewDraft, b: ReviewDraft) =>
  a.idea === b.idea &&
  a.foundation === b.foundation &&
  a.name === b.name &&
  a.business_id === b.business_id;

/** Server codes meaning the request itself can no longer take a new project. */
const GONE = new Set([
  "request_removed",
  "request_closed",
  "request_expired",
  "request_unavailable",
]);

export const GONE_MESSAGE: Record<string, string> = {
  request_closed: "The person who posted this request has closed it.",
  request_expired: "This request has expired.",
  request_removed: "This request is no longer available.",
  request_unavailable: "This request is no longer open.",
};

export const UNANSWERED =
  "No answer arrived, so the project may or may not have been made. Check the original request to find out; it is never made twice.";

export class ReviewController {
  private state: ReviewState = {
    status: "loading",
    message: null,
    need: null,
    draft: null,
    original: null,
    refusal: null,
    created: null,
    foundations: { state: "loading" },
    businesses: { state: "loading" },
  };
  private listeners = new Set<() => void>();
  private alive = true;
  private reads = 0;
  private applied = 0;
  private choiceReads = { foundations: 0, businesses: 0 };

  constructor(
    private readonly needId: string,
    private readonly api: ReviewPort,
    private readonly mint: () => string,
    private readonly preset: { business_id?: string | null } = {},
  ) {}

  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(fn: (s: ReviewState) => ReviewState) {
    if (!this.alive) return;
    this.state = fn(this.state);
    for (const l of this.listeners) l();
  }
  dispose() {
    this.alive = false;
  }

  // ---------- reads ----------

  /** Reads the request. Only a read newer than the last applied one counts; gone stays gone. */
  load = async () => {
    const seq = ++this.reads;
    try {
      const need = await this.api.get(this.needId);
      if (need.id !== this.needId || seq <= this.applied || this.state.status === "gone") return;
      this.applied = seq;
      this.set((s) => ({
        ...s,
        status: "ready",
        message: null,
        need,
        draft: s.draft ?? {
          idea: need.text,
          foundation: need.classification.suggested_foundation,
          name: "",
          business_id: this.preset.business_id ?? null,
        },
      }));
    } catch (e) {
      if (seq <= this.applied || this.state.status === "gone") return;
      this.applied = seq;
      const code = e instanceof ApiError ? e.code : undefined;
      const gone = e instanceof ApiError && e.status === 404;
      this.set((s) => ({
        ...s,
        status: gone ? "gone" : s.need ? s.status : "error",
        message: gone
          ? (GONE_MESSAGE[code ?? "request_unavailable"] ?? "This request is no longer open.")
          : (e as Error).message || "It couldn't be loaded.",
      }));
    }
  };

  /** Loads (or retries) the foundation and business lists; each failure is shown, not hidden. */
  loadChoices = async () => {
    await Promise.all([this.loadFoundations(), this.loadBusinesses()]);
  };

  loadFoundations = async () => {
    const seq = ++this.choiceReads.foundations;
    this.set((s) => ({ ...s, foundations: { state: "loading" } }));
    try {
      const r = await this.api.foundations();
      if (seq !== this.choiceReads.foundations) return;
      this.set((s) => ({ ...s, foundations: { state: "ready", items: r.foundations } }));
    } catch (e) {
      if (seq !== this.choiceReads.foundations) return;
      this.set((s) => ({
        ...s,
        foundations: {
          state: "error",
          message: (e as Error).message || "The kinds of product couldn't be loaded.",
        },
      }));
    }
  };

  loadBusinesses = async () => {
    const seq = ++this.choiceReads.businesses;
    this.set((s) => ({ ...s, businesses: { state: "loading" } }));
    try {
      const items = await this.api.businesses();
      if (seq !== this.choiceReads.businesses) return;
      this.set((s) => ({ ...s, businesses: { state: "ready", items } }));
    } catch (e) {
      if (seq !== this.choiceReads.businesses) return;
      this.set((s) => ({
        ...s,
        businesses: {
          state: "error",
          message: (e as Error).message || "Your businesses couldn't be loaded.",
        },
      }));
    }
  };

  // ---------- the draft ----------

  edit = (patch: Partial<ReviewDraft>) =>
    this.set((s) => (s.draft ? { ...s, draft: { ...s.draft, ...patch } } : s));

  /** Why Create can't be used right now, or null. */
  get blocked(): string | null {
    const s = this.state;
    if (s.status !== "ready" || !s.draft) return "The request isn't available.";
    if (s.original) return "The original request is still unresolved.";
    if (s.created) return "A project was already made from this review.";
    if (s.foundations.state !== "ready") return "The kinds of product haven't loaded.";
    if (!s.foundations.items.some((f) => f.id === s.draft?.foundation))
      return "Choose what kind of product it is.";
    if (s.draft.idea.trim().length < 3) return "Describe the product in a sentence or two.";
    return null;
  }

  // ---------- creating ----------

  /** Create from the draft: only when nothing is outstanding and nothing was made yet. */
  create = async () => {
    if (this.blocked) return;
    const draft = this.state.draft as ReviewDraft;
    await this.send({ key: this.mint(), sent: { ...draft }, phase: "sending" });
  };

  /** Resend the unanswered original request exactly (same key and input), whatever was typed. */
  checkOriginal = async () => {
    const o = this.state.original;
    if (o?.phase !== "unknown") return;
    await this.send({ ...o, phase: "checking" });
  };

  /** After a project was made while the founder kept typing: an explicit second project. */
  createAnother = async () => {
    const c = this.state.created;
    if (!c?.newer_edits || this.state.original) return;
    this.set((s) => ({ ...s, created: null, refusal: null }));
    if (this.blocked) {
      this.set((s) => ({ ...s, created: c })); // nothing changed: keep showing what was made
      return;
    }
    await this.create();
  };

  private async send(o: OriginalRequest) {
    this.set((s) => ({ ...s, original: o, refusal: null }));
    const body: CreateFromRequest = {
      idempotency_key: o.key,
      idea: o.sent.idea.trim(),
      foundation: o.sent.foundation,
      name: o.sent.name.trim(),
      business_id: o.sent.business_id,
    };
    try {
      const r = await this.api.createProject(this.needId, body);
      this.set((s) => ({
        ...s,
        original: null,
        created: {
          project_id: r.view.project.id,
          again: !r.created,
          sent: o.sent,
          newer_edits: !s.draft || !same(o.sent, s.draft),
        },
      }));
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status >= 400 && status < 500) {
        const code = e instanceof ApiError ? (e.code ?? null) : null;
        this.set((s) => ({
          ...s,
          original: null,
          refusal: { code, message: (e as Error).message },
          status: code && GONE.has(code) ? "gone" : s.status,
          message: code && GONE.has(code) ? (GONE_MESSAGE[code] ?? s.message) : s.message,
        }));
      } else {
        this.set((s) => ({ ...s, original: { ...o, phase: "unknown" } }));
      }
    }
  }

  /** The page opens the project only when nothing typed since would be left behind. */
  get openNow(): string | null {
    const c = this.state.created;
    return c && !c.newer_edits ? c.project_id : null;
  }
}
