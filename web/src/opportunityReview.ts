// Job 005a: the review step between a public request and a private product project. The page
// renders this controller's state; every request goes through it, so its rules are tested
// without a browser.
//
// - The draft (idea, foundation, name, destination) starts from the request once and is then the
//   founder's: a later or repeated load never overwrites what they typed.
// - Create sends one request key. If no answer arrives (a network failure or a server error), the
//   attempt is "unknown" and Create again resends the same key with the same input, so the server
//   returns the project it made, never a second one. Editing the draft afterwards starts a new key
//   (and says that a project may already exist).
// - A refusal (the request closed, expired or was removed; the business isn't the founder's) is
//   shown as such; nothing claims a project was made.
// - Leaving the page (or another person acting) retires the controller: late answers land nowhere.

import { ApiError } from "./api.ts";
import type { CreateFromRequest, Opportunity, opportunitiesApi } from "./opportunitiesApi.ts";
import type { Foundation } from "./productsApi.ts";

export type ReviewPort = Pick<typeof opportunitiesApi, "get" | "createProject">;

export interface ReviewDraft {
  idea: string;
  foundation: Foundation;
  name: string;
  /** null: a new private business. */
  business_id: string | null;
}

export interface Attempt {
  key: string;
  /** The exact input sent with this key. */
  sent: ReviewDraft;
  state: "sending" | "unknown" | "refused";
  message: string | null;
}

export interface ReviewState {
  status: "loading" | "ready" | "gone" | "error";
  message: string | null;
  need: Opportunity | null;
  draft: ReviewDraft | null;
  attempt: Attempt | null;
  /** The project made (or found again by a retry); the page opens it. */
  created: { project_id: string; again: boolean } | null;
}

const same = (a: ReviewDraft, b: ReviewDraft) =>
  a.idea === b.idea &&
  a.foundation === b.foundation &&
  a.name === b.name &&
  a.business_id === b.business_id;

export const UNANSWERED =
  "No answer arrived, so the project may or may not have been made. Create again sends the same request, which never makes a second project.";

export class ReviewController {
  private state: ReviewState = {
    status: "loading",
    message: null,
    need: null,
    draft: null,
    attempt: null,
    created: null,
  };
  private listeners = new Set<() => void>();
  private alive = true;

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

  load = async () => {
    try {
      const need = await this.api.get(this.needId);
      if (need.id !== this.needId) return;
      this.set((s) => ({
        ...s,
        status: "ready",
        message: null,
        need,
        // Only the first load fills the draft; typed text is never replaced.
        draft: s.draft ?? {
          idea: need.text,
          foundation: need.classification.suggested_foundation,
          name: "",
          business_id: this.preset.business_id ?? null,
        },
      }));
    } catch (e) {
      const gone = e instanceof ApiError && e.status === 404;
      this.set((s) => ({
        ...s,
        status: s.need && !gone ? s.status : gone ? "gone" : "error",
        message: gone
          ? "This request is no longer open. It may have been closed by the person who posted it, or expired."
          : (e as Error).message || "It couldn't be loaded.",
      }));
    }
  };

  edit = (patch: Partial<ReviewDraft>) =>
    this.set((s) => (s.draft ? { ...s, draft: { ...s.draft, ...patch } } : s));

  create = async () => {
    const { draft, attempt, status } = this.state;
    if (!draft || status !== "ready" || attempt?.state === "sending" || this.state.created) return;
    if (draft.idea.trim().length < 3) {
      this.set((s) => ({
        ...s,
        attempt: {
          key: "",
          sent: draft,
          state: "refused",
          message: "Describe the product in a sentence or two.",
        },
      }));
      return;
    }
    // Only an unanswered attempt with exactly this input reuses its key.
    const reuse = attempt?.state === "unknown" && same(attempt.sent, draft);
    const sent = { ...draft };
    const a: Attempt = {
      key: reuse ? attempt.key : this.mint(),
      sent,
      state: "sending",
      message: null,
    };
    this.set((s) => ({ ...s, attempt: a }));
    const body: CreateFromRequest = {
      idempotency_key: a.key,
      idea: sent.idea.trim(),
      foundation: sent.foundation,
      name: sent.name.trim(),
      business_id: sent.business_id,
    };
    try {
      const r = await this.api.createProject(this.needId, body);
      this.set((s) => ({
        ...s,
        attempt: null,
        created: { project_id: r.view.project.id, again: !r.created },
      }));
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      const definite = status >= 400 && status < 500;
      this.set((s) => ({
        ...s,
        // The request is gone (removed, closed or expired): say so plainly. Other refusals (a
        // business that isn't yours, invalid input) leave the review open to correct.
        status:
          definite && /no longer available|closed it|expired/.test((e as Error).message)
            ? "gone"
            : s.status,
        attempt: {
          ...a,
          state: definite ? "refused" : "unknown",
          message: definite ? (e as Error).message : UNANSWERED,
        },
      }));
    }
  };

  /** Whether editing now would start a new request (a project may already exist). */
  get draftDiverged() {
    const { attempt, draft } = this.state;
    return Boolean(attempt?.state === "unknown" && draft && !same(attempt.sent, draft));
  }
}
